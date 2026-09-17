import { useEffect, useMemo, useRef, useState } from 'react'
import type { TelemetrySnapshot } from '../../../../../shared/contracts'
import {
  createPowerHistoryPoint,
  mergePowerHistory,
  POWER_HISTORY_DAY_MS,
  type PowerHistoryPoint,
  type PowerHistoryResponse
} from '../../../../../shared/power-history'

export function usePowerHistory({
  serviceOrigin,
  dayStartMs,
  clockOffsetMs,
  refreshAtMs,
  telemetry,
  connected
}: {
  serviceOrigin: string
  dayStartMs: number
  clockOffsetMs: number
  refreshAtMs: number
  telemetry?: TelemetrySnapshot
  connected: boolean
}): { points: PowerHistoryPoint[]; loading: boolean; error: boolean; retry: () => void } {
  const [result, setResult] = useState({
    key: '',
    points: [] as PowerHistoryPoint[],
    error: false
  })
  const [revision, setRevision] = useState(0)
  const offsetRef = useRef(clockOffsetMs)
  useEffect(() => {
    offsetRef.current = clockOffsetMs
  }, [clockOffsetMs])
  // Normal PLC polling has sub-second jitter; only clock changes require a new range query.
  const clockAlignment = Math.round(clockOffsetMs / 60_000)
  // Follow the chart's 30-second refresh, not the live telemetry or page clock.
  const requestKey = `${serviceOrigin}/${dayStartMs}/${clockAlignment}/${connected}/${revision}/${refreshAtMs}`

  useEffect(() => {
    const controller = new AbortController()
    const startMs = dayStartMs - offsetRef.current
    const endMs = startMs + POWER_HISTORY_DAY_MS
    const query = new URLSearchParams({
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString()
    })
    void fetch(`${serviceOrigin}/api/telemetry/power-history?${query}`, {
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Power history unavailable')
        const payload = (await response.json()) as PowerHistoryResponse
        if (!Array.isArray(payload.points)) throw new Error('Invalid power history')
        if (!controller.signal.aborted)
          setResult({
            key: requestKey,
            points: mergePowerHistory([], payload.points, startMs, endMs),
            error: false
          })
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult((current) => ({ ...current, key: requestKey, error: true }))
      })
    return () => controller.abort()
  }, [serviceOrigin, dayStartMs, requestKey])

  const points = useMemo(() => {
    const startMs = dayStartMs - clockOffsetMs
    return mergePowerHistory(
      result.points,
      telemetry ? [createPowerHistoryPoint(telemetry)] : [],
      startMs,
      startMs + POWER_HISTORY_DAY_MS
    )
  }, [result.points, telemetry, dayStartMs, clockOffsetMs])

  return {
    points,
    loading: result.key !== requestKey,
    error: result.key === requestKey && result.error,
    retry: () => setRevision((value) => value + 1)
  }
}
