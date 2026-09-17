import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import Konva from 'konva'
import EnergyFlowCanvas from '../src/renderer/src/features/monitor/energy/EnergyFlowCanvas'
import { initializeFontSize, saveFontScale } from '../src/renderer/src/settings/fontSize'
import '../src/renderer/src/assets/base.css'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
const pause = (ms = 80): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const root = createRoot(document.getElementById('root')!)
initializeFontSize()
let mount = 0
let denied = false
let failRequest = false
let holdRequest = false
const requests: Array<{ text: string; signal?: AbortSignal | null }> = []
const blobs = new Map<string, Blob>()
let blobId = 0
URL.createObjectURL = (blob) => {
  const url = `blob:energy-test-${blobId++}`
  blobs.set(url, blob)
  return url
}
URL.revokeObjectURL = (url) => {
  blobs.delete(url)
}
const players: TestAudio[] = []
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
    if (blobs.get(this.src)?.size === 1644) return Promise.resolve()
    if (denied) return Promise.reject(new DOMException('Click required', 'NotAllowedError'))
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
for (const property of ['speechSynthesis', 'SpeechSynthesisUtterance']) {
  Object.defineProperty(window, property, {
    get: () => {
      throw new Error(`System speech must not be used: ${property}`)
    }
  })
}
window.fetch = async (input, init) => {
  check(String(input).endsWith('/api/speech'), `Unexpected request: ${input}`)
  requests.push({ text: JSON.parse(String(init?.body)).text, signal: init?.signal })
  if (holdRequest) {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true }
      )
    })
  }
  if (failRequest)
    return new Response(JSON.stringify({ message: '语音服务暂不可用' }), { status: 503 })
  return new Response(new Uint8Array([82, 73, 70, 70]), {
    headers: { 'Content-Type': 'audio/wav', 'X-Speech-Provider': 'offline' }
  })
}

async function render(remount = false): Promise<void> {
  if (remount) mount++
  flushSync(() =>
    root.render(
      <StrictMode>
        <div style={{ width: '100vw', height: '100vh', background: '#061425', display: 'grid' }}>
          <EnergyFlowCanvas
            key={mount}
            telemetry={{
              sequence: 1,
              timestamp: new Date().toISOString(),
              collectorMode: 'simulation',
              plcConnected: true,
              powers: {
                photovoltaicPower: 12,
                storageRatedPower: 6,
                primaryLoadPower: 3,
                secondaryLoadPower: 5,
                tertiaryLoadPower: 4,
                totalLoadPower: 12,
                renewableSupplyPower: 18
              },
              devices: [
                ...[1, 2, 3, 4].map((index) => ({
                  id: `pv-${index}`,
                  name: `光伏${index}`,
                  kind: 'pv-string' as const,
                  voltage: 60,
                  current: 50,
                  status: 'normal' as const
                })),
                {
                  id: 'battery-1',
                  name: '储能',
                  kind: 'battery',
                  voltage: 52,
                  current: 10,
                  status: 'normal'
                }
              ]
            }}
          />
        </div>
      </StrictMode>
    )
  )
  await pause()
}
function button(selector: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(selector)
  check(element, `Missing button ${selector}`)
  return element
}
function click(selector: string): void {
  flushSync(() => button(selector).click())
}
function texts(): string[] {
  return Konva.stages.flatMap((stage) => stage.find<Konva.Text>('Text').map((node) => node.text()))
}
function highlight(mode: string): boolean {
  return Konva.stages.some(
    (stage) => stage.find(`.energy-efficiency-highlight--${mode}`).length === 1
  )
}
async function upgrade(): Promise<void> {
  click('.energy-upgrade-button')
  await pause(1550)
}

async function runEnergyArchitectureSmoke(): Promise<string[]> {
  const reports: string[] = []
  const sharedDevices = [
    '电网',
    '电网通信接口',
    ...[1, 2, 3, 4].map((index) => `光伏组串 ${index}`),
    '储能系统',
    '一级负载',
    '二级负载',
    '三级负载'
  ]
  const traditionalLabels = ['变压器', '并网逆变器', '双向变流器', '交流灯', '交流风扇', '交流电机']
  const directLabels = ['双向变流器', '光伏变换器', '储能变换器', '直流灯', '直流风扇', '直流电机']
  const hasWire = (points: number[]): boolean =>
    Konva.stages.some((stage) =>
      stage
        .find<Konva.Line>('Line')
        .some((line) => JSON.stringify(line.points()) === JSON.stringify(points))
    )
  const deviceLayout = (): string =>
    JSON.stringify(
      Konva.stages.flatMap((stage) =>
        stage
          .find<Konva.Text>('Text')
          .filter((node) => sharedDevices.includes(node.text()))
          .map((node) => ({ text: node.text(), ...node.getAbsolutePosition() }))
      )
    )
  await render(true)
  check(
    document.querySelector('h2')?.textContent === '传统交流模式架构图',
    'Default title must be traditional'
  )
  for (const label of [
    '交流母线',
    'DC → AC',
    'AC/DC 充放电',
    '负载侧 AC / DC',
    ...sharedDevices,
    ...traditionalLabels
  ]) {
    check(texts().includes(label), `Missing traditional device ${label}`)
  }
  check(!texts().includes('直流母线'), 'Traditional mode must use the AC bus')
  for (const removed of [
    '直流灯',
    '直流风扇',
    '直流电机',
    '光伏变换器',
    '储能变换器',
    '充电桩',
    '交流负载',
    '空调 / 动力设备',
    '电源转换器或驱动电源',
    '照明 / 电子设备'
  ])
    check(!texts().some((text) => text.includes(removed)), `Unexpected device ${removed}`)
  const traditionalDevices = deviceLayout()
  const traditionalPowers = texts().filter((text) => text.includes('MW'))
  check(
    [
      '0.5 MW',
      '1.5 MW',
      '3 MW',
      '总功率 5 MW',
      '1 MW',
      '满载 1 MW',
      '新能源供电 6 MW',
      '负载总功率 5 MW'
    ].every((value) => traditionalPowers.includes(value)) && traditionalPowers.length === 8,
    'Traditional mode must show the annotated fixed powers without string-level readings'
  )
  check(
    Konva.stages.some((stage) => stage.find('.energy-transformer-icon').length === 1),
    'Traditional mode must show a transformer icon'
  )
  check(
    !texts().includes('放电') &&
      !hasWire([876, 204, 876, 258]) &&
      !hasWire([880, 340, 880, 390]) &&
      !hasWire([880, 390, 880, 400]),
    'Traditional mode must remove both crossed-out discharge connections'
  )
  check(
    hasWire([900, 258, 900, 204]) && hasWire([896, 400, 896, 340]),
    'Traditional mode must preserve the charging path'
  )
  check(requests.length === 0, 'Mount must not speak automatically')
  click('.energy-efficiency-button')
  await pause()
  check(highlight('traditional'), 'Traditional conversion region must highlight')
  check(
    document.querySelector('.energy-efficiency-callout')?.textContent === '综合效率91.2%',
    'Traditional percentage must be visible'
  )
  check(
    requests.at(-1)?.text ===
      '经过逆变器、交流配电、负载侧AC/DC变换后，综合效率约为91.2%，此部分建议优化',
    'Traditional narration must match the request'
  )
  check(players.filter((player) => player.active).length === 1, 'Platform audio must start')
  const previousCallout = document.querySelector('.energy-efficiency-callout')
  const beforeClose = requests.length
  click('.energy-efficiency-button')
  await pause()
  check(
    !document.querySelector('.energy-efficiency-callout') &&
      !highlight('traditional') &&
      button('.energy-efficiency-button').getAttribute('aria-pressed') === 'false' &&
      !players.some((player) => player.active) &&
      requests.length === beforeClose,
    'Second click must stop narration and hide emphasis without requesting new speech'
  )
  click('.energy-efficiency-button')
  await pause()
  check(
    highlight('traditional') &&
      previousCallout !== document.querySelector('.energy-efficiency-callout') &&
      button('.energy-efficiency-button').getAttribute('aria-pressed') === 'true' &&
      requests.length === beforeClose + 1 &&
      players.filter((player) => player.active).length === 1,
    'Third click must show emphasis and restart exactly one narration'
  )
  const currentPlayer = players.find((player) => player.active)!
  flushSync(() => {
    currentPlayer.active = false
    currentPlayer.ended = true
    currentPlayer.onended?.()
  })
  const afterCompleted = requests.length
  click('.energy-efficiency-button')
  check(
    !highlight('traditional') && requests.length === afterCompleted,
    'Clicking after narration completes must still toggle off'
  )
  click('.energy-efficiency-button')
  await pause()
  reports.push(
    'PASS: traditional topology, exact 91.2% narration and repeated on/off cycles during and after playback'
  )

  click('.energy-upgrade-button')
  check(
    button('.energy-upgrade-button').disabled && button('.energy-efficiency-button').disabled,
    'Upgrade must prevent duplicate actions'
  )
  check(document.querySelector('.energy-upgrade-overlay'), 'Upgrade animation must be visible')
  check(
    document.querySelector('h2')?.textContent === '传统交流模式架构图',
    'Title must wait until transition completes'
  )
  check(!document.querySelector('.energy-efficiency-callout'), 'Upgrade must remove old efficiency')
  check(!players.some((player) => player.active), 'Upgrade must stop the old narration')
  await pause(1550)
  check(
    document.querySelector('h2')?.textContent === '光储直柔模式架构图',
    'Upgrade must change the title'
  )
  check(
    !document.querySelector('.energy-upgrade-overlay') &&
      !button('.energy-upgrade-button').disabled &&
      button('.energy-upgrade-button').textContent?.includes('还原架构'),
    'Upgrade must leave an enabled button to switch back'
  )
  for (const label of ['直流母线', 'DC → DC', 'DC/DC 充放电', ...sharedDevices, ...directLabels])
    check(texts().includes(label), `Missing direct device ${label}`)
  check(
    !texts().includes('交流母线') && !texts().includes('负载侧 AC / DC'),
    'Upgrade must replace the AC conversion path'
  )
  check(
    deviceLayout() === traditionalDevices,
    'Upgrade must preserve the same device labels and positions'
  )
  check(
    [
      '0.00052 MW',
      '3 MW',
      '5 MW',
      '4 MW',
      '12 MW',
      '满载 1 MW',
      '新能源供电 11.99948 MW',
      '负载总功率 12 MW'
    ].every((value) => texts().includes(value)),
    'Direct mode must return to telemetry powers and totals'
  )
  check(
    Konva.stages.every((stage) =>
      stage
        .find<Konva.Group>('.energy-solar-node')
        .every((node) => node.find<Konva.Text>('Text').every((text) => !text.text().includes('MW')))
    ),
    'Direct mode must also hide the crossed-out PV string powers'
  )
  check(
    Konva.stages.some((stage) =>
      stage
        .find<Konva.Text>('.energy-photovoltaic-power')
        .some(
          (node) => node.text() === '12 MW' && node.fontStyle() === 'bold' && node.fontSize() === 14
        )
    ),
    'Direct photovoltaic power must be emphasized like the storage reading'
  )
  for (const points of [
    [169, 140, 111, 140],
    [152, 238, 152, 223, 211, 223, 211, 187],
    [152, 400, 152, 320]
  ])
    check(hasWire(points), 'Direct mode must show the complete reverse grid path')
  check(
    texts().includes('放电') &&
      hasWire([876, 204, 876, 258]) &&
      hasWire([880, 340, 880, 390]) &&
      hasWire([880, 390, 880, 400]),
    'Direct mode must retain storage discharge connections'
  )
  check(
    !texts().includes('变压器') &&
      Konva.stages.every((stage) => stage.find('.energy-transformer-icon').length === 0),
    'Direct mode must retain its converter cabinet'
  )
  reports.push(
    'PASS: annotated traditional devices, fractional powers and charge-only path; direct telemetry and bidirectional storage preserved'
  )
  check(
    document.activeElement === button('.energy-upgrade-button'),
    'Focus must return to the architecture button after switching'
  )
  click('.energy-efficiency-button')
  await pause()
  check(
    highlight('direct') && !highlight('traditional'),
    'Only the direct path may remain highlighted'
  )
  check(
    document.querySelector('.energy-efficiency-callout')?.textContent === '综合变换效率约97%',
    'Direct percentage must be visible'
  )
  check(
    requests.at(-1)?.text ===
      '光伏直流电经DC/DC变换直接供给直流负载，综合变换效率约为97%，较传统模式提升约5~6个百分点',
    'Direct narration must match the request'
  )
  reports.push(
    'PASS: animated upgrade, input locking, audio cancellation and exact 97% direct-mode narration'
  )

  click('.energy-upgrade-button')
  check(
    document
      .querySelector('.energy-upgrade-overlay')
      ?.textContent?.includes('正在切换为传统交流模式') &&
      document
        .querySelector('.energy-upgrade-overlay')
        ?.textContent?.includes('直流直供 → 交流配电'),
    'Reverse transition must describe the traditional destination'
  )
  check(
    button('.energy-upgrade-button').disabled && button('.energy-efficiency-button').disabled,
    'Reverse transition must prevent duplicate actions'
  )
  click('.energy-upgrade-button')
  check(
    !document.querySelector('.energy-efficiency-callout') &&
      !highlight('direct') &&
      !players.some((player) => player.active),
    'Switching back must clear direct-mode emphasis and narration'
  )
  await pause(1550)
  check(
    document.querySelector('h2')?.textContent === '传统交流模式架构图' &&
      texts().includes('交流母线') &&
      !texts().includes('直流母线') &&
      button('.energy-upgrade-button').textContent?.includes('更新架构'),
    'Switching back must restore the traditional diagram and forward action'
  )
  check(deviceLayout() === traditionalDevices, 'Switching back must preserve all devices')
  check(
    JSON.stringify(texts().filter((text) => text.includes('MW'))) ===
      JSON.stringify(traditionalPowers),
    'Switching back must restore fixed example powers'
  )
  check(
    document.activeElement === button('.energy-upgrade-button'),
    'Reverse transition must restore keyboard focus'
  )
  click('.energy-efficiency-button')
  await pause()
  check(
    highlight('traditional') &&
      document.querySelector('.energy-efficiency-callout')?.textContent === '综合效率91.2%' &&
      requests.at(-1)?.text.includes('91.2%'),
    'Restored traditional mode must use its own efficiency and narration'
  )
  await upgrade()
  check(
    document.querySelector('h2')?.textContent === '光储直柔模式架构图' &&
      !players.some((player) => player.active) &&
      !document.querySelector('.energy-efficiency-callout'),
    'The architecture button must support repeated round trips'
  )
  reports.push(
    'PASS: reversible architecture switching, input locking, focus and matching efficiency narration'
  )

  denied = true
  click('.energy-efficiency-button')
  await pause()
  check(
    button('.energy-efficiency-button').title.includes('语音播放被拦截'),
    'Blocked playback must explain how to retry'
  )
  const beforeRetry = requests.length
  click('.energy-efficiency-button')
  check(
    !highlight('direct') && requests.length === beforeRetry && blobs.size === 0,
    'Blocked playback must toggle off and release prepared audio'
  )
  denied = false
  click('.energy-efficiency-button')
  await pause()
  check(
    requests.length === beforeRetry + 1 && players.some((player) => player.active),
    'Toggling on again must retry playback'
  )
  failRequest = true
  click('.energy-efficiency-button')
  check(
    !highlight('direct') && !players.some((player) => player.active),
    'Direct mode must also toggle off'
  )
  click('.energy-efficiency-button')
  await pause()
  check(
    button('.energy-efficiency-button').title.includes('语音服务暂不可用'),
    'Speech failure must be available in the button tooltip'
  )
  failRequest = false
  click('.energy-efficiency-button')
  check(!highlight('direct'), 'Failed playback must toggle off')
  click('.energy-efficiency-button')
  await pause()
  check(
    players.some((player) => player.active),
    'Speech retry must work'
  )
  button('.energy-efficiency-button').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  )
  await pause()
  check(
    !document.querySelector('.energy-efficiency-explanation') && !highlight('direct'),
    'Escape must close the highlight without displaying an explanation panel'
  )
  check(!players.some((player) => player.active), 'Closing must stop playback')
  reports.push(
    'PASS: direct-mode toggling, blocked/failed playback retry, error tooltip and keyboard dismissal'
  )

  await render(true)
  holdRequest = true
  click('.energy-efficiency-button')
  await pause()
  const canceled = requests.at(-1)
  click('.energy-efficiency-button')
  check(
    canceled?.signal?.aborted && !highlight('traditional'),
    'Toggling off must cancel pending speech generation and hide emphasis'
  )
  click('.energy-efficiency-button')
  await pause()
  const pending = requests.at(-1)
  click('.energy-upgrade-button')
  check(pending?.signal?.aborted, 'Upgrade must cancel pending speech generation')
  await render(true)
  holdRequest = false
  await pause(1550)
  check(
    document.querySelector('h2')?.textContent === '传统交流模式架构图',
    'An unmounted upgrade timer must not change a new diagram'
  )
  click('.energy-efficiency-button')
  await pause()
  flushSync(() => root.render(null))
  check(
    !players.some((player) => player.active) && blobs.size === 0,
    'Unmount must release audio and object URLs'
  )
  reports.push(
    'PASS: pending speech abort, upgrade timer cleanup and audio disposal under StrictMode'
  )
  return reports
}

function checkLayout(): void {
  const panel = document.querySelector('.energy-panel')!.getBoundingClientRect()
  for (const selector of [
    '.energy-efficiency-callout',
    '.energy-footer__actions',
    '.energy-heading__title',
    '.energy-legend'
  ]) {
    const element = document.querySelector<HTMLElement>(selector)
    if (!element) continue
    const box = element.getBoundingClientRect()
    check(
      box.left >= panel.left - 1 &&
        box.right <= panel.right + 1 &&
        box.top >= panel.top - 1 &&
        box.bottom <= panel.bottom + 1,
      `${selector} must remain in the panel`
    )
    check(element.scrollWidth <= element.clientWidth + 1, `${selector} must not overflow`)
  }
  for (const stage of Konva.stages) {
    for (const node of stage.find<Konva.Text>('Text')) {
      for (const line of node.text().split('\n')) {
        check(node.measureSize(line).width <= node.width() + 1, `Label wraps: ${node.text()}`)
      }
    }
  }
  const callout = document.querySelector('.energy-efficiency-callout')?.getBoundingClientRect()
  if (callout) {
    for (const stage of Konva.stages) {
      const canvas = stage.container().getBoundingClientRect()
      for (const node of stage.find<Konva.Text>('Text')) {
        const box = node.getClientRect()
        const overlaps =
          callout.left < canvas.left + box.x + box.width &&
          callout.right > canvas.left + box.x &&
          callout.top < canvas.top + box.y + box.height &&
          callout.bottom > canvas.top + box.y
        check(!overlaps, `Efficiency callout must not obscure ${node.text()}`)
      }
    }
  }
}

async function showEnergyArchitecture(
  mode: 'traditional' | 'direct' | 'upgrading',
  highlighted: boolean,
  scale = 1
): Promise<void> {
  denied = false
  failRequest = false
  holdRequest = false
  flushSync(() => saveFontScale(scale))
  await render(true)
  if (mode === 'direct') await upgrade()
  if (highlighted) click('.energy-efficiency-button')
  await pause(550)
  if (mode === 'upgrading') {
    click('.energy-upgrade-button')
    await pause(100)
  } else checkLayout()
}
Object.assign(window, { runEnergyArchitectureSmoke, showEnergyArchitecture })
