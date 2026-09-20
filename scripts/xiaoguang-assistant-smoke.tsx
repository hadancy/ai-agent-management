import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import AiAssistantPage from '../src/renderer/src/features/monitor/ai/AiAssistantPage'
import { XIAOGUANG_QA } from '../src/shared/xiaoguang-qa'
import '../src/renderer/src/assets/base.css'
import '../src/renderer/src/assets/global.css'
import '../src/renderer/src/features/monitor/styles/console-layout.css'

const STORAGE_KEY = 'ai-xiaoguang-chat-v1'
const pause = (ms = 45): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
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
const panel = (): HTMLElement => document.querySelector('.xiaoguang-panel')!
const input = (): HTMLTextAreaElement => document.querySelector('#xiaoguang-request')!
const exchanges = (): number => panel().querySelectorAll('.xiaoguang-exchange').length
function button(label: string, scope: ParentNode = panel()): HTMLButtonElement {
  const result = [...scope.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label && item.getClientRects().length > 0
  )
  check(result, `找不到按钮：${label}`)
  return result
}
async function switchAssistant(index: number): Promise<void> {
  document.querySelectorAll<HTMLButtonElement>('.assistant-switcher button')[index].click()
  await pause()
}
async function typeRequest(value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input(), value)
  input().dispatchEvent(new Event('input', { bubbles: true }))
  await pause()
}
let root = createRoot(document.getElementById('root')!)
function render(): void {
  flushSync(() =>
    root.render(
      <StrictMode>
        <main className="console-main console-main--assistant">
          <AiAssistantPage
            clock={new Date('2026-09-20T04:00:00Z')}
            serviceOrigin="http://xiaoguang-test.local"
            refreshToken={0}
            onWorkOrderChanged={() => {
              throw new Error('小光问答不应创建工单')
            }}
            onWorkOrderCreated={async () => {
              throw new Error('小光问答不应创建工单')
            }}
            onViewWorkOrder={() => {}}
            onOpenMonitor={() => {}}
            workOrderCount={0}
            plcOnline
          />
        </main>
      </StrictMode>
    )
  )
}
async function remount(): Promise<void> {
  flushSync(() => root.unmount())
  root = createRoot(document.getElementById('root')!)
  render()
  await pause()
}

async function runXiaoguangSmoke(): Promise<string[]> {
  localStorage.clear()
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
  const audios: TestAudio[] = []
  let blocked = false
  class TestAudio {
    src = ''
    preload = ''
    ended = false
    active = false
    onplaying?: () => void
    onended?: () => void
    constructor() {
      audios.push(this)
    }
    play(): Promise<void> {
      if (blocked) return Promise.reject(new DOMException('Click required', 'NotAllowedError'))
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
  const spoken: string[] = []
  let failSpeech = false
  let deferSpeech = false
  let finishSpeech: (() => void) | undefined
  window.fetch = async (url, init) => {
    check(String(url).endsWith('/api/speech'), `Unexpected request: ${url}`)
    spoken.push(JSON.parse(String(init?.body)).text)
    if (failSpeech) return Response.json({ message: '测试音频暂不可用' }, { status: 503 })
    if (deferSpeech)
      await new Promise<void>((resolve) => {
        finishSpeech = resolve
      })
    return new Response(new Blob([new Uint8Array(200)], { type: 'audio/wav' }), {
      headers: { 'Content-Type': 'audio/wav' }
    })
  }
  const playing = (): number => audios.filter((item) => item.active && item.onended).length
  render()
  await switchAssistant(2)
  check(document.querySelectorAll('.assistant-switcher button').length === 3, '应有三个助手入口')
  check(!panel().querySelector('input[type=file]'), '小光问答无需上传文件')
  check(button('发送').disabled, '空问题不能发送')
  check(
    !panel().querySelector('.xiaoguang-question-guide, .xiaoguang-topics, .xiaoguang-progress'),
    '不展示问题列表、选题按钮或进度'
  )

  await typeRequest('原草稿')
  button('语音输入').click()
  await pause(370)
  check(input().value.startsWith('原草稿\n小'), '语音应逐字出现并保留草稿')
  check(input().readOnly && button('发送').disabled, '输入生成过程中不能发送')
  button('取消').click()
  await pause()
  check(input().value === '原草稿', '取消应恢复原有草稿')
  button('语音输入').click()
  await pause(100)
  await switchAssistant(1)
  await switchAssistant(2)
  check(input().value === '原草稿' && !input().readOnly, '切换助手取消生成并恢复草稿')
  await typeRequest('')

  const cycleQuestions = [...XIAOGUANG_QA, ...XIAOGUANG_QA]
  for (const [index, item] of cycleQuestions.entries()) {
    button('语音输入').click()
    await pause(60)
    button('结束说话').click()
    await pause()
    check(input().value === item.question, `第 ${index + 1} 问应填入指定原文`)
    if (index === 0) {
      input().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })
      )
      input().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
      )
      await pause()
      check(exchanges() === 0, '中文选字和换行不得误发送')
    }
    const before = spoken.length
    const sentAt = performance.now()
    // Two events in the same turn must not duplicate a question or audio request.
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await pause()
    check(panel().querySelector('.xiaoguang-thinking'), '发送后应立即显示思考提示')
    check(panel().querySelectorAll('.xiaoguang-answer').length === index, '思考时不得提前显示答案')
    check(spoken.length === before && playing() === 0, '思考时不得提前请求或播放答案')
    check(button('发送').disabled && button('语音输入').disabled, '思考期间禁止再次提交')
    if (index === 0) {
      await pause(2700)
      check(
        panel().querySelector('.xiaoguang-thinking') && spoken.length === before,
        '接近三秒时仍应等待'
      )
    }
    await until(() => exchanges() === index + 1 && playing() === 1, '发送应显示一轮问答并自动播放')
    check(performance.now() - sentAt >= 3000, '回答和语音必须在三秒以后出现')
    check(spoken.length === before + 1 && spoken.at(-1) === item.answer, '自动播报应是本题完整答案')
    check(
      panel().querySelectorAll('.xiaoguang-answer')[index].textContent === item.answer,
      '回答应保留原文'
    )
    check(input().value === '', '发送后应清空草稿')
  }
  button('停止播报').click()
  await pause()
  check(playing() === 0, '停止按钮应停止语音')
  button('语音播报').click()
  await until(() => playing() === 1, '支持重播历史回答')
  check(spoken.at(-1) === XIAOGUANG_QA[0].answer, '重播应读取选中答案')
  const current = audios.find((item) => item.active)!
  current.ended = true
  current.onended?.()
  await pause()
  check(playing() === 0 && button('重新播报'), '播放完成应提供重新播报')

  blocked = true
  button('重新播报').click()
  await until(() => panel().textContent?.includes('点击播放') ?? false, '浏览器拦截应提供点击恢复')
  const fetched = spoken.length
  blocked = false
  button('点击播放').click()
  await until(() => playing() === 1, '点击应恢复已加载音频')
  check(spoken.length === fetched, '恢复无需重新请求音频')
  await switchAssistant(0)
  check(playing() === 0, '切换助手应停止播报')
  await switchAssistant(2)
  check(exchanges() === cycleQuestions.length, '切换助手保留小光历史')

  failSpeech = true
  button('语音播报').click()
  await until(() => panel().textContent?.includes('重试播报') ?? false, '音频失败应提供重试')
  failSpeech = false
  button('重试播报').click()
  await until(() => playing() === 1, '恢复服务后重试应成功')
  button('停止播报').click()
  await pause()
  deferSpeech = true
  button('语音播报').click()
  await until(() => !!finishSpeech, '请求应处于加载中')
  button('取消加载').click()
  await pause()
  finishSpeech!()
  await pause()
  check(playing() === 0, '取消后迟到的音频不得播放')
  deferSpeech = false

  const callsBeforeRemount = spoken.length
  await remount()
  check(
    panel().getClientRects().length && exchanges() === cycleQuestions.length,
    '刷新恢复助手选择和两轮循环记录'
  )
  check(spoken.length === callsBeforeRemount, '恢复历史不得自动重播')
  await typeRequest('未预设的问题')
  button('发送').click()
  await pause()
  check(
    exchanges() === cycleQuestions.length && input().value === '未预设的问题',
    '非预设问题应保留输入并提示语音填入'
  )
  check(panel().querySelector('[role=alert]'), '非预设问题应有可见提示')
  await typeRequest(XIAOGUANG_QA[2].question)
  button('发送').click()
  await pause()
  check(
    exchanges() === cycleQuestions.length && !panel().querySelector('.xiaoguang-thinking'),
    '不能手动跳题打乱循环'
  )
  await typeRequest('')
  button('语音输入').click()
  await pause(60)
  button('结束说话').click()
  await pause()
  check(input().value === XIAOGUANG_QA[0].question, '两轮循环及刷新后语音输入应再次从第一问开始')
  await typeRequest(` ${XIAOGUANG_QA[0].question.replace('？', '?')} `)
  button('发送').click()
  await until(
    () => exchanges() === cycleQuestions.length + 1 && playing() === 1,
    '允许标点与空白变化'
  )
  check(spoken.at(-1) === XIAOGUANG_QA[0].answer, '循环后问题应匹配第一问答案')
  await remount()
  button('语音输入').click()
  await pause(60)
  button('结束说话').click()
  await pause()
  check(input().value === XIAOGUANG_QA[1].question, '循环中途刷新后应接着下一问')

  const otherHistory = localStorage.getItem('ai-tilt-assistant-chat-v1')
  button('清空记录').click()
  await pause()
  button('取消', document.querySelector('[role=alertdialog]')!).click()
  await pause()
  check(exchanges() === cycleQuestions.length + 1, '取消清空应保留记录')
  button('清空记录').click()
  await pause()
  button('清空记录', document.querySelector('[role=alertdialog]')!).click()
  await pause()
  check(exchanges() === 0 && playing() === 0 && input().value === '', '清空应重置对话、输入和播放')
  check(localStorage.getItem(STORAGE_KEY) === '[]', '清空应更新持久记录')
  check(localStorage.getItem('ai-tilt-assistant-chat-v1') === otherHistory, '不得影响其他助手记录')
  const callsBeforeCancellation = spoken.length
  await typeRequest(XIAOGUANG_QA[0].question)
  button('发送').click()
  await pause()
  await switchAssistant(1)
  await pause(3100)
  check(spoken.length === callsBeforeCancellation, '切换助手后不得在后台播报等待中的回答')
  await switchAssistant(2)
  check(panel().querySelector('.xiaoguang-thinking'), '返回助手后应继续显示思考提示')
  button('清空记录').click()
  await pause()
  button('清空记录', document.querySelector('[role=alertdialog]')!).click()
  await pause(3100)
  check(
    exchanges() === 0 && spoken.length === callsBeforeCancellation,
    '清空必须取消思考计时，不得出现迟到的答案'
  )
  await typeRequest(XIAOGUANG_QA[0].question)
  button('发送').click()
  await pause()
  await remount()
  await pause(3100)
  check(
    exchanges() === 0 && spoken.length === callsBeforeCancellation,
    '离开页面取消等待，未完成的回答不写入历史'
  )
  // Invalid persisted values must not index outside the fixed question bank.
  localStorage.setItem(STORAGE_KEY, JSON.stringify([null, {}, { id: 'bad', questionIndex: 99 }]))
  await remount()
  check(exchanges() === 0, '损坏历史应安全忽略')
  return [
    'PASS: full three-second thinking delay, hidden answers/audio, duplicate-submit blocking and switch/clear/unmount cancellation',
    'PASS: two complete five-question cycles without question picker/progress, sequential voice filling, cancellation, IME and duplicate-submit protection',
    'PASS: automatic full-answer speech, stop/replay, completion, blocked recovery, request retry and late-response cancellation',
    'PASS: independent persistence, cycle restoration after refresh, out-of-order/unknown-question handling, clear/reset and malformed-history recovery'
  ]
}

async function showXiaoguang(
  state: 'welcome' | 'thinking' | 'conversation',
  scale: number
): Promise<void> {
  localStorage.setItem('ai-assistant-selected', 'xiaoguang')
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      state !== 'conversation'
        ? []
        : XIAOGUANG_QA.map((_, questionIndex) => ({
            id: `preview-${questionIndex}`,
            questionIndex
          }))
    )
  )
  document.documentElement.style.setProperty('--app-font-scale', String(scale))
  await remount()
  if (state === 'thinking') {
    await typeRequest(XIAOGUANG_QA[0].question)
    button('发送').click()
    await pause()
  }
  const heading = document.querySelector<HTMLElement>('.assistant-page__heading')!
  check(heading.scrollWidth <= heading.clientWidth + 1, '三个入口不应溢出标题栏')
  for (const element of panel().querySelectorAll<HTMLElement>(
    '.tilt-voice-button, .tilt-send-button'
  )) {
    const box = element.getBoundingClientRect()
    check(box.right <= innerWidth && box.bottom <= innerHeight, '语音输入和发送按钮应在窗口内')
  }
}
Object.assign(window, { runXiaoguangSmoke, showXiaoguang })
