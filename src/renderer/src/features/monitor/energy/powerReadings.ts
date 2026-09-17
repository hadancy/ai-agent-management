import type { TelemetrySnapshot } from '../../../../../shared/contracts'
import type { PlcPowerValues } from '../../../../../shared/plc'
import { calculatePowerKW } from '../../../../../shared/power-units'

export { formatPowerKW as formatPower } from '../../../../../shared/power-units'

export function getEnergyPowerReadings(
  telemetry?: TelemetrySnapshot,
  online = true
): {
  photovoltaic: Array<number | undefined>
  storage: number | undefined
  powers: Partial<PlcPowerValues>
} {
  const available = online && telemetry?.plcConnected === true
  const calculatedPower = (id: string): number | undefined => {
    const device = telemetry?.devices.find((item) => item.id === id)
    if (!available || !device || device.status === 'offline') return undefined
    const power = calculatePowerKW(device.voltage, device.current)
    return Number.isFinite(power) ? power : undefined
  }
  const storage = calculatedPower(
    telemetry?.devices.find((device) => device.kind === 'battery')?.id ?? 'battery-1'
  )
  const photovoltaicPower = available ? telemetry?.powers?.photovoltaicPower : undefined
  // PLC storage power is positive while charging and negative while discharging.
  // Keep that sign on the storage card; subtract it to get net renewable supply.
  const supply =
    photovoltaicPower !== undefined && Number.isFinite(photovoltaicPower) && storage !== undefined
      ? photovoltaicPower - storage
      : undefined
  return {
    photovoltaic: [1, 2, 3, 4].map((index) => calculatedPower(`pv-${index}`)),
    storage,
    powers: available ? { ...telemetry?.powers, renewableSupplyPower: supply } : {}
  }
}
