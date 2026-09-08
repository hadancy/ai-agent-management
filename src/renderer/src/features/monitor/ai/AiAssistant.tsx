import { useCallback, useEffect, useRef, useState } from 'react'
import AssistantIcon from './AssistantIcon'
import ClearChatDialog from './ClearChatDialog'
import '../styles/ai-assistant.css'

type ChatMessage = {
  id: number
  role: 'assistant' | 'user'
  content: string
  imageUrl?: string
  diagnosis?: boolean
  thinking?: boolean
  draftStatus?: 'creating' | 'created' | 'error'
  orderNumber?: string
  draftDeduplicated?: boolean
  draftError?: string
}

type VoiceStatus = 'idle' | 'speaking' | 'completed' | 'unsupported' | 'error'
type WorkOrderDraftFeedback = { orderNumber: string; deduplicated: boolean }

const CHAT_STORAGE_KEY = 'ai-assistant-chat-messages-v2'
const DIAGNOSIS_CONTENT = [
  ['故障位置', '光明村光伏电站 · 1号组件'],
  ['可能原因', '局部遮挡、组件内部缺陷、热斑效应'],
  ['处理建议', '隔离该组串，现场确认并更换或清洗组件']
] as const
const DIAGNOSIS_VOICE_TEXT =
  '故障类型：组件热斑。故障位置：光明村光伏电站1号组件。可能原因：局部遮挡、组件内部缺陷、热斑效应。处理建议：隔离该组串，现场确认并更换或清洗组件。工单草稿已生成，等待人工审核下达。'
const VOICE_STATUS_TEXT: Record<VoiceStatus, string> = {
  idle: '语音播报',
  speaking: '停止播报',
  completed: '重新播报',
  unsupported: '系统不支持语音',
  error: '重试播报'
}
const QUICK_QUESTIONS = [
  {
    question: '如何上传故障图片？',
    answer:
      '点击输入框下方的「上传图片」，选择一张 JPG、PNG 或 WebP 图片（不超过 10 MB）。建议使用清晰的设备全景或异常部位特写。分析后会生成工单草稿，可在工单中心审核下达。'
  },
  {
    question: '分析结果包含哪些内容？',
    answer:
      '分析结果卡片包含故障类型、故障位置、可能原因和处理建议。图片上传后会展示分析结果，并创建工单草稿；你可以查看草稿编号、重新播报结果，或进入工单中心审核。'
  },
  {
    question: '工单生成后如何下达？',
    answer:
      '点击结果卡片的「查看工单」，或右侧的「查看全部工单」，进入工单中心。先核对设备、故障信息和处置建议，再审核下达；现场执行完成后，可在工单中心继续跟踪处理进度。'
  }
]
const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 1,
    role: 'assistant',
    content: '你好，我是你的运维助手。可以上传设备故障图片，查看分析结果并协同处理工单。'
  }
]

function loadStoredMessages(): ChatMessage[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHAT_STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return INITIAL_MESSAGES
    const messages = parsed
      .filter(
        (message): message is ChatMessage =>
          typeof message === 'object' &&
          message !== null &&
          typeof message.id === 'number' &&
          Number.isFinite(message.id) &&
          (message.role === 'assistant' || message.role === 'user') &&
          typeof message.content === 'string' &&
          message.thinking !== true
      )
      .map((message) =>
        message.diagnosis && message.draftStatus === 'creating'
          ? { ...message, draftStatus: 'error' as const, draftError: '上次草稿生成未完成，请重试' }
          : message
      )
    return messages.length > 0 ? messages : INITIAL_MESSAGES
  } catch {
    return INITIAL_MESSAGES
  }
}

function formatAssistantContent(content: string): string {
  // Apply the current wording to assistant replies restored from older conversations.
  return content
    .replaceAll('以下为示例诊断，请现场核实。', '')
    .replace(/当前图片分析(?:使用|为)示例诊断，/g, '')
    .replaceAll('示例诊断', '故障分析')
    .replaceAll('示例结果', '分析结果')
}

export default function AiAssistant({
  onWorkOrderCreated,
  onViewWorkOrder
}: {
  onWorkOrderCreated: () => Promise<WorkOrderDraftFeedback>
  onViewWorkOrder: () => void
}): React.JSX.Element {
  const [input, setInput] = useState('')
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle')
  const [voiceMessageId, setVoiceMessageId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>(loadStoredMessages)
  const [uploadError, setUploadError] = useState('')
  const [readingImage, setReadingImage] = useState(false)
  const [replyPending, setReplyPending] = useState(false)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const nextId = useRef(Math.max(...messages.map((message) => message.id), 0) + 1)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chatListRef = useRef<HTMLDivElement>(null)
  const pendingTimersRef = useRef<number[]>([])
  const conversationGenerationRef = useRef(0)
  const draftRequestsRef = useRef(new Set<number>())
  const voiceGenerationRef = useRef(0)
  const isEmpty =
    messages.length === 1 && !messages[0].diagnosis && messages[0].role === 'assistant'
  const isBusy =
    readingImage ||
    replyPending ||
    messages.some((message) => message.thinking || message.draftStatus === 'creating')

  useEffect(
    () => () => {
      pendingTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      conversationGenerationRef.current += 1
      voiceGenerationRef.current += 1
      window.speechSynthesis?.cancel()
    },
    []
  )

  useEffect(() => {
    const chatList = chatListRef.current
    if (chatList) chatList.scrollTop = chatList.scrollHeight
  }, [messages])

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages))
    } catch {
      try {
        window.localStorage.setItem(
          CHAT_STORAGE_KEY,
          JSON.stringify(messages.map((message) => ({ ...message, imageUrl: undefined })))
        )
      } catch {
        // Keep the current conversation usable when local storage is unavailable.
      }
    }
  }, [messages])

  const speakDiagnosis = useCallback((messageId: number): void => {
    const voiceGeneration = ++voiceGenerationRef.current
    setVoiceMessageId(messageId)
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setVoiceStatus('unsupported')
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new window.SpeechSynthesisUtterance(DIAGNOSIS_VOICE_TEXT)
    const chineseVoice = window.speechSynthesis
      .getVoices()
      .find((voice) => voice.lang.toLowerCase().startsWith('zh'))
    if (chineseVoice) utterance.voice = chineseVoice
    utterance.lang = 'zh-CN'
    utterance.rate = 0.92
    utterance.onstart = () => {
      if (voiceGeneration === voiceGenerationRef.current) setVoiceStatus('speaking')
    }
    utterance.onend = () => {
      if (voiceGeneration === voiceGenerationRef.current) setVoiceStatus('completed')
    }
    utterance.onerror = (event) => {
      if (
        voiceGeneration === voiceGenerationRef.current &&
        event.error !== 'canceled' &&
        event.error !== 'interrupted'
      )
        setVoiceStatus('error')
    }
    setVoiceStatus('speaking')
    window.speechSynthesis.speak(utterance)
  }, [])

  const createDraftForMessage = useCallback(
    async (
      messageId: number,
      conversationGeneration = conversationGenerationRef.current
    ): Promise<void> => {
      if (draftRequestsRef.current.has(messageId)) return
      draftRequestsRef.current.add(messageId)
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? { ...message, draftStatus: 'creating', orderNumber: undefined, draftError: undefined }
            : message
        )
      )
      try {
        const feedback = await onWorkOrderCreated()
        if (conversationGeneration !== conversationGenerationRef.current) return
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  draftStatus: 'created',
                  orderNumber: feedback.orderNumber,
                  draftDeduplicated: feedback.deduplicated,
                  draftError: undefined
                }
              : message
          )
        )
        speakDiagnosis(messageId)
      } catch (requestError) {
        if (conversationGeneration !== conversationGenerationRef.current) return
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  draftStatus: 'error',
                  draftError:
                    requestError instanceof Error ? requestError.message : '工单草稿生成失败'
                }
              : message
          )
        )
      } finally {
        draftRequestsRef.current.delete(messageId)
      }
    },
    [onWorkOrderCreated, speakDiagnosis]
  )

  const sendMessage = (): void => {
    const content = input.trim()
    if (!content || isBusy) return
    const userMessage: ChatMessage = { id: nextId.current++, role: 'user', content }
    const reply: ChatMessage = {
      id: nextId.current++,
      role: 'assistant',
      content:
        QUICK_QUESTIONS.find((item) => item.question === content)?.answer ??
        '已收到你的问题。请点击「上传图片」提供设备故障图片，继续查看故障类型、位置及处理建议。'
    }
    setMessages((current) => [...current, userMessage])
    setInput('')
    setReplyPending(true)
    const timer = window.setTimeout(() => {
      setMessages((current) => [...current, reply])
      setReplyPending(false)
      inputRef.current?.focus()
    }, 320)
    pendingTimersRef.current.push(timer)
  }

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || isBusy) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setUploadError('请选择 JPG、PNG 或 WebP 格式的图片。')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('图片超过 10 MB，请压缩后重新上传。')
      return
    }
    setUploadError('')
    setReadingImage(true)
    const conversationGeneration = conversationGenerationRef.current
    const reader = new FileReader()
    reader.onerror = () => {
      if (conversationGeneration !== conversationGenerationRef.current) return
      setReadingImage(false)
      setUploadError('图片读取失败，请重新选择图片。')
    }
    reader.onload = () => {
      if (conversationGeneration !== conversationGenerationRef.current) return
      const imageUrl = typeof reader.result === 'string' ? reader.result : undefined
      const userMessage: ChatMessage = {
        id: nextId.current++,
        role: 'user',
        content: file.name,
        imageUrl
      }
      const thinkingMessage: ChatMessage = {
        id: nextId.current++,
        role: 'assistant',
        content: '正在分析故障图片并准备工单草稿',
        thinking: true
      }
      const reply: ChatMessage = {
        id: thinkingMessage.id,
        role: 'assistant',
        content: DIAGNOSIS_VOICE_TEXT,
        diagnosis: true,
        draftStatus: 'creating'
      }
      setMessages((current) => [...current, userMessage, thinkingMessage])
      setReadingImage(false)
      const timer = window.setTimeout(() => {
        setMessages((current) =>
          current.map((message) => (message.id === thinkingMessage.id ? reply : message))
        )
        void createDraftForMessage(reply.id, conversationGeneration)
      }, 1800)
      pendingTimersRef.current.push(timer)
    }
    reader.readAsDataURL(file)
  }

  const closeClearDialog = useCallback((): void => setClearDialogOpen(false), [])

  const clearMessages = (): void => {
    setClearDialogOpen(false)
    conversationGenerationRef.current += 1
    pendingTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    pendingTimersRef.current = []
    voiceGenerationRef.current += 1
    window.speechSynthesis?.cancel()
    setMessages(INITIAL_MESSAGES)
    setVoiceStatus('idle')
    setVoiceMessageId(null)
    setInput('')
    setUploadError('')
    setReadingImage(false)
    setReplyPending(false)
    draftRequestsRef.current.clear()
    inputRef.current?.focus()
  }

  const fillQuestion = (question: string): void => {
    setInput(question)
    inputRef.current?.focus()
  }

  return (
    <section className="ai-panel" aria-label="运维助手对话">
      <header className="ai-heading">
        <div className="ai-heading__identity">
          <span className="ai-avatar">
            <AssistantIcon name="spark" />
          </span>
          <div>
            <h3>
              运维助手 <span>AI</span>
            </h3>
            <p>设备诊断 · 工单协同</p>
          </div>
        </div>
        <div className="ai-heading-actions">
          <button
            type="button"
            className="clear-chat-button"
            onClick={() => setClearDialogOpen(true)}
            disabled={isEmpty && !readingImage}
          >
            <AssistantIcon name="trash" /> 清空记录
          </button>
        </div>
      </header>

      <div ref={chatListRef} className={`chat-list${isEmpty ? ' chat-list--empty' : ''}`}>
        {isEmpty ? (
          <div className="ai-welcome">
            <div className="ai-welcome__symbol" aria-hidden="true">
              <span />
              <AssistantIcon name="spark" />
              <i />
            </div>
            <span className="ai-welcome__eyebrow">YOUR INTELLIGENT PARTNER</span>
            <h3>你好，今天需要处理什么问题？</h3>
            <p>
              描述设备异常，或上传一张故障图片。
              <br />
              从问题定位到工单处置，让每一步更清晰。
            </p>
            <div className="ai-capabilities">
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
                <span className="ai-capability-icon ai-capability-icon--image">
                  <AssistantIcon name="image" />
                </span>
                <strong>图片故障分析</strong>
                <span>上传现场图片，查看诊断建议</span>
                <AssistantIcon name="arrow" />
              </button>
              <button type="button" onClick={() => fillQuestion(QUICK_QUESTIONS[1].question)}>
                <span className="ai-capability-icon ai-capability-icon--analysis">
                  <AssistantIcon name="layers" />
                </span>
                <strong>结构化诊断</strong>
                <span>了解故障位置、原因及建议</span>
                <AssistantIcon name="arrow" />
              </button>
              <button type="button" onClick={onViewWorkOrder}>
                <span className="ai-capability-icon ai-capability-icon--order">
                  <AssistantIcon name="clipboard" />
                </span>
                <strong>工单协同处置</strong>
                <span>审核诊断草稿，跟进处理进度</span>
                <AssistantIcon name="arrow" />
              </button>
            </div>
          </div>
        ) : (
          <div
            className="chat-conversation"
            role="log"
            aria-label="对话记录"
            aria-live="polite"
            aria-relevant="additions text"
          >
            <div className="chat-session-label">
              <span /> 当前会话 <span />
            </div>
            {messages.map((message) => (
              <div className={`chat-row chat-row--${message.role}`} key={message.id}>
                <span className={`ai-avatar${message.role === 'user' ? ' ai-avatar--user' : ''}`}>
                  <AssistantIcon name={message.role === 'assistant' ? 'spark' : 'user'} />
                </span>
                <div className="chat-message">
                  <div className="chat-message__label">
                    {message.role === 'assistant' ? '运维助手' : '我'}
                  </div>
                  <div
                    className={`chat-bubble${message.diagnosis ? ' chat-bubble--diagnosis' : ''}`}
                  >
                    {message.imageUrl && (
                      <img className="chat-image" src={message.imageUrl} alt="用户上传的故障图片" />
                    )}
                    {message.thinking ? (
                      <div className="thinking-state" role="status">
                        <span>{message.content}</span>
                        <i />
                        <i />
                        <i />
                      </div>
                    ) : message.diagnosis ? (
                      <>
                        <div className="diagnosis-heading">
                          <span>
                            <AssistantIcon name="spark" /> 故障分析结果
                          </span>
                          <span>待现场核实</span>
                        </div>
                        <h4 className="diagnosis-title">
                          组件热斑 <span>光伏组件异常</span>
                        </h4>
                        <dl className="diagnosis-list">
                          {DIAGNOSIS_CONTENT.map(([label, value]) => (
                            <div key={label}>
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                        <div
                          className={`work-order-created work-order-created--${message.draftStatus ?? 'creating'}`}
                          role="status"
                        >
                          <AssistantIcon
                            name={message.draftStatus === 'created' ? 'check' : 'clipboard'}
                          />
                          <div>
                            <strong>
                              {message.draftStatus === 'created'
                                ? message.draftDeduplicated
                                  ? '已匹配现有未关闭工单'
                                  : '工单草稿已生成，待审核'
                                : message.draftStatus === 'error'
                                  ? '工单草稿生成失败'
                                  : '正在生成工单草稿…'}
                            </strong>
                            {message.draftStatus === 'created' && message.orderNumber && (
                              <span>{message.orderNumber}</span>
                            )}
                            {message.draftStatus === 'error' && (
                              <span>{message.draftError ?? '服务暂时不可用'}</span>
                            )}
                          </div>
                        </div>
                        <div className="diagnosis-actions">
                          <button
                            type="button"
                            className="diagnosis-voice"
                            disabled={message.draftStatus !== 'created'}
                            onClick={() => {
                              if (voiceMessageId === message.id && voiceStatus === 'speaking') {
                                voiceGenerationRef.current += 1
                                window.speechSynthesis?.cancel()
                                setVoiceStatus('idle')
                              } else speakDiagnosis(message.id)
                            }}
                          >
                            <AssistantIcon name="voice" />
                            {
                              VOICE_STATUS_TEXT[
                                voiceMessageId === message.id ? voiceStatus : 'idle'
                              ]
                            }
                          </button>
                          {message.draftStatus === 'error' ? (
                            <button
                              type="button"
                              className="diagnosis-primary"
                              onClick={() => void createDraftForMessage(message.id)}
                            >
                              <AssistantIcon name="retry" /> 重试生成
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="diagnosis-primary"
                              onClick={onViewWorkOrder}
                              disabled={message.draftStatus !== 'created'}
                            >
                              {message.draftStatus === 'created' ? '查看工单' : '生成中…'}
                              <AssistantIcon name="arrow" />
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <p>
                        {message.role === 'assistant'
                          ? formatAssistantContent(message.content)
                          : message.content}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {replyPending && (
              <div className="chat-reply-pending" role="status">
                运维助手正在回复…
              </div>
            )}
          </div>
        )}
      </div>

      <div className="chat-composer-area">
        {isEmpty && (
          <div className="chat-suggestions">
            <span>试试这样问</span>
            {QUICK_QUESTIONS.map(({ question }) => (
              <button key={question} type="button" onClick={() => fillQuestion(question)}>
                {question}
                <AssistantIcon name="arrow" />
              </button>
            ))}
          </div>
        )}
        {uploadError && (
          <div className="chat-upload-error" role="alert">
            <span>{uploadError}</span>
            <button type="button" onClick={() => setUploadError('')} aria-label="关闭上传提示">
              <AssistantIcon name="close" />
            </button>
          </div>
        )}
        <div className="chat-composer">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault()
                sendMessage()
              }
            }}
            placeholder="描述遇到的问题，或上传设备故障图片…"
            aria-label="向AI智能体提问"
            rows={2}
          />
          <div className="chat-composer__toolbar">
            <input
              ref={fileInputRef}
              className="chat-file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageUpload}
              tabIndex={-1}
              aria-label="选择设备故障图片"
            />
            <button
              type="button"
              className="upload-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
            >
              <AssistantIcon name="image" />
              {readingImage ? '读取图片中…' : '上传图片'}
            </button>
            <span className="chat-upload-hint">JPG / PNG / WebP · 最大 10 MB</span>
            <span className="chat-keyboard-hint">Enter 发送 · Shift + Enter 换行</span>
            <button
              type="button"
              className="send-button"
              onClick={sendMessage}
              disabled={!input.trim() || isBusy}
              aria-label={isBusy ? '正在处理，请稍候' : '发送消息'}
            >
              <AssistantIcon name="send" />
            </button>
          </div>
        </div>
        <div className="chat-composer__footer">
          <span>对话记录保存在本机</span>
        </div>
      </div>
      <ClearChatDialog
        open={clearDialogOpen}
        onCancel={closeClearDialog}
        onConfirm={clearMessages}
      />
    </section>
  )
}
