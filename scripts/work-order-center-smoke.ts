import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppDatabase, type AppDatabase } from '../src/main/server/database'
import { WorkOrderService } from '../src/main/server/work-orders'
import { createBuiltInWorkOrders } from '../src/main/server/work-order-samples'
import type { WorkOrder } from '../src/shared/contracts'
import { compareWorkOrders } from '../src/shared/work-order-sort'

const expected = [
  ['绝缘阻抗低', '2号光伏组串', 'normal', 'pending_review'],
  ['逆变器输出功率异常', '3号光伏组串', 'normal', 'pending_review'],
  ['组串电流归零', '4号光伏组串', 'urgent', 'closed'],
  ['通信中断', '3号光伏组串', 'urgent', 'closed']
]
const directory = mkdtempSync(join(tmpdir(), 'work-order-center-'))
let database = createAppDatabase(directory)
const createService = (db: AppDatabase): WorkOrderService =>
  new WorkOrderService({ database: db, broadcast: () => {}, getLatestSnapshot: () => undefined })

function verifySamples(db: AppDatabase): WorkOrder[] {
  const samples = createService(db)
    .listWorkOrders()
    .items.filter((order) => order.id.startsWith('builtin-'))
  assert.deepEqual(
    samples.map((order) => [order.faultType, order.stringName, order.priority, order.status]),
    expected,
    '四条展示工单的组合及顺序必须与需求一致'
  )
  assert.equal(samples[2].alarm.current, 0)
  for (const order of samples) {
    assert.equal(order.deviceId, `pv-${order.stringName[0]}`)
    assert.equal(order.tasks.length, 3)
    assert.equal(new Set(order.tasks.map((task) => task.role)).size, 3)
    assert.ok(order.tasks.find((task) => task.role === 'B')?.description.includes(order.stringName))
    const events = db.getWorkOrderDetail(order.id)!.events
    if (order.status === 'closed') {
      assert.ok(
        order.tasks.every(
          (task) => task.status === 'submitted' && task.result && task.startedAt && task.submittedAt
        )
      )
      assert.equal(order.plcVerification.consecutiveNormalSamples, 5)
      assert.equal(order.plcVerification.lastSampleNormal, true)
      assert.ok(order.reviewedAt && order.dispatchedAt && order.verifyingAt && order.closedAt)
      assert.deepEqual(
        events.map((event) => event.type),
        ['draft_created', 'closed']
      )
      assert.ok(Date.parse(order.createdAt) < Date.parse(order.closedAt))
    } else {
      assert.ok(
        order.tasks.every(
          (task) =>
            task.status === 'pending' &&
            !task.result &&
            !task.startedAt &&
            !task.checkpointAt &&
            !task.submittedAt
        )
      )
      assert.equal(order.plcVerification.consecutiveNormalSamples, 0)
      assert.equal(order.plcVerification.lastCheckedAt, null)
      assert.equal(order.plcVerification.lastSampleNormal, null)
      assert.equal(order.reviewedAt, null)
      assert.equal(order.dispatchedAt, null)
      assert.equal(order.verifyingAt, null)
      assert.equal(order.closedAt, null)
      assert.deepEqual(
        events.map((event) => event.type),
        ['draft_created'],
        '改为待审核后不得残留已处理展示记录'
      )
    }
  }
  return samples
}

try {
  const service = createService(database)
  const actual = service.createDraft({
    componentName: '1号组件',
    faultType: '组件热斑',
    priority: 'urgent'
  }).workOrder
  const actualBefore = database.getWorkOrderDetail(actual.id)
  database.seedBuiltInWorkOrders()
  const samples = verifySamples(database)
  assert.deepEqual(database.getWorkOrderDetail(actual.id), actualBefore)
  assert.equal(
    service.listWorkOrders(undefined, 1).items[0].id,
    actual.id,
    '实际紧急工单仍应排在普通工单之前，分页前完成排序'
  )
  const seeded = database.listWorkOrders()
  database.seedBuiltInWorkOrders()
  assert.deepEqual(database.listWorkOrders(), seeded, '重复启动不得重置样例')
  const changed = service.dispatch('builtin-work-order-3', {})
  database.deleteWorkOrder('builtin-work-order-4')
  database.close()
  database = createAppDatabase(directory)
  database.seedBuiltInWorkOrders()
  assert.equal(database.listWorkOrders().length, 4, '重启不得恢复已删除样例')
  assert.equal(database.getWorkOrder(changed.id)?.status, 'dispatched', '重启应保留后续操作')

  const create = (
    id: string,
    priority: WorkOrder['priority'],
    status: WorkOrder['status'],
    createdAt: string,
    closedAt: string | null = null
  ): WorkOrder => ({ ...samples[0], id, priority, status, createdAt, closedAt })
  const mixed = [
    create('closed-urgent', 'urgent', 'closed', '2026-09-06T00:00:00Z', '2026-09-06T01:00:00Z'),
    create('normal-new', 'normal', 'pending_review', '2026-09-05T00:00:00Z'),
    create('urgent-old', 'urgent', 'in_progress', '2026-09-01T00:00:00Z'),
    create('normal-old', 'normal', 'dispatched', '2026-09-03T00:00:00Z'),
    create('closed-normal', 'normal', 'closed', '2026-09-01T00:00:00Z', '2026-09-07T01:00:00Z'),
    create('urgent-new', 'urgent', 'plc_verifying', '2026-09-02T00:00:00Z')
  ]
  assert.deepEqual(
    mixed.sort(compareWorkOrders).map((order) => order.id),
    ['urgent-new', 'urgent-old', 'normal-new', 'normal-old', 'closed-normal', 'closed-urgent'],
    '保留一般工单的等级、时间排序规则'
  )

  for (const version of [1, 2, 3]) {
    const legacy = createAppDatabase(join(directory, `legacy-v${version}`))
    try {
      const oldOrders = createBuiltInWorkOrders((datePart) => `GZ-${datePart}-001`)
      for (const order of oldOrders) {
        const previouslyClosed =
          order.id === 'builtin-work-order-2' || order.id === 'builtin-work-order-3'
        order.status = previouslyClosed ? 'closed' : 'pending_review'
        order.priority = order.id === 'builtin-work-order-2' ? 'urgent' : 'normal'
        order.stringName = '1号光伏组串'
        order.deviceId = 'pv-1'
        order.reviewedAt = previouslyClosed ? order.createdAt : null
        order.dispatchedAt = order.reviewedAt
        order.verifyingAt = order.reviewedAt
        order.closedAt = order.reviewedAt
        order.plcVerification = {
          requiredConsecutiveSamples: 5,
          consecutiveNormalSamples: previouslyClosed ? 5 : 0,
          lastCheckedAt: order.closedAt,
          lastVoltage: previouslyClosed ? 210 : null,
          lastCurrent: previouslyClosed ? 19 : null,
          lastSampleNormal: previouslyClosed ? true : null
        }
        order.tasks = order.tasks.map((task) => ({
          ...task,
          status: previouslyClosed ? 'submitted' : 'pending',
          startedAt: order.reviewedAt,
          checkpointAt: task.role === 'B' ? order.reviewedAt : null,
          submittedAt: order.reviewedAt,
          result: previouslyClosed
            ? {
                role: 'C',
                faultConfirmed: true,
                treatmentSummary: '旧展示记录',
                retestPassed: true
              }
            : null
        }))
        legacy.insertWorkOrder(order, order.id)
        legacy.recordWorkOrderEvent({
          workOrderId: order.id,
          type: previouslyClosed ? 'closed' : 'draft_created',
          actor: 'builtin-sample'
        })
      }
      if (version === 1) {
        const obsolete = {
          ...structuredClone(oldOrders[1]),
          id: 'builtin-work-order-1',
          orderNumber: 'GZ-20260827-001',
          status: 'closed' as const
        }
        obsolete.tasks = obsolete.tasks.map((task) => ({
          ...task,
          id: `${obsolete.id}-${task.role}`,
          workOrderId: obsolete.id
        }))
        legacy.insertWorkOrder(obsolete, obsolete.id)
      }
      legacy.recordEvent('work-order.builtins-initialized.v1', {})
      if (version >= 2) legacy.recordEvent('work-order.builtins-updated.v2', {})
      if (version >= 3) legacy.recordEvent('work-order.builtins-locations.v3', {})
      const legacyActual = createService(legacy).createDraft({
        faultType: '组件热斑',
        priority: 'urgent'
      }).workOrder
      const preserved = legacy.getWorkOrderDetail(legacyActual.id)
      legacy.seedBuiltInWorkOrders()
      const updated = verifySamples(legacy)
      for (const order of updated)
        assert.equal(order.orderNumber, oldOrders.find((old) => old.id === order.id)!.orderNumber)
      assert.deepEqual(
        legacy.getWorkOrderDetail(legacyActual.id),
        preserved,
        '升级不得修改实际工单及记录'
      )
      assert.equal(legacy.getWorkOrder('builtin-work-order-1'), undefined)
      const after = legacy.listWorkOrders()
      legacy.seedBuiltInWorkOrders()
      assert.deepEqual(legacy.listWorkOrders(), after)
    } finally {
      legacy.close()
    }
  }
  process.stdout.write(
    '工单中心验证通过：指定组合与顺序、任务及验证状态、历史记录同步、真实工单保留、旧版本升级、重启幂等及分页排序。\n'
  )
} finally {
  database.close()
  rmSync(directory, { recursive: true, force: true })
}
