import { useCallback, useEffect, useRef, useState } from 'react'
import type { PadRole, PadTask } from './taskClient'
import { PlatformSpeechPlayer, type VoicePlaybackState } from '../../speech/PlatformSpeechPlayer'

const VOICE_ENABLED_KEY = 'platform-c.voice-enabled'
const SPOKEN_TASK_IDS_PREFIX = 'platform-c.spoken-task-ids.'

function readVoiceEnabled(): boolean {
  try {
    return window.localStorage.getItem(VOICE_ENABLED_KEY) === 'true'
  } catch {
    return false
  }
}

function readSpokenTaskIds(role: PadRole | null): Set<string> {
  if (!role) return new Set()
  try {
    const value = JSON.parse(
      window.localStorage.getItem(`${SPOKEN_TASK_IDS_PREFIX}${role}`) ?? '[]'
    ) as unknown
    return new Set(Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveSpokenTaskIds(role: PadRole, ids: Set<string>): void {
  try {
    window.localStorage.setItem(
      `${SPOKEN_TASK_IDS_PREFIX}${role}`,
      JSON.stringify([...ids].slice(-120))
    )
  } catch {
    // Voice playback remains available when local storage is unavailable.
  }
}

function taskSpeechText(task: PadTask): string {
  if (task.voiceText) return task.voiceText
  const roleName = `${task.role}员工`
  const location = [task.stationName, task.equipmentName].filter(Boolean).join('，')
  const risks = task.riskPoints.length > 0 ? task.riskPoints.join('、') : '请仔细阅读现场安全要求'
  const closing =
    task.role === 'A'
      ? '请坚守岗位，发现违章立即制止。'
      : task.role === 'B'
        ? '请穿戴绝缘防护用品，规范操作。'
        : '请携带检测工具和防护用品，注意安全。'

  return [
    `${roleName}您有新工单。`,
    `工单编号${task.workOrderNumber}，故障类型：${task.faultType}。`,
    location ? `作业位置：${location}。` : '',
    `您的任务：${task.content}。`,
    `风险点：${risks}。`,
    closing
  ]
    .filter(Boolean)
    .join('')
}

export function useTaskSpeech(
  role: PadRole | null,
  tasks: PadTask[],
  serviceOrigin: string
): {
  enabled: boolean
  activated: boolean
  status: VoicePlaybackState['status']
  message: string
  enable: () => void
  disable: () => void
  replay: (task: PadTask) => void
} {
  const [enabled, setEnabled] = useState(readVoiceEnabled)
  // Stored preference does not grant playback permission to a newly opened page.
  const [activatedSession, setActivatedSession] = useState<string | null>(null)
  const sessionKey = `${serviceOrigin}|${role}`
  const activated = activatedSession === sessionKey
  const [playback, setPlayback] = useState<VoicePlaybackState>({
    status: 'idle',
    message: '新工单将自动播报'
  })
  const [revision, setRevision] = useState(0)
  const playerRef = useRef<PlatformSpeechPlayer | null>(null)
  const spokenIdsRef = useRef<Set<string>>(readSpokenTaskIds(role))
  const activeRef = useRef<{ task?: PadTask; role: PadRole | null } | null>(null)

  useEffect(() => {
    const player = new PlatformSpeechPlayer(serviceOrigin, setPlayback)
    playerRef.current = player
    return () => {
      activeRef.current = null
      player.dispose()
      playerRef.current = null
    }
  }, [serviceOrigin])

  useEffect(() => {
    activeRef.current = null
    playerRef.current?.stop()
    spokenIdsRef.current = readSpokenTaskIds(role)
  }, [role, serviceOrigin])

  const begin = useCallback(
    (task: PadTask | undefined, userInitiated = false): void => {
      const player = playerRef.current
      if (!player) return
      const active = { task, role }
      activeRef.current = active
      player.play(
        task ? taskSpeechText(task) : '工单语音播报已开启。',
        () => {
          if (activeRef.current !== active) return
          if (task && role) {
            spokenIdsRef.current.add(task.id)
            saveSpokenTaskIds(role, spokenIdsRef.current)
          }
          activeRef.current = null
          setRevision((value) => value + 1)
        },
        userInitiated
      )
    },
    [role]
  )

  const getNextTask = useCallback(
    () =>
      tasks.find(
        (task) =>
          task.role === role && task.status !== 'completed' && !spokenIdsRef.current.has(task.id)
      ),
    [tasks, role]
  )

  useEffect(() => {
    if (!enabled || !activated || !role || activeRef.current) return
    const nextTask = getNextTask()
    if (nextTask) begin(nextTask)
  }, [enabled, activated, role, getNextTask, begin, revision])

  const enable = (): void => {
    try {
      window.localStorage.setItem(VOICE_ENABLED_KEY, 'true')
    } catch {
      /* Optional persistence. */
    }
    setEnabled(true)
    setActivatedSession(sessionKey)
    if (playback.status === 'blocked' && playerRef.current?.resume()) return
    // Start directly in the tap handler, including when there are pending tasks.
    begin(activeRef.current?.task ?? getNextTask(), true)
  }

  const disable = (): void => {
    try {
      window.localStorage.setItem(VOICE_ENABLED_KEY, 'false')
    } catch {
      /* Optional persistence. */
    }
    activeRef.current = null
    playerRef.current?.stop()
    setEnabled(false)
    setActivatedSession(null)
    setPlayback({ status: 'idle', message: '自动播报已关闭' })
  }

  const replay = (task: PadTask): void => {
    setActivatedSession(sessionKey)
    begin(task, true)
  }

  return {
    enabled,
    activated,
    status: activated ? playback.status : 'idle',
    message: playback.message,
    enable,
    disable,
    replay
  }
}
