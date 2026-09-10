export type VoiceStatus = 'idle' | 'loading' | 'speaking' | 'completed' | 'blocked' | 'error'

export interface VoicePlaybackState {
  status: VoiceStatus
  message: string
}

function silence(): Blob {
  const bytes = new Uint8Array(44 + 1600)
  const data = new DataView(bytes.buffer)
  const label = (offset: number, text: string): void => {
    ;[...text].forEach((character, index) => data.setUint8(offset + index, character.charCodeAt(0)))
  }
  label(0, 'RIFF')
  data.setUint32(4, bytes.length - 8, true)
  label(8, 'WAVEfmt ')
  data.setUint32(16, 16, true)
  data.setUint16(20, 1, true)
  data.setUint16(22, 1, true)
  data.setUint32(24, 8000, true)
  data.setUint32(28, 16000, true)
  data.setUint16(32, 2, true)
  data.setUint16(34, 16, true)
  label(36, 'data')
  data.setUint32(40, 1600, true)
  return new Blob([bytes], { type: 'audio/wav' })
}

export class PlatformSpeechPlayer {
  private static active?: PlatformSpeechPlayer
  private readonly audio = new Audio()
  private controller?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private url?: string
  private generation = 0
  private ready = false

  constructor(
    private readonly serviceOrigin: string,
    private readonly update: (state: VoicePlaybackState) => void
  ) {
    this.audio.preload = 'auto'
  }

  stop(): void {
    this.generation++
    clearTimeout(this.timer)
    this.controller?.abort()
    this.controller = undefined
    if (PlatformSpeechPlayer.active === this) PlatformSpeechPlayer.active = undefined
    this.ready = false
    this.audio.onplaying = null
    this.audio.onended = null
    this.audio.onerror = null
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = undefined
  }

  dispose(): void {
    this.stop()
  }

  private primeAudio(): void {
    const url = URL.createObjectURL(silence())
    this.url = url
    this.audio.src = url
    // Invoke play in the tap handler; subsequent asynchronous audio may still need another tap.
    try {
      void this.audio.play()?.catch(() => {})
    } catch {
      /* Real playback exposes any error. */
    }
  }

  play(text: string, completed: () => void = () => {}, userInitiated = false): void {
    const previous = PlatformSpeechPlayer.active
    if (previous && previous !== this) {
      previous.stop()
      previous.update({ status: 'idle', message: '播报已停止' })
    }
    this.stop()
    PlatformSpeechPlayer.active = this
    if (userInitiated) this.primeAudio()
    void this.playAudio(text, completed, this.generation)
  }

  private async playAudio(text: string, completed: () => void, generation: number): Promise<void> {
    if (generation !== this.generation) return
    this.update({ status: 'loading', message: '平台正在生成中文语音…' })
    const controller = new AbortController()
    this.controller = controller
    const timeout = setTimeout(() => controller.abort(), 145_000)
    try {
      const response = await fetch(`${this.serviceOrigin}/api/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(
          body.message ?? `平台音频请求失败（${response.status}），请更新并重启平台后重试。`
        )
      }
      if (!response.headers.get('Content-Type')?.includes('audio/'))
        throw new Error('平台尚未提供音频服务，请更新并重启平台后重试。')
      const blob = await response.blob()
      if (generation !== this.generation) return
      if (this.url) URL.revokeObjectURL(this.url)
      this.url = URL.createObjectURL(blob)
      this.audio.src = this.url
      this.ready = true
      let started = false
      this.audio.onplaying = () => {
        if (generation === this.generation) {
          started = true
          clearTimeout(this.timer)
          this.update({ status: 'speaking', message: '正在播放语音' })
        }
      }
      this.audio.onended = () => {
        if (generation !== this.generation || !started || !this.audio.ended) return
        this.stop()
        this.update({ status: 'completed', message: '最近一次播报已完成' })
        completed()
      }
      this.audio.onerror = () => {
        if (generation === this.generation) {
          clearTimeout(this.timer)
          this.update({
            status: 'error',
            message: '浏览器无法播放音频，请检查媒体音量或换用其他浏览器。'
          })
        }
      }
      this.resume()
    } catch (error) {
      if (generation !== this.generation) return
      this.update({
        status: 'error',
        message: controller.signal.aborted
          ? '生成音频超时，请点击重试。'
          : error instanceof Error
            ? error.message
            : '平台语音请求失败，请重试。'
      })
    } finally {
      clearTimeout(timeout)
      if (this.controller === controller) this.controller = undefined
    }
  }

  resume(): boolean {
    if (!this.ready) return false
    const generation = this.generation
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (generation === this.generation)
        this.update({ status: 'blocked', message: '浏览器尚未开始播放，请点击“点击播放”。' })
    }, 10_000)
    const failed = (error: unknown): void => {
      if (generation !== this.generation) return
      clearTimeout(this.timer)
      this.update(
        error instanceof Error && error.name === 'NotAllowedError'
          ? { status: 'blocked', message: '音频已准备好，浏览器需要您点击“点击播放”。' }
          : { status: 'error', message: '音频播放失败，请检查媒体音量后重试。' }
      )
    }
    try {
      void this.audio.play()?.catch(failed)
    } catch (error) {
      failed(error)
    }
    return true
  }
}
