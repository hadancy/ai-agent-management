import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import AiAssistant from '../src/renderer/src/features/monitor/ai/AiAssistant'
import ConsoleApp from '../src/renderer/src/features/monitor/ConsoleApp'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40))
function click(label: string): void {
  const button = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === label
  )
  check(button, `Missing button: ${label}`)
  flushSync(() => button.click())
}

async function runPlatformSpeechSmoke(): Promise<string[]> {
  const reports: string[] = []
  for (const property of ['speechSynthesis', 'SpeechSynthesisUtterance']) {
    Object.defineProperty(window, property, {
      get: () => {
        throw new Error(`System speech accessed: ${property}`)
      }
    })
  }
  let denied = false
  let hold = false
  let release: ((response: Response) => void) | undefined
  let heldSignal: AbortSignal | null | undefined
  const spoken: string[] = []
  const urls = new Map<string, Blob>()
  let urlId = 0
  URL.createObjectURL = (blob) => {
    const id = `blob:platform-test-${urlId++}`
    urls.set(id, blob)
    return id
  }
  URL.revokeObjectURL = (id) => {
    urls.delete(id)
  }
  const players: TestAudio[] = []
  let starts = 0
  class TestAudio {
    src = ''
    preload = ''
    ended = false
    active = false
    onplaying?: () => void
    onended?: () => void
    onerror?: () => void
    constructor() {
      players.push(this)
    }
    play(): Promise<void> {
      if (urls.get(this.src)?.size === 1644) return Promise.resolve()
      if (denied) return Promise.reject(new DOMException('Click required', 'NotAllowedError'))
      this.active = true
      this.ended = false
      starts++
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
    finish(): void {
      this.ended = true
      this.active = false
      this.onended?.()
    }
  }
  Object.defineProperty(window, 'Audio', { value: TestAudio })
  const sockets: TestSocket[] = []
  class TestSocket extends EventTarget {
    constructor() {
      super()
      sockets.push(this)
    }
    close(): void {
      this.dispatchEvent(new Event('close'))
    }
  }
  Object.defineProperty(window, 'WebSocket', { value: TestSocket })
  let orders = [
    { id: 'old', orderNumber: 'WO-OLD', status: 'closed' },
    { id: 'new', orderNumber: 'WO-NEW', status: 'in_progress' }
  ]
  const response = (): Response =>
    new Response(new Blob([new Uint8Array(200)], { type: 'audio/wav' }), {
      headers: { 'Content-Type': 'audio/wav', 'X-Speech-Provider': 'qwen' }
    })
  window.fetch = async (value, init) => {
    const url = String(value)
    if (url.endsWith('/api/speech')) {
      check(
        url === 'http://127.0.0.1:17880/api/speech',
        'monitor pages use the same platform speech endpoint'
      )
      spoken.push(JSON.parse(String(init?.body)).text)
      if (hold) {
        heldSignal = init?.signal
        return new Promise((resolve) => {
          release = resolve
        })
      }
      return response()
    }
    if (url.endsWith('/api/system-info')) return Response.json({})
    if (url.endsWith('/api/telemetry/latest')) return new Response(null, { status: 204 })
    if (url.includes('/api/work-orders?'))
      return Response.json({ items: orders, total: orders.length })
    throw new Error(`Unexpected request in component test: ${url}`)
  }
  localStorage.clear()
  localStorage.setItem(
    'ai-assistant-chat-messages-v2',
    JSON.stringify([
      {
        id: 2,
        role: 'assistant',
        content: '诊断完成',
        diagnosis: true,
        draftStatus: 'created',
        orderNumber: 'WO-TEST'
      }
    ])
  )
  const rootElement = document.getElementById('root')!
  const aiRoot = createRoot(rootElement)
  flushSync(() =>
    aiRoot.render(
      <StrictMode>
        <AiAssistant
          onWorkOrderCreated={async () => {
            throw new Error('No work order mutation is allowed in speech test')
          }}
          onViewWorkOrder={() => {
            /* Navigation is not part of this test. */
          }}
        />
      </StrictMode>
    )
  )
  click('语音播报')
  await pause()
  check(
    spoken.length === 1 && spoken[0].includes('工单草稿已生成'),
    'AI diagnosis uses cloud speech'
  )
  check(
    players.some((player) => player.active),
    'AI audio starts'
  )
  click('停止播报')
  check(
    players.every((player) => !player.active),
    'AI stop halts active media'
  )
  denied = true
  click('语音播报')
  await pause()
  check(document.body.textContent?.includes('浏览器需要您点击'), 'AI exposes autoplay denial')
  const beforeResume = spoken.length
  denied = false
  click('点击播放')
  await pause()
  check(spoken.length === beforeResume, 'AI resumes existing audio without resynthesis')
  flushSync(() => players.find((player) => player.active)!.finish())
  hold = true
  click('重新播报')
  const beforeUnmount = starts
  check(document.body.textContent?.includes('取消生成'), 'AI pending speech can be canceled')
  flushSync(() => aiRoot.unmount())
  check(heldSignal?.aborted, 'AI unmount aborts cloud requests')
  release!(response())
  await pause()
  check(starts === beforeUnmount && urls.size === 0, 'late AI audio is discarded after unmount')
  hold = false
  reports.push(
    'PASS: AI diagnosis uses platform TTS; stop, blocked playback resume and late-response cancellation work'
  )

  localStorage.clear()
  const consoleRoot = createRoot(rootElement)
  const initialCount = spoken.length
  flushSync(() =>
    consoleRoot.render(
      <StrictMode>
        <ConsoleApp />
      </StrictMode>
    )
  )
  await pause()
  check(spoken.length === initialCount, 'initially closed work orders must stay silent')
  denied = true
  orders = orders.map((order) => ({ ...order, status: 'closed' }))
  const invalidate = (): void => {
    sockets
      .at(-1)!
      .dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ type: 'workOrder.closed' }) })
      )
  }
  invalidate()
  await pause()
  check(
    spoken.length === initialCount + 1 && spoken.at(-1)?.includes('WO-NEW'),
    'newly closed work orders announce through platform TTS'
  )
  check(!spoken.at(-1)?.includes('WO-OLD'), 'historical closures are not replayed')
  invalidate()
  await pause()
  check(
    spoken.length === initialCount + 1,
    'duplicate work-order events do not repeat announcements'
  )
  check(
    document.querySelector('[aria-label="工单关闭语音提醒"]'),
    'blocked closure announcements expose a visible play action'
  )
  denied = false
  click('点击播放')
  await pause()
  check(
    spoken.length === initialCount + 1 && players.some((player) => player.active),
    'closure replay uses the prepared clip'
  )
  flushSync(() => consoleRoot.unmount())
  check(
    players.every((player) => !player.active) && urls.size === 0,
    'leaving console stops and releases all speech'
  )
  reports.push(
    'PASS: console closure announcements use platform TTS, deduplicate events, support manual resume and clean up on unmount'
  )
  return reports
}
Object.assign(window, { runPlatformSpeechSmoke })
