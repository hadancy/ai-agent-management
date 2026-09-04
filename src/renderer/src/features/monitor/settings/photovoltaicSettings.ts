import type { StringMetric } from '../types'

export type PhotovoltaicSettings = {
  normalVoltage: number
  normalCurrent: number
  tolerancePercent: number
}

export type PhotovoltaicOperatingState = 'normal' | 'disconnected' | 'low'

export const PHOTOVOLTAIC_SETTINGS_STORAGE_KEY = 'photovoltaic-normal-settings-v2'

export const DEFAULT_PHOTOVOLTAIC_SETTINGS: PhotovoltaicSettings = {
  normalVoltage: 613,
  normalCurrent: 9.4,
  tolerancePercent: 10
}

export function loadPhotovoltaicSettings(): PhotovoltaicSettings {
  try {
    const stored = window.localStorage.getItem(PHOTOVOLTAIC_SETTINGS_STORAGE_KEY)
    if (!stored) return DEFAULT_PHOTOVOLTAIC_SETTINGS
    const parsed = JSON.parse(stored) as Partial<PhotovoltaicSettings>
    if (
      typeof parsed.normalVoltage !== 'number' ||
      parsed.normalVoltage <= 0 ||
      typeof parsed.normalCurrent !== 'number' ||
      parsed.normalCurrent <= 0 ||
      typeof parsed.tolerancePercent !== 'number' ||
      parsed.tolerancePercent < 0 ||
      parsed.tolerancePercent >= 100
    ) {
      return DEFAULT_PHOTOVOLTAIC_SETTINGS
    }
    return {
      normalVoltage: parsed.normalVoltage,
      normalCurrent: parsed.normalCurrent,
      tolerancePercent: parsed.tolerancePercent
    }
  } catch {
    return DEFAULT_PHOTOVOLTAIC_SETTINGS
  }
}

export function savePhotovoltaicSettings(settings: PhotovoltaicSettings): void {
  window.localStorage.setItem(PHOTOVOLTAIC_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

export function getNormalRange(normalValue: number, tolerancePercent: number): [number, number] {
  const tolerance = normalValue * (tolerancePercent / 100)
  return [normalValue - tolerance, normalValue + tolerance]
}

export function isPhotovoltaicMetricNormal(
  metric: StringMetric,
  settings: PhotovoltaicSettings
): boolean {
  const [minimumVoltage, maximumVoltage] = getNormalRange(
    settings.normalVoltage,
    settings.tolerancePercent
  )
  const [minimumCurrent, maximumCurrent] = getNormalRange(
    settings.normalCurrent,
    settings.tolerancePercent
  )
  return (
    metric.voltage >= minimumVoltage &&
    metric.voltage <= maximumVoltage &&
    metric.current >= minimumCurrent &&
    metric.current <= maximumCurrent
  )
}

export function getPhotovoltaicOperatingState(
  metric: StringMetric,
  settings: PhotovoltaicSettings,
  plcConnected: boolean
): PhotovoltaicOperatingState {
  if (!plcConnected || metric.voltage === 0 || metric.current === 0) return 'disconnected'
  return isPhotovoltaicMetricNormal(metric, settings) ? 'normal' : 'low'
}

export function getSharedPhotovoltaicRouteState(
  states: PhotovoltaicOperatingState[]
): PhotovoltaicOperatingState {
  if (states.length === 0 || states.every((state) => state === 'disconnected'))
    return 'disconnected'
  return 'normal'
}
