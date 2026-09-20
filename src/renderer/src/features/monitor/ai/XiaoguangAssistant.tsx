import { useEffect, useRef, useState } from 'react'
import { findXiaoguangQuestion, XIAOGUANG_QA } from '../../../../../shared/xiaoguang-qa'
import { usePlatformSpeech } from '../../../speech/usePlatformSpeech'
import type { VoiceStatus } from '../../../speech/PlatformSpeechPlayer'
import AssistantIcon from './AssistantIcon'
import ClearChatDialog from './ClearChatDialog'
import TiltRequestComposer from './TiltRequestComposer'
import '../styles/xiaoguang-assistant.css'

const STORAGE_KEY = 'ai-xiaoguang-chat-v1'
const THINKING_DURATION_MS = 3000
type Exchange = { id: string; questionIndex: number }
const VOICE_LABELS: Record<VoiceStatus, string> = {
  idle: '语音播报',
  loading: '取消加载',
  speaking: '停止播报',
  completed: '重新播报',
  blocked: '点击播放',
  error: '重试播报'
}

function loadConversation(): Exchange[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(stored)) return []
    const ids = new Set<string>()
    return stored.filter((item): item is Exchange => {
      if (
        !item ||
        typeof item.id !== 'string' ||
        !item.id ||
        ids.has(item.id) ||
        !Number.isInteger(item.questionIndex) ||
        item.questionIndex < 0 ||
        item.questionIndex >= XIAOGUANG_QA.length
      )
        return false
      ids.add(item.id)
      return true
    })
  } catch {
    return []
  }
}

export default function XiaoguangAssistant({
  active,
  serviceOrigin
}: {
  active: boolean
  serviceOrigin: string
}): React.JSX.Element {
  const [conversations, setConversations] = useState<Exchange[]>(loadConversation)
  const questionIndex = ((conversations.at(-1)?.questionIndex ?? -1) + 1) % XIAOGUANG_QA.length
  const [composerVersion, setComposerVersion] = useState(0)
  const [clearOpen, setClearOpen] = useState(false)
  const [error, setError] = useState('')
  const [voiceId, setVoiceId] = useState<string | null>(null)
  const [pending, setPending] = useState<Exchange | null>(null)
  const voice = usePlatformSpeech(serviceOrigin)
  const { stop: stopSpeech, speak } = voice
  const list = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const submitting = useRef(false)
  const exchanges = pending ? [...conversations, pending] : conversations

  useEffect(() => {
    if (!active) stopSpeech()
  }, [active, stopSpeech])
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
    } catch {
      /* Keep the conversation usable when local storage is unavailable. */
    }
  }, [conversations])
  useEffect(() => {
    if (!pending || !active) return
    // Keep the answer and audio hidden for the full thinking interval. Switching
    // assistants pauses this pending reply; returning starts a fresh interval.
    const timer = window.setTimeout(() => {
      if (!submitting.current) return
      setConversations((items) => [...items, pending])
      setPending(null)
      submitting.current = false
      setVoiceId(pending.id)
      speak(XIAOGUANG_QA[pending.questionIndex].answer)
    }, THINKING_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [pending, active, speak])
  useEffect(() => {
    if (active && stickToBottom.current && list.current)
      list.current.scrollTop = list.current.scrollHeight
  }, [active, conversations, pending, voice.status])

  const submit = (request: string): boolean => {
    if (!active || submitting.current) return false
    const index = findXiaoguangQuestion(request)
    if (index !== questionIndex) {
      setError('请点击语音输入，按顺序填入当前问题后发送。')
      return false
    }
    const exchange = { id: crypto.randomUUID(), questionIndex: index }
    submitting.current = true
    stickToBottom.current = true
    stopSpeech()
    setVoiceId(null)
    setPending(exchange)
    setError('')
    return true
  }

  return (
    <section className="ai-panel xiaoguang-panel" aria-label="小光智能问答系统对话">
      <header className="ai-heading">
        <div className="ai-heading__identity">
          <span className="ai-avatar xiaoguang-avatar">
            <AssistantIcon name="guide" />
          </span>
          <div>
            <h3>
              小光智能问答系统 <span>AI</span>
            </h3>
            <p>光明村茶园 · 农光一体化 · 语音问答</p>
          </div>
        </div>
        <button
          type="button"
          className="clear-chat-button"
          disabled={!exchanges.length}
          onClick={() => setClearOpen(true)}
        >
          <AssistantIcon name="trash" /> 清空记录
        </button>
      </header>
      <div
        ref={list}
        className={`chat-list${exchanges.length ? '' : ' chat-list--empty'}`}
        onScroll={() => {
          if (list.current)
            stickToBottom.current =
              list.current.scrollHeight - list.current.clientHeight - list.current.scrollTop < 80
        }}
      >
        {!exchanges.length ? (
          <div className="ai-welcome">
            <div className="ai-welcome__symbol xiaoguang-avatar">
              <AssistantIcon name="guide" />
            </div>
            <span className="ai-welcome__eyebrow">XIAOGUANG ASSISTANT</span>
            <h3>同学你好，我是小光</h3>
            <p>
              茶园里装光伏，有哪些难题？
              <br />
              从安装空间、成本维护，到并网消纳和日常巡检，一起聊聊光明村。
            </p>
            <span className="xiaoguang-welcome-hint">点击下方「语音输入」，开始第一个问题</span>
          </div>
        ) : (
          <div className="chat-conversation" role="log" aria-label="小光问答记录">
            {exchanges.map((exchange) => {
              const item = XIAOGUANG_QA[exchange.questionIndex]
              const selectedVoice = voiceId === exchange.id
              return (
                <div className="xiaoguang-exchange" key={exchange.id}>
                  <div className="chat-row chat-row--user">
                    <span className="ai-avatar ai-avatar--user">
                      <AssistantIcon name="user" />
                    </span>
                    <div className="chat-message">
                      <div className="chat-message__label">同学</div>
                      <div className="chat-bubble tilt-user-request">{item.question}</div>
                    </div>
                  </div>
                  <div className="chat-row chat-row--assistant">
                    <span className="ai-avatar xiaoguang-avatar">
                      <AssistantIcon name="guide" />
                    </span>
                    <div className="chat-message">
                      <div className="chat-message__label">小光</div>
                      <div className="chat-bubble chat-bubble--diagnosis">
                        {pending?.id === exchange.id ? (
                          <div className="thinking-state xiaoguang-thinking" role="status">
                            <span>小光正在思考…</span>
                            <i aria-hidden="true" />
                            <i aria-hidden="true" />
                            <i aria-hidden="true" />
                          </div>
                        ) : (
                          <>
                            <p className="xiaoguang-answer">{item.answer}</p>
                            <div className="diagnosis-actions">
                              <button
                                type="button"
                                className="diagnosis-voice"
                                disabled={pending !== null}
                                onClick={() => {
                                  if (!active) return
                                  if (
                                    selectedVoice &&
                                    ['loading', 'speaking'].includes(voice.status)
                                  )
                                    stopSpeech()
                                  else if (selectedVoice && voice.status === 'blocked')
                                    voice.resume()
                                  else {
                                    setVoiceId(exchange.id)
                                    voice.speak(item.answer, true)
                                  }
                                }}
                              >
                                <AssistantIcon name="voice" />
                                {selectedVoice ? VOICE_LABELS[voice.status] : '语音播报'}
                              </button>
                              {selectedVoice && ['error', 'blocked'].includes(voice.status) && (
                                <span className="diagnosis-voice-status" role="status">
                                  {voice.message}
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="xiaoguang-composer">
        {error && (
          <p className="chat-upload-error" role="alert">
            {error}
          </p>
        )}
        <TiltRequestComposer
          key={composerVersion}
          active={active && !clearOpen}
          busy={pending !== null}
          demoRequest={XIAOGUANG_QA[questionIndex].question}
          onSend={submit}
          inputId="xiaoguang-request"
          label="向小光提问"
          placeholder="点击语音输入填入问题，确认后发送给小光…"
        />
      </div>
      <ClearChatDialog
        open={active && clearOpen}
        onCancel={() => setClearOpen(false)}
        onConfirm={() => {
          submitting.current = false
          setPending(null)
          stopSpeech()
          setVoiceId(null)
          setConversations([])
          setComposerVersion((version) => version + 1)
          setError('')
          setClearOpen(false)
        }}
      />
    </section>
  )
}
