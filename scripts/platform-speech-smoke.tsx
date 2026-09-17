import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import AiAssistant from '../src/renderer/src/features/monitor/ai/AiAssistant'
import ConsoleApp from '../src/renderer/src/features/monitor/ConsoleApp'
import SpeechSettingsCard from '../src/renderer/src/features/monitor/settings/SpeechSettingsCard'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40))
async function waitFor(condition: () => unknown, message: string): Promise<void> {
  // React may commit playback state after the mocked audio starts, especially on CI.
  const deadline = performance.now() + 5000
  while (!condition()) {
    if (performance.now() >= deadline) {
      const statuses = [...document.querySelectorAll('[role="status"]')]
        .map((element) => element.textContent?.trim())
        .join(' | ')
      throw new Error(`${message}; current status: ${statuses || '(none)'}`)
    }
    await pause()
  }
}

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
  const voice = 'Tingting'
  let orderReads = 0
  const response = (): Response =>
    new Response(new Blob([new Uint8Array(200)], { type: 'audio/wav' }), {
      headers: {
        'Content-Type': 'audio/wav',
        'X-Speech-Provider': 'recorded',
        'X-Speech-Voice': voice,
        'X-Speech-Fallback': '0'
      }
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
    if (url.includes('/api/work-orders?')) {
      orderReads++
      return Response.json({ items: orders, total: orders.length })
    }
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
  await waitFor(
    () => document.querySelector('.diagnosis-voice-status')?.textContent === '正在播报',
    'AI playback status must reach speaking'
  )
  check(
    spoken.length === 1 && spoken[0].includes('工单草稿已生成'),
    'AI diagnosis uses cloud speech'
  )
  check(
    players.some((player) => player.active),
    'AI audio starts'
  )
  check(
    document.body.textContent?.includes('正在播报') &&
      !/婷婷|预录音频/.test(document.body.textContent ?? ''),
    'AI displays playback status without voice metadata'
  )
  click('停止播报')
  check(
    players.every((player) => !player.active),
    'AI stop halts active media'
  )
  denied = true
  click('语音播报')
  await waitFor(
    () =>
      document.querySelector('.diagnosis-voice-status')?.textContent?.includes('浏览器需要您点击'),
    'AI playback status must expose autoplay denial'
  )
  check(document.body.textContent?.includes('浏览器需要您点击'), 'AI exposes autoplay denial')
  const beforeResume = spoken.length
  denied = false
  click('点击播放')
  await waitFor(
    () => document.querySelector('.diagnosis-voice-status')?.textContent === '正在播报',
    'Resumed AI audio must reach speaking'
  )
  check(spoken.length === beforeResume, 'AI resumes existing audio without resynthesis')
  flushSync(() => players.find((player) => player.active)!.finish())
  hold = true
  click('重新播报')
  const beforeUnmount = starts
  check(document.body.textContent?.includes('取消加载'), 'AI pending speech can be canceled')
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
  await waitFor(
    () => document.body.textContent?.includes('进入工单中心查看进度'),
    'Initial work-order data must finish rendering before closure events'
  )
  check(spoken.length === initialCount, 'initially closed work orders must stay silent')
  const closureStatus = (): string =>
    document.querySelector('[aria-label="工单关闭语音提醒"]')?.textContent ?? ''
  const publishSettings = (revision: string): void => {
    sockets.at(-1)!.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'speech.settings-changed', payload: { revision } })
      })
    )
  }
  publishSettings('settings-1')
  await pause()
  check(spoken.length === initialCount, 'initial settings do not announce historical closures')
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
  await waitFor(
    () => closureStatus().includes('点击播放'),
    'Newly closed work orders must expose the blocked playback action'
  )
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
  check(
    document.querySelector('[aria-label="工单关闭语音提醒"]')?.textContent?.includes('点击播放'),
    'work-order notifications show the playback action'
  )
  const beforeSettingsReads = orderReads
  const oldBlockedUrl = players.find((player) => player.src)?.src
  publishSettings('settings-2')
  await waitFor(
    () =>
      spoken.length === initialCount + 2 &&
      (!oldBlockedUrl || !urls.has(oldBlockedUrl)) &&
      closureStatus().includes('点击播放'),
    'Refreshed closure audio must expose the blocked playback action'
  )
  check(spoken.length === initialCount + 2, 'settings events regenerate blocked announcements')
  check(!oldBlockedUrl || !urls.has(oldBlockedUrl), 'old blocked audio is released')
  check(
    document.querySelector('[aria-label="工单关闭语音提醒"]')?.textContent?.includes('点击播放'),
    'the refreshed notification keeps the playback action'
  )
  publishSettings('settings-2')
  await pause()
  check(spoken.length === initialCount + 2, 'duplicate settings events do not repeat speech')
  check(orderReads === beforeSettingsReads, 'speech settings do not trigger work-order reloads')
  denied = false
  click('点击播放')
  await waitFor(
    () => closureStatus().includes('正在播报'),
    'Resumed closure audio must reach speaking'
  )
  check(
    spoken.length === initialCount + 2 && players.some((player) => player.active),
    'closure replay uses the prepared clip'
  )
  const playingUrl = players.find((player) => player.active)!.src
  publishSettings('settings-3')
  await waitFor(
    () =>
      spoken.length === initialCount + 3 &&
      !urls.has(playingUrl) &&
      players.filter((player) => player.active).length === 1 &&
      closureStatus().includes('正在播报'),
    'Replacement closure audio must reach speaking'
  )
  check(
    spoken.length === initialCount + 3 && !urls.has(playingUrl),
    'settings events replace audio that is already playing'
  )
  check(
    players.filter((player) => player.active).length === 1,
    'voice changes keep one active clip'
  )
  flushSync(() => players.find((player) => player.active)!.finish())
  publishSettings('settings-4')
  await pause()
  check(
    spoken.length === initialCount + 3,
    'settings changes do not replay completed notifications'
  )
  flushSync(() => consoleRoot.unmount())
  check(
    players.every((player) => !player.active) && urls.size === 0,
    'leaving console stops and releases all speech'
  )
  reports.push(
    'PASS: console announcements share the voice, sync settings over WebSocket, replace blocked/playing audio and keep completed notifications silent'
  )
  const settingsRoot = createRoot(document.getElementById('root')!)
  flushSync(() => settingsRoot.render(<SpeechSettingsCard />))
  await pause()
  check(
    !document.querySelector('input, select'),
    'recorded voice settings never offer cloud keys or alternative voices'
  )
  click('试听语音')
  await waitFor(
    () => document.querySelector('.speech-settings__message')?.textContent === '正在播报',
    'Settings preview must reach speaking'
  )
  check(
    spoken.at(-1)?.includes('故障类型：组件热斑'),
    'settings preview uses the approved diagnosis recording'
  )
  check(
    document.body.textContent?.includes('正在播报') &&
      !/婷婷|预录音频/.test(document.body.textContent ?? ''),
    'preview shows playback status without technical labels'
  )
  click('停止试听')
  check(
    players.every((player) => !player.active),
    'preview can stop through the shared player'
  )
  flushSync(() => settingsRoot.unmount())
  reports.push('PASS: recorded settings preview, shared playback, stop and no cloud configuration')
  return reports
}
Object.assign(window, { runPlatformSpeechSmoke })
