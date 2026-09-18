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
  const storagePower = available ? telemetry?.powers?.storagePower : undefined
  const storage =
    storagePower !== undefined && Number.isFinite(storagePower) ? storagePower : undefined
  const photovoltaicPower = available ? telemetry?.powers?.photovoltaicPower : undefined
  // MW112 is negative while charging and positive while discharging.
  // Add the signed reading to PV power to get net renewable supply.
  const supply =
    photovoltaicPower !== undefined && Number.isFinite(photovoltaicPower) && storage !== undefined
      ? photovoltaicPower + storage
      : undefined
  return {
    photovoltaic: [1, 2, 3, 4].map((index) => calculatedPower(`pv-${index}`)),
    storage,
    powers: available ? { ...telemetry?.powers, renewableSupplyPower: supply } : {}
  }
}
