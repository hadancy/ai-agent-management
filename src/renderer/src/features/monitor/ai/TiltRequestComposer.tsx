import { useEffect, useRef, useState } from 'react'
import { MAX_TILT_REQUEST_LENGTH } from '../../../../../shared/tilt-adjustment'
import AssistantIcon from './AssistantIcon'

export default function TiltRequestComposer({
  active,
  busy,
  demoRequest,
  attachment,
  requireAttachment,
  onRemoveAttachment,
  onUpload,
  onSend
}: {
  active: boolean
  busy: boolean
  demoRequest: string
  attachment: { name: string; size: number } | null
  requireAttachment: boolean
  onRemoveAttachment: () => void
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void
  onSend: (request: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [recording, setRecording] = useState(false)
  const [voiceHint, setVoiceHint] = useState('点击语音输入，说完后确认文字并发送')
  const beforeSpeech = useRef('')
  const speechResult = useRef('')
  const input = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const composing = useRef(false)

  useEffect(() => {
    if (!recording) return
    const cancel = (): void => {
      setDraft(beforeSpeech.current)
      setRecording(false)
      setVoiceHint('已取消语音输入，原有文字已保留')
    }
    if (!active || busy) {
      cancel()
      return
    }
    // Presentation-only transcription: no microphone, recording, or speech service is used.
    let length = 0
    const prefix = beforeSpeech.current ? `${beforeSpeech.current}\n` : ''
    const timer = window.setInterval(() => {
      length = Math.min(length + 1, demoRequest.length)
      setDraft(prefix + demoRequest.slice(0, length))
      if (length === demoRequest.length) {
        window.clearInterval(timer)
        setRecording(false)
        setVoiceHint('文字已生成，可修改后点击发送')
        input.current?.focus()
      }
    }, 140)
    const onVisibility = (): void => {
      if (document.hidden) cancel()
    }
    window.addEventListener('blur', cancel)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('blur', cancel)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [recording, active, busy, demoRequest])

  const toggleVoice = (): void => {
    if (recording) {
      setDraft(speechResult.current)
      setRecording(false)
      setVoiceHint('文字已生成，可修改后点击发送')
      input.current?.focus()
      return
    }
    beforeSpeech.current = draft
    speechResult.current = `${draft ? `${draft}\n` : ''}${demoRequest}`
    setVoiceHint('请说话，文字正在生成…')
    setRecording(true)
  }
  const cancelVoice = (): void => {
    setDraft(beforeSpeech.current)
    setRecording(false)
    setVoiceHint('已取消语音输入，原有文字已保留')
    input.current?.focus()
  }
  const submit = (): void => {
    const request = draft.trim()
    if (
      !active ||
      busy ||
      recording ||
      !request ||
      request.length > MAX_TILT_REQUEST_LENGTH ||
      (requireAttachment && !attachment)
    )
      return
    onSend(request)
    setDraft('')
    setVoiceHint('点击语音输入，说完后确认文字并发送')
  }
  const voiceFull = draft.length + demoRequest.length + (draft ? 1 : 0) > MAX_TILT_REQUEST_LENGTH

  return (
    <div className="chat-composer-area tilt-composer-area">
      <form
        className={`chat-composer tilt-request-composer${recording ? ' tilt-request-composer--speaking' : ''}`}
        aria-label="用户需求输入"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {attachment && (
          <div className="tilt-attachment">
            <AssistantIcon name="table" />
            <span>
              <strong>{attachment.name}</strong>
              <small>{Math.ceil(attachment.size / 1024)} KB · 已添加，发送后分析</small>
            </span>
            <button
              type="button"
              aria-label="移除附件"
              disabled={busy || recording}
              onClick={onRemoveAttachment}
            >
              <AssistantIcon name="close" />
            </button>
          </div>
        )}
        <label className="tilt-composer-label" htmlFor="tilt-request">
          你的需求
        </label>
        <textarea
          ref={input}
          id="tilt-request"
          placeholder="请输入光伏组件倾角、高度等分析需求，或点击下方语音输入…"
          rows={2}
          maxLength={MAX_TILT_REQUEST_LENGTH}
          value={draft}
          readOnly={recording}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && recording) cancelVoice()
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              !composing.current &&
              event.keyCode !== 229
            ) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="chat-composer__toolbar tilt-composer-toolbar">
          <input
            ref={fileInput}
            type="file"
            accept=".doc,.docx"
            className="chat-file-input"
            aria-label="选择项目资料"
            onChange={onUpload}
            tabIndex={-1}
          />
          <button
            type="button"
            className="upload-button"
            disabled={busy || recording}
            onClick={() => fileInput.current?.click()}
          >
            <AssistantIcon name="table" />
            上传 Word
          </button>
          <button
            type="button"
            className="tilt-voice-button"
            aria-pressed={recording}
            disabled={busy || (!recording && voiceFull)}
            title={voiceFull && !recording ? '输入内容较长，请先编辑或发送' : '模拟语音转文字'}
            onClick={toggleVoice}
          >
            <AssistantIcon name="microphone" />
            {recording ? '结束说话' : '语音输入'}
          </button>
          {recording && (
            <button type="button" className="tilt-voice-cancel" onClick={cancelVoice}>
              取消
            </button>
          )}
          <span className="chat-keyboard-hint">Enter 发送 · Shift + Enter 换行</span>
          <button
            type="submit"
            className="tilt-send-button"
            disabled={busy || recording || !draft.trim() || (requireAttachment && !attachment)}
          >
            <AssistantIcon name="send" />
            发送
          </button>
        </div>
      </form>
      <div className="tilt-composer-status" role="status" aria-live="polite">
        {recording && (
          <span className="tilt-voice-wave" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        )}
        <span>{voiceHint}</span>
        {/* <span className="tilt-voice-badge">模拟转文字</span> */}
      </div>
    </div>
  )
}
