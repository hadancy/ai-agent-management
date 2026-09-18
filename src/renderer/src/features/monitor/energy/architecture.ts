import type { PlcPowerValues } from '../../../../../shared/plc'

export type EnergyArchitecture = 'traditional' | 'direct'

export const STORAGE_RATED_POWER_KW = 1

// The traditional diagram is a fixed comparison example, independent of PLC readings.
export const TRADITIONAL_POWERS: Readonly<PlcPowerValues> = {
  photovoltaicPower: 5,
  storagePower: STORAGE_RATED_POWER_KW,
  primaryLoadPower: 0.5,
  secondaryLoadPower: 1.5,
  tertiaryLoadPower: 3,
  totalLoadPower: 5,
  renewableSupplyPower: 6
}

export const ENERGY_ARCHITECTURES = {
  traditional: {
    title: '传统交流模式架构图',
    caption: '光伏逆变 · 交流配电 · 负载侧变换',
    efficiency: '综合效率91.20%',
    speech: '经过逆变器、交流配电、负载侧AC/DC变换后，综合效率约为91.2%，此部分建议优化'
  },
  direct: {
    title: '光储直柔模式架构图',
    caption: '光 · 储 · 直 · 柔协同拓扑',
    efficiency: '综合变换效率约97.00%',
    speech:
      '光伏直流电经DC/DC变换直接供给直流负载，综合变换效率约为97%，较传统模式提升约5~6个百分点'
  }
} as const

export const ARCHITECTURE_UPGRADE_MS = 1400
