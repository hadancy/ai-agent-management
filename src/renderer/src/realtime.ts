import { useEffect, useMemo, useState } from 'react'
import type { ServerEvent, SystemInfo, TelemetrySnapshot } from '../../shared/contracts'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

const TELEMETRY_HISTORY_LIMIT = 48
const TELEMETRY_HISTORY_INTERVAL_MS = 5000

function getServiceHost(): string {
  return window.location.hostname || '127.0.0.1'
}

export function useRealtime(): {
  connectionState: ConnectionState
  systemInfo?: SystemInfo
  telemetry?: TelemetrySnapshot
  telemetryHistory: TelemetrySnapshot[]
  plcClockOffsetMs?: number
  workOrderRevision: number
  serviceOrigin: string
} {
  const serviceOrigin = useMemo(() => `http://${getServiceHost()}:17880`, [])
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting')
  const [systemInfo, setSystemInfo] = useState<SystemInfo>()
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>()
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetrySnapshot[]>([])
  const [plcClockOffsetMs, setPlcClockOffsetMs] = useState<number>()
  const [workOrderRevision, setWorkOrderRevision] = useState(0)

  useEffect(() => {
    let active = true
    let socket: WebSocket | undefined
    let reconnectTimer: number | undefined
    let lastHistorySampleAt = 0
    let lastRawPlcTimestamp: string | undefined

    const acceptTelemetry = (snapshot: TelemetrySnapshot): void => {
      const rawPlcTimestamp = snapshot.plcClock?.timestamp ?? undefined
      if (rawPlcTimestamp && rawPlcTimestamp !== lastRawPlcTimestamp) {
        const plcTimeMs = Date.parse(rawPlcTimestamp)
        const capturedAtMs = Date.parse(snapshot.timestamp)
        if (!Number.isNaN(plcTimeMs) && !Number.isNaN(capturedAtMs)) {
          lastRawPlcTimestamp = rawPlcTimestamp
          setPlcClockOffsetMs(plcTimeMs - capturedAtMs)
        }
      }
      setTelemetry(snapshot)
      if (snapshot.plcConnected === false) return
      const sampleAt = Date.parse(snapshot.timestamp)
      const normalizedSampleAt = Number.isNaN(sampleAt) ? Date.now() : sampleAt
      if (
        lastHistorySampleAt !== 0 &&
        normalizedSampleAt - lastHistorySampleAt < TELEMETRY_HISTORY_INTERVAL_MS
      ) {
        return
      }
      lastHistorySampleAt = normalizedSampleAt
      setTelemetryHistory((current) => {
        if (current.at(-1)?.sequence === snapshot.sequence) return current
        return [...current, snapshot].slice(-TELEMETRY_HISTORY_LIMIT)
      })
    }

    const loadInitialState = async (): Promise<void> => {
      try {
        const [systemResponse, telemetryResponse] = await Promise.all([
          fetch(`${serviceOrigin}/api/system-info`),
          fetch(`${serviceOrigin}/api/telemetry/latest`)
        ])
        if (!active) return
        if (systemResponse.ok) setSystemInfo((await systemResponse.json()) as SystemInfo)
        if (telemetryResponse.status === 200)
          acceptTelemetry((await telemetryResponse.json()) as TelemetrySnapshot)
      } catch {
        if (active) setConnectionState('disconnected')
      }
    }

    const connect = (): void => {
      if (!active) return
      setConnectionState('connecting')
      socket = new WebSocket(`ws://${getServiceHost()}:17880/ws`)
      socket.addEventListener('open', () => active && setConnectionState('connected'))
      socket.addEventListener('message', (message) => {
        if (!active) return
        const event = JSON.parse(String(message.data)) as ServerEvent
        if (event.type === 'system.ready') setSystemInfo(event.payload)
        if (event.type === 'telemetry.updated') acceptTelemetry(event.payload)
        if (event.type !== 'system.ready' && event.type !== 'telemetry.updated') {
          // Domain events are invalidation hints only. REST remains the source of truth,
          // allowing a disconnected Pad or console to recover without missing state.
          setWorkOrderRevision((current) => current + 1)
        }
      })
      socket.addEventListener('close', () => {
        if (!active) return
        setConnectionState('disconnected')
        reconnectTimer = window.setTimeout(connect, 2000)
      })
      socket.addEventListener('error', () => socket?.close())
    }

    void loadInitialState()
    connect()

    return () => {
      active = false
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [serviceOrigin])

  return {
    connectionState,
    systemInfo,
    telemetry,
    telemetryHistory,
    plcClockOffsetMs,
    workOrderRevision,
    serviceOrigin
  }
}
