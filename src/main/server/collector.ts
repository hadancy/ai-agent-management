import { createConnection, type Socket } from 'node:net'
import type { CollectorMode, TelemetrySnapshot } from '../../shared/contracts'

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

type PendingRequest = {
  transactionId: number
  resolve: (registers: number[]) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

const FIRST_REGISTER = 200
const REGISTER_COUNT = 104

const REGISTER_OFFSETS = {
  pv1Voltage: 0,
  pv1Current: 2,
  pv2Voltage: 4,
  pv2Current: 6,
  pv3Voltage: 8,
  pv3Current: 10,
  pv4Voltage: 12,
  pv4Current: 14,
  batteryVoltage: 50,
  batteryCurrent: 52,
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

function decodeReal(registers: number[], offset: number): number {
  const buffer = Buffer.allocUnsafe(4)
  buffer.writeUInt16BE(registers[offset], 0)
  buffer.writeUInt16BE(registers[offset + 1], 2)
  const value = buffer.readFloatBE(0)
  if (!Number.isFinite(value)) throw new Error(`寄存器偏移 ${offset} 返回了无效 REAL`)
  return value
}

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
  private socket?: Socket
  private timer?: NodeJS.Timeout
  private running = false
  private sequence = 0
  private transactionId = 0
  private receiveBuffer = Buffer.alloc(0)
  private pendingRequest?: PendingRequest
  private onSnapshot?: (snapshot: TelemetrySnapshot) => void
  private lastDevices: TelemetrySnapshot['devices'] = DEVICE_DEFINITIONS.map((device) => ({
    ...device,
    voltage: 0,
    current: 0,
    status: 'offline' as const
  }))

  constructor(private readonly config: PlcTcpCollectorConfig) {}

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
    this.destroySocket(new Error('PLC采集器已停止'))
  }

  private schedule(delayMs: number): void {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.collect(), delayMs)
  }

  private async collect(): Promise<void> {
    try {
      await this.ensureConnected()
      const address = FIRST_REGISTER + (this.config.registerAddressOffset ?? 0)
      const registers = await this.readHoldingRegisters(address, REGISTER_COUNT)
      const snapshot = this.createSnapshot(registers)
      this.lastDevices = snapshot.devices
      this.onSnapshot?.(snapshot)
      this.schedule(this.config.pollingIntervalMs)
    } catch (error) {
      const collectorError = error instanceof Error ? error.message : String(error)
      this.destroySocket(error instanceof Error ? error : new Error(collectorError))
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

  private createSnapshot(registers: number[]): TelemetrySnapshot {
    if (registers.length !== REGISTER_COUNT) {
      throw new Error(`PLC返回 ${registers.length} 个寄存器，预期 ${REGISTER_COUNT} 个`)
    }

    this.sequence += 1
    return {
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      collectorMode: this.mode,
      plcConnected: true,
      plcClock: decodePlcClock(registers),
      devices: [
        {
          ...DEVICE_DEFINITIONS[0],
          voltage: decodeReal(registers, REGISTER_OFFSETS.pv1Voltage),
          current: decodeReal(registers, REGISTER_OFFSETS.pv1Current),
          status: 'normal'
        },
        {
          ...DEVICE_DEFINITIONS[1],
          voltage: decodeReal(registers, REGISTER_OFFSETS.pv2Voltage),
          current: decodeReal(registers, REGISTER_OFFSETS.pv2Current),
          status: 'normal'
        },
        {
          ...DEVICE_DEFINITIONS[2],
          voltage: decodeReal(registers, REGISTER_OFFSETS.pv3Voltage),
          current: decodeReal(registers, REGISTER_OFFSETS.pv3Current),
          status: 'normal'
        },
        {
          ...DEVICE_DEFINITIONS[3],
          voltage: decodeReal(registers, REGISTER_OFFSETS.pv4Voltage),
          current: decodeReal(registers, REGISTER_OFFSETS.pv4Current),
          status: 'normal'
        },
        {
          ...DEVICE_DEFINITIONS[4],
          voltage: decodeReal(registers, REGISTER_OFFSETS.batteryVoltage),
          current: decodeReal(registers, REGISTER_OFFSETS.batteryCurrent),
          status: 'normal'
        }
      ]
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return

    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: this.config.host, port: this.config.port })
      const timer = setTimeout(() => {
        cleanup()
        socket.destroy()
        reject(new Error(`连接 PLC ${this.config.host}:${this.config.port} 超时`))
      }, this.config.requestTimeoutMs)
      const cleanup = (): void => {
        clearTimeout(timer)
        socket.off('connect', handleConnect)
        socket.off('error', handleConnectError)
      }
      const handleConnect = (): void => {
        cleanup()
        socket.setNoDelay(true)
        socket.on('data', this.handleData)
        socket.on('error', this.handleSocketError)
        socket.on('close', this.handleSocketClose)
        this.socket = socket
        this.receiveBuffer = Buffer.alloc(0)
        resolve()
      }
      const handleConnectError = (error: Error): void => {
        cleanup()
        socket.destroy()
        reject(error)
      }

      socket.once('connect', handleConnect)
      socket.once('error', handleConnectError)
    })
  }

  private readHoldingRegisters(address: number, quantity: number): Promise<number[]> {
    const socket = this.socket
    if (!socket || socket.destroyed) return Promise.reject(new Error('PLC TCP 未连接'))
    if (this.pendingRequest) return Promise.reject(new Error('已有未完成的 Modbus 请求'))

    this.transactionId = (this.transactionId % 0xffff) + 1
    const transactionId = this.transactionId
    const request = Buffer.alloc(12)
    request.writeUInt16BE(transactionId, 0)
    request.writeUInt16BE(0, 2)
    request.writeUInt16BE(6, 4)
    request.writeUInt8(this.config.unitId, 6)
    request.writeUInt8(3, 7)
    request.writeUInt16BE(address, 8)
    request.writeUInt16BE(quantity, 10)

    return new Promise<number[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequest?.transactionId !== transactionId) return
        this.pendingRequest = undefined
        const error = new Error(`读取 HR${address}–HR${address + quantity - 1} 超时`)
        reject(error)
        this.destroySocket(error)
      }, this.config.requestTimeoutMs)

      this.pendingRequest = { transactionId, resolve, reject, timer }
      socket.write(request, (error) => {
        if (!error || this.pendingRequest?.transactionId !== transactionId) return
        clearTimeout(timer)
        this.pendingRequest = undefined
        reject(error)
      })
    })
  }

  private readonly handleData = (chunk: Buffer): void => {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk])

    while (this.receiveBuffer.length >= 7) {
      const protocolId = this.receiveBuffer.readUInt16BE(2)
      const declaredLength = this.receiveBuffer.readUInt16BE(4)
      if (protocolId !== 0 || declaredLength < 2 || declaredLength > 254) {
        this.destroySocket(
          new Error(`PLC返回无效MBAP头（protocol=${protocolId}, length=${declaredLength}）`)
        )
        return
      }
      const frameLength = 6 + declaredLength
      if (this.receiveBuffer.length < frameLength) return
      const frame = this.receiveBuffer.subarray(0, frameLength)
      this.receiveBuffer = this.receiveBuffer.subarray(frameLength)
      this.resolveResponse(frame)
    }
  }

  private resolveResponse(frame: Buffer): void {
    const pending = this.pendingRequest
    if (!pending || frame.readUInt16BE(0) !== pending.transactionId) return
    clearTimeout(pending.timer)
    this.pendingRequest = undefined

    const functionCode = frame.readUInt8(7)
    if (functionCode === 0x83) {
      if (frame.length < 9) {
        pending.reject(new Error('PLC返回的Modbus异常响应长度无效'))
        this.destroySocket(new Error('PLC返回的Modbus异常响应长度无效'))
        return
      }
      pending.reject(new Error(`Modbus异常码 ${frame.readUInt8(8)}`))
      return
    }
    if (functionCode !== 3) {
      pending.reject(new Error(`PLC返回意外功能码 ${functionCode}`))
      return
    }
    if (frame.length < 9) {
      pending.reject(new Error('PLC返回的寄存器响应长度无效'))
      this.destroySocket(new Error('PLC返回的寄存器响应长度无效'))
      return
    }

    const byteCount = frame.readUInt8(8)
    if (byteCount + 9 > frame.length || byteCount % 2 !== 0) {
      pending.reject(new Error('PLC返回的寄存器数据长度无效'))
      return
    }

    const registers: number[] = []
    for (let offset = 0; offset < byteCount; offset += 2) {
      registers.push(frame.readUInt16BE(9 + offset))
    }
    pending.resolve(registers)
  }

  private readonly handleSocketError = (): void => {
    // The close event performs cleanup and the active request reports the error.
  }

  private readonly handleSocketClose = (): void => {
    this.destroySocket(new Error('PLC TCP 连接已关闭'))
  }

  private destroySocket(error: Error): void {
    const pending = this.pendingRequest
    this.pendingRequest = undefined
    if (pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }

    const socket = this.socket
    this.socket = undefined
    this.receiveBuffer = Buffer.alloc(0)
    if (!socket) return
    socket.off('data', this.handleData)
    socket.off('error', this.handleSocketError)
    socket.off('close', this.handleSocketClose)
    if (!socket.destroyed) socket.destroy()
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
