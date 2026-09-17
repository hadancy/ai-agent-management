import {
  QWEN_TTS_MODEL,
  QWEN_STANDARD_TTS_MODEL,
  type QwenSpeechModel,
  type SpeechSettingsInput,
  type SpeechSettingsStatus
} from '../../shared/speech-settings'
import type { SpeechSettingsStore } from '../speech-settings'
import {
  QwenModelAccessError,
  synthesizeQwenSpeech,
  type QwenSpeechConfig,
  type SpeechFetch
} from './qwen-speech'
import type { SpeechAudio } from './speech'

export class SpeechService {
  private lastCloudError: string | null = null
  private retryAfter = 0
  private seenRevision = -1
  private cloudModel: QwenSpeechModel = QWEN_TTS_MODEL
  private readonly settingsListeners = new Set<() => void>()
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
    this.cloudModel = QWEN_TTS_MODEL
  }

  cacheNamespace(): string {
    this.resetOnChange()
    return `${this.store.revision}:${this.cloudModel}`
  }

  onSettingsChanged(listener: () => void): () => void {
    this.settingsListeners.add(listener)
    return () => this.settingsListeners.delete(listener)
  }

  status(): SpeechSettingsStatus {
    this.resetOnChange()
    return {
      ...this.store.status(),
      lastCloudError: this.lastCloudError,
      activeModel: this.cloudModel
    }
  }

  async save(input: SpeechSettingsInput): Promise<SpeechSettingsStatus> {
    await this.store.save(input)
    const status = this.status()
    for (const listener of this.settingsListeners) listener()
    return status
  }

  private async synthesizeCloud(text: string, config: QwenSpeechConfig): Promise<Buffer> {
    const revision = this.store.revision
    const model = this.cloudModel
    try {
      return await synthesizeQwenSpeech(text, { ...config, model }, this.request)
    } catch (error) {
      if (!(error instanceof QwenModelAccessError) || model !== QWEN_TTS_MODEL) throw error
      // Keep the selected voice when the account permits only the standard Qwen model.
      const data = await synthesizeQwenSpeech(
        text,
        { ...config, model: QWEN_STANDARD_TTS_MODEL },
        this.request
      )
      if (revision === this.store.revision) this.cloudModel = QWEN_STANDARD_TTS_MODEL
      return data
    }
  }

  async synthesize(text: string): Promise<SpeechAudio> {
    this.resetOnChange()
    const config = this.store.snapshot()
    const revision = this.store.revision
    if (config.mode === 'qwen' && this.now() >= this.retryAfter) {
      try {
        const data = await this.synthesizeCloud(text, config)
        if (revision === this.store.revision) {
          this.lastCloudError = null
          this.retryAfter = 0
        }
        return { data, provider: 'qwen', voice: config.voice }
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
      fallback: config.mode === 'qwen',
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
      const data = await this.synthesizeCloud(
        '系统通知。语音服务连接正常。当前有一项待处理工单，请相关人员按操作规程完成检查，并及时反馈处理结果。',
        this.store.snapshot()
      )
      if (revision === this.store.revision) {
        this.lastCloudError = null
        this.retryAfter = 0
      }
      return {
        ok: true,
        message:
          this.cloudModel === QWEN_STANDARD_TTS_MODEL
            ? 'Qwen3-TTS 云端测试成功，使用所选音色；当前账号无指令模型权限，情绪控制指令暂不可用。'
            : 'Qwen3-TTS 云端测试成功，可播放下方试听音频。',
        audio: new Uint8Array(data)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '云端语音测试失败。'
      if (revision === this.store.revision) this.lastCloudError = message
      return { ok: false, message }
    }
  }
}
