export const POWER_UNIT = 'MW'

/** Electrical telemetry is in volts and amperes; their product is watts. */
export function calculatePowerMW(voltage: number, current: number): number {
  return (voltage * current) / 1_000_000
}

/** Keep up to one-watt precision without padding PLC integers or losing small readings. */
export function formatPowerMW(value: number | null | undefined, calculated = false): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return `— ${POWER_UNIT}`
  const rounded = Number(value.toFixed(6))
  return `${rounded.toLocaleString('en-US', {
    useGrouping: false,
    minimumFractionDigits: calculated ? 3 : 0,
    maximumFractionDigits: 6
  })} ${POWER_UNIT}`
}
