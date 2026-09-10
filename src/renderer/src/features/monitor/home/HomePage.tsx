import { useState, type CSSProperties } from 'react'
import type { TelemetrySnapshot } from '../../../../../shared/contracts'
import type { ConnectionState } from '../../../realtime'
import type { ConsoleNav, MonitorSection } from '../types'
import AgricultureScene from './AgricultureScene'
import EnergyGlobe from './EnergyGlobe'
import '../styles/home.css'

type EntryId = 'monitor' | 'ai' | 'orders' | 'settings'
type HomeEntry = {
  id: EntryId
  title: string
  english: string
  description: string
  page: ConsoleNav
  color: string
  path: string
  endpoint: [number, number]
}

const ENTRIES: HomeEntry[] = [
  {
    id: 'monitor',
    title: '综合监控',
    english: 'LIVE MONITORING',
    description: '光伏与储能运行，一屏掌握',
    page: '综合监控',
    color: '#38ec86',
    path: 'M370 112 H442 L512 162 H584',
    endpoint: [584, 162]
  },
  {
    id: 'ai',
    title: '智诊精巡',
    english: 'AI ASSISTANT',
    description: '设备故障分析，辅助运维决策',
    page: '智诊精巡',
    color: '#3decc0',
    path: 'M370 502 H442 L512 442 H584',
    endpoint: [584, 442]
  },
  {
    id: 'orders',
    title: '工单中心',
    english: 'WORK ORDER CENTER',
    description: '协同巡检处置，保障设备运行',
    page: '工单中心',
    color: '#7ded49',
    path: 'M1218 112 H1146 L1076 162 H1004',
    endpoint: [1004, 162]
  },
  {
    id: 'settings',
    title: '设置中心',
    english: 'SYSTEM SETTINGS',
    description: '光伏运行参数与告警规则',
    page: '设置中心',
    color: '#56e57b',
    path: 'M1218 502 H1146 L1076 442 H1004',
    endpoint: [1004, 442]
  }
]

function EntryIcon({ id }: { id: EntryId }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {id === 'monitor' ? (
        <>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8m-4-4v4M6 12h3l2-4 3 6 2-4h2" />
        </>
      ) : id === 'ai' ? (
        <>
          <rect x="4" y="7" width="16" height="13" rx="4" />
          <path d="M12 3v4M2 12v4m20-4v4M9 16h6" />
          <circle cx="8.5" cy="12" r=".7" />
          <circle cx="15.5" cy="12" r=".7" />
          <circle cx="12" cy="3" r="1" />
        </>
      ) : id === 'orders' ? (
        <>
          <path d="M8 5H5v16h14V5h-3" />
          <rect x="8" y="3" width="8" height="4" rx="1" />
          <path d="m8 12 1 1 2-2m2 1h3m-8 5h8" />
        </>
      ) : (
        <>
          <path d="m10 3-1 3-3 1-2 3 2 2-1 3 3 3 3-1 2 2 3-1 1-3 3-1 1-4-3-2-1-3-3-1-2 2Z" />
          <circle cx="12" cy="11" r="3" />
        </>
      )}
    </svg>
  )
}

export default function HomePage({
  telemetry,
  connectionState,
  workOrderCount,
  alarmCount,
  onNavigate
}: {
  telemetry?: TelemetrySnapshot
  connectionState: ConnectionState
  workOrderCount: number | null
  alarmCount: number
  onNavigate: (page: ConsoleNav, section?: MonitorSection) => void
}): React.JSX.Element {
  const [activeEntry, setActiveEntry] = useState<EntryId | null>(null)
  const [animated, setAnimated] = useState(true)
  const plcOnline = connectionState === 'connected' && telemetry?.plcConnected === true
  const devices = telemetry?.devices ?? []
  const photovoltaic = devices.filter((device) => device.kind === 'pv-string')
  const power =
    photovoltaic.reduce((total, device) => total + device.voltage * device.current, 0) / 1000
  const onlineDevices = devices.filter((device) => device.status !== 'offline').length

  return (
    <main className={`home-page${animated ? '' : ' home-page--paused'}`}>
      <div className="home-intro">
        <div>
          <div className="home-eyebrow">
            <span /> AGRIVOLTAICS · SMART AGRICULTURE
          </div>
          <h2>
            农光互补<span> · </span>绿能兴农
          </h2>
          <p>
            光伏发电与农业生产协同 <i /> 让绿色电力走进大棚与田间
          </p>
        </div>
        <div className="home-station">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
          >
            <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          <div>
            <span>农光互补应用 / AGRIVOLTAICS</span>
            <strong>光明村光伏电站</strong>
          </div>
          <span className={`home-station-state${plcOnline ? ' home-station-state--online' : ''}`}>
            <i />
            {plcOnline ? '已连接' : '未连接'}
          </span>
        </div>
      </div>

      <section className="home-network" aria-label="农光互补能源中枢、农业用能场景与功能入口">
        <div className="home-network-caption" aria-hidden="true">
          <span>01 — {String(ENTRIES.length).padStart(2, '0')}</span> 农业用能 · 智能协同
        </div>
        <div className="home-network-grid" aria-hidden="true" />
        <EnergyGlobe animated={animated} />
        <AgricultureScene kind="greenhouse" />
        <AgricultureScene kind="machinery" />
        <svg className="home-connections" viewBox="0 0 1588 606" fill="none" aria-hidden="true">
          {ENTRIES.map((entry, index) => (
            <g
              key={entry.id}
              className={`home-connection${activeEntry === entry.id ? ' home-connection--active' : ''}`}
              style={
                {
                  '--entry-color': entry.color,
                  '--packet-delay': `${index * -0.7}s`
                } as CSSProperties
              }
            >
              <path className="home-connection-track" d={entry.path} />
              <path className="home-connection-packet" d={entry.path} pathLength="100" />
              <circle
                className="home-connection-ring"
                cx={entry.endpoint[0]}
                cy={entry.endpoint[1]}
                r="8"
              />
              <circle
                className="home-connection-dot"
                cx={entry.endpoint[0]}
                cy={entry.endpoint[1]}
                r="3"
              />
            </g>
          ))}
        </svg>
        <div className="home-globe-label">
          <span className="home-core-eyebrow">SOLAR ENERGY · AGRICULTURE</span>
          <svg className="home-agri-emblem" viewBox="0 0 80 66" fill="none" aria-hidden="true">
            <g stroke="#ffd34f" strokeWidth="1.5" strokeLinecap="round">
              <path d="M25 30a14 14 0 1 1 24 0M37 2v5M16 10l4 4M8 29h7m47 0h5M54 13l5-5" />
            </g>
            <g stroke="#64ff91" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path
                d="M38 61V42m0 8C19 51 13 40 13 30c18-1 25 8 25 20Zm0-9c0-17 11-22 27-23 0 16-8 24-27 23Z"
                fill="#24e868"
                fillOpacity="0.1"
              />
              <path d="m26 41 12 9m0-9 15-12M28 62h21" />
            </g>
          </svg>
          <h3>农光互补</h3>
          <p>农业用能 · 绿电协同</p>
          <span className="home-core-tag">
            <i /> 光伏发电 · 储能支撑
          </span>
        </div>
        <nav className="home-entries" aria-label="功能快捷入口">
          {ENTRIES.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              className={`home-entry home-entry--${entry.id}${activeEntry === entry.id ? ' home-entry--active' : ''}`}
              style={{ '--entry-color': entry.color } as CSSProperties}
              onPointerEnter={() => setActiveEntry(entry.id)}
              onPointerLeave={() => setActiveEntry(null)}
              onFocus={() => setActiveEntry(entry.id)}
              onBlur={() => setActiveEntry(null)}
              onClick={() => onNavigate(entry.page)}
              aria-label={`进入${entry.title}`}
            >
              <span className="home-entry-icon">
                <EntryIcon id={entry.id} />
              </span>
              <span className="home-entry-content">
                <span className="home-entry-english">{entry.english}</span>
                <strong>{entry.title}</strong>
                <span className="home-entry-description">{entry.description}</span>
              </span>
              <span className="home-entry-number">0{index + 1}</span>
              <svg
                className="home-entry-arrow"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                aria-hidden="true"
              >
                <path d="M4 10h11m-4-4 4 4-4 4" />
              </svg>
            </button>
          ))}
        </nav>
        <div className="home-network-hint">
          <span /> 以光赋能 · 向绿而生 <span />
        </div>
        <button
          className="home-motion-control"
          type="button"
          onClick={() => setAnimated((value) => !value)}
          aria-pressed={!animated}
          aria-label={animated ? '暂停电网动效' : '播放电网动效'}
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            {animated ? <path d="M4 3h2v10H4zm6 0h2v10h-2z" /> : <path d="m5 3 8 5-8 5z" />}
          </svg>
          {animated ? '智能设计' : '播放动效'}
        </button>
      </section>

      <section className="home-overview" aria-label="站点实时概览">
        <div className="home-overview-title">
          <span className="home-overview-mark" />
          <span>
            农光运行概览<small>AGRIVOLTAIC OVERVIEW</small>
          </span>
        </div>
        <div className="home-stat">
          <span>光伏实时功率</span>
          <strong>
            {plcOnline && photovoltaic.length ? power.toFixed(2) : '—'}
            <small>kW</small>
          </strong>
          <span className="home-stat-note">
            {plcOnline ? '光伏组串合计输出' : '等待 PLC 实时数据'}
          </span>
        </div>
        <div className="home-stat">
          <span>在线采集设备</span>
          <strong>
            {plcOnline ? String(onlineDevices).padStart(2, '0') : '—'}
            <small>/ {devices.length || '—'} 台</small>
          </strong>
          <span className="home-stat-note">光伏组串 / 蓄电池组</span>
        </div>
        <button
          className="home-stat home-stat--link"
          type="button"
          onClick={() => onNavigate('工单中心')}
        >
          <span>
            待处理工单 <span>↗</span>
          </span>
          <strong>
            {workOrderCount === null ? '—' : String(workOrderCount).padStart(2, '0')}
            <small>项</small>
          </strong>
          <span className="home-stat-note">
            {workOrderCount === null
              ? '等待工单服务数据'
              : workOrderCount > 0
                ? '进入工单中心查看进度'
                : '当前无待处理工单'}
          </span>
        </button>
        <button
          className={`home-stat home-stat--link${alarmCount ? ' home-stat--warning' : ''}`}
          type="button"
          onClick={() => onNavigate('综合监控', 'forecast')}
        >
          <span>
            运行告警 <span>↗</span>
          </span>
          <strong>
            {plcOnline ? String(alarmCount).padStart(2, '0') : '—'}
            <small>项</small>
          </strong>
          <span className="home-stat-note">
            {!plcOnline ? '等待设备连接' : alarmCount ? '发现异常，请及时关注' : '当前无活动告警'}
          </span>
        </button>
      </section>
    </main>
  )
}
