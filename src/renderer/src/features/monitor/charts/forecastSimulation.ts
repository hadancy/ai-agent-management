import type { TelemetrySnapshot } from '../../../../../shared/contracts'
import type { PhotovoltaicSettings } from '../settings/photovoltaicSettings'
import type { DeviceForecast, ForecastDeviceId, ForecastRisk } from '../types'

export const FORECAST_DAY_COUNT = 30
export const FORECAST_RISK_THRESHOLD = 80
const DEMO_FAULT_MONTHLY_DROP_RATIO = 0.2
const BATTERY_NORMAL_VOLTAGE = 52
const BATTERY_NORMAL_CURRENT = 5
const BATTERY_TOLERANCE_PERCENT = 10

export type ForecastModel = {
  dates: Date[]
  dateLabels: string[]
  forecasts: DeviceForecast[]
  activeRisk: ForecastRisk | null
  sourceSampleCount: number
}

const DEVICE_DEFINITIONS: Array<{
  id: ForecastDeviceId
  telemetryId: string
  name: string
  color: string
  maximumMonthlyChangeRatio: number
}> = [
  {
    id: 'pv1',
    telemetryId: 'pv-1',
    name: '1号光伏',
    color: '#ff655c',
    maximumMonthlyChangeRatio: 0.3
  },
  {
    id: 'pv2',
    telemetryId: 'pv-2',
    name: '2号光伏',
    color: '#35c8ff',
    maximumMonthlyChangeRatio: 0.3
  },
  {
    id: 'pv3',
    telemetryId: 'pv-3',
    name: '3号光伏',
    color: '#8c8dff',
    maximumMonthlyChangeRatio: 0.3
  },
  {
    id: 'pv4',
    telemetryId: 'pv-4',
    name: '4号光伏',
    color: '#45dc8a',
    maximumMonthlyChangeRatio: 0.3
  },
  {
    id: 'battery',
    telemetryId: 'battery-1',
    name: '蓄电池',
    color: '#f1c84b',
    maximumMonthlyChangeRatio: 0.2
  }
]

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function formatDate(date: Date, includeYear = false): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return includeYear ? `${date.getFullYear()}-${month}-${day}` : `${month}-${day}`
}

function createForecastDates(history: TelemetrySnapshot[]): Date[] {
  const latest = history.at(-1)
  const sourceTimestamp = latest?.plcClock?.timestamp ?? latest?.timestamp
  const sourceDate = sourceTimestamp ? new Date(sourceTimestamp) : new Date()
  const baseDate = Number.isNaN(sourceDate.getTime()) ? new Date() : sourceDate

  return Array.from({ length: FORECAST_DAY_COUNT }, (_, index) => {
    const date = new Date(baseDate)
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() + index + 1)
    return date
  })
}

function linearSlope(values: number[]): number {
  if (values.length < 2) return 0
  const xMean = (values.length - 1) / 2
  const yMean = values.reduce((sum, value) => sum + value, 0) / values.length
  let numerator = 0
  let denominator = 0

  values.forEach((value, index) => {
    const centeredX = index - xMean
    numerator += centeredX * (value - yMean)
    denominator += centeredX ** 2
  })
  return denominator === 0 ? 0 : numerator / denominator
}

function createMeasurementForecast(
  values: number[],
  maximumChangeRatio: number,
  forceFaultDecline: boolean
): number[] {
  const recentValues = values.slice(-12)
  const latest = recentValues.at(-1) ?? 0
  if (Math.abs(latest) < Number.EPSILON) {
    return Array.from({ length: FORECAST_DAY_COUNT }, () => round(latest, 2))
  }

  let rawMonthlyChange = linearSlope(recentValues) * FORECAST_DAY_COUNT
  const demoFaultChange = -Math.abs(latest) * DEMO_FAULT_MONTHLY_DROP_RATIO
  if (forceFaultDecline && rawMonthlyChange > demoFaultChange) {
    rawMonthlyChange = demoFaultChange
  }
  const maximumChange = Math.abs(latest) * maximumChangeRatio
  const monthlyChange = clamp(rawMonthlyChange, -maximumChange, maximumChange)

  return Array.from({ length: FORECAST_DAY_COUNT }, (_, index) =>
    round(latest + (monthlyChange * (index + 1)) / FORECAST_DAY_COUNT, 2)
  )
}

function createStatusForecast(
  voltageValues: number[],
  currentValues: number[],
  latestVoltage: number,
  latestCurrent: number,
  normalVoltage: number,
  normalCurrent: number
): number[] {
  if (Math.abs(latestVoltage) < Number.EPSILON && Math.abs(latestCurrent) < Number.EPSILON) {
    return Array.from({ length: FORECAST_DAY_COUNT }, () => 100)
  }
  const voltageBaseline = Math.max(Math.abs(normalVoltage), 0.001)
  const currentBaseline = Math.max(Math.abs(normalCurrent), 0.001)

  return voltageValues.map((voltage, index) => {
    const voltageRatio = Math.abs(voltage) / voltageBaseline
    const currentRatio = Math.abs(currentValues[index]) / currentBaseline
    const outputRatio = voltageRatio * 0.6 + currentRatio * 0.4
    return round(clamp(outputRatio * 100, 0, 100))
  })
}

function findForecastRisk(
  forecasts: DeviceForecast[],
  dates: Date[],
  dateLabels: string[]
): ForecastRisk | null {
  let earliestRisk: { device: DeviceForecast; index: number } | undefined

  for (const device of forecasts) {
    const index = device.values.findIndex((value) => value < FORECAST_RISK_THRESHOLD)
    if (index >= 0 && (!earliestRisk || index < earliestRisk.index))
      earliestRisk = { device, index }
  }
  if (!earliestRisk) return null

  const { device, index } = earliestRisk
  if (!device.voltageValues || !device.currentValues) return null
  const monthEndIndex = FORECAST_DAY_COUNT - 1
  return {
    deviceId: device.id,
    deviceName: device.id === 'battery' ? '蓄电池组' : `${device.name}组件`,
    riskDate: formatDate(dates[index], true),
    riskDateLabel: dateLabels[index],
    riskValue: device.values[index],
    projectedVoltage: device.voltageValues[index],
    projectedCurrent: device.currentValues[index],
    monthEndValue: device.values[monthEndIndex],
    monthEndVoltage: device.voltageValues[monthEndIndex],
    monthEndCurrent: device.currentValues[monthEndIndex]
  }
}

export function createForecastModel(
  history: TelemetrySnapshot[],
  photovoltaicSettings: PhotovoltaicSettings
): ForecastModel {
  const dates = createForecastDates(history)
  const dateLabels = dates.map((date) => formatDate(date))
  const forecasts = DEVICE_DEFINITIONS.map((definition): DeviceForecast => {
    const measurements = history
      .map((snapshot) => snapshot.devices.find((device) => device.id === definition.telemetryId))
      .filter((device) => device !== undefined)
    const voltageHistory = measurements.map((device) => device.voltage)
    const currentHistory = measurements.map((device) => device.current)
    const latestVoltage = voltageHistory.at(-1) ?? 0
    const latestCurrent = currentHistory.at(-1) ?? 0
    const normalVoltage =
      definition.id === 'battery' ? BATTERY_NORMAL_VOLTAGE : photovoltaicSettings.normalVoltage
    const normalCurrent =
      definition.id === 'battery' ? BATTERY_NORMAL_CURRENT : photovoltaicSettings.normalCurrent
    const tolerancePercent =
      definition.id === 'battery'
        ? BATTERY_TOLERANCE_PERCENT
        : photovoltaicSettings.tolerancePercent
    const minimumVoltage = normalVoltage * (1 - tolerancePercent / 100)
    const minimumCurrent = normalCurrent * (1 - tolerancePercent / 100)
    const forceFaultDecline =
      latestVoltage > 0 &&
      latestCurrent > 0 &&
      (latestVoltage < minimumVoltage || latestCurrent < minimumCurrent)
    const voltageValues = createMeasurementForecast(
      voltageHistory,
      definition.maximumMonthlyChangeRatio,
      forceFaultDecline
    )
    const currentValues = createMeasurementForecast(
      currentHistory,
      definition.maximumMonthlyChangeRatio,
      forceFaultDecline
    )

    return {
      id: definition.id,
      name: definition.name,
      color: definition.color,
      values: createStatusForecast(
        voltageValues,
        currentValues,
        latestVoltage,
        latestCurrent,
        normalVoltage,
        normalCurrent
      ),
      voltageValues,
      currentValues
    }
  })

  return {
    dates,
    dateLabels,
    forecasts,
    activeRisk: findForecastRisk(forecasts, dates, dateLabels),
    sourceSampleCount: history.length
  }
}
