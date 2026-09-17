import type { TelemetrySnapshot } from '../../../../../shared/contracts'
import ForecastChart from './ForecastChart'
import type { ForecastModel } from './forecastSimulation'
import RealtimeChart from './RealtimeChart'

export type AuxiliaryChart = 'forecast' | 'realtime'

export default function AuxiliaryCharts({
  activeTab,
  onTabChange,
  model,
  onRiskClick,
  history,
  plcClockOffsetMs
}: {
  activeTab: AuxiliaryChart
  onTabChange: (tab: AuxiliaryChart) => void
  model: ForecastModel
  onRiskClick: () => void
  history: TelemetrySnapshot[]
  plcClockOffsetMs?: number
}): React.JSX.Element {
  const tabs = [
    { id: 'forecast' as const, label: 'AI 设备预测' },
    { id: 'realtime' as const, label: '实时电压 / 电流' }
  ]
  return (
    <section className="panel auxiliary-charts">
      <div className="auxiliary-chart-tabs" role="tablist" aria-label="辅助图表">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`auxiliary-tab-${tab.id}`}
            aria-controls="auxiliary-chart-content"
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index
              onTabChange(tabs[nextIndex].id)
              document.getElementById(`auxiliary-tab-${tabs[nextIndex].id}`)?.focus()
            }}
          >
            {tab.label}
            {tab.id === 'forecast' && model.activeRisk && (
              <i className="auxiliary-risk-dot" aria-label="有预测风险" />
            )}
          </button>
        ))}
      </div>
      <div
        id="auxiliary-chart-content"
        role="tabpanel"
        aria-labelledby={`auxiliary-tab-${activeTab}`}
      >
        {activeTab === 'forecast' ? (
          <ForecastChart model={model} onRiskClick={onRiskClick} embedded />
        ) : (
          <RealtimeChart history={history} plcClockOffsetMs={plcClockOffsetMs} embedded />
        )}
      </div>
    </section>
  )
}
