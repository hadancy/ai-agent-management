import { formatMeasurement } from './number-format'

export const POWER_UNIT = 'kW'

/** Electrical telemetry is in volts and amperes; their product is watts. */
export function calculatePowerKW(voltage: number, current: number): number {
  return (voltage * current) / 1_000
}

/** Power displays use the same two decimal places as other measurements. */
export function formatPowerKW(value: number | null | undefined): string {
  return `${formatMeasurement(value)} ${POWER_UNIT}`
}
