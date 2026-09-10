import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import {
  PlatformSpeechPlayer,
  type VoicePlaybackState
} from '../src/renderer/src/speech/PlatformSpeechPlayer'
import { useTaskSpeech } from '../src/renderer/src/features/pad/useTaskSpeech'
import type { PadTask } from '../src/renderer/src/features/pad/taskClient'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

window.runPadSpeechSmoke = async (): Promise<string[]> => {
  const reports: string[] = []
  // Decode a real blob with the production CSP before installing playback mocks.
  const pcm = new Uint8Array(4844)
  const header = new DataView(pcm.buffer)
  for (const [offset, text] of [
    [0, 'RIFF'],
    [8, 'WAVEfmt '],
    [36, 'data']
  ] as const)
    pcm.set(new TextEncoder().encode(text), offset)
  header.setUint32(4, pcm.length - 8, true)
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true)
  header.setUint16(22, 1, true)
  header.setUint32(24, 24000, true)
  header.setUint32(28, 48000, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  header.setUint32(40, pcm.length - 44, true)
  const realUrl = URL.createObjectURL(new Blob([pcm], { type: 'audio/wav' }))
  const realAudio = new Audio()
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Real WAV did not load under production CSP')),
        5000
      )
      realAudio.onloadeddata = () => {
        clearTimeout(timer)
        resolve()
      }
      realAudio.onerror = () => {
        clearTimeout(timer)
        reject(new Error(`Real WAV blocked or undecodable: ${realAudio.error?.code}`))
      }
      realAudio.src = realUrl
      realAudio.load()
    })
    check(
      Math.abs(realAudio.duration - 0.1) < 0.01,
      'browser decodes the WAV with the correct duration'
    )
    reports.push('PASS: real WAV blob decoding under the production Content Security Policy')
  } finally {
    realAudio.removeAttribute('src')
    realAudio.load()
    URL.revokeObjectURL(realUrl)
  }
  const urls = new Map<string, Blob>()
  let nextUrl = 0
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:test-${nextUrl++}`
    urls.set(url, blob)
    return url
  }
  URL.revokeObjectURL = (url: string) => {
    urls.delete(url)
  }
  let denyAudio = false
  let plays = 0
  let primePlays = 0
  let requests = 0
  let fetchFailure = false
  let deferred: ((response: Response) => void) | undefined
  let holdRequest = false
  const response = (): Response =>
    new Response(new Blob([new Uint8Array(2400)], { type: 'audio/wav' }), {
      headers: { 'Content-Type': 'audio/wav' }
    })
  window.fetch = async (url, init) => {
    check(
      String(url) === 'http://localhost:17880/api/speech',
      'all devices request the platform speech endpoint'
    )
    check(init?.method === 'POST', 'speech uses the server-side synthesis API')
    requests++
    if (holdRequest)
      return new Promise<Response>((resolve) => {
        deferred = resolve
      })
    if (fetchFailure)
      return new Response(JSON.stringify({ message: '平台缺少中文语音包' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    return response()
  }
  const audioInstances: FakeAudio[] = []
  class FakeAudio {
    src = ''
    preload = ''
    ended = false
    onplaying?: (() => void) | null
    onended?: (() => void) | null
    onerror?: (() => void) | null
    constructor() {
      audioInstances.push(this)
    }
    get currentSrc(): string {
      return this.src
    }
    play(): Promise<void> {
      if (urls.get(this.src)?.size === 1644) {
        primePlays++
        return Promise.resolve()
      }
      plays++
      if (denyAudio) return Promise.reject(new DOMException('Tap required', 'NotAllowedError'))
      this.ended = false
      this.onplaying?.()
      return Promise.resolve()
    }
    pause(): void {
      /* No real speaker in these tests. */
    }
    removeAttribute(): void {
      this.src = ''
    }
    load(): void {
      this.ended = false
    }
    finish(): void {
      this.ended = true
      this.onended?.()
    }
  }
  Object.defineProperty(window, 'Audio', { configurable: true, value: FakeAudio })
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: 'Android System Browser'
  })
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined })
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: undefined
  })
  let completed = 0
  const states: VoicePlaybackState[] = []
  const player = new PlatformSpeechPlayer('http://localhost:17880', (state) => states.push(state))
  player.play('安卓工单', () => completed++, true)
  check(primePlays === 1, 'tap immediately primes ordinary audio without SpeechSynthesis')
  await pause()
  check(states.at(-1)?.status === 'speaking', 'Android uses audio when speech API is absent')
  check(completed === 0, 'request and playback start must not mark completion')
  audioInstances.at(-1)!.finish()
  check(Number(completed) === 1, 'only ended marks completion')
  check(urls.size === 0, 'completed audio releases blob URLs')
  reports.push('PASS: Android without speech API, synchronous tap, actual playback completion')

  denyAudio = true
  player.play('被拦截的工单', () => completed++, true)
  await pause()
  check(states.at(-1)?.status === 'blocked', 'autoplay denial exposes a tap-to-play state')
  const previousRequests = requests
  denyAudio = false
  check(player.resume(), 'prepared audio can resume directly on click')
  check(requests === previousRequests, 'resume reuses audio without another fetch')
  audioInstances.at(-1)!.finish()
  check(Number(completed) === 2, 'resumed playback completes once')
  reports.push('PASS: blocked playback is retained and resumes without regenerating audio')

  holdRequest = true
  player.play('已取消的工单', () => completed++, true)
  const beforeCancel = plays
  player.stop()
  deferred!(response())
  await pause()
  check(plays === beforeCancel && Number(completed) === 2, 'late fetch cannot play after stop')
  holdRequest = false
  fetchFailure = true
  player.play('失败的工单', () => completed++, true)
  await pause()
  check(states.at(-1)?.message.includes('中文语音包'), 'server failure is visible')
  check(Number(completed) === 2, 'failure must not be reported as completed')
  fetchFailure = false
  player.dispose()
  reports.push('PASS: cancellation ignores late responses; synthesis errors do not mark success')

  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Desktop Browser' })
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    get: () => {
      throw new Error('System speech must never be accessed')
    }
  })
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    get: () => {
      throw new Error('System voice must never be constructed')
    }
  })
  const desktopStates: VoicePlaybackState[] = []
  const desktopPlayer = new PlatformSpeechPlayer('http://localhost:17880', (state) =>
    desktopStates.push(state)
  )
  const desktopRequests = requests
  desktopPlayer.play('桌面工单', () => completed++, true)
  await pause()
  check(
    requests === desktopRequests + 1 && desktopStates.at(-1)?.status === 'speaking',
    'desktop always requests platform speech'
  )
  audioInstances.at(-1)!.finish()
  check(Number(completed) === 3, 'desktop cloud audio completes through the media ended event')
  desktopPlayer.play('AI诊断', () => completed++, true)
  await pause()
  const staleEnd = audioInstances.at(-1)!.onended
  const alarmPlayer = new PlatformSpeechPlayer('http://localhost:17880', (state) =>
    states.push(state)
  )
  alarmPlayer.play('设备告警')
  await pause()
  check(
    desktopStates.at(-1)?.status === 'idle',
    'a new platform announcement stops the previous channel'
  )
  staleEnd?.()
  check(Number(completed) === 3, 'interrupted speech cannot report a late completion')
  alarmPlayer.dispose()
  desktopPlayer.dispose()
  reports.push(
    'PASS: desktop always uses platform TTS; shared announcements cancel earlier playback without system speech'
  )

  const root = createRoot(document.getElementById('root')!)
  let speech!: ReturnType<typeof useTaskSpeech>
  const task = (id: string, role: 'A' | 'B' = 'A'): PadTask => ({
    id,
    role,
    workOrderId: id,
    workOrderNumber: id,
    status: 'pending',
    title: '工单',
    content: '检查设备',
    riskPoints: [],
    faultType: '测试',
    checkpointCompleted: false,
    canStart: true,
    canCheckpoint: false,
    canSubmit: false,
    resultSummary: []
  })
  function Harness({ tasks, role = 'A' }: { tasks: PadTask[]; role?: 'A' | 'B' }): null {
    speech = useTaskSpeech(role, tasks, 'http://localhost:17880')
    return null
  }
  localStorage.clear()
  localStorage.setItem('platform-c.voice-enabled', 'true')
  const tasks = [task('one'), task('two')]
  const render = (items: PadTask[], role: 'A' | 'B' = 'A'): void => {
    flushSync(() =>
      root.render(
        <StrictMode>
          <Harness tasks={items} role={role} />
        </StrictMode>
      )
    )
  }
  const requestsBeforeMount = requests
  render(tasks)
  await pause()
  check(
    requests === requestsBeforeMount && !speech.activated,
    'saved preference cannot auto-play a fresh page'
  )
  flushSync(() => speech.enable())
  await pause()
  check(
    !localStorage.getItem('platform-c.spoken-task-ids.A'),
    'pending audio is not persisted as spoken'
  )
  const afterFirstStart = requests
  render([...tasks])
  await pause()
  check(requests === afterFirstStart, 'task refresh does not interrupt active playback')
  audioInstances.at(-1)!.finish()
  await pause()
  check(
    localStorage.getItem('platform-c.spoken-task-ids.A') === '["one"]',
    'first finished task persisted alone'
  )
  check(requests === afterFirstStart + 1, 'second task starts sequentially')
  const lateEnd = audioInstances.at(-1)!.onended
  flushSync(() => speech.disable())
  lateEnd?.()
  await pause()
  check(
    localStorage.getItem('platform-c.spoken-task-ids.A') === '["one"]',
    'interrupted task stays unspoken'
  )
  reports.push(
    'PASS: StrictMode, per-page activation, sequential tasks, refresh deduplication and completion-only persistence'
  )

  fetchFailure = true
  flushSync(() => speech.enable())
  await pause()
  check(speech.status === 'error', 'failed task reports an error')
  const failedRequests = requests
  render([...tasks])
  await pause()
  check(requests === failedRequests, 'failed task cannot trigger an automatic retry loop')
  fetchFailure = false
  flushSync(() => speech.enable())
  await pause()
  audioInstances.at(-1)!.finish()
  await pause()
  check(
    localStorage.getItem('platform-c.spoken-task-ids.A') === '["one","two"]',
    'retry is persisted after success'
  )
  render([task('b-one', 'B')], 'B')
  await pause()
  check(!speech.activated, 'changing role resets active playback')
  flushSync(() => root.unmount())
  check(urls.size === 0, 'unmount releases all media URLs')
  reports.push('PASS: failed tasks remain retryable; role changes and unmount cancel playback')
  return reports
}

declare global {
  interface Window {
    runPadSpeechSmoke: () => Promise<string[]>
  }
}
