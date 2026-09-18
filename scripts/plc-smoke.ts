import assert from 'node:assert/strict'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import Fastify, { type LightMyRequestResponse } from 'fastify'
import { PlcTcpCollector } from '../src/main/server/collector'
import { registerPlcRoutes } from '../src/main/server/plc-routes'
import type { TelemetrySnapshot } from '../src/shared/contracts'
import { PLC_POWER_POINTS, type PlcClockValues, type PlcWriteResponse } from '../src/shared/plc'

type Fault =
  | 'none'
  | 'reject'
  | 'drop'
  | 'mismatch'
  | 'bad-unit'
  | 'bad-transaction'
  | 'bad-header'
  | 'bad-ack'
  | 'short-read'
  | 'read-rejected'

async function run(): Promise<void> {
  const memory = Buffer.alloc(65536 * 2, 0x5a)
  // Explicit PLC fixture: MW400–MW414 are eight consecutive unsigned WORDs.
  const pvRawValues = [0, 1, 12345, 19000, 32768, 45678, 65534, 65535]
  pvRawValues.forEach((value, index) => memory.writeUInt16BE(value, 400 + index * 2))
  memory.writeFloatBE(52, 500)
  memory.writeFloatBE(-5, 504)
  // Literal byte addresses; MW112 uses signed integer kW (-6 is raw 0xfffa).
  const powerFixture = [
    [110, 12],
    [112, 0xfffa],
    [114, 0],
    [116, 32768],
    [118, 65535],
    [200, 19],
    [210, 23]
  ]
  powerFixture.forEach(([address, value]) => memory.writeUInt16BE(value, address))
  const expectedPowers = {
    photovoltaicPower: 12,
    storagePower: -6,
    primaryLoadPower: 0,
    secondaryLoadPower: 32768,
    tertiaryLoadPower: 65535,
    totalLoadPower: 19,
    renewableSupplyPower: 23
  }
  const expectedValues = {
    ...expectedPowers,
    pv1Voltage: 0,
    pv1Current: 0.01,
    pv2Voltage: 123.45,
    pv2Current: 190,
    pv3Voltage: 327.68,
    pv3Current: 456.78,
    pv4Voltage: 655.34,
    pv4Current: 655.35,
    batteryVoltage: 52,
    batteryCurrent: -5
  }
  memory.writeUInt16BE(2026, 600)
  memory.set([9, 7, 12, 30, 45, 2], 602)
  let fault: Fault = 'none'
  let failAtWrite = 1
  let writes = 0
  let requests = 0
  const sockets = new Set<Socket>()
  const tcp = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    let buffer = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 7 && buffer.length >= buffer.readUInt16BE(4) + 6) {
        const length = buffer.readUInt16BE(4) + 6
        const request = buffer.subarray(0, length)
        buffer = buffer.subarray(length)
        requests++
        const fn = request[7]
        const address = request.readUInt16BE(8)
        const quantity = request.readUInt16BE(10)
        assert.ok(quantity <= 125, 'FC03 must not span more than 125 registers')
        let response: Buffer
        if (fn === 3) {
          if (fault === 'read-rejected') response = Buffer.from([0x83, 2])
          else {
            response = Buffer.alloc(2 + quantity * 2)
            response[0] = 3
            response[1] = quantity * 2
            memory.copy(response, 2, address * 2, (address + quantity) * 2)
            if (fault === 'short-read') response = response.subarray(0, response.length - 2)
          }
        } else {
          assert.equal(fn, 16, 'writes must use FC16')
          assert.equal(request[12], quantity * 2)
          assert.equal(request.length, 13 + quantity * 2)
          if (address >= 200 && address <= 207) assert.equal(quantity, 1, 'PV is one WORD')
          if (address === 250 || address === 252) assert.equal(quantity, 2, 'battery is REAL')
          writes++
          if (fault === 'reject' && writes === failAtWrite) response = Buffer.from([0x90, 2])
          else {
            request.copy(memory, address * 2, 13)
            if (fault === 'drop' && writes === failAtWrite) continue
            if (fault === 'mismatch') {
              if (quantity === 1) memory.writeUInt16BE(777, address * 2)
              else memory.writeFloatBE(777, address * 2)
            }
            response = Buffer.from(request.subarray(7, 12))
            if (fault === 'bad-ack') response.writeUInt16BE(address + 1, 1)
          }
        }
        const frame = Buffer.alloc(7 + response.length)
        request.copy(frame, 0, 0, 7)
        frame.writeUInt16BE(response.length + 1, 4)
        response.copy(frame, 7)
        if (fault === 'bad-unit') frame[6] = (frame[6] + 1) % 256
        if (fault === 'bad-transaction') frame.writeUInt16BE(555, 0)
        if (fault === 'bad-header') frame.writeUInt16BE(300, 4)
        // Fragment every response across the MBAP header to exercise TCP reassembly.
        socket.write(frame.subarray(0, 3))
        setTimeout(() => {
          if (!socket.destroyed) socket.write(frame.subarray(3))
        }, 3)
      }
    })
  })
  await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve))
  const connection = {
    host: '127.0.0.1',
    port: (tcp.address() as AddressInfo).port,
    unitId: 1,
    registerAddressOffset: 0
  }
  const events: string[] = []
  const app = Fastify()
  registerPlcRoutes(app, {
    config: { connection, collectorMode: 'plc-tcp' },
    developmentRendererUrl: 'http://localhost:5173',
    timeoutMs: 150,
    recordEvent: (type) => {
      events.push(type)
    }
  })
  const post = (action: string, payload: unknown, headers = {}): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'POST',
      url: `/api/plc/${action}`,
      payload: payload as object,
      headers: { host: 'localhost:17880', 'x-plc-request': '1', ...headers }
    })

  try {
    const initial = await post('read', { connection })
    assert.equal(initial.statusCode, 200)
    assert.deepEqual(initial.json().values, expectedValues)
    assert.equal(initial.json().clock.second, 45)
    assert.equal(writes, 0, 'reading must never write')

    const collector = new PlcTcpCollector({
      ...connection,
      pollingIntervalMs: 1000,
      reconnectDelayMs: 1000,
      requestTimeoutMs: 500
    })
    let collected: TelemetrySnapshot
    try {
      collected = await new Promise<TelemetrySnapshot>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Collector did not produce a snapshot')),
          2000
        )
        collector.start((snapshot) => {
          clearTimeout(timer)
          resolve(snapshot)
        })
      })
    } finally {
      collector.stop()
    }
    assert.equal(collected.plcConnected, true, collected.collectorError)
    assert.deepEqual(
      collected.devices.map(({ voltage, current }) => ({ voltage, current })),
      [
        { voltage: 0, current: 0.01 },
        { voltage: 123.45, current: 190 },
        { voltage: 327.68, current: 456.78 },
        { voltage: 655.34, current: 655.35 },
        { voltage: 52, current: -5 }
      ]
    )
    assert.equal(collected.plcClock?.timestamp, '2026-09-07T12:30:45.000')
    assert.deepEqual(collected.powers, expectedPowers)
    assert.equal(writes, 0)
    console.log(
      'PASS: all eight WORD addresses and ÷100 in API and live collector, battery and clock'
    )

    const original = Buffer.from(memory)
    const single = await post('write', { connection, values: { pv1Voltage: 123.45 } })
    assert.equal(single.statusCode, 200)
    const singleResult = single.json<PlcWriteResponse>()
    assert.equal(singleResult.ok, true)
    assert.equal(singleResult.results[0].actual, 123.45)
    assert.equal(singleResult.snapshot?.values.pv1Voltage, 123.45)
    assert.equal(memory.readUInt16BE(400), 12345)
    assert.equal(writes, 1, 'WORD is one single-register FC16 write')
    assert.deepEqual(memory.subarray(0, 400), original.subarray(0, 400))
    assert.deepEqual(
      memory.subarray(402),
      original.subarray(402),
      'unselected and shared-byte registers unchanged'
    )
    console.log('PASS: fragmented TCP, WORD scaling, readback, adjacent and untouched registers')

    const clock: PlcClockValues = {
      year: 2028,
      month: 2,
      day: 29,
      hour: 23,
      minute: 58,
      second: 57,
      weekday: 3
    }
    const multi = await post('write', {
      connection,
      values: { pv2Current: 1.25, batteryCurrent: -1.25 },
      clock
    })
    assert.equal(multi.json().ok, true)
    assert.equal(memory.readUInt16BE(406), 125)
    assert.equal(memory.readFloatBE(504), -1.25)
    assert.deepEqual(memory.subarray(600, 608), Buffer.from([7, 236, 2, 29, 23, 58, 57, 3]))
    assert.deepEqual(multi.json().snapshot.clock, clock)
    assert.equal(writes, 4, 'The entire clock is written in a single request')
    assert.ok(events.includes('plc.write-requested') && events.includes('plc.write-completed'))

    const offsetConnection = { ...connection, registerAddressOffset: 10 }
    const offsetWrite = await post('write', {
      connection: offsetConnection,
      values: { pv4Current: 639.99, batteryVoltage: 51.5 }
    })
    assert.equal(offsetWrite.json().ok, true)
    assert.equal(memory.readUInt16BE(434), 63999)
    assert.equal(offsetWrite.json().snapshot.values.pv4Current, 639.99)
    assert.equal(memory.readFloatBE(520), 51.5)
    console.log(
      'PASS: multiple points, negative and zero values, atomic clock write, register offset, audit events'
    )

    const allValues = {
      pv1Voltage: 655.35,
      pv1Current: 0,
      pv2Voltage: 10.01,
      pv2Current: 190.01,
      pv3Voltage: 327.68,
      pv3Current: 456.78,
      pv4Voltage: 655.34,
      pv4Current: 655.35
    }
    const beforeAll = Buffer.from(memory)
    const allWritten = (
      await post('write', { connection, values: allValues })
    ).json<PlcWriteResponse>()
    assert.equal(allWritten.ok, true)
    assert.equal(allWritten.results.length, 8)
    const expectedRaw = [65535, 0, 1001, 19001, 32768, 45678, 65534, 65535]
    expectedRaw.forEach((raw, index) => assert.equal(memory.readUInt16BE(400 + index * 2), raw))
    for (const [id, value] of Object.entries(allValues))
      assert.equal(allWritten.snapshot?.values[id], value)
    assert.deepEqual(memory.subarray(0, 400), beforeAll.subarray(0, 400))
    assert.deepEqual(memory.subarray(416), beforeAll.subarray(416))
    console.log('PASS: all eight writes, zero and unsigned upper boundary, decimal precision')

    const beforePowers = Buffer.from(memory)
    const powerValues = {
      ...expectedPowers,
      primaryLoadPower: 3,
      secondaryLoadPower: 5,
      tertiaryLoadPower: 4
    }
    const powerWritten = (
      await post('write', { connection, values: powerValues })
    ).json<PlcWriteResponse>()
    assert.equal(powerWritten.ok, true)
    assert.equal(powerWritten.results.length, 7)
    const expectedMemory = Buffer.from(beforePowers)
    for (const point of PLC_POWER_POINTS) {
      const value = powerValues[point.id]
      if (point.type === 'INT') expectedMemory.writeInt16BE(value, point.register * 2)
      else expectedMemory.writeUInt16BE(value, point.register * 2)
      assert.equal(powerWritten.snapshot?.values[point.id], value)
    }
    assert.deepEqual(memory, expectedMemory, 'Power writes must preserve every other byte')
    const powerOffset = (
      await post('write', { connection: offsetConnection, values: { totalLoadPower: 65535 } })
    ).json<PlcWriteResponse>()
    assert.equal(powerOffset.ok, true)
    assert.equal(memory.readUInt16BE(220), 65535)
    assert.equal(powerOffset.snapshot?.values.totalLoadPower, 65535)
    console.log(
      'PASS: all seven power addresses, integer kW, signed storage, unsigned loads, offsets and untouched bytes'
    )

    for (const [value, raw] of [
      [-32768, 0x8000],
      [-1, 0xffff],
      [0, 0],
      [1, 1],
      [32767, 0x7fff]
    ]) {
      const beforeStorage = Buffer.from(memory)
      const response = (
        await post('write', { connection, values: { storagePower: value } })
      ).json<PlcWriteResponse>()
      assert.equal(response.ok, true)
      assert.equal(response.results[0].actual, value)
      assert.equal(response.snapshot?.values.storagePower, value)
      assert.equal(memory.readUInt16BE(112), raw)
      assert.deepEqual(memory.subarray(0, 112), beforeStorage.subarray(0, 112))
      assert.deepEqual(memory.subarray(114), beforeStorage.subarray(114))
    }
    console.log('PASS: MW112 signed 16-bit boundaries, charging/discharging, zero and readback')

    const beforeInvalid = requests
    for (const payload of [
      { connection, values: { arbitrary: 1 } },
      { connection, values: { pv1Voltage: null } },
      { connection, values: { pv1Voltage: '' } },
      { connection, values: { pv1Voltage: 1e40 } },
      { connection, values: { pv1Voltage: -0.01 } },
      { connection, values: { pv1Current: 655.36 } },
      { connection, values: { pv4Current: 1.234 } },
      { connection, values: { batteryVoltage: 1e40 } },
      { connection, values: { photovoltaicPower: 1.5 } },
      { connection, values: { photovoltaicPower: 1.000000001 } },
      { connection, values: { storagePower: -32769 } },
      { connection, values: { storagePower: 32768 } },
      { connection, values: { storagePower: -1.5 } },
      { connection, values: { primaryLoadPower: 65536 } },
      { connection, values: { pv1Voltage: 10, pv4Current: -1 } },
      { connection, values: {} },
      { connection, values: { pv1Voltage: 10 }, clock: { ...clock, year: 2027 } },
      { connection, clock: { ...clock, second: 60 } },
      { connection, clock: { year: 2026 } },
      { connection: { ...connection, port: 0 }, values: { pv1Voltage: 10 } },
      { connection: { ...connection, unitId: 256 }, values: { pv1Voltage: 10 } },
      { connection: { ...connection, registerAddressOffset: 65233 }, values: { pv1Voltage: 10 } },
      { connection: { ...connection, host: 'https://example.com' }, values: { pv1Voltage: 10 } }
    ])
      assert.equal((await post('write', payload)).statusCode, 400)
    assert.equal(requests, beforeInvalid, 'validate entire payload before connecting')
    assert.equal(
      (
        await post(
          'write',
          { connection, values: { pv1Voltage: 5 } },
          { origin: 'https://unrelated.example' }
        )
      ).statusCode,
      403
    )
    assert.equal(
      (await post('write', { connection, values: { pv1Voltage: 5 } }, { 'x-plc-request': '' }))
        .statusCode,
      403
    )
    assert.equal(
      (await post('read', { connection }, { origin: 'http://localhost:5173' })).statusCode,
      200
    )
    console.log('PASS: invalid input, invalid dates, unknown points and browser-origin rejection')

    writes = 0
    fault = 'reject'
    failAtWrite = 2
    const partial = (
      await post('write', {
        connection,
        values: { pv1Voltage: 10, pv2Voltage: 20, pv3Voltage: 30 }
      })
    ).json<PlcWriteResponse>()
    assert.equal(partial.ok, false)
    assert.deepEqual(
      partial.results.map((result) => result.status),
      ['verified', 'rejected', 'not_written']
    )
    assert.equal(writes, 2)

    writes = 0
    fault = 'drop'
    failAtWrite = 1
    const pending = post('write', { connection, values: { pv1Current: 9, pv2Current: 8 } })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal((await post('read', { connection })).statusCode, 409)
    const dropped = (await pending).json<PlcWriteResponse>()
    assert.deepEqual(
      dropped.results.map((result) => result.status),
      ['unknown', 'not_written']
    )
    assert.equal(memory.readUInt16BE(402), 900, 'PLC may apply write despite lost acknowledgement')
    assert.equal(writes, 1, 'uncertain write must never auto retry')
    fault = 'none'
    assert.equal(
      (await post('read', { connection })).statusCode,
      200,
      'lock released after timeout'
    )

    fault = 'mismatch'
    const mismatch = (
      await post('write', { connection, values: { pv1Voltage: 12.3, batteryVoltage: 50 } })
    ).json<PlcWriteResponse>()
    assert.deepEqual(
      mismatch.results.map((result) => result.status),
      ['mismatch', 'not_written']
    )
    assert.equal(mismatch.results[0].actual, 7.77)
    fault = 'bad-ack'
    assert.equal(
      (await post('write', { connection, values: { pv1Voltage: 50 } })).json().results[0].status,
      'unknown'
    )
    console.log(
      'PASS: partial failure, no retries after timeout, device lock, mismatched readback and invalid acknowledgement'
    )

    const writesBeforeProtocolTests = writes
    for (const invalid of [
      'bad-unit',
      'bad-transaction',
      'bad-header',
      'short-read',
      'read-rejected'
    ] as Fault[]) {
      fault = invalid
      assert.equal((await post('write', { connection, values: { pv1Voltage: 9 } })).statusCode, 502)
    }
    assert.equal(writes, writesBeforeProtocolTests, 'failed preflight must not write')
    console.log('PASS: invalid MBAP, transaction, unit, response size and Modbus read exception')
    console.log('PLC smoke tests passed')
  } finally {
    await app.close()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve, reject) =>
      tcp.close((error) => (error ? reject(error) : resolve()))
    )
  }
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
