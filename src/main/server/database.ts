import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createBuiltInWorkOrders } from './work-order-samples'
import type {
  TelemetrySnapshot,
  WorkOrder,
  WorkOrderDetail,
  WorkOrderEvent,
  WorkOrderEventType,
  WorkOrderRole,
  WorkOrderStatus,
  WorkOrderTask
} from '../../shared/contracts'

interface WorkOrderRow {
  id: string
  order_number: string
  dedupe_key: string
  station_name: string
  device_id: string
  string_name: string
  component_name: string
  fault_type: string
  priority: WorkOrder['priority']
  handling_suggestion: string
  alarm_voltage: number
  alarm_current: number
  normal_voltage: number
  normal_current: number
  tolerance_percent: number
  voltage_min: number
  voltage_max: number
  current_min: number
  current_max: number
  status: WorkOrderStatus
  reviewed_by: string | null
  created_at: string
  updated_at: string
  reviewed_at: string | null
  dispatched_at: string | null
  verifying_at: string | null
  closed_at: string | null
  plc_required_samples: number
  plc_consecutive_samples: number
  plc_last_checked_at: string | null
  plc_last_voltage: number | null
  plc_last_current: number | null
  plc_last_sample_normal: number | null
}

interface WorkOrderTaskRow {
  id: string
  work_order_id: string
  role: WorkOrderRole
  assignee_name: string
  title: string
  description: string
  risks_json: string
  status: WorkOrderTask['status']
  result_json: string | null
  started_at: string | null
  checkpoint_at: string | null
  submitted_at: string | null
  updated_at: string
}

interface WorkOrderEventRow {
  id: number
  work_order_id: string
  event_type: WorkOrderEventType
  actor: string | null
  created_at: string
  payload_json: string
}

export interface NewWorkOrderEvent {
  workOrderId: string
  type: WorkOrderEventType
  actor?: string | null
  createdAt?: string
  payload?: unknown
}

export interface AppDatabase {
  path: string
  saveTelemetry(snapshot: TelemetrySnapshot): void
  recordEvent(type: string, payload: unknown): void
  runInTransaction<T>(operation: () => T): T
  seedBuiltInWorkOrders(): void
  nextWorkOrderNumber(datePart: string): string
  findOpenWorkOrder(dedupeKey: string): WorkOrder | undefined
  insertWorkOrder(workOrder: WorkOrder, dedupeKey: string): void
  updateWorkOrder(workOrder: WorkOrder): void
  deleteWorkOrder(id: string): boolean
  getWorkOrder(id: string): WorkOrder | undefined
  getWorkOrderDetail(id: string): WorkOrderDetail | undefined
  listWorkOrders(status?: WorkOrderStatus): WorkOrder[]
  getTask(id: string): WorkOrderTask | undefined
  updateTask(task: WorkOrderTask): void
  listTasks(role: WorkOrderRole): WorkOrderTask[]
  listVerifyingWorkOrders(): WorkOrder[]
  resetVerifyingWorkOrderStreaks(): number
  recordWorkOrderEvent(event: NewWorkOrderEvent): WorkOrderEvent
  close(): void
}

function mapTaskRow(row: WorkOrderTaskRow): WorkOrderTask {
  return {
    id: row.id,
    workOrderId: row.work_order_id,
    role: row.role,
    assigneeName: row.assignee_name,
    title: row.title,
    description: row.description,
    risks: JSON.parse(row.risks_json) as string[],
    status: row.status,
    result: row.result_json
      ? (JSON.parse(row.result_json) as NonNullable<WorkOrderTask['result']>)
      : null,
    startedAt: row.started_at,
    checkpointAt: row.checkpoint_at,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    allowedActions: [],
    blockedReason: null
  }
}

function mapOrderRow(row: WorkOrderRow, tasks: WorkOrderTask[]): WorkOrder {
  return {
    id: row.id,
    orderNumber: row.order_number,
    stationName: row.station_name,
    deviceId: row.device_id,
    stringName: row.string_name,
    componentName: row.component_name,
    faultType: row.fault_type,
    priority: row.priority,
    handlingSuggestion: row.handling_suggestion,
    alarm: { voltage: row.alarm_voltage, current: row.alarm_current },
    normalRange: {
      normalVoltage: row.normal_voltage,
      normalCurrent: row.normal_current,
      tolerancePercent: row.tolerance_percent,
      voltageMin: row.voltage_min,
      voltageMax: row.voltage_max,
      currentMin: row.current_min,
      currentMax: row.current_max
    },
    status: row.status,
    reviewedBy: row.reviewed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
    dispatchedAt: row.dispatched_at,
    verifyingAt: row.verifying_at,
    closedAt: row.closed_at,
    plcVerification: {
      requiredConsecutiveSamples: row.plc_required_samples,
      consecutiveNormalSamples: row.plc_consecutive_samples,
      lastCheckedAt: row.plc_last_checked_at,
      lastVoltage: row.plc_last_voltage,
      lastCurrent: row.plc_last_current,
      lastSampleNormal:
        row.plc_last_sample_normal === null ? null : row.plc_last_sample_normal === 1
    },
    tasks
  }
}

function mapEventRow(row: WorkOrderEventRow): WorkOrderEvent {
  return {
    id: row.id,
    workOrderId: row.work_order_id,
    type: row.event_type,
    actor: row.actor,
    createdAt: row.created_at,
    payload: JSON.parse(row.payload_json) as unknown
  }
}

export function createAppDatabase(dataDirectory: string): AppDatabase {
  mkdirSync(dataDirectory, { recursive: true })
  const databasePath = join(dataDirectory, 'ai-agent-management.db')
  const database = new Database(databasePath)

  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sequence INTEGER NOT NULL,
      captured_at TEXT NOT NULL,
      collector_mode TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      dedupe_key TEXT NOT NULL,
      station_name TEXT NOT NULL,
      device_id TEXT NOT NULL,
      string_name TEXT NOT NULL,
      component_name TEXT NOT NULL,
      fault_type TEXT NOT NULL,
      priority TEXT NOT NULL,
      handling_suggestion TEXT NOT NULL,
      alarm_voltage REAL NOT NULL,
      alarm_current REAL NOT NULL,
      normal_voltage REAL NOT NULL,
      normal_current REAL NOT NULL,
      tolerance_percent REAL NOT NULL,
      voltage_min REAL NOT NULL,
      voltage_max REAL NOT NULL,
      current_min REAL NOT NULL,
      current_max REAL NOT NULL,
      status TEXT NOT NULL,
      reviewed_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT,
      dispatched_at TEXT,
      verifying_at TEXT,
      closed_at TEXT,
      plc_required_samples INTEGER NOT NULL DEFAULT 5,
      plc_consecutive_samples INTEGER NOT NULL DEFAULT 0,
      plc_last_checked_at TEXT,
      plc_last_voltage REAL,
      plc_last_current REAL,
      plc_last_sample_normal INTEGER
    );

    CREATE TABLE IF NOT EXISTS work_order_tasks (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      assignee_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      risks_json TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      started_at TEXT,
      checkpoint_at TEXT,
      submitted_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(work_order_id, role)
    );

    CREATE TABLE IF NOT EXISTS work_order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      actor TEXT,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_captured_at
      ON telemetry_snapshots(captured_at);
    CREATE INDEX IF NOT EXISTS idx_work_orders_status_created
      ON work_orders(status, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_open_dedupe
      ON work_orders(dedupe_key) WHERE status <> 'closed';
    CREATE INDEX IF NOT EXISTS idx_work_order_tasks_role_status
      ON work_order_tasks(role, status);
    CREATE INDEX IF NOT EXISTS idx_work_order_events_order_created
      ON work_order_events(work_order_id, created_at, id);
  `)

  const saveTelemetryStatement = database.prepare(`
    INSERT INTO telemetry_snapshots(sequence, captured_at, collector_mode, payload_json)
    VALUES (@sequence, @capturedAt, @collectorMode, @payloadJson)
  `)
  const recordEventStatement = database.prepare(`
    INSERT INTO system_events(event_type, created_at, payload_json)
    VALUES (@eventType, @createdAt, @payloadJson)
  `)
  const insertWorkOrderStatement = database.prepare(`
    INSERT INTO work_orders(
      id, order_number, dedupe_key, station_name, device_id, string_name, component_name,
      fault_type, priority, handling_suggestion, alarm_voltage, alarm_current,
      normal_voltage, normal_current, tolerance_percent, voltage_min, voltage_max,
      current_min, current_max, status, reviewed_by, created_at, updated_at, reviewed_at,
      dispatched_at, verifying_at, closed_at, plc_required_samples, plc_consecutive_samples,
      plc_last_checked_at, plc_last_voltage, plc_last_current, plc_last_sample_normal
    ) VALUES (
      @id, @orderNumber, @dedupeKey, @stationName, @deviceId, @stringName, @componentName,
      @faultType, @priority, @handlingSuggestion, @alarmVoltage, @alarmCurrent,
      @normalVoltage, @normalCurrent, @tolerancePercent, @voltageMin, @voltageMax,
      @currentMin, @currentMax, @status, @reviewedBy, @createdAt, @updatedAt, @reviewedAt,
      @dispatchedAt, @verifyingAt, @closedAt, @plcRequiredSamples, @plcConsecutiveSamples,
      @plcLastCheckedAt, @plcLastVoltage, @plcLastCurrent, @plcLastSampleNormal
    )
  `)
  const updateWorkOrderStatement = database.prepare(`
    UPDATE work_orders SET
      station_name = @stationName, device_id = @deviceId, string_name = @stringName,
      component_name = @componentName, fault_type = @faultType, priority = @priority,
      handling_suggestion = @handlingSuggestion, alarm_voltage = @alarmVoltage,
      alarm_current = @alarmCurrent, normal_voltage = @normalVoltage,
      normal_current = @normalCurrent, tolerance_percent = @tolerancePercent,
      voltage_min = @voltageMin, voltage_max = @voltageMax, current_min = @currentMin,
      current_max = @currentMax, status = @status, reviewed_by = @reviewedBy,
      updated_at = @updatedAt, reviewed_at = @reviewedAt, dispatched_at = @dispatchedAt,
      verifying_at = @verifyingAt, closed_at = @closedAt,
      plc_required_samples = @plcRequiredSamples,
      plc_consecutive_samples = @plcConsecutiveSamples,
      plc_last_checked_at = @plcLastCheckedAt, plc_last_voltage = @plcLastVoltage,
      plc_last_current = @plcLastCurrent, plc_last_sample_normal = @plcLastSampleNormal
    WHERE id = @id
  `)
  const insertTaskStatement = database.prepare(`
    INSERT INTO work_order_tasks(
      id, work_order_id, role, assignee_name, title, description, risks_json, status,
      result_json, started_at, checkpoint_at, submitted_at, updated_at
    ) VALUES (
      @id, @workOrderId, @role, @assigneeName, @title, @description, @risksJson, @status,
      @resultJson, @startedAt, @checkpointAt, @submittedAt, @updatedAt
    )
  `)
  const updateTaskStatement = database.prepare(`
    UPDATE work_order_tasks SET
      assignee_name = @assigneeName, title = @title, description = @description,
      risks_json = @risksJson, status = @status, result_json = @resultJson,
      started_at = @startedAt, checkpoint_at = @checkpointAt,
      submitted_at = @submittedAt, updated_at = @updatedAt
    WHERE id = @id
  `)
  const insertWorkOrderEventStatement = database.prepare(`
    INSERT INTO work_order_events(work_order_id, event_type, actor, created_at, payload_json)
    VALUES (@workOrderId, @eventType, @actor, @createdAt, @payloadJson)
  `)

  const taskParameters = (task: WorkOrderTask): Record<string, unknown> => ({
    id: task.id,
    workOrderId: task.workOrderId,
    role: task.role,
    assigneeName: task.assigneeName,
    title: task.title,
    description: task.description,
    risksJson: JSON.stringify(task.risks),
    status: task.status,
    resultJson: task.result ? JSON.stringify(task.result) : null,
    startedAt: task.startedAt,
    checkpointAt: task.checkpointAt,
    submittedAt: task.submittedAt,
    updatedAt: task.updatedAt
  })

  const orderParameters = (workOrder: WorkOrder, dedupeKey?: string): Record<string, unknown> => ({
    id: workOrder.id,
    orderNumber: workOrder.orderNumber,
    dedupeKey,
    stationName: workOrder.stationName,
    deviceId: workOrder.deviceId,
    stringName: workOrder.stringName,
    componentName: workOrder.componentName,
    faultType: workOrder.faultType,
    priority: workOrder.priority,
    handlingSuggestion: workOrder.handlingSuggestion,
    alarmVoltage: workOrder.alarm.voltage,
    alarmCurrent: workOrder.alarm.current,
    normalVoltage: workOrder.normalRange.normalVoltage,
    normalCurrent: workOrder.normalRange.normalCurrent,
    tolerancePercent: workOrder.normalRange.tolerancePercent,
    voltageMin: workOrder.normalRange.voltageMin,
    voltageMax: workOrder.normalRange.voltageMax,
    currentMin: workOrder.normalRange.currentMin,
    currentMax: workOrder.normalRange.currentMax,
    status: workOrder.status,
    reviewedBy: workOrder.reviewedBy,
    createdAt: workOrder.createdAt,
    updatedAt: workOrder.updatedAt,
    reviewedAt: workOrder.reviewedAt,
    dispatchedAt: workOrder.dispatchedAt,
    verifyingAt: workOrder.verifyingAt,
    closedAt: workOrder.closedAt,
    plcRequiredSamples: workOrder.plcVerification.requiredConsecutiveSamples,
    plcConsecutiveSamples: workOrder.plcVerification.consecutiveNormalSamples,
    plcLastCheckedAt: workOrder.plcVerification.lastCheckedAt,
    plcLastVoltage: workOrder.plcVerification.lastVoltage,
    plcLastCurrent: workOrder.plcVerification.lastCurrent,
    plcLastSampleNormal:
      workOrder.plcVerification.lastSampleNormal === null
        ? null
        : Number(workOrder.plcVerification.lastSampleNormal)
  })

  const loadTasks = (workOrderId: string): WorkOrderTask[] => {
    const rows = database
      .prepare('SELECT * FROM work_order_tasks WHERE work_order_id = ? ORDER BY role')
      .all(workOrderId) as WorkOrderTaskRow[]
    return rows.map(mapTaskRow)
  }

  const loadOrder = (row: WorkOrderRow | undefined): WorkOrder | undefined => {
    if (!row) return undefined
    return mapOrderRow(row, loadTasks(row.id))
  }

  const getEvents = (workOrderId: string): WorkOrderEvent[] => {
    const rows = database
      .prepare('SELECT * FROM work_order_events WHERE work_order_id = ? ORDER BY id')
      .all(workOrderId) as WorkOrderEventRow[]
    return rows.map(mapEventRow)
  }

  const insertOrderWithTasks = database.transaction(
    (workOrder: WorkOrder, dedupeKey: string): void => {
      insertWorkOrderStatement.run(orderParameters(workOrder, dedupeKey))
      for (const task of workOrder.tasks) insertTaskStatement.run(taskParameters(task))
    }
  )

  return {
    path: databasePath,
    saveTelemetry(snapshot) {
      saveTelemetryStatement.run({
        sequence: snapshot.sequence,
        capturedAt: snapshot.timestamp,
        collectorMode: snapshot.collectorMode,
        payloadJson: JSON.stringify(snapshot)
      })
    },
    recordEvent(type, payload) {
      recordEventStatement.run({
        eventType: type,
        createdAt: new Date().toISOString(),
        payloadJson: JSON.stringify(payload)
      })
    },
    runInTransaction<T>(operation: () => T): T {
      return database.transaction(operation)()
    },
    seedBuiltInWorkOrders() {
      this.runInTransaction(() => {
        const initializedEvent = 'work-order.builtins-initialized.v1'
        const updatedEvent = 'work-order.builtins-updated.v2'
        const locationEvent = 'work-order.builtins-locations.v3'
        const combinationEvent = 'work-order.builtins-combinations.v4'
        const hasEvent = (eventType: string): boolean =>
          Boolean(
            database
              .prepare('SELECT 1 FROM system_events WHERE event_type = ? LIMIT 1')
              .get(eventType)
          )
        if (hasEvent(combinationEvent)) return

        const samples = createBuiltInWorkOrders((datePart) => this.nextWorkOrderNumber(datePart))
        if (!hasEvent(updatedEvent)) {
          if (!hasEvent(initializedEvent)) {
            for (const workOrder of samples) {
              // 样例使用独立去重键，避免拦截真实故障生成工单。
              this.insertWorkOrder(workOrder, workOrder.id)
              this.recordWorkOrderEvent({
                workOrderId: workOrder.id,
                type: 'draft_created',
                actor: 'builtin-sample',
                createdAt: workOrder.createdAt,
                payload: { sample: true, orderNumber: workOrder.orderNumber }
              })
              if (workOrder.closedAt) {
                this.recordWorkOrderEvent({
                  workOrderId: workOrder.id,
                  type: 'closed',
                  actor: 'builtin-sample',
                  createdAt: workOrder.closedAt,
                  payload: { sample: true, plcVerification: workOrder.plcVerification }
                })
              }
            }
            this.recordEvent(initializedEvent, { count: samples.length })
          } else {
            for (const sample of samples) {
              const current = this.getWorkOrder(sample.id)
              // 更新现有展示数据，不恢复用户已经删除的样例。
              if (!current) continue
              const untouched =
                current.updatedAt === sample.updatedAt && current.status === sample.status
              this.updateWorkOrder({
                ...current,
                componentName: sample.componentName,
                faultType: sample.faultType,
                handlingSuggestion: sample.handlingSuggestion,
                alarm: sample.alarm
              })
              for (const task of current.tasks) {
                const template = sample.tasks.find((item) => item.role === task.role)
                if (!template) continue
                this.updateTask({
                  ...task,
                  title: template.title,
                  description: template.description,
                  risks: template.risks,
                  // 已人工操作的任务保留其回填结果和执行时间。
                  result: untouched ? template.result : task.result
                })
              }
            }
          }
          const obsolete = this.getWorkOrder('builtin-work-order-1')
          const removedId =
            obsolete?.status === 'closed' && this.deleteWorkOrder(obsolete.id) ? obsolete.id : null
          this.recordEvent(updatedEvent, {
            sampleIds: samples.map((sample) => sample.id),
            removedId
          })
        }
        if (!hasEvent(locationEvent)) {
          for (const sample of samples) {
            const current = this.getWorkOrder(sample.id)
            if (!current) continue
            this.updateWorkOrder({
              ...current,
              deviceId: sample.deviceId,
              stringName: sample.stringName
            })
            for (const task of current.tasks) {
              if (!task.description.includes(current.stringName)) continue
              this.updateTask({
                ...task,
                description: task.description.replaceAll(current.stringName, sample.stringName)
              })
            }
          }
          this.recordEvent(locationEvent, {
            locations: samples.map(({ id, stringName, deviceId }) => ({ id, stringName, deviceId }))
          })
        }
        for (const sample of samples) {
          const current = this.getWorkOrder(sample.id)
          if (!current) continue
          const reconfigured = { ...sample, orderNumber: current.orderNumber }
          this.updateWorkOrder(reconfigured)
          for (const task of sample.tasks) {
            const existingTask = current.tasks.find((item) => item.role === task.role)
            if (existingTask) this.updateTask({ ...task, id: existingTask.id })
          }
          // 展示工单状态重新配置时，其任务、PLC 验证和展示记录一并同步。
          database.prepare('DELETE FROM work_order_events WHERE work_order_id = ?').run(sample.id)
          this.recordWorkOrderEvent({
            workOrderId: sample.id,
            type: 'draft_created',
            actor: 'builtin-sample',
            createdAt: sample.createdAt,
            payload: { sample: true, orderNumber: current.orderNumber }
          })
          if (sample.closedAt)
            this.recordWorkOrderEvent({
              workOrderId: sample.id,
              type: 'closed',
              actor: 'builtin-sample',
              createdAt: sample.closedAt,
              payload: { sample: true, plcVerification: sample.plcVerification }
            })
        }
        this.recordEvent(combinationEvent, {
          samples: samples.map(({ id, stringName, priority, status }) => ({
            id,
            stringName,
            priority,
            status
          }))
        })
      })
    },
    nextWorkOrderNumber(datePart) {
      const prefix = `GZ-${datePart}-`
      const row = database
        .prepare(
          `SELECT MAX(CAST(SUBSTR(order_number, ?) AS INTEGER)) AS sequence
           FROM work_orders
           WHERE order_number LIKE ?`
        )
        .get(prefix.length + 1, `${prefix}%`) as { sequence: number | null }
      const previousSequence = row.sequence ?? 0
      return `${prefix}${String(previousSequence + 1).padStart(3, '0')}`
    },
    findOpenWorkOrder(dedupeKey) {
      const row = database
        .prepare("SELECT * FROM work_orders WHERE dedupe_key = ? AND status <> 'closed' LIMIT 1")
        .get(dedupeKey) as WorkOrderRow | undefined
      return loadOrder(row)
    },
    insertWorkOrder(workOrder, dedupeKey) {
      insertOrderWithTasks(workOrder, dedupeKey)
    },
    updateWorkOrder(workOrder) {
      updateWorkOrderStatement.run(orderParameters(workOrder))
    },
    deleteWorkOrder(id) {
      return database.prepare('DELETE FROM work_orders WHERE id = ?').run(id).changes > 0
    },
    getWorkOrder(id) {
      const row = database.prepare('SELECT * FROM work_orders WHERE id = ?').get(id) as
        WorkOrderRow | undefined
      return loadOrder(row)
    },
    getWorkOrderDetail(id) {
      const row = database.prepare('SELECT * FROM work_orders WHERE id = ?').get(id) as
        WorkOrderRow | undefined
      const workOrder = loadOrder(row)
      return workOrder ? { ...workOrder, events: getEvents(id) } : undefined
    },
    listWorkOrders(status) {
      const rows = (
        status
          ? database
              .prepare('SELECT * FROM work_orders WHERE status = ? ORDER BY created_at DESC')
              .all(status)
          : database.prepare('SELECT * FROM work_orders ORDER BY created_at DESC').all()
      ) as WorkOrderRow[]
      return rows.map((row) => mapOrderRow(row, loadTasks(row.id)))
    },
    getTask(id) {
      const row = database.prepare('SELECT * FROM work_order_tasks WHERE id = ?').get(id) as
        WorkOrderTaskRow | undefined
      return row ? mapTaskRow(row) : undefined
    },
    updateTask(task) {
      updateTaskStatement.run(taskParameters(task))
    },
    listTasks(role) {
      const rows = database
        .prepare(
          `SELECT task.*
           FROM work_order_tasks task
           JOIN work_orders work_order ON work_order.id = task.work_order_id
           WHERE task.role = ? AND work_order.status <> 'pending_review'
           ORDER BY work_order.created_at DESC`
        )
        .all(role) as WorkOrderTaskRow[]
      return rows.map(mapTaskRow)
    },
    listVerifyingWorkOrders() {
      const rows = database
        .prepare("SELECT * FROM work_orders WHERE status = 'plc_verifying' ORDER BY created_at")
        .all() as WorkOrderRow[]
      return rows.map((row) => mapOrderRow(row, loadTasks(row.id)))
    },
    resetVerifyingWorkOrderStreaks() {
      const timestamp = new Date().toISOString()
      const result = database
        .prepare(
          `UPDATE work_orders
           SET plc_consecutive_samples = 0,
               plc_last_checked_at = NULL,
               plc_last_voltage = NULL,
               plc_last_current = NULL,
               plc_last_sample_normal = NULL,
               updated_at = ?
           WHERE status = 'plc_verifying'`
        )
        .run(timestamp)
      return result.changes
    },
    recordWorkOrderEvent(event) {
      const createdAt = event.createdAt ?? new Date().toISOString()
      const result = insertWorkOrderEventStatement.run({
        workOrderId: event.workOrderId,
        eventType: event.type,
        actor: event.actor ?? null,
        createdAt,
        payloadJson: JSON.stringify(event.payload ?? null)
      })
      return {
        id: Number(result.lastInsertRowid),
        workOrderId: event.workOrderId,
        type: event.type,
        actor: event.actor ?? null,
        createdAt,
        payload: event.payload ?? null
      }
    },
    close() {
      database.close()
    }
  }
}
