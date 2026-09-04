import { useMemo } from 'react'
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
      const measurements =
        device?.voltageValues && device.currentValues
          ? `<small style="display:block;text-align:right;color:#9eb4c3">${device.voltageValues[dataIndex]} V / ${device.currentValues[dataIndex]} A</small>`
          : ''
      return `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:22px;margin-top:5px"><span><i style="display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:${color}"></i>${seriesName}</span><span><strong>${value}%</strong>${measurements}</span></div>`
    })
    .join('')

  return `<div style="min-width:220px"><strong>${entries[0]?.axisValue ?? ''}</strong>${rows}</div>`
}

export default function ForecastChart({
  model,
  onRiskClick
}: {
  model: ForecastModel
  onRiskClick: () => void
}): React.JSX.Element {
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
        fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
      },
      grid: { left: 45, right: 20, top: 17, bottom: 29 },
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => createTooltip(params, model),
        backgroundColor: 'rgba(4, 28, 47, 0.97)',
        borderColor: '#17658a',
        textStyle: { color: '#dce9f1', fontSize: 10 },
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
          fontSize: 9,
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
        nameTextStyle: { color: '#b0b5bc', fontSize: 9, padding: [0, 0, 0, 1] },
        axisLine: { show: true, lineStyle: { color: 'rgba(137, 154, 169, 0.48)' } },
        axisTick: { show: false },
        axisLabel: { color: '#aaaeb5', fontSize: 9 },
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
    [model, visibleLabelIndexes]
  )

  return (
    <section className="panel chart-panel">
      <div className="panel-heading chart-heading">
        <h2>AI预测未来 1 个月设备状态</h2>
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
