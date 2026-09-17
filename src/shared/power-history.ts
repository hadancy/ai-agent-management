import type { TelemetrySnapshot } from './contracts'
import { calculatePowerKW } from './power-units'

export const POWER_HISTORY_INTERVAL_MS = 60_000
export const POWER_HISTORY_DAY_MS = 24 * 60 * POWER_HISTORY_INTERVAL_MS
const STATION_UTC_OFFSET_MS = 8 * 60 * POWER_HISTORY_INTERVAL_MS

export interface PowerHistoryPoint {
  timestamp: string
  photovoltaic: number | null
  storage: number | null
  supply: number | null
  load: number | null
}

export interface PowerHistoryResponse {
  points: PowerHistoryPoint[]
}

function finite(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function createPowerHistoryPoint(snapshot: TelemetrySnapshot): PowerHistoryPoint {
  const online = snapshot.plcConnected === true
  const battery = snapshot.devices.find((device) => device.kind === 'battery')
  const photovoltaic = online ? finite(snapshot.powers?.photovoltaicPower) : null
  const storage =
    online && battery && battery.status !== 'offline'
      ? finite(calculatePowerKW(battery.voltage, battery.current))
      : null
  return {
    timestamp: snapshot.timestamp,
    photovoltaic,
    storage,
    // Positive PLC storage current is charging; negative current supplies the bus.
    supply: photovoltaic !== null && storage !== null ? photovoltaic - storage : null,
    load: online ? finite(snapshot.powers?.totalLoadPower) : null
  }
}

/** Station days always use Asia/Shanghai, regardless of the browser's time zone. */
export function getPowerDayStart(timestampMs: number): number {
  return (
    Math.floor((timestampMs + STATION_UTC_OFFSET_MS) / POWER_HISTORY_DAY_MS) *
      POWER_HISTORY_DAY_MS -
    STATION_UTC_OFFSET_MS
  )
}

/** Keep the newest real sample in each minute; absent minutes remain absent. */
export function mergePowerHistory(
  current: PowerHistoryPoint[],
  incoming: PowerHistoryPoint[],
  startMs: number,
  endMs: number
): PowerHistoryPoint[] {
  const buckets = new Map<number, PowerHistoryPoint>()
  for (const point of [...current, ...incoming]) {
    const timestamp = Date.parse(point.timestamp)
    if (!Number.isFinite(timestamp) || timestamp < startMs || timestamp >= endMs) continue
    const bucket = Math.floor(timestamp / POWER_HISTORY_INTERVAL_MS)
    const previous = buckets.get(bucket)
    if (!previous || timestamp >= Date.parse(previous.timestamp)) buckets.set(bucket, point)
  }
  return [...buckets.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

export type PowerSeriesKey = 'supply' | 'photovoltaic' | 'storage' | 'load'

export function createPowerDaySeries(
  points: PowerHistoryPoint[],
  dayStartMs: number,
  clockOffsetMs: number,
  nowMs: number,
  key: PowerSeriesKey
): Array<[number, number | null]> {
  const minutes = new Map<number, PowerHistoryPoint>()
  for (const point of points) {
    const aligned = Date.parse(point.timestamp) + clockOffsetMs
    if (aligned < dayStartMs || aligned >= dayStartMs + POWER_HISTORY_DAY_MS || aligned > nowMs)
      continue
    const minute = Math.floor((aligned - dayStartMs) / POWER_HISTORY_INTERVAL_MS)
    const previous = minutes.get(minute)
    if (!previous || Date.parse(point.timestamp) >= Date.parse(previous.timestamp))
      minutes.set(minute, point)
  }
  return Array.from({ length: 1441 }, (_, minute) => {
    const point = minutes.get(minute)
    return [
      point
        ? Date.parse(point.timestamp) + clockOffsetMs - dayStartMs
        : minute * POWER_HISTORY_INTERVAL_MS,
      point?.[key] ?? null
    ]
  })
}
