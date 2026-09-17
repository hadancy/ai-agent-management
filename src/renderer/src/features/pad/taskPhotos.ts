import { MAX_TASK_PHOTO_BYTES, type TaskPhoto } from '../../../../shared/task-evidence'

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json()
  if (!response.ok) throw new Error(body.message ?? '照片操作失败，请重试')
  return body
}
export async function listTaskPhotos(
  origin: string,
  taskId: string,
  signal?: AbortSignal
): Promise<TaskPhoto[]> {
  return (
    await jsonResponse(
      await fetch(`${origin}/api/tasks/${encodeURIComponent(taskId)}/photos`, { signal })
    )
  ).items as TaskPhoto[]
}
function readImage(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('读取照片失败，请重新选择'))
    reader.readAsDataURL(blob)
  })
}
async function preparePhoto(file: File): Promise<{ fileName: string; data: string }> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('请选择 JPG、PNG 或 WebP 照片')
  if (file.size > 20 * 1024 * 1024) throw new Error('原始照片请小于20MB')
  if (file.size <= MAX_TASK_PHOTO_BYTES) return { fileName: file.name, data: await readImage(file) }
  const url = URL.createObjectURL(file)
  try {
    const picture = new Image()
    await new Promise<void>((resolve, reject) => {
      picture.onload = () => resolve()
      picture.onerror = () => reject(new Error('照片无法解码'))
      picture.src = url
    })
    const scale = Math.min(1, 2048 / Math.max(picture.naturalWidth, picture.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(picture.naturalWidth * scale)
    canvas.height = Math.round(picture.naturalHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前设备无法压缩照片，请选择小于3MB的图片')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(picture, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('照片压缩失败'))),
        'image/jpeg',
        0.85
      )
    )
    if (blob.size > MAX_TASK_PHOTO_BYTES) throw new Error('压缩后的照片仍超过3MB，请选择较小图片')
    return { fileName: `${file.name.replace(/\.[^.]+$/, '')}.jpg`, data: await readImage(blob) }
  } finally {
    URL.revokeObjectURL(url)
  }
}
export async function uploadTaskPhoto(
  origin: string,
  taskId: string,
  file: File
): Promise<TaskPhoto> {
  const body = await preparePhoto(file)
  return (
    await jsonResponse(
      await fetch(`${origin}/api/tasks/${encodeURIComponent(taskId)}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    )
  ).photo as TaskPhoto
}
export async function deleteTaskPhoto(origin: string, taskId: string, id: string): Promise<void> {
  await jsonResponse(
    await fetch(
      `${origin}/api/tasks/${encodeURIComponent(taskId)}/photos/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    )
  )
}
