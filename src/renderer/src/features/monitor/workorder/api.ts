export type WorkOrderStatus =
  'pending_review' | 'dispatched' | 'in_progress' | 'plc_verifying' | 'closed'

export type WorkOrderTaskStatus = 'pending' | 'in_progress' | 'submitted'
export type WorkOrderRole = 'A' | 'B' | 'C'

export type WorkOrderTask = {
  id: string
  role: WorkOrderRole
  assigneeName: string
  title: string
  description: string
  risks: string[]
  status: WorkOrderTaskStatus
  startedAt: string | null
  checkpointAt: string | null
  submittedAt: string | null
  result: Record<string, unknown> | null
  allowedActions: string[]
  blockedReason: string | null
}

export type PlcVerification = {
  requiredConsecutiveSamples: number
  consecutiveNormalSamples: number
  lastCheckedAt: string | null
  lastVoltage: number | null
  lastCurrent: number | null
  lastSampleNormal: boolean | null
}

export type WorkOrder = {
  id: string
  orderNumber: string
  stationName: string
  deviceId: string
  stringName: string
  componentName: string
  faultType: string
  priority: 'normal' | 'urgent'
  handlingSuggestion: string
  alarm: {
    voltage: number
    current: number
  }
  normalRange: {
    normalVoltage: number
    normalCurrent: number
    tolerancePercent: number
    voltageMin: number
    voltageMax: number
    currentMin: number
    currentMax: number
  }
  status: WorkOrderStatus
  createdAt: string
  updatedAt: string
  reviewedAt: string | null
  dispatchedAt: string | null
  verifyingAt: string | null
  closedAt: string | null
  plcVerification: PlcVerification | null
  tasks: WorkOrderTask[]
}

export type CreateWorkOrderDraftInput = {
  stationName?: string
  deviceId?: 'pv-1'
  stringName?: string
  componentName?: string
  faultType?: string
  voltage?: number
  current?: number
  normalVoltage?: number
  normalCurrent?: number
  tolerancePercent?: number
  priority?: 'normal' | 'urgent'
  handlingSuggestion?: string
}

export type CreateWorkOrderDraftResult = {
  workOrder: WorkOrder
  created: boolean
  deduplicated: boolean
}

type WorkOrderListResponse = {
  items: WorkOrder[]
  total: number
}

type WorkOrderResponse = {
  workOrder: WorkOrder
}

type DeleteWorkOrderResponse = {
  deleted: true
  id: string
  orderNumber: string
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as unknown
  if (!response.ok) {
    const record =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null
    const nestedError =
      typeof record?.error === 'object' && record.error !== null
        ? (record.error as Record<string, unknown>)
        : null
    const message =
      (typeof record?.message === 'string' ? record.message : undefined) ??
      (typeof record?.error === 'string' ? record.error : undefined) ??
      (typeof nestedError?.message === 'string' ? nestedError.message : undefined) ??
      `服务请求失败（${response.status}）`
    throw new Error(message)
  }
  if (payload === null) throw new Error('服务返回了空响应')
  return payload as T
}

export async function listWorkOrders(
  serviceOrigin: string,
  signal?: AbortSignal
): Promise<WorkOrderListResponse> {
  const response = await fetch(`${serviceOrigin}/api/work-orders?limit=100&offset=0`, { signal })
  return readJson<WorkOrderListResponse>(response)
}

export async function getWorkOrder(
  serviceOrigin: string,
  id: string,
  signal?: AbortSignal
): Promise<WorkOrder> {
  const response = await fetch(`${serviceOrigin}/api/work-orders/${encodeURIComponent(id)}`, {
    signal
  })
  return (await readJson<WorkOrderResponse>(response)).workOrder
}

export async function createWorkOrderDraft(
  serviceOrigin: string,
  input: CreateWorkOrderDraftInput
): Promise<CreateWorkOrderDraftResult> {
  const response = await fetch(`${serviceOrigin}/api/work-orders/drafts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  return readJson<CreateWorkOrderDraftResult>(response)
}

export async function dispatchWorkOrder(
  serviceOrigin: string,
  id: string,
  reviewer = '平台B审核员'
): Promise<WorkOrder> {
  const response = await fetch(
    `${serviceOrigin}/api/work-orders/${encodeURIComponent(id)}/dispatch`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewer })
    }
  )
  return (await readJson<WorkOrderResponse>(response)).workOrder
}

export async function deleteWorkOrder(
  serviceOrigin: string,
  id: string,
  orderNumber: string
): Promise<DeleteWorkOrderResponse> {
  const url = `${serviceOrigin}/api/work-orders/${encodeURIComponent(id)}`
  let retriedAfterNetworkError = false

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'DELETE' })
      if (response.status === 404 && retriedAfterNetworkError) {
        return { deleted: true, id, orderNumber }
      }
      return await readJson<DeleteWorkOrderResponse>(response)
    } catch (error) {
      if (!(error instanceof TypeError) || attempt === 2) throw error
      retriedAfterNetworkError = true
      await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)))
    }
  }

  throw new Error('无法连接工单服务')
}
