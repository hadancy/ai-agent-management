import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionState } from '../../realtime'
import { fetchPadTasks, type PadRole, type PadTask } from './taskClient'

interface UsePadTasksOptions {
  role: PadRole | null
  serviceOrigin: string
  connectionState: ConnectionState
  workOrderRevision: number
}

interface PadTasksState {
  tasks: PadTask[]
  initialLoading: boolean
  refreshing: boolean
  error: string | null
  lastUpdatedAt: Date | null
  reload: () => Promise<void>
}

const BACKGROUND_REFRESH_INTERVAL_MS = 15_000

export function usePadTasks({
  role,
  serviceOrigin,
  connectionState,
  workOrderRevision
}: UsePadTasksOptions): PadTasksState {
  const [tasks, setTasks] = useState<PadTask[]>([])
  const [initialLoading, setInitialLoading] = useState(Boolean(role))
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const activeRequestRef = useRef<AbortController | null>(null)
  const previousConnectionRef = useRef<ConnectionState>(connectionState)

  const loadTasks = useCallback(
    async (asInitialLoad = false): Promise<void> => {
      if (!role) return
      activeRequestRef.current?.abort()
      const controller = new AbortController()
      activeRequestRef.current = controller
      if (asInitialLoad) setInitialLoading(true)
      else setRefreshing(true)

      try {
        const nextTasks = await fetchPadTasks(serviceOrigin, role, controller.signal)
        if (controller.signal.aborted) return
        setTasks(nextTasks)
        setError(null)
        setLastUpdatedAt(new Date())
      } catch (loadError) {
        if (controller.signal.aborted) return
        setError(loadError instanceof Error ? loadError.message : '任务同步失败，请稍后重试。')
      } finally {
        if (activeRequestRef.current === controller) {
          activeRequestRef.current = null
          setInitialLoading(false)
          setRefreshing(false)
        }
      }
    },
    [role, serviceOrigin]
  )

  const reload = useCallback(() => loadTasks(false), [loadTasks])

  useEffect(() => {
    activeRequestRef.current?.abort()
    const timer = window.setTimeout(() => {
      if (!role) {
        setTasks([])
        setInitialLoading(false)
        setRefreshing(false)
        setError(null)
        setLastUpdatedAt(null)
        return
      }
      setTasks([])
      setError(null)
      void loadTasks(true)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadTasks, role])

  useEffect(() => {
    if (!role || workOrderRevision === 0) return
    const timer = window.setTimeout(() => void reload(), 0)
    return () => window.clearTimeout(timer)
  }, [reload, role, workOrderRevision])

  useEffect(() => {
    const previous = previousConnectionRef.current
    previousConnectionRef.current = connectionState
    if (!role || previous === 'connected' || connectionState !== 'connected') return
    const timer = window.setTimeout(() => void reload(), 0)
    return () => window.clearTimeout(timer)
  }, [connectionState, reload, role])

  useEffect(() => {
    if (!role) return
    const refreshWhenOnline = (): void => void reload()
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === 'visible') void reload()
    }
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload()
    }, BACKGROUND_REFRESH_INTERVAL_MS)

    window.addEventListener('online', refreshWhenOnline)
    window.addEventListener('focus', refreshWhenOnline)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', refreshWhenOnline)
      window.removeEventListener('focus', refreshWhenOnline)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [reload, role])

  useEffect(
    () => () => {
      activeRequestRef.current?.abort()
    },
    []
  )

  return { tasks, initialLoading, refreshing, error, lastUpdatedAt, reload }
}
