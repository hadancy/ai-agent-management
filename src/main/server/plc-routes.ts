import { isIP } from 'node:net'
import type { FastifyInstance } from 'fastify'
import {
  PLC_CLOCK_FIELDS,
  PLC_POINTS,
  validatePlcClock,
  validatePlcPointValue,
  type PlcClockValues,
  type PlcConfigResponse,
  type PlcConnection,
  type PlcPointId,
  type PlcReadResponse,
  type PlcWriteRequest,
  type PlcWriteResponse,
  type PlcWriteResult
} from '../../shared/plc'
import { ModbusException, PlcClient } from './plc-client'
import { decodePlcPoint, encodePlcPoint } from './plc-values'

class PlcInputError extends Error {
  readonly statusCode = 400
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PlcInputError('请求参数必须是对象')
  return value as Record<string, unknown>
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new PlcInputError(`${label}必须为 ${min}–${max} 的整数`)
  return value
}

function parseConnection(value: unknown): PlcConnection {
  const input = object(value)
  if (typeof input.host !== 'string' || !isIP(input.host.trim()))
    throw new PlcInputError('请输入有效的IPv4或IPv6地址')
  let host = input.host.trim()
  if (isIP(host) === 6) host = new URL(`http://[${host}]`).hostname.slice(1, -1)
  return {
    host,
    port: integer(input.port, 1, 65535, '端口'),
    unitId: integer(input.unitId, 0, 255, 'Unit ID'),
    registerAddressOffset: integer(input.registerAddressOffset ?? 0, 0, 65232, '寄存器偏移')
  }
}

function parseWrite(body: unknown): PlcWriteRequest {
  const input = object(body)
  const connection = parseConnection(input.connection)
  const values: Partial<Record<PlcPointId, number>> = {}
  if (input.values !== undefined) {
    for (const [key, value] of Object.entries(object(input.values))) {
      const point = PLC_POINTS.find((point) => point.id === key)
      if (!point) throw new PlcInputError(`未知点位：${key}`)
      const error = validatePlcPointValue(point, value)
      if (error) throw new PlcInputError(error)
      values[point.id] = value as number
    }
  }
  let clock: PlcClockValues | undefined
  if (input.clock !== undefined) {
    const raw = object(input.clock)
    clock = Object.fromEntries(
      PLC_CLOCK_FIELDS.map((field) => [field.id, raw[field.id]])
    ) as PlcClockValues
    const error = validatePlcClock(clock)
    if (error) throw new PlcInputError(error)
  }
  if (!Object.keys(values).length && !clock) throw new PlcInputError('请至少选择一个待写入点位')
  return { connection, values, clock }
}

function decodeClock(data: Buffer): PlcClockValues {
  return {
    year: data.readUInt16BE(0),
    month: data[2],
    day: data[3],
    hour: data[4],
    minute: data[5],
    second: data[6],
    weekday: data[7]
  }
}

async function readSnapshot(
  client: PlcClient,
  connection: PlcConnection
): Promise<PlcReadResponse> {
  const data = await client.read(200, 104)
  const values = Object.fromEntries(
    PLC_POINTS.map((point) => {
      const value = decodePlcPoint(point, data, (point.register - 200) * 2)
      return [point.id, Number.isFinite(value) ? value : null]
    })
  ) as PlcReadResponse['values']
  return {
    connection,
    values,
    clock: decodeClock(data.subarray(200)),
    readAt: new Date().toISOString()
  }
}

async function writePoints(client: PlcClient, input: PlcWriteRequest): Promise<PlcWriteResponse> {
  const operations: {
    id: PlcPointId | 'clock'
    address: number
    data: Buffer
    requested: number | PlcClockValues
  }[] = []
  for (const point of PLC_POINTS) {
    const value = input.values?.[point.id]
    if (value === undefined) continue
    const data = encodePlcPoint(point, value)
    operations.push({ id: point.id, address: point.register, data, requested: value })
  }
  if (input.clock) {
    const clock = input.clock
    const data = Buffer.alloc(8)
    data.writeUInt16BE(clock.year)
    data.set([clock.month, clock.day, clock.hour, clock.minute, clock.second, clock.weekday], 2)
    operations.push({ id: 'clock', address: 300, data, requested: clock })
  }

  const results: PlcWriteResult[] = []
  let interrupted = false
  for (const operation of operations) {
    const result: PlcWriteResult = {
      id: operation.id,
      requested: operation.requested,
      status: 'not_written',
      message: '前一项未确认成功，本项尚未写入'
    }
    results.push(result)
    if (interrupted) continue
    let acknowledged = false
    try {
      await client.write(operation.address, operation.data)
      acknowledged = true
      const actual = await client.read(operation.address, operation.data.length / 2)
      if (operation.id === 'clock') result.actual = decodeClock(actual)
      else {
        const point = PLC_POINTS.find((point) => point.id === operation.id)!
        const actualNumber = decodePlcPoint(point, actual)
        result.actual = Number.isFinite(actualNumber) ? actualNumber : null
      }
      result.status = actual.equals(operation.data) ? 'verified' : 'mismatch'
      result.message =
        result.status === 'verified'
          ? '写入后回读一致'
          : '写入已应答，但回读不一致；点位可能被PLC程序刷新，请重新读取'
      interrupted = result.status !== 'verified'
    } catch (error) {
      result.status = !acknowledged && error instanceof ModbusException ? 'rejected' : 'unknown'
      result.message = `${error instanceof Error ? error.message : String(error)}；${result.status === 'rejected' ? 'PLC拒绝写入' : '写入状态未确认，请重新读取后判断，勿直接重复提交'}`
      interrupted = true
    }
  }
  const response: PlcWriteResponse = {
    ok: results.every((result) => result.status === 'verified'),
    connection: input.connection,
    results,
    message: interrupted ? '部分点位未确认成功，请查看逐项结果' : '所有提交点位均已写入并回读一致'
  }
  if (!interrupted) {
    try {
      response.snapshot = await readSnapshot(client, input.connection)
    } catch {
      response.message += '；全表刷新失败，可稍后重新读取'
    }
  }
  return response
}

export function registerPlcRoutes(
  app: FastifyInstance,
  options: {
    config: PlcConfigResponse
    developmentRendererUrl?: string
    recordEvent?: (type: string, payload: unknown) => void
    timeoutMs?: number
  }
): void {
  const busy = new Set<string>()
  const allowedPorts = new Set(['17880'])
  if (options.developmentRendererUrl) allowedPorts.add(new URL(options.developmentRendererUrl).port)

  app.get('/api/plc/config', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return options.config
  })

  for (const action of ['read', 'write'] as const) {
    app.post(
      `/api/plc/${action}`,
      {
        bodyLimit: 8192,
        preHandler: async (request, reply) => {
          // These routes drive a real device; reject calls from unrelated browser origins.
          const origin = request.headers.origin
          if (request.headers['x-plc-request'] !== '1')
            return reply.code(403).send({ message: '请通过PLC调试页面操作' })
          if (origin) {
            try {
              const source = new URL(origin)
              const target = new URL(`http://${request.headers.host}`)
              if (
                !['http:', 'https:'].includes(source.protocol) ||
                source.hostname !== target.hostname ||
                (source.port !== target.port && !allowedPorts.has(source.port))
              )
                throw new Error('origin')
            } catch {
              return reply.code(403).send({ message: '不允许从其他网站操作PLC' })
            }
          }
        }
      },
      async (request, reply) => {
        reply.header('Cache-Control', 'no-store')
        const input = action === 'write' ? parseWrite(request.body) : undefined
        const connection = input?.connection ?? parseConnection(object(request.body).connection)
        const key = `${connection.host}:${connection.port}`
        if (busy.has(key))
          return reply.code(409).send({ message: '该PLC正在处理其他操作，请稍后再试' })
        busy.add(key)
        const client = new PlcClient(connection, options.timeoutMs)
        let writeStarted = false
        try {
          await client.connect()
          const before = await readSnapshot(client, connection)
          if (!input) return before
          options.recordEvent?.('plc.write-requested', {
            ...input,
            before,
            timestamp: new Date().toISOString()
          })
          writeStarted = true
          const result = await writePoints(client, input)
          try {
            options.recordEvent?.('plc.write-completed', {
              ...result,
              timestamp: new Date().toISOString()
            })
          } catch (error) {
            app.log.error(error, 'PLC写入结果记录失败')
          }
          return result
        } catch (error) {
          return reply.code(502).send({
            message: `${error instanceof Error ? error.message : String(error)}；${writeStarted ? '写入状态未确认，请重新读取' : '本次未发送点位写入'}`
          })
        } finally {
          client.close()
          busy.delete(key)
        }
      }
    )
  }
}
