export const SPEECH_CHANNELS = {
  get: 'speech-settings:get',
  save: 'speech-settings:save',
  test: 'speech-settings:test'
} as const

export type SpeechMode = 'offline' | 'qwen'
export type SpeechRegion = 'beijing' | 'singapore'
export const QWEN_TTS_MODEL = 'qwen3-tts-flash'

export function resolveSpeechApiHost(region: SpeechRegion, apiHost = ''): string {
  const host = apiHost.trim().toLowerCase()
  const area = region === 'singapore' ? 'ap-southeast-1' : 'cn-beijing'
  if (!host)
    return region === 'singapore' ? 'dashscope-intl.aliyuncs.com' : 'dashscope.aliyuncs.com'
  if (!new RegExp(`^ws-[a-z0-9]+\\.${area}\\.maas\\.aliyuncs\\.com$`).test(host))
    throw new Error('API Host 必须填写与服务地域一致的百炼业务空间域名，不含 https:// 或路径。')
  return host
}

export interface SpeechSettingsInput {
  mode: SpeechMode
  region: SpeechRegion
  voice: string
  apiHost?: string
  apiKey?: string
  clearApiKey?: boolean
}

export interface SpeechSettingsStatus {
  mode: SpeechMode
  region: SpeechRegion
  voice: string
  apiHost?: string
  hasApiKey: boolean
  keySource: 'saved' | 'environment' | 'none'
  encryptionAvailable: boolean
  message: string
  lastCloudError: string | null
}

export interface SpeechSettingsAPI {
  get: () => Promise<SpeechSettingsStatus>
  save: (input: SpeechSettingsInput) => Promise<SpeechSettingsStatus>
  test: () => Promise<{ ok: boolean; message: string; audio?: Uint8Array }>
}
