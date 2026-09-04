import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type {
  AssignedWorkOrderTask,
  CompleteSafetyCheckpointRequest,
  CreateWorkOrderDraftRequest,
  CreateWorkOrderDraftResponse,
  DeleteWorkOrderResponse,
  DispatchWorkOrderRequest,
  IsolationTaskResult,
  ServerEvent,
  StartWorkOrderTaskResponse,
  SubmitIsolationTaskRequest,
  SubmitSafetyMonitorTaskRequest,
  SubmitTreatmentTaskRequest,
  TelemetrySnapshot,
  TreatmentTaskResult,
  WorkOrder,
  WorkOrderDetail,
  WorkOrderPriority,
  WorkOrderRole,
  WorkOrderStatus,
  WorkOrderTask,
  WorkOrderTaskAction,
  WorkOrderTaskStatus,
  WorkOrderTreatmentAction
} from '../../shared/contracts'
import type { AppDatabase } from './database'

const DEFAULT_NORMAL_VOLTAGE = 613
const DEFAULT_NORMAL_CURRENT = 9.4
const DEFAULT_TOLERANCE_PERCENT = 10
const REQUIRED_NORMAL_SAMPLES = 5
const MAX_CONTINUOUS_SAMPLE_GAP_MS = 5_000
const TARGET_DEVICE_ID = 'pv-1'

const WORK_ORDER_STATUSES = new Set<WorkOrderStatus>([
  'pending_review',
  'dispatched',
  'in_progress',
  'plc_verifying',
  'closed'
])
const TASK_STATUSES = new Set<WorkOrderTaskStatus>(['pending', 'in_progress', 'submitted'])
const ROLES = new Set<WorkOrderRole>(['A', 'B', 'C'])
const TREATMENT_ACTIONS = new Set<WorkOrderTreatmentAction>(['cleaned', 'replaced', 'no_fault'])

interface TaskTemplate {
  role: WorkOrderRole
  assigneeName: string
  title: string
  description: string
  risks: string[]
}

const TASK_TEMPLATES: TaskTemplate[] = [
  {
    role: 'A',
    assigneeName: 'A员工',
    title: '安全监护',
    description: '全程安全监护，监督作业安全，发现违章立即制止。',
    risks: ['监护失效', '应急响应不到位']
  },
  {
    role: 'B',
    assigneeName: 'B员工',
    title: '隔离、验电与恢复确认',
    description:
      '作业前确认1号光伏组串已隔离，完成验电和安全措施；处理完成后确认恢复组串连接和送电。',
    risks: ['直流高压触电', '带负荷拉闸产生电弧']
  },
  {
    role: 'C',
    assigneeName: 'C员工',
    title: '热斑确认与处理',
    description: '使用红外热像仪确认1号组件热斑并记录数据，随后清理遮挡物或更换故障组件并复测。',
    risks: [
      '高处作业坠落',
      '组件表面高温烫伤',
      '误碰带电部位',
      '组件破损划伤',
      '搬运砸伤',
      '直流接头短路'
    ]
  }
]

export class WorkOrderRequestError extends Error {
  constructor(
    readonly statusCode: 400 | 404 | 409,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export interface WorkOrderServiceOptions {
  database: AppDatabase
  broadcast: (event: ServerEvent) => void
  getLatestSnapshot: () => TelemetrySnapshot | undefined
  maxContinuousSampleGapMs?: number
}

interface TaskContext extends StartWorkOrderTaskResponse {
  changed: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readOptionalText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new WorkOrderRequestError(400, 'INVALID_REQUEST', `${field} 必须是字符串`)
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new WorkOrderRequestError(400, 'INVALID_REQUEST', `${field} 必须是布尔值`)
  }
  return value
}

function readNumber(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WorkOrderRequestError(400, 'INVALID_REQUEST', `${field} 必须是有限数值`)
  }
  return value
}

function roundRange(value: number): number {
  return Number(value.toFixed(6))
}

function shanghaiDatePart(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const lookup = new Map(parts.map((part) => [part.type, part.value]))
  return `${lookup.get('year')}${lookup.get('month')}${lookup.get('day')}`
}

function taskByRole(workOrder: WorkOrder, role: WorkOrderRole): WorkOrderTask {
  const task = workOrder.tasks.find((item) => item.role === role)
  if (!task) throw new Error(`工单 ${workOrder.id} 缺少 ${role} 角色任务`)
  return task
}

function isTaskStarted(task: WorkOrderTask): boolean {
  return task.status === 'in_progress' || task.status === 'submitted'
}

function isSafetyCheckpointComplete(task: WorkOrderTask): boolean {
  if (task.role !== 'B' || !task.checkpointAt || task.result?.role !== 'B') return false
  return (
    task.result.isolationConfirmed &&
    task.result.voltageTestPassed &&
    task.result.safetyMeasuresConfirmed
  )
}

function capabilities(
  workOrder: WorkOrder,
  task: WorkOrderTask
): { allowedActions: WorkOrderTaskAction[]; blockedReason: string | null } {
  if (workOrder.status === 'pending_review') {
    return { allowedActions: [], blockedReason: '工单尚未审核下达' }
  }
  if (workOrder.status === 'plc_verifying') {
    return { allowedActions: [], blockedReason: '人员任务已完成，正在验证PLC数据' }
  }
  if (workOrder.status === 'closed') {
    return { allowedActions: [], blockedReason: '工单已关闭' }
  }
  if (task.status === 'submitted') {
    return { allowedActions: [], blockedReason: '任务已提交' }
  }

  const taskA = taskByRole(workOrder, 'A')
  const taskB = taskByRole(workOrder, 'B')
  const taskC = taskByRole(workOrder, 'C')

  if (task.role === 'A') {
    if (task.status === 'pending') return { allowedActions: ['start'], blockedReason: null }
    if (taskB.status === 'submitted') return { allowedActions: ['submit'], blockedReason: null }
    return { allowedActions: [], blockedReason: '需等待B员工完成恢复连接和送电确认' }
  }

  if (task.role === 'B') {
    if (task.status === 'pending') {
      return isTaskStarted(taskA)
        ? { allowedActions: ['start'], blockedReason: null }
        : { allowedActions: [], blockedReason: '需等待A员工开始安全监护' }
    }
    if (!isSafetyCheckpointComplete(taskB)) {
      return { allowedActions: ['checkpoint'], blockedReason: null }
    }
    if (taskC.status === 'submitted') return { allowedActions: ['submit'], blockedReason: null }
    return { allowedActions: [], blockedReason: '需等待C员工完成热斑处理并提交' }
  }

  if (task.status === 'pending') {
    if (!isTaskStarted(taskA)) {
      return { allowedActions: [], blockedReason: '需等待A员工开始安全监护' }
    }
    if (!isSafetyCheckpointComplete(taskB)) {
      return { allowedActions: [], blockedReason: '需等待B员工完成隔离、验电和安全措施确认' }
    }
    return { allowedActions: ['start'], blockedReason: null }
  }
  return { allowedActions: ['submit'], blockedReason: null }
}

function hydrateWorkOrder(workOrder: WorkOrder): WorkOrder {
  const tasks = workOrder.tasks.map((task) => ({ ...task, ...capabilities(workOrder, task) }))
  return { ...workOrder, tasks }
}

function parseCheckpointRequest(value: unknown): CompleteSafetyCheckpointRequest {
  if (!isRecord(value)) throw new WorkOrderRequestError(400, 'INVALID_REQUEST', '请求体不能为空')
  return {
    isolationConfirmed: readBoolean(value['isolationConfirmed'], 'isolationConfirmed'),
    voltageTestPassed: readBoolean(value['voltageTestPassed'], 'voltageTestPassed'),
    safetyMeasuresConfirmed: readBoolean(
      value['safetyMeasuresConfirmed'],
      'safetyMeasuresConfirmed'
    ),
    notes: readOptionalText(value['notes'], 'notes')
  }
}

function parseSafetyMonitorResult(value: unknown): SubmitSafetyMonitorTaskRequest {
  if (!isRecord(value)) throw new WorkOrderRequestError(400, 'INVALID_REQUEST', '请求体不能为空')
  const result = {
    monitoringCompleted: readBoolean(value['monitoringCompleted'], 'monitoringCompleted'),
    unresolvedHazards: readBoolean(value['unresolvedHazards'], 'unresolvedHazards'),
    notes: readOptionalText(value['notes'], 'notes')
  }
  if (!result.monitoringCompleted || result.unresolvedHazards) {
    throw new WorkOrderRequestError(409, 'TASK_RESULT_NOT_READY', '监护未完成或仍有未解决风险')
  }
  return result
}

function parseIsolationResult(value: unknown): SubmitIsolationTaskRequest {
  if (!isRecord(value)) throw new WorkOrderRequestError(400, 'INVALID_REQUEST', '请求体不能为空')
  const result = {
    restorationConfirmed: readBoolean(value['restorationConfirmed'], 'restorationConfirmed'),
    powerRestored: readBoolean(value['powerRestored'], 'powerRestored'),
    notes: readOptionalText(value['notes'], 'notes')
  }
  if (!result.restorationConfirmed || !result.powerRestored) {
    throw new WorkOrderRequestError(409, 'TASK_RESULT_NOT_READY', '组串连接和送电尚未全部恢复')
  }
  return result
}

function parseTreatmentResult(value: unknown): SubmitTreatmentTaskRequest {
  if (!isRecord(value)) throw new WorkOrderRequestError(400, 'INVALID_REQUEST', '请求体不能为空')
  const treatmentAction = value['treatmentAction']
  if (
    typeof treatmentAction !== 'string' ||
    !TREATMENT_ACTIONS.has(treatmentAction as WorkOrderTreatmentAction)
  ) {
    throw new WorkOrderRequestError(
      400,
      'INVALID_REQUEST',
      'treatmentAction 必须为 cleaned、replaced 或 no_fault'
    )
  }
  const measuredTemperature = value['measuredTemperature']
  if (
    measuredTemperature !== undefined &&
    (typeof measuredTemperature !== 'number' || !Number.isFinite(measuredTemperature))
  ) {
    throw new WorkOrderRequestError(400, 'INVALID_REQUEST', 'measuredTemperature 必须是有限数值')
  }
  const result: SubmitTreatmentTaskRequest = {
    hotspotConfirmed: readBoolean(value['hotspotConfirmed'], 'hotspotConfirmed'),
    treatmentAction: treatmentAction as WorkOrderTreatmentAction,
    retestPassed: readBoolean(value['retestPassed'], 'retestPassed'),
    measuredTemperature: measuredTemperature as number | undefined,
    notes: readOptionalText(value['notes'], 'notes')
  }
  if (!result.retestPassed) {
    throw new WorkOrderRequestError(409, 'TASK_RESULT_NOT_READY', '处理后复测尚未合格')
  }
  if (result.hotspotConfirmed && result.treatmentAction === 'no_fault') {
    throw new WorkOrderRequestError(400, 'INVALID_REQUEST', '确认存在热斑时必须选择清理或更换')
  }
  if (!result.hotspotConfirmed && result.treatmentAction !== 'no_fault') {
    throw new WorkOrderRequestError(400, 'INVALID_REQUEST', '未发现热斑时处理方式必须选择无需处理')
  }
  return result
}

function assignedTask(workOrder: WorkOrder, task: WorkOrderTask): AssignedWorkOrderTask {
  const riskText = task.risks.join('、')
  const voiceText = `${task.assigneeName}您有新工单。工单编号${workOrder.orderNumber}，故障类型：${workOrder.faultType}。您的任务：${task.description}风险点：${riskText}。请规范操作，注意安全。`
  return {
    ...task,
    workOrderNumber: workOrder.orderNumber,
    stationName: workOrder.stationName,
    stringName: workOrder.stringName,
    componentName: workOrder.componentName,
    faultType: workOrder.faultType,
    priority: workOrder.priority,
    dispatchedAt: workOrder.dispatchedAt,
    voiceText
  }
}

function getTaskContext(
  database: AppDatabase,
  taskId: string
): {
  workOrder: WorkOrder
  task: WorkOrderTask
} {
  const storedTask = database.getTask(taskId)
  if (!storedTask) throw new WorkOrderRequestError(404, 'TASK_NOT_FOUND', '任务不存在')
  const storedWorkOrder = database.getWorkOrder(storedTask.workOrderId)
  if (!storedWorkOrder) throw new WorkOrderRequestError(404, 'WORK_ORDER_NOT_FOUND', '工单不存在')
  const workOrder = hydrateWorkOrder(storedWorkOrder)
  return { workOrder, task: taskByRole(workOrder, storedTask.role) }
}

export class WorkOrderService {
  constructor(private readonly options: WorkOrderServiceOptions) {}

  createDraft(value: unknown): CreateWorkOrderDraftResponse {
    if (value !== undefined && !isRecord(value)) {
      throw new WorkOrderRequestError(400, 'INVALID_REQUEST', '请求体必须是对象')
    }
    const input = (value ?? {}) as CreateWorkOrderDraftRequest
    const latestDevice = this.options
      .getLatestSnapshot()
      ?.devices.find((device) => device.id === TARGET_DEVICE_ID)
    const stationName = readOptionalText(input.stationName, 'stationName') ?? '光明村光伏电站'
    const deviceId = readOptionalText(input.deviceId, 'deviceId') ?? TARGET_DEVICE_ID
    if (deviceId !== TARGET_DEVICE_ID) {
      throw new WorkOrderRequestError(400, 'UNSUPPORTED_DEVICE', '当前仅支持1号光伏组串 pv-1')
    }
    const stringName = readOptionalText(input.stringName, 'stringName') ?? '1号光伏组串'
    const componentName = readOptionalText(input.componentName, 'componentName') ?? '1号组件'
    const faultType = readOptionalText(input.faultType, 'faultType') ?? '组件热斑'
    const handlingSuggestion =
      readOptionalText(input.handlingSuggestion, 'handlingSuggestion') ??
      '隔离组串、现场确认并清理或更换1号组件、复测'
    const priority = input.priority ?? 'urgent'
    if (priority !== 'normal' && priority !== 'urgent') {
      throw new WorkOrderRequestError(400, 'INVALID_REQUEST', 'priority 必须为 normal 或 urgent')
    }
    const normalVoltage = readNumber(input.normalVoltage, DEFAULT_NORMAL_VOLTAGE, 'normalVoltage')
    const normalCurrent = readNumber(input.normalCurrent, DEFAULT_NORMAL_CURRENT, 'normalCurrent')
    const tolerancePercent = readNumber(
      input.tolerancePercent,
      DEFAULT_TOLERANCE_PERCENT,
      'tolerancePercent'
    )
    if (normalVoltage <= 0 || normalCurrent <= 0) {
      throw new WorkOrderRequestError(400, 'INVALID_REQUEST', '正常电压和电流必须大于0')
    }
    if (tolerancePercent < 0 || tolerancePercent >= 100) {
      throw new WorkOrderRequestError(400, 'INVALID_REQUEST', '允许偏差必须在0（含）到100之间')
    }
    const voltage = readNumber(input.voltage, latestDevice?.voltage ?? normalVoltage, 'voltage')
    const current = readNumber(input.current, latestDevice?.current ?? normalCurrent, 'current')
    const tolerance = tolerancePercent / 100
    const now = new Date()
    const timestamp = now.toISOString()
    const dedupeKey = [stationName, deviceId, componentName, faultType]
      .map((part) => part.trim().toLocaleLowerCase('zh-CN'))
      .join('|')

    const result = this.options.database.runInTransaction(() => {
      const existing = this.options.database.findOpenWorkOrder(dedupeKey)
      if (existing) {
        return {
          workOrder: hydrateWorkOrder(existing),
          created: false,
          deduplicated: true
        }
      }

      const id = randomUUID()
      const orderNumber = this.options.database.nextWorkOrderNumber(shanghaiDatePart(now))
      const tasks: WorkOrderTask[] = TASK_TEMPLATES.map((template) => ({
        id: randomUUID(),
        workOrderId: id,
        ...template,
        status: 'pending',
        result: null,
        startedAt: null,
        checkpointAt: null,
        submittedAt: null,
        updatedAt: timestamp,
        allowedActions: [],
        blockedReason: '工单尚未审核下达'
      }))
      const workOrder: WorkOrder = {
        id,
        orderNumber,
        stationName,
        deviceId,
        stringName,
        componentName,
        faultType,
        priority: priority as WorkOrderPriority,
        handlingSuggestion,
        alarm: { voltage, current },
        normalRange: {
          normalVoltage,
          normalCurrent,
          tolerancePercent,
          voltageMin: roundRange(normalVoltage * (1 - tolerance)),
          voltageMax: roundRange(normalVoltage * (1 + tolerance)),
          currentMin: roundRange(normalCurrent * (1 - tolerance)),
          currentMax: roundRange(normalCurrent * (1 + tolerance))
        },
        status: 'pending_review',
        reviewedBy: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        reviewedAt: null,
        dispatchedAt: null,
        verifyingAt: null,
        closedAt: null,
        plcVerification: {
          requiredConsecutiveSamples: REQUIRED_NORMAL_SAMPLES,
          consecutiveNormalSamples: 0,
          lastCheckedAt: null,
          lastVoltage: null,
          lastCurrent: null,
          lastSampleNormal: null
        },
        tasks
      }
      this.options.database.insertWorkOrder(workOrder, dedupeKey)
      this.options.database.recordWorkOrderEvent({
        workOrderId: id,
        type: 'draft_created',
        actor: 'platform-b',
        createdAt: timestamp,
        payload: { orderNumber, alarm: workOrder.alarm, normalRange: workOrder.normalRange }
      })
      return { workOrder: hydrateWorkOrder(workOrder), created: true, deduplicated: false }
    })

    if (result.created)
      this.options.broadcast({ type: 'work-order.created', payload: result.workOrder })
    return result
  }

  listWorkOrders(
    status?: WorkOrderStatus,
    limit = 100,
    offset = 0
  ): {
    items: WorkOrder[]
    total: number
  } {
    const all = this.options.database.listWorkOrders(status).map(hydrateWorkOrder)
    return { items: all.slice(offset, offset + limit), total: all.length }
  }

  getWorkOrder(id: string): WorkOrderDetail {
    const workOrder = this.options.database.getWorkOrderDetail(id)
    if (!workOrder) throw new WorkOrderRequestError(404, 'WORK_ORDER_NOT_FOUND', '工单不存在')
    const hydrated = hydrateWorkOrder(workOrder)
    return { ...hydrated, events: workOrder.events }
  }

  deleteWorkOrder(id: string): DeleteWorkOrderResponse {
    const result = this.options.database.runInTransaction(() => {
      const current = this.options.database.getWorkOrder(id)
      if (!current) throw new WorkOrderRequestError(404, 'WORK_ORDER_NOT_FOUND', '工单不存在')

      if (!this.options.database.deleteWorkOrder(id)) {
        throw new WorkOrderRequestError(404, 'WORK_ORDER_NOT_FOUND', '工单不存在')
      }
      this.options.database.recordEvent('work-order.deleted', {
        id: current.id,
        orderNumber: current.orderNumber,
        status: current.status,
        deletedAt: new Date().toISOString()
      })
      return { deleted: true, id: current.id, orderNumber: current.orderNumber } as const
    })

    this.options.broadcast({ type: 'work-order.deleted', payload: result })
    return result
  }

  dispatch(id: string, value: unknown): WorkOrder {
    if (value !== undefined && !isRecord(value)) {
      throw new WorkOrderRequestError(400, 'INVALID_REQUEST', '请求体必须是对象')
    }
    const input = (value ?? {}) as DispatchWorkOrderRequest
    const reviewer = readOptionalText(input.reviewer, 'reviewer') ?? '平台B审核员'
    let changed = false
    const workOrder = this.options.database.runInTransaction(() => {
      const current = this.options.database.getWorkOrder(id)
      if (!current) throw new WorkOrderRequestError(404, 'WORK_ORDER_NOT_FOUND', '工单不存在')
      if (current.status !== 'pending_review') return hydrateWorkOrder(current)

      const timestamp = new Date().toISOString()
      current.status = 'dispatched'
      current.reviewedBy = reviewer
      current.reviewedAt = timestamp
      current.dispatchedAt = timestamp
      current.updatedAt = timestamp
      this.options.database.updateWorkOrder(current)
      this.options.database.recordWorkOrderEvent({
        workOrderId: id,
        type: 'dispatched',
        actor: reviewer,
        createdAt: timestamp,
        payload: { roles: ['A', 'B', 'C'] }
      })
      changed = true
      return hydrateWorkOrder(current)
    })
    if (changed) this.options.broadcast({ type: 'work-order.dispatched', payload: workOrder })
    return workOrder
  }

  listAssignedTasks(
    role: WorkOrderRole,
    status?: WorkOrderTaskStatus
  ): { items: AssignedWorkOrderTask[]; total: number } {
    const items = this.options.database
      .listTasks(role)
      .map((storedTask) => {
        const storedWorkOrder = this.options.database.getWorkOrder(storedTask.workOrderId)
        if (!storedWorkOrder) return undefined
        const workOrder = hydrateWorkOrder(storedWorkOrder)
        return assignedTask(workOrder, taskByRole(workOrder, role))
      })
      .filter((item): item is AssignedWorkOrderTask => Boolean(item))
      .filter((item) => !status || item.status === status)
    return { items, total: items.length }
  }

  startTask(taskId: string): StartWorkOrderTaskResponse {
    const context = this.options.database.runInTransaction<TaskContext>(() => {
      const { workOrder, task } = getTaskContext(this.options.database, taskId)
      if (task.status !== 'pending') return { task, workOrder, changed: false }
      if (!task.allowedActions.includes('start')) {
        throw new WorkOrderRequestError(
          409,
          'TASK_GATE_BLOCKED',
          task.blockedReason ?? '当前不能开始此任务'
        )
      }
      const timestamp = new Date().toISOString()
      task.status = 'in_progress'
      task.startedAt = timestamp
      task.updatedAt = timestamp
      workOrder.status = 'in_progress'
      workOrder.updatedAt = timestamp
      this.options.database.updateTask(task)
      this.options.database.updateWorkOrder(workOrder)
      this.options.database.recordWorkOrderEvent({
        workOrderId: workOrder.id,
        type: 'task_started',
        actor: task.assigneeName,
        createdAt: timestamp,
        payload: { taskId: task.id, role: task.role }
      })
      const updated = hydrateWorkOrder({
        ...workOrder,
        tasks: workOrder.tasks.map((item) => (item.id === task.id ? task : item))
      })
      return { task: taskByRole(updated, task.role), workOrder: updated, changed: true }
    })
    if (context.changed) {
      this.options.broadcast({
        type: 'task.updated',
        payload: { task: context.task, workOrder: context.workOrder }
      })
    }
    return { task: context.task, workOrder: context.workOrder }
  }

  completeSafetyCheckpoint(taskId: string, value: unknown): StartWorkOrderTaskResponse {
    const input = parseCheckpointRequest(value)
    const context = this.options.database.runInTransaction<TaskContext>(() => {
      const { workOrder, task } = getTaskContext(this.options.database, taskId)
      if (task.role !== 'B') {
        throw new WorkOrderRequestError(409, 'WRONG_TASK_ROLE', '只有B员工任务支持作业前检查')
      }
      if (task.status === 'submitted' || task.checkpointAt) {
        return { task, workOrder, changed: false }
      }
      if (task.status !== 'in_progress' || !task.allowedActions.includes('checkpoint')) {
        throw new WorkOrderRequestError(
          409,
          'TASK_GATE_BLOCKED',
          task.blockedReason ?? '当前不能提交作业前检查'
        )
      }
      const previous = task.result?.role === 'B' ? task.result : undefined
      const sameResult =
        previous?.isolationConfirmed === input.isolationConfirmed &&
        previous?.voltageTestPassed === input.voltageTestPassed &&
        previous?.safetyMeasuresConfirmed === input.safetyMeasuresConfirmed &&
        (previous?.checkpointNotes ?? undefined) === input.notes
      if (sameResult) return { task, workOrder, changed: false }

      const timestamp = new Date().toISOString()
      const passed =
        input.isolationConfirmed && input.voltageTestPassed && input.safetyMeasuresConfirmed
      task.result = {
        role: 'B',
        isolationConfirmed: input.isolationConfirmed,
        voltageTestPassed: input.voltageTestPassed,
        safetyMeasuresConfirmed: input.safetyMeasuresConfirmed,
        checkpointNotes: input.notes
      }
      task.checkpointAt = passed ? timestamp : null
      task.updatedAt = timestamp
      workOrder.updatedAt = timestamp
      this.options.database.updateTask(task)
      this.options.database.updateWorkOrder(workOrder)
      this.options.database.recordWorkOrderEvent({
        workOrderId: workOrder.id,
        type: 'b_safety_checkpoint',
        actor: task.assigneeName,
        createdAt: timestamp,
        payload: { taskId: task.id, passed, ...input }
      })
      const updated = hydrateWorkOrder({
        ...workOrder,
        tasks: workOrder.tasks.map((item) => (item.id === task.id ? task : item))
      })
      return { task: taskByRole(updated, 'B'), workOrder: updated, changed: true }
    })
    if (context.changed) {
      this.options.broadcast({
        type: 'task.updated',
        payload: { task: context.task, workOrder: context.workOrder }
      })
    }
    return { task: context.task, workOrder: context.workOrder }
  }

  submitTask(taskId: string, value: unknown): StartWorkOrderTaskResponse {
    const context = this.options.database.runInTransaction<TaskContext>(() => {
      const { workOrder, task } = getTaskContext(this.options.database, taskId)
      if (task.status === 'submitted') return { task, workOrder, changed: false }
      if (task.status !== 'in_progress' || !task.allowedActions.includes('submit')) {
        throw new WorkOrderRequestError(
          409,
          'TASK_GATE_BLOCKED',
          task.blockedReason ?? '当前不能提交此任务'
        )
      }

      if (task.role === 'A') {
        task.result = { role: 'A', ...parseSafetyMonitorResult(value) }
      } else if (task.role === 'B') {
        const checkpoint = task.result
        if (checkpoint?.role !== 'B' || !isSafetyCheckpointComplete(task)) {
          throw new WorkOrderRequestError(409, 'TASK_GATE_BLOCKED', '作业前安全检查尚未通过')
        }
        const restoration = parseIsolationResult(value)
        task.result = {
          ...checkpoint,
          restorationConfirmed: restoration.restorationConfirmed,
          powerRestored: restoration.powerRestored,
          restorationNotes: restoration.notes,
          role: 'B'
        } satisfies IsolationTaskResult
      } else {
        task.result = { role: 'C', ...parseTreatmentResult(value) } satisfies TreatmentTaskResult
      }

      const timestamp = new Date().toISOString()
      task.status = 'submitted'
      task.submittedAt = timestamp
      task.updatedAt = timestamp
      workOrder.updatedAt = timestamp
      const tasks = workOrder.tasks.map((item) => (item.id === task.id ? task : item))
      const allSubmitted = tasks.every((item) => item.status === 'submitted')
      if (allSubmitted) {
        workOrder.status = 'plc_verifying'
        workOrder.verifyingAt = timestamp
        workOrder.plcVerification.consecutiveNormalSamples = 0
        workOrder.plcVerification.lastCheckedAt = null
        workOrder.plcVerification.lastVoltage = null
        workOrder.plcVerification.lastCurrent = null
        workOrder.plcVerification.lastSampleNormal = null
      }
      this.options.database.updateTask(task)
      this.options.database.updateWorkOrder(workOrder)
      this.options.database.recordWorkOrderEvent({
        workOrderId: workOrder.id,
        type: 'task_submitted',
        actor: task.assigneeName,
        createdAt: timestamp,
        payload: { taskId: task.id, role: task.role, result: task.result }
      })
      if (allSubmitted) {
        this.options.database.recordWorkOrderEvent({
          workOrderId: workOrder.id,
          type: 'plc_verification_started',
          actor: 'platform-b',
          createdAt: timestamp,
          payload: {
            deviceId: workOrder.deviceId,
            requiredConsecutiveSamples: workOrder.plcVerification.requiredConsecutiveSamples,
            normalRange: workOrder.normalRange
          }
        })
      }
      const updated = hydrateWorkOrder({ ...workOrder, tasks })
      return { task: taskByRole(updated, task.role), workOrder: updated, changed: true }
    })
    if (context.changed) {
      this.options.broadcast({
        type: 'task.updated',
        payload: { task: context.task, workOrder: context.workOrder }
      })
      this.options.broadcast({ type: 'work-order.updated', payload: context.workOrder })
    }
    return { task: context.task, workOrder: context.workOrder }
  }

  processTelemetry(snapshot: TelemetrySnapshot): void {
    const candidates = this.options.database.listVerifyingWorkOrders()
    for (const candidate of candidates) {
      const update = this.options.database.runInTransaction(() => {
        const current = this.options.database.getWorkOrder(candidate.id)
        if (!current || current.status !== 'plc_verifying') return undefined
        if (current.plcVerification.lastCheckedAt === snapshot.timestamp) return undefined
        const sampleTime = Date.parse(snapshot.timestamp)
        const previousSampleTime = current.plcVerification.lastCheckedAt
          ? Date.parse(current.plcVerification.lastCheckedAt)
          : undefined
        if (
          previousSampleTime !== undefined &&
          !Number.isNaN(previousSampleTime) &&
          !Number.isNaN(sampleTime) &&
          sampleTime <= previousSampleTime
        ) {
          return undefined
        }
        const continuityBroken =
          previousSampleTime !== undefined &&
          (Number.isNaN(previousSampleTime) ||
            Number.isNaN(sampleTime) ||
            sampleTime - previousSampleTime >
              (this.options.maxContinuousSampleGapMs ?? MAX_CONTINUOUS_SAMPLE_GAP_MS))
        const device = snapshot.devices.find((item) => item.id === TARGET_DEVICE_ID)
        const connected = snapshot.plcConnected === true
        const sampleNormal = Boolean(
          connected &&
          device &&
          device.status === 'normal' &&
          device.voltage >= current.normalRange.voltageMin &&
          device.voltage <= current.normalRange.voltageMax &&
          device.current >= current.normalRange.currentMin &&
          device.current <= current.normalRange.currentMax
        )
        const previousNormal = current.plcVerification.lastSampleNormal
        const previousStreak = continuityBroken
          ? 0
          : current.plcVerification.consecutiveNormalSamples
        current.plcVerification.consecutiveNormalSamples = sampleNormal ? previousStreak + 1 : 0
        current.plcVerification.lastCheckedAt = snapshot.timestamp
        current.plcVerification.lastVoltage = device?.voltage ?? null
        current.plcVerification.lastCurrent = device?.current ?? null
        current.plcVerification.lastSampleNormal = sampleNormal
        current.updatedAt = snapshot.timestamp
        const closed =
          current.plcVerification.consecutiveNormalSamples >=
          current.plcVerification.requiredConsecutiveSamples
        if (closed) {
          current.status = 'closed'
          current.closedAt = snapshot.timestamp
        }
        this.options.database.updateWorkOrder(current)

        const shouldAuditSample =
          sampleNormal || previousNormal === null || previousNormal !== sampleNormal
        if (shouldAuditSample) {
          this.options.database.recordWorkOrderEvent({
            workOrderId: current.id,
            type: 'plc_sample_checked',
            actor: 'plc',
            createdAt: snapshot.timestamp,
            payload: {
              sequence: snapshot.sequence,
              connected,
              deviceFound: Boolean(device),
              voltage: device?.voltage ?? null,
              current: device?.current ?? null,
              sampleNormal,
              continuityBroken,
              consecutiveNormalSamples: current.plcVerification.consecutiveNormalSamples,
              requiredConsecutiveSamples: current.plcVerification.requiredConsecutiveSamples
            }
          })
        }
        if (closed) {
          this.options.database.recordWorkOrderEvent({
            workOrderId: current.id,
            type: 'closed',
            actor: 'platform-b',
            createdAt: snapshot.timestamp,
            payload: {
              reason: 'PLC电压和电流连续5次处于工单固化的正常范围',
              voltage: device?.voltage,
              current: device?.current
            }
          })
        }
        return { workOrder: hydrateWorkOrder(current), closed }
      })
      if (!update) continue
      this.options.broadcast({
        type: update.closed ? 'work-order.closed' : 'work-order.updated',
        payload: update.workOrder
      })
    }
  }
}

function parsePaginationValue(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new WorkOrderRequestError(400, 'INVALID_QUERY', '分页参数无效')
  }
  return parsed
}

function handleRouteError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof WorkOrderRequestError) {
    return reply
      .code(error.statusCode)
      .send({ error: { code: error.code, message: error.message } })
  }
  throw error
}

export function registerWorkOrderRoutes(app: FastifyInstance, service: WorkOrderService): void {
  app.post('/api/work-orders/drafts', async (request, reply) => {
    try {
      const result = service.createDraft(request.body)
      return reply.code(result.created ? 201 : 200).send(result)
    } catch (error) {
      return handleRouteError(reply, error)
    }
  })

  app.get('/api/work-orders', async (request, reply) => {
    try {
      const query = (request.query ?? {}) as Record<string, unknown>
      const statusValue = readOptionalText(query['status'], 'status')
      if (statusValue && !WORK_ORDER_STATUSES.has(statusValue as WorkOrderStatus)) {
        throw new WorkOrderRequestError(400, 'INVALID_QUERY', '工单状态筛选值无效')
      }
      const limit = parsePaginationValue(query['limit'], 100, 1, 100)
      const offset = parsePaginationValue(query['offset'], 0, 0, Number.MAX_SAFE_INTEGER)
      return service.listWorkOrders(statusValue as WorkOrderStatus | undefined, limit, offset)
    } catch (error) {
      return handleRouteError(reply, error)
    }
  })

  app.get('/api/work-orders/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      return { workOrder: service.getWorkOrder(id) }
    } catch (error) {
      return handleRouteError(reply, error)
    }
  })

  app.delete('/api/work-orders/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      return service.deleteWorkOrder(id)
    } catch (error) {
      return handleRouteError(reply, error)
    }
  })

  app.post('/api/work-orders/:id/dispatch', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      return { workOrder: service.dispatch(id, request.body) }
    } catch (error) {
      return handleRouteError(reply, error)
    }
  })

  const listTasks = async (request: { query: unknown }, reply: FastifyReply): Promise<unknown> => {
    try {
      const query = (request.query ?? {}) as Record<string, unknown>
      const role = readOptionalText(query['role'], 'role')
      if (!role || !ROLES.has(role as WorkOrderRole)) {
        throw new WorkOrderRequestError(400, 'INVALID_QUERY', 'role 必须为 A、B 或 C')
      }
      const status = readOptionalText(query['status'], 'status')
      if (status && !TASK_STATUSES.has(status as WorkOrderTaskStatus)) {
        throw new WorkOrderRequestError(400, 'INVALID_QUERY', '任务状态筛选值无效')
      }
      return service.listAssignedTasks(
        role as WorkOrderRole,
        status as WorkOrderTaskStatus | undefined
      )
    } catch (error) {
      return handleRouteError(reply, error)
    }
  }
  app.get('/api/tasks', listTasks)
  app.get('/api/me/tasks', listTasks)

  app.post('/api/tasks/:id/start', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      return service.startTask(id)
    } catch (error) {
      return handleRouteError(reply, error)
    }
  })

  app.post('/api/tasks/:id/checkpoint', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      return service.completeSafetyCheckpoint(id, request.body)
    } catch (error) {
      return handleRouteError(reply, error)
    }
  })

  app.post('/api/tasks/:id/submit', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      return service.submitTask(id, request.body)
    } catch (error) {
      return handleRouteError(reply, error)
    }
  })
}
