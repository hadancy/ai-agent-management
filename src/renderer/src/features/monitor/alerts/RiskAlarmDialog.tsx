import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeviceRiskAlarm } from '../types'
import '../styles/forecast-alert.css'

type VoiceStatus = 'idle' | 'speaking' | 'completed' | 'unsupported' | 'error'

const VOICE_STATUS_TEXT: Record<VoiceStatus, string> = {
  idle: '语音提示待播放',
  speaking: '正在播报语音提示',
  completed: '语音提示已播报',
  unsupported: '当前系统不支持语音播报',
  error: '语音播报失败，请点击重试'
}

export default function RiskAlarmDialog({
  open,
  alarm,
  onClose
}: {
  open: boolean
  alarm: DeviceRiskAlarm | null
  onClose: () => void
}): React.JSX.Element | null {
  const actionButtonRef = useRef<HTMLButtonElement>(null)
  const lastSpokenAlarmRef = useRef('')
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle')

  const speakAlarm = useCallback((message: string): void => {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setVoiceStatus('unsupported')
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new window.SpeechSynthesisUtterance(message)
    const chineseVoice = window.speechSynthesis
      .getVoices()
      .find((voice) => voice.lang.toLowerCase().startsWith('zh'))
    if (chineseVoice) utterance.voice = chineseVoice
    utterance.lang = 'zh-CN'
    utterance.rate = 0.92
    utterance.pitch = 1
    utterance.volume = 1
    utterance.onstart = () => setVoiceStatus('speaking')
    utterance.onend = () => setVoiceStatus('completed')
    utterance.onerror = (event) => {
      if (event.error !== 'canceled') setVoiceStatus('error')
    }
    window.speechSynthesis.speak(utterance)
  }, [])

  const closeDialog = useCallback((): void => {
    lastSpokenAlarmRef.current = ''
    window.speechSynthesis?.cancel()
    setVoiceStatus('idle')
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open || !alarm || lastSpokenAlarmRef.current === alarm.id) return
    const timer = window.setTimeout(() => {
      lastSpokenAlarmRef.current = alarm.id
      speakAlarm(alarm.message)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [alarm, open, speakAlarm])

  useEffect(() => {
    if (!open) return

    actionButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeDialog()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeDialog, open])

  if (!open || !alarm) return null

  return createPortal(
    <div className="forecast-alert-backdrop" role="presentation">
      <section
        className="forecast-alert"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="forecast-alert-title"
        aria-describedby="forecast-alert-description"
      >
        <div className="forecast-alert__signal" aria-hidden="true">
          !
        </div>
        <div className="forecast-alert__heading">
          <div>
            <span>{alarm.sourceLabel}</span>
            <h2 id="forecast-alert-title">设备风险报警</h2>
          </div>
          <button type="button" aria-label="关闭报警" onClick={closeDialog}>
            ×
          </button>
        </div>

        <div className="forecast-alert__device">
          <strong>{alarm.deviceName}</strong>
          <span>{alarm.source === 'realtime' ? '实时数据越限' : '检测到下降趋势'}</span>
        </div>

        <p id="forecast-alert-description" className="forecast-alert__warning-message">
          {alarm.message}
        </p>
        <p className="forecast-alert__detail">{alarm.detail}</p>

        <div className="forecast-alert__metrics">
          {alarm.statusIndex !== undefined && (
            <div>
              <span>风险状态指数</span>
              <strong>{alarm.statusIndex}%</strong>
            </div>
          )}
          <div>
            <span>{alarm.source === 'realtime' ? '实时电压' : '风险日电压'}</span>
            <strong>{alarm.voltage.toFixed(2)} V</strong>
          </div>
          <div>
            <span>{alarm.source === 'realtime' ? '实时电流' : '风险日电流'}</span>
            <strong>{alarm.current.toFixed(2)} A</strong>
          </div>
        </div>

        {alarm.monthEndSummary && (
          <div className="forecast-alert__month-end">{alarm.monthEndSummary}</div>
        )}

        <div className="forecast-alert__voice" aria-live="polite">
          <span
            className={
              voiceStatus === 'speaking'
                ? 'forecast-alert__voice-wave forecast-alert__voice-wave--active'
                : 'forecast-alert__voice-wave'
            }
            aria-hidden="true"
          >
            <i />
            <i />
            <i />
          </span>
          <span>{VOICE_STATUS_TEXT[voiceStatus]}</span>
          <button type="button" onClick={() => speakAlarm(alarm.message)}>
            重新播报
          </button>
        </div>

        <div className="forecast-alert__actions">
          <button ref={actionButtonRef} type="button" onClick={closeDialog}>
            立即查看处理
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}
