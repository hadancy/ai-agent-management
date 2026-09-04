import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import '../styles/delete-work-order-dialog.css'

export default function DeleteWorkOrderDialog({
  open,
  orderNumber,
  deleting,
  onCancel,
  onConfirm
}: {
  open: boolean
  orderNumber: string
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element | null {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    cancelButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !deleting) onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleting, onCancel, open])

  if (!open) return null

  return createPortal(
    <div
      className="delete-order-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onCancel()
      }}
    >
      <section
        className="delete-order-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-order-dialog-title"
        aria-describedby="delete-order-dialog-description"
      >
        <div className="delete-order-dialog__icon" aria-hidden="true">
          <span>!</span>
        </div>
        <div className="delete-order-dialog__heading">
          <span>危险操作</span>
          <h2 id="delete-order-dialog-title">确认删除工单</h2>
        </div>

        <strong className="delete-order-dialog__number">{orderNumber}</strong>
        <p id="delete-order-dialog-description">删除后无法恢复，请确认该工单已不再需要。</p>
        <div className="delete-order-dialog__impact">
          <span>将同步删除</span>
          <strong>A / B / C 任务、执行结果与处理记录</strong>
        </div>

        <div className="delete-order-dialog__actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="delete-order-dialog__cancel"
            onClick={onCancel}
            disabled={deleting}
          >
            取消
          </button>
          <button
            type="button"
            className="delete-order-dialog__confirm"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting && <i aria-hidden="true" />}
            <span>{deleting ? '正在删除…' : '确认删除'}</span>
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}
