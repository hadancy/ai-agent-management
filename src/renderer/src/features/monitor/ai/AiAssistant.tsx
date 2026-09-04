import { useCallback, useEffect, useRef, useState } from 'react'
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

type WorkOrderDraftFeedback = {
  orderNumber: string
  deduplicated: boolean
}

const CHAT_STORAGE_KEY = 'ai-assistant-chat-messages-v2'

const DIAGNOSIS_CONTENT = [
  ['故障类型', '组件热斑'],
  ['故障位置', '光明村光伏电站1号组件'],
  ['可能原因', '局部遮挡、组件内部缺陷、热斑效应'],
  ['处理建议', '隔离该组串，现场确认并更换或清洗组件']
] as const

const DIAGNOSIS_VOICE_TEXT =
  '故障类型：组件热斑。故障位置：光明村光伏电站1号组件。可能原因：局部遮挡、组件内部缺陷、热斑效应。处理建议：隔离该组串，现场确认并更换或清洗组件。工单草稿已生成，等待人工审核下达。'

const VOICE_STATUS_TEXT: Record<VoiceStatus, string> = {
  idle: '等待语音播报',
  speaking: '正在语音播报',
  completed: '语音播报已完成',
  unsupported: '当前系统不支持语音播报',
  error: '语音播报失败'
}

const INITIAL_MESSAGES: ChatMessage[] = [
  { id: 1, role: 'assistant', content: '您好，我可以帮助分析设备运行数据、故障截图和告警原因。' }
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
          (message.role === 'assistant' || message.role === 'user') &&
          typeof message.content === 'string' &&
          message.thinking !== true
      )
      .map((message) =>
        message.diagnosis && message.draftStatus === 'creating'
          ? {
              ...message,
              draftStatus: 'error' as const,
              draftError: '上次草稿生成未完成，请重试'
            }
          : message
      )
    return messages.length > 0 ? messages : INITIAL_MESSAGES
  } catch {
    return INITIAL_MESSAGES
  }
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
  const [messages, setMessages] = useState<ChatMessage[]>(loadStoredMessages)
  const nextId = useRef(Math.max(...messages.map((message) => message.id), 0) + 1)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chatListRef = useRef<HTMLDivElement>(null)
  const pendingTimersRef = useRef<number[]>([])
  const conversationGenerationRef = useRef(0)
  const draftRequestsRef = useRef(new Set<number>())

  useEffect(() => () => pendingTimersRef.current.forEach((timer) => window.clearTimeout(timer)), [])

  useEffect(() => {
    const chatList = chatListRef.current
    if (chatList) chatList.scrollTop = chatList.scrollHeight
  }, [messages])

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages))
    } catch {
      const messagesWithoutImages = messages.map((message) => ({ ...message, imageUrl: undefined }))
      try {
        window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messagesWithoutImages))
      } catch {
        // The current session remains usable when local storage is unavailable.
      }
    }
  }, [messages])

  const speakDiagnosis = useCallback((): void => {
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
    utterance.pitch = 1
    utterance.volume = 1
    utterance.onstart = () => setVoiceStatus('speaking')
    utterance.onend = () => setVoiceStatus('completed')
    utterance.onerror = (event) => {
      if (event.error !== 'canceled') setVoiceStatus('error')
    }
    window.speechSynthesis.speak(utterance)
  }, [])

  const appendReply = useCallback((reply: ChatMessage, callback?: () => void): void => {
    const timer = window.setTimeout(() => {
      setMessages((current) => [...current, reply])
      callback?.()
    }, 320)
    pendingTimersRef.current.push(timer)
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
            ? {
                ...message,
                draftStatus: 'creating',
                orderNumber: undefined,
                draftError: undefined
              }
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
        speakDiagnosis()
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
    if (!content) return

    const userMessage: ChatMessage = { id: nextId.current++, role: 'user', content }
    const reply: ChatMessage = {
      id: nextId.current++,
      role: 'assistant',
      content: '请上传设备故障图片，我将为您分析故障类型、位置及处理建议。'
    }
    setMessages((current) => [...current, userMessage])
    setInput('')
    appendReply(reply)
  }

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    if (!file) return

    const conversationGeneration = conversationGenerationRef.current
    const reader = new FileReader()
    reader.onload = () => {
      if (conversationGeneration !== conversationGenerationRef.current) return
      const imageUrl = typeof reader.result === 'string' ? reader.result : undefined
      const userMessage: ChatMessage = {
        id: nextId.current++,
        role: 'user',
        content: `已上传故障图片：${file.name}`,
        imageUrl
      }
      const thinkingMessage: ChatMessage = {
        id: nextId.current++,
        role: 'assistant',
        content: '正在识别图片并分析故障',
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
      setVoiceStatus('idle')
      const timer = window.setTimeout(() => {
        setMessages((current) =>
          current.map((message) => (message.id === thinkingMessage.id ? reply : message))
        )
        void createDraftForMessage(reply.id, conversationGeneration)
      }, 3000)
      pendingTimersRef.current.push(timer)
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  const clearMessages = (): void => {
    if (!window.confirm('确定要清空全部聊天记录吗？')) return

    conversationGenerationRef.current += 1
    pendingTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    pendingTimersRef.current = []
    window.speechSynthesis?.cancel()
    window.localStorage.removeItem(CHAT_STORAGE_KEY)
    setMessages(INITIAL_MESSAGES)
    setVoiceStatus('idle')
    setInput('')
    nextId.current = 2
    draftRequestsRef.current.clear()
  }

  return (
    <section className="panel ai-panel">
      <div className="panel-heading ai-heading">
        <h2>
          <span className="title-icon">AI</span>AI 智能体对话
        </h2>
        <div className="ai-heading-actions">
          <button
            type="button"
            className="clear-chat-button"
            onClick={clearMessages}
            disabled={messages.length <= 1}
          >
            清空记录
          </button>
          <span className="online-state">
            <i />
            在线
          </span>
        </div>
      </div>
      <div ref={chatListRef} className="chat-list" aria-live="polite">
        {messages.map((message) => (
          <div className={`chat-row chat-row--${message.role}`} key={message.id}>
            {message.role === 'assistant' && (
              <span className="bot-avatar" aria-hidden="true">
                ⌁
              </span>
            )}
            <div className="chat-bubble">
              {message.imageUrl && (
                <img className="chat-image" src={message.imageUrl} alt="用户上传的故障图片" />
              )}
              {message.thinking ? (
                <div className="thinking-state" role="status">
                  <span>{message.content}</span>
                  <i aria-hidden="true" />
                  <i aria-hidden="true" />
                  <i aria-hidden="true" />
                </div>
              ) : message.diagnosis ? (
                <>
                  <ul className="diagnosis-list">
                    {DIAGNOSIS_CONTENT.map(([label, value]) => (
                      <li key={label}>
                        <strong>{label}：</strong>
                        <span>{value}</span>
                      </li>
                    ))}
                  </ul>
                  <p
                    className={`work-order-created work-order-created--${message.draftStatus ?? 'creating'}`}
                  >
                    {message.draftStatus === 'created' ? (
                      <>
                        {message.draftDeduplicated
                          ? '已匹配现有未关闭工单'
                          : '工单草稿已生成，待审核'}
                        {message.orderNumber ? `：${message.orderNumber}` : ''}
                      </>
                    ) : message.draftStatus === 'error' ? (
                      `草稿生成失败：${message.draftError ?? '服务暂时不可用'}`
                    ) : (
                      '正在生成工单草稿…'
                    )}
                  </p>
                  <div className="diagnosis-actions">
                    <span className={`voice-state voice-state--${voiceStatus}`}>
                      <i aria-hidden="true" />
                      {VOICE_STATUS_TEXT[voiceStatus]}
                    </span>
                    {message.draftStatus === 'error' ? (
                      <button type="button" onClick={() => void createDraftForMessage(message.id)}>
                        重试生成
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={onViewWorkOrder}
                        disabled={message.draftStatus !== 'created'}
                      >
                        {message.draftStatus === 'created' ? '查看工单' : '生成中…'}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p>{message.content}</p>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="chat-composer">
        <input
          ref={fileInputRef}
          className="chat-file-input"
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          aria-label="上传设备故障图片"
        />
        <button
          type="button"
          className="upload-button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="上传设备故障图片"
        >
          ▧
        </button>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && sendMessage()}
          placeholder="请输入问题或上传图片..."
          aria-label="向AI智能体提问"
        />
        <button type="button" className="send-button" onClick={sendMessage}>
          发送
        </button>
      </div>
    </section>
  )
}
