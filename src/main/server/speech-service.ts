import type { SpeechSettingsInput, SpeechSettingsStatus } from '../../shared/speech-settings'
import type { SpeechSettingsStore } from '../speech-settings'
import { synthesizeQwenSpeech, type SpeechFetch } from './qwen-speech'
import type { SpeechAudio } from './speech'

export class SpeechService {
  private lastCloudError: string | null = null
  private retryAfter = 0
  private seenRevision = -1
  private testJob?: Promise<{ ok: boolean; message: string; audio?: Uint8Array }>

  constructor(
    private readonly store: SpeechSettingsStore,
    private readonly offline: (text: string) => Promise<Buffer>,
    private readonly request: SpeechFetch = globalThis.fetch,
    private readonly now: () => number = Date.now
  ) {}

  private resetOnChange(): void {
    if (this.seenRevision === this.store.revision) return
    this.seenRevision = this.store.revision
    this.lastCloudError = null
    this.retryAfter = 0
  }

  cacheNamespace(): string {
    return String(this.store.revision)
  }

  status(): SpeechSettingsStatus {
    this.resetOnChange()
    return { ...this.store.status(), lastCloudError: this.lastCloudError }
  }

  async save(input: SpeechSettingsInput): Promise<SpeechSettingsStatus> {
    await this.store.save(input)
    return this.status()
  }

  async synthesize(text: string): Promise<SpeechAudio> {
    this.resetOnChange()
    const config = this.store.snapshot()
    const revision = this.store.revision
    if (config.mode === 'qwen' && this.now() >= this.retryAfter) {
      try {
        const data = await synthesizeQwenSpeech(text, config, this.request)
        if (revision === this.store.revision) {
          this.lastCloudError = null
          this.retryAfter = 0
        }
        return { data, provider: 'qwen' }
      } catch (error) {
        if (revision === this.store.revision) {
          this.lastCloudError = error instanceof Error ? error.message : '云端语音暂不可用。'
          this.retryAfter = this.now() + 30_000
        }
      }
    }
    // If any cloud segment failed, discard every segment and synthesize the full text offline.
    return {
      data: await this.offline(text),
      provider: 'offline',
      cacheTtlMs: config.mode === 'qwen' ? 5_000 : undefined
    }
  }

  test(): Promise<{ ok: boolean; message: string; audio?: Uint8Array }> {
    if (this.testJob) return this.testJob
    this.testJob = this.testCloud().finally(() => {
      this.testJob = undefined
    })
    return this.testJob
  }

  private async testCloud(): Promise<{ ok: boolean; message: string; audio?: Uint8Array }> {
    this.resetOnChange()
    const revision = this.store.revision
    try {
      const data = await synthesizeQwenSpeech(
        '阿里云语音连接成功。您有新的工单任务，请注意安全。',
        this.store.snapshot(),
        this.request
      )
      if (revision === this.store.revision) {
        this.lastCloudError = null
        this.retryAfter = 0
      }
      return {
        ok: true,
        message: 'Qwen3-TTS 云端测试成功，可播放下方试听音频。',
        audio: new Uint8Array(data)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '云端语音测试失败。'
      if (revision === this.store.revision) this.lastCloudError = message
      return { ok: false, message }
    }
  }
}
