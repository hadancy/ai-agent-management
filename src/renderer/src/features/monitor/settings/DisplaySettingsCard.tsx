import { useState } from 'react'
import {
  DEFAULT_FONT_SCALE,
  FONT_SIZE_OPTIONS,
  saveFontScale,
  useFontScale
} from '../../../settings/fontSize'

export default function DisplaySettingsCard(): React.JSX.Element {
  const fontScale = useFontScale()
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle')

  const changeFontScale = (scale: number): void => {
    setSaveState(saveFontScale(scale) ? 'saved' : 'error')
  }

  return (
    <div className="settings-grid display-settings">
      <section className="settings-card" aria-labelledby="font-size-title">
        <div className="settings-card__title">
          <span aria-hidden="true">Aa</span>
          <div>
            <h3 id="font-size-title">整体字体大小</h3>
            <p>调整全软件的文字大小，选择后立即生效。</p>
          </div>
        </div>

        <fieldset className="font-size-options">
          <legend>选择字号</legend>
          {FONT_SIZE_OPTIONS.map(({ label, scale }) => (
            <label className="font-size-option" key={scale}>
              <input
                type="radio"
                name="app-font-size"
                value={scale}
                checked={fontScale === scale}
                onChange={() => changeFontScale(scale)}
              />
              <span>{label}</span>
              <small>{Math.round(scale * 100)}%</small>
            </label>
          ))}
        </fieldset>

        <p className="display-settings__hint">
          适用于导航、正文、表单和图表文字，自动保存到当前设备。
        </p>
        <div className="settings-actions display-settings__actions">
          <p role="status" className={saveState === 'error' ? 'settings-error' : undefined}>
            {saveState === 'error'
              ? '已应用，但保存失败，重启后需重新设置。'
              : saveState === 'saved'
                ? '已自动保存'
                : `当前字号：${Math.round(fontScale * 100)}%`}
          </p>
          <button
            type="button"
            className="settings-reset"
            onClick={() => changeFontScale(DEFAULT_FONT_SCALE)}
          >
            恢复默认字号
          </button>
        </div>
      </section>

      <aside className="settings-card settings-preview font-size-preview" aria-label="字号预览">
        <span className="settings-preview__eyebrow">实时预览</span>
        <h3>让每一条信息清晰易读</h3>
        <p>光伏设备运行正常，您可以在综合监控中查看实时数据与设备状态。</p>
        <div className="settings-range">
          <span>光伏组串电压</span>
          <strong>613.0 V</strong>
        </div>
        <p className="font-size-preview__caption">提示文字、数字和标题会保持原有的大小层次。</p>
      </aside>
    </div>
  )
}
