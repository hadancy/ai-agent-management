import type { ComponentProps } from 'react'
import AiAssistant from './AiAssistant'
import AssistantIcon from './AssistantIcon'
import '../styles/ai-assistant-page.css'

type AiAssistantPageProps = ComponentProps<typeof AiAssistant> & {
  workOrderCount: number | null
  plcOnline: boolean
  onOpenMonitor: () => void
}

const HANDLING_STEPS = [
  ['提供故障线索', '上传现场图片，补充设备异常描述'],
  ['查看分析与草稿', '核对故障位置、原因及处理建议'],
  ['审核并下达工单', '在工单中心确认，再交由现场执行']
]

export default function AiAssistantPage({
  workOrderCount,
  plcOnline,
  onWorkOrderCreated,
  onViewWorkOrder,
  onOpenMonitor
}: AiAssistantPageProps): React.JSX.Element {
  return (
    <section className="assistant-page" aria-labelledby="assistant-page-title">
      <header className="assistant-page__heading">
        <div>
          <span className="assistant-eyebrow">AI OPERATIONS ASSISTANT</span>
          <h2 id="assistant-page-title">AI 智能助手</h2>
        </div>
        <button type="button" className="assistant-outline-button" onClick={onViewWorkOrder}>
          <AssistantIcon name="clipboard" /> 工单中心 <AssistantIcon name="arrow" />
        </button>
      </header>

      <div className="assistant-workspace">
        <AiAssistant onWorkOrderCreated={onWorkOrderCreated} onViewWorkOrder={onViewWorkOrder} />
        <aside className="assistant-sidebar" aria-label="运维协同工作台">
          <div className="assistant-sidebar__heading">
            <h3>协同工作台</h3>
            <span>WORKSPACE</span>
          </div>
          <section className="assistant-station" aria-labelledby="assistant-station-title">
            <div className="assistant-station__label">
              <span>
                <AssistantIcon name="location" /> 当前站点
              </span>
              <span
                className={`assistant-connection${plcOnline ? ' assistant-connection--online' : ''}`}
              >
                <i /> PLC {plcOnline ? '在线' : '离线'}
              </span>
            </div>
            <h4 id="assistant-station-title">光明村光伏电站</h4>
            <p>光储直柔一体化 · 智能运维</p>
            <button type="button" onClick={onOpenMonitor}>
              查看设备运行状态 <AssistantIcon name="arrow" />
            </button>
          </section>
          <section className="assistant-orders" aria-label="待处理工单">
            <div className="assistant-orders__summary">
              <span className="assistant-sidebar-icon">
                <AssistantIcon name="clipboard" />
              </span>
              <div>
                <h4>待处理工单</h4>
                <p>
                  {workOrderCount === null
                    ? '等待工单服务数据'
                    : workOrderCount > 0
                      ? '需要关注的运维事项'
                      : '当前暂无待处理事项'}
                </p>
              </div>
              <strong>
                {workOrderCount === null ? '—' : String(workOrderCount).padStart(2, '0')}
              </strong>
            </div>
            <button type="button" onClick={onViewWorkOrder}>
              查看全部工单 <AssistantIcon name="arrow" />
            </button>
          </section>
          <section className="assistant-handling" aria-labelledby="assistant-handling-title">
            <span className="assistant-section-label">HOW IT WORKS</span>
            <h4 id="assistant-handling-title">从发现问题，到协同处置</h4>
            <ol>
              {HANDLING_STEPS.map(([title, description], index) => (
                <li key={title}>
                  <span className="assistant-step-number">0{index + 1}</span>
                  <div>
                    <h5>{title}</h5>
                    <p>{description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </section>
  )
}
