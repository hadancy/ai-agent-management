import { useMemo, useState } from 'react'
import {
  DEFAULT_PHOTOVOLTAIC_SETTINGS,
  getNormalRange,
  type PhotovoltaicSettings
} from './photovoltaicSettings'
import '../styles/settings-center.css'
import { plcServiceOrigin } from '../../plc/api'
import SpeechSettingsCard from './SpeechSettingsCard'

type DraftSettings = {
  normalVoltage: string
  normalCurrent: string
  tolerancePercent: string
}

function toDraft(settings: PhotovoltaicSettings): DraftSettings {
  return {
    normalVoltage: String(settings.normalVoltage),
    normalCurrent: String(settings.normalCurrent),
    tolerancePercent: String(settings.tolerancePercent)
  }
}

export default function SettingsCenter({
  settings,
  onSave
}: {
  settings: PhotovoltaicSettings
  onSave: (settings: PhotovoltaicSettings) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<DraftSettings>(() => toDraft(settings))
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<'photovoltaic' | 'speech'>('photovoltaic')
  const parsed = useMemo<PhotovoltaicSettings>(
    () => ({
      normalVoltage: Number(draft.normalVoltage),
      normalCurrent: Number(draft.normalCurrent),
      tolerancePercent: Number(draft.tolerancePercent)
    }),
    [draft]
  )
  const valid =
    Number.isFinite(parsed.normalVoltage) &&
    parsed.normalVoltage > 0 &&
    Number.isFinite(parsed.normalCurrent) &&
    parsed.normalCurrent > 0 &&
    Number.isFinite(parsed.tolerancePercent) &&
    parsed.tolerancePercent >= 0 &&
    parsed.tolerancePercent < 100
  const voltageRange = valid
    ? getNormalRange(parsed.normalVoltage, parsed.tolerancePercent)
    : [0, 0]
  const currentRange = valid
    ? getNormalRange(parsed.normalCurrent, parsed.tolerancePercent)
    : [0, 0]

  const updateDraft = (field: keyof DraftSettings, value: string): void => {
    setSaved(false)
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const handleSave = (): void => {
    if (!valid) return
    onSave(parsed)
    setSaved(true)
  }

  const handleReset = (): void => {
    setDraft(toDraft(DEFAULT_PHOTOVOLTAIC_SETTINGS))
    onSave(DEFAULT_PHOTOVOLTAIC_SETTINGS)
    setSaved(true)
  }

  return (
    <section className="settings-center" aria-label="系统设置中心">
      <div className="settings-heading">
        <div>
          <span>系统配置</span>
          <h2>设置中心</h2>
          <p>配置光伏运行基准与全平台语音播报。</p>
        </div>
        <a
          className="settings-rule-state"
          href={`${plcServiceOrigin()}/plc`}
          target="_blank"
          rel="noreferrer"
        >
          PLC 点位调试 ↗
        </a>
      </div>

      <nav className="settings-tabs" aria-label="设置分类">
        <button
          type="button"
          aria-pressed={tab === 'photovoltaic'}
          onClick={() => setTab('photovoltaic')}
        >
          光伏参数
        </button>
        <button type="button" aria-pressed={tab === 'speech'} onClick={() => setTab('speech')}>
          语音播报
        </button>
      </nav>
      {tab === 'speech' ? (
        <SpeechSettingsCard />
      ) : (
        <div className="settings-grid">
          <form className="settings-card" onSubmit={(event) => event.preventDefault()}>
            <div className="settings-card__title">
              <span>PV</span>
              <div>
                <h3>光伏正常运行参数</h3>
                <p>适用于1—4号光伏组串</p>
              </div>
            </div>

            <label>
              <span>正常电压</span>
              <div className="settings-input">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={draft.normalVoltage}
                  onChange={(event) => updateDraft('normalVoltage', event.target.value)}
                />
                <b>V</b>
              </div>
            </label>
            <label>
              <span>正常电流</span>
              <div className="settings-input">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={draft.normalCurrent}
                  onChange={(event) => updateDraft('normalCurrent', event.target.value)}
                />
                <b>A</b>
              </div>
            </label>
            <label>
              <span>允许偏差</span>
              <div className="settings-input">
                <input
                  type="number"
                  min="0"
                  max="99"
                  step="0.1"
                  value={draft.tolerancePercent}
                  onChange={(event) => updateDraft('tolerancePercent', event.target.value)}
                />
                <b>%</b>
              </div>
            </label>

            {!valid && <p className="settings-error">请输入有效的正数，允许偏差范围为0—99%。</p>}
            <div className="settings-actions">
              <button type="button" className="settings-reset" onClick={handleReset}>
                恢复默认
              </button>
              <button
                type="button"
                className="settings-save"
                onClick={handleSave}
                disabled={!valid}
              >
                {saved ? '已保存' : '保存设置'}
              </button>
            </div>
          </form>

          <aside className="settings-card settings-preview">
            <span className="settings-preview__eyebrow">实时判定范围</span>
            <h3>正常运行区间</h3>
            <div className="settings-range">
              <span>电压范围</span>
              <strong>
                {voltageRange[0].toFixed(1)} — {voltageRange[1].toFixed(1)} V
              </strong>
            </div>
            <div className="settings-range">
              <span>电流范围</span>
              <strong>
                {currentRange[0].toFixed(2)} — {currentRange[1].toFixed(2)} A
              </strong>
            </div>
            <div className="settings-logic">
              <h4>能源流向判定逻辑</h4>
              <p>
                <i className="settings-dot settings-dot--normal" />
                电压、电流均在区间内：能源正常
              </p>
              <p>
                <i className="settings-dot settings-dot--low" />
                任意一项超出区间：电压/电流异常
              </p>
              <p>
                <i className="settings-dot settings-dot--off" />
                PLC离线或输出为0：断开/无输出
              </p>
            </div>
          </aside>
        </div>
      )}
    </section>
  )
}
