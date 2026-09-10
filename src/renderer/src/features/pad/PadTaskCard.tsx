import { useState, type FormEvent } from 'react'
import type { PadTask, TaskAction } from './taskClient'
import { getTiltAdvice } from '../../../../shared/tilt-adjustment'

interface PadTaskCardProps {
  task: PadTask
  busyAction: TaskAction | null
  actionError?: string
  onAction: (task: PadTask, action: TaskAction, body?: Record<string, unknown>) => Promise<void>
  onReplay: (task: PadTask) => void
}

const STATUS_LABEL: Record<PadTask['status'], string> = {
  pending: '待办',
  in_progress: '处理中',
  completed: '已完成'
}

function formatDateTime(value?: string): string {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}

function BlockingNotice({
  task,
  action
}: {
  task: PadTask
  action: 'start' | 'submit'
}): React.JSX.Element {
  const fallback =
    task.role === 'C' && action === 'start'
      ? '等待 A 员工开始安全监护，且 B 员工完成隔离验电。'
      : task.role === 'B' && action === 'submit'
        ? '等待 C 员工完成故障处理后，再恢复组串连接和送电。'
        : '前置任务尚未完成，平台 B 将在条件满足后自动解锁。'

  return (
    <div className="task-blocking-notice" role="status">
      <span aria-hidden="true">⌛</span>
      <div>
        <strong>当前步骤尚未解锁</strong>
        <p>{task.blockedReason || fallback}</p>
      </div>
    </div>
  )
}

function StartTaskAction({
  task,
  busy,
  onAction
}: {
  task: PadTask
  busy: boolean
  onAction: PadTaskCardProps['onAction']
}): React.JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false)
  const label =
    task.role === 'A'
      ? '开始安全监护'
      : task.role === 'B'
        ? '开始隔离与验电'
        : task.tiltAdjustment
          ? '开始倾角调整'
          : '开始检测与处理'

  if (!task.canStart) return <BlockingNotice task={task} action="start" />

  return (
    <div className="task-action-panel">
      <label className="task-check task-check--acknowledge">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>我已阅读任务和风险点，并已准备所需防护用品</span>
      </label>
      <button
        type="button"
        className="task-primary-button"
        disabled={!acknowledged || busy}
        onClick={() => void onAction(task, 'start')}
      >
        {busy ? '正在提交…' : label}
      </button>
    </div>
  )
}

function SafetyMonitorForm({
  task,
  busy,
  onAction
}: {
  task: PadTask
  busy: boolean
  onAction: PadTaskCardProps['onAction']
}): React.JSX.Element {
  const [monitoringCompleted, setMonitoringCompleted] = useState(false)
  const [hazardState, setHazardState] = useState<'none' | 'unresolved' | ''>('')
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!monitoringCompleted || !hazardState) {
      setFormError('请确认监护已完成，并选择现场安全情况。')
      return
    }
    if (hazardState === 'unresolved') {
      setFormError('请先处置现场隐患，确认无未解决风险后再提交监护结果。')
      return
    }
    setFormError('')
    void onAction(task, 'submit', {
      monitoringCompleted: true,
      unresolvedHazards: false,
      notes: notes.trim() || undefined
    })
  }

  if (!task.canSubmit) return <BlockingNotice task={task} action="submit" />

  return (
    <form className="task-result-form" onSubmit={submit}>
      <div className="task-form-heading">
        <strong>提交安全监护结果</strong>
        <span>完成后将回传至平台 B</span>
      </div>
      <label className="task-check">
        <input
          type="checkbox"
          checked={monitoringCompleted}
          onChange={(event) => setMonitoringCompleted(event.target.checked)}
        />
        <span>已完成全程安全监护</span>
      </label>
      <fieldset className="task-fieldset">
        <legend>现场安全情况</legend>
        <label className="task-radio">
          <input
            type="radio"
            name={`hazard-${task.id}`}
            checked={hazardState === 'none'}
            onChange={() => {
              setHazardState('none')
              setFormError('')
            }}
          />
          <span>无未解决安全隐患</span>
        </label>
        <label className="task-radio task-radio--danger">
          <input
            type="radio"
            name={`hazard-${task.id}`}
            checked={hazardState === 'unresolved'}
            onChange={() => {
              setHazardState('unresolved')
              setFormError('请先处置现场隐患，确认无未解决风险后再提交监护结果。')
            }}
          />
          <span>存在未解决安全隐患（暂不能提交）</span>
        </label>
      </fieldset>
      <label className="task-field">
        <span>备注（选填）</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="记录违章制止、异常情况或其他说明"
          rows={3}
        />
      </label>
      {formError && <p className="task-form-error">{formError}</p>}
      <button
        type="submit"
        className="task-primary-button"
        disabled={busy || hazardState === 'unresolved'}
      >
        {busy ? '正在提交…' : '提交监护结果'}
      </button>
    </form>
  )
}

function IsolationCheckpointForm({
  task,
  busy,
  onAction
}: {
  task: PadTask
  busy: boolean
  onAction: PadTaskCardProps['onAction']
}): React.JSX.Element {
  const [isolationConfirmed, setIsolationConfirmed] = useState(false)
  const [voltageTestPassed, setVoltageTestPassed] = useState(false)
  const [safetyMeasuresConfirmed, setSafetyMeasuresConfirmed] = useState(false)
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!isolationConfirmed || !voltageTestPassed || !safetyMeasuresConfirmed) {
      setFormError('隔离、验电和安全措施三项均确认后才能提交。')
      return
    }
    setFormError('')
    void onAction(task, 'checkpoint', {
      isolationConfirmed: true,
      voltageTestPassed: true,
      safetyMeasuresConfirmed: true,
      notes: notes.trim() || undefined
    })
  }

  if (!task.canCheckpoint) return <BlockingNotice task={task} action="submit" />

  return (
    <form className="task-result-form" onSubmit={submit}>
      <div className="task-form-heading">
        <strong>作业前检查点</strong>
        <span>三项通过后，C 员工才能开始处理</span>
      </div>
      <label className="task-check">
        <input
          type="checkbox"
          checked={isolationConfirmed}
          onChange={(event) => setIsolationConfirmed(event.target.checked)}
        />
        <span>
          {task.tiltAdjustment ? '已确认待调整光伏组串完成隔离' : '已确认故障光伏组串完成隔离'}
        </span>
      </label>
      <label className="task-check">
        <input
          type="checkbox"
          checked={voltageTestPassed}
          onChange={(event) => setVoltageTestPassed(event.target.checked)}
        />
        <span>已按规程验电，验电结果合格</span>
      </label>
      <label className="task-check">
        <input
          type="checkbox"
          checked={safetyMeasuresConfirmed}
          onChange={(event) => setSafetyMeasuresConfirmed(event.target.checked)}
        />
        <span>已确认绝缘防护等安全措施到位</span>
      </label>
      <label className="task-field">
        <span>验电及安全措施备注（选填）</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="例：验电设备、检查结果或特殊安全措施"
          rows={3}
        />
      </label>
      {formError && <p className="task-form-error">{formError}</p>}
      <button type="submit" className="task-primary-button" disabled={busy}>
        {busy ? '正在提交…' : '确认隔离验电完成'}
      </button>
    </form>
  )
}

function RestorationForm({
  task,
  busy,
  onAction
}: {
  task: PadTask
  busy: boolean
  onAction: PadTaskCardProps['onAction']
}): React.JSX.Element {
  const [restorationConfirmed, setRestorationConfirmed] = useState(false)
  const [powerRestored, setPowerRestored] = useState(false)
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!restorationConfirmed || !powerRestored) {
      setFormError('请确认组串连接和送电状态后提交。')
      return
    }
    setFormError('')
    void onAction(task, 'submit', {
      restorationConfirmed: true,
      powerRestored: true,
      notes: notes.trim() || undefined
    })
  }

  if (!task.canSubmit) return <BlockingNotice task={task} action="submit" />

  return (
    <form className="task-result-form" onSubmit={submit}>
      <div className="task-form-heading">
        <strong>作业后恢复确认</strong>
        <span>C 员工处理完成后执行</span>
      </div>
      <label className="task-check">
        <input
          type="checkbox"
          checked={restorationConfirmed}
          onChange={(event) => setRestorationConfirmed(event.target.checked)}
        />
        <span>已检查并恢复光伏组串连接</span>
      </label>
      <label className="task-check">
        <input
          type="checkbox"
          checked={powerRestored}
          onChange={(event) => setPowerRestored(event.target.checked)}
        />
        <span>已按规程恢复送电，无异常现象</span>
      </label>
      <label className="task-field">
        <span>恢复说明（选填）</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="记录恢复时间、检查结果或其他说明"
          rows={3}
        />
      </label>
      {formError && <p className="task-form-error">{formError}</p>}
      <button type="submit" className="task-primary-button" disabled={busy}>
        {busy ? '正在提交…' : '提交恢复结果'}
      </button>
    </form>
  )
}

function TreatmentForm({
  task,
  busy,
  onAction
}: {
  task: PadTask
  busy: boolean
  onAction: PadTaskCardProps['onAction']
}): React.JSX.Element {
  const [hotspotState, setHotspotState] = useState<'confirmed' | 'not_found' | ''>('')
  const [treatmentAction, setTreatmentAction] = useState<'cleaned' | 'replaced' | 'no_fault' | ''>(
    ''
  )
  const [retestPassed, setRetestPassed] = useState(false)
  const [measuredTemperature, setMeasuredTemperature] = useState('')
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState('')

  const chooseHotspotState = (value: 'confirmed' | 'not_found'): void => {
    setHotspotState(value)
    if (value === 'not_found') setTreatmentAction('no_fault')
    if (value === 'confirmed' && treatmentAction === 'no_fault') setTreatmentAction('')
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!hotspotState || !treatmentAction || !retestPassed) {
      setFormError('请完整填写热斑确认、处理方式和复测结果。')
      return
    }
    if (
      (hotspotState === 'confirmed' && treatmentAction === 'no_fault') ||
      (hotspotState === 'not_found' && treatmentAction !== 'no_fault')
    ) {
      setFormError('热斑确认结果与处理方式不一致，请重新选择。')
      return
    }
    const temperature = measuredTemperature.trim() ? Number(measuredTemperature) : undefined
    if (
      temperature !== undefined &&
      (!Number.isFinite(temperature) || temperature < -50 || temperature > 250)
    ) {
      setFormError('请填写 -50 至 250 之间的有效复测温度。')
      return
    }
    setFormError('')
    void onAction(task, 'submit', {
      hotspotConfirmed: hotspotState === 'confirmed',
      treatmentAction,
      retestPassed: true,
      measuredTemperature: temperature,
      notes: notes.trim() || undefined
    })
  }

  if (!task.canSubmit) return <BlockingNotice task={task} action="submit" />

  return (
    <form className="task-result-form" onSubmit={submit}>
      <div className="task-form-heading">
        <strong>提交检测与处理结果</strong>
        <span>无需上传照片，请如实填写检测结果</span>
      </div>
      <fieldset className="task-fieldset">
        <legend>红外检测结果</legend>
        <label className="task-radio">
          <input
            type="radio"
            name={`hotspot-${task.id}`}
            checked={hotspotState === 'confirmed'}
            onChange={() => chooseHotspotState('confirmed')}
          />
          <span>确认存在热斑</span>
        </label>
        <label className="task-radio">
          <input
            type="radio"
            name={`hotspot-${task.id}`}
            checked={hotspotState === 'not_found'}
            onChange={() => chooseHotspotState('not_found')}
          />
          <span>现场未发现热斑</span>
        </label>
      </fieldset>
      <label className="task-field">
        <span>处理方式</span>
        <select
          value={treatmentAction}
          onChange={(event) =>
            setTreatmentAction(event.target.value as 'cleaned' | 'replaced' | 'no_fault' | '')
          }
        >
          <option value="">请选择</option>
          <option value="cleaned" disabled={hotspotState === 'not_found'}>
            清理遮挡物
          </option>
          <option value="replaced" disabled={hotspotState === 'not_found'}>
            更换故障组件
          </option>
          <option value="no_fault" disabled={hotspotState === 'confirmed'}>
            现场未发现故障，无需处理
          </option>
        </select>
      </label>
      <label className="task-field">
        <span>处理后复测温度（℃，选填）</span>
        <input
          type="number"
          inputMode="decimal"
          min="-50"
          max="250"
          step="0.1"
          value={measuredTemperature}
          onChange={(event) => setMeasuredTemperature(event.target.value)}
          placeholder="例：45.6"
        />
      </label>
      <label className="task-check">
        <input
          type="checkbox"
          checked={retestPassed}
          onChange={(event) => setRetestPassed(event.target.checked)}
        />
        <span>已完成复测，复测结果合格</span>
      </label>
      <label className="task-field">
        <span>处理说明（选填）</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="记录热斑情况、处理过程或其他说明"
          rows={3}
        />
      </label>
      {formError && <p className="task-form-error">{formError}</p>}
      <button type="submit" className="task-primary-button" disabled={busy}>
        {busy ? '正在提交…' : '提交处理结果'}
      </button>
    </form>
  )
}

function TiltAdjustmentForm({
  task,
  busy,
  onAction
}: {
  task: PadTask
  busy: boolean
  onAction: PadTaskCardProps['onAction']
}): React.JSX.Element {
  const [angle, setAngle] = useState('')
  const [fastening, setFastening] = useState(false)
  const [retest, setRetest] = useState(false)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const advice = getTiltAdvice(task.tiltAdjustment!.month)
  if (!task.canSubmit) return <BlockingNotice task={task} action="submit" />
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const adjustedAngle = Number(angle)
    if (
      !angle.trim() ||
      !Number.isFinite(adjustedAngle) ||
      adjustedAngle < advice.minAngle ||
      adjustedAngle > advice.maxAngle
    ) {
      setError(`请填写${advice.minAngle}至${advice.maxAngle}度范围内的实际倾角。`)
      return
    }
    if (!fastening || !retest) {
      setError('请确认支架紧固，并完成调整后复测。')
      return
    }
    setError('')
    void onAction(task, 'submit', {
      adjustedAngle,
      fasteningConfirmed: fastening,
      retestPassed: retest,
      notes: notes.trim() || undefined
    })
  }
  return (
    <form className="task-result-form" onSubmit={submit}>
      <div className="task-form-heading">
        <strong>提交{advice.season}倾角调整结果</strong>
        <span>
          目标倾角：{advice.minAngle}至{advice.maxAngle}度
        </span>
      </div>
      <label className="task-field">
        <span>调整后实际倾角（度）</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          min={advice.minAngle}
          max={advice.maxAngle}
          value={angle}
          onChange={(event) => setAngle(event.target.value)}
          required
        />
      </label>
      <label className="task-check">
        <input
          type="checkbox"
          checked={fastening}
          onChange={(event) => setFastening(event.target.checked)}
        />
        <span>已确认组件及支架紧固，无松动</span>
      </label>
      <label className="task-check">
        <input
          type="checkbox"
          checked={retest}
          onChange={(event) => setRetest(event.target.checked)}
        />
        <span>已完成倾角调整后复测，结果合格</span>
      </label>
      <label className="task-field">
        <span>调整说明（选填）</span>
        <textarea
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="记录实际倾角、支架检查及复测情况"
        />
      </label>
      {error && (
        <p className="task-form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="task-primary-button" disabled={busy}>
        {busy ? '正在提交…' : '提交倾角调整结果'}
      </button>
    </form>
  )
}

function CompletedResult({ task }: { task: PadTask }): React.JSX.Element {
  return (
    <div className="task-completed-result">
      <div className="task-completed-icon" aria-hidden="true">
        ✓
      </div>
      <div>
        <strong>个人任务已提交</strong>
        <p>平台 B 将汇总三人结果，并在 PLC 数据连续恢复正常后自动结束工单。</p>
        {task.resultSummary.length > 0 && (
          <ul>
            {task.resultSummary.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function PadTaskCard({
  task,
  busyAction,
  actionError,
  onAction,
  onReplay
}: PadTaskCardProps): React.JSX.Element {
  const busy = busyAction !== null
  const timestamp = task.completedAt || task.startedAt || task.dispatchedAt

  return (
    <article className={`pad-task-card pad-task-card--${task.status}`}>
      <div className="task-card-topline">
        <div className="task-order-number">
          <span>工单编号</span>
          <strong>{task.workOrderNumber}</strong>
        </div>
        <div className="task-card-badges">
          {task.priority && (
            <span className={`task-priority task-priority--${task.priority.toLowerCase()}`}>
              {task.priority === 'urgent'
                ? '紧急'
                : task.priority === 'normal'
                  ? '普通'
                  : task.priority}
            </span>
          )}
          <span className={`task-status task-status--${task.status}`}>
            {STATUS_LABEL[task.status]}
          </span>
        </div>
      </div>

      <div className="task-title-row">
        <div>
          <span className="task-fault-type">{task.faultType}</span>
          <h2>{task.title}</h2>
        </div>
        <button type="button" className="task-replay-button" onClick={() => onReplay(task)}>
          <span aria-hidden="true">🔊</span> 重新播报
        </button>
      </div>

      <dl className="task-meta">
        {task.stationName && (
          <div>
            <dt>场站</dt>
            <dd>{task.stationName}</dd>
          </div>
        )}
        {task.equipmentName && (
          <div>
            <dt>作业位置</dt>
            <dd>{task.equipmentName}</dd>
          </div>
        )}
        <div>
          <dt>{task.status === 'completed' ? '提交时间' : '任务时间'}</dt>
          <dd>{formatDateTime(timestamp)}</dd>
        </div>
      </dl>

      <section className="task-instruction" aria-labelledby={`instruction-${task.id}`}>
        <span className="task-section-label" id={`instruction-${task.id}`}>
          我的任务
        </span>
        <p>{task.content}</p>
      </section>

      <section className="task-risks" aria-labelledby={`risks-${task.id}`}>
        <div className="task-risk-heading">
          <span className="task-risk-icon" aria-hidden="true">
            !
          </span>
          <strong id={`risks-${task.id}`}>风险点与安全提示</strong>
        </div>
        {task.riskPoints.length > 0 ? (
          <ul>
            {task.riskPoints.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        ) : (
          <p>请按现场安全规程操作，并佩戴对应防护用品。</p>
        )}
      </section>

      {task.role === 'B' && task.status === 'in_progress' && (
        <div className="task-stage-strip" aria-label="B员工任务进度">
          <span className={task.checkpointCompleted ? 'is-complete' : 'is-active'}>
            <i>{task.checkpointCompleted ? '✓' : '1'}</i>隔离验电
          </span>
          <span className={task.checkpointCompleted && !task.canSubmit ? 'is-active' : ''}>
            <i>2</i>C员工处理
          </span>
          <span className={task.canSubmit ? 'is-active' : ''}>
            <i>3</i>恢复送电
          </span>
        </div>
      )}

      {actionError && (
        <div className="task-action-error" role="alert">
          <strong>本次操作未完成</strong>
          <span>{actionError}</span>
        </div>
      )}

      {task.status === 'pending' && <StartTaskAction task={task} busy={busy} onAction={onAction} />}
      {task.status === 'in_progress' && task.role === 'A' && (
        <SafetyMonitorForm task={task} busy={busy} onAction={onAction} />
      )}
      {task.status === 'in_progress' && task.role === 'B' && !task.checkpointCompleted && (
        <IsolationCheckpointForm task={task} busy={busy} onAction={onAction} />
      )}
      {task.status === 'in_progress' && task.role === 'B' && task.checkpointCompleted && (
        <RestorationForm task={task} busy={busy} onAction={onAction} />
      )}
      {task.status === 'in_progress' &&
        task.role === 'C' &&
        (task.tiltAdjustment ? (
          <TiltAdjustmentForm task={task} busy={busy} onAction={onAction} />
        ) : (
          <TreatmentForm task={task} busy={busy} onAction={onAction} />
        ))}
      {task.status === 'completed' && <CompletedResult task={task} />}
    </article>
  )
}
