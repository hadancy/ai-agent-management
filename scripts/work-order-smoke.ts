import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  CreateWorkOrderDraftResponse,
  DeleteWorkOrderResponse,
  WorkOrder,
  WorkOrderListResponse,
  WorkOrderResponse,
  WorkOrderTask,
  WorkOrderTaskListResponse
} from '../src/shared/contracts'
import { startEmbeddedServer } from '../src/main/server'

const PORT = 17881
const ORIGIN = `http://127.0.0.1:${PORT}`

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ORIGIN}${pathname}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers
    }
  })
  const payload = (await response.json().catch(() => null)) as T | { message?: string } | null
  if (!response.ok) {
    const message = payload && 'message' in payload ? payload.message : undefined
    throw new Error(`${init?.method ?? 'GET'} ${pathname} -> ${response.status}: ${message ?? ''}`)
  }
  return payload as T
}

async function expectStatus(
  pathname: string,
  expectedStatus: number,
  init: RequestInit
): Promise<void> {
  const response = await fetch(`${ORIGIN}${pathname}`, {
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers }
  })
  check(
    response.status === expectedStatus,
    `${init.method ?? 'GET'} ${pathname} 应返回 ${expectedStatus}，实际为 ${response.status}`
  )
}

async function action(task: WorkOrderTask, name: string, body: object = {}): Promise<WorkOrder> {
  const response = await request<WorkOrderResponse>(`/api/tasks/${task.id}/${name}`, {
    method: 'POST',
    body: JSON.stringify(body)
  })
  return response.workOrder
}

async function taskFor(role: 'A' | 'B' | 'C', workOrderId: string): Promise<WorkOrderTask> {
  const response = await request<WorkOrderTaskListResponse>(`/api/tasks?role=${role}`)
  const tasks = response.items.filter((task) => task.workOrderId === workOrderId)
  check(tasks.length === 1, `${role} Pad 应且仅应收到该工单的 1 条任务`)
  return tasks[0]
}

async function run(): Promise<void> {
  process.env['PLC_MODE'] = 'simulation'
  const dataDirectory = await mkdtemp(join(tmpdir(), 'work-order-smoke-'))
  const server = await startEmbeddedServer({
    dataDirectory,
    rendererDirectory: join(process.cwd(), 'out', 'renderer'),
    port: PORT
  })

  try {
    const initial = await request<WorkOrderListResponse>('/api/work-orders')
    check(initial.total === 4, '首次启动应内置 4 条工单')
    check(
      initial.items.filter((order) => order.status === 'closed').length === 2,
      '应有 2 条已处理工单'
    )
    check(
      initial.items
        .slice(0, 2)
        .every((order) => order.status === 'pending_review' && order.priority === 'normal'),
      '2 条普通待审核工单应排在已处理工单之前'
    )
    const deletePreflight = await fetch(`${ORIGIN}/api/work-orders/cors-check`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'DELETE'
      }
    })
    check(deletePreflight.status === 204, 'DELETE 跨域预检应成功')
    check(
      deletePreflight.headers.get('access-control-allow-methods')?.includes('DELETE'),
      'CORS 应允许 DELETE 方法'
    )

    const draftInput = {
      stationName: '光明村光伏电站',
      deviceId: 'pv-1',
      stringName: '1号光伏组串',
      componentName: '1号组件',
      faultType: '组件热斑',
      voltage: 180,
      current: 15,
      normalVoltage: 210,
      normalCurrent: 19,
      tolerancePercent: 10,
      priority: 'urgent' as const
    }
    const firstDraft = await request<CreateWorkOrderDraftResponse>('/api/work-orders/drafts', {
      method: 'POST',
      body: JSON.stringify(draftInput)
    })
    check(firstDraft.created, '首次分析应创建工单草稿')
    check(/^GZ-\d{8}-\d{3}$/.test(firstDraft.workOrder.orderNumber), '工单编号格式不正确')
    check(firstDraft.workOrder.status === 'pending_review', '草稿应处于待审核状态')

    const duplicateDraft = await request<CreateWorkOrderDraftResponse>('/api/work-orders/drafts', {
      method: 'POST',
      body: JSON.stringify(draftInput)
    })
    check(duplicateDraft.deduplicated, '同一活动故障应去重')
    check(duplicateDraft.workOrder.id === firstDraft.workOrder.id, '去重后应返回原工单')

    const hiddenBeforeDispatch = await request<WorkOrderTaskListResponse>('/api/tasks?role=C')
    check(
      hiddenBeforeDispatch.items.every((task) => task.workOrderId !== firstDraft.workOrder.id),
      '未下达工单不能出现在 Pad'
    )

    const firstPage = await request<WorkOrderListResponse>('/api/work-orders?limit=1')
    check(
      firstPage.items[0].id === firstDraft.workOrder.id,
      '紧急未处理工单应在分页前排到普通工单前面'
    )

    const dispatched = await request<WorkOrderResponse>(
      `/api/work-orders/${firstDraft.workOrder.id}/dispatch`,
      { method: 'POST', body: JSON.stringify({ reviewer: '自动化验收' }) }
    )
    check(dispatched.workOrder.status === 'dispatched', '审核后应进入已下达状态')

    const taskA = await taskFor('A', firstDraft.workOrder.id)
    const taskB = await taskFor('B', firstDraft.workOrder.id)
    const taskC = await taskFor('C', firstDraft.workOrder.id)
    await expectStatus(`/api/tasks/${taskC.id}/start`, 409, {
      method: 'POST',
      body: '{}'
    })

    await action(taskA, 'start')
    await action(taskB, 'start')
    await action(taskB, 'checkpoint', {
      isolationConfirmed: true,
      voltageTestPassed: true,
      safetyMeasuresConfirmed: true,
      notes: '组串已隔离，验电合格'
    })
    await action(taskC, 'start')
    await expectStatus(`/api/tasks/${taskC.id}/submit`, 400, {
      method: 'POST',
      body: JSON.stringify({
        hotspotConfirmed: false,
        treatmentAction: 'cleaned',
        retestPassed: true
      })
    })
    await action(taskC, 'submit', {
      hotspotConfirmed: true,
      treatmentAction: 'cleaned',
      retestPassed: true,
      measuredTemperature: 38.5,
      notes: '已清理遮挡并完成红外复测'
    })
    await action(taskB, 'submit', {
      restorationConfirmed: true,
      powerRestored: true,
      notes: '已恢复组串连接与送电'
    })
    const afterAllSubmissions = await action(taskA, 'submit', {
      monitoringCompleted: true,
      unresolvedHazards: false,
      notes: '全程监护，无未解决安全异常'
    })
    check(afterAllSubmissions.status === 'plc_verifying', '三人提交后应进入 PLC 验证')

    let closed: WorkOrder | undefined
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await delay(1000)
      const list = await request<WorkOrderListResponse>('/api/work-orders')
      closed = list.items.find((item) => item.id === firstDraft.workOrder.id)
      if (closed?.status === 'closed') break
    }
    check(closed?.status === 'closed', 'PLC 连续正常后工单应自动关闭')
    check(
      closed.plcVerification.consecutiveNormalSamples >= 5,
      '关闭前必须累计至少 5 次正常 PLC 样本'
    )
    const deleted = await request<DeleteWorkOrderResponse>(
      `/api/work-orders/${firstDraft.workOrder.id}`,
      { method: 'DELETE' }
    )
    check(deleted.deleted, '删除接口应返回成功状态')
    check(deleted.orderNumber === closed.orderNumber, '删除接口返回的工单编号不正确')
    const afterDelete = await request<WorkOrderListResponse>('/api/work-orders')
    check(
      afterDelete.total === initial.total &&
        afterDelete.items.every((order) => order.id !== firstDraft.workOrder.id),
      '删除后应仅保留内置工单'
    )
    const tasksAfterDelete = await request<WorkOrderTaskListResponse>('/api/tasks?role=A')
    check(
      tasksAfterDelete.items.every((task) => task.workOrderId !== firstDraft.workOrder.id),
      '删除工单后关联任务应级联删除'
    )
    await expectStatus(`/api/work-orders/${firstDraft.workOrder.id}`, 404, { method: 'GET' })
    await expectStatus(`/api/work-orders/${firstDraft.workOrder.id}`, 404, { method: 'DELETE' })
    process.stdout.write(`工单闭环及删除验证通过：${closed.orderNumber}\n`)
  } finally {
    await server.stop()
    await rm(dataDirectory, { recursive: true, force: true })
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
