import { useCallback, useEffect, useRef, useState } from 'react'
import type { PadRole, PadTask } from './taskClient'

export type VoiceStatus = 'idle' | 'speaking' | 'completed' | 'unsupported' | 'error'

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
  tasks: PadTask[]
): {
  enabled: boolean
  status: VoiceStatus
  enable: () => void
  disable: () => void
  replay: (task: PadTask) => void
} {
  const [enabled, setEnabled] = useState(readVoiceEnabled)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const spokenIdsRef = useRef<Set<string>>(readSpokenTaskIds(role))

  const speakText = useCallback((text: string): boolean => {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setStatus('unsupported')
      return false
    }

    window.speechSynthesis.cancel()
    const utterance = new window.SpeechSynthesisUtterance(text)
    const chineseVoice = window.speechSynthesis
      .getVoices()
      .find((voice) => voice.lang.toLowerCase().startsWith('zh'))
    if (chineseVoice) utterance.voice = chineseVoice
    utterance.lang = 'zh-CN'
    utterance.rate = 0.92
    utterance.pitch = 1
    utterance.volume = 1
    utterance.onstart = () => setStatus('speaking')
    utterance.onend = () => setStatus('completed')
    utterance.onerror = (event) => {
      if (event.error !== 'canceled') setStatus('error')
    }
    window.speechSynthesis.speak(utterance)
    return true
  }, [])

  useEffect(() => {
    spokenIdsRef.current = readSpokenTaskIds(role)
  }, [role])

  useEffect(() => {
    if (!enabled || !role) return
    const unseenTasks = tasks.filter(
      (task) => task.status !== 'completed' && !spokenIdsRef.current.has(task.id)
    )
    if (unseenTasks.length === 0) return

    const timer = window.setTimeout(() => {
      const speech = unseenTasks.map(taskSpeechText).join('。下一项任务：')
      if (!speakText(speech)) return
      unseenTasks.forEach((task) => spokenIdsRef.current.add(task.id))
      saveSpokenTaskIds(role, spokenIdsRef.current)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [enabled, role, speakText, tasks])

  useEffect(
    () => () => {
      window.speechSynthesis?.cancel()
    },
    []
  )

  const enable = useCallback((): void => {
    try {
      window.localStorage.setItem(VOICE_ENABLED_KEY, 'true')
    } catch {
      // Keep the current session enabled even without local storage.
    }
    setEnabled(true)
    const hasUnseenTask = tasks.some(
      (task) => task.status !== 'completed' && !spokenIdsRef.current.has(task.id)
    )
    if (!hasUnseenTask) speakText('工单语音播报已开启。')
  }, [speakText, tasks])

  const disable = useCallback((): void => {
    try {
      window.localStorage.setItem(VOICE_ENABLED_KEY, 'false')
    } catch {
      // Keep the current session disabled even without local storage.
    }
    window.speechSynthesis?.cancel()
    setEnabled(false)
    setStatus('idle')
  }, [])

  const replay = useCallback(
    (task: PadTask): void => {
      speakText(taskSpeechText(task))
    },
    [speakText]
  )

  return { enabled, status, enable, disable, replay }
}
