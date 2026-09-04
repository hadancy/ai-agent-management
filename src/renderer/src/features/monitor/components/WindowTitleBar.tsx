import { useState } from 'react'

export default function WindowTitleBar(): React.JSX.Element {
  const platform = window.electron?.process.platform
  const [maximized, setMaximized] = useState(false)
  const windowControls = window.api?.windowControls

  const toggleMaximize = (): void => {
    void windowControls?.toggleMaximize().then(setMaximized)
  }

  return (
    <header
      className={`window-titlebar window-titlebar--${platform ?? 'browser'}`}
      aria-label="应用窗口标题栏"
      onDoubleClick={toggleMaximize}
    >
      <div className="window-titlebar__controls" aria-label="窗口控制">
        <button
          type="button"
          className="window-control window-control--close"
          aria-label="关闭窗口"
          title="关闭"
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={() => void windowControls?.close()}
        />
        <button
          type="button"
          className="window-control window-control--minimize"
          aria-label="最小化窗口"
          title="最小化"
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={() => void windowControls?.minimize()}
        />
        <button
          type="button"
          className="window-control window-control--maximize"
          aria-label={maximized ? '还原窗口' : '最大化窗口'}
          title={maximized ? '还原' : '最大化'}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={toggleMaximize}
        />
      </div>
    </header>
  )
}
