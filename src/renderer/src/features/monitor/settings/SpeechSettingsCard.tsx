import { RECORDED_TEST_TEXT } from '../../../../../shared/recorded-speech'
import { usePlatformSpeech } from '../../../speech/usePlatformSpeech'

export default function SpeechSettingsCard(): React.JSX.Element {
  const voice = usePlatformSpeech()
  const playing = voice.status === 'speaking' || voice.status === 'loading'
  return (
    <section className="settings-card speech-settings" aria-label="全平台语音设置">
      <div className="settings-card__title">
        <span>音频</span>
        <div>
          <h3>全平台语音</h3>
          <p>设备告警、AI 分析、工单提醒、员工任务和能效讲解统一使用普通话女声。</p>
        </div>
      </div>
      <div className="speech-settings__fields">
        <label>
          <span>播报音色</span>
          <strong>普通话女声</strong>
        </label>
      </div>
      <div className="speech-settings__help">
        <p>可试听语音效果，播放时可随时停止。</p>
      </div>
      <div className="settings-actions">
        <button
          type="button"
          className="settings-save"
          onClick={() => {
            if (playing) voice.stop()
            else if (voice.status !== 'blocked' || !voice.resume())
              voice.speak(RECORDED_TEST_TEXT, true)
          }}
        >
          {playing ? '停止试听' : voice.status === 'blocked' ? '点击播放' : '试听语音'}
        </button>
      </div>
      <p className="speech-settings__message" role="status">
        {voice.message}
      </p>
    </section>
  )
}
