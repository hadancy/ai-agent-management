import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRealtime } from '../../realtime'
import { usePlatformSpeech } from '../../speech/usePlatformSpeech'
import AiAssistantPage from './ai/AiAssistantPage'
import RiskAlarmDialog from './alerts/RiskAlarmDialog'
import { detectDeviceRisk } from './alerts/riskDetection'
import ForecastChart from './charts/ForecastChart'
import { createForecastModel } from './charts/forecastSimulation'
import RealtimeChart from './charts/RealtimeChart'
import MonitorHeader from './components/MonitorHeader'
import WindowTitleBar from './components/WindowTitleBar'
import { BASE_STRING_METRICS } from './data'
import EnergyFlowCanvas from './energy/EnergyFlowCanvas'
import HomePage from './home/HomePage'
import MetricOverview from './metrics/MetricOverview'
import SettingsCenter from './settings/SettingsCenter'
import {
  getPhotovoltaicOperatingState,
  getSharedPhotovoltaicRouteState,
  loadPhotovoltaicSettings,
  savePhotovoltaicSettings,
  type PhotovoltaicSettings
} from './settings/photovoltaicSettings'
import type { ConsoleNav, MonitorSection, StringMetric } from './types'
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
    connectionState,
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
  const [activeNav, setActiveNav] = useState<ConsoleNav>('首页')
  const [focusedSection, setFocusedSection] = useState<MonitorSection>()
  const [photovoltaicSettings, setPhotovoltaicSettings] =
    useState<PhotovoltaicSettings>(loadPhotovoltaicSettings)
  const [viewportScale, setViewportScale] = useState(1)
  const [alarmOpen, setAlarmOpen] = useState(false)
  const [workOrderCount, setWorkOrderCount] = useState(0)
  const [workOrdersLoaded, setWorkOrdersLoaded] = useState(false)
  const [localWorkOrderRevision, setLocalWorkOrderRevision] = useState(0)
  const [completionMessage, setCompletionMessage] = useState('')
  const {
    status: completionVoiceStatus,
    message: completionVoiceMessage,
    speak: speakCompletion,
    stop: stopCompletion,
    resume: resumeCompletion
  } = usePlatformSpeech(serviceOrigin)
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
  const activeAlarm = useMemo(
    () =>
      detectDeviceRisk(
        telemetry?.plcConnected === true ? metrics : [],
        photovoltaicSettings,
        forecastModel.activeRisk
      ),
    [forecastModel.activeRisk, metrics, photovoltaicSettings, telemetry?.plcConnected]
  )
  const activeAlarmId = activeAlarm?.id
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
  const refreshWorkOrders = useCallback(
    (): void => setLocalWorkOrderRevision((value) => value + 1),
    []
  )
  const updateWorkOrderCount = useCallback((count: number): void => setWorkOrderCount(count), [])
  const updatePhotovoltaicSettings = useCallback((settings: PhotovoltaicSettings): void => {
    savePhotovoltaicSettings(settings)
    setPhotovoltaicSettings(settings)
  }, [])

  const navigate = useCallback((page: ConsoleNav, section?: MonitorSection): void => {
    setFocusedSection(section)
    setActiveNav(page)
  }, [])

  useEffect(() => {
    if (activeNav !== '综合监控' || !focusedSection) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`monitor-${focusedSection}`)?.focus({ preventScroll: true })
    })
    const timer = window.setTimeout(() => setFocusedSection(undefined), 2600)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [activeNav, focusedSection])

  useEffect(() => {
    const controller = new AbortController()
    void listWorkOrders(serviceOrigin, controller.signal)
      .then((response) => {
        setWorkOrdersLoaded(true)
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

        if (newlyClosed.length > 0) {
          const message = newlyClosed
            .map((order) => `工单${order.orderNumber}处理完成，PLC数据已恢复正常，工单已自动关闭。`)
            .join('')
          setCompletionMessage(message)
          speakCompletion(message)
        }
      })
      .catch(() => {
        // The work-order center exposes a visible retry action when the service is unavailable.
      })
    return () => controller.abort()
  }, [localWorkOrderRevision, serviceOrigin, workOrderRevision, speakCompletion])

  useEffect(() => {
    const updateClock = (): void => {
      setClock(new Date(Date.now() + (plcClockOffsetMs ?? 0)))
    }
    updateClock()
    const clockTimer = window.setInterval(updateClock, 1000)
    return () => window.clearInterval(clockTimer)
  }, [plcClockOffsetMs])

  useEffect(() => {
    const timer = window.setTimeout(() => setAlarmOpen(Boolean(activeAlarmId)), 0)
    return () => window.clearTimeout(timer)
  }, [activeAlarmId])

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
        className={`console-shell${activeNav === '首页' ? ' console-shell--home' : ''}`}
        style={{ transform: `translate(-50%, -50%) scale(${viewportScale})` }}
      >
        <WindowTitleBar />
        <MonitorHeader
          activeNav={activeNav}
          hasAlarm={Boolean(activeAlarm)}
          clock={clock}
          plcOnline={telemetry?.plcConnected === true}
          onNavChange={navigate}
        />
        {activeNav === '首页' ? (
          <HomePage
            telemetry={telemetry}
            connectionState={connectionState}
            workOrderCount={workOrdersLoaded ? workOrderCount : null}
            alarmCount={Number(Boolean(activeAlarm))}
            onNavigate={navigate}
          />
        ) : activeNav === '设置中心' ? (
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
              onOpenAssistant={() => navigate('智诊精巡')}
              onCountChange={updateWorkOrderCount}
            />
          </main>
        ) : activeNav === '智诊精巡' ? (
          <main className="console-main console-main--assistant">
            <AiAssistantPage
              normalRange={photovoltaicSettings}
              clock={clock}
              serviceOrigin={serviceOrigin}
              refreshToken={workOrderRevision + localWorkOrderRevision}
              onWorkOrderChanged={refreshWorkOrders}
              workOrderCount={workOrdersLoaded ? workOrderCount : null}
              plcOnline={connectionState === 'connected' && telemetry?.plcConnected === true}
              onWorkOrderCreated={createWorkOrder}
              onViewWorkOrder={viewWorkOrder}
              onOpenMonitor={() => navigate('综合监控')}
            />
          </main>
        ) : (
          <main className="console-main console-main--monitor">
            <MetricOverview
              metrics={metrics}
              battery={battery}
              photovoltaicStates={photovoltaicStates}
              batteryState={batteryState}
            />
            <section className="dashboard-grid">
              <div
                id="monitor-energy"
                tabIndex={-1}
                aria-label="能源流向"
                className={`monitor-section${focusedSection === 'energy' ? ' monitor-section--focused' : ''}`}
              >
                <EnergyFlowCanvas
                  routeStates={{ photovoltaic: photovoltaicRouteState }}
                  photovoltaicStates={photovoltaicStates}
                />
              </div>
              <div className="chart-grid">
                <RealtimeChart history={telemetryHistory} plcClockOffsetMs={plcClockOffsetMs} />
                <div
                  id="monitor-forecast"
                  tabIndex={-1}
                  aria-label="预测预警"
                  className={`monitor-section${focusedSection === 'forecast' ? ' monitor-section--focused' : ''}`}
                >
                  <ForecastChart model={forecastModel} onRiskClick={() => setAlarmOpen(true)} />
                </div>
              </div>
            </section>
          </main>
        )}
      </div>
      {completionMessage &&
        (completionVoiceStatus === 'blocked' || completionVoiceStatus === 'error') && (
          <aside className="console-speech-notice" aria-label="工单关闭语音提醒" role="status">
            <span>{completionVoiceMessage}</span>
            <button
              type="button"
              onClick={() => {
                if (completionVoiceStatus === 'blocked' && resumeCompletion()) return
                speakCompletion(completionMessage, true)
              }}
            >
              {completionVoiceStatus === 'blocked' ? '点击播放' : '重试播报'}
            </button>
            <button type="button" onClick={stopCompletion}>
              关闭
            </button>
          </aside>
        )}
      <RiskAlarmDialog open={alarmOpen} alarm={activeAlarm} onClose={closeAlarm} />
    </div>
  )
}
