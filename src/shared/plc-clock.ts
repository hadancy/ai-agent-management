import type { TelemetrySnapshot } from './contracts'

export const STATION_TIME_ZONE = 'Asia/Shanghai'

/** Keep time advancing between PLC clock updates, including brief disconnections. */
export class PlcSynchronizedClock {
  private lastPlcTimestamp?: string
  private offsetMs?: number

  update(snapshot?: TelemetrySnapshot): number | undefined {
    const rawTimestamp = snapshot?.plcClock?.timestamp
    if (rawTimestamp && rawTimestamp !== this.lastPlcTimestamp) {
      // PLC register values are station wall time; older snapshots omit the UTC offset.
      const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(rawTimestamp)
        ? rawTimestamp
        : `${rawTimestamp}+08:00`
      const plcTimeMs = Date.parse(timestamp)
      const capturedAtMs = Date.parse(snapshot.timestamp)
      if (Number.isFinite(plcTimeMs) && Number.isFinite(capturedAtMs)) {
        this.lastPlcTimestamp = rawTimestamp
        this.offsetMs = plcTimeMs - capturedAtMs
      }
    }
    return this.offsetMs
  }

  now(systemTimeMs = Date.now()): Date {
    return new Date(systemTimeMs + (this.offsetMs ?? 0))
  }
}
