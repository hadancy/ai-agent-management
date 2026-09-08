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
  const latestAlarmRef = useRef(alarm)
  const activeSpeechRef = useRef<SpeechSynthesisUtterance | null>(null)
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle')
  const alarmId = alarm?.id

  const stopSpeech = useCallback((): void => {
    if (activeSpeechRef.current) {
      activeSpeechRef.current = null
      window.speechSynthesis?.cancel()
    }
  }, [])

  const speakAlarm = useCallback(
    (message: string): void => {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        setVoiceStatus('unsupported')
        return
      }

      stopSpeech()
      const utterance = new window.SpeechSynthesisUtterance(message)
      activeSpeechRef.current = utterance
      const chineseVoice = window.speechSynthesis
        .getVoices()
        .find((voice) => voice.lang.toLowerCase().startsWith('zh'))
      if (chineseVoice) utterance.voice = chineseVoice
      utterance.lang = 'zh-CN'
      utterance.rate = 0.92
      utterance.pitch = 1
      utterance.volume = 1
      utterance.onstart = () => {
        if (activeSpeechRef.current === utterance) setVoiceStatus('speaking')
      }
      utterance.onend = () => {
        if (activeSpeechRef.current !== utterance) return
        activeSpeechRef.current = null
        setVoiceStatus('completed')
      }
      utterance.onerror = (event) => {
        if (activeSpeechRef.current !== utterance) return
        activeSpeechRef.current = null
        if (event.error !== 'canceled' && event.error !== 'interrupted') setVoiceStatus('error')
      }
      window.speechSynthesis.speak(utterance)
    },
    [stopSpeech]
  )

  const closeDialog = useCallback((): void => {
    stopSpeech()
    setVoiceStatus(lastSpokenAlarmRef.current ? 'completed' : 'idle')
    onClose()
  }, [onClose, stopSpeech])

  useEffect(() => {
    latestAlarmRef.current = alarm
  }, [alarm])

  useEffect(() => {
    if (!alarmId) lastSpokenAlarmRef.current = ''
    if (!open || !alarmId) {
      stopSpeech()
      return
    }
    if (lastSpokenAlarmRef.current === alarmId) return
    setVoiceStatus('idle')
    const timer = window.setTimeout(() => {
      const latestAlarm = latestAlarmRef.current
      if (!latestAlarm || lastSpokenAlarmRef.current === alarmId) return
      lastSpokenAlarmRef.current = alarmId
      speakAlarm(latestAlarm.message)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [alarmId, open, speakAlarm, stopSpeech])

  useEffect(() => stopSpeech, [stopSpeech])

  const replayAlarm = (): void => {
    if (!alarm) return
    lastSpokenAlarmRef.current = alarm.id
    speakAlarm(alarm.message)
  }

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
            <span>实时监测 · 趋势预测</span>
            <h2 id="forecast-alert-title">设备运行告警</h2>
          </div>
          <button type="button" aria-label="关闭报警" onClick={closeDialog}>
            ×
          </button>
        </div>

        <p id="forecast-alert-description" className="forecast-alert__warning-message">
          {alarm.message}
        </p>
        <div className="forecast-alert__devices">
          {alarm.devices.map((device) => (
            <article key={device.id}>
              <div className="forecast-alert__device">
                <strong>{device.name}</strong>
                <span>
                  {device.realtime && device.prediction
                    ? '实时越限 · 预测风险'
                    : device.realtime
                      ? '实时数据越限'
                      : '预测风险'}
                </span>
              </div>
              {device.realtime && (
                <>
                  <p className="forecast-alert__detail">
                    实时采集值超出设置中心配置的正常区间，请检查组件及支路连接。
                    {alarm.normalRangeDescription}
                  </p>
                  <div className="forecast-alert__metrics">
                    <div>
                      <span>实时电压</span>
                      <strong>{device.realtime.voltage.toFixed(2)} V</strong>
                    </div>
                    <div>
                      <span>实时电流</span>
                      <strong>{device.realtime.current.toFixed(2)} A</strong>
                    </div>
                  </div>
                </>
              )}
              {device.prediction && (
                <>
                  <p className="forecast-alert__detail">
                    根据近期运行数据，预计 {device.prediction.riskDate} 进入风险区间。
                  </p>
                  <div className="forecast-alert__metrics">
                    <div>
                      <span>风险状态指数</span>
                      <strong>{device.prediction.riskValue}%</strong>
                    </div>
                    <div>
                      <span>风险日电压</span>
                      <strong>{device.prediction.projectedVoltage.toFixed(2)} V</strong>
                    </div>
                    <div>
                      <span>风险日电流</span>
                      <strong>{device.prediction.projectedCurrent.toFixed(2)} A</strong>
                    </div>
                  </div>
                  <div className="forecast-alert__month-end">
                    月末预计：状态指数 {device.prediction.monthEndValue}% · 电压{' '}
                    {device.prediction.monthEndVoltage} V · 电流 {device.prediction.monthEndCurrent}{' '}
                    A
                  </div>
                </>
              )}
            </article>
          ))}
        </div>

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
          <button type="button" onClick={replayAlarm}>
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
