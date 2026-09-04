import type { DeviceRiskAlarm, ForecastRisk, StringMetric } from '../types'
import {
  getNormalRange,
  isPhotovoltaicMetricNormal,
  type PhotovoltaicSettings
} from '../settings/photovoltaicSettings'

function componentNumber(name: string): string {
  return name.match(/\d+/)?.[0] ?? '1'
}

function alarmMessage(number: string): string {
  return `警告！检测到组件${number}电压电流有下降趋势，请立即查看处理。`
}

export function detectRealtimeRisk(
  metrics: StringMetric[],
  settings: PhotovoltaicSettings
): DeviceRiskAlarm | null {
  const riskMetric = metrics.find((metric) => !isPhotovoltaicMetricNormal(metric, settings))
  if (!riskMetric) return null

  const number = componentNumber(riskMetric.name)
  const [minimumVoltage, maximumVoltage] = getNormalRange(
    settings.normalVoltage,
    settings.tolerancePercent
  )
  const [minimumCurrent, maximumCurrent] = getNormalRange(
    settings.normalCurrent,
    settings.tolerancePercent
  )
  return {
    id: `realtime-pv${number}`,
    source: 'realtime',
    sourceLabel: '实时采集报警',
    deviceName: `${number}号光伏组件`,
    message: alarmMessage(number),
    detail: `实时采集值超出设置中心配置的正常区间（电压 ${minimumVoltage.toFixed(1)}–${maximumVoltage.toFixed(1)} V / 电流 ${minimumCurrent.toFixed(2)}–${maximumCurrent.toFixed(2)} A），请检查组件及支路连接。`,
    voltage: riskMetric.voltage,
    current: riskMetric.current
  }
}

export function createPredictionRiskAlarm(risk: ForecastRisk | null): DeviceRiskAlarm | null {
  if (!risk) return null

  const number = componentNumber(risk.deviceName)
  return {
    id: `prediction-${risk.deviceId}-${risk.riskDate}`,
    source: 'prediction',
    sourceLabel: 'AI 预测报警',
    deviceName: risk.deviceName,
    message: alarmMessage(number),
    detail: `根据 PLC 近期运行数据和趋势预测模型，预计 ${risk.riskDate} 进入风险区间，疑似组件输出衰减或支路故障。`,
    voltage: risk.projectedVoltage,
    current: risk.projectedCurrent,
    statusIndex: risk.riskValue,
    monthEndSummary: `月末预计：状态指数 ${risk.monthEndValue}% · 电压 ${risk.monthEndVoltage} V · 电流 ${risk.monthEndCurrent} A`
  }
}
