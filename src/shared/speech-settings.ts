export const SPEECH_CHANNELS = {
  get: 'speech-settings:get',
  save: 'speech-settings:save',
  test: 'speech-settings:test'
} as const

export type SpeechMode = 'recorded' | 'offline' | 'qwen'
export type SpeechRegion = 'beijing' | 'singapore'
export const QWEN_TTS_MODEL = 'qwen3-tts-instruct-flash'
export const QWEN_STANDARD_TTS_MODEL = 'qwen3-tts-flash'
export type QwenSpeechModel = typeof QWEN_TTS_MODEL | typeof QWEN_STANDARD_TTS_MODEL
export const DEFAULT_SPEECH_VOICE = 'Elias'
export const SPEECH_STYLE_LABEL = '中性系统提示 · 语调平稳 · 无情绪渲染'
export const QWEN_SPEECH_INSTRUCTIONS =
  '使用标准普通话，以正式的智能助手系统提示风格播报。语气客观、中性，不带情感色彩；音调平直、起伏小，语速适中且均匀，音量稳定，吐字清晰，按标点简洁停顿，句尾平稳收束。不要播音腔、讲故事腔或刻意强调重点；不要热情、亲昵、激动、悲伤或戏剧化表达，不要夸张重音、尾音上扬、拖腔、笑声或叹息。只朗读提供的文字。'

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
  activeModel?: QwenSpeechModel
}

export interface SpeechSettingsAPI {
  get: () => Promise<SpeechSettingsStatus>
  save: (input: SpeechSettingsInput) => Promise<SpeechSettingsStatus>
  test: () => Promise<{ ok: boolean; message: string; audio?: Uint8Array }>
}
