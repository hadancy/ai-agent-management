import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import RiskAlarmDialog from '../src/renderer/src/features/monitor/alerts/RiskAlarmDialog'
import { detectDeviceRisk } from '../src/renderer/src/features/monitor/alerts/riskDetection'
import { DEFAULT_PHOTOVOLTAIC_SETTINGS } from '../src/renderer/src/features/monitor/settings/photovoltaicSettings'
import type { DeviceRiskAlarm, ForecastRisk } from '../src/renderer/src/features/monitor/types'
import '../src/renderer/src/assets/base.css'
import '../src/renderer/src/assets/global.css'

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function runRiskAlarmSmoke(): Promise<string[]> {
  const reports: string[] = []
  const settings = DEFAULT_PHOTOVOLTAIC_SETTINGS
  const normal = { name: '1号光伏组串', voltage: 613, current: 9.4 }
  const abnormal = { ...normal, voltage: 500 }
  const prediction: ForecastRisk = {
    deviceId: 'pv1',
    deviceName: '1号光伏组件',
    riskDate: '2026-09-10',
    riskDateLabel: '09-10',
    riskValue: 79,
    projectedVoltage: 480,
    projectedCurrent: 7.5,
    monthEndValue: 70,
    monthEndVoltage: 420,
    monthEndCurrent: 6.5
  }
  const realtime = detectDeviceRisk([abnormal], settings, null)
  const combined = detectDeviceRisk([abnormal], settings, prediction)
  const predicted = detectDeviceRisk([normal], settings, prediction)
  const updated = detectDeviceRisk([abnormal], settings, {
    ...prediction,
    riskDate: '2026-09-11'
  })
  check(detectDeviceRisk([normal], settings, null) === null, 'Normal data must clear the alarm')
  check(realtime && combined && predicted && updated, 'Either rule must trigger an alarm')
  check(combined.devices.length === 1, 'Both sources for the same device must be merged')
  check(
    combined.devices[0].realtime && combined.devices[0].prediction,
    'Keep both sets of evidence'
  )
  reports.push('PASS: either rule triggers; normal data clears; same-device evidence is merged')

  const spoken: string[] = []
  let canceled = 0
  class TestUtterance {
    onstart?: () => void
    constructor(public text: string) {}
  }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: TestUtterance })
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      getVoices: () => [],
      cancel: () => canceled++,
      speak: (utterance: TestUtterance) => {
        spoken.push(utterance.text)
        utterance.onstart?.()
      }
    }
  })

  const root = createRoot(document.getElementById('root')!)
  let currentAlarm: DeviceRiskAlarm | null = null
  function render(alarm: DeviceRiskAlarm | null, open = true): void {
    currentAlarm = alarm
    flushSync(() =>
      root.render(
        <StrictMode>
          <RiskAlarmDialog alarm={alarm} open={open} onClose={() => render(currentAlarm, false)} />
        </StrictMode>
      )
    )
  }
  function clickButton(label: string): void {
    const button = Array.from(document.querySelectorAll('button')).find(
      (element) => element.textContent === label || element.getAttribute('aria-label') === label
    )
    check(button, `Missing button: ${label}`)
    button.click()
  }

  render(realtime)
  await pause(150)
  render(combined)
  await pause(100)
  render(updated)
  await pause(200)
  check(spoken.length === 1, 'Data refreshes must not delay or duplicate the first announcement')
  check(document.querySelectorAll('[role="alertdialog"]').length === 1, 'Show one dialog')
  check(document.body.textContent?.includes('实时电压'), 'Show actual measurements')
  check(document.body.textContent?.includes('风险日电压'), 'Show forecast measurements')
  for (const alarm of [predicted, realtime, combined, updated]) {
    render(alarm)
    await pause(400)
  }
  check(spoken.length === 1, 'Source switches and changed forecast dates must not repeat speech')
  reports.push('PASS: StrictMode, rapid updates, source switches and date changes speak once')

  clickButton('关闭报警')
  await pause(0)
  check(!document.querySelector('[role="alertdialog"]'), 'Closing must hide the dialog')
  check(canceled === 1, 'Closing must stop the current announcement')
  render(updated)
  await pause(400)
  check(spoken.length === 1, 'Reopening an ongoing alarm must not repeat speech')
  clickButton('重新播报')
  check(Number(spoken.length) === 2, 'Explicit replay must still work')
  reports.push('PASS: closing and reopening remain silent; explicit replay works')

  render(null)
  check(!document.querySelector('[role="alertdialog"]'), 'Recovery must remove the dialog')
  render(combined)
  await pause(400)
  check(Number(spoken.length) === 3, 'A new incident after recovery must announce again')
  render(null)
  render(combined)
  clickButton('重新播报')
  await pause(400)
  check(
    Number(spoken.length) === 4,
    'Early manual replay must consume the pending auto announcement'
  )
  reports.push('PASS: recovery re-arms speech; early manual replay does not double-announce')

  const multiple = detectDeviceRisk(
    Array.from({ length: 4 }, (_, index) => ({
      ...abnormal,
      name: `${index + 1}号光伏组串`
    })),
    settings,
    { ...prediction, deviceId: 'battery', deviceName: '蓄电池组' }
  )
  check(multiple?.devices.length === 5, 'Different devices must all remain visible in one alarm')
  render(multiple)
  await pause(50)
  const dialog = document.querySelector('[role="alertdialog"]')!.getBoundingClientRect()
  const details = document.querySelector('.forecast-alert__devices')!
  const footer = document.querySelector('.forecast-alert__actions')!.getBoundingClientRect()
  check(dialog.top >= 0 && dialog.bottom <= innerHeight, 'Dialog must fit the viewport')
  check(details.scrollHeight > details.clientHeight, 'Long device details must scroll')
  check(footer.bottom <= innerHeight, 'Action button must remain visible')
  reports.push('PASS: multiple devices share one alarm; details scroll and actions stay visible')

  Object.assign(window, {
    cleanupRiskAlarmSmoke: () => {
      const before = canceled
      root.unmount()
      check(canceled === before + 1, 'Unmounting must stop the active announcement')
      return 'PASS: unmount cancels pending speech'
    }
  })
  return reports
}

Object.assign(window, { runRiskAlarmSmoke })
