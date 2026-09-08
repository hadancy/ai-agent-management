export type CollectorMode = 'simulation' | 'plc-tcp'

export type DeviceStatus = 'normal' | 'warning' | 'offline'

export interface TelemetryDevice {
  id: string
  name: string
  kind: 'pv-string' | 'battery'
  voltage: number
  current: number
  status: DeviceStatus
}

export interface PlcClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: number
  timestamp: string | null
}

export interface TelemetrySnapshot {
  sequence: number
  timestamp: string
  collectorMode: CollectorMode
  plcConnected?: boolean
  plcClock?: PlcClock
  collectorError?: string
  devices: TelemetryDevice[]
}

export interface SystemInfo {
  serviceName: string
  version: string
  collectorMode: CollectorMode
  host: string
  port: number
  apiUrl: string
  padUrl: string
  databasePath: string
}

export type WorkOrderStatus =
  'pending_review' | 'dispatched' | 'in_progress' | 'plc_verifying' | 'closed'

export type WorkOrderPriority = 'normal' | 'urgent'
export type WorkOrderRole = 'A' | 'B' | 'C'
export type WorkOrderTaskStatus = 'pending' | 'in_progress' | 'submitted'
export type WorkOrderTaskAction = 'start' | 'checkpoint' | 'submit'

export interface WorkOrderAlarm {
  voltage: number
  current: number
}

export interface WorkOrderNormalRange {
  normalVoltage: number
  normalCurrent: number
  tolerancePercent: number
  voltageMin: number
  voltageMax: number
  currentMin: number
  currentMax: number
}

export interface PlcVerificationState {
  requiredConsecutiveSamples: number
  consecutiveNormalSamples: number
  lastCheckedAt: string | null
  lastVoltage: number | null
  lastCurrent: number | null
  lastSampleNormal: boolean | null
}

export interface SafetyMonitorTaskResult {
  role: 'A'
  monitoringCompleted: boolean
  unresolvedHazards: boolean
  notes?: string
}

export interface IsolationTaskResult {
  role: 'B'
  isolationConfirmed: boolean
  voltageTestPassed: boolean
  safetyMeasuresConfirmed: boolean
  restorationConfirmed?: boolean
  powerRestored?: boolean
  checkpointNotes?: string
  restorationNotes?: string
}

export type WorkOrderTreatmentAction = 'cleaned' | 'replaced' | 'no_fault'

export interface TreatmentTaskResult {
  role: 'C'
  hotspotConfirmed: boolean
  treatmentAction: WorkOrderTreatmentAction
  retestPassed: boolean
  measuredTemperature?: number
  notes?: string
}

export interface EquipmentInspectionTaskResult {
  role: 'C'
  faultConfirmed: boolean
  treatmentSummary: string
  retestPassed: boolean
}

export type WorkOrderTaskResult =
  | SafetyMonitorTaskResult
  | IsolationTaskResult
  | TreatmentTaskResult
  | EquipmentInspectionTaskResult

export interface WorkOrderTask {
  id: string
  workOrderId: string
  role: WorkOrderRole
  assigneeName: string
  title: string
  description: string
  risks: string[]
  status: WorkOrderTaskStatus
  result: WorkOrderTaskResult | null
  startedAt: string | null
  checkpointAt: string | null
  submittedAt: string | null
  updatedAt: string
  allowedActions: WorkOrderTaskAction[]
  blockedReason: string | null
}

export interface WorkOrder {
  id: string
  orderNumber: string
  stationName: string
  deviceId: string
  stringName: string
  componentName: string
  faultType: string
  priority: WorkOrderPriority
  handlingSuggestion: string
  alarm: WorkOrderAlarm
  normalRange: WorkOrderNormalRange
  status: WorkOrderStatus
  reviewedBy: string | null
  createdAt: string
  updatedAt: string
  reviewedAt: string | null
  dispatchedAt: string | null
  verifyingAt: string | null
  closedAt: string | null
  plcVerification: PlcVerificationState
  tasks: WorkOrderTask[]
}

export type WorkOrderEventType =
  | 'draft_created'
  | 'dispatched'
  | 'task_started'
  | 'b_safety_checkpoint'
  | 'task_submitted'
  | 'plc_verification_started'
  | 'plc_sample_checked'
  | 'closed'

export interface WorkOrderEvent {
  id: number
  workOrderId: string
  type: WorkOrderEventType
  actor: string | null
  createdAt: string
  payload: unknown
}

export interface WorkOrderDetail extends WorkOrder {
  events: WorkOrderEvent[]
}

export interface CreateWorkOrderDraftRequest {
  stationName?: string
  deviceId?: string
  stringName?: string
  componentName?: string
  faultType?: string
  voltage?: number
  current?: number
  normalVoltage?: number
  normalCurrent?: number
  tolerancePercent?: number
  priority?: WorkOrderPriority
  handlingSuggestion?: string
}

export interface CreateWorkOrderDraftResponse {
  workOrder: WorkOrder
  created: boolean
  deduplicated: boolean
}

export interface WorkOrderListResponse {
  items: WorkOrder[]
  total: number
}

export interface WorkOrderResponse {
  workOrder: WorkOrder
}

export interface DeleteWorkOrderResponse {
  deleted: true
  id: string
  orderNumber: string
}

export interface WorkOrderDetailResponse {
  workOrder: WorkOrderDetail
}

export interface DispatchWorkOrderRequest {
  reviewer?: string
}

export interface AssignedWorkOrderTask extends WorkOrderTask {
  workOrderNumber: string
  stationName: string
  stringName: string
  componentName: string
  faultType: string
  priority: WorkOrderPriority
  dispatchedAt: string | null
  voiceText: string
}

export interface WorkOrderTaskListResponse {
  items: AssignedWorkOrderTask[]
  total: number
}

export interface StartWorkOrderTaskResponse {
  task: WorkOrderTask
  workOrder: WorkOrder
}

export interface CompleteSafetyCheckpointRequest {
  isolationConfirmed: boolean
  voltageTestPassed: boolean
  safetyMeasuresConfirmed: boolean
  notes?: string
}

export interface SubmitSafetyMonitorTaskRequest {
  monitoringCompleted: boolean
  unresolvedHazards: boolean
  notes?: string
}

export interface SubmitIsolationTaskRequest {
  restorationConfirmed: boolean
  powerRestored: boolean
  notes?: string
}

export interface SubmitTreatmentTaskRequest {
  hotspotConfirmed: boolean
  treatmentAction: WorkOrderTreatmentAction
  retestPassed: boolean
  measuredTemperature?: number
  notes?: string
}

export type SubmitWorkOrderTaskRequest =
  SubmitSafetyMonitorTaskRequest | SubmitIsolationTaskRequest | SubmitTreatmentTaskRequest

export interface WorkOrderTaskEventPayload {
  task: WorkOrderTask
  workOrder: WorkOrder
}

export type ServerEvent =
  | { type: 'system.ready'; payload: SystemInfo }
  | { type: 'telemetry.updated'; payload: TelemetrySnapshot }
  | { type: 'work-order.created'; payload: WorkOrder }
  | { type: 'work-order.dispatched'; payload: WorkOrder }
  | { type: 'work-order.updated'; payload: WorkOrder }
  | { type: 'work-order.closed'; payload: WorkOrder }
  | { type: 'work-order.deleted'; payload: DeleteWorkOrderResponse }
  | { type: 'task.updated'; payload: WorkOrderTaskEventPayload }
