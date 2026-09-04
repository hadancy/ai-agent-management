import type { StringMetric } from '../types'
import type { PhotovoltaicOperatingState } from '../settings/photovoltaicSettings'
import '../styles/metrics.css'

const STATE_LABELS: Record<PhotovoltaicOperatingState, string> = {
  normal: '正常',
  low: '参数异常',
  disconnected: '断开'
}

function SolarGlyph({ battery = false }: { battery?: boolean }): React.JSX.Element {
  if (battery) return <span className="battery-glyph" aria-hidden="true" />
  return <span className="solar-glyph" aria-hidden="true" />
}

function MetricReading({
  value,
  unit,
  label,
  precision
}: {
  value: number
  unit: string
  label: string
  precision: number
}): React.JSX.Element {
  return (
    <div className="metric-reading">
      <div>
        <strong>{value.toFixed(precision)}</strong>
        <span>{unit}</span>
      </div>
      <small>{label}</small>
    </div>
  )
}

function MetricStatus({ state }: { state: PhotovoltaicOperatingState }): React.JSX.Element {
  return (
    <span className="metric-status">
      <i />
      {STATE_LABELS[state]}
    </span>
  )
}

function MetricCard({
  metric,
  state,
  battery = false
}: {
  metric: StringMetric
  state: PhotovoltaicOperatingState
  battery?: boolean
}): React.JSX.Element {
  return (
    <article
      className={`metric-card metric-card--${state}`}
      aria-label={`${metric.name}，${STATE_LABELS[state]}`}
    >
      <div className="metric-card__header">
        <h2>{metric.name}</h2>
        <MetricStatus state={state} />
      </div>
      <div className="metric-card__content">
        <SolarGlyph battery={battery} />
        <MetricReading value={metric.voltage} unit="V" label="电压" precision={1} />
        <MetricReading value={metric.current} unit="A" label="电流" precision={2} />
      </div>
    </article>
  )
}

export default function MetricOverview({
  metrics,
  battery,
  photovoltaicStates,
  batteryState
}: {
  metrics: StringMetric[]
  battery: StringMetric
  photovoltaicStates: PhotovoltaicOperatingState[]
  batteryState: PhotovoltaicOperatingState
}): React.JSX.Element {
  return (
    <section className="metric-grid" aria-label="光伏组串实时数据">
      {metrics.map((metric, index) => (
        <MetricCard
          metric={metric}
          state={photovoltaicStates[index] ?? 'disconnected'}
          key={metric.name}
        />
      ))}
      <MetricCard metric={battery} state={batteryState} battery />
    </section>
  )
}
