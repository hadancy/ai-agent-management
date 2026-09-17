import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import PadApp from '../src/renderer/src/PadApp'
import PadTaskCard from '../src/renderer/src/features/pad/PadTaskCard'
import WorkOrderCenter from '../src/renderer/src/features/monitor/workorder/WorkOrderCenter'
import {
  fetchPadTasks,
  postTaskAction,
  type PadRole,
  type PadTask
} from '../src/renderer/src/features/pad/taskClient'
import { PAD_PLATFORM_NAME, SEASONAL_ROLES } from '../src/shared/task-evidence'
import { seasonalWorkOrderFields } from '../src/shared/agrivoltaic-analysis'
import type { WorkOrder } from '../src/shared/contracts'
import '../src/renderer/src/assets/base.css'
import '../src/renderer/src/assets/global.css'
import '../src/renderer/src/features/monitor/styles/console-layout.css'

const origin = new URLSearchParams(window.location.search).get('service')!
const pause = (ms = 50): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
async function until(ready: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 100; index++) {
    if (ready()) return
    await pause()
  }
  throw new Error(message)
}
function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label
  )
  check(result, `找不到按钮：${label}`)
  return result
}
function fill(label: string, value: string): void {
  const element = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  check(element, `找不到输入框：${label}`)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}
async function api(path: string, body?: object): Promise<{ workOrder: WorkOrder }> {
  const response = await fetch(
    `${origin}${path}`,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      : undefined
  )
  check(response.ok, `API失败：${path} ${response.status} ${await response.clone().text()}`)
  return response.json()
}
async function screenshot(name: string): Promise<void> {
  await pause(120)
  await (
    window as unknown as { savePadScreenshot: (name: string) => Promise<void> }
  ).savePadScreenshot(name)
}
function uploadPhoto(name: string, testCompression = false): void {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const context = canvas.getContext('2d')!
  context.fillStyle = '#d4e9ec'
  context.fillRect(0, 0, 640, 360)
  context.fillStyle = '#1d5369'
  context.fillRect(50, 60, 540, 180)
  context.fillStyle = '#ffffff'
  context.font = '28px sans-serif'
  context.fillText(name, 100, 150)
  context.fillStyle = '#509971'
  context.fillRect(0, 280, 640, 80)
  const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (char) =>
    char.charCodeAt(0)
  )
  const transfer = new DataTransfer()
  transfer.items.add(
    new File(testCompression ? [bytes, new Uint8Array(3 * 1024 * 1024)] : [bytes], name, {
      type: 'image/png'
    })
  )
  const input = document.querySelector<HTMLInputElement>('input[aria-label="上传现场照片"]')!
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
async function runPadFieldSmoke(): Promise<void> {
  localStorage.clear()
  // Keep the isolated UI test away from the real platform's fixed service port.
  const nativeFetch = window.fetch
  window.fetch = (url, init) =>
    nativeFetch(String(url).replace('http://127.0.0.1:17880', origin), init)
  Object.defineProperty(window, 'WebSocket', {
    value: class extends EventTarget {
      close(): void {
        // No real WebSocket is opened by this test double.
      }
    }
  })
  const root = createRoot(document.getElementById('root')!)
  flushSync(() => root.render(<PadApp />))
  await until(() => document.title === PAD_PLATFORM_NAME, 'C平台网页标题更新')
  check(document.body.textContent?.includes(PAD_PLATFORM_NAME), '绑定页面平台名称更新')
  const plan = {
    month: 9,
    fileName: '项目.docx',
    fileSize: 100,
    requestId: 'pad-ui-test',
    analysisVersion: 2,
    fieldWorkflowVersion: 1,
    analysisDate: '2026-09-23'
  }
  const created = await api('/api/work-orders/drafts', { tiltAdjustment: plan })
  const order = (await api(`/api/work-orders/${created.workOrder.id}/dispatch`, {})).workOrder
  let task: PadTask
  let actionError = ''
  const renderTask = (): void =>
    flushSync(() =>
      root.render(
        <StrictMode>
          <div className={`pad-shell pad-shell--role-${task.role.toLowerCase()}`}>
            <header className="pad-header">
              <div className="pad-header-brand">
                <span className="pad-header-logo">C</span>
                <div>
                  <h1>{PAD_PLATFORM_NAME}</h1>
                  <p>
                    {task.role}同学 · {SEASONAL_ROLES[task.role].title}
                  </p>
                </div>
              </div>
            </header>
            <main className="pad-main">
              <PadTaskCard
                key={task.id}
                task={task}
                serviceOrigin={origin}
                busyAction={null}
                actionError={actionError}
                onReplay={() => {}}
                onAction={async (current, action, body) => {
                  try {
                    await postTaskAction(origin, current.id, action, body)
                    task = (await fetchPadTasks(origin, current.role))[0]
                    renderTask()
                  } catch (error) {
                    actionError = String(error)
                    renderTask()
                  }
                }}
              />
            </main>
          </div>
        </StrictMode>
      )
    )
  for (const role of ['B', 'C', 'A'] as const) {
    task = (await fetchPadTasks(origin, role))[0]
    check(task.voiceText === '您有新的工单，请将光伏组件倾角调整至 22°。', `${role}收到统一语音`)
    renderTask()
    check(task.canStart, `${role}已解锁`)
    const info = document.querySelector('.task-project-info')!.textContent!
    for (const [label, value] of seasonalWorkOrderFields(task.tiltAdjustment!))
      check(info.includes(label) && info.includes(value), `${role}完整基本信息：${label}`)
    document.querySelector<HTMLInputElement>('.task-check--acknowledge input')!.click()
    await pause()
    button(SEASONAL_ROLES[role].start).click()
    await until(
      () => !!document.querySelector('.seasonal-task-form') && !button('上传照片').disabled,
      `${role}开始后显示表单`
    )
    button('提交并回传 B 平台').click()
    await pause()
    check(document.body.textContent?.includes('请逐项检查'), '未确认表单不可提交')
    for (const checkbox of document.querySelectorAll<HTMLInputElement>(
      '.seasonal-checklist input[type="checkbox"]'
    ))
      checkbox.click()
    fill('签字姓名', `${role}同学`)
    if (role === 'B') fill('调整前实际倾角', '19')
    else if (role === 'C') fill('调整后实测倾角', '22')
    else {
      fill('抽检点位数量', '3')
      fill('档案编号', 'NG-ARCH-001')
    }
    await pause()
    button('提交并回传 B 平台').click()
    await pause()
    check(document.body.textContent?.includes('至少上传一张'), '无照片不可提交')
    uploadPhoto(`${role}同学-现场照片.png`, role === 'C')
    await until(
      () =>
        document.querySelectorAll('.task-photo-preview').length === 1 &&
        !button('提交并回传 B 平台').disabled,
      `${role}照片上传成功`
    )
    document.querySelector<HTMLElement>('.seasonal-task-form')!.scrollIntoView({ block: 'start' })
    await screenshot(`pad-${role.toLowerCase()}-form`)
    if (role === 'B') {
      flushSync(() => root.render(<div />))
      renderTask()
      await until(
        () =>
          document.querySelectorAll('.task-photo-preview').length === 1 &&
          !button('提交并回传 B 平台').disabled,
        '刷新表单恢复已上传照片'
      )
      for (const checkbox of document.querySelectorAll<HTMLInputElement>(
        '.seasonal-checklist input[type="checkbox"]'
      ))
        checkbox.click()
      fill('签字姓名', 'B同学')
      fill('调整前实际倾角', '19')
      await pause()
    }
    const preview = document.querySelector<HTMLButtonElement>('.task-photo-preview')!
    preview.click()
    await until(
      () => !!document.querySelector<HTMLImageElement>('dialog[open] img')?.naturalWidth,
      '原始照片能加载放大'
    )
    document.querySelector<HTMLButtonElement>('dialog[open] button')!.click()
    await pause()
    button('提交并回传 B 平台').click()
    await until(
      () => !!document.querySelector('.seasonal-submitted-result'),
      `${role}提交成功：${actionError}`
    )
    check(
      document.querySelector('.seasonal-submitted-meta')!.textContent!.includes(`${role}同学`),
      `${role}签字已回传`
    )
    const stored = (await api(`/api/work-orders/${order.id}`)).workOrder
    const result = stored.tasks.find((item: { role: PadRole }) => item.role === role)?.result
    check(
      result &&
        'signature' in result &&
        result.photos?.length === 1 &&
        result.signature === `${role}同学`,
      'B平台接口收到照片和签字'
    )
    if (role === 'C')
      check(
        result.photos[0].mimeType === 'image/jpeg' && result.photos[0].size < 3 * 1024 * 1024,
        '大图片在正式CSP下完成压缩并回传'
      )
  }
  window.scrollTo(0, 0)
  flushSync(() =>
    root.render(
      <div style={{ height: '100vh' }}>
        <WorkOrderCenter
          serviceOrigin={origin}
          refreshToken={0}
          onBack={() => {}}
          onOpenAssistant={() => {}}
        />
      </div>
    )
  )
  await until(() => !!document.querySelector('.work-order-card'), 'B平台显示工单')
  document.querySelector<HTMLButtonElement>('.work-order-card')!.click()
  await until(() => !!document.querySelector('#work-order-tab-tasks'), '工单详情加载')
  document.querySelector<HTMLButtonElement>('#work-order-tab-tasks')!.click()
  await until(
    () => document.querySelectorAll('.seasonal-submitted-result').length === 3,
    'B平台显示全部三张表单'
  )
  check(document.querySelectorAll('.task-photo-preview').length === 3, 'B平台三角色照片全部可见')
  document
    .querySelector<HTMLElement>('.seasonal-submitted-result')!
    .scrollIntoView({ block: 'start' })
  await screenshot('platform-b-results')
  document.querySelector<HTMLElement>('.task-photo-preview')!.scrollIntoView({ block: 'end' })
  await screenshot('platform-b-returned-photo')
  document.querySelector<HTMLButtonElement>('.task-photo-preview')!.click()
  await until(
    () => !!document.querySelector<HTMLImageElement>('dialog[open] img')?.naturalWidth,
    'B平台照片可放大'
  )
  await screenshot('platform-b-photo')
  root.unmount()
  console.log(
    'PASS: C平台名称、三角色完整模板、逐项勾选/签字/照片校验、上传后刷新恢复、B平台表单照片回传与放大预览'
  )
}
Object.assign(window, { runPadFieldSmoke })
