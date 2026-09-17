import { useEffect, useRef, useState } from 'react'
import {
  getTiltReply,
  isTiltAdjustmentPlan,
  MAX_TILT_REQUEST_LENGTH,
  type TiltAdjustmentPlan
} from '../../../../../shared/tilt-adjustment'
import {
  ANALYSIS_PROMPTS,
  OVERVIEW_CONCLUSION,
  SEASONAL_RESULT,
  seasonalConclusion,
  seasonalWorkOrderFields,
  stationDate,
  type AnalysisRound
} from '../../../../../shared/agrivoltaic-analysis'
import {
  createWorkOrderDraft,
  dispatchWorkOrder,
  getWorkOrder,
  type CreateWorkOrderDraftInput,
  type WorkOrder
} from '../workorder/api'
import { usePlatformSpeech } from '../../../speech/usePlatformSpeech'
import type { VoiceStatus } from '../../../speech/PlatformSpeechPlayer'
import AssistantIcon from './AssistantIcon'
import ClearChatDialog from './ClearChatDialog'
import TiltRequestComposer from './TiltRequestComposer'
import TiltAnalysisReply from './TiltAnalysisReply'
import '../styles/tilt-assistant.css'

const STORAGE_KEY = 'ai-tilt-assistant-chat-v1'
type Conversation = {
  plan: TiltAdjustmentPlan
  round?: AnalysisRound
  attempt?: number
  status: 'analyzing' | 'interrupted' | 'complete' | 'creating' | 'created' | 'error'
  order?: Pick<WorkOrder, 'id' | 'orderNumber' | 'status'>
  error?: string
}
const VOICE_LABELS: Record<VoiceStatus, string> = {
  idle: '语音播报',
  loading: '取消加载',
  speaking: '停止播报',
  completed: '重新播报',
  blocked: '点击播放',
  error: '重试播报'
}
function loadConversation(): Conversation[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(stored)) return []
    return stored
      .filter(
        (item): item is Conversation =>
          item &&
          isTiltAdjustmentPlan(item.plan) &&
          [undefined, 'overview', 'seasonal'].includes(item.round) &&
          ['analyzing', 'interrupted', 'complete', 'creating', 'created', 'error'].includes(
            item.status
          ) &&
          (!item.round || item.plan.analysisVersion === 2) &&
          (item.status !== 'created' ||
            (typeof item.order?.id === 'string' && typeof item.order?.orderNumber === 'string'))
      )
      .map((item) =>
        item.status === 'analyzing'
          ? { ...item, status: 'interrupted' }
          : item.status === 'creating'
            ? { ...item, status: 'error', error: '上次工单生成未完成，请重试生成。' }
            : item
      )
  } catch {
    return []
  }
}
function speechText(item: Conversation): string {
  if (item.round === 'overview') return OVERVIEW_CONCLUSION
  if (item.round === 'seasonal')
    return `${SEASONAL_RESULT.join('\n')}\n${seasonalConclusion(item.plan.analysisDate!, true)}`
  return getTiltReply(item.plan.month)
}

export default function TiltAssistant({
  clock,
  normalRange,
  serviceOrigin,
  refreshToken,
  active,
  onWorkOrderChanged,
  onViewWorkOrder
}: {
  clock: Date
  normalRange?: Pick<
    CreateWorkOrderDraftInput,
    'normalVoltage' | 'normalCurrent' | 'tolerancePercent'
  >
  serviceOrigin: string
  refreshToken: number
  active: boolean
  onWorkOrderChanged: () => void
  onViewWorkOrder: () => void
}): React.JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversation)
  const [busy, setBusy] = useState<string | null>(null)
  const [attachment, setAttachment] = useState<{ name: string; size: number } | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [clearOpen, setClearOpen] = useState(false)
  const [composerVersion, setComposerVersion] = useState(0)
  const [voiceId, setVoiceId] = useState<string | null>(null)
  const voice = usePlatformSpeech(serviceOrigin)
  const { stop: stopSpeech, speak } = voice
  const chatList = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const busyRef = useRef(false)
  const generation = useRef(0)
  const activeRef = useRef(active)
  const completed = useRef(new Set<string>())
  const hasOverview = conversations.some(
    (item) => item.round === 'overview' && item.status === 'complete'
  )
  const nextRound: AnalysisRound = attachment || !hasOverview ? 'overview' : 'seasonal'
  const orderIds = [
    ...new Set(conversations.flatMap((item) => (item.order ? [item.order.id] : [])))
  ].join(',')
  const scrollToLatest = (): void => {
    if (stickToBottom.current && chatList.current)
      chatList.current.scrollTop = chatList.current.scrollHeight
  }
  useEffect(
    () => () => {
      generation.current += 1
    },
    []
  )
  useEffect(() => {
    activeRef.current = active
    if (!active) stopSpeech()
  }, [active, stopSpeech])
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
    } catch {
      /* Session remains usable. */
    }
  }, [conversations])
  useEffect(() => {
    if (active) scrollToLatest()
  }, [conversations, active])
  useEffect(() => {
    if (!active || !orderIds) return
    const controller = new AbortController()
    void Promise.allSettled(
      orderIds.split(',').map(async (id) => {
        const { orderNumber, status } = await getWorkOrder(serviceOrigin, id, controller.signal)
        if (!controller.signal.aborted)
          setConversations((items) =>
            items.map((item) =>
              item.order?.id === id ? { ...item, order: { id, orderNumber, status } } : item
            )
          )
      })
    )
    return () => controller.abort()
  }, [active, orderIds, refreshToken, serviceOrigin])

  const playConclusion = (item: Conversation, userInitiated = false): void => {
    if (!activeRef.current) return
    setVoiceId(item.plan.requestId)
    speak(speechText(item), userInitiated)
  }
  const createDraft = async (conversation: Conversation, token: number): Promise<void> => {
    const { plan } = conversation
    setConversations((items) =>
      items.map((item) =>
        item.plan.requestId === plan.requestId
          ? { ...item, status: 'creating', error: undefined }
          : item
      )
    )
    try {
      const result = await createWorkOrderDraft(serviceOrigin, {
        ...normalRange,
        tiltAdjustment: plan
      })
      onWorkOrderChanged()
      if (token !== generation.current) return
      const { id, orderNumber, status } = result.workOrder
      const finished: Conversation = {
        ...conversation,
        status: 'created',
        order: { id, orderNumber, status },
        error: undefined
      }
      setConversations((items) =>
        items.map((item) => (item.plan.requestId === plan.requestId ? finished : item))
      )
      playConclusion(finished)
    } catch (error) {
      if (token !== generation.current) return
      setConversations((items) =>
        items.map((item) =>
          item.plan.requestId === plan.requestId
            ? {
                ...item,
                status: 'error',
                error: error instanceof Error ? error.message : '工单生成失败，请重试。'
              }
            : item
        )
      )
    } finally {
      if (token === generation.current) {
        busyRef.current = false
        setBusy(null)
      }
    }
  }
  const completeAnalysis = (item: Conversation): void => {
    const completionKey = `${item.plan.requestId}-${item.attempt ?? 0}`
    if (completed.current.has(completionKey)) return
    completed.current.add(completionKey)
    if (item.round === 'overview') {
      setConversations((items) =>
        items.map((entry) =>
          entry.plan.requestId === item.plan.requestId ? { ...entry, status: 'complete' } : entry
        )
      )
      busyRef.current = false
      setBusy(null)
      playConclusion(item)
    } else void createDraft(item, generation.current)
  }
  const submitRequest = (userRequest: string): void => {
    const request = userRequest.trim()
    if (
      !active ||
      busyRef.current ||
      !request ||
      request.length > MAX_TILT_REQUEST_LENGTH ||
      (nextRound === 'overview' && !attachment)
    )
      return
    const date = stationDate(clock)
    const previousFile = [...conversations]
      .reverse()
      .find((item) => item.round === 'overview')?.plan
    const plan: TiltAdjustmentPlan = {
      month: Number(date.slice(5, 7)),
      analysisVersion: 2,
      fieldWorkflowVersion: 1,
      analysisDate: date,
      fileName: attachment?.name ?? previousFile?.fileName ?? '',
      fileSize: attachment?.size ?? previousFile?.fileSize ?? 0,
      userRequest: request,
      requestId:
        crypto.randomUUID?.() ??
        Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
          value.toString(16).padStart(2, '0')
        ).join('')
    }
    stopSpeech()
    busyRef.current = true
    stickToBottom.current = true
    setBusy(plan.requestId)
    setAttachment(null)
    setUploadError('')
    setConversations((items) => [...items, { plan, round: nextRound, status: 'analyzing' }])
  }
  const upload = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busyRef.current) return
    if (!/\.docx?$/i.test(file.name)) {
      setUploadError('请选择 Word 项目信息文件（.doc 或 .docx）。')
      return
    }
    setAttachment({ name: file.name, size: file.size })
    setUploadError('')
  }
  const retry = (item: Conversation): void => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(item.plan.requestId)
    stickToBottom.current = true
    if (item.status === 'interrupted')
      setConversations((items) =>
        items.map((entry) =>
          entry.plan.requestId === item.plan.requestId
            ? { ...entry, status: 'analyzing', attempt: (entry.attempt ?? 0) + 1 }
            : entry
        )
      )
    else void createDraft(item, generation.current)
  }
  const dispatch = async (conversation: Conversation): Promise<void> => {
    if (busyRef.current || !conversation.order) return
    busyRef.current = true
    setBusy(conversation.plan.requestId)
    const token = generation.current
    try {
      const { id, orderNumber, status } = await dispatchWorkOrder(
        serviceOrigin,
        conversation.order.id
      )
      onWorkOrderChanged()
      if (token !== generation.current) return
      setConversations((items) =>
        items.map((item) =>
          item.plan.requestId === conversation.plan.requestId
            ? { ...item, order: { id, orderNumber, status }, error: undefined }
            : item
        )
      )
    } catch (error) {
      if (token !== generation.current) return
      setConversations((items) =>
        items.map((item) =>
          item.plan.requestId === conversation.plan.requestId
            ? { ...item, error: error instanceof Error ? error.message : '下发失败，请重试。' }
            : item
        )
      )
    } finally {
      if (token === generation.current) {
        busyRef.current = false
        setBusy(null)
      }
    }
  }

  return (
    <section className="ai-panel tilt-panel" aria-label="智能数据分析系统对话">
      <header className="ai-heading">
        <div className="ai-heading__identity">
          <span className="ai-avatar tilt-avatar">
            <AssistantIcon name="layers" />
          </span>
          <div>
            <h3>
              智能数据分析系统 <span>AI</span>
            </h3>
            <p>项目资料 · 支架净高 · 季节倾角</p>
          </div>
        </div>
        <button
          type="button"
          className="clear-chat-button"
          disabled={!conversations.length || busy !== null}
          onClick={() => setClearOpen(true)}
        >
          <AssistantIcon name="trash" />
          清空记录
        </button>
      </header>
      <div
        ref={chatList}
        className={`chat-list${conversations.length ? '' : ' chat-list--empty'}`}
        onScroll={() => {
          const list = chatList.current
          if (list)
            stickToBottom.current = list.scrollHeight - list.clientHeight - list.scrollTop < 80
        }}
      >
        {!conversations.length ? (
          <div className="ai-welcome">
            <div className="ai-welcome__symbol tilt-avatar">
              <AssistantIcon name="layers" />
            </div>
            <span className="ai-welcome__eyebrow">AGRIVOLTAIC ASSISTANT</span>
            <h3>从项目资料，到农光互补方案</h3>
            <p>上传 Word 项目信息，输入或说出你的需求，获取支架高度与倾角方案。</p>
            <div className="tilt-round-guide">
              <span>01 净高计算与方案对比</span>
              <span>02 季节倾角建议与工单</span>
            </div>
          </div>
        ) : (
          <div className="chat-conversation" role="log" aria-label="倾角对话记录">
            {conversations.map((conversation) => {
              const { plan, order, status, error, round } = conversation
              const dispatched = order && order.status !== 'pending_review'
              const finished = ['complete', 'created'].includes(status)
              const selectedVoice = voiceId === plan.requestId
              return (
                <div className="tilt-exchange" key={plan.requestId}>
                  <div className="chat-row chat-row--user">
                    <span className="ai-avatar ai-avatar--user">
                      <AssistantIcon name="user" />
                    </span>
                    <div className="chat-message">
                      <div className="chat-message__label">我</div>
                      {plan.fileName && round !== 'seasonal' && (
                        <div className="chat-bubble tilt-file">
                          <AssistantIcon name="table" />
                          <div>
                            <strong>{plan.fileName}</strong>
                            <span>{Math.ceil(plan.fileSize / 1024)} KB · 项目资料</span>
                          </div>
                        </div>
                      )}
                      {plan.userRequest && (
                        <div className="chat-bubble tilt-user-request">{plan.userRequest}</div>
                      )}
                    </div>
                  </div>
                  <div className="chat-row chat-row--assistant">
                    <span className="ai-avatar tilt-avatar">
                      <AssistantIcon name="layers" />
                    </span>
                    <div className="chat-message">
                      <div className="chat-message__label">
                        智能数据分析系统
                        {round && (
                          <span className="tilt-round-label">
                            {round === 'overview' ? '净高与技术方案' : '季节倾角策略'}
                          </span>
                        )}
                      </div>
                      <div className="chat-bubble chat-bubble--diagnosis">
                        {status === 'interrupted' ? (
                          <p>上次分析未完成，点击重新生成以继续。</p>
                        ) : round ? (
                          <TiltAnalysisReply
                            key={`${plan.requestId}-${conversation.attempt ?? 0}`}
                            round={round}
                            running={status === 'analyzing'}
                            active={active}
                            onComplete={() => completeAnalysis(conversation)}
                            onProgress={scrollToLatest}
                          />
                        ) : (
                          <p className="tilt-reply">{getTiltReply(plan.month)}</p>
                        )}
                        {['creating', 'created', 'error'].includes(status) && (
                          <>
                            <div
                              className={`work-order-created work-order-created--${status}`}
                              role="status"
                            >
                              <AssistantIcon name={status === 'created' ? 'check' : 'clipboard'} />
                              <div>
                                <strong>
                                  {status === 'creating'
                                    ? '正在生成工单…'
                                    : status === 'error'
                                      ? '工单生成失败'
                                      : dispatched
                                        ? order.status === 'closed'
                                          ? '工单已完成'
                                          : '工单已下发至 C 平台'
                                        : '工单已生成，待人工下发'}
                                </strong>
                                {order && <span>{order.orderNumber}</span>}
                              </div>
                            </div>
                            {order && plan.analysisVersion === 2 && (
                              <details className="tilt-work-order" open>
                                <summary>季节性调整工单</summary>
                                <dl>
                                  {[
                                    ['工单编号', order.orderNumber],
                                    ...seasonalWorkOrderFields(plan)
                                  ].map(([label, value]) => (
                                    <div key={label}>
                                      <dt>{label}</dt>
                                      <dd>{value}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </details>
                            )}
                          </>
                        )}
                        {round === 'seasonal' &&
                          ['creating', 'created', 'error'].includes(status) && (
                            <p className="tilt-key-conclusion" role="status">
                              {status === 'error'
                                ? '季节倾角建议已生成，工单生成失败，请重试。'
                                : seasonalConclusion(plan.analysisDate!, status === 'created')}
                            </p>
                          )}
                        {error && (
                          <p className="chat-upload-error" role="alert">
                            {error}
                          </p>
                        )}
                        <div className="diagnosis-actions">
                          {finished && (
                            <button
                              type="button"
                              className="diagnosis-voice"
                              onClick={() => {
                                if (
                                  selectedVoice &&
                                  (voice.status === 'speaking' || voice.status === 'loading')
                                )
                                  stopSpeech()
                                else if (selectedVoice && voice.status === 'blocked') voice.resume()
                                else playConclusion(conversation, true)
                              }}
                            >
                              <AssistantIcon name="voice" />
                              {selectedVoice ? VOICE_LABELS[voice.status] : '语音播报'}
                            </button>
                          )}
                          {selectedVoice && voice.status !== 'idle' && (
                            <span className="diagnosis-voice-status" role="status">
                              {voice.message}
                            </span>
                          )}
                          {order && (
                            <button
                              type="button"
                              className="diagnosis-voice"
                              onClick={onViewWorkOrder}
                            >
                              查看工单
                            </button>
                          )}
                          {status === 'error' || status === 'interrupted' ? (
                            <button
                              type="button"
                              className="diagnosis-primary"
                              disabled={busy !== null}
                              onClick={() => retry(conversation)}
                            >
                              <AssistantIcon name="retry" />
                              {status === 'interrupted' ? '重新生成' : '重试生成'}
                            </button>
                          ) : (
                            order &&
                            !dispatched && (
                              <button
                                type="button"
                                className="diagnosis-primary"
                                disabled={busy !== null}
                                onClick={() => void dispatch(conversation)}
                              >
                                {busy === plan.requestId ? '正在下发…' : '下发工单'}
                                <AssistantIcon name="arrow" />
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="tilt-composer-wrapper">
        {uploadError && (
          <p className="chat-upload-error" role="alert">
            {uploadError}
          </p>
        )}
        <TiltRequestComposer
          key={composerVersion}
          active={active && !clearOpen}
          busy={busy !== null}
          demoRequest={ANALYSIS_PROMPTS[nextRound]}
          attachment={attachment}
          requireAttachment={nextRound === 'overview'}
          onRemoveAttachment={() => setAttachment(null)}
          onUpload={upload}
          onSend={submitRequest}
        />
      </div>
      <ClearChatDialog
        open={clearOpen && active}
        onCancel={() => setClearOpen(false)}
        onConfirm={() => {
          generation.current += 1
          stopSpeech()
          setVoiceId(null)
          completed.current.clear()
          setConversations([])
          setAttachment(null)
          setUploadError('')
          setComposerVersion((value) => value + 1)
          setClearOpen(false)
        }}
      />
    </section>
  )
}
