import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  resolveSpeechApiHost,
  type SpeechSettingsInput,
  type SpeechSettingsStatus
} from '../shared/speech-settings'

export interface SpeechSecretStorage {
  available: () => boolean
  encrypt: (value: string) => Buffer
  decrypt: (value: Buffer) => string
}

export class SpeechSettingsStore {
  private settings: SpeechSettingsInput = { mode: 'offline', region: 'beijing', voice: 'Cherry' }
  private savedKey = ''
  private warning = ''
  private version = 0
  private saving: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly filename: string,
    private readonly secrets: SpeechSecretStorage,
    private readonly environmentKey = process.env.DASHSCOPE_API_KEY?.trim() ?? ''
  ) {
    if (environmentKey) this.settings.mode = 'qwen'
  }

  async load(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.filename, 'utf8'))
      this.settings = this.validate(data)
      if (typeof data.encryptedApiKey === 'string' && data.encryptedApiKey) {
        if (!this.secrets.available()) throw new Error('ENCRYPTION_UNAVAILABLE')
        this.savedKey = this.secrets.decrypt(Buffer.from(data.encryptedApiKey, 'base64'))
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.settings.mode = 'offline'
        this.warning = '无法读取本机语音配置，请重新填写并保存；当前使用离线语音。'
      }
    }
  }

  private validate(input: unknown): SpeechSettingsInput {
    if (!input || typeof input !== 'object') throw new Error('语音设置格式不正确。')
    const data = input as SpeechSettingsInput
    if (!['offline', 'qwen'].includes(data.mode) || !['beijing', 'singapore'].includes(data.region))
      throw new Error('请选择有效的语音模式和服务地域。')
    if (typeof data.voice !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(data.voice.trim()))
      throw new Error('请填写有效的系统音色名称，例如 Cherry。')
    if (data.apiHost !== undefined && typeof data.apiHost !== 'string')
      throw new Error('API Host 格式不正确。')
    const apiHost = data.apiHost?.trim().toLowerCase() ?? ''
    resolveSpeechApiHost(data.region, apiHost)
    return { mode: data.mode, region: data.region, voice: data.voice.trim(), apiHost }
  }

  get revision(): number {
    return this.version
  }

  snapshot(): SpeechSettingsInput & { apiKey: string } {
    return { ...this.settings, apiKey: this.savedKey || this.environmentKey }
  }

  status(): SpeechSettingsStatus {
    return {
      ...this.settings,
      hasApiKey: Boolean(this.savedKey || this.environmentKey),
      keySource: this.savedKey ? 'saved' : this.environmentKey ? 'environment' : 'none',
      encryptionAvailable: this.secrets.available(),
      message: this.warning,
      lastCloudError: null
    }
  }

  save(input: SpeechSettingsInput): Promise<SpeechSettingsStatus> {
    const job = this.saving.catch(() => {}).then(() => this.persist(input))
    this.saving = job
    return job
  }

  private async persist(input: SpeechSettingsInput): Promise<SpeechSettingsStatus> {
    const next = this.validate(input)
    if (
      input.apiKey !== undefined &&
      (typeof input.apiKey !== 'string' ||
        input.apiKey.length > 1024 ||
        /\s/.test(input.apiKey.trim()) ||
        Array.from(input.apiKey).some((character) => character.charCodeAt(0) < 32))
    )
      throw new Error('API Key 格式不正确，请检查复制内容。')
    const key = input.clearApiKey ? '' : input.apiKey?.trim() || this.savedKey
    if (next.mode === 'qwen' && !(key || this.environmentKey))
      throw new Error('请先填写阿里云百炼 API Key。')
    if (next.mode === 'qwen' && (key || this.environmentKey).startsWith('sk-ws-') && !next.apiHost)
      throw new Error('业务空间 API Key 需要同时填写创建密钥时显示的 API Host。')
    if (key && !this.secrets.available())
      throw new Error('系统安全存储不可用，无法保存密钥。可通过 DASHSCOPE_API_KEY 环境变量配置。')
    let encoded = ''
    try {
      encoded = key ? this.secrets.encrypt(key).toString('base64') : ''
    } catch {
      throw new Error('系统密钥加密失败，请检查系统安全存储后重试。')
    }
    const temporary = `${this.filename}.tmp`
    try {
      await mkdir(dirname(this.filename), { recursive: true })
      await writeFile(temporary, JSON.stringify({ ...next, encryptedApiKey: encoded }), {
        mode: 0o600
      })
      await rename(temporary, this.filename)
    } catch {
      throw new Error('语音配置保存失败，请检查管理端的数据目录权限。')
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
    this.settings = next
    this.savedKey = key
    this.warning = ''
    this.version++
    return this.status()
  }
}
