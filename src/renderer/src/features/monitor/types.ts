export type ConsoleNav = '首页' | '综合监控' | '智诊精巡' | '工单中心' | '设置中心'
export type MonitorSection = 'energy' | 'forecast'

export type StringMetric = {
  name: string
  voltage: number
  current: number
}

export type ForecastDeviceId = 'pv1' | 'pv2' | 'pv3' | 'pv4' | 'battery'

export type RealtimeDeviceSeries = {
  id: ForecastDeviceId
  name: string
  color: string
  voltageValues: number[]
  currentValues: number[]
}

export type DeviceForecast = {
  id: ForecastDeviceId
  name: string
  color: string
  values: number[]
  voltageValues?: number[]
  currentValues?: number[]
}

export type ForecastRisk = {
  deviceId: ForecastDeviceId
  deviceName: string
  riskDate: string
  riskDateLabel: string
  riskValue: number
  projectedVoltage: number
  projectedCurrent: number
  monthEndValue: number
  monthEndVoltage: number
  monthEndCurrent: number
}

export type DeviceRiskAlarm = {
  id: string
  message: string
  normalRangeDescription: string
  devices: Array<{
    id: string
    name: string
    realtime?: StringMetric
    prediction?: ForecastRisk
  }>
}
