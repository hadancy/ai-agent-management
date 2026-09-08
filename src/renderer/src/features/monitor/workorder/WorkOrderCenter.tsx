import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STATION_TIME_ZONE } from '../../../../../shared/plc-clock'
import { compareWorkOrders } from '../../../../../shared/work-order-sort'
import {
  deleteWorkOrder,
  dispatchWorkOrder,
  getWorkOrder,
  listWorkOrders,
  type PlcVerification,
  type WorkOrder,
  type WorkOrderRole,
  type WorkOrderStatus,
  type WorkOrderTask,
  type WorkOrderTaskStatus
} from './api'
import DeleteWorkOrderDialog from './DeleteWorkOrderDialog'
import '../styles/work-order-center.css'

const STATUS_META: Record<WorkOrderStatus, { label: string; description: string }> = {
  pending_review: { label: '待审核', description: '草稿已生成，等待人工审核下达' },
  dispatched: { label: '已下达', description: '任务已推送至 A、B、C 三台 Pad' },
  in_progress: { label: '处理中', description: '现场人员正在执行并回填任务' },
  plc_verifying: { label: 'PLC 验证中', description: '三人已提交，正在验证设备数据是否连续正常' },
  closed: { label: '已处理', description: '人员回填和 PLC 恢复条件均已满足' }
}

const TASK_STATUS_LABEL: Record<WorkOrderTaskStatus, string> = {
  pending: '待处理',
  in_progress: '处理中',
  submitted: '已提交'
}

const ROLE_META: Record<WorkOrderRole, { title: string }> = {
  A: { title: '安全监护' },
  B: { title: '隔离、验电与恢复' },
  C: { title: '热斑确认与处理' }
}

const RESULT_LABELS: Record<string, string> = {
  monitoringCompleted: '全程监护',
  unresolvedHazards: '未解决安全隐患',
  isolationConfirmed: '组串隔离',
  voltageTestPassed: '验电结果',
  safetyMeasuresConfirmed: '安全措施',
  restorationConfirmed: '恢复连接',
  powerRestored: '恢复送电',
  hotspotConfirmed: '热斑确认',
  faultConfirmed: '故障确认',
  treatmentSummary: '处理记录',
  treatmentAction: '处理方式',
  retestPassed: '复测结果',
  measuredTemperature: '测量温度',
  checkpointNotes: '隔离验电备注',
  restorationNotes: '恢复送电备注',
  notes: '备注'
}

const TREATMENT_LABELS: Record<string, string> = {
  cleaned: '已清理遮挡物',
  replaced: '已更换故障组件',
  no_fault: '现场未发现故障'
}

const FLOW_STATUSES: WorkOrderStatus[] = [
  'pending_review',
  'dispatched',
  'in_progress',
  'plc_verifying',
  'closed'
]

const DETAIL_TABS = [
  { id: 'overview', label: '工单概览' },
  { id: 'tasks', label: '人员任务' },
  { id: 'verification', label: '设备验证' }
] as const
type DetailTab = (typeof DETAIL_TABS)[number]['id']

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: STATION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
    .format(date)
    .replaceAll('/', '-')
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'
}

function formatResultValue(key: string, value: unknown): string {
  if (key === 'treatmentAction' && typeof value === 'string') {
    return TREATMENT_LABELS[value] ?? value
  }
  if (key === 'measuredTemperature' && typeof value === 'number') return `${value} ℃`
  if (typeof value === 'boolean') {
    if (key === 'unresolvedHazards') return value ? '有' : '无'
    if (key === 'voltageTestPassed' || key === 'retestPassed') return value ? '合格' : '不合格'
    return value ? '已确认' : '未确认'
  }
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  return JSON.stringify(value)
}

function resultValueState(key: string, value: unknown): 'success' | 'danger' | 'neutral' {
  if (typeof value !== 'boolean') return 'neutral'
  if (key === 'unresolvedHazards') return value ? 'danger' : 'success'
  return value ? 'success' : 'danger'
}

function activeTaskStep(task: WorkOrderTask): number {
  if (task.submittedAt || task.status === 'submitted') return 3
  if (task.role === 'B' && task.checkpointAt) return 2
  if (task.startedAt || task.status === 'in_progress') return 1
  return 0
}

function TaskCard({
  task,
  workOrderStatus
}: {
  task: WorkOrderTask
  workOrderStatus: WorkOrderStatus
}): React.JSX.Element {
  const resultEntries = Object.entries(task.result ?? {}).filter(
    ([key, value]) => key !== 'role' && value !== undefined && value !== null && value !== ''
  )
  const currentStep = workOrderStatus === 'pending_review' ? -1 : activeTaskStep(task)
  const milestones =
    task.role === 'B'
      ? ['Pad 已接收', '已开始', '隔离验电确认', '恢复送电已提交']
      : ['Pad 已接收', '已开始', '现场处理', '结果已提交']

  return (
    <article className={`work-task work-task--${task.role.toLowerCase()}`}>
      <header>
        <span className="work-task__role">{task.role}</span>
        <div>
          <strong>{task.assigneeName}</strong>
          <small>
            {task.role === 'C' && task.title !== '热斑确认与处理'
              ? '现场检查与处理'
              : ROLE_META[task.role].title}
          </small>
        </div>
        <em className={`task-state task-state--${task.status}`}>
          {TASK_STATUS_LABEL[task.status]}
        </em>
      </header>
      <h5>{task.title}</h5>
      <p className="work-task__description">{task.description}</p>

      <div className="task-milestones" aria-label={`${task.assigneeName}任务进度`}>
        {milestones.map((milestone, index) => (
          <span
            className={
              index <= currentStep ? 'task-milestone task-milestone--done' : 'task-milestone'
            }
            key={milestone}
          >
            <i>{index < currentStep || currentStep === 3 ? '✓' : index + 1}</i>
            {milestone}
          </span>
        ))}
      </div>

      <div className="work-task__risks">
        <b>风险点</b>
        <div>
          {task.risks.map((risk) => (
            <span key={risk}>{risk}</span>
          ))}
        </div>
      </div>

      {task.blockedReason && <p className="work-task__blocked">当前等待：{task.blockedReason}</p>}

      <div className="work-task__result">
        <div className="work-task__result-title">
          <b>回填结果</b>
          <time>{task.submittedAt ? formatDateTime(task.submittedAt) : '尚未提交'}</time>
        </div>
        {resultEntries.length > 0 ? (
          <dl>
            {resultEntries.map(([key, value]) => (
              <div key={key}>
                <dt>{RESULT_LABELS[key] ?? key}</dt>
                <dd className={`result-value--${resultValueState(key, value)}`}>
                  {formatResultValue(key, value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>等待 {task.assigneeName} 在 Pad 端回填</p>
        )}
      </div>
    </article>
  )
}

function buildPadAddress(padUrl: string, role: WorkOrderRole): string {
  const url = new URL(padUrl)
  url.searchParams.set('role', role)
  return url.toString()
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const input = document.createElement('textarea')
  input.value = value
  input.readOnly = true
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.appendChild(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('浏览器未允许复制')
}

function PadAccessPanel({
  padUrl,
  tasks
}: {
  padUrl?: string
  tasks: WorkOrderTask[]
}): React.JSX.Element {
  const [copiedRole, setCopiedRole] = useState<WorkOrderRole | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)

  const addresses = (['A', 'B', 'C'] as const).map((role) => ({
    role,
    assigneeName: tasks.find((task) => task.role === role)?.assigneeName ?? `${role}员工`,
    address: padUrl ? buildPadAddress(padUrl, role) : null
  }))

  const handleCopy = async (role: WorkOrderRole, address: string | null): Promise<void> => {
    if (!address) return
    try {
      await copyText(address)
      setCopiedRole(role)
      setCopyError(null)
    } catch {
      setCopiedRole(null)
      setCopyError('复制失败，请选中地址后手动复制。')
    }
  }

  return (
    <details className="pad-access">
      <summary className="pad-access__heading">
        <div>
          <strong>员工 Pad 访问地址</strong>
          <span>展开后可复制 A / B / C 员工的专属入口</span>
        </div>
        <span className="pad-access__chevron" aria-hidden="true">
          ⌄
        </span>
      </summary>
      <div className="pad-access__addresses">
        {addresses.map(({ role, assigneeName, address }) => (
          <div className={`pad-access__item pad-access__item--${role.toLowerCase()}`} key={role}>
            <span className="pad-access__role">{role}</span>
            <div>
              <strong>{assigneeName}</strong>
              <code title={address ?? undefined}>{address ?? '正在获取局域网地址…'}</code>
            </div>
            <button
              type="button"
              onClick={() => void handleCopy(role, address)}
              disabled={!address}
              aria-label={`复制${assigneeName} Pad 端地址`}
            >
              {copiedRole === role ? '已复制' : '复制地址'}
            </button>
          </div>
        ))}
      </div>
      <p className={copyError ? 'pad-access__tip pad-access__tip--error' : 'pad-access__tip'}>
        {copyError ?? 'Pad 与本机需连接同一局域网；地址中的 role 参数用于区分 A、B、C 员工。'}
      </p>
    </details>
  )
}

function PlcVerificationCard({
  verification,
  status
}: {
  verification: PlcVerification | null
  status: WorkOrderStatus
}): React.JSX.Element {
  const required = verification?.requiredConsecutiveSamples ?? 5
  const current = status === 'closed' ? required : (verification?.consecutiveNormalSamples ?? 0)
  const progress = Math.min(100, Math.max(0, (current / Math.max(required, 1)) * 100))
  const lastSampleText =
    verification?.lastSampleNormal === true
      ? '本次采样正常'
      : verification?.lastSampleNormal === false
        ? '本次采样异常，已重新计数'
        : '等待 PLC 采样'

  return (
    <section className="plc-verification" aria-labelledby="plc-verification-title">
      <div className="plc-verification__heading">
        <div>
          <span className="plc-verification__icon">PLC</span>
          <div>
            <h4 id="plc-verification-title">设备恢复验证</h4>
            <p>人员结果全部合格后，连续 {required} 次采样正常才能自动关单。</p>
          </div>
        </div>
        <strong className={status === 'closed' ? 'plc-state plc-state--success' : 'plc-state'}>
          {status === 'closed'
            ? '验证通过'
            : status === 'plc_verifying'
              ? `验证中 ${current}/${required}`
              : '尚未启动'}
        </strong>
      </div>
      <div className="plc-verification__progress">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="plc-verification__samples">
        <p>
          <span>最后采样</span>
          <strong>{formatDateTime(verification?.lastCheckedAt)}</strong>
        </p>
        <p>
          <span>电压</span>
          <strong>{formatNumber(verification?.lastVoltage)} V</strong>
        </p>
        <p>
          <span>电流</span>
          <strong>{formatNumber(verification?.lastCurrent)} A</strong>
        </p>
        <p>
          <span>判定</span>
          <strong
            className={verification?.lastSampleNormal === false ? 'sample-danger' : 'sample-normal'}
          >
            {lastSampleText}
          </strong>
        </p>
      </div>
    </section>
  )
}

export default function WorkOrderCenter({
  serviceOrigin,
  padUrl,
  refreshToken,
  onBack,
  onOpenAssistant,
  onCountChange
}: {
  serviceOrigin: string
  padUrl?: string
  refreshToken: number
  onBack: () => void
  onOpenAssistant: () => void
  onCountChange?: (count: number) => void
}): React.JSX.Element {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<WorkOrder | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshCounter, setRefreshCounter] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dispatching, setDispatching] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Pick<WorkOrder, 'id' | 'orderNumber'> | null>(
    null
  )
  const dispatchingRef = useRef(false)
  const deletingRef = useRef(false)
  const selectedIdRef = useRef<string | null>(null)
  const sortedOrders = useMemo(() => [...orders].sort(compareWorkOrders), [orders])

  const counts = useMemo(
    () => ({
      pendingReview: orders.filter((order) => order.status === 'pending_review').length,
      running: orders.filter(
        (order) => order.status === 'dispatched' || order.status === 'in_progress'
      ).length,
      verifying: orders.filter((order) => order.status === 'plc_verifying').length,
      closed: orders.filter((order) => order.status === 'closed').length
    }),
    [orders]
  )

  const requestRefresh = useCallback((): void => {
    setRefreshing(true)
    setRefreshCounter((value) => value + 1)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(requestRefresh, 12000)
    return () => window.clearInterval(timer)
  }, [requestRefresh])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    const load = async (): Promise<void> => {
      try {
        const response = await listWorkOrders(serviceOrigin, controller.signal)
        if (!active) return
        setOrders(response.items)
        setTotal(response.total)
        setError(null)
        onCountChange?.(response.items.filter((order) => order.status !== 'closed').length)
        const selectedStillExists = response.items.find(
          (order) => order.id === selectedIdRef.current
        )
        const nextSelected =
          selectedStillExists ?? [...response.items].sort(compareWorkOrders)[0] ?? null
        selectedIdRef.current = nextSelected?.id ?? null
        setSelectedId(nextSelected?.id ?? null)
        setSelected(nextSelected)
      } catch (requestError) {
        if (!active || (requestError instanceof DOMException && requestError.name === 'AbortError'))
          return
        setError(requestError instanceof Error ? requestError.message : '工单列表加载失败')
      } finally {
        if (active) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    void load()
    return () => {
      active = false
      controller.abort()
    }
  }, [onCountChange, refreshCounter, refreshToken, serviceOrigin])

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    let active = true

    const load = async (): Promise<void> => {
      setDetailLoading(true)
      try {
        const workOrder = await getWorkOrder(serviceOrigin, selectedId, controller.signal)
        if (!active) return
        setSelected(workOrder)
        setOrders((current) =>
          current.map((order) => (order.id === workOrder.id ? workOrder : order))
        )
        setError(null)
      } catch (requestError) {
        if (!active || (requestError instanceof DOMException && requestError.name === 'AbortError'))
          return
        setError(requestError instanceof Error ? requestError.message : '工单详情加载失败')
      } finally {
        if (active) setDetailLoading(false)
      }
    }

    void load()

    return () => {
      active = false
      controller.abort()
    }
  }, [refreshCounter, refreshToken, selectedId, serviceOrigin])

  const selectOrder = (order: WorkOrder): void => {
    selectedIdRef.current = order.id
    setSelectedId(order.id)
    setSelected(order)
    setDetailTab('overview')
  }

  const handleDispatch = async (): Promise<void> => {
    if (!selected || selected.status !== 'pending_review' || dispatchingRef.current) return
    dispatchingRef.current = true
    setDispatching(true)
    setNotice(null)
    try {
      const updated = await dispatchWorkOrder(serviceOrigin, selected.id)
      setError(null)
      setSelected(updated)
      setOrders((current) => current.map((order) => (order.id === updated.id ? updated : order)))
      setNotice('工单已审核并下达，A、B、C 三台 Pad 已收到个人任务。')
      requestRefresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '工单下达失败，请重试')
    } finally {
      dispatchingRef.current = false
      setDispatching(false)
    }
  }

  const requestDelete = (): void => {
    if (!selected || deletingRef.current || dispatchingRef.current) return
    setDeleteTarget({ id: selected.id, orderNumber: selected.orderNumber })
  }

  const closeDeleteDialog = useCallback((): void => {
    if (!deletingRef.current) setDeleteTarget(null)
  }, [])

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget || deletingRef.current || dispatchingRef.current) return

    const deletedId = deleteTarget.id
    deletingRef.current = true
    setDeleting(true)
    setNotice(null)
    try {
      const result = await deleteWorkOrder(serviceOrigin, deletedId, deleteTarget.orderNumber)
      const remaining = sortedOrders.filter((order) => order.id !== deletedId)
      const nextSelected = remaining[0] ?? null
      setOrders(remaining)
      setTotal((current) => Math.max(0, current - 1))
      selectedIdRef.current = nextSelected?.id ?? null
      setSelectedId(nextSelected?.id ?? null)
      setSelected(nextSelected)
      setDetailTab('overview')
      setDeleteTarget(null)
      setError(null)
      setNotice(`工单 ${result.orderNumber} 已删除。`)
      onCountChange?.(remaining.filter((order) => order.status !== 'closed').length)
      requestRefresh()
    } catch (requestError) {
      setDeleteTarget(null)
      const message =
        requestError instanceof TypeError && requestError.message === 'Failed to fetch'
          ? '无法连接工单服务，请稍后重试'
          : requestError instanceof Error
            ? requestError.message
            : '工单删除失败，请重试'
      setError(message)
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  const currentFlowIndex = selected ? FLOW_STATUSES.indexOf(selected.status) : 0

  return (
    <>
      <section className="work-order-page" aria-labelledby="work-order-title">
        <div className="work-order-page__heading">
          <div>
            <div className="work-order-page__title-row">
              <h2 id="work-order-title">工单中心</h2>
              <span className="work-order-priority-tip" role="note">
                <span className="work-order-priority-tip__icon" aria-hidden="true">
                  !
                </span>
                请优先处理高等级的工单。
              </span>
            </div>
            <p className="work-order-page__subtitle">
              未处理工单按等级从高到低排列，已处理工单置后。
            </p>
          </div>
          <div className="work-order-page__actions">
            <button type="button" onClick={requestRefresh} disabled={refreshing}>
              {refreshing ? '正在刷新…' : '刷新数据'}
            </button>
            <button type="button" onClick={onBack}>
              返回综合监控
            </button>
          </div>
        </div>

        <div className="work-order-summary">
          <article>
            <span>全部工单</span>
            <strong>{total}</strong>
          </article>
          <article className="work-order-summary__warning">
            <span>待人工审核</span>
            <strong>{counts.pendingReview}</strong>
          </article>
          <article>
            <span>现场执行中</span>
            <strong>{counts.running}</strong>
          </article>
          <article className="work-order-summary__verify">
            <span>PLC 验证中</span>
            <strong>{counts.verifying}</strong>
          </article>
          <article className="work-order-summary__success">
            <span>已处理</span>
            <strong>{counts.closed}</strong>
          </article>
        </div>

        {error && (
          <div className="work-order-alert" role="alert">
            <span>{error}</span>
            <button type="button" onClick={requestRefresh}>
              重试
            </button>
          </div>
        )}
        {notice && <div className="work-order-notice">{notice}</div>}

        {loading ? (
          <div className="work-order-empty work-order-empty--loading">
            <span className="work-order-loader" />
            <h3>正在读取工单</h3>
            <p>正在从平台 B 服务同步最新状态…</p>
          </div>
        ) : orders.length > 0 ? (
          <div className="work-order-content">
            <div className="work-order-list">
              <div className="work-order-list__title">
                <h3>工单列表</h3>
                <span>共 {total} 条</span>
              </div>
              <div className="work-order-list__items">
                {[
                  { label: '未处理', closed: false },
                  { label: '已处理', closed: true }
                ].map((group) => {
                  const items = sortedOrders.filter(
                    (order) => (order.status === 'closed') === group.closed
                  )
                  if (items.length === 0) return null
                  return (
                    <section
                      className="work-order-list__group"
                      key={group.label}
                      aria-label={group.label}
                    >
                      <h4 className="work-order-list__group-title">
                        {group.label}
                        <span>{items.length}</span>
                      </h4>
                      {items.map((order) => (
                        <button
                          type="button"
                          key={order.id}
                          className={`work-order-card${order.id === selectedId ? ' work-order-card--active' : ''}`}
                          aria-pressed={order.id === selectedId}
                          onClick={() => selectOrder(order)}
                        >
                          <div className="work-order-card__topline">
                            <h4>{order.faultType}</h4>
                            <span className={`order-state order-state--${order.status}`}>
                              {STATUS_META[order.status].label}
                            </span>
                          </div>
                          <p>
                            <span className={`priority priority--${order.priority}`}>
                              {order.priority === 'urgent' ? '紧急' : '普通'}
                            </span>
                            <span>
                              {order.stringName} · {order.componentName}
                            </span>
                          </p>
                          <footer>
                            <span>{order.orderNumber}</span>
                            <span>
                              {order.tasks.filter((task) => task.status === 'submitted').length}/3
                              已提交
                            </span>
                          </footer>
                        </button>
                      ))}
                    </section>
                  )
                })}
              </div>
            </div>

            {selected ? (
              <article className="work-order-detail">
                <div className="work-order-detail__heading">
                  <div>
                    <span>{selected.orderNumber}</span>
                    <h3>{selected.faultType}故障处理</h3>
                    <div className="work-order-detail__status">
                      <span className={`priority priority--${selected.priority}`}>
                        {selected.priority === 'urgent' ? '紧急' : '普通'}
                      </span>
                      <span className={`order-state order-state--${selected.status}`}>
                        {STATUS_META[selected.status].label}
                      </span>
                      <p>{STATUS_META[selected.status].description}</p>
                    </div>
                  </div>
                  <div className="work-order-detail__heading-actions">
                    {detailLoading && <small>正在同步…</small>}
                    {selected.status === 'pending_review' && (
                      <button
                        type="button"
                        className="work-order-dispatch-button"
                        onClick={handleDispatch}
                        disabled={dispatching || deleting}
                      >
                        {dispatching ? '正在下达…' : '审核并下达工单'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="work-order-delete-button"
                      onClick={requestDelete}
                      disabled={deleting || dispatching}
                    >
                      {deleting ? '正在删除…' : '删除工单'}
                    </button>
                  </div>
                </div>

                <div className="work-order-tabs" role="tablist" aria-label="工单详情">
                  {DETAIL_TABS.map((tab, index) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      id={`work-order-tab-${tab.id}`}
                      aria-selected={detailTab === tab.id}
                      aria-controls={`work-order-panel-${tab.id}`}
                      tabIndex={detailTab === tab.id ? 0 : -1}
                      onClick={() => setDetailTab(tab.id)}
                      onKeyDown={(event) => {
                        const nextIndex =
                          event.key === 'ArrowRight'
                            ? (index + 1) % DETAIL_TABS.length
                            : event.key === 'ArrowLeft'
                              ? (index + DETAIL_TABS.length - 1) % DETAIL_TABS.length
                              : event.key === 'Home'
                                ? 0
                                : event.key === 'End'
                                  ? DETAIL_TABS.length - 1
                                  : null
                        if (nextIndex === null) return
                        event.preventDefault()
                        const nextTab = DETAIL_TABS[nextIndex].id
                        setDetailTab(nextTab)
                        document.getElementById(`work-order-tab-${nextTab}`)?.focus()
                      }}
                    >
                      {tab.label}
                      {tab.id === 'tasks' && (
                        <span>
                          {selected.tasks.filter((task) => task.status === 'submitted').length}/3
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <div
                  className="work-order-detail__scroll"
                  key={`${selected.id}-${detailTab}`}
                  role="tabpanel"
                  id={`work-order-panel-${detailTab}`}
                  aria-labelledby={`work-order-tab-${detailTab}`}
                  tabIndex={0}
                >
                  {detailTab === 'overview' && (
                    <>
                      <div className="work-order-flow" aria-label="工单处理流程">
                        {FLOW_STATUSES.map((status, index) => (
                          <div className="work-order-flow__unit" key={status}>
                            <div
                              aria-current={index === currentFlowIndex ? 'step' : undefined}
                              className={
                                index < currentFlowIndex
                                  ? 'work-order-flow__step work-order-flow__step--done'
                                  : index === currentFlowIndex
                                    ? 'work-order-flow__step work-order-flow__step--current'
                                    : 'work-order-flow__step'
                              }
                            >
                              <i>{index < currentFlowIndex ? '✓' : index + 1}</i>
                              <span>{STATUS_META[status].label}</span>
                            </div>
                            {index < FLOW_STATUSES.length - 1 && (
                              <b
                                className={index < currentFlowIndex ? 'flow-line--done' : undefined}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="work-order-overview-grid">
                        <section>
                          <h4 className="work-order-section-heading">基本信息</h4>
                          <dl className="work-order-meta">
                            <div>
                              <dt>场站名称</dt>
                              <dd>{selected.stationName}</dd>
                            </div>
                            <div>
                              <dt>故障位置</dt>
                              <dd>
                                {selected.stringName} · {selected.componentName}
                              </dd>
                            </div>
                            <div>
                              <dt>优先级</dt>
                              <dd
                                className={
                                  selected.priority === 'urgent' ? 'meta-urgent' : undefined
                                }
                              >
                                {selected.priority === 'urgent' ? '紧急' : '普通'}
                              </dd>
                            </div>
                            <div>
                              <dt>创建时间</dt>
                              <dd>{formatDateTime(selected.createdAt)}</dd>
                            </div>
                            <div>
                              <dt>审核时间</dt>
                              <dd>{formatDateTime(selected.reviewedAt)}</dd>
                            </div>
                            <div>
                              <dt>关单时间</dt>
                              <dd>{formatDateTime(selected.closedAt)}</dd>
                            </div>
                          </dl>
                        </section>
                        <div className="work-order-diagnosis">
                          <section>
                            <span>报警数据</span>
                            <h4>
                              {formatNumber(selected.alarm.voltage)} V
                              <i />
                              {formatNumber(selected.alarm.current)} A
                            </h4>
                            <p>
                              正常区间：{formatNumber(selected.normalRange.voltageMin)}–
                              {formatNumber(selected.normalRange.voltageMax)} V /{' '}
                              {formatNumber(selected.normalRange.currentMin)}–
                              {formatNumber(selected.normalRange.currentMax)} A
                            </p>
                          </section>
                          <section>
                            <span>处理建议</span>
                            <h4>{selected.handlingSuggestion}</h4>
                            <p>结束条件：A/B/C 全部提交且 PLC 连续 5 次正常</p>
                          </section>
                        </div>
                      </div>
                      {selected.status === 'pending_review' && (
                        <section className="dispatch-review">
                          <div>
                            <h4>下达前，请核对工单信息</h4>
                            <p>
                              确认故障位置、报警数据、人员分工与风险点后，点击右上方「审核并下达工单」。
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setDetailTab('tasks')
                              document.getElementById('work-order-tab-tasks')?.focus()
                            }}
                          >
                            查看人员任务 →
                          </button>
                        </section>
                      )}
                    </>
                  )}
                  {detailTab === 'tasks' && (
                    <>
                      <section className="work-order-task-section">
                        <div className="section-title">
                          <div>
                            <span>任务执行</span>
                            <h4>A / B / C 个人任务与回填</h4>
                          </div>
                          <strong>
                            {selected.tasks.filter((task) => task.status === 'submitted').length}/3
                            已提交
                          </strong>
                        </div>
                        <div className="work-task-grid">
                          {([...selected.tasks] as WorkOrderTask[])
                            .sort((left, right) => left.role.localeCompare(right.role))
                            .map((task) => (
                              <TaskCard
                                task={task}
                                workOrderStatus={selected.status}
                                key={task.id}
                              />
                            ))}
                        </div>
                      </section>

                      <PadAccessPanel padUrl={padUrl} tasks={selected.tasks} />
                    </>
                  )}
                  {detailTab === 'verification' && (
                    <>
                      <section className="work-order-verification-intro">
                        <span>自动关单条件</span>
                        <h4>
                          {selected.status === 'closed'
                            ? '人员任务与设备验证均已完成'
                            : '人员任务完成后，自动验证设备恢复情况'}
                        </h4>
                        <p>
                          A / B / C 员工全部提交合格结果，且 PLC 连续 5
                          次采样正常，工单将自动转为已处理。
                        </p>
                        <div>
                          <span>
                            人员任务{' '}
                            <strong>
                              {selected.tasks.filter((task) => task.status === 'submitted').length}{' '}
                              / 3 已提交
                            </strong>
                          </span>
                          <span>
                            关单时间 <strong>{formatDateTime(selected.closedAt)}</strong>
                          </span>
                        </div>
                      </section>
                      <PlcVerificationCard
                        verification={selected.plcVerification}
                        status={selected.status}
                      />
                    </>
                  )}
                </div>
              </article>
            ) : (
              <div className="work-order-detail work-order-detail--empty">请选择工单查看详情</div>
            )}
          </div>
        ) : (
          <div className="work-order-empty">
            <span>▤</span>
            <h3>暂无工单</h3>
            <p>在 AI 智能体对话中上传故障图片后，系统将生成待审核草稿。</p>
            <button type="button" onClick={onOpenAssistant}>
              前往 AI 智能助手
            </button>
          </div>
        )}
      </section>
      <DeleteWorkOrderDialog
        open={deleteTarget !== null}
        orderNumber={deleteTarget?.orderNumber ?? ''}
        deleting={deleting}
        onCancel={closeDeleteDialog}
        onConfirm={() => void handleDelete()}
      />
    </>
  )
}
