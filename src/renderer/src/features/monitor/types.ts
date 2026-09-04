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

export type DeviceRiskSource = 'realtime' | 'prediction'

export type DeviceRiskAlarm = {
  id: string
  source: DeviceRiskSource
  sourceLabel: string
  deviceName: string
  message: string
  detail: string
  voltage: number
  current: number
  statusIndex?: number
  monthEndSummary?: string
}
