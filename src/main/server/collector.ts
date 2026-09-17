import type { CollectorMode, TelemetrySnapshot } from '../../shared/contracts'
import { PLC_ELECTRICAL_POINTS, type PlcPointId, type PlcPowerValues } from '../../shared/plc'
import { decodePlcPoint, readPlcPowers } from './plc-values'
import { PlcSession } from './plc-session'

export interface DataCollector {
  readonly mode: CollectorMode
  start(onSnapshot: (snapshot: TelemetrySnapshot) => void): void
  stop(): void
}

export interface PlcTcpCollectorConfig {
  host: string
  port: number
  unitId: number
  pollingIntervalMs: number
  reconnectDelayMs: number
  requestTimeoutMs: number
  registerAddressOffset?: number
}

const FIRST_REGISTER = 200
const REGISTER_COUNT = 104

const REGISTER_OFFSETS = {
  year: 100,
  monthAndDay: 101,
  hourAndMinute: 102,
  secondAndWeekday: 103
} as const

const DEVICE_DEFINITIONS = [
  { id: 'pv-1', name: '1号光伏组串', kind: 'pv-string' },
  { id: 'pv-2', name: '2号光伏组串', kind: 'pv-string' },
  { id: 'pv-3', name: '3号光伏组串', kind: 'pv-string' },
  { id: 'pv-4', name: '4号光伏组串', kind: 'pv-string' },
  { id: 'battery-1', name: '蓄电池组', kind: 'battery' }
] as const

const SIMULATION_DEVICE_VALUES = [
  { voltage: 210, current: 19 },
  { voltage: 210, current: 19 },
  { voltage: 222, current: 21 },
  { voltage: 220, current: 20 },
  { voltage: 52, current: 5 }
] as const

const SIMULATION_CLOCK_START_MS = Date.UTC(2026, 8, 1, 15, 30, 30)

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

function highByte(value: number): number {
  return (value >>> 8) & 0xff
}

function lowByte(value: number): number {
  return value & 0xff
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leapYear ? 29 : 28
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function decodePlcClock(registers: number[]): NonNullable<TelemetrySnapshot['plcClock']> {
  const year = registers[REGISTER_OFFSETS.year]
  const month = highByte(registers[REGISTER_OFFSETS.monthAndDay])
  const day = lowByte(registers[REGISTER_OFFSETS.monthAndDay])
  const hour = highByte(registers[REGISTER_OFFSETS.hourAndMinute])
  const minute = lowByte(registers[REGISTER_OFFSETS.hourAndMinute])
  const second = highByte(registers[REGISTER_OFFSETS.secondAndWeekday])
  const weekday = lowByte(registers[REGISTER_OFFSETS.secondAndWeekday])
  const clock = { year, month, day, hour, minute, second, weekday }
  const initialized = Object.values(clock).some((value) => value !== 0)
  const validDate =
    year >= 1 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  const validTime =
    hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59

  if (!initialized || !validDate || !validTime) {
    return { ...clock, timestamp: null }
  }

  const timestamp = `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.000`
  return { ...clock, timestamp }
}

function createSimulatedPlcClock(
  sequence: number,
  intervalMs: number
): NonNullable<TelemetrySnapshot['plcClock']> {
  const clock = new Date(SIMULATION_CLOCK_START_MS + (sequence - 1) * intervalMs)
  const year = clock.getUTCFullYear()
  const month = clock.getUTCMonth() + 1
  const day = clock.getUTCDate()
  const hour = clock.getUTCHours()
  const minute = clock.getUTCMinutes()
  const second = clock.getUTCSeconds()
  const weekday = clock.getUTCDay() + 1
  const timestamp = `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.000`

  return { year, month, day, hour, minute, second, weekday, timestamp }
}

export class PlcTcpCollector implements DataCollector {
  readonly mode = 'plc-tcp' as const
  readonly session: PlcSession
  private generation = 0
  private timer?: NodeJS.Timeout
  private running = false
  private sequence = 0
  private onSnapshot?: (snapshot: TelemetrySnapshot) => void
  private lastDevices: TelemetrySnapshot['devices'] = DEVICE_DEFINITIONS.map((device) => ({
    ...device,
    voltage: 0,
    current: 0,
    status: 'offline' as const
  }))

  constructor(private readonly config: PlcTcpCollectorConfig) {
    this.session = new PlcSession(
      {
        host: config.host,
        port: config.port,
        unitId: config.unitId,
        registerAddressOffset: config.registerAddressOffset ?? 0
      },
      config.requestTimeoutMs
    )
  }

  start(onSnapshot: (snapshot: TelemetrySnapshot) => void): void {
    this.stop()
    this.running = true
    this.onSnapshot = onSnapshot
    this.schedule(0)
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.onSnapshot = undefined
    this.generation++
    this.session.close()
  }

  private schedule(delayMs: number): void {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.collect(), delayMs)
  }

  private async collect(): Promise<void> {
    const generation = this.generation
    try {
      const snapshot = await this.session.run(async (client) => {
        const data = await client.read(FIRST_REGISTER, REGISTER_COUNT)
        const powers = await readPlcPowers((register, count) => client.read(register, count))
        const registers = Array.from({ length: REGISTER_COUNT }, (_, index) =>
          data.readUInt16BE(index * 2)
        )
        return this.createSnapshot(registers, powers)
      })
      if (!this.running || generation !== this.generation) return
      this.lastDevices = snapshot.devices
      this.onSnapshot?.(snapshot)
      this.schedule(this.config.pollingIntervalMs)
    } catch (error) {
      if (!this.running || generation !== this.generation) return
      const collectorError = error instanceof Error ? error.message : String(error)
      this.sequence += 1
      this.onSnapshot?.({
        sequence: this.sequence,
        timestamp: new Date().toISOString(),
        collectorMode: this.mode,
        plcConnected: false,
        collectorError,
        devices: this.lastDevices.map((device) => ({ ...device, status: 'offline' }))
      })
      this.schedule(this.config.reconnectDelayMs)
    }
  }

  private createSnapshot(registers: number[], powers: PlcPowerValues): TelemetrySnapshot {
    if (registers.length !== REGISTER_COUNT) {
      throw new Error(`PLC返回 ${registers.length} 个寄存器，预期 ${REGISTER_COUNT} 个`)
    }

    const data = Buffer.alloc(REGISTER_COUNT * 2)
    registers.forEach((value, index) => data.writeUInt16BE(value, index * 2))
    const values = Object.fromEntries(
      PLC_ELECTRICAL_POINTS.map((point) => {
        const value = decodePlcPoint(point, data, (point.register - FIRST_REGISTER) * 2)
        if (!Number.isFinite(value)) throw new Error(`${point.address} 返回了无效 ${point.type}`)
        return [point.id, value]
      })
    ) as Record<PlcPointId, number>

    this.sequence += 1
    return {
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      collectorMode: this.mode,
      plcConnected: true,
      plcClock: decodePlcClock(registers),
      powers,
      devices: [
        {
          ...DEVICE_DEFINITIONS[0],
          voltage: values.pv1Voltage,
          current: values.pv1Current,
          status: 'normal'
        },
        {
          ...DEVICE_DEFINITIONS[1],
          voltage: values.pv2Voltage,
          current: values.pv2Current,
          status: 'normal'
        },
        {
          ...DEVICE_DEFINITIONS[2],
          voltage: values.pv3Voltage,
          current: values.pv3Current,
          status: 'normal'
        },
        {
          ...DEVICE_DEFINITIONS[3],
          voltage: values.pv4Voltage,
          current: values.pv4Current,
          status: 'normal'
        },
        {
          ...DEVICE_DEFINITIONS[4],
          voltage: values.batteryVoltage,
          current: values.batteryCurrent,
          status: 'normal'
        }
      ]
    }
  }
}

export class SimulatedCollector implements DataCollector {
  readonly mode = 'simulation' as const
  private timer?: NodeJS.Timeout
  private sequence = 0

  constructor(private readonly intervalMs = 1000) {}

  start(onSnapshot: (snapshot: TelemetrySnapshot) => void): void {
    this.stop()
    const emitSnapshot = (): void => {
      this.sequence += 1

      onSnapshot({
        sequence: this.sequence,
        timestamp: new Date().toISOString(),
        collectorMode: this.mode,
        plcConnected: true,
        plcClock: createSimulatedPlcClock(this.sequence, this.intervalMs),
        powers: {
          photovoltaicPower: 17,
          storageRatedPower: 6,
          primaryLoadPower: 3,
          secondaryLoadPower: 5,
          tertiaryLoadPower: 4,
          totalLoadPower: 12,
          renewableSupplyPower: 17
        },
        devices: DEVICE_DEFINITIONS.map((device, index) => ({
          ...device,
          ...SIMULATION_DEVICE_VALUES[index],
          status: 'normal'
        }))
      })
    }

    emitSnapshot()
    this.timer = setInterval(emitSnapshot, this.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}

// The production PLC implementation will satisfy this same interface and can
// replace SimulatedCollector without changing the API, database, or B/C clients.
