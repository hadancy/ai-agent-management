import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import Konva from 'konva'
import type { TelemetrySnapshot } from '../src/shared/contracts'
import EnergyFlowCanvas from '../src/renderer/src/features/monitor/energy/EnergyFlowCanvas'
import { getEnergyPowerReadings } from '../src/renderer/src/features/monitor/energy/powerReadings'
import { initializeFontSize, saveFontScale } from '../src/renderer/src/settings/fontSize'
import '../src/renderer/src/assets/base.css'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const snapshot: TelemetrySnapshot = {
  sequence: 1,
  timestamp: new Date().toISOString(),
  collectorMode: 'plc-tcp',
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
    ...[
      [60, 50],
      [50, 50],
      [60, 60],
      [58, 50]
    ].map(([voltage, current], index) => ({
      id: `pv-${index + 1}`,
      name: `光伏${index + 1}`,
      kind: 'pv-string' as const,
      voltage,
      current,
      status: 'normal' as const
    })),
    {
      id: 'battery-1',
      name: '储能',
      kind: 'battery',
      voltage: 52,
      current: 6000 / 52,
      status: 'normal'
    }
  ]
}
const root = createRoot(document.getElementById('root')!)
initializeFontSize()
const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100))

async function render(
  data: TelemetrySnapshot | undefined = snapshot,
  online = true
): Promise<void> {
  flushSync(() =>
    root.render(
      <div style={{ width: '100vw', height: '100vh', background: '#061425', display: 'grid' }}>
        <EnergyFlowCanvas telemetry={data} online={online} />
      </div>
    )
  )
  await pause()
}

function texts(): string[] {
  return Konva.stages.flatMap((stage) => stage.find<Konva.Text>('Text').map((node) => node.text()))
}

function livePowerTexts(): string[] {
  return Konva.stages.flatMap((stage) =>
    stage.find<Konva.Text>('.energy-power').map((node) => node.text())
  )
}

function checkDirections(
  storage: 'charge' | 'discharge' | 'idle',
  grid: 'import' | 'export' | 'idle'
): void {
  const paths = {
    charge: [
      [900, 258, 900, 204],
      [896, 400, 896, 340]
    ],
    discharge: [
      [876, 204, 876, 258],
      [880, 340, 880, 390],
      [880, 390, 880, 400]
    ],
    import: [
      [111, 128, 169, 128],
      [199, 187, 199, 211, 140, 211, 140, 238],
      [140, 320, 140, 400]
    ],
    export: [
      [169, 140, 111, 140],
      [152, 238, 152, 223, 211, 223, 211, 187],
      [152, 400, 152, 320]
    ]
  }
  for (const [direction, wires] of Object.entries(paths)) {
    const active = direction === storage || direction === grid
    for (const points of wires) {
      const matches = (node: Konva.Line): boolean =>
        JSON.stringify(node.points()) === JSON.stringify(points)
      check(
        Konva.stages.some((stage) => stage.find<Konva.Line>('Line').some(matches)),
        `Missing ${direction} wire`
      )
      check(
        Konva.stages.some((stage) => stage.find<Konva.Line>('.energy-flow-dash').some(matches)) ===
          active,
        `${direction} animation must be ${active ? 'active' : 'inactive'}`
      )
      if (!active)
        check(
          Konva.stages.some((stage) =>
            stage
              .find<Konva.Line>('Line')
              .some((node) => matches(node) && node.stroke() === '#697783')
          ),
          `Inactive ${direction} wire must be gray`
        )
    }
  }
}

async function runEnergyPowerSmoke(): Promise<string[]> {
  await render()
  const switchMode = async (): Promise<void> => {
    flushSync(() => document.querySelector<HTMLButtonElement>('.energy-upgrade-button')!.click())
    await new Promise((resolve) => setTimeout(resolve, 1550))
  }
  if (document.querySelector('.energy-panel')?.getAttribute('data-architecture') === 'direct')
    await switchMode()
  const fixedPowers = [
    '0.5 MW',
    '1.5 MW',
    '3 MW',
    '总功率 5 MW',
    '1 MW',
    '满载 1 MW',
    '新能源供电 6 MW',
    '负载总功率 5 MW'
  ]
  const checkFixedPowers = (): void => {
    const rendered = texts().filter((text) => text.includes('MW'))
    check(
      rendered.length === fixedPowers.length &&
        fixedPowers.every((value) => rendered.includes(value)),
      'Traditional example powers must stay fixed and hide individual PV powers'
    )
  }
  checkFixedPowers()
  await render({ ...snapshot, powers: undefined, devices: [], plcConnected: false }, false)
  checkFixedPowers()
  await switchMode()
  check(
    livePowerTexts().every((text) => text.includes('— MW')) && texts().includes('满载 1 MW'),
    'Switching to direct mode while offline must not retain example powers'
  )
  await render()
  const initial = texts()
  for (const value of [
    '0.006 MW',
    '满载 1 MW',
    '3 MW',
    '5 MW',
    '4 MW',
    '12 MW',
    '新能源供电 11.994 MW',
    '负载总功率 12 MW'
  ])
    check(initial.includes(value), `Missing initial power ${value}`)
  checkDirections('charge', 'import')
  check(
    !initial.some((text) => ['3.000 MW', '2.500 MW', '3.600 MW', '2.900 MW'].includes(text)),
    'Direct mode must hide individual PV powers'
  )
  const readings = getEnergyPowerReadings({ ...snapshot, devices: [...snapshot.devices].reverse() })
  check(
    JSON.stringify(readings.photovoltaic) === '[0.003,0.0025,0.0036,0.0029]',
    'PV readings must follow device IDs, not arrival order'
  )
  const updated: TelemetrySnapshot = {
    ...snapshot,
    sequence: 2,
    powers: {
      ...snapshot.powers!,
      photovoltaicPower: 65535,
      storageRatedPower: 65535,
      primaryLoadPower: 0,
      secondaryLoadPower: 65535,
      totalLoadPower: 18
    },
    devices: snapshot.devices.map((device) => ({
      ...device,
      current: device.kind === 'battery' ? -10 : device.current
    }))
  }
  await render(updated)
  check(texts().includes('0 MW'), 'Valid zero power must remain zero')
  check(
    texts().includes('65535 MW') &&
      texts().includes('新能源供电 65535.00052 MW') &&
      texts().includes('负载总功率 18 MW'),
    'UInt upper boundary must not be signed or scaled'
  )
  check(texts().includes('-0.00052 MW'), 'V × A must convert to MW and retain the PLC sign')
  check(
    texts().includes('满载 1 MW'),
    'Storage rating must stay fixed at 1 MW despite PLC rated power updates'
  )
  checkDirections('discharge', 'export')
  const changed: TelemetrySnapshot = {
    ...snapshot,
    powers: {
      ...snapshot.powers!,
      photovoltaicPower: 5,
      primaryLoadPower: 1,
      secondaryLoadPower: 2,
      tertiaryLoadPower: 3,
      totalLoadPower: 6
    },
    devices: snapshot.devices.map((device) =>
      device.kind === 'battery' ? { ...device, voltage: 1000, current: 1000 } : device
    )
  }
  await render(changed)
  for (const value of [
    '5 MW',
    '1 MW',
    '2 MW',
    '3 MW',
    '1.000 MW',
    '新能源供电 4 MW',
    '负载总功率 6 MW'
  ])
    check(texts().includes(value), `PLC update must show ${value}`)
  checkDirections('charge', 'import')
  const discharging = {
    ...changed,
    devices: changed.devices.map((device) =>
      device.kind === 'battery' ? { ...device, current: -1000 } : device
    )
  }
  await render(discharging)
  check(
    texts().includes('新能源供电 6 MW'),
    'Negative storage power must add discharged power to renewable supply'
  )
  checkDirections('discharge', 'idle')
  await render({
    ...changed,
    powers: { ...changed.powers!, totalLoadPower: 5 },
    devices: changed.devices.map((device) =>
      device.kind === 'battery' ? { ...device, current: 0 } : device
    )
  })
  check(texts().includes('0.000 MW'), 'Idle storage must display a valid zero')
  checkDirections('idle', 'idle')
  for (const batteryPatch of [{ status: 'offline' as const }, { current: NaN }]) {
    await render({
      ...changed,
      devices: changed.devices.map((device) =>
        device.kind === 'battery' ? { ...device, ...batteryPatch } : device
      )
    })
    check(texts().includes('新能源供电 — MW'), 'Unknown storage must not be treated as zero supply')
    checkDirections('idle', 'idle')
  }
  await render({ ...updated, plcConnected: false })
  check(
    livePowerTexts().every((text) => text.includes('— MW')),
    'Offline PLC must not display stale powers'
  )
  checkDirections('idle', 'idle')
  await render(snapshot, false)
  check(
    livePowerTexts().every((text) => text.includes('— MW')),
    'Disconnected realtime service must not display stale powers'
  )
  checkDirections('idle', 'idle')
  await render({ ...snapshot, powers: undefined, devices: [] })
  check(
    livePowerTexts().every((text) => text.includes('— MW')),
    'Missing data must not appear as zero'
  )
  checkDirections('idle', 'idle')
  await render(updated)
  flushSync(() => saveFontScale(1.3))
  await pause()
  // The maximum UInt value must fit on one line at the largest supported font size.
  for (const stage of Konva.stages) {
    for (const node of stage
      .find<Konva.Text>('Text')
      .filter((node) => node.text().includes('MW'))) {
      check(
        node.measureSize(node.text()).width <= node.width() + 1,
        `Power label wraps at large font: ${node.text()}`
      )
      const box = node.getClientRect()
      check(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= stage.width() + 1 &&
          box.y + box.height <= stage.height() + 1,
        `Power outside scene: ${node.text()}`
      )
    }
  }
  flushSync(() => saveFontScale(1))
  await render()
  return [
    'PASS: traditional fixed fractional powers remain available without telemetry; offline direct mode hides example values',
    'PASS: all device powers and totals render in MW',
    'PASS: telemetry updates, zero, UInt maximum, negative storage, device ordering',
    'PASS: positive PLC storage charges, negative discharges; storage/grid directions are mutually exclusive; zero and missing data do not animate',
    'PASS: live PV and load readings, signed renewable supply calculation, fixed 1 MW rating and hidden PV string powers',
    'PASS: PLC/service disconnect and missing readings hide stale values',
    'PASS: maximum power labels fit at 130% font size'
  ]
}

Object.assign(window, {
  runEnergyPowerSmoke,
  showEnergyPowerSnapshot: async (data: TelemetrySnapshot, scale = 1) => {
    flushSync(() => saveFontScale(scale))
    await render(data)
  }
})
