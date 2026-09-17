import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { createAppDatabase } from '../src/main/server/database'
import { registerWorkOrderRoutes, WorkOrderService } from '../src/main/server/work-orders'
import { seasonalTaskVoice } from '../src/shared/task-evidence'

export async function runPadFieldWorkOrderSmoke(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'pad-field-db-'))
  let database = createAppDatabase(directory)
  const service = new WorkOrderService({
    database,
    broadcast: () => {},
    getLatestSnapshot: () => undefined
  })
  const api = Fastify()
  registerWorkOrderRoutes(api, service)
  const plan = {
    month: 9,
    fileName: '项目.docx',
    fileSize: 100,
    analysisVersion: 2 as const,
    fieldWorkflowVersion: 1 as const,
    analysisDate: '2026-09-23',
    requestId: 'field-test'
  }
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6j8AAAAASUVORK5CYII=',
    'base64'
  )
  const photoBody = { fileName: '现场.png', data: png.toString('base64') }
  try {
    const draft = service.createDraft({ tiltAdjustment: plan }).workOrder
    assert.equal(service.listAssignedTasks('A').items.length, 0)
    const order = service.dispatch(draft.id, {})
    const task = (role: string): (typeof order.tasks)[number] =>
      order.tasks.find((item) => item.role === role)!
    for (const role of ['A', 'B', 'C'] as const) {
      const assigned = service.listAssignedTasks(role).items[0]
      assert.equal(assigned.voiceText, '您有新的工单，请将光伏组件倾角调整至 22°。')
      assert.deepEqual(assigned.tiltAdjustment, plan)
    }
    assert.equal(
      seasonalTaskVoice({ ...plan, month: 12, analysisDate: '2026-12-01' }),
      '您有新的工单，请将光伏组件倾角调整至 34°。'
    )
    assert.throws(() => service.startTask(task('A').id), /C同学/)
    assert.throws(() => service.startTask(task('C').id), /B同学/)
    assert.throws(() => service.uploadTaskPhoto(task('B').id, photoBody), /开始任务/)
    service.startTask(task('B').id)
    const uploaded = await api.inject({
      method: 'POST',
      url: `/api/tasks/${task('B').id}/photos`,
      payload: photoBody
    })
    assert.equal(uploaded.statusCode, 201)
    const photo = uploaded.json().photo
    const downloaded = await api.inject(`/api/task-photos/${photo.id}`)
    assert.equal(downloaded.headers['content-type'], 'image/png')
    assert.deepEqual(downloaded.rawPayload, png)
    assert.throws(
      () =>
        service.uploadTaskPhoto(task('B').id, {
          fileName: 'fake.png',
          data: Buffer.from('<svg/>').toString('base64')
        }),
      /只支持/
    )
    const spare = service.uploadTaskPhoto(task('B').id, photoBody)
    service.deleteTaskPhoto(task('B').id, spare.id)
    assert.equal(service.listTaskPhotos(task('B').id).length, 1)
    const extras = Array.from({ length: 5 }, () => service.uploadTaskPhoto(task('B').id, photoBody))
    assert.throws(() => service.uploadTaskPhoto(task('B').id, photoBody), /最多上传6张/)
    for (const extra of extras) service.deleteTaskPhoto(task('B').id, extra.id)
    const bResult = {
      checks: Array(4).fill(true),
      signature: 'B同学',
      beforeAngle: 19,
      photoIds: [photo.id]
    }
    assert.throws(
      () => service.submitTask(task('B').id, { ...bResult, checks: [true, false, true, true] }),
      /逐项/
    )
    assert.throws(() => service.submitTask(task('B').id, { ...bResult, signature: '' }), /签字/)
    assert.throws(() => service.submitTask(task('B').id, { ...bResult, photoIds: [] }), /照片/)
    assert.throws(() => service.submitTask(task('B').id, { ...bResult, beforeAngle: 91 }), /倾角/)
    service.submitTask(task('B').id, bResult)
    assert.throws(() => service.deleteTaskPhoto(task('B').id, photo.id), /不能删除/)
    assert.throws(() => service.uploadTaskPhoto(task('B').id, photoBody), /不可修改/)
    service.startTask(task('C').id)
    const cPhoto = service.uploadTaskPhoto(task('C').id, photoBody)
    const cResult = {
      checks: Array(5).fill(true),
      signature: 'C同学',
      adjustedAngle: 22,
      photoIds: [cPhoto.id]
    }
    assert.throws(
      () => service.submitTask(task('C').id, { ...cResult, photoIds: [photo.id] }),
      /不属于/
    )
    assert.throws(
      () => service.submitTask(task('C').id, { ...cResult, adjustedAngle: 24 }),
      /21至23/
    )
    service.submitTask(task('C').id, cResult)
    service.startTask(task('A').id)
    const aPhoto = service.uploadTaskPhoto(task('A').id, photoBody)
    const aResult = {
      checks: Array(5).fill(true),
      signature: 'A同学',
      sampleCount: 3,
      archiveNumber: 'ARCH-001',
      photoIds: [aPhoto.id]
    }
    assert.throws(() => service.submitTask(task('A').id, { ...aResult, sampleCount: 0 }), /抽检/)
    assert.throws(() => service.submitTask(task('A').id, { ...aResult, archiveNumber: '' }), /档案/)
    service.submitTask(task('A').id, aResult)
    const complete = service.getWorkOrder(order.id)
    assert.equal(complete.status, 'plc_verifying')
    assert.ok(
      complete.tasks.every(
        (item) => item.status === 'submitted' && item.result?.photos?.length === 1
      )
    )
    assert.ok(
      complete.tasks.every(
        (item) =>
          item.result &&
          'kind' in item.result &&
          item.result.kind === 'seasonal_inspection' &&
          Number.isFinite(Date.parse(item.result.signedAt))
      )
    )
    // Photos also accompany the existing hotspot workflow's checkpoint and final results.
    const legacy = service.dispatch(service.createDraft({}).workOrder.id, {})
    const legacyA = legacy.tasks.find((item) => item.role === 'A')!
    const legacyB = legacy.tasks.find((item) => item.role === 'B')!
    const legacyC = legacy.tasks.find((item) => item.role === 'C')!
    service.startTask(legacyA.id)
    service.startTask(legacyB.id)
    const before = service.uploadTaskPhoto(legacyB.id, photoBody)
    service.completeSafetyCheckpoint(legacyB.id, {
      isolationConfirmed: true,
      voltageTestPassed: true,
      safetyMeasuresConfirmed: true,
      photoIds: [before.id]
    })
    service.startTask(legacyC.id)
    const treatment = service.uploadTaskPhoto(legacyC.id, photoBody)
    service.submitTask(legacyC.id, {
      hotspotConfirmed: false,
      treatmentAction: 'no_fault',
      retestPassed: true,
      photoIds: [treatment.id]
    })
    const after = service.uploadTaskPhoto(legacyB.id, photoBody)
    service.submitTask(legacyB.id, {
      restorationConfirmed: true,
      powerRestored: true,
      photoIds: [after.id]
    })
    assert.deepEqual(
      database.getTask(legacyB.id)?.result?.photos?.map((item) => item.id),
      [before.id, after.id]
    )
    const monitoring = service.uploadTaskPhoto(legacyA.id, photoBody)
    service.submitTask(legacyA.id, {
      monitoringCompleted: true,
      unresolvedHazards: false,
      photoIds: [monitoring.id]
    })
    assert.ok(service.getWorkOrder(legacy.id).tasks.every((item) => item.result?.photos?.length))
    database.close()
    database = createAppDatabase(directory)
    assert.deepEqual(
      database.getWorkOrder(order.id)?.tasks.map((item) => item.result),
      complete.tasks.map((item) => item.result)
    )
    assert.deepEqual(database.getTaskPhoto(photo.id)?.data, png)
    console.log(
      'PASS: 三角色季节表单顺序、动态语音、照片上传/回读/删除/持久化、所有必填校验及跨任务照片校验'
    )
  } finally {
    await api.close()
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
