export type PadRole = 'A' | 'B' | 'C'

export type PadTaskStatus = 'pending' | 'in_progress' | 'completed'

export interface PadTask {
  id: string
  workOrderId: string
  workOrderNumber: string
  role: PadRole
  status: PadTaskStatus
  title: string
  content: string
  riskPoints: string[]
  faultType: string
  stationName?: string
  equipmentName?: string
  priority?: string
  dispatchedAt?: string
  startedAt?: string
  completedAt?: string
  checkpointCompleted: boolean
  canStart: boolean
  canCheckpoint: boolean
  canSubmit: boolean
  blockedReason?: string
  voiceText?: string
  resultSummary: string[]
}

export type TaskAction = 'start' | 'checkpoint' | 'submit'

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {}
}

function firstValue(records: UnknownRecord[], keys: string[]): unknown {
  for (const record of records) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) return record[key]
    }
  }
  return undefined
}

function readString(records: UnknownRecord[], keys: string[], fallback = ''): string {
  const value = firstValue(records, keys)
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number') return String(value)
  return fallback
}

function readBoolean(records: UnknownRecord[], keys: string[]): boolean | undefined {
  const value = firstValue(records, keys)
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return undefined
}

function normalizeRole(value: unknown, fallback: PadRole): PadRole {
  const role = String(value ?? '')
    .trim()
    .toUpperCase()
  return role === 'A' || role === 'B' || role === 'C' ? role : fallback
}

function normalizeStatus(value: unknown): PadTaskStatus {
  const status = String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_')

  if (
    [
      'completed',
      'complete',
      'submitted',
      'approved',
      'passed',
      'closed',
      '已完成',
      '已提交',
      '已通过'
    ].includes(status)
  ) {
    return 'completed'
  }
  if (
    ['in_progress', 'processing', 'started', 'working', '处理中', '执行中', '已开始'].includes(
      status
    )
  ) {
    return 'in_progress'
  }
  return 'pending'
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim()
        const record = asRecord(item)
        return readString([record], ['text', 'name', 'label', 'content', 'description'])
      })
      .filter(Boolean)
  }

  if (typeof value !== 'string' || !value.trim()) return []
  const source = value.trim()
  if (source.startsWith('[')) {
    try {
      return stringList(JSON.parse(source) as unknown)
    } catch {
      // Fall through to delimiter parsing for malformed legacy data.
    }
  }
  return source
    .split(/\r?\n|[、,，;；]/)
    .map((item) => item.replace(/^[-•\s]+/, '').trim())
    .filter(Boolean)
}

function resultSummary(role: PadRole, result: UnknownRecord, checkpoint: UnknownRecord): string[] {
  const summary: string[] = []
  const notes = readString([result], ['notes', 'remark', 'description'])

  if (role === 'A') {
    if (readBoolean([result], ['monitoringCompleted', 'monitoring_completed'])) {
      summary.push('已完成全程安全监护')
    }
    if (
      readBoolean([result], ['unresolvedHazards', 'unresolved_hazards']) === false ||
      readBoolean([result], ['noSafetyIncident', 'no_safety_incident']) === true
    ) {
      summary.push('未发现未处理安全异常')
    } else if (readBoolean([result], ['unresolvedHazards', 'unresolved_hazards']) === true) {
      summary.push('存在未解决安全隐患')
    }
  }

  if (role === 'B') {
    if (readBoolean([checkpoint], ['isolationConfirmed', 'isolation_confirmed', 'isolated'])) {
      summary.push('已确认组串隔离')
    }
    if (readBoolean([checkpoint], ['voltageTestPassed', 'voltage_test_passed'])) {
      const voltage = readString([checkpoint], ['measuredVoltage', 'measured_voltage'])
      summary.push(voltage ? `验电合格（${voltage} V）` : '验电合格')
    }
    if (readBoolean([checkpoint], ['safetyMeasuresConfirmed', 'safety_measures_confirmed'])) {
      summary.push('安全措施已确认')
    }
    if (
      readBoolean(
        [result],
        [
          'restorationConfirmed',
          'restoration_confirmed',
          'connectionRestored',
          'connection_restored'
        ]
      )
    ) {
      summary.push('已恢复组串连接')
    }
    if (readBoolean([result], ['powerRestored', 'power_restored'])) summary.push('已确认恢复送电')
    const checkpointNotes = readString([result], ['checkpointNotes', 'checkpoint_notes'])
    const restorationNotes = readString([result], ['restorationNotes', 'restoration_notes'])
    if (checkpointNotes) summary.push(`隔离验电备注：${checkpointNotes}`)
    if (restorationNotes) summary.push(`恢复送电备注：${restorationNotes}`)
  }

  if (role === 'C') {
    if (readBoolean([result], ['hotspotConfirmed', 'hotspot_confirmed'])) summary.push('已确认热斑')
    const treatment = readString(
      [result],
      ['treatmentAction', 'treatment_action', 'treatment', 'treatmentType', 'treatment_type']
    )
    if (treatment === 'cleaned') summary.push('处理方式：清理遮挡物')
    if (treatment === 'replaced') summary.push('处理方式：更换故障组件')
    if (treatment === 'no_fault') summary.push('现场未发现故障，无需处理')
    if (readBoolean([result], ['retestPassed', 'retest_passed'])) summary.push('处理后复测合格')
    const temperature = readString([result], ['measuredTemperature', 'measured_temperature'])
    if (temperature) summary.push(`复测温度：${temperature} ℃`)
  }

  if (notes) summary.push(`备注：${notes}`)
  return summary
}

function normalizeTask(value: unknown, requestedRole: PadRole, index: number): PadTask {
  const task = asRecord(value)
  const workOrder = asRecord(firstValue([task], ['workOrder', 'work_order', 'order']))
  const checkpoint = asRecord(
    firstValue([task], ['checkpoint', 'checkpointData', 'checkpoint_data', 'precheck'])
  )
  const result = asRecord(
    firstValue([task], ['result', 'resultData', 'result_data', 'submission', 'taskResult'])
  )
  const permissions = asRecord(firstValue([task], ['permissions', 'actionPermissions', 'actions']))
  const rawAllowedActions = firstValue([task], ['allowedActions', 'allowed_actions'])
  const allowedActions = Array.isArray(rawAllowedActions)
    ? rawAllowedActions.map((action) => String(action))
    : undefined
  const records = [task, workOrder]
  const role = normalizeRole(
    firstValue([task], ['role', 'assigneeRole', 'assignee_role', 'workerRole']),
    requestedRole
  )
  const workOrderNumber = readString(
    records,
    ['workOrderNumber', 'workOrderNo', 'work_order_no', 'orderNumber', 'number', 'code'],
    '待同步'
  )
  const id = readString([task], ['id', 'taskId', 'task_id'], `${workOrderNumber}-${role}-${index}`)
  const status = normalizeStatus(firstValue([task], ['status', 'taskStatus', 'task_status']))
  const checkpointFlag = readBoolean(
    [task, checkpoint],
    ['checkpointCompleted', 'checkpoint_completed', 'precheckCompleted', 'precheck_completed']
  )
  const checkpointStatus = readString([checkpoint], ['status']).toLowerCase()
  const checkpointAt = readString([task], ['checkpointAt', 'checkpoint_at'])
  const checkpointCompleted =
    status === 'completed' ||
    Boolean(checkpointAt) ||
    checkpointFlag === true ||
    ['completed', 'passed', 'approved', '已完成', '已通过'].includes(checkpointStatus) ||
    (readBoolean(
      [checkpoint, result],
      ['isolationConfirmed', 'isolation_confirmed', 'isolated']
    ) === true &&
      readBoolean([checkpoint, result], ['voltageTestPassed', 'voltage_test_passed']) === true &&
      readBoolean(
        [checkpoint, result],
        ['safetyMeasuresConfirmed', 'safety_measures_confirmed']
      ) === true)

  const canStart =
    (allowedActions
      ? allowedActions.includes('start')
      : readBoolean([task, permissions], ['canStart', 'can_start', 'start'])) ??
    status === 'pending'
  const canCheckpoint =
    (allowedActions
      ? allowedActions.includes('checkpoint')
      : readBoolean([task, permissions], ['canCheckpoint', 'can_checkpoint', 'checkpoint'])) ??
    (role === 'B' && status === 'in_progress' && !checkpointCompleted)
  const canSubmit =
    (allowedActions
      ? allowedActions.includes('submit')
      : readBoolean([task, permissions], ['canSubmit', 'can_submit', 'submit'])) ??
    status === 'in_progress'
  const stringName = readString(records, ['stringName', 'string_name'])
  const componentName = readString(records, ['componentName', 'component_name'])

  return {
    id,
    workOrderId: readString(records, ['workOrderId', 'work_order_id', 'orderId', 'id']),
    workOrderNumber,
    role,
    status,
    title: readString(
      [task],
      ['title', 'taskTitle', 'task_title', 'duty'],
      role === 'A' ? '安全监护' : role === 'B' ? '隔离、验电与恢复' : '热斑确认与处理'
    ),
    content: readString(
      [task],
      ['content', 'taskContent', 'task_content', 'description', 'instruction'],
      '请按工单要求规范处理并提交结果。'
    ),
    riskPoints: stringList(
      firstValue([task, workOrder], ['riskPoints', 'risk_points', 'risks', 'riskWarnings'])
    ),
    faultType: readString(
      records,
      ['faultType', 'fault_type', 'alarmType', 'failureType'],
      '待确认故障'
    ),
    stationName: readString(records, ['stationName', 'station_name', 'siteName']) || undefined,
    equipmentName:
      readString(records, ['equipmentName', 'equipment_name']) ||
      [stringName, componentName].filter(Boolean).join(' · ') ||
      undefined,
    priority: readString(records, ['priority', 'urgency', 'priorityLabel']) || undefined,
    dispatchedAt:
      readString(records, ['dispatchedAt', 'dispatched_at', 'issuedAt', 'createdAt']) || undefined,
    startedAt: readString([task], ['startedAt', 'started_at']) || undefined,
    completedAt:
      readString([task], ['completedAt', 'completed_at', 'submittedAt', 'submitted_at']) ||
      undefined,
    checkpointCompleted,
    canStart,
    canCheckpoint,
    canSubmit,
    blockedReason:
      readString(
        [task, permissions],
        ['blockedReason', 'blocked_reason', 'unmetReason', 'reason', 'message']
      ) || undefined,
    voiceText:
      readString([task], ['voiceText', 'voice_text', 'speechText', 'broadcastContent']) ||
      undefined,
    resultSummary: resultSummary(role, result, Object.keys(checkpoint).length ? checkpoint : result)
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function responseMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value
  const record = asRecord(value)
  const nestedError = asRecord(record.error)
  return readString([record, nestedError], ['message', 'error', 'reason', 'detail'], fallback)
}

export async function fetchPadTasks(
  serviceOrigin: string,
  role: PadRole,
  signal?: AbortSignal
): Promise<PadTask[]> {
  let response: Response
  try {
    response = await fetch(`${serviceOrigin}/api/tasks?role=${encodeURIComponent(role)}`, {
      headers: { Accept: 'application/json' },
      signal
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('无法连接平台 B，请检查网络后重试。')
  }

  const payload = await parseResponse(response)
  if (!response.ok) {
    throw new Error(responseMessage(payload, `任务同步失败（${response.status}）`))
  }

  const record = asRecord(payload)
  const values = Array.isArray(payload)
    ? payload
    : Array.isArray(record.items)
      ? record.items
      : Array.isArray(record.tasks)
        ? record.tasks
        : Array.isArray(record.data)
          ? record.data
          : []

  return values
    .map((item, index) => normalizeTask(item, role, index))
    .filter((task) => task.role === role)
    .sort((left, right) => {
      const statusOrder: Record<PadTaskStatus, number> = {
        in_progress: 0,
        pending: 1,
        completed: 2
      }
      const statusDifference = statusOrder[left.status] - statusOrder[right.status]
      if (statusDifference !== 0) return statusDifference
      return Date.parse(right.dispatchedAt ?? '') - Date.parse(left.dispatchedAt ?? '') || 0
    })
}

export async function postTaskAction(
  serviceOrigin: string,
  taskId: string,
  action: TaskAction,
  body: UnknownRecord = {}
): Promise<void> {
  let response: Response
  try {
    response = await fetch(
      `${serviceOrigin}/api/tasks/${encodeURIComponent(taskId)}/${encodeURIComponent(action)}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    )
  } catch {
    throw new Error('结果未能上传，请保留当前页面并在网络恢复后重试。')
  }

  const payload = await parseResponse(response)
  if (!response.ok) {
    throw new Error(responseMessage(payload, `操作失败（${response.status}）`))
  }
}
