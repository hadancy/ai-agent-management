import { formatMeasurement } from '../../../../../shared/number-format'
import { useMemo } from 'react'
import { useFontScale } from '../../../settings/fontSize'
import EChartCanvas from './EChartCanvas'
import {
  FORECAST_DAY_COUNT,
  FORECAST_RISK_THRESHOLD,
  type ForecastModel
} from './forecastSimulation'
import type { EChartsOption } from './chartRuntime'
import '../styles/charts.css'

type TooltipEntry = {
  axisValue?: string
  color?: string
  dataIndex?: number
  seriesName?: string
  value?: number
}

function createAxisLabelIndexes(labelCount: number, maximumVisible = 5): Set<number> {
  if (labelCount <= maximumVisible) {
    return new Set(Array.from({ length: labelCount }, (_, index) => index))
  }
  return new Set(
    Array.from({ length: maximumVisible }, (_, index) =>
      Math.round((index * (labelCount - 1)) / (maximumVisible - 1))
    )
  )
}

function createTooltip(params: unknown, model: ForecastModel): string {
  if (!Array.isArray(params) || params.length === 0) return ''

  const entries = (params as TooltipEntry[]).filter(({ seriesName }) => seriesName !== '风险阈值')
  const dataIndex = entries[0]?.dataIndex ?? 0
  const rows = entries
    .map(({ color, seriesName, value }) => {
      const device = model.forecasts.find(({ name }) => name === seriesName)
      return `<tr><td><i style="background:${color}"></i>${seriesName}</td><td><strong>${formatMeasurement(value)}%</strong></td><td>${formatMeasurement(device?.voltageValues?.[dataIndex])}</td><td>${formatMeasurement(device?.currentValues?.[dataIndex])}</td></tr>`
    })
    .join('')

  return `<strong class="forecast-tooltip-date">${entries[0]?.axisValue ?? ''}</strong><table><thead><tr><th>设备</th><th>状态指数</th><th>电压 (V)</th><th>电流 (A)</th></tr></thead><tbody>${rows}</tbody></table>`
}

export default function ForecastChart({
  model,
  onRiskClick,
  embedded = false
}: {
  model: ForecastModel
  onRiskClick: () => void
  embedded?: boolean
}): React.JSX.Element {
  const fontScale = useFontScale()
  const visibleLabelIndexes = useMemo(
    () => createAxisLabelIndexes(model.dateLabels.length),
    [model.dateLabels.length]
  )
  const option = useMemo<EChartsOption>(
    () => ({
      animation: true,
      animationDuration: 900,
      animationEasing: 'linear',
      textStyle: {
        color: '#aeb3ba',
        fontSize: 12 * fontScale,
        fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
      },
      grid: {
        left: 55 * fontScale,
        right: 20 * fontScale,
        top: 17 * fontScale,
        bottom: 29 * fontScale
      },
      tooltip: {
        trigger: 'axis',
        // Keep the full tooltip inside the chart, away from the panel's overflow clipping.
        confine: true,
        renderMode: 'html',
        className: 'forecast-tooltip',
        padding: [8, 10],
        transitionDuration: 0,
        formatter: (params: unknown) => createTooltip(params, model),
        backgroundColor: 'rgba(4, 28, 47, 0.97)',
        borderColor: '#17658a',
        textStyle: { color: '#dce9f1', fontSize: 10 * fontScale },
        axisPointer: { type: 'line', lineStyle: { color: 'rgba(115, 185, 211, 0.45)' } }
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: model.dateLabels,
        axisLine: { lineStyle: { color: 'rgba(137, 154, 169, 0.48)' } },
        axisTick: { show: false },
        axisLabel: {
          interval: 0,
          hideOverlap: true,
          color: '#aaaeb5',
          fontSize: 9 * fontScale,
          formatter: (value: string, index: number) => (visibleLabelIndexes.has(index) ? value : '')
        },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        name: '状态指数 (%)',
        min: 0,
        max: 100,
        interval: 20,
        nameTextStyle: { color: '#b0b5bc', fontSize: 9 * fontScale, padding: [0, 0, 0, 1] },
        axisLine: { show: true, lineStyle: { color: 'rgba(137, 154, 169, 0.48)' } },
        axisTick: { show: false },
        axisLabel: { color: '#aaaeb5', fontSize: 9 * fontScale, formatter: formatMeasurement },
        splitLine: {
          show: true,
          lineStyle: { color: 'rgba(103, 127, 146, 0.2)', type: 'dashed' }
        }
      },
      series: [
        {
          name: '风险阈值',
          type: 'line',
          data: Array.from({ length: FORECAST_DAY_COUNT }, () => FORECAST_RISK_THRESHOLD),
          symbol: 'none',
          silent: true,
          tooltip: { show: false },
          lineStyle: { color: 'rgba(255, 112, 86, 0.62)', width: 1.2, type: 'dashed' },
          z: 1
        },
        ...model.forecasts.map((device) => {
          const isRiskDevice = model.activeRisk?.deviceId === device.id
          return {
            name: device.name,
            type: 'line' as const,
            data: device.values,
            showSymbol: false,
            symbol: 'circle',
            symbolSize: 4,
            smooth: false,
            lineStyle: {
              color: device.color,
              width: isRiskDevice ? 2.5 : 1.7,
              shadowColor: isRiskDevice ? `${device.color}70` : 'transparent',
              shadowBlur: isRiskDevice ? 5 : 0
            },
            itemStyle: { color: device.color },
            areaStyle: isRiskDevice ? { color: `${device.color}18`, opacity: 0.7 } : undefined,
            emphasis: { focus: 'series' as const },
            z: isRiskDevice ? 4 : 3
          }
        })
      ]
    }),
    [fontScale, model, visibleLabelIndexes]
  )

  return (
    <section className={`panel chart-panel${embedded ? ' chart-panel--embedded' : ''}`}>
      <div className="panel-heading chart-heading">
        {embedded ? (
          <span className="auxiliary-chart-description">未来 1 个月设备状态</span>
        ) : (
          <h2>AI预测未来 1 个月设备状态</h2>
        )}
        {model.activeRisk && (
          <button className="forecast-risk-trigger" type="button" onClick={onRiskClick}>
            <i aria-hidden="true" />1 项预测风险
          </button>
        )}
      </div>
      <div className="chart-legend chart-legend--devices">
        {model.forecasts.map((device) => (
          <span key={device.id}>
            <i
              className="key key--device"
              style={{ backgroundColor: device.color, color: device.color }}
            />
            {device.name}
          </span>
        ))}
      </div>
      <div className="chart-wrap">
        <EChartCanvas
          option={option}
          ariaLabel="基于PLC实时数据预测的未来一个月四路光伏组件及蓄电池设备状态折线图"
        />
      </div>
    </section>
  )
}
