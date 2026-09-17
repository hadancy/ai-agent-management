import type { PlcConnection } from '../../shared/plc'
import { PlcClient } from './plc-client'

/** Share one TCP connection and keep each read/write/readback operation indivisible. */
export class PlcSession {
  private client?: PlcClient
  private queue: Promise<void> = Promise.resolve()
  private generation = 0

  constructor(
    private readonly connection: PlcConnection,
    private readonly timeoutMs: number
  ) {}

  matches(connection: PlcConnection): boolean {
    return (
      connection.host === this.connection.host &&
      connection.port === this.connection.port &&
      connection.unitId === this.connection.unitId &&
      connection.registerAddressOffset === this.connection.registerAddressOffset
    )
  }

  run<T>(operation: (client: PlcClient) => Promise<T>): Promise<T> {
    const generation = this.generation
    const task = this.queue.then(async () => {
      if (generation !== this.generation) throw new Error('PLC连接已停止，本次操作未执行')
      if (!this.client?.connected) {
        this.client?.close()
        this.client = new PlcClient(this.connection, this.timeoutMs)
      }
      const client = this.client
      try {
        if (!client.connected) await client.connect()
        if (generation !== this.generation) throw new Error('PLC连接已停止，本次操作未执行')
        return await operation(client)
      } catch (error) {
        client.close()
        if (this.client === client) this.client = undefined
        throw error
      }
    })
    // Failed operations release the queue. Only the next explicit operation or poll reconnects.
    this.queue = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }

  close(): void {
    this.generation++
    this.client?.close()
    this.client = undefined
  }
}
