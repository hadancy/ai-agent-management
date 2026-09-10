import { useEffect, useRef, useState } from 'react'
import {
  getStationMonth,
  getTiltAdvice,
  getTiltReply,
  isTiltAdjustmentPlan,
  type TiltAdjustmentPlan
} from '../../../../../shared/tilt-adjustment'
import {
  createWorkOrderDraft,
  dispatchWorkOrder,
  getWorkOrder,
  type CreateWorkOrderDraftInput,
  type WorkOrder
} from '../workorder/api'
import AssistantIcon from './AssistantIcon'
import ClearChatDialog from './ClearChatDialog'
import '../styles/tilt-assistant.css'

const STORAGE_KEY = 'ai-tilt-assistant-chat-v1'
type Conversation = {
  plan: TiltAdjustmentPlan
  status: 'creating' | 'created' | 'error'
  order?: Pick<WorkOrder, 'id' | 'orderNumber' | 'status'>
  error?: string
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
          ['creating', 'created', 'error'].includes(item.status) &&
          (item.status !== 'created' ||
            (typeof item.order?.id === 'string' && typeof item.order?.orderNumber === 'string'))
      )
      .map((item) =>
        item.status === 'creating'
          ? { ...item, status: 'error', error: '上次工单生成未完成，请重试生成。' }
          : item
      )
  } catch {
    return []
  }
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
  const [clearOpen, setClearOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const chatList = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)
  const generation = useRef(0)
  const month = getStationMonth(clock)
  const orderIds = [
    ...new Set(conversations.flatMap((item) => (item.order ? [item.order.id] : [])))
  ].join(',')

  useEffect(
    () => () => {
      generation.current += 1
    },
    []
  )
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
    } catch {
      /* Keep the current session usable. */
    }
  }, [conversations])
  useEffect(() => {
    if (active && chatList.current) chatList.current.scrollTop = chatList.current.scrollHeight
  }, [conversations, active])
  useEffect(() => {
    if (!active || !orderIds) return
    const controller = new AbortController()
    void Promise.allSettled(
      orderIds.split(',').map(async (id) => {
        const { orderNumber, status } = await getWorkOrder(serviceOrigin, id, controller.signal)
        if (!controller.signal.aborted) {
          setConversations((items) =>
            items.map((item) =>
              item.order?.id === id ? { ...item, order: { id, orderNumber, status } } : item
            )
          )
        }
      })
    )
    return () => controller.abort()
  }, [active, orderIds, refreshToken, serviceOrigin])

  const createDraft = async (plan: TiltAdjustmentPlan, token: number): Promise<void> => {
    setConversations((items) =>
      items.map((item) =>
        item.plan.requestId === plan.requestId
          ? { ...item, status: 'creating', error: undefined }
          : item
      )
    )
    try {
      const result = await createWorkOrderDraft(serviceOrigin, {
        normalVoltage: normalRange?.normalVoltage,
        normalCurrent: normalRange?.normalCurrent,
        tolerancePercent: normalRange?.tolerancePercent,
        tiltAdjustment: plan
      })
      onWorkOrderChanged()
      if (token !== generation.current) return
      const { id, orderNumber, status } = result.workOrder
      setConversations((items) =>
        items.map((item) =>
          item.plan.requestId === plan.requestId
            ? { ...item, status: 'created', order: { id, orderNumber, status }, error: undefined }
            : item
        )
      )
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
    }
  }

  const upload = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busyRef.current) return
    const plan: TiltAdjustmentPlan = {
      month,
      fileName: file.name,
      fileSize: file.size,
      requestId:
        crypto.randomUUID?.() ??
        Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
          value.toString(16).padStart(2, '0')
        ).join('')
    }
    const token = generation.current
    busyRef.current = true
    setBusy('upload')
    try {
      // The file selection triggers the fixed seasonal reply; its contents are not needed.
      setConversations((items) => [...items, { plan, status: 'creating' }])
      await createDraft(plan, token)
    } finally {
      busyRef.current = false
      if (token === generation.current) setBusy(null)
    }
  }

  const retry = async (plan: TiltAdjustmentPlan): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(plan.requestId)
    try {
      await createDraft(plan, generation.current)
    } finally {
      busyRef.current = false
      setBusy(null)
    }
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
      busyRef.current = false
      if (token === generation.current) setBusy(null)
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
            <p>项目资料 · 季节倾角 · 工单协同</p>
          </div>
        </div>
        <button
          type="button"
          className="clear-chat-button"
          disabled={!conversations.length || busy !== null}
          onClick={() => setClearOpen(true)}
        >
          <AssistantIcon name="trash" /> 清空记录
        </button>
      </header>
      <div ref={chatList} className={`chat-list${conversations.length ? '' : ' chat-list--empty'}`}>
        {!conversations.length ? (
          <div className="ai-welcome">
            <div className="ai-welcome__symbol tilt-avatar">
              <AssistantIcon name="layers" />
            </div>
            <span className="ai-welcome__eyebrow">AGRIVOLTAIC ASSISTANT</span>
            <h3>上传项目资料，让我为你提供帮助</h3>
            <p>你好，请上传项目资料，我会为你提供相关建议。</p>
          </div>
        ) : (
          <div
            className="chat-conversation"
            role="log"
            aria-label="倾角对话记录"
            aria-live="polite"
          >
            {conversations.map((conversation) => {
              const { plan, order, status, error } = conversation
              const advice = getTiltAdvice(plan.month)
              const dispatched = order && order.status !== 'pending_review'
              return (
                <div className="tilt-exchange" key={plan.requestId}>
                  <div className="chat-row chat-row--user">
                    <span className="ai-avatar ai-avatar--user">
                      <AssistantIcon name="user" />
                    </span>
                    <div className="chat-message">
                      <div className="chat-message__label">我</div>
                      <div className="chat-bubble tilt-file">
                        <AssistantIcon name="table" />
                        <div>
                          <strong>{plan.fileName}</strong>
                          <span>{Math.ceil(plan.fileSize / 1024)} KB · 项目资料</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="chat-row chat-row--assistant">
                    <span className="ai-avatar tilt-avatar">
                      <AssistantIcon name="layers" />
                    </span>
                    <div className="chat-message">
                      <div className="chat-message__label">智能数据分析系统</div>
                      <div className="chat-bubble chat-bubble--diagnosis">
                        <div className="diagnosis-heading">
                          <span>
                            <AssistantIcon name="layers" /> 组件倾角建议
                          </span>
                        </div>
                        <p className="tilt-reply">{getTiltReply(plan.month)}</p>
                        <h4 className="tilt-execute">
                          执行{advice.season}倾角{' '}
                          <span>
                            {advice.minAngle}～{advice.maxAngle}°
                          </span>
                        </h4>
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
                        {error && (
                          <p className="chat-upload-error" role="alert">
                            {error}
                          </p>
                        )}
                        <div className="diagnosis-actions">
                          <button
                            type="button"
                            className="diagnosis-voice"
                            onClick={onViewWorkOrder}
                          >
                            查看工单
                          </button>
                          {status === 'error' ? (
                            <button
                              type="button"
                              className="diagnosis-primary"
                              disabled={busy !== null}
                              onClick={() => void retry(plan)}
                            >
                              <AssistantIcon name="retry" /> 重试生成
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
      <div className="chat-composer-area">
        <div className="tilt-upload-composer">
          <div>
            <strong>上传项目资料</strong>
            <p>选择项目资料，获取相关建议与帮助。</p>
            <span>支持任意格式文件</span>
          </div>
          <input
            ref={fileInput}
            type="file"
            className="chat-file-input"
            aria-label="选择项目资料"
            onChange={(event) => void upload(event)}
            tabIndex={-1}
          />
          <button
            type="button"
            className="diagnosis-primary"
            disabled={busy !== null}
            onClick={() => fileInput.current?.click()}
          >
            <AssistantIcon name="table" />
            {busy === 'upload' ? '正在生成…' : '上传资料'}
          </button>
        </div>
      </div>
      <ClearChatDialog
        open={clearOpen && active}
        onCancel={() => setClearOpen(false)}
        onConfirm={() => {
          generation.current += 1
          setConversations([])
          setClearOpen(false)
        }}
      />
    </section>
  )
}
