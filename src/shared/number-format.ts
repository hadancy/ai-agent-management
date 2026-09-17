const measurementFormatter = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

/** Format displayed measurements only; keep the original values for calculations and writes. */
export function formatMeasurement(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const formatted = measurementFormatter.format(value)
  return formatted === '-0.00' ? '0.00' : formatted
}
