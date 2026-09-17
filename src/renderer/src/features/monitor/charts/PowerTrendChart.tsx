import { formatMeasurement } from '../../../../../shared/number-format'
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { TelemetrySnapshot } from '../../../../../shared/contracts'
import { formatPowerKW } from '../../../../../shared/power-units'
import {
  createPowerDaySeries,
  getPowerDayStart,
  POWER_HISTORY_DAY_MS,
  type PowerSeriesKey
} from '../../../../../shared/power-history'
import { STATION_TIME_ZONE } from '../../../../../shared/plc-clock'
import { useFontScale } from '../../../settings/fontSize'
import EChartCanvas from './EChartCanvas'
import type { EChartsOption } from './chartRuntime'
import { usePowerHistory } from './usePowerHistory'
import '../styles/charts.css'

const SERIES: Array<{ key: PowerSeriesKey; name: string; color: string }> = [
  { key: 'supply', name: '总供电（光伏＋储能）', color: '#35c8ff' },
  { key: 'photovoltaic', name: '光伏发电功率', color: '#f1c84b' },
  { key: 'storage', name: '储能功率', color: '#a79aff' },
  { key: 'load', name: '总负载功率', color: '#45dcaa' }
]

const POWER_TREND_REFRESH_MS = 30_000

function formatDayTime(elapsed: number): string {
  const minutes = Math.floor(elapsed / 60_000)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function tooltip(params: unknown): string {
  if (!Array.isArray(params)) return ''
  const entries = params as Array<{
    seriesName: string
    color: string
    value: [number, number | null]
  }>
  const available = entries.filter((entry) => typeof entry.value?.[1] === 'number')
  if (available.length === 0) return ''
  return `<strong>${formatDayTime(available[0].value[0])}</strong>${available
    .map(
      (entry) =>
        `<div style="display:flex;justify-content:space-between;gap:18px;margin-top:6px"><span><i style="display:inline-block;width:8px;height:8px;margin-right:6px;background:${entry.color}"></i>${entry.seriesName}</span><strong>${formatPowerKW(entry.value[1])}</strong></div>`
    )
    .join('')}`
}

export default function PowerTrendChart({
  telemetry,
  serviceOrigin,
  connected,
  clock,
  plcClockOffsetMs = 0
}: {
  telemetry?: TelemetrySnapshot
  serviceOrigin: string
  connected: boolean
  clock: Date
  plcClockOffsetMs?: number
}): React.JSX.Element {
  const fontScale = useFontScale()
  const [sample, setSample] = useState(() => ({
    telemetry,
    nowMs: clock.getTime(),
    clockOffsetMs: plcClockOffsetMs
  }))
  const refreshSample = useEffectEvent(() => {
    setSample({ telemetry, nowMs: clock.getTime(), clockOffsetMs: plcClockOffsetMs })
  })
  useEffect(() => {
    const timer = window.setInterval(refreshSample, POWER_TREND_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])
  const dayStartMs = getPowerDayStart(sample.nowMs)
  const { points, loading, error, retry } = usePowerHistory({
    telemetry: sample.telemetry,
    serviceOrigin,
    connected,
    dayStartMs,
    clockOffsetMs: sample.clockOffsetMs,
    refreshAtMs: sample.nowMs
  })
  const [hidden, setHidden] = useState<PowerSeriesKey[]>([])
  const [expanded, setExpanded] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dateLabel = new Intl.DateTimeFormat('zh-CN', {
    timeZone: STATION_TIME_ZONE,
    month: '2-digit',
    day: '2-digit'
  }).format(sample.nowMs)
  const dailySeries = useMemo(
    () =>
      SERIES.map((series) => ({
        ...series,
        data: createPowerDaySeries(
          points,
          dayStartMs,
          sample.clockOffsetMs,
          sample.nowMs,
          series.key
        )
      })),
    [points, dayStartMs, sample.clockOffsetMs, sample.nowMs]
  )
  const hasData = dailySeries.some((series) => series.data.some((point) => point[1] !== null))
  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      textStyle: {
        color: '#aeb3ba',
        fontSize: 12 * fontScale,
        fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
      },
      grid: {
        left: 68 * fontScale,
        right: 28 * fontScale,
        top: 26 * fontScale,
        bottom: 30 * fontScale
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        formatter: tooltip,
        backgroundColor: 'rgba(4, 28, 47, 0.97)',
        borderColor: '#17658a',
        textStyle: { color: '#dce9f1', fontSize: 11 * fontScale },
        axisPointer: { type: 'line', lineStyle: { color: 'rgba(55, 202, 244, 0.45)' } }
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: POWER_HISTORY_DAY_MS,
        interval: POWER_HISTORY_DAY_MS / 6,
        axisLine: { lineStyle: { color: 'rgba(137, 154, 169, 0.48)' } },
        axisTick: { show: false },
        axisLabel: { formatter: formatDayTime, hideOverlap: true, fontSize: 10 * fontScale },
        splitLine: { show: false }
      },
      yAxis: {
        type: 'value',
        name: '功率 (kW)',
        min: ({ min }) => Math.min(0, min),
        max: hasData ? undefined : 10,
        splitNumber: 4,
        nameTextStyle: { color: '#b0b5bc', fontSize: 10 * fontScale },
        axisLabel: { color: '#aaaeb5', fontSize: 10 * fontScale, formatter: formatMeasurement },
        axisTick: { show: false },
        axisLine: { show: true, lineStyle: { color: 'rgba(137, 154, 169, 0.48)' } },
        splitLine: { lineStyle: { color: 'rgba(103, 127, 146, 0.2)', type: 'dashed' } }
      },
      series: dailySeries
        .filter((series) => !hidden.includes(series.key))
        .map((series) => ({
          name: series.name,
          type: 'line',
          data: series.data,
          connectNulls: false,
          showSymbol: true,
          symbol: 'circle',
          symbolSize: 3,
          lineStyle: {
            color: series.color,
            width: series.key === 'supply' || series.key === 'load' ? 2.4 : 1.6,
            type: series.key === 'load' ? 'dashed' : 'solid'
          },
          itemStyle: { color: series.color },
          emphasis: { focus: 'series' }
        }))
    }),
    [dailySeries, fontScale, hasData, hidden]
  )

  useEffect(() => {
    if (expanded) dialogRef.current?.showModal()
    else dialogRef.current?.close()
  }, [expanded])

  const content = (large = false): React.JSX.Element => (
    <section className="panel chart-panel power-chart-panel">
      <div className="panel-heading chart-heading">
        <h2>源-网-荷-储曲线</h2>
        <button className="chart-action" type="button" onClick={() => setExpanded(!large)}>
          {large ? '关闭' : '展开查看'}
        </button>
      </div>
      <div className="power-chart-meta">
        <span>今日 {dateLabel} · 00:00–24:00</span>
        {error ? (
          <button type="button" onClick={retry}>
            历史读取失败 · 重试
          </button>
        ) : (
          <span>
            {loading
              ? '读取历史中…'
              : !connected || telemetry?.plcConnected !== true
                ? '采集已断开'
                : '每 30 秒更新'}
          </span>
        )}
      </div>
      <div className="chart-legend chart-legend--power" aria-label="功率曲线图例">
        {SERIES.map((series) => (
          <button
            key={series.key}
            type="button"
            aria-pressed={!hidden.includes(series.key)}
            onClick={() =>
              setHidden((current) =>
                current.includes(series.key)
                  ? current.filter((key) => key !== series.key)
                  : [...current, series.key]
              )
            }
          >
            <i
              className={`key${series.key === 'load' ? ' key--power-load' : ''}`}
              style={{ color: series.color, backgroundColor: series.color }}
            />
            {series.name}
          </button>
        ))}
        <span className="power-chart-grid-power" title="暂无电网功率数据">
          <i className="key" aria-hidden="true" />
          电网功率 {formatPowerKW(undefined)}
        </span>
      </div>
      <div className="chart-wrap">
        <EChartCanvas
          option={option}
          ariaLabel="当天00时至24时总供电、光伏发电、储能功率和总负载功率折线图，单位千瓦"
        />
        {!loading && !hasData && <div className="power-chart-empty">今日暂无功率数据</div>}
      </div>
      {/* <div className="power-chart-note">储能：充电为正，放电为负 · 未采集时段留空</div> */}
    </section>
  )

  return (
    <>
      {content()}
      <dialog
        ref={dialogRef}
        className="power-chart-dialog"
        aria-label="展开源-网-荷-储曲线"
        onCancel={() => setExpanded(false)}
        onClose={() => setExpanded(false)}
      >
        {expanded && content(true)}
      </dialog>
    </>
  )
}
