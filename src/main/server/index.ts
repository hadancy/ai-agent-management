import { existsSync } from 'node:fs'
import { join } from 'node:path'
import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { WebSocket, WebSocketServer } from 'ws'
import type { ServerEvent, SystemInfo, TelemetrySnapshot } from '../../shared/contracts'
import { getWifiLanAddress } from '../network'
import { PlcTcpCollector, SimulatedCollector, type DataCollector } from './collector'
import { createAppDatabase } from './database'
import { registerPlcRoutes } from './plc-routes'
import { registerSpeechRoutes } from './speech'
import { synthesizeSpeech, type SpeechResources } from './offline-speech'
import type { SpeechService } from './speech-service'
import { registerWorkOrderRoutes, WorkOrderService } from './work-orders'

export interface EmbeddedServerOptions {
  dataDirectory: string
  rendererDirectory: string
  speechResources?: SpeechResources
  speechService?: SpeechService
  developmentRendererUrl?: string
  port?: number
}

export interface EmbeddedServer {
  info: SystemInfo
  stop(): Promise<void>
}

function readIntegerEnvironment(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

function createCollector(): DataCollector {
  if (process.env['PLC_MODE'] === 'simulation') return new SimulatedCollector(1000)

  return new PlcTcpCollector({
    host: process.env['PLC_HOST'] ?? '192.168.0.1',
    port: readIntegerEnvironment('PLC_PORT', 503),
    unitId: readIntegerEnvironment('PLC_UNIT_ID', 1),
    pollingIntervalMs: readIntegerEnvironment('PLC_POLL_INTERVAL_MS', 1000),
    reconnectDelayMs: readIntegerEnvironment('PLC_RECONNECT_DELAY_MS', 2000),
    requestTimeoutMs: readIntegerEnvironment('PLC_REQUEST_TIMEOUT_MS', 1500),
    registerAddressOffset: readIntegerEnvironment('PLC_REGISTER_OFFSET', 0)
  })
}

function replaceUrlHost(url: string, host: string, requestUrl: string): string {
  const target = new URL(url)
  const requestTarget = new URL(requestUrl, 'http://localhost')
  target.hostname = host
  target.pathname = requestTarget.pathname
  target.search = requestTarget.search
  target.hash = ''
  return target.toString()
}

export async function startEmbeddedServer(options: EmbeddedServerOptions): Promise<EmbeddedServer> {
  const port = options.port ?? 17880
  const host = getWifiLanAddress()
  const database = createAppDatabase(options.dataDirectory)
  database.seedBuiltInWorkOrders()
  const collector = createCollector()
  const clients = new Set<WebSocket>()
  const app = Fastify({ logger: false })
  const webSocketServer = new WebSocketServer({ noServer: true })
  let latestSnapshot: TelemetrySnapshot | undefined

  const info: SystemInfo = {
    serviceName: 'AI智能体辅助管理平台内置服务',
    version: '0.1.0',
    collectorMode: collector.mode,
    host,
    port,
    apiUrl: `http://${host}:${port}/api`,
    padUrl: `http://${host}:${port}/c`,
    databasePath: database.path
  }

  const broadcast = (event: ServerEvent): void => {
    const payload = JSON.stringify(event)
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload)
    }
  }

  const workOrders = new WorkOrderService({
    database,
    broadcast,
    getLatestSnapshot: () => latestSnapshot,
    maxContinuousSampleGapMs: Math.max(
      5_000,
      readIntegerEnvironment('PLC_POLL_INTERVAL_MS', 1_000) * 3 +
        readIntegerEnvironment('PLC_REQUEST_TIMEOUT_MS', 1_500)
    )
  })

  await app.register(fastifyCors, {
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'DELETE']
  })

  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    collectorMode: collector.mode,
    webSocketClients: clients.size
  }))
  app.get('/api/system-info', async () => info)
  app.get('/api/telemetry/latest', async (_request, reply) => {
    if (!latestSnapshot) return reply.code(204).send()
    return latestSnapshot
  })
  registerWorkOrderRoutes(app, workOrders)
  registerSpeechRoutes(
    app,
    (text) =>
      options.speechService
        ? options.speechService.synthesize(text)
        : synthesizeSpeech(text, options.speechResources),
    () => options.speechService?.cacheNamespace() ?? ''
  )
  registerPlcRoutes(app, {
    config: {
      pageUrl: `http://${host}:${port}/plc`,
      collectorMode: collector.mode,
      connection: {
        host: process.env['PLC_HOST'] ?? '192.168.0.1',
        port: readIntegerEnvironment('PLC_PORT', 503),
        unitId: readIntegerEnvironment('PLC_UNIT_ID', 1),
        registerAddressOffset: readIntegerEnvironment('PLC_REGISTER_OFFSET', 0)
      }
    },
    developmentRendererUrl: options.developmentRendererUrl,
    recordEvent: (type, payload) => database.recordEvent(type, payload)
  })

  if (options.developmentRendererUrl) {
    app.get('/', async (_request, reply) => reply.redirect(options.developmentRendererUrl!))
    app.get('/b', async (_request, reply) => reply.redirect(options.developmentRendererUrl!))
    app.get('/c', async (request, reply) => {
      return reply.redirect(replaceUrlHost(options.developmentRendererUrl!, host, request.url))
    })
    app.get('/plc', async (request, reply) => {
      return reply.redirect(
        replaceUrlHost(options.developmentRendererUrl!, request.hostname, request.url)
      )
    })
  } else if (existsSync(join(options.rendererDirectory, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: options.rendererDirectory,
      wildcard: false
    })
    app.get('/b', async (_request, reply) => reply.sendFile('index.html'))
    app.get('/c', async (_request, reply) => reply.sendFile('index.html'))
    app.get('/plc', async (_request, reply) => reply.sendFile('index.html'))
  }

  app.server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname !== '/ws') {
      socket.destroy()
      return
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request)
    })
  })

  webSocketServer.on('connection', (socket) => {
    clients.add(socket)
    socket.send(JSON.stringify({ type: 'system.ready', payload: info } satisfies ServerEvent))
    if (latestSnapshot) {
      socket.send(
        JSON.stringify({ type: 'telemetry.updated', payload: latestSnapshot } satisfies ServerEvent)
      )
    }
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => clients.delete(socket))
  })

  await app.listen({ host: '0.0.0.0', port })
  const resetVerificationCount = database.resetVerifyingWorkOrderStreaks()
  if (resetVerificationCount > 0) {
    database.recordEvent('work-order.plc-verification-reset-after-restart', {
      count: resetVerificationCount,
      timestamp: new Date().toISOString()
    })
  }
  database.recordEvent('service.started', info)

  collector.start((snapshot) => {
    latestSnapshot = snapshot
    database.saveTelemetry(snapshot)
    try {
      workOrders.processTelemetry(snapshot)
    } catch (error) {
      database.recordEvent('work-order.telemetry-processing-failed', {
        timestamp: snapshot.timestamp,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    broadcast({ type: 'telemetry.updated', payload: snapshot })
  })

  return {
    info,
    async stop() {
      collector.stop()
      database.recordEvent('service.stopped', { timestamp: new Date().toISOString() })
      for (const client of clients) client.close(1001, 'service stopping')
      clients.clear()
      webSocketServer.close()
      await app.close()
      database.close()
    }
  }
}
