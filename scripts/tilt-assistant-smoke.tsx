import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import AiAssistantPage from '../src/renderer/src/features/monitor/ai/AiAssistantPage'
import MonitorHeader from '../src/renderer/src/features/monitor/components/MonitorHeader'
import PadTaskCard from '../src/renderer/src/features/pad/PadTaskCard'
import WorkOrderCenter from '../src/renderer/src/features/monitor/workorder/WorkOrderCenter'
import { fetchPadTasks } from '../src/renderer/src/features/pad/taskClient'
import {
  ANALYSIS_PROMPTS,
  getAnalysisLines,
  getResultSegments,
  OVERVIEW_CONCLUSION,
  type AnalysisRound
} from '../src/shared/agrivoltaic-analysis'
import type { WorkOrder } from '../src/shared/contracts'
import '../src/renderer/src/assets/base.css'
import '../src/renderer/src/assets/global.css'
import '../src/renderer/src/features/monitor/styles/console-layout.css'
import '../src/renderer/src/features/pad/pad.css'

const ORIGIN = 'http://tilt-test.local'
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
const pause = (ms = 70): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
async function until(ready: () => boolean, message: string): Promise<void> {
  for (let index = 0; index < 100; index++) {
    if (ready()) return
    await pause(40)
  }
  throw new Error(message)
}
function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label && item.getClientRects().length > 0
  )
  check(result, `找不到按钮：${label}`)
  return result
}
function upload(name = '农光互补项目信息.docx'): void {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="选择项目资料"]')!
  const transfer = new DataTransfer()
  transfer.items.add(new File(['项目信息'], name))
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
const input = (): HTMLTextAreaElement => document.querySelector('#tilt-request')!
const panel = (): HTMLElement => document.querySelector('.tilt-panel')!
const text = (): string => panel().textContent ?? ''
function typeRequest(value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input(), value)
  input().dispatchEvent(new Event('input', { bubbles: true }))
}
async function orders(): Promise<WorkOrder[]> {
  return (await (await fetch(`${ORIGIN}/api/work-orders`)).json()).items
}
async function runTiltAssistantSmoke(): Promise<string[]> {
  localStorage.clear()
  let time = 0
  Object.defineProperty(performance, 'now', { configurable: true, value: () => time })
  const advance = async (ms: number): Promise<void> => {
    time += ms
    await pause(100)
  }
  const finishAnalysis = async (round: AnalysisRound): Promise<void> => {
    await advance(
      5000 +
        getAnalysisLines(round).length * 650 +
        getResultSegments(round).join('').length * 25 +
        100
    )
  }
  for (const key of ['SpeechRecognition', 'webkitSpeechRecognition', 'speechSynthesis'])
    Object.defineProperty(window, key, {
      configurable: true,
      get: () => {
        throw new Error(`禁止使用真实语音 API: ${key}`)
      }
    })
  if (navigator.mediaDevices)
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => {
        throw new Error('禁止申请麦克风')
      }
    })
  const spoken: string[] = []
  let denyAudio = true
  class TestAudio {
    src = ''
    preload = ''
    ended = false
    active = false
    onplaying?: () => void
    onended?: () => void
    play(): Promise<void> {
      if (denyAudio) return Promise.reject(new DOMException('Click required', 'NotAllowedError'))
      this.active = true
      this.onplaying?.()
      return Promise.resolve()
    }
    pause(): void {
      this.active = false
    }
    removeAttribute(): void {
      this.src = ''
    }
    load(): void {
      this.ended = false
    }
  }
  Object.defineProperty(window, 'Audio', { value: TestAudio })
  const apiFetch = window.fetch
  let loseDraftResponse = false
  window.fetch = async (url, init) => {
    if (String(url).endsWith('/api/speech')) {
      spoken.push(JSON.parse(String(init?.body)).text)
      return new Response(new Blob([new Uint8Array(200)], { type: 'audio/wav' }), {
        headers: {
          'Content-Type': 'audio/wav',
          'X-Speech-Provider': 'recorded',
          'X-Speech-Voice': 'Tingting',
          'X-Speech-Fallback': '0'
        }
      })
    }
    const response = await apiFetch(url, init)
    if (loseDraftResponse && String(url).endsWith('/drafts')) {
      loseDraftResponse = false
      throw new TypeError('模拟响应丢失')
    }
    return response
  }
  let root = createRoot(document.getElementById('root')!)
  const render = (date = '2026-09-23'): void =>
    flushSync(() =>
      root.render(
        <StrictMode>
          <MonitorHeader
            activeNav="智诊精巡"
            hasAlarm={false}
            clock={new Date(`${date}T04:00:00Z`)}
            plcOnline
            onNavChange={() => {}}
          />
          <main className="console-main console-main--assistant">
            <AiAssistantPage
              normalRange={{ normalVoltage: 50, normalCurrent: 12, tolerancePercent: 8 }}
              clock={new Date(`${date}T04:00:00Z`)}
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
  const screenshot = (name: string): Promise<void> =>
    (
      window as unknown as { saveTiltScreenshot: (name: string) => Promise<void> }
    ).saveTiltScreenshot(name)
  const scrollBottom = async (): Promise<void> => {
    const list = panel().querySelector<HTMLElement>('.chat-list')!
    list.scrollTop = list.scrollHeight
    await pause(100)
  }
  render()
  button('智能数据分析系统资料上传 · 季节倾角').click()
  await pause()
  check(button('发送').disabled, '空需求不可发送')
  typeRequest('分析净高')
  await pause()
  check(button('发送').disabled, '第一轮需要附件')
  upload('项目.pdf')
  await pause()
  check(text().includes('请选择 Word'), '非 Word 显示错误')
  upload()
  await pause()
  check(text().includes('已添加，发送后分析'), '附件应等待发送')
  check(
    (await orders()).length === 0 && !text().includes('正在思考'),
    '选择 Word 不能自动分析或创建工单'
  )
  panel().querySelector<HTMLButtonElement>('button[aria-label="移除附件"]')!.click()
  await pause()
  check(button('发送').disabled, '移除附件后第一轮不可发送')
  upload()
  await pause()
  typeRequest('原草稿')
  await pause()
  button('语音输入').click()
  await pause(350)
  check(input().value.startsWith('原草稿\n请'), '模拟文字应逐字出现并保留草稿')
  check(input().readOnly && button('发送').disabled, '模拟说话期间禁止发送')
  button('取消').click()
  await pause(200)
  check(input().value === '原草稿', '取消后应恢复原文并停止计时')
  button('语音输入').click()
  await pause(180)
  button('高精度智能运维系统图片诊断 · 故障处置').click()
  await pause(200)
  button('智能数据分析系统资料上传 · 季节倾角').click()
  await pause()
  check(input().value === '原草稿' && !input().readOnly, '切换助手取消模拟输入')
  typeRequest('')
  await pause()
  button('语音输入').click()
  await pause(180)
  button('结束说话').click()
  await pause()
  check(input().value === ANALYSIS_PROMPTS.overview, '第一次模拟语音应显示指定台词')
  input().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })
  )
  input().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  input().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  input().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
  )
  await pause()
  check(!text().includes('正在思考'), '中文选词及换行不能误发送')
  input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await pause()
  check(panel().querySelectorAll('.tilt-exchange').length === 1, '连续发送只能生成一轮')
  check(text().includes('正在思考') && !panel().querySelector('.tilt-thinking'), '应先等待')
  await advance(4999)
  check(!panel().querySelector('.tilt-thinking'), '未满5秒不能出现分析文案')
  await advance(1)
  check(panel().querySelectorAll('.tilt-thinking p').length === 1, '第5秒只出现第一行分析')
  await advance(650)
  check(panel().querySelectorAll('.tilt-thinking p').length === 2, '分析文案应逐行出现')
  check(
    !panel().querySelector('.tilt-comparison-table') && spoken.length === 0,
    '分析未结束不能显示完整答案或播报'
  )
  await advance(getAnalysisLines('overview').length * 650)
  check(
    panel().querySelector('.tilt-analysis-result') &&
      !panel().querySelector('.tilt-comparison-table'),
    '答案应渐进输出，不能整段跳出'
  )
  await finishAnalysis('overview')
  await until(() => spoken.length === 1, '第一轮结束自动调用平台播报')
  check(spoken[0] === OVERVIEW_CONCLUSION, '第一轮只播报指定结论')
  check(
    panel().querySelectorAll('.tilt-comparison-table tbody tr').length === 6,
    '应输出六维对比表'
  )
  const tableViewport = panel().querySelector<HTMLElement>('.tilt-comparison-scroll')!
  check(tableViewport.scrollWidth <= tableViewport.clientWidth + 1, '桌面尺寸下应完整展示四列表格')
  check(
    text().includes('1.0 m × 1.8 + 0.2 m = 2 m') && text().includes('3.2倍'),
    '应包含净高公式与指定方案文案'
  )
  const emphasized = panel().querySelector('.tilt-key-conclusion')!
  check(
    parseFloat(getComputedStyle(emphasized).fontSize) >= 20 &&
      Number(getComputedStyle(emphasized).fontWeight) >= 700,
    '结论应加大加粗'
  )
  check((await orders()).length === 0, '第一轮不创建工单')
  await until(() => text().includes('点击播放'), '自动播报受阻应提示恢复')
  check(!/婷婷|预录音频/.test(text()), '倾角分析不显示音色和录音来源标签')
  denyAudio = false
  button('点击播放').click()
  await pause()
  check(Number(spoken.length) === 1, '恢复播放不得重新合成')
  await scrollBottom()
  await screenshot('overview')
  button('停止播报').click()
  await pause()

  button('语音输入').click()
  await pause(180)
  button('结束说话').click()
  await pause()
  check(input().value === ANALYSIS_PROMPTS.seasonal, '第二次语音应切换为季节建议台词')
  loseDraftResponse = true
  button('发送').click()
  await pause()
  await advance(4999)
  check(panel().querySelectorAll('.tilt-thinking').length === 1, '第二轮也应等待5秒')
  await advance(1)
  check(
    [...panel().querySelectorAll('.tilt-thinking')].at(-1)!.textContent!.includes('设计原则'),
    '第二轮分析从设计原则开始'
  )
  await finishAnalysis('seasonal')
  await until(() => text().includes('工单生成失败'), '草稿响应丢失应提示重试')
  check((await orders()).length === 1 && Number(spoken.length) === 1, '失败时不能播报工单已生成')
  button('重试生成').click()
  await until(() => text().includes('工单已生成，待人工下发'), '重试应恢复同一工单')
  check((await orders()).length === 1, '重试不能重复创建')
  await until(() => Number(spoken.length) === 2, '第二轮成功后自动播报')
  check(
    spoken[1] ===
      '基准倾角为21–23°\n秋季：回归基准，平衡发电与秋茶品质。\n现在是9月23日，执行秋季倾角，工单已生成。',
    '播报只包含基准倾角、当前季节策略和实际日期结论'
  )
  check(
    panel().querySelector('.tilt-seasonal-results')!.querySelectorAll('p').length === 4,
    '文字回答仍应显示四季完整建议'
  )
  check(
    text().includes('NG-GQ-20260923-001') && text().includes('2026.09.23～2026.11.07'),
    '工单编号和维持周期应跟随日期'
  )
  check(
    text().includes('22.00°（允许偏差 ±1.00°）') && text().includes('禁止夜间作业'),
    '工单内容完整'
  )
  check((await fetchPadTasks(ORIGIN, 'C')).length === 0, '人工下发前C平台不可见')
  const workOrder = (await orders())[0]
  check(
    workOrder.normalRange.normalVoltage === 50 && workOrder.normalRange.normalCurrent === 12,
    '保留设备正常值配置'
  )
  await scrollBottom()
  await screenshot('seasonal')
  button('下发工单').click()
  await until(() => text().includes('工单已下发至 C 平台'), '人工下发成功')
  const tasks = await fetchPadTasks(ORIGIN, 'C')
  check(tasks.length === 1 && tasks[0].title === '现场作业实施记录', 'C平台任务名称正确')
  check(
    tasks[0].tiltAdjustment?.analysisDate === '2026-09-23' &&
      tasks[0].tiltAdjustment.fieldWorkflowVersion === 1 &&
      tasks[0].voiceText === '您有新的工单，请将光伏组件倾角调整至 22°。',
    'C平台完整接收工单明细'
  )
  root.unmount()
  root = createRoot(document.getElementById('root')!)
  render('2026-12-23')
  await pause()
  check(
    text().includes('执行秋季倾角') && text().includes('9月23日'),
    '刷新后历史日期和策略不能变化'
  )
  check(Number(spoken.length) === 2, '历史记录不能自动重播')
  panel().querySelectorAll<HTMLButtonElement>('.diagnosis-voice')[1].click()
  await until(() => Number(spoken.length) === 3, '历史季节建议可手动重播')
  check(spoken[2] === spoken[1], '跨季重播应保留原分析日期对应的秋季文段')
  typeRequest(ANALYSIS_PROMPTS.seasonal)
  await pause()
  button('发送').click()
  await pause()
  await advance(5000)
  const thinkingBeforePause = [...panel().querySelectorAll('.tilt-thinking')]
    .at(-1)!
    .querySelectorAll('p').length
  button('高精度智能运维系统图片诊断 · 故障处置').click()
  await pause()
  await advance(100000)
  check((await orders()).length === 1, '离开页面时分析暂停，不能后台生成新工单')
  button('智能数据分析系统资料上传 · 季节倾角').click()
  await pause()
  check(
    [...panel().querySelectorAll('.tilt-thinking')].at(-1)!.querySelectorAll('p').length ===
      thinkingBeforePause,
    '回到页面应从暂停位置继续'
  )
  await finishAnalysis('seasonal')
  await until(() => text().includes('NG-GQ-20261223-001'), '冬季应按新日期创建工单')
  await until(() => Number(spoken.length) === 4, '冬季工单生成后应自动播报')
  check(
    spoken[3] ===
      '基准倾角为21–23°\n冬季：基准+12°，多发电、自动除雪、防霜冻。\n现在是12月23日，执行冬季倾角，工单已生成。',
    '日期切换后仅播报冬季建议'
  )
  check(
    text().includes('34.00°（允许偏差 ±1.00°）') && text().includes('2026.12.23～2027.02.03'),
    '冬季目标和跨年周期正确'
  )
  check((await fetchPadTasks(ORIGIN, 'C')).length === 1, '第二张草稿仍不能自动下发')
  const composer = panel().querySelector('.tilt-request-composer')!.getBoundingClientRect()
  const chat = panel().querySelector<HTMLElement>('.chat-list')!
  chat.scrollTop = 0
  await pause()
  check(
    panel().querySelector('.tilt-request-composer')!.getBoundingClientRect().bottom ===
      composer.bottom,
    '输入区必须固定在底部'
  )
  check(document.documentElement.scrollWidth <= 1680, '整页不能横向溢出')
  button('清空记录').click()
  await pause()
  document.querySelector<HTMLButtonElement>('.clear-chat-dialog__confirm')!.click()
  await pause()
  check(!panel().querySelector('.tilt-exchange') && input().value === '', '清空后重置对话和阶段')
  check((await orders()).length === 2, '清空不删除工单')
  upload('重新开始.doc')
  typeRequest(ANALYSIS_PROMPTS.overview)
  await pause()
  button('发送').click()
  await pause()
  root.unmount()
  root = createRoot(document.getElementById('root')!)
  render()
  await pause()
  check(text().includes('上次分析未完成'), '中途退出后恢复为可重试状态')
  check((await orders()).length === 2, '恢复记录不能自动生成工单')
  button('重新生成').click()
  await pause()
  await finishAnalysis('overview')
  check(text().includes(OVERVIEW_CONCLUSION), '中断后可以重新完成分析')

  let submitted: Record<string, unknown> | undefined
  flushSync(() =>
    root.render(
      <PadTaskCard
        task={{
          ...tasks[0],
          tiltAdjustment: { ...tasks[0].tiltAdjustment!, fieldWorkflowVersion: undefined },
          status: 'in_progress',
          canSubmit: true
        }}
        serviceOrigin={ORIGIN}
        busyAction={null}
        onReplay={() => {}}
        onAction={async (_task, _action, body) => {
          submitted = body
        }}
      />
    )
  )
  const angle = document.querySelector<HTMLInputElement>('input[type="number"]')!
  check(angle.min === '21' && angle.max === '23', 'C平台回填使用新的秋季范围')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(angle, '22')
  angle.dispatchEvent(new Event('input', { bubbles: true }))
  for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
    checkbox.click()
  await pause()
  button('提交倾角调整结果').click()
  await pause()
  check(
    submitted?.adjustedAngle === 22 &&
      submitted?.fasteningConfirmed === true &&
      submitted?.retestPassed === true,
    'C平台实际倾角回填正确'
  )
  flushSync(() =>
    root.render(
      <WorkOrderCenter
        serviceOrigin={ORIGIN}
        refreshToken={0}
        onBack={() => {}}
        onOpenAssistant={() => {}}
      />
    )
  )
  await until(
    () => document.querySelectorAll('.work-order-card').length === 2,
    '工单中心应显示季节工单'
  )
  const autumnCard = [...document.querySelectorAll<HTMLButtonElement>('.work-order-card')].find(
    (card) => card.textContent?.includes(workOrder.orderNumber)
  )!
  check(autumnCard, '工单中心应保留秋季编号')
  autumnCard.click()
  await until(
    () =>
      document
        .querySelector('.work-order-meta')
        ?.textContent?.includes('2026.09.23～2026.11.07') === true,
    '工单详情应展示完整维持周期'
  )
  check(
    document.querySelector('.work-order-meta')!.textContent!.includes('22.00°（允许偏差 ±1.00°）'),
    '工单中心目标角度正确'
  )
  root.unmount()
  return [
    'PASS: 两轮模拟语音、Word附件暂存、5秒等待、逐行分析和渐进表格、加粗结论、自动语音及恢复、日期/季节动态工单、重试去重、人工下发、C平台回填、历史恢复与底部布局'
  ]
}
Object.assign(window, { runTiltAssistantSmoke })
