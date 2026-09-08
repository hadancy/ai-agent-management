import type { DeviceRiskAlarm, ForecastRisk, StringMetric } from '../types'
import {
  getNormalRange,
  isPhotovoltaicMetricNormal,
  type PhotovoltaicSettings
} from '../settings/photovoltaicSettings'

export function detectDeviceRisk(
  metrics: StringMetric[],
  settings: PhotovoltaicSettings,
  prediction: ForecastRisk | null
): DeviceRiskAlarm | null {
  const devices: DeviceRiskAlarm['devices'] = metrics
    .filter((metric) => !isPhotovoltaicMetricNormal(metric, settings))
    .map((metric) => {
      const number = metric.name.match(/\d+/)?.[0] ?? '1'
      return { id: `pv${number}`, name: `${number}号光伏组件`, realtime: metric }
    })

  if (prediction) {
    const device = devices.find((item) => item.id === prediction.deviceId)
    if (device) device.prediction = prediction
    else devices.push({ id: prediction.deviceId, name: prediction.deviceName, prediction })
  }
  if (devices.length === 0) return null

  const [minimumVoltage, maximumVoltage] = getNormalRange(
    settings.normalVoltage,
    settings.tolerancePercent
  )
  const [minimumCurrent, maximumCurrent] = getNormalRange(
    settings.normalCurrent,
    settings.tolerancePercent
  )
  return {
    // Keep one identity throughout an incident, even as sources, devices or dates change.
    id: 'device-risk',
    message: `警告！检测到${devices.map((device) => device.name).join('、')}存在运行异常或预测风险，请立即查看处理。`,
    normalRangeDescription: `正常区间：电压 ${minimumVoltage.toFixed(1)}–${maximumVoltage.toFixed(1)} V / 电流 ${minimumCurrent.toFixed(2)}–${maximumCurrent.toFixed(2)} A。`,
    devices
  }
}
