import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import Fastify from 'fastify'
import { createAppDatabase } from '../src/main/server/database'
import { registerWorkOrderRoutes, WorkOrderService } from '../src/main/server/work-orders'
import { getTiltAdvice, getStationMonth, getTiltReply } from '../src/shared/tilt-adjustment'
import type { ServerEvent, TelemetrySnapshot } from '../src/shared/contracts'

export async function runTiltWorkOrderSmoke(): Promise<void> {
  const seasons = [
    '冬季',
    '冬季',
    '春秋季',
    '春秋季',
    '春秋季',
    '夏季',
    '夏季',
    '夏季',
    '春秋季',
    '春秋季',
    '春秋季',
    '冬季'
  ]
  seasons.forEach((season, index) => assert.equal(getTiltAdvice(index + 1).season, season))
  assert.equal(getStationMonth(new Date('2026-05-31T16:00:00Z')), 6)
  assert.equal(getStationMonth(new Date('2026-08-31T15:59:59Z')), 8)
  assert.equal(getStationMonth(new Date('2026-08-31T16:00:00Z')), 9)
  const directory = mkdtempSync(join(tmpdir(), 'tilt-work-order-'))
  let database = createAppDatabase(directory)
  const events: ServerEvent[] = []
  const app = Fastify()
  try {
    const legacyOrder = new WorkOrderService({
      database,
      broadcast: () => {},
      getLatestSnapshot: () => undefined
    }).createDraft({})
    database.close()
    const legacyDb = new Database(join(directory, 'ai-agent-management.db'))
    legacyDb.exec('ALTER TABLE work_orders DROP COLUMN tilt_adjustment_json')
    legacyDb.close()
    database = createAppDatabase(directory)
    assert.equal(database.getWorkOrder(legacyOrder.workOrder.id)?.faultType, '组件热斑')
    const service = new WorkOrderService({
      database,
      broadcast: (event) => events.push(event),
      getLatestSnapshot: () => undefined
    })
    registerWorkOrderRoutes(app, service)
    const plan = {
      month: 7,
      fileName: '茶园项目.DOCX',
      fileSize: 2048,
      requestId: 'test-summer-upload'
    }
    for (const invalid of [
      { ...plan, month: 0 },
      { ...plan, month: 13 },
      { ...plan, month: '7' },
      { ...plan, fileName: '' },
      { ...plan, fileSize: -1 },
      { ...plan, fileSize: '2048' },
      { ...plan, requestId: '' }
    ]) {
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/api/work-orders/drafts',
            payload: { tiltAdjustment: invalid }
          })
        ).statusCode,
        400
      )
    }
    const draft = await app.inject({
      method: 'POST',
      url: '/api/work-orders/drafts',
      payload: { tiltAdjustment: plan }
    })
    assert.equal(draft.statusCode, 201)
    let order = draft.json().workOrder
    assert.equal(order.status, 'pending_review')
    assert.equal(order.faultType, '夏季倾角调整')
    assert.equal(order.handlingSuggestion, getTiltReply(7))
    assert.notEqual(order.id, legacyOrder.workOrder.id)
    assert.equal(service.createDraft({ tiltAdjustment: plan }).workOrder.id, order.id)
    for (const role of ['A', 'B', 'C']) {
      const pending = await app.inject({ url: `/api/tasks?role=${role}` })
      assert.equal(pending.json().items.length, 0, '未下发草稿不可出现在 C 平台')
    }
    database.close()
    database = createAppDatabase(directory)
    assert.deepEqual(
      database.getWorkOrder(order.id)?.tiltAdjustment,
      plan,
      '重启应保留月份与 Word 文档信息'
    )
    // The registered service references the old connection; reopen a service for the remaining lifecycle.
    const resumed = new WorkOrderService({
      database,
      broadcast: (event) => events.push(event),
      getLatestSnapshot: () => undefined
    })
    order = resumed.dispatch(order.id, {})
    resumed.dispatch(order.id, {})
    assert.equal(events.filter((event) => event.type === 'work-order.dispatched').length, 1)
    const taskC = resumed.listAssignedTasks('C').items[0]
    assert.equal(taskC.title, '执行夏季倾角')
    assert.ok(taskC.description.includes('20至25度'))
    assert.ok(!taskC.description.includes('热斑'))
    assert.deepEqual(taskC.tiltAdjustment, plan)
    const taskA = order.tasks.find((task) => task.role === 'A')!
    const taskB = order.tasks.find((task) => task.role === 'B')!
    assert.throws(() => resumed.startTask(taskC.id), /安全监护/)
    resumed.startTask(taskA.id)
    resumed.startTask(taskB.id)
    resumed.completeSafetyCheckpoint(taskB.id, {
      isolationConfirmed: true,
      voltageTestPassed: true,
      safetyMeasuresConfirmed: true
    })
    resumed.startTask(taskC.id)
    assert.throws(
      () =>
        resumed.submitTask(taskC.id, {
          adjustedAngle: 48,
          fasteningConfirmed: true,
          retestPassed: true
        }),
      /20至25度/
    )
    assert.throws(
      () =>
        resumed.submitTask(taskC.id, {
          adjustedAngle: 23,
          fasteningConfirmed: false,
          retestPassed: true
        }),
      /紧固/
    )
    resumed.submitTask(taskC.id, {
      adjustedAngle: 23,
      fasteningConfirmed: true,
      retestPassed: true
    })
    resumed.submitTask(taskB.id, { restorationConfirmed: true, powerRestored: true })
    resumed.submitTask(taskA.id, { monitoringCompleted: true, unresolvedHazards: false })
    assert.equal(resumed.getWorkOrder(order.id).status, 'plc_verifying')
    for (let index = 0; index < 5; index++) {
      const sample: TelemetrySnapshot = {
        sequence: index,
        timestamp: new Date(Date.now() + index * 1000).toISOString(),
        collectorMode: 'plc-tcp',
        plcConnected: true,
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
      resumed.processTelemetry(sample)
    }
    assert.equal(resumed.getWorkOrder(order.id).status, 'closed')
    assert.equal(resumed.getWorkOrder(legacyOrder.workOrder.id).status, 'pending_review')
    for (const [index, file] of [
      { name: '项目.xls', size: 2048 },
      { name: '项目.xlsx', size: 2048 },
      { name: '项目.csv', size: 2048 },
      { name: '项目.doc', size: 2048 },
      { name: '项目.pdf', size: 2048 },
      { name: '项目.png', size: 2048 },
      { name: '项目.zip', size: 2048 },
      { name: '项目.doc.exe', size: 2048 },
      { name: '无扩展名', size: 0 },
      { name: '大文件.mp4', size: 1024 * 1024 * 1024 }
    ].entries()) {
      const accepted = resumed.createDraft({
        tiltAdjustment: {
          ...plan,
          fileName: file.name,
          fileSize: file.size,
          requestId: `accepted-${index}`
        }
      })
      assert.equal(accepted.workOrder.status, 'pending_review')
      assert.equal(accepted.workOrder.tiltAdjustment?.fileName, file.name)
      assert.equal(accepted.workOrder.handlingSuggestion, getTiltReply(7))
    }
    console.log(
      'PASS: 任意文件（含空文件、大文件）生成固定模板工单、月份边界、旧库升级、草稿隔离、重复下发、C 平台任务与关单'
    )
  } finally {
    await app.close()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
