import { useMemo } from 'react'
import type { DeviceRiskSource } from '../types'

const NAV_ITEMS = ['综合监控', '工单中心', '设置中心']

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
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
  alarmSource,
  clock,
  plcOnline,
  onNavChange
}: {
  activeNav: string
  alarmSource?: DeviceRiskSource
  clock: Date
  plcOnline: boolean
  onNavChange: (item: string) => void
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
            alarmSource
              ? 'header-state header-state--activity header-state--warning'
              : 'header-state header-state--activity'
          }
        >
          <i />
          {alarmSource === 'realtime'
            ? '1项活动告警'
            : alarmSource === 'prediction'
              ? '1项预测告警'
              : '无活动告警'}
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
