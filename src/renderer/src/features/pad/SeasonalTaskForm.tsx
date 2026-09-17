import { formatMeasurement } from '../../../../shared/number-format'
import { useState, type ReactNode } from 'react'
import { getPlanAdvice } from '../../../../shared/agrivoltaic-analysis'
import { SEASONAL_ROLES, seasonalChecklist } from '../../../../shared/task-evidence'
import type { PadTask, TaskAction } from './taskClient'

export default function SeasonalTaskForm({
  task,
  busy,
  photoCount,
  photos,
  onAction
}: {
  task: PadTask
  busy: boolean
  photoCount: number
  photos: ReactNode
  onAction: (task: PadTask, action: TaskAction, body?: Record<string, unknown>) => Promise<void>
}): React.JSX.Element {
  const rows = seasonalChecklist(task.role, task.tiltAdjustment!)
  const advice = getPlanAdvice(task.tiltAdjustment!)
  const [checks, setChecks] = useState(() => rows.map(() => false))
  const [remarks, setRemarks] = useState<string[]>(() =>
    rows.map((_, index) => (task.role === 'A' && index === 0 ? '坡耕地重点抽检' : ''))
  )
  const [signature, setSignature] = useState('')
  const [angle, setAngle] = useState('')
  const [samples, setSamples] = useState('')
  const [archive, setArchive] = useState('')
  const [photoReference, setPhotoReference] = useState('')
  const [error, setError] = useState('')
  const profile = SEASONAL_ROLES[task.role]
  return (
    <form
      className="task-result-form seasonal-task-form"
      onChange={() => setError('')}
      onSubmit={(event) => {
        event.preventDefault()
        if (busy || !task.canSubmit) return
        if (checks.some((value) => !value)) {
          setError('请逐项检查并全部确认后提交')
          return
        }
        if (!signature.trim()) {
          setError('请填写签字姓名')
          return
        }
        if (!photoCount) {
          setError('请至少上传一张现场照片')
          return
        }
        if (
          task.role === 'B' &&
          (!angle.trim() ||
            !Number.isFinite(Number(angle)) ||
            Number(angle) < 0 ||
            Number(angle) > 90)
        ) {
          setError('请填写调整前实际倾角（0至90度）')
          return
        }
        if (
          task.role === 'C' &&
          (!angle.trim() ||
            !Number.isFinite(Number(angle)) ||
            Number(angle) < advice.minAngle ||
            Number(angle) > advice.maxAngle)
        ) {
          setError(
            `实际倾角必须为${formatMeasurement(advice.minAngle)}至${formatMeasurement(advice.maxAngle)}度`
          )
          return
        }
        if (
          task.role === 'A' &&
          (!Number.isInteger(Number(samples)) ||
            Number(samples) < 1 ||
            Number(samples) > 10000 ||
            !archive.trim())
        ) {
          setError('请填写抽检点位数量和档案编号')
          return
        }
        setError('')
        void onAction(task, 'submit', {
          checks,
          remarks,
          signature: signature.trim(),
          ...(task.role === 'B'
            ? { beforeAngle: Number(angle), photoReference: photoReference.trim() }
            : task.role === 'C'
              ? { adjustedAngle: Number(angle) }
              : { sampleCount: Number(samples), archiveNumber: archive.trim() })
        })
      }}
    >
      <div className="task-form-heading">
        <strong>{profile.title}</strong>
        <span>逐项确认后，签字并回传至 B 平台</span>
      </div>
      <div className="seasonal-checklist-scroll">
        <table className="seasonal-checklist">
          <thead>
            <tr>
              <th>序号</th>
              <th>{task.role === 'C' ? '作业工序' : task.role === 'A' ? '验收项' : '检查项目'}</th>
              <th>
                {task.role === 'C' ? '作业内容' : task.role === 'A' ? '验收标准' : '检查标准'}
              </th>
              <th>
                {task.role === 'C' ? '完成确认' : task.role === 'A' ? '验收结果' : '检查结果'}
              </th>
              {task.role === 'A' && <th>抽检点位数量</th>}
              {task.role !== 'C' && <th>备注</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, standard], index) => (
              <tr key={label}>
                <td>{index + 1}</td>
                <th scope="row">{label}</th>
                <td>{standard}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`确认${label}`}
                    checked={checks[index]}
                    disabled={busy}
                    onChange={(event) =>
                      setChecks((current) =>
                        current.map((value, position) =>
                          position === index ? event.target.checked : value
                        )
                      )
                    }
                  />
                </td>
                {task.role === 'A' && (
                  <td>
                    {index === 0 ? (
                      <label className="seasonal-inline-input">
                        <input
                          type="number"
                          aria-label="抽检点位数量"
                          min="1"
                          max="10000"
                          step="1"
                          value={samples}
                          disabled={busy}
                          onChange={(event) => setSamples(event.target.value)}
                        />
                        个
                      </label>
                    ) : (
                      '—'
                    )}
                  </td>
                )}
                {task.role !== 'C' && (
                  <td>
                    {!(task.role === 'A' && index === 4) && (
                      <input
                        type="text"
                        aria-label={`${label}备注`}
                        maxLength={500}
                        value={remarks[index]}
                        disabled={busy}
                        onChange={(event) =>
                          setRemarks((current) =>
                            current.map((value, position) =>
                              position === index ? event.target.value : value
                            )
                          )
                        }
                      />
                    )}
                    {task.role === 'B' && index === 3 && (
                      <label>
                        附照片编号
                        <input
                          type="text"
                          aria-label="附照片编号"
                          maxLength={160}
                          value={photoReference}
                          disabled={busy}
                          onChange={(event) => setPhotoReference(event.target.value)}
                          placeholder="可填照片名称或编号"
                        />
                      </label>
                    )}
                    {task.role === 'A' && index === 4 && (
                      <label>
                        档案编号
                        <input
                          type="text"
                          aria-label="档案编号"
                          maxLength={160}
                          value={archive}
                          disabled={busy}
                          onChange={(event) => setArchive(event.target.value)}
                        />
                      </label>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {task.role !== 'A' && (
        <label className="task-field">
          <span>
            {task.role === 'B'
              ? '调整前实际倾角（°）'
              : `调整后实测倾角（${formatMeasurement(advice.minAngle)}–${formatMeasurement(advice.maxAngle)}°）`}
          </span>
          <input
            type="number"
            aria-label={task.role === 'B' ? '调整前实际倾角' : '调整后实测倾角'}
            min={task.role === 'B' ? 0 : advice.minAngle}
            max={task.role === 'B' ? 90 : advice.maxAngle}
            step="0.1"
            value={angle}
            disabled={busy}
            onChange={(event) => setAngle(event.target.value)}
          />
        </label>
      )}
      {photos}
      <div className="seasonal-signature">
        <div>
          <span>角色</span>
          <strong>{profile.signer}</strong>
        </div>
        <label>
          <span>签字</span>
          <input
            type="text"
            aria-label="签字姓名"
            placeholder="填写本人姓名"
            maxLength={60}
            value={signature}
            disabled={busy}
            onChange={(event) => setSignature(event.target.value)}
          />
        </label>
        <div>
          <span>日期时间</span>
          <small>提交时自动记录</small>
        </div>
      </div>
      {error && (
        <p className="task-form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="task-primary-button" disabled={busy || !task.canSubmit}>
        {busy ? '正在处理…' : '提交并回传 B 平台'}
      </button>
    </form>
  )
}
