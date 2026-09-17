import { useEffect, useRef, useState } from 'react'
import { MAX_TASK_PHOTOS, type TaskPhoto } from '../../../../shared/task-evidence'
import TaskPhotoGallery from '../workorder/TaskPhotoGallery'
import { deleteTaskPhoto, listTaskPhotos, uploadTaskPhoto } from './taskPhotos'

export default function TaskPhotoPicker({
  taskId,
  serviceOrigin,
  submittedPhotos,
  disabled,
  onChange,
  onBusy
}: {
  taskId: string
  serviceOrigin: string
  submittedPhotos: TaskPhoto[]
  disabled: boolean
  onChange: (photos: TaskPhoto[]) => void
  onBusy: (busy: boolean) => void
}): React.JSX.Element {
  const [photos, setPhotos] = useState<TaskPhoto[]>([])
  const [loadedKey, setLoadedKey] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const working = useRef(false)
  const mounted = useRef(true)
  const savedIds = submittedPhotos.map((photo) => photo.id).join(',')
  const resourceKey = JSON.stringify([serviceOrigin, taskId, savedIds, revision])
  const loading = loadedKey !== resourceKey
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    onBusy(true)
    void listTaskPhotos(serviceOrigin, taskId, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return
        const pending = items.filter((photo) => !savedIds.split(',').includes(photo.id))
        setPhotos(pending)
        onChange(pending)
        setError('')
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : '读取照片失败，请重试')
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadedKey(resourceKey)
          onBusy(false)
        }
      })
    return () => controller.abort()
  }, [serviceOrigin, taskId, savedIds, resourceKey, onChange, onBusy])
  const upload = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length || working.current || disabled || loading) return
    if (photos.length + submittedPhotos.length + files.length > MAX_TASK_PHOTOS) {
      setError(`每个任务最多${MAX_TASK_PHOTOS}张照片`)
      return
    }
    working.current = true
    setUploading(true)
    onBusy(true)
    setError('')
    const next = [...photos]
    try {
      for (const file of files) {
        const photo = await uploadTaskPhoto(serviceOrigin, taskId, file)
        if (!mounted.current) return
        next.push(photo)
        setPhotos([...next])
        onChange([...next])
      }
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : '上传失败，请重试')
    } finally {
      working.current = false
      if (mounted.current) {
        setUploading(false)
        onBusy(false)
      }
    }
  }
  const remove = async (photo: TaskPhoto): Promise<void> => {
    if (working.current || disabled) return
    working.current = true
    setUploading(true)
    onBusy(true)
    try {
      await deleteTaskPhoto(serviceOrigin, taskId, photo.id)
      if (!mounted.current) return
      const next = photos.filter((item) => item.id !== photo.id)
      setPhotos(next)
      onChange(next)
      setError('')
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : '移除失败')
    } finally {
      working.current = false
      if (mounted.current) {
        setUploading(false)
        onBusy(false)
      }
    }
  }
  return (
    <section className="task-photo-picker" aria-label="照片回传">
      <div className="task-photo-picker-heading">
        <strong>现场照片</strong>
        <span>
          {submittedPhotos.length + photos.length}/{MAX_TASK_PHOTOS}
        </span>
      </div>
      <p>支持 JPG、PNG、WebP；提交表单后，照片与结果一起回传至 B 平台。</p>
      {submittedPhotos.length > 0 && (
        <>
          <small>已回传照片</small>
          <TaskPhotoGallery photos={submittedPhotos} serviceOrigin={serviceOrigin} />
        </>
      )}
      <TaskPhotoGallery
        photos={photos}
        serviceOrigin={serviceOrigin}
        disabled={disabled || uploading || loading}
        onRemove={(photo) => void remove(photo)}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        aria-label="上传现场照片"
        onChange={(event) => void upload(event)}
        hidden
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        aria-label="拍摄现场照片"
        onChange={(event) => void upload(event)}
        hidden
      />
      <div className="task-photo-picker-actions">
        <button
          type="button"
          disabled={
            disabled ||
            uploading ||
            loading ||
            photos.length + submittedPhotos.length >= MAX_TASK_PHOTOS
          }
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? '照片处理中…' : loading ? '读取照片…' : '上传照片'}
        </button>
        <button
          type="button"
          disabled={
            disabled ||
            uploading ||
            loading ||
            photos.length + submittedPhotos.length >= MAX_TASK_PHOTOS
          }
          onClick={() => cameraInput.current?.click()}
        >
          拍照 / 选图
        </button>
      </div>
      {error && (
        <p role="alert" className="task-form-error">
          {error}
          <button
            type="button"
            disabled={uploading}
            onClick={() => setRevision((value) => value + 1)}
          >
            重新同步照片
          </button>
        </p>
      )}
    </section>
  )
}
