import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import Konva from 'konva'
import type { TelemetrySnapshot } from '../src/shared/contracts'
import App from '../src/renderer/src/App'
import { echarts } from '../src/renderer/src/features/monitor/charts/chartRuntime'
import {
  FONT_SIZE_OPTIONS,
  FONT_SIZE_STORAGE_KEY,
  initializeFontSize
} from '../src/renderer/src/settings/fontSize'
import '../src/renderer/src/assets/base.css'
import '../src/renderer/src/assets/global.css'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 120))

function click(label: string): void {
  const button = [...document.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label
  )
  check(button, `Missing button: ${label}`)
  flushSync(() => button.click())
}

function chooseScale(scale: number): void {
  const input = document.querySelector<HTMLInputElement>(
    `input[name="app-font-size"][value="${scale}"]`
  )
  check(input, `Missing font size option: ${scale}`)
  flushSync(() => input.click())
}

function assertScale(scale: number): void {
  const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
  check(
    Math.abs(rootSize - 16 * scale) < 0.01,
    `Root font size: ${rootSize}, expected ${16 * scale}`
  )
  const nav = document.querySelector<HTMLElement>('.nav-item')!
  check(
    Math.abs(parseFloat(getComputedStyle(nav).fontSize) - 17 * scale) < 0.01,
    'Navigation text must scale exactly once'
  )
  check(
    document.querySelector<HTMLElement>('.console-shell')?.offsetWidth === 1680,
    'Font selection must not zoom the entire interface'
  )
}

class TestSocket extends EventTarget {
  close(): void {
    this.dispatchEvent(new Event('close'))
  }
}
Object.defineProperty(window, 'WebSocket', { value: TestSocket })
const telemetry: TelemetrySnapshot = {
  sequence: 1,
  timestamp: new Date().toISOString(),
  collectorMode: 'simulation',
  plcConnected: true,
  devices: [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `pv-${index + 1}`,
      name: `${index + 1}号光伏组串`,
      kind: 'pv-string' as const,
      voltage: 613.4,
      current: 9.42,
      status: 'normal' as const
    })),
    {
      id: 'battery',
      name: '蓄电池组',
      kind: 'battery',
      voltage: 52.6,
      current: 10.5,
      status: 'normal'
    }
  ]
}
window.fetch = async (value) => {
  const url = String(value)
  if (url.endsWith('/api/system-info')) return Response.json({})
  if (url.endsWith('/api/telemetry/latest')) return Response.json(telemetry)
  if (url.includes('/api/work-orders')) return Response.json({ items: [], total: 0 })
  return new Response(null, { status: 503 })
}

initializeFontSize()
const root = createRoot(document.getElementById('root')!)
flushSync(() =>
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
)

async function showFontSizePage(page: string): Promise<void> {
  click(page)
  if (page === '设置中心') click('显示设置')
  await pause()
}

function canvasFontSizes(): number[] {
  return Konva.stages.flatMap((stage) =>
    stage.find('Text').map((node) => (node as Konva.Text).fontSize())
  )
}

function chartFontSizes(): number[] {
  return [...document.querySelectorAll<HTMLElement>('.echart-canvas')].map((element) => {
    const option = echarts.getInstanceByDom(element)?.getOption() as {
      yAxis: { axisLabel: { fontSize: number } }[]
    }
    return option.yAxis[0].axisLabel.fontSize
  })
}

async function runFontSizeSmoke(reloaded = false): Promise<string[]> {
  const reports: string[] = []
  assertScale(reloaded ? 1.3 : 1)
  await showFontSizePage('设置中心')
  if (reloaded) {
    check(
      document.querySelector<HTMLInputElement>('input[value="1.3"]')?.checked,
      'Saved setting must survive a renderer restart'
    )
    for (const invalid of ['broken-json', '-1', '10', 'null', '"1.3"']) {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, invalid)
      window.dispatchEvent(
        new StorageEvent('storage', { key: FONT_SIZE_STORAGE_KEY, storageArea: localStorage })
      )
      await pause()
      assertScale(1)
    }
    reports.push('PASS: restart persistence and invalid stored values fall back safely')
    const originalSetItem = Storage.prototype.setItem
    try {
      Storage.prototype.setItem = () => {
        throw new DOMException('Storage unavailable', 'QuotaExceededError')
      }
      chooseScale(1.2)
      assertScale(1.2)
      check(
        document.querySelector('[role="status"]')?.textContent?.includes('保存失败'),
        'Storage failure must be visible without blocking font changes'
      )
    } finally {
      Storage.prototype.setItem = originalSetItem
    }
    click('恢复默认字号')
    assertScale(1)
    check(localStorage.getItem(FONT_SIZE_STORAGE_KEY) === '1', 'Reset must persist the default')
    chooseScale(1.3)
    localStorage.removeItem(FONT_SIZE_STORAGE_KEY)
    window.dispatchEvent(
      new StorageEvent('storage', { key: FONT_SIZE_STORAGE_KEY, storageArea: localStorage })
    )
    await pause()
    assertScale(1)
    reports.push('PASS: reset, storage deletion and unavailable storage')
    return reports
  }

  for (const { scale } of FONT_SIZE_OPTIONS) {
    chooseScale(scale)
    assertScale(scale)
    getFontSizeLayout()
    check(
      localStorage.getItem(FONT_SIZE_STORAGE_KEY) === String(scale),
      'Every option must persist immediately'
    )
  }
  reports.push('PASS: all five font sizes preserve the page dimensions and keep the header visible')
  chooseScale(1)
  await showFontSizePage('综合监控')
  const standardCanvas = canvasFontSizes()
  const standardCharts = chartFontSizes()
  check(
    standardCanvas.length > 15 && standardCharts.length === 2,
    'Real canvas and both charts must be rendered'
  )
  await showFontSizePage('设置中心')
  chooseScale(1.3)
  await showFontSizePage('综合监控')
  const largeCanvas = canvasFontSizes()
  const largeCharts = chartFontSizes()
  check(largeCanvas.length === standardCanvas.length, 'Canvas labels must remain present')
  standardCanvas.forEach((size, index) =>
    check(
      Math.abs(largeCanvas[index] - size * 1.3) < 0.01,
      'Energy diagram text must follow the chosen scale'
    )
  )
  standardCharts.forEach((size, index) =>
    check(
      Math.abs(largeCharts[index] - size * 1.3) < 0.01,
      'Chart labels must follow the chosen scale'
    )
  )
  reports.push('PASS: canvas labels and both chart axes scale with the global setting')
  await showFontSizePage('设置中心')
  check(
    document.querySelector<HTMLInputElement>('input[value="1.3"]')?.checked,
    'Selection must survive navigating between pages'
  )
  return reports
}

function getFontSizeLayout(): unknown {
  const selectors = [
    '.console-header',
    '.brand-block',
    '.console-header nav',
    '.header-status',
    '.metric-card',
    '.metric-reading',
    '.chart-heading',
    '.chart-legend',
    '.font-size-option'
  ]
  const layout = selectors.flatMap((selector) =>
    [...document.querySelectorAll<HTMLElement>(selector)].map((element) => ({
      selector,
      text: element.textContent,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }))
  )
  for (const item of layout) {
    check(
      item.scrollWidth <= item.clientWidth + 1,
      `${item.selector} must not overflow horizontally`
    )
    check(
      item.scrollHeight <= item.clientHeight + 1,
      `${item.selector} must not clip text vertically (${item.scrollHeight} > ${item.clientHeight})`
    )
  }
  for (const button of document.querySelectorAll('.nav-item')) {
    check(
      getComputedStyle(button).whiteSpace === 'nowrap',
      'Navigation labels must stay on one line'
    )
  }
  const header = document.querySelector<HTMLElement>('.console-header')!
  const headerBounds = header.getBoundingClientRect()
  for (const element of header.querySelectorAll<HTMLElement>(
    'h1, .brand-block > span, nav, time'
  )) {
    const bounds = element.getBoundingClientRect()
    check(
      bounds.left >= headerBounds.left - 1 &&
        bounds.right <= headerBounds.right + 1 &&
        bounds.top >= headerBounds.top - 1 &&
        bounds.bottom <= headerBounds.bottom + 1,
      `Header content must be fully visible: ${element.textContent}`
    )
  }
  const titleBounds = header.querySelector('h1')!.getBoundingClientRect()
  const navBounds = header.querySelector('nav')!.getBoundingClientRect()
  const statusBounds = header.querySelector('.header-status')!.getBoundingClientRect()
  check(titleBounds.right <= navBounds.left + 1, 'Platform title must not overlap navigation')
  check(navBounds.right <= statusBounds.left + 1, 'Navigation must not overlap status and clock')
  return layout
}

Object.assign(window, { runFontSizeSmoke, showFontSizePage, getFontSizeLayout })
