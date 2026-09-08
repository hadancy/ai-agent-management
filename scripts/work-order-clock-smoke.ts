import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppDatabase } from '../src/main/server/database'
import { WorkOrderService } from '../src/main/server/work-orders'
import type { TelemetrySnapshot, WorkOrder } from '../src/shared/contracts'
import { PlcSynchronizedClock } from '../src/shared/plc-clock'

const dataDirectory = mkdtempSync(join(tmpdir(), 'work-order-clock-'))
const database = createAppDatabase(dataDirectory)
const originalNow = Date.now
const originalTimeZone = process.env['TZ']
let systemNow = Date.parse('2026-09-07T00:00:00.000Z')
let snapshot: TelemetrySnapshot | undefined
const screenClock = new PlcSynchronizedClock()
const service = new WorkOrderService({
  database,
  broadcast: () => {},
  getLatestSnapshot: () => snapshot
})

function sample(plcTimestamp: string | null): void {
  snapshot = {
    sequence: (snapshot?.sequence ?? 0) + 1,
    timestamp: new Date(systemNow).toISOString(),
    collectorMode: 'plc-tcp',
    plcConnected: true,
    plcClock: {
      year: 2042,
      month: 12,
      day: 31,
      hour: 23,
      minute: 59,
      second: 59,
      weekday: 4,
      timestamp: plcTimestamp
    },
    devices: [
      {
        id: 'pv-1',
        name: '1号光伏组串',
        kind: 'pv-string',
        voltage: 613,
        current: 9.4,
        status: 'normal'
      }
    ]
  }
  screenClock.update(snapshot)
  service.processTelemetry(snapshot)
}

function create(componentName: string): WorkOrder {
  const result = service.createDraft({ componentName })
  assert.equal(result.created, true)
  assert.equal(
    result.workOrder.createdAt,
    screenClock.now(systemNow).toISOString(),
    '创建时间应与右上角的 PLC 校准时钟一致'
  )
  assert.equal(result.workOrder.updatedAt, result.workOrder.createdAt)
  assert.ok(result.workOrder.tasks.every((task) => task.updatedAt === result.workOrder.createdAt))
  return result.workOrder
}

try {
  process.env['TZ'] = 'UTC'
  Date.now = () => systemNow

  const fallback = create('未接收时钟')
  assert.equal(
    fallback.orderNumber,
    'GZ-20260907-001',
    '尚未收到 PLC 时钟时应与页面相同地回退到系统时间'
  )

  sample('2042-12-31T23:59:59.000')
  const first = create('年末组件')
  assert.equal(first.orderNumber, 'GZ-20421231-001', '编号日期应使用 PLC 日期而非电脑日期')
  assert.equal(first.createdAt, '2042-12-31T15:59:59.000Z', '无时区 PLC 数据应按站点北京时间解释')

  systemNow += 2000
  sample('2042-12-31T23:59:59.000')
  const nextYear = create('跨年组件')
  assert.equal(
    nextYear.orderNumber,
    'GZ-20430101-001',
    '重复 PLC 时钟值之间仍应随右上角时钟跨日递增'
  )
  assert.equal(nextYear.createdAt, '2042-12-31T16:00:01.000Z')
  assert.equal(create('同日第二组件').orderNumber, 'GZ-20430101-002', '同日编号应连续且唯一')

  const duplicate = service.createDraft({ componentName: '年末组件' })
  assert.equal(duplicate.deduplicated, true)
  assert.equal(duplicate.workOrder.orderNumber, first.orderNumber, '跨日重复分析不得重编已有工单')
  assert.equal(duplicate.workOrder.createdAt, first.createdAt)

  sample('2042-12-31T20:10:00+08:00')
  assert.equal(
    create('调时组件').orderNumber,
    'GZ-20421231-002',
    'PLC 校时回到旧日期时应继续该日序号'
  )
  systemNow += 1000
  sample('invalid-clock')
  assert.equal(
    create('无效时钟组件').createdAt,
    '2042-12-31T12:10:01.000Z',
    '无效时钟不应丢失最后有效的 PLC 校准'
  )
  systemNow += 1000
  sample(null)
  assert.equal(create('未初始化时钟组件').createdAt, '2042-12-31T12:10:02.000Z')
  systemNow += 1000
  snapshot = {
    ...snapshot!,
    timestamp: new Date(systemNow).toISOString(),
    plcClock: undefined,
    plcConnected: false
  }
  screenClock.update(snapshot)
  service.processTelemetry(snapshot)
  assert.equal(
    create('离线组件').createdAt,
    '2042-12-31T12:10:03.000Z',
    '断连时应沿用与页面相同的时钟偏移'
  )

  sample('2043-01-02T04:00:00.000Z')
  const lifecycle = create('闭环时钟组件')
  assert.equal(lifecycle.orderNumber, 'GZ-20430102-001')
  systemNow += 1000
  const dispatched = service.dispatch(lifecycle.id, { reviewer: '时钟验收' })
  assert.equal(dispatched.dispatchedAt, '2043-01-02T04:00:01.000Z')
  const taskA = dispatched.tasks.find((task) => task.role === 'A')!
  const taskB = dispatched.tasks.find((task) => task.role === 'B')!
  const taskC = dispatched.tasks.find((task) => task.role === 'C')!
  service.startTask(taskA.id)
  service.startTask(taskB.id)
  service.completeSafetyCheckpoint(taskB.id, {
    isolationConfirmed: true,
    voltageTestPassed: true,
    safetyMeasuresConfirmed: true
  })
  service.startTask(taskC.id)
  systemNow += 1000
  service.submitTask(taskC.id, {
    hotspotConfirmed: true,
    treatmentAction: 'cleaned',
    retestPassed: true
  })
  service.submitTask(taskB.id, { restorationConfirmed: true, powerRestored: true })
  const verifying = service.submitTask(taskA.id, {
    monitoringCompleted: true,
    unresolvedHazards: false
  }).workOrder
  assert.equal(verifying.verifyingAt, '2043-01-02T04:00:02.000Z')
  for (let index = 0; index < 5; index += 1) {
    systemNow += 1000
    sample('2043-01-02T04:00:00.000Z')
  }
  const closed = service.getWorkOrder(lifecycle.id)
  assert.equal(closed.status, 'closed', '时钟改动不能破坏连续采样关单逻辑')
  assert.equal(closed.closedAt, '2043-01-02T04:00:07.000Z')
  assert.equal(closed.updatedAt, closed.closedAt)
  assert.ok(closed.events.every((event) => event.createdAt.startsWith('2043-01-02T04:00:')))
  assert.ok(closed.tasks.every((task) => task.submittedAt === '2043-01-02T04:00:02.000Z'))
  assert.equal(
    closed.plcVerification.lastCheckedAt,
    snapshot!.timestamp,
    '连续采样判断应保留采集时钟，避免被 PLC 校时干扰'
  )

  process.stdout.write(
    '工单 PLC 时钟验证通过：编号、跨年、唯一性、去重、校时、无效值、断连及完整闭环。\n'
  )
} finally {
  Date.now = originalNow
  if (originalTimeZone === undefined) delete process.env['TZ']
  else process.env['TZ'] = originalTimeZone
  database.close()
  rmSync(dataDirectory, { recursive: true, force: true })
}
