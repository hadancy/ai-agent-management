export interface PlcConnection {
  host: string
  port: number
  unitId: number
  registerAddressOffset: number
}

export const PLC_POINTS = [
  {
    id: 'pv1Voltage',
    label: '1号光伏电压',
    address: '%MW400',
    register: 200,
    unit: 'V',
    type: 'WORD',
    scale: 1000
  },
  {
    id: 'pv1Current',
    label: '1号光伏电流',
    address: '%MW402',
    register: 201,
    unit: 'A',
    type: 'WORD',
    scale: 1000
  },
  {
    id: 'pv2Voltage',
    label: '2号光伏电压',
    address: '%MW404',
    register: 202,
    unit: 'V',
    type: 'WORD',
    scale: 1000
  },
  {
    id: 'pv2Current',
    label: '2号光伏电流',
    address: '%MW406',
    register: 203,
    unit: 'A',
    type: 'WORD',
    scale: 1000
  },
  {
    id: 'pv3Voltage',
    label: '3号光伏电压',
    address: '%MW408',
    register: 204,
    unit: 'V',
    type: 'WORD',
    scale: 1000
  },
  {
    id: 'pv3Current',
    label: '3号光伏电流',
    address: '%MW410',
    register: 205,
    unit: 'A',
    type: 'WORD',
    scale: 1000
  },
  {
    id: 'pv4Voltage',
    label: '4号光伏电压',
    address: '%MW412',
    register: 206,
    unit: 'V',
    type: 'WORD',
    scale: 1000
  },
  {
    id: 'pv4Current',
    label: '4号光伏电流',
    address: '%MW414',
    register: 207,
    unit: 'A',
    type: 'WORD',
    scale: 1000
  },
  {
    id: 'batteryVoltage',
    label: '蓄电池电压',
    address: '%MD500',
    register: 250,
    unit: 'V',
    type: 'REAL',
    scale: 1
  },
  {
    id: 'batteryCurrent',
    label: '蓄电池电流',
    address: '%MD504',
    register: 252,
    unit: 'A',
    type: 'REAL',
    scale: 1
  }
] as const

export type PlcPoint = (typeof PLC_POINTS)[number]
export type PlcPointId = PlcPoint['id']

export function validatePlcPointValue(point: PlcPoint, value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${point.label}必须为有效数值`
  if (point.type === 'WORD') {
    if (value < 0 || value > 65535 / point.scale)
      return `${point.label}必须为 0–${65535 / point.scale} ${point.unit}`
    const raw = value * point.scale
    // Allow binary floating-point noise, but never silently round extra decimal places.
    if (Math.abs(raw - Math.round(raw)) > 1e-8) return `${point.label}最多支持 3 位小数`
  } else if (!Number.isFinite(Math.fround(value))) {
    return `${point.label}必须为有效的32位浮点数`
  }
  return undefined
}

export const PLC_CLOCK_FIELDS = [
  { id: 'year', label: '年', address: '%MW600', min: 1, max: 9999 },
  { id: 'month', label: '月', address: '%MB602', min: 1, max: 12 },
  { id: 'day', label: '日', address: '%MB603', min: 1, max: 31 },
  { id: 'hour', label: '时', address: '%MB604', min: 0, max: 23 },
  { id: 'minute', label: '分', address: '%MB605', min: 0, max: 59 },
  { id: 'second', label: '秒', address: '%MB606', min: 0, max: 59 },
  { id: 'weekday', label: '星期', address: '%MB607', min: 1, max: 7 }
] as const

export type PlcClockValues = Record<(typeof PLC_CLOCK_FIELDS)[number]['id'], number>

export interface PlcReadResponse {
  connection: PlcConnection
  readAt: string
  values: Record<PlcPointId, number | null>
  clock: PlcClockValues
}

export interface PlcWriteRequest {
  connection: PlcConnection
  values?: Partial<Record<PlcPointId, number>>
  clock?: PlcClockValues
}

export interface PlcWriteResult {
  id: PlcPointId | 'clock'
  status: 'verified' | 'mismatch' | 'unknown' | 'rejected' | 'not_written'
  requested: number | PlcClockValues
  actual?: number | PlcClockValues | null
  message: string
}

export interface PlcWriteResponse {
  ok: boolean
  connection: PlcConnection
  results: PlcWriteResult[]
  snapshot?: PlcReadResponse
  message: string
}

export interface PlcConfigResponse {
  pageUrl?: string
  connection: PlcConnection
  collectorMode: 'simulation' | 'plc-tcp'
}

export function validatePlcClock(clock: PlcClockValues): string | undefined {
  for (const field of PLC_CLOCK_FIELDS) {
    const value = clock[field.id]
    if (!Number.isInteger(value) || value < field.min || value > field.max)
      return `${field.label}必须为 ${field.min}–${field.max} 的整数`
  }
  const leap = clock.year % 4 === 0 && (clock.year % 100 !== 0 || clock.year % 400 === 0)
  const days = clock.month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(clock.month) ? 30 : 31
  if (clock.day > days) return '日期不存在，请检查年月日'
  return undefined
}
