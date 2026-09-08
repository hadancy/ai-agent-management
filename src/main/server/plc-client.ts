import { createConnection, type Socket } from 'node:net'
import type { PlcConnection } from '../../shared/plc'

export class ModbusException extends Error {
  constructor(code: number) {
    const descriptions: Record<number, string> = {
      1: 'PLC不支持此功能码',
      2: '寄存器地址无效或未开放',
      3: 'PLC拒绝此数据值',
      4: 'PLC设备执行失败',
      6: 'PLC设备忙'
    }
    super(`${descriptions[code] ?? 'PLC返回异常'}（Modbus异常码 ${code}）`)
  }
}

// One connection per explicit page operation; no automatic write retries.
export class PlcClient {
  private socket?: Socket
  private transactionId = 0
  private pending?: (error: Error) => void
  private failure?: Error

  constructor(
    private readonly connection: PlcConnection,
    private readonly timeoutMs = 2500
  ) {}

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: this.connection.host, port: this.connection.port })
      this.socket = socket
      const timer = setTimeout(
        () => fail(new Error('连接PLC超时，请检查IP、端口及网络')),
        this.timeoutMs
      )
      const fail = (error: Error): void => {
        clearTimeout(timer)
        this.failure = error
        this.pending?.(error)
        reject(error)
        socket.destroy()
      }
      socket.on('error', fail)
      socket.on('close', () => fail(new Error('PLC连接已关闭')))
      socket.once('connect', () => {
        clearTimeout(timer)
        socket.setNoDelay(true)
        resolve()
      })
    })
  }

  close(): void {
    this.socket?.destroy()
    this.socket = undefined
  }

  private async exchange(pdu: Buffer): Promise<Buffer> {
    const socket = this.socket
    if (!socket || socket.destroyed || this.failure) throw this.failure ?? new Error('PLC未连接')
    if (this.pending) throw new Error('已有PLC请求正在执行')
    const transactionId = ++this.transactionId
    const request = Buffer.alloc(7 + pdu.length)
    request.writeUInt16BE(transactionId, 0)
    request.writeUInt16BE(pdu.length + 1, 4)
    request[6] = this.connection.unitId
    pdu.copy(request, 7)

    return new Promise<Buffer>((resolve, reject) => {
      let buffer = Buffer.alloc(0)
      const finish = (error?: Error, response?: Buffer): void => {
        if (this.pending !== fail) return
        clearTimeout(timer)
        socket.off('data', onData)
        this.pending = undefined
        if (error) {
          this.failure = error
          socket.destroy()
          reject(error)
        } else resolve(response!)
      }
      const fail = (error: Error): void => finish(error)
      const timer = setTimeout(() => fail(new Error('PLC响应超时')), this.timeoutMs)
      const onData = (chunk: Buffer): void => {
        buffer = Buffer.concat([buffer, chunk])
        if (buffer.length < 7) return
        const length = buffer.readUInt16BE(4)
        if (buffer.readUInt16BE(2) !== 0 || length < 2 || length > 254) {
          fail(new Error('PLC返回无效Modbus报文头'))
          return
        }
        if (buffer.length < length + 6) return
        if (
          buffer.length !== length + 6 ||
          buffer.readUInt16BE(0) !== transactionId ||
          buffer[6] !== this.connection.unitId
        ) {
          fail(new Error('PLC响应长度、事务编号或Unit ID不匹配'))
          return
        }
        const response = buffer.subarray(7)
        if (response[0] === (pdu[0] | 0x80) && response.length === 2) {
          fail(new ModbusException(response[1]))
        } else if (response[0] !== pdu[0]) {
          fail(new Error('PLC响应功能码不匹配'))
        } else finish(undefined, response)
      }
      this.pending = fail
      socket.on('data', onData)
      socket.write(request, (error) => error && fail(error))
    })
  }

  async read(address: number, quantity: number): Promise<Buffer> {
    const pdu = Buffer.alloc(5)
    pdu[0] = 3
    pdu.writeUInt16BE(address + this.connection.registerAddressOffset, 1)
    pdu.writeUInt16BE(quantity, 3)
    const response = await this.exchange(pdu)
    if (response.length !== 2 + quantity * 2 || response[1] !== quantity * 2)
      throw new Error('PLC返回的寄存器数量不匹配')
    return response.subarray(2)
  }

  async write(address: number, data: Buffer): Promise<void> {
    const pdu = Buffer.alloc(6 + data.length)
    pdu[0] = 16
    pdu.writeUInt16BE(address + this.connection.registerAddressOffset, 1)
    pdu.writeUInt16BE(data.length / 2, 3)
    pdu[5] = data.length
    data.copy(pdu, 6)
    const response = await this.exchange(pdu)
    if (response.length !== 5 || !response.equals(pdu.subarray(0, 5)))
      throw new Error('PLC写入响应的寄存器地址或数量不匹配')
  }
}
