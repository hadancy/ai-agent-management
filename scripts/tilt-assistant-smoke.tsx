import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import AiAssistantPage from '../src/renderer/src/features/monitor/ai/AiAssistantPage'
import MonitorHeader from '../src/renderer/src/features/monitor/components/MonitorHeader'
import PadTaskCard from '../src/renderer/src/features/pad/PadTaskCard'
import { fetchPadTasks } from '../src/renderer/src/features/pad/taskClient'
import '../src/renderer/src/assets/base.css'
import '../src/renderer/src/assets/global.css'
import '../src/renderer/src/features/monitor/styles/console-layout.css'
import '../src/renderer/src/features/pad/pad.css'

const ORIGIN = 'http://tilt-test.local'
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
const pause = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
async function until(checkReady: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (checkReady()) return
    await pause()
  }
  throw new Error(message)
}
const text = (): string => document.body.textContent ?? ''
function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label && item.getClientRects().length > 0
  )
  check(result, `找不到按钮：${label}`)
  return result
}
function upload(name: string, content = '项目,作物\n光明村光伏电站,茶树'): void {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="选择项目资料"]')!
  const transfer = new DataTransfer()
  transfer.items.add(new File([content], name))
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
async function orders(): Promise<
  Array<{
    id: string
    status: string
    tiltAdjustment?: { month: number }
    normalRange: { normalVoltage: number; normalCurrent: number }
  }>
> {
  return (await (await fetch(`${ORIGIN}/api/work-orders`)).json()).items
}

async function runTiltAssistantSmoke(): Promise<string[]> {
  localStorage.clear()
  let root = createRoot(document.getElementById('root')!)
  const render = (month: number): void =>
    flushSync(() =>
      root.render(
        <StrictMode>
          <MonitorHeader
            activeNav="智诊精巡"
            hasAlarm={false}
            clock={new Date(`2042-${String(month).padStart(2, '0')}-15T04:00:00Z`)}
            plcOnline
            onNavChange={() => {}}
          />
          <main className="console-main console-main--assistant">
            <AiAssistantPage
              normalRange={{ normalVoltage: 50, normalCurrent: 12, tolerancePercent: 8 }}
              clock={new Date(`2042-${String(month).padStart(2, '0')}-15T04:00:00Z`)}
              serviceOrigin={ORIGIN}
              refreshToken={0}
              onWorkOrderChanged={() => {}}
              onWorkOrderCreated={async () => ({
                orderNumber: 'existing-diagnosis',
                deduplicated: false
              })}
              onViewWorkOrder={() => {}}
              onOpenMonitor={() => {}}
              workOrderCount={0}
              plcOnline
            />
          </main>
        </StrictMode>
      )
    )
  render(7)
  button('智能数据分析系统资料上传 · 季节倾角').click()
  await pause()
  check(
    !document.querySelector<HTMLInputElement>('input[aria-label="选择项目资料"]')!.accept,
    '文件选择器不能限制文件格式'
  )
  const originalRead = File.prototype.arrayBuffer
  File.prototype.arrayBuffer = async () => {
    throw new Error('固定模板流程不应读取文件内容')
  }

  // Let the server commit, then simulate a lost response. A retry must reuse the same draft.
  const apiFetch = window.fetch
  let loseResponse = true
  window.fetch = async (input, init) => {
    const response = await apiFetch(input, init)
    if (loseResponse && String(input).endsWith('/drafts')) {
      loseResponse = false
      throw new TypeError('模拟响应丢失')
    }
    return response
  }
  upload('茶园项目.csv')
  await until(() => text().includes('工单生成失败'), '应显示生成失败与重试按钮')
  check((await orders()).length === 1, '服务已创建一张草稿')
  button('重试生成').click()
  await until(() => text().includes('工单已生成，待人工下发'), '重试应找回已创建的工单')
  window.fetch = apiFetch
  check((await orders()).length === 1, '重试不应重复创建工单')
  check(
    (await orders())[0].normalRange.normalVoltage === 50 &&
      (await orders())[0].normalRange.normalCurrent === 12,
    '倾角工单应沿用当前设备正常值配置'
  )
  check(text().includes('夏季：20至25度：缩小组件阴影投影'), '应使用七月夏季固定文案')
  check((await fetchPadTasks(ORIGIN, 'C')).length === 0, '人工下发之前 C 平台不得收到工单')
  button('高精度智能运维系统图片诊断 · 故障处置').click()
  await pause()
  check(
    document.querySelector('section[aria-label="高精度智能运维系统对话"]')!.getClientRects()
      .length > 0,
    '原 AI 仍可使用'
  )
  button('智能数据分析系统资料上传 · 季节倾角').click()
  await pause()
  check(text().includes('工单已生成，待人工下发'), '切换回来应保留倾角对话')
  button('下发工单').click()
  await until(() => text().includes('工单已下发至 C 平台'), '人工点击下发应成功')
  const tasks = await fetchPadTasks(ORIGIN, 'C')
  check(tasks.length === 1 && tasks[0].title === '执行夏季倾角', 'C 平台应收到夏季倾角任务')
  check(
    tasks[0].content.includes('20至25度') && tasks[0].tiltAdjustment?.month === 7,
    '任务应包含目标角度及月份'
  )

  render(12)
  await pause()
  check(text().includes('夏季：20至25度'), '月份变化不能改写已下发历史建议')
  upload('冬季项目.doc')
  await until(() => text().includes('冬季：42至48度'), '十二月应返回冬季建议')
  await until(
    () =>
      (document.querySelector('.tilt-panel')?.textContent ?? '').includes('工单已生成，待人工下发'),
    '冬季工单生成'
  )
  check(
    (await orders()).filter((order) => order.status === 'pending_review').length === 1,
    '新的月份应单独生成草稿'
  )
  check((await fetchPadTasks(ORIGIN, 'C')).length === 1, '新草稿不能自动下发')
  root.unmount()
  root = createRoot(document.getElementById('root')!)
  render(9)
  await pause()
  check(
    document.querySelector('.tilt-panel')!.getClientRects().length > 0,
    '重新进入应保留 AI 选择'
  )
  check(
    text().includes('冬季：42至48度') && text().includes('夏季：20至25度'),
    '刷新应保留独立对话与原月份'
  )
  check(text().includes('冬季项目.doc'), '刷新应保留 DOC 文档及其工单')
  upload('秋茶项目.docx')
  await until(() => text().includes('春秋季：30至38度'), '九月应返回春秋季固定文案')
  await until(
    () => document.querySelectorAll('.tilt-panel .work-order-created--created').length === 3,
    '三次上传均成功'
  )
  const pane = document.querySelector('.assistant-chat-pane:not([hidden])')!.getBoundingClientRect()
  const composer = document.querySelector('.tilt-upload-composer')!.getBoundingClientRect()
  check(
    composer.bottom <= pane.bottom + 1 && composer.right <= pane.right + 1,
    '上传栏不应溢出聊天面板'
  )
  check(document.documentElement.scrollWidth <= 1680, '设计尺寸下不能产生横向溢出')
  const screenshot = (window as unknown as { saveTiltScreenshot: () => Promise<void> })
    .saveTiltScreenshot
  await screenshot()

  // The newly uploaded DOCX must also reach C after manual dispatch and survive task normalization.
  const lastReply = [...document.querySelectorAll('.tilt-exchange')].at(-1)!
  lastReply.querySelector<HTMLButtonElement>('.diagnosis-primary')!.click()
  await until(
    () => lastReply.textContent!.includes('工单已下发至 C 平台'),
    'DOCX 工单应支持人工下发'
  )
  const documentTasks = await fetchPadTasks(ORIGIN, 'C')
  const docxTask = documentTasks.find((task) => task.tiltAdjustment?.fileName === '秋茶项目.docx')
  check(
    documentTasks.length === 2 && docxTask?.title === '执行春秋季倾角',
    'C 平台应收到 DOCX 资料工单'
  )
  check(docxTask.content.includes('项目资料「秋茶项目.docx」'), 'C 平台应正确显示文档来源')

  for (const [name, content] of [
    ['现场照片.png', '图片'],
    ['项目资料.pdf', '文档'],
    ['资料.zip', '压缩文件'],
    ['项目.doc.exe', '任意格式'],
    ['无扩展名', '资料'],
    ['空文件.bin', ''],
    ['大文件.mp4', 'x'.repeat(10 * 1024 * 1024 + 1)]
  ]) {
    const count = (await orders()).length
    upload(name, content)
    await until(
      () =>
        document.querySelectorAll('.tilt-panel .work-order-created--created').length === count + 1,
      `${name} 应生成固定模板工单`
    )
    const reply = [...document.querySelectorAll('.tilt-reply')].at(-1)!.textContent
    check(reply?.includes('春秋季：30至38度'), `${name} 应回复相同的季节模板`)
  }
  check(!text().includes('依据右上角'), '回复中不得显示月份依据')
  check((await fetchPadTasks(ORIGIN, 'C')).length === 2, '任意文件生成的工单仍须人工下发')
  File.prototype.arrayBuffer = originalRead

  // Verify that the normalized C task renders its own result form and submits the right fields.
  let submitted: Record<string, unknown> | undefined
  flushSync(() =>
    root.render(
      <PadTaskCard
        task={{ ...tasks[0], status: 'in_progress', canSubmit: true }}
        busyAction={null}
        onReplay={() => {}}
        onAction={async (_task, _action, body) => {
          submitted = body
        }}
      />
    )
  )
  check(
    text().includes('提交夏季倾角调整结果') && !text().includes('红外检测结果'),
    '倾角任务应显示专用回填表单'
  )
  const angle = document.querySelector<HTMLInputElement>('input[type="number"]')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(angle, '23')
  angle.dispatchEvent(new Event('input', { bubbles: true }))
  for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    checkbox.click()
  await pause()
  button('提交倾角调整结果').click()
  await pause()
  check(
    submitted?.adjustedAngle === 23 &&
      submitted?.fasteningConfirmed === true &&
      submitted?.retestPassed === true,
    'C 平台必须提交实际倾角与复测信息'
  )
  root.unmount()
  return [
    'PASS: 任意文件上传与固定回复、无月份依据提示、失败重试、人工下发隔离、C 平台接收、月份切换及历史保留、布局与倾角回填'
  ]
}

Object.assign(window, { runTiltAssistantSmoke })
