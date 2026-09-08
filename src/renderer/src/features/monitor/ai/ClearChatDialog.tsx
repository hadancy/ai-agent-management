import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import AssistantIcon from './AssistantIcon'
import '../styles/clear-chat-dialog.css'

export default function ClearChatDialog({
  open,
  onCancel,
  onConfirm
}: {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element | null {
  const dialogRef = useRef<HTMLElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    cancelButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
        return
      }
      if (event.key !== 'Tab') return
      const buttons =
        dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
      if (!buttons?.length) return
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      const focused = document.activeElement
      if (!dialogRef.current?.contains(focused)) {
        event.preventDefault()
        cancelButtonRef.current?.focus()
      } else if (event.shiftKey && focused === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      if (
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected &&
        !previousFocus.matches(':disabled')
      ) {
        previousFocus.focus()
      }
    }
  }, [onCancel, open])

  if (!open) return null

  return createPortal(
    <div
      className="clear-chat-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        ref={dialogRef}
        className="clear-chat-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clear-chat-dialog-title"
        aria-describedby="clear-chat-dialog-description"
      >
        <button
          type="button"
          className="clear-chat-dialog__close"
          onClick={onCancel}
          aria-label="关闭清空记录确认框"
        >
          <AssistantIcon name="close" />
        </button>
        <span className="clear-chat-dialog__icon" aria-hidden="true">
          <AssistantIcon name="trash" />
        </span>
        <h2 id="clear-chat-dialog-title">清空聊天记录？</h2>
        <p id="clear-chat-dialog-description">全部聊天记录将被清空，已生成的工单会保留。</p>
        <div className="clear-chat-dialog__actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="clear-chat-dialog__cancel"
            onClick={onCancel}
          >
            取消
          </button>
          <button type="button" className="clear-chat-dialog__confirm" onClick={onConfirm}>
            清空记录
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}
