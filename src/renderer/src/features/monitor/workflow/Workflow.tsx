import { useState } from 'react'
import '../styles/workflow.css'

const WORKFLOW_STEPS = ['监控发现', '告警触发', '分析评估', '派单执行', '关闭归档']

export default function Workflow({
  workOrderCount
}: {
  workOrderCount: number
}): React.JSX.Element {
  const [activeStep, setActiveStep] = useState(0)
  const visibleStep = workOrderCount > 0 ? Math.max(activeStep, 3) : activeStep

  return (
    <section className="panel workflow-panel">
      <div className="panel-heading workflow-heading">
        <h2>
          <span className="clipboard-icon">▤</span>工单闭环
        </h2>
        <span>
          {workOrderCount > 0 ? '工单待处理' : '暂无待处理工单'} <i /> 当前工单：{workOrderCount}
        </span>
      </div>
      <div
        className="workflow-track"
        style={{ '--workflow-progress': `${(visibleStep / 4) * 100}%` } as React.CSSProperties}
      >
        <div className="workflow-line" />
        {WORKFLOW_STEPS.map((step, index) => (
          <button
            type="button"
            key={step}
            className={
              index <= visibleStep ? 'workflow-step workflow-step--active' : 'workflow-step'
            }
            onClick={() => setActiveStep(index)}
            aria-label={`查看工单步骤：${step}`}
          >
            <i>{index === 0 ? '✓' : index + 1}</i>
            <span>{step}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
