import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import type { TelemetrySnapshot } from '../src/shared/contracts'
import {
  createPowerDaySeries,
  createPowerHistoryPoint,
  getPowerDayStart,
  mergePowerHistory,
  POWER_HISTORY_DAY_MS
} from '../src/shared/power-history'
import { createAppDatabase } from '../src/main/server/database'
import { registerPowerHistoryRoutes } from '../src/main/server/power-history'

async function run(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'power-history-test-'))
  let database = createAppDatabase(directory)
  const app = Fastify()
  const start = Date.parse('2026-09-16T16:00:00Z')
  const end = start + POWER_HISTORY_DAY_MS
  const sample = (seconds: number, storagePower = 5): TelemetrySnapshot => ({
    sequence: seconds,
    timestamp: new Date(start + seconds * 1000).toISOString(),
    collectorMode: 'plc-tcp',
    plcConnected: true,
    devices: [
      {
        id: 'battery-1',
        name: '储能',
        kind: 'battery',
        voltage: 50,
        current: -100,
        status: 'normal'
      }
    ],
    powers: {
      photovoltaicPower: 12,
      storagePower,
      totalLoadPower: 10,
      renewableSupplyPower: 111,
      primaryLoadPower: 3,
      secondaryLoadPower: 3,
      tertiaryLoadPower: 4
    }
  })
  try {
    assert.equal(getPowerDayStart(Date.parse('2026-09-17T15:59:59Z')), start)
    assert.equal(getPowerDayStart(Date.parse('2026-09-17T16:00:00Z')), end)
    const discharging = createPowerHistoryPoint(sample(10))
    assert.equal(discharging.storage, 5, 'Storage reads MW112 directly, independent of V × A')
    assert.equal(discharging.supply, 17, 'Positive PLC storage power increases total supply')
    const charging = createPowerHistoryPoint(sample(20, -1))
    assert.equal(charging.storage, -1)
    assert.equal(charging.supply, 11)
    assert.equal(createPowerHistoryPoint(sample(30, 0)).storage, 0)
    const missing = createPowerHistoryPoint({ ...sample(40), powers: undefined })
    assert.equal(missing.storage, null)
    assert.equal(missing.supply, null)
    assert.equal(missing.load, null)
    assert.equal(createPowerHistoryPoint({ ...sample(40), devices: [] }).storage, 5)
    for (const value of [NaN, Infinity]) {
      const invalid = createPowerHistoryPoint(sample(40, value))
      assert.equal(invalid.storage, null)
      assert.equal(invalid.supply, null)
    }
    const legacy = sample(40)
    Reflect.deleteProperty(legacy.powers!, 'storagePower')
    Object.assign(legacy.powers!, { storageRatedPower: 99 })
    assert.equal(createPowerHistoryPoint(legacy).storage, null, 'Legacy ratings are not live power')
    assert.equal(createPowerHistoryPoint(legacy).supply, null)
    const offline = { ...sample(120), plcConnected: false }
    assert.equal(createPowerHistoryPoint(offline).photovoltaic, null)
    assert.equal(createPowerHistoryPoint(offline).storage, null)
    assert.equal(createPowerHistoryPoint(offline).load, null)
    console.log('PASS: measured power, signed charging, zero, missing and offline values')

    // Deliberately insert out of time order, and reset sequence as after a restart.
    for (const snapshot of [
      sample(-1),
      sample(50),
      sample(10),
      sample(65),
      offline,
      { ...sample(300), sequence: 1 },
      sample(86400)
    ])
      database.saveTelemetry(snapshot)
    const history = database.listPowerHistory(
      new Date(start).toISOString(),
      new Date(end).toISOString()
    )
    assert.deepEqual(
      history.map((point) => Date.parse(point.timestamp) - start),
      [50_000, 65_000, 120_000, 300_000]
    )
    assert.equal(history[2].supply, null)
    database.close()
    database = createAppDatabase(directory)
    assert.deepEqual(
      database.listPowerHistory(new Date(start).toISOString(), new Date(end).toISOString()),
      history
    )
    console.log(
      'PASS: persisted history survives restart, uses latest minute sample, excludes other days'
    )

    const live = createPowerHistoryPoint(sample(55, 6))
    const merged = mergePowerHistory([live], history, start, end)
    assert.equal(
      merged[0].storage,
      6,
      'A delayed history response cannot replace a newer live sample'
    )
    const clockOffset = 50 * POWER_HISTORY_DAY_MS
    const series = createPowerDaySeries(
      merged,
      start + clockOffset,
      clockOffset,
      start + clockOffset + 400_000,
      'supply'
    )
    assert.equal(series.length, 1441)
    assert.equal(series[0][0], 55_000)
    assert.equal(series[2][1], null, 'Offline minute remains a gap')
    assert.equal(series[3][1], null, 'Uncollected minute remains a gap')
    assert.equal(series[1440][0], POWER_HISTORY_DAY_MS)
    assert.equal(series[1440][1], null, 'Future time is not filled with zero or synthetic data')
    assert.equal(
      createPowerDaySeries(
        merged,
        end + clockOffset,
        clockOffset,
        end + clockOffset + 1,
        'supply'
      ).filter((point) => point[1] !== null).length,
      0
    )
    console.log(
      'PASS: PLC clock alignment, midnight rollover, missing minutes, 24:00 endpoint and live/history merge'
    )

    registerPowerHistoryRoutes(app, database)
    const query = new URLSearchParams({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString()
    })
    const response = await app.inject(`/api/telemetry/power-history?${query}`)
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json().points, history)
    for (const badQuery of [
      '',
      'start=bad&end=bad',
      `start=${new Date(start).toISOString()}&end=${new Date(end + 1).toISOString()}`,
      `start=${new Date(end).toISOString()}&end=${new Date(start).toISOString()}`
    ]) {
      assert.equal((await app.inject(`/api/telemetry/power-history?${badQuery}`)).statusCode, 400)
    }
    console.log('PASS: API returns persisted samples and rejects invalid or oversized ranges')
  } finally {
    await app.close()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

void run().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
