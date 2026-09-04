import { useMemo } from 'react'
import type { TelemetrySnapshot } from '../../../../../shared/contracts'
import EChartCanvas from './EChartCanvas'
import type { EChartsOption } from './chartRuntime'
import type { RealtimeDeviceSeries } from '../types'
import '../styles/charts.css'

const DEVICE_PRESENTATION: Array<{
  id: RealtimeDeviceSeries['id']
  telemetryId: string
  name: string
  color: string
}> = [
  { id: 'pv1', telemetryId: 'pv-1', name: '1号光伏', color: '#ff655c' },
  { id: 'pv2', telemetryId: 'pv-2', name: '2号光伏', color: '#35c8ff' },
  { id: 'pv3', telemetryId: 'pv-3', name: '3号光伏', color: '#8c8dff' },
  { id: 'pv4', telemetryId: 'pv-4', name: '4号光伏', color: '#45dc8a' },
  { id: 'battery', telemetryId: 'battery-1', name: '蓄电池', color: '#f1c84b' }
]

type TooltipEntry = {
  axisValue?: string
  dataIndex?: number
}

function createRealtimeTooltip(params: unknown, devices: RealtimeDeviceSeries[]): string {
  if (!Array.isArray(params) || params.length === 0) return ''

  const dataIndex = (params[0] as TooltipEntry).dataIndex ?? 0
  const axisValue = (params[0] as TooltipEntry).axisValue ?? ''
  const rows = devices
    .map(
      (device) =>
        `<div style="display:grid;grid-template-columns:64px 1fr;gap:12px;margin-top:5px"><span><i style="display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:${device.color}"></i>${device.name}</span><strong style="text-align:right">${device.voltageValues[dataIndex]?.toFixed(2) ?? '--'} V / ${device.currentValues[dataIndex]?.toFixed(2) ?? '--'} A</strong></div>`
    )
    .join('')

  return `<div style="min-width:218px"><strong>${axisValue}</strong>${rows}</div>`
}

function formatTime(timestampMs: number): string {
  if (!Number.isFinite(timestampMs)) return '--:--:--'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(timestampMs))
}

function createPlcAlignedLabels(history: TelemetrySnapshot[], plcClockOffsetMs?: number): string[] {
  return history.map((snapshot) => {
    const capturedAtMs = Date.parse(snapshot.timestamp)
    return formatTime(capturedAtMs + (plcClockOffsetMs ?? 0))
  })
}

function createAxisLabelIndexes(labelCount: number, maximumVisible = 6): Set<number> {
  if (labelCount <= maximumVisible) {
    return new Set(Array.from({ length: labelCount }, (_, index) => index))
  }

  return new Set(
    Array.from({ length: maximumVisible }, (_, index) =>
      Math.round((index * (labelCount - 1)) / (maximumVisible - 1))
    )
  )
}

function roundedAxisMaximum(values: number[], minimum: number): number {
  const maximum = Math.max(minimum, ...values)
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(maximum)) - 1)
  return Math.ceil((maximum * 1.1) / magnitude) * magnitude
}

export default function RealtimeChart({
  history,
  plcClockOffsetMs
}: {
  history: TelemetrySnapshot[]
  plcClockOffsetMs?: number
}): React.JSX.Element {
  const labels = useMemo(
    () => createPlcAlignedLabels(history, plcClockOffsetMs),
    [history, plcClockOffsetMs]
  )
  const visibleLabelIndexes = useMemo(() => createAxisLabelIndexes(labels.length), [labels.length])
  const deviceSeries = useMemo<RealtimeDeviceSeries[]>(
    () =>
      DEVICE_PRESENTATION.map((presentation) => ({
        id: presentation.id,
        name: presentation.name,
        color: presentation.color,
        voltageValues: history.map(
          (snapshot) =>
            snapshot.devices.find((device) => device.id === presentation.telemetryId)?.voltage ?? 0
        ),
        currentValues: history.map(
          (snapshot) =>
            snapshot.devices.find((device) => device.id === presentation.telemetryId)?.current ?? 0
        )
      })),
    [history]
  )
  const voltageMaximum = roundedAxisMaximum(
    deviceSeries.flatMap((device) => device.voltageValues),
    10
  )
  const currentMaximum = roundedAxisMaximum(
    deviceSeries.flatMap((device) => device.currentValues),
    10
  )

  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      textStyle: {
        color: '#aeb3ba',
        fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
      },
      grid: { left: 47, right: 43, top: 21, bottom: 29 },
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => createRealtimeTooltip(params, deviceSeries),
        backgroundColor: 'rgba(4, 28, 47, 0.97)',
        borderColor: '#17658a',
        textStyle: { color: '#dce9f1', fontSize: 10 },
        axisPointer: { type: 'line', lineStyle: { color: 'rgba(55, 202, 244, 0.45)' } }
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLine: { lineStyle: { color: 'rgba(137, 154, 169, 0.48)' } },
        axisTick: { show: false },
        axisLabel: {
          interval: 0,
          hideOverlap: true,
          color: '#aaaeb5',
          fontSize: 10,
          formatter: (value: string, index: number) => (visibleLabelIndexes.has(index) ? value : '')
        },
        splitLine: { show: false }
      },
      yAxis: [
        {
          type: 'value',
          name: '电压 (V)',
          min: 0,
          max: voltageMaximum,
          interval: voltageMaximum / 4,
          nameTextStyle: { color: '#b0b5bc', fontSize: 10, padding: [0, 0, 0, -8] },
          axisLine: { show: true, lineStyle: { color: 'rgba(137, 154, 169, 0.48)' } },
          axisTick: { show: false },
          axisLabel: { color: '#aaaeb5', fontSize: 10 },
          splitLine: {
            show: true,
            lineStyle: { color: 'rgba(103, 127, 146, 0.2)', type: 'dashed' }
          }
        },
        {
          type: 'value',
          name: '电流 (A)',
          min: 0,
          max: currentMaximum,
          interval: currentMaximum / 5,
          nameTextStyle: { color: '#b0b5bc', fontSize: 10, padding: [0, -5, 0, 0] },
          axisLine: { show: true, lineStyle: { color: 'rgba(137, 154, 169, 0.48)' } },
          axisTick: { show: false },
          axisLabel: { color: '#aaaeb5', fontSize: 10 },
          splitLine: { show: false }
        }
      ],
      series: deviceSeries.flatMap((device) => [
        {
          name: `${device.name}电压`,
          type: 'line' as const,
          data: device.voltageValues,
          symbol: 'none',
          lineStyle: { color: device.color, width: 1.7, opacity: 0.94 },
          emphasis: { focus: 'series' as const }
        },
        {
          name: `${device.name}电流`,
          type: 'line' as const,
          yAxisIndex: 1,
          data: device.currentValues,
          symbol: 'none',
          lineStyle: { color: device.color, width: 1.25, type: 'dashed' as const, opacity: 0.8 },
          emphasis: { focus: 'series' as const }
        }
      ])
    }),
    [currentMaximum, deviceSeries, labels, visibleLabelIndexes, voltageMaximum]
  )

  return (
    <section className="panel chart-panel">
      <div className="panel-heading chart-heading">
        <h2>实时电压 / 电流趋势</h2>
        <select defaultValue="每5秒更新" aria-label="趋势更新时间">
          <option>每5秒更新</option>
        </select>
      </div>
      <div className="chart-legend chart-legend--realtime">
        {deviceSeries.map((device) => (
          <span key={device.id}>
            <i
              className="key key--device"
              style={{ backgroundColor: device.color, color: device.color }}
            />
            {device.name}
          </span>
        ))}
        <span className="chart-line-type">
          <i className="key key--voltage" />
          电压
        </span>
        <span className="chart-line-type">
          <i className="key key--current" />
          电流
        </span>
      </div>
      <div className="chart-wrap">
        <EChartCanvas option={option} ariaLabel="四路光伏组件及蓄电池实时电压和电流双轴折线图" />
      </div>
    </section>
  )
}
