import type { RealtimeDeviceSeries } from '../types'

export const REALTIME_POINT_COUNT = 48
export const REALTIME_LABEL_INDEXES = [0, 9, 19, 28, 38, 47]

type RealtimePreset = {
  id: RealtimeDeviceSeries['id']
  name: string
  color: string
  voltage: number
  voltageSwing: number
  current: number
  currentSwing: number
  phase: number
}

const REALTIME_PRESETS: RealtimePreset[] = [
  {
    id: 'pv1',
    name: '1号光伏',
    color: '#ff655c',
    voltage: 512.8,
    voltageSwing: 1.45,
    current: 6.38,
    currentSwing: 0.09,
    phase: 0.2
  },
  {
    id: 'pv2',
    name: '2号光伏',
    color: '#35c8ff',
    voltage: 512.6,
    voltageSwing: 1.2,
    current: 6.35,
    currentSwing: 0.08,
    phase: 0.85
  },
  {
    id: 'pv3',
    name: '3号光伏',
    color: '#8c8dff',
    voltage: 510.8,
    voltageSwing: 1.35,
    current: 6.32,
    currentSwing: 0.07,
    phase: 1.45
  },
  {
    id: 'pv4',
    name: '4号光伏',
    color: '#45dc8a',
    voltage: 514.1,
    voltageSwing: 1.1,
    current: 6.4,
    currentSwing: 0.08,
    phase: 2.1
  },
  {
    id: 'battery',
    name: '蓄电池',
    color: '#f1c84b',
    voltage: 51.8,
    voltageSwing: 0.18,
    current: 4.72,
    currentSwing: 0.16,
    phase: 2.7
  }
]

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function createSeries(center: number, swing: number, phase: number, digits: number): number[] {
  return Array.from({ length: REALTIME_POINT_COUNT }, (_, index) =>
    round(
      center +
        Math.sin(index * 0.52 + phase) * swing * 0.68 +
        Math.cos(index * 0.19 + phase * 0.7) * swing * 0.32,
      digits
    )
  )
}

export const REALTIME_DEVICE_SERIES: RealtimeDeviceSeries[] = REALTIME_PRESETS.map((preset) => ({
  id: preset.id,
  name: preset.name,
  color: preset.color,
  voltageValues: createSeries(
    preset.voltage,
    preset.voltageSwing,
    preset.phase,
    preset.id === 'battery' ? 2 : 1
  ),
  currentValues: createSeries(preset.current, preset.currentSwing, preset.phase + 0.5, 2)
}))
