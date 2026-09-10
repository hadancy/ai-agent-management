import { useEffect, useRef, useState } from 'react'
import {
  QWEN_TTS_MODEL,
  type SpeechSettingsInput,
  type SpeechSettingsStatus
} from '../../../../../shared/speech-settings'

export default function SpeechSettingsCard(): React.JSX.Element {
  const api = window.api?.speechSettings
  const [status, setStatus] = useState<SpeechSettingsStatus | null>(null)
  const [draft, setDraft] = useState<SpeechSettingsInput>({
    mode: 'qwen',
    region: 'beijing',
    voice: 'Cherry',
    apiKey: ''
  })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    let active = true
    if (api)
      void api
        .get()
        .then((value) => {
          if (!active) return
          setStatus(value)
          setDraft({
            mode: value.mode,
            region: value.region,
            voice: value.voice,
            apiHost: value.apiHost,
            apiKey: ''
          })
          setMessage(value.message)
        })
        .catch(() => {
          if (active) setMessage('无法读取语音设置，请重启管理端。')
        })
    return () => {
      active = false
      mounted.current = false
    }
  }, [api])

  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    },
    [audioUrl]
  )

  const update = (value: Partial<SpeechSettingsInput>): void => {
    setDraft((previous) => ({ ...previous, ...value }))
    setDirty(true)
    setMessage('设置尚未保存。')
    setAudioUrl('')
  }

  const save = async (clearApiKey = false): Promise<void> => {
    if (!api) return
    setBusy(true)
    setAudioUrl('')
    try {
      const value = await api.save(
        clearApiKey ? { ...draft, mode: 'offline', apiKey: '', clearApiKey: true } : draft
      )
      if (!mounted.current) return
      setStatus(value)
      setDraft({
        mode: value.mode,
        region: value.region,
        voice: value.voice,
        apiHost: value.apiHost,
        apiKey: ''
      })
      setDirty(false)
      setMessage(
        value.mode === 'qwen'
          ? '已保存，全平台将优先使用云端语音；可点击测试确认连接。'
          : '已保存，全平台使用内置离线语音。'
      )
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : '保存失败，请重试。')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    if (!api) return
    setBusy(true)
    setAudioUrl('')
    setMessage('正在连接阿里云并生成试听音频…')
    try {
      const result = await api.test()
      if (!mounted.current) return
      setMessage(result.message)
      if (result.ok && result.audio) {
        setAudioUrl(
          URL.createObjectURL(new Blob([new Uint8Array(result.audio)], { type: 'audio/wav' }))
        )
      }
      const next = await api.get()
      if (mounted.current) setStatus(next)
    } catch {
      if (mounted.current) setMessage('测试未完成，请重试。')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <section className="settings-card speech-settings" aria-label="全平台语音设置">
      <div className="settings-card__title">
        <span>TTS</span>
        <div>
          <h3>全平台语音 · Qwen3-TTS</h3>
          <p>
            设备告警、AI 诊断、工单关闭提醒和员工任务统一使用此设置。云端异常时自动使用离线语音。
          </p>
        </div>
      </div>
      {!api ? (
        <p>请在管理端桌面软件中配置语音。安卓 Pad 无需填写密钥。</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <fieldset disabled={busy || !status}>
            <div className="speech-settings__fields">
              <label>
                <span>播报方式</span>
                <select
                  aria-label="播报方式"
                  value={draft.mode}
                  onChange={(event) =>
                    update({ mode: event.target.value as SpeechSettingsInput['mode'] })
                  }
                >
                  <option value="qwen">阿里云优先，离线备用</option>
                  <option value="offline">仅使用内置离线语音</option>
                </select>
              </label>
              <label>
                <span>服务地域</span>
                <select
                  aria-label="服务地域"
                  value={draft.region}
                  onChange={(event) =>
                    update({ region: event.target.value as SpeechSettingsInput['region'] })
                  }
                >
                  <option value="beijing">中国内地（北京）</option>
                  <option value="singapore">国际（新加坡）</option>
                </select>
              </label>
              <label>
                <span>语音模型</span>
                <strong>{QWEN_TTS_MODEL}</strong>
              </label>
              <label>
                <span>系统音色</span>
                <input
                  aria-label="系统音色"
                  value={draft.voice}
                  placeholder="Cherry"
                  onChange={(event) => update({ voice: event.target.value })}
                />
              </label>
              <label className="speech-settings__key">
                <span>API Host（业务空间域名）</span>
                <input
                  aria-label="API Host"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.apiHost ?? ''}
                  placeholder="旧版密钥可留空；新版填控制台提供的 ws-… 域名"
                  onChange={(event) => update({ apiHost: event.target.value })}
                />
              </label>
              <label className="speech-settings__key">
                <span>百炼 API Key</span>
                <input
                  aria-label="百炼 API Key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.apiKey ?? ''}
                  placeholder={
                    status?.hasApiKey ? '已配置；留空保持原密钥' : '填写百炼 API Key（sk-…）'
                  }
                  onChange={(event) => update({ apiKey: event.target.value })}
                />
              </label>
            </div>
            <div className="speech-settings__help">
              <p>
                使用百炼 API Key；服务地域需与密钥一致。默认音色
                Cherry，可填写该模型支持的其他系统音色。
              </p>
              <p>
                {status?.keySource === 'environment'
                  ? '当前密钥来自管理端的 DASHSCOPE_API_KEY 环境变量。'
                  : '密钥由管理端系统加密保存，不发送到 Pad，也不写入网页缓存。'}
              </p>
              <p>开启云端后，工单播报文字会发送至阿里云，按账号的可用额度或计费规则使用。</p>
              <a
                href="https://help.aliyun.com/zh/model-studio/get-api-key"
                target="_blank"
                rel="noreferrer"
              >
                查看百炼 API Key 获取说明 ↗
              </a>
            </div>
            <div className="settings-actions">
              {status?.keySource === 'saved' && (
                <button type="button" className="settings-reset" onClick={() => void save(true)}>
                  清除密钥并停用云端
                </button>
              )}
              <button
                type="button"
                className="settings-reset"
                disabled={dirty || !status?.hasApiKey}
                onClick={() => void test()}
              >
                测试云端并试听
              </button>
              <button type="submit" className="settings-save">
                {busy ? '处理中…' : '保存语音设置'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <p className="speech-settings__message" role="status">
        {message}
      </p>
      {status?.lastCloudError && (
        <p className="settings-error">最近一次云端异常：{status.lastCloudError}</p>
      )}
      {audioUrl && <audio aria-label="Qwen3-TTS 云端试听" controls src={audioUrl} />}
    </section>
  )
}
