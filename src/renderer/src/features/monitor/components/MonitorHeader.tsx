import { useMemo } from 'react'
import { STATION_TIME_ZONE } from '../../../../../shared/plc-clock'
import type { ConsoleNav } from '../types'

const NAV_ITEMS: ConsoleNav[] = ['首页', '综合监控', 'AI 智能助手', '工单中心', '设置中心']

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: STATION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
    .format(date)
    .replaceAll('/', '-')
}

export default function MonitorHeader({
  activeNav,
  hasAlarm,
  clock,
  plcOnline,
  onNavChange
}: {
  activeNav: ConsoleNav
  hasAlarm: boolean
  clock: Date
  plcOnline: boolean
  onNavChange: (item: ConsoleNav) => void
}): React.JSX.Element {
  const clockText = useMemo(() => formatClock(clock), [clock])

  return (
    <header className="console-header">
      <div className="brand-block">
        <h1>AI智能体辅助管理平台</h1>
        <i />
        <span>光明村光伏电站</span>
      </div>
      <nav aria-label="主要功能">
        {NAV_ITEMS.map((item) => (
          <button
            type="button"
            className={activeNav === item ? 'nav-item nav-item--active' : 'nav-item'}
            aria-current={activeNav === item ? 'page' : undefined}
            onClick={() => onNavChange(item)}
            key={item}
          >
            {item}
          </button>
        ))}
      </nav>
      <div className="header-status">
        <span className={plcOnline ? 'header-state' : 'header-state header-state--warning'}>
          <i />
          {plcOnline ? 'PLC在线' : 'PLC离线'}
        </span>
        <span
          className={
            hasAlarm
              ? 'header-state header-state--activity header-state--warning'
              : 'header-state header-state--activity'
          }
        >
          <i />
          {hasAlarm ? '1项活动告警' : '无活动告警'}
        </span>
        <b />
        <time dateTime={clock.toISOString()}>
          <span className="clock-icon">◷</span>
          {clockText}
        </time>
      </div>
    </header>
  )
}
