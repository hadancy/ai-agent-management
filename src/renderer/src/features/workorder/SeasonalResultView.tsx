import {
  SEASONAL_ROLES,
  seasonalChecklist,
  type SeasonalInspectionResult
} from '../../../../shared/task-evidence'
import type { TiltAdjustmentPlan } from '../../../../shared/tilt-adjustment'
import { STATION_TIME_ZONE } from '../../../../shared/plc-clock'
import './task-evidence.css'

export default function SeasonalResultView({
  result,
  plan
}: {
  result: SeasonalInspectionResult
  plan: TiltAdjustmentPlan
}): React.JSX.Element {
  const rows = seasonalChecklist(result.role, plan)
  const signed = new Date(result.signedAt)
  return (
    <div className="seasonal-submitted-result">
      <h5>{SEASONAL_ROLES[result.role].title}</h5>
      <div className="seasonal-checklist-scroll">
        <table className="seasonal-checklist">
          <thead>
            <tr>
              <th>检查项</th>
              <th>标准 / 内容</th>
              <th>确认</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, standard], index) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{standard}</td>
                <td>{result.checks[index] ? '☑' : '□'}</td>
                <td>{result.remarks[index] || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="seasonal-submitted-meta">
        {result.beforeAngle !== undefined && (
          <div>
            <dt>调整前实际倾角</dt>
            <dd>{result.beforeAngle}°</dd>
          </div>
        )}
        {result.adjustedAngle !== undefined && (
          <div>
            <dt>调整后实测倾角</dt>
            <dd>{result.adjustedAngle}°</dd>
          </div>
        )}
        {result.sampleCount !== undefined && (
          <div>
            <dt>抽检点位数量</dt>
            <dd>{result.sampleCount} 个</dd>
          </div>
        )}
        {result.archiveNumber && (
          <div>
            <dt>档案编号</dt>
            <dd>{result.archiveNumber}</dd>
          </div>
        )}
        {result.photoReference && (
          <div>
            <dt>附照片编号</dt>
            <dd>{result.photoReference}</dd>
          </div>
        )}
        <div>
          <dt>签字角色</dt>
          <dd>{SEASONAL_ROLES[result.role].signer}</dd>
        </div>
        <div>
          <dt>签字</dt>
          <dd>{result.signature}</dd>
        </div>
        <div>
          <dt>日期时间</dt>
          <dd>
            {Number.isFinite(signed.getTime())
              ? new Intl.DateTimeFormat('zh-CN', {
                  timeZone: STATION_TIME_ZONE,
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false
                }).format(signed)
              : '—'}
          </dd>
        </div>
      </dl>
    </div>
  )
}
