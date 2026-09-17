import { useEffect, useRef, useState } from 'react'
import type { TaskPhoto } from '../../../../shared/task-evidence'
import './task-evidence.css'

export default function TaskPhotoGallery({
  photos,
  serviceOrigin,
  onRemove,
  disabled = false
}: {
  photos: TaskPhoto[]
  serviceOrigin: string
  onRemove?: (photo: TaskPhoto) => void
  disabled?: boolean
}): React.JSX.Element {
  const [selected, setSelected] = useState<TaskPhoto | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (selected) dialog.current?.showModal()
    else dialog.current?.close()
  }, [selected])
  const url = (photo: TaskPhoto): string =>
    `${serviceOrigin}/api/task-photos/${encodeURIComponent(photo.id)}`
  return (
    <>
      <div className="task-photo-gallery">
        {photos.map((photo) => (
          <figure key={photo.id}>
            <button
              type="button"
              className="task-photo-preview"
              aria-label={`查看照片：${photo.fileName}`}
              onClick={() => setSelected(photo)}
            >
              <img src={url(photo)} alt={photo.fileName} loading="lazy" />
            </button>
            <figcaption>{photo.fileName}</figcaption>
            {onRemove && (
              <button
                type="button"
                className="task-photo-remove"
                disabled={disabled}
                onClick={() => onRemove(photo)}
              >
                移除
              </button>
            )}
          </figure>
        ))}
      </div>
      <dialog
        ref={dialog}
        className="task-photo-dialog"
        onCancel={() => setSelected(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelected(null)
        }}
      >
        <button type="button" onClick={() => setSelected(null)} aria-label="关闭照片预览">
          关闭
        </button>
        {selected && (
          <>
            <img src={url(selected)} alt={selected.fileName} />
            <p>{selected.fileName}</p>
          </>
        )}
      </dialog>
    </>
  )
}
