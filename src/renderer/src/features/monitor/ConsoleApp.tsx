import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRealtime } from '../../realtime'
import AiAssistant from './ai/AiAssistant'
import RiskAlarmDialog from './alerts/RiskAlarmDialog'
import { createPredictionRiskAlarm, detectRealtimeRisk } from './alerts/riskDetection'
import ForecastChart from './charts/ForecastChart'
import { createForecastModel } from './charts/forecastSimulation'
import RealtimeChart from './charts/RealtimeChart'
import MonitorHeader from './components/MonitorHeader'
import WindowTitleBar from './components/WindowTitleBar'
import { BASE_STRING_METRICS } from './data'
import EnergyFlowCanvas from './energy/EnergyFlowCanvas'
import MetricOverview from './metrics/MetricOverview'
import SettingsCenter from './settings/SettingsCenter'
import {
  getPhotovoltaicOperatingState,
  getSharedPhotovoltaicRouteState,
  loadPhotovoltaicSettings,
  savePhotovoltaicSettings,
  type PhotovoltaicSettings
} from './settings/photovoltaicSettings'
import type { StringMetric } from './types'
import Workflow from './workflow/Workflow'
import { createWorkOrderDraft, listWorkOrders } from './workorder/api'
import WorkOrderCenter from './workorder/WorkOrderCenter'
import './styles/console-layout.css'
import './styles/window-titlebar.css'

const DESIGN_WIDTH = 1680
const DESIGN_HEIGHT = 977

export default function ConsoleApp(): React.JSX.Element {
  const [clock, setClock] = useState(new Date())
  const {
    telemetry,
    telemetryHistory,
    plcClockOffsetMs,
    systemInfo,
    serviceOrigin,
    workOrderRevision
  } = useRealtime()
  const metrics = useMemo<StringMetric[]>(() => {
    const photovoltaicDevices = telemetry?.devices.filter((device) => device.kind === 'pv-string')
    if (photovoltaicDevices?.length === 4) {
      return photovoltaicDevices.map((device) => ({
        name: device.name,
        voltage: device.voltage,
        current: device.current
      }))
    }
    return BASE_STRING_METRICS.map((metric) => ({ ...metric, voltage: 0, current: 0 }))
  }, [telemetry])
  const battery = useMemo<StringMetric>(() => {
    const device = telemetry?.devices.find((item) => item.kind === 'battery')
    return device
      ? { name: device.name, voltage: device.voltage, current: device.current }
      : { name: '蓄电池组', voltage: 0, current: 0 }
  }, [telemetry])
  const [activeNav, setActiveNav] = useState('综合监控')
  const [photovoltaicSettings, setPhotovoltaicSettings] =
    useState<PhotovoltaicSettings>(loadPhotovoltaicSettings)
  const [viewportScale, setViewportScale] = useState(1)
  const [alarmOpen, setAlarmOpen] = useState(false)
  const [workOrderCount, setWorkOrderCount] = useState(0)
  const [localWorkOrderRevision, setLocalWorkOrderRevision] = useState(0)
  const knownWorkOrderStatusesRef = useRef<Map<string, string> | null>(null)
  const forecastModel = useMemo(
    () => createForecastModel(telemetryHistory, photovoltaicSettings),
    [photovoltaicSettings, telemetryHistory]
  )
  const photovoltaicStates = useMemo(
    () =>
      metrics.map((metric) =>
        getPhotovoltaicOperatingState(
          metric,
          photovoltaicSettings,
          telemetry?.plcConnected === true
        )
      ),
    [metrics, photovoltaicSettings, telemetry?.plcConnected]
  )
  const photovoltaicRouteState = useMemo(
    () => getSharedPhotovoltaicRouteState(photovoltaicStates),
    [photovoltaicStates]
  )
  const batteryState = useMemo(() => {
    const device = telemetry?.devices.find((item) => item.kind === 'battery')
    if (telemetry?.plcConnected !== true || !device || device.status === 'offline')
      return 'disconnected' as const
    return device.status === 'warning' ? ('low' as const) : ('normal' as const)
  }, [telemetry])
  const predictionAlarm = useMemo(
    () => createPredictionRiskAlarm(forecastModel.activeRisk),
    [forecastModel.activeRisk]
  )
  const realtimeAlarm = useMemo(
    () =>
      telemetry?.plcConnected === true ? detectRealtimeRisk(metrics, photovoltaicSettings) : null,
    [metrics, photovoltaicSettings, telemetry?.plcConnected]
  )
  const activeAlarm = predictionAlarm ?? realtimeAlarm
  const activeAlarmId = activeAlarm?.id
  const activeAlarmSource = activeAlarm?.source
  const closeAlarm = useCallback(() => setAlarmOpen(false), [])
  const createWorkOrder = useCallback(async () => {
    const firstString = telemetry?.devices.find((device) => device.id === 'pv-1')
    const result = await createWorkOrderDraft(serviceOrigin, {
      stationName: '光明村光伏电站',
      deviceId: 'pv-1',
      stringName: '1号光伏组串',
      componentName: '1号组件',
      faultType: '组件热斑',
      voltage: firstString?.voltage,
      current: firstString?.current,
      normalVoltage: photovoltaicSettings.normalVoltage,
      normalCurrent: photovoltaicSettings.normalCurrent,
      tolerancePercent: photovoltaicSettings.tolerancePercent,
      priority: 'urgent',
      handlingSuggestion: '隔离组串，现场确认并清理或更换1号组件，复测后由B确认恢复连接与送电'
    })
    setLocalWorkOrderRevision((value) => value + 1)
    return {
      orderNumber: result.workOrder.orderNumber,
      deduplicated: result.deduplicated
    }
  }, [photovoltaicSettings, serviceOrigin, telemetry])
  const viewWorkOrder = useCallback((): void => setActiveNav('工单中心'), [])
  const updateWorkOrderCount = useCallback((count: number): void => setWorkOrderCount(count), [])
  const updatePhotovoltaicSettings = useCallback((settings: PhotovoltaicSettings): void => {
    savePhotovoltaicSettings(settings)
    setPhotovoltaicSettings(settings)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void listWorkOrders(serviceOrigin, controller.signal)
      .then((response) => {
        setWorkOrderCount(response.items.filter((order) => order.status !== 'closed').length)

        const previousStatuses = knownWorkOrderStatusesRef.current
        const newlyClosed = previousStatuses
          ? response.items.filter(
              (order) =>
                order.status === 'closed' &&
                previousStatuses.has(order.id) &&
                previousStatuses.get(order.id) !== 'closed'
            )
          : []
        knownWorkOrderStatusesRef.current = new Map(
          response.items.map((order) => [order.id, order.status])
        )

        if (newlyClosed.length > 0 && window.speechSynthesis && window.SpeechSynthesisUtterance) {
          const message = newlyClosed
            .map((order) => `工单${order.orderNumber}处理完成，PLC数据已恢复正常，工单已自动关闭。`)
            .join('')
          const utterance = new window.SpeechSynthesisUtterance(message)
          const chineseVoice = window.speechSynthesis
            .getVoices()
            .find((voice) => voice.lang.toLowerCase().startsWith('zh'))
          if (chineseVoice) utterance.voice = chineseVoice
          utterance.lang = 'zh-CN'
          utterance.rate = 0.92
          window.speechSynthesis.cancel()
          window.speechSynthesis.speak(utterance)
        }
      })
      .catch(() => {
        // The work-order center exposes a visible retry action when the service is unavailable.
      })
    return () => controller.abort()
  }, [localWorkOrderRevision, serviceOrigin, workOrderRevision])

  useEffect(() => {
    const updateClock = (): void => {
      setClock(new Date(Date.now() + (plcClockOffsetMs ?? 0)))
    }
    updateClock()
    const clockTimer = window.setInterval(updateClock, 1000)
    return () => window.clearInterval(clockTimer)
  }, [plcClockOffsetMs])

  useEffect(() => {
    if (!activeAlarmId) return
    const timer = window.setTimeout(
      () => setAlarmOpen(true),
      activeAlarmSource === 'realtime' ? 0 : 800
    )
    return () => window.clearTimeout(timer)
  }, [activeAlarmId, activeAlarmSource])

  useEffect(() => {
    const syncViewportScale = (): void => {
      setViewportScale(
        Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT)
      )
    }

    syncViewportScale()
    window.addEventListener('resize', syncViewportScale)
    return () => window.removeEventListener('resize', syncViewportScale)
  }, [])

  return (
    <div className="console-viewport">
      <div
        className="console-shell"
        style={{ transform: `translate(-50%, -50%) scale(${viewportScale})` }}
      >
        <WindowTitleBar />
        <MonitorHeader
          activeNav={activeNav}
          alarmSource={activeAlarmSource}
          clock={clock}
          plcOnline={telemetry?.plcConnected === true}
          onNavChange={setActiveNav}
        />
        {activeNav === '设置中心' ? (
          <main className="console-main console-main--settings">
            <SettingsCenter settings={photovoltaicSettings} onSave={updatePhotovoltaicSettings} />
          </main>
        ) : activeNav === '工单中心' ? (
          <main className="console-main console-main--work-orders">
            <WorkOrderCenter
              serviceOrigin={serviceOrigin}
              padUrl={systemInfo?.padUrl}
              refreshToken={workOrderRevision + localWorkOrderRevision}
              onBack={() => setActiveNav('综合监控')}
              onCountChange={updateWorkOrderCount}
            />
          </main>
        ) : (
          <main className="console-main">
            <MetricOverview
              metrics={metrics}
              battery={battery}
              photovoltaicStates={photovoltaicStates}
              batteryState={batteryState}
            />
            <section className="dashboard-grid">
              <div className="dashboard-left">
                <EnergyFlowCanvas
                  routeStates={{ photovoltaic: photovoltaicRouteState }}
                  photovoltaicStates={photovoltaicStates}
                />
                <div className="chart-grid">
                  <RealtimeChart history={telemetryHistory} plcClockOffsetMs={plcClockOffsetMs} />
                  <ForecastChart model={forecastModel} onRiskClick={() => setAlarmOpen(true)} />
                </div>
              </div>
              <aside className="dashboard-right">
                <AiAssistant onWorkOrderCreated={createWorkOrder} onViewWorkOrder={viewWorkOrder} />
                <Workflow workOrderCount={workOrderCount} />
              </aside>
            </section>
          </main>
        )}
      </div>
      <RiskAlarmDialog open={alarmOpen} alarm={activeAlarm} onClose={closeAlarm} />
    </div>
  )
}
