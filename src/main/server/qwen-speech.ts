import {
  QWEN_TTS_MODEL,
  resolveSpeechApiHost,
  type SpeechRegion
} from '../../shared/speech-settings'

class CloudSpeechError extends Error {}

const MAX_AUDIO_BYTES = 24 * 1024 * 1024
export type SpeechFetch = typeof globalThis.fetch

export interface QwenSpeechConfig {
  apiKey: string
  region: SpeechRegion
  voice: string
  apiHost?: string
}

// Keep each request below the provider's 600-character limit, preserving all text.
export function splitSpeechText(text: string): string[] {
  const parts: string[] = []
  let rest = text
  while (rest.length > 500) {
    let end = 500
    if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--
    const prefix = rest.slice(0, end)
    const punctuation = [...prefix.matchAll(/[。！？；\n.!?;]/g)].at(-1)
    if (punctuation && punctuation.index! >= 200) end = punctuation.index! + 1
    parts.push(rest.slice(0, end))
    rest = rest.slice(end)
  }
  if (rest) parts.push(rest)
  return parts
}

async function readLimited(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) throw new CloudSpeechError('云端返回内容为空。')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      bytes += item.value.length
      if (bytes > limit) throw new CloudSpeechError('云端语音响应过大，请缩短播报文字。')
      chunks.push(item.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, bytes)
}

export function audioDownloadUrl(value: string): string {
  const url = new URL(value)
  // Qwen returns a signed OSS URL. Upgrade the documented HTTP URL to HTTPS,
  // never send our API key to OSS, and reject unexpected hosts or redirects.
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !/^[a-z0-9][a-z0-9.-]*\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname)
  )
    throw new CloudSpeechError('云端返回了不支持的音频地址。')
  url.protocol = 'https:'
  return url.toString()
}

export function joinSpeechWavs(files: Buffer[]): Buffer {
  const parts: Buffer[] = []
  let format: Buffer | undefined
  for (const file of files) {
    if (
      file.length < 44 ||
      file.toString('ascii', 0, 4) !== 'RIFF' ||
      file.toString('ascii', 8, 12) !== 'WAVE'
    )
      throw new CloudSpeechError('云端返回的音频格式无效。')
    let currentFormat: Buffer | undefined
    let currentAudio: Buffer | undefined
    for (let offset = 12; offset + 8 <= file.length;) {
      const size = file.readUInt32LE(offset + 4)
      const kind = file.toString('ascii', offset, offset + 4)
      let end = offset + 8 + size
      // Qwen's completed downloads can retain streaming WAV length sentinels.
      // Only these known RIFF/data pairs may use the actual response length.
      const riffSize = file.readUInt32LE(4)
      const streamingSize =
        (riffSize === 0x7fffffbf && size === 0x7fffff9b) ||
        (riffSize === 0xffffffff && size === 0xffffffff)
      if (kind === 'data' && streamingSize) end = file.length
      if (end > file.length) throw new CloudSpeechError('云端音频不完整，请重试。')
      if (kind === 'fmt ' && size >= 16) currentFormat = file.subarray(offset + 8, offset + 24)
      if (kind === 'data') currentAudio = file.subarray(offset + 8, end)
      offset = end + (size % 2)
    }
    if (
      !currentFormat ||
      !currentAudio?.length ||
      currentFormat.readUInt16LE(0) !== 1 ||
      currentFormat.readUInt16LE(14) !== 16 ||
      ![1, 2].includes(currentFormat.readUInt16LE(2)) ||
      currentFormat.readUInt16LE(12) !== currentFormat.readUInt16LE(2) * 2 ||
      currentFormat.readUInt32LE(4) < 8000 ||
      currentFormat.readUInt32LE(4) > 192000 ||
      currentFormat.readUInt32LE(8) !==
        currentFormat.readUInt32LE(4) * currentFormat.readUInt16LE(12) ||
      currentAudio.length % currentFormat.readUInt16LE(12) !== 0
    )
      throw new CloudSpeechError('云端音频不是可播放的 PCM WAV。')
    if (format && !format.equals(currentFormat))
      throw new CloudSpeechError('云端音频分段格式不一致。')
    format = currentFormat
    parts.push(currentAudio)
  }
  const data = Buffer.concat(parts)
  if (!format || !data.length || data.length + 44 > MAX_AUDIO_BYTES)
    throw new CloudSpeechError('云端语音大小无效。')
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(data.length + 36, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  format.copy(header, 20)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

export async function synthesizeQwenSpeech(
  text: string,
  config: QwenSpeechConfig,
  request: SpeechFetch = globalThis.fetch,
  timeoutMs = 45_000
): Promise<Buffer> {
  if (!config.apiKey) throw new CloudSpeechError('尚未配置阿里云百炼 API Key。')
  const host = resolveSpeechApiHost(config.region, config.apiHost)
  if (config.apiKey.startsWith('sk-ws-') && !config.apiHost)
    throw new CloudSpeechError('业务空间 API Key 需要配置控制台提供的 API Host。')
  const signal = AbortSignal.timeout(timeoutMs)
  const files: Buffer[] = []
  let receivedBytes = 0
  try {
    for (const part of splitSpeechText(text)) {
      const response = await request(
        `https://${host}/api/v1/services/aigc/multimodal-generation/generation`,
        {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: QWEN_TTS_MODEL,
            input: { text: part, voice: config.voice, language_type: 'Chinese' }
          })
        }
      )
      if (!response.ok) {
        await response.body?.cancel()
        const message =
          response.status === 401
            ? 'API Key 无效，请检查密钥和服务地域。'
            : response.status === 403
              ? '当前账号无权调用 Qwen3-TTS，请检查模型权限或账户余额。'
              : response.status === 429
                ? '阿里云请求频率或额度受限，请稍后重试。'
                : response.status === 400
                  ? '阿里云未接受语音参数，请检查音色和服务地域。'
                  : '阿里云语音服务暂不可用，请稍后重试。'
        throw new CloudSpeechError(message)
      }
      const result = JSON.parse((await readLimited(response, 1024 * 1024)).toString('utf8'))
      if (typeof result.output?.audio?.url !== 'string')
        throw new CloudSpeechError('阿里云未返回完整语音，请检查模型开通状态。')
      const download = await request(audioDownloadUrl(result.output.audio.url), {
        redirect: 'error',
        signal
      })
      if (!download.ok) {
        await download.body?.cancel()
        throw new CloudSpeechError('云端音频下载失败，请检查网络后重试。')
      }
      const audio = await readLimited(download, MAX_AUDIO_BYTES - receivedBytes)
      receivedBytes += audio.length
      files.push(audio)
    }
    return joinSpeechWavs(files)
  } catch (error) {
    // Only our fixed Chinese messages are safe to expose. Transport/parser errors
    // can contain URLs, signed query strings, credentials or submitted text.
    if (signal.aborted) throw new CloudSpeechError('云端语音生成超时，请检查网络后重试。')
    if (error instanceof CloudSpeechError) throw error
    throw new CloudSpeechError('无法连接阿里云语音服务，请检查管理端网络。')
  }
}
