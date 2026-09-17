import { open, readFile, stat, type FileHandle } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  normalizeRecordedText,
  RECORDED_SAMPLE_RATE,
  RECORDED_SPEECH_VERSION,
  RECORDED_TEST_TEXT,
  RECORDED_VOICE
} from '../../shared/recorded-speech'
import type { SpeechSettingsInput, SpeechSettingsStatus } from '../../shared/speech-settings'
import type { SpeechAudio } from './speech'

export interface RecordedSpeechManifest {
  version: string
  voice: string
  sampleRate: number
  channels: number
  bitsPerSample: number
  bytes: number
  sha256: string
  chunkBytes: number
  files: Array<{ name: string; bytes: number; sha256: string }>
  clips: Record<string, [number, number]>
}
type Clip = { text: string; offset: number; length: number }
type Part = Clip | { pauseMs: number }
export interface PlatformSpeechService {
  synthesize(text: string): Promise<SpeechAudio>
  cacheNamespace(): string
  onSettingsChanged(listener: () => void): () => void
  status(): SpeechSettingsStatus
  save(input: SpeechSettingsInput): Promise<SpeechSettingsStatus>
  test(): Promise<{ ok: boolean; message: string; audio?: Uint8Array }>
}
const MAX_AUDIO_BYTES = 24 * 1024 * 1024
const MISSING_PACK = '语音资源缺失或损坏，请重新安装完整版本。'

export function recordedSpeechDirectory(appDirectory: string, packaged: boolean): string {
  return join(appDirectory, ...(packaged ? [] : ['resources']), 'recorded-speech')
}

export function recordedWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(pcm.length + 36, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RECORDED_SAMPLE_RATE, 24)
  header.writeUInt32LE(RECORDED_SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export class RecordedSpeechService {
  private loading?: Promise<void>
  private readonly prefixes = new Map<string, Clip[]>()
  private readonly cache = new Map<string, Buffer>()
  private cacheBytes = 0
  private chunkBytes = 0
  private files: string[] = []

  constructor(private readonly directory: string) {}

  private load(): Promise<void> {
    if (!this.loading)
      this.loading = this.loadPack().catch(() => {
        this.loading = undefined
        throw new Error(MISSING_PACK)
      })
    return this.loading
  }

  private async loadPack(): Promise<void> {
    const manifest = JSON.parse(
      await readFile(join(this.directory, 'manifest.json'), 'utf8')
    ) as RecordedSpeechManifest
    if (
      manifest.version !== RECORDED_SPEECH_VERSION ||
      manifest.voice !== RECORDED_VOICE ||
      manifest.sampleRate !== RECORDED_SAMPLE_RATE ||
      manifest.channels !== 1 ||
      manifest.bitsPerSample !== 16 ||
      !Number.isSafeInteger(manifest.bytes) ||
      manifest.bytes <= 0 ||
      manifest.chunkBytes !== 16 * 1024 * 1024 ||
      !Array.isArray(manifest.files) ||
      !manifest.files.length ||
      !manifest.clips ||
      Object.keys(manifest.clips).length < 100
    )
      throw new Error(MISSING_PACK)
    let total = 0
    const files: string[] = []
    for (const [index, file] of manifest.files.entries()) {
      if (file.name !== `audio-${String(index).padStart(3, '0')}.pcm`) throw new Error(MISSING_PACK)
      const filename = join(this.directory, file.name)
      const info = await stat(filename)
      if (
        info.size !== file.bytes ||
        info.size !== Math.min(manifest.chunkBytes, manifest.bytes - total)
      )
        throw new Error(MISSING_PACK)
      if (
        createHash('sha256')
          .update(await readFile(filename))
          .digest('hex') !== file.sha256
      )
        throw new Error(MISSING_PACK)
      total += info.size
      files.push(filename)
    }
    if (total !== manifest.bytes) throw new Error(MISSING_PACK)
    const clips: Clip[] = []
    for (const [text, range] of Object.entries(manifest.clips)) {
      if (
        !text ||
        !Array.isArray(range) ||
        range.length !== 2 ||
        !range.every(Number.isSafeInteger) ||
        range[0] < 0 ||
        range[1] <= 0 ||
        range.some((number) => number % 2 !== 0) ||
        range[0] + range[1] > total
      )
        throw new Error(MISSING_PACK)
      clips.push({ text, offset: range[0], length: range[1] })
    }
    this.prefixes.clear()
    this.chunkBytes = manifest.chunkBytes
    this.files = files
    for (const clip of clips) {
      const first = [...clip.text][0]
      const values = this.prefixes.get(first) ?? []
      values.push(clip)
      this.prefixes.set(first, values)
    }
    for (const values of this.prefixes.values())
      values.sort((a, b) => b.text.length - a.text.length)
  }

  // Prefer complete recordings, then complete phrases. Only variable text uses
  // character clips. Unsupported words fail visibly; they never change voice or
  // silently turn a safety announcement into a generic notification.
  async plan(text: string): Promise<Part[]> {
    if (!text.trim() || text.length > 2000 || text.includes('\0'))
      throw new Error('播报文字须为 1–2000 个字符。')
    await this.load()
    const normalized = normalizeRecordedText(text)
    const parts: Part[] = []
    let offset = 0
    while (offset < normalized.length) {
      const first = String.fromCodePoint(normalized.codePointAt(offset)!)
      const clip = this.prefixes
        .get(first)
        ?.find((item) => normalized.startsWith(item.text, offset))
      if (clip) {
        parts.push(clip)
        offset += clip.text.length
      } else {
        if (/[。！？]/u.test(first)) parts.push({ pauseMs: 280 })
        else if (/[，、：；]/u.test(first)) parts.push({ pauseMs: 140 })
        else if (!/[\p{P}\p{S}\s]/u.test(first))
          throw new Error('这段内容含语音资源尚未收录的文字，请更新后重试。')
        offset += first.length
      }
    }
    if (!parts.some((part) => 'length' in part)) throw new Error('没有可播放的语音内容。')
    return parts
  }

  async synthesize(text: string): Promise<SpeechAudio> {
    const parts = await this.plan(text)
    const length = parts.reduce(
      (total, part) =>
        total +
        ('length' in part
          ? part.length
          : Math.round((part.pauseMs * RECORDED_SAMPLE_RATE) / 1000) * 2),
      0
    )
    if (length + 44 > MAX_AUDIO_BYTES) throw new Error('播报内容过长，请分段播放。')
    const audio = Buffer.alloc(length)
    const files = new Map<number, FileHandle>()
    try {
      let offset = 0
      for (const part of parts) {
        if ('pauseMs' in part) {
          offset += Math.round((part.pauseMs * RECORDED_SAMPLE_RATE) / 1000) * 2
          continue
        }
        let pcm = this.cache.get(part.text)
        if (!pcm) {
          pcm = Buffer.alloc(part.length)
          let read = 0
          while (read < part.length) {
            const position = part.offset + read
            const index = Math.floor(position / this.chunkBytes)
            let file = files.get(index)
            if (!file) {
              file = await open(this.files[index], 'r')
              files.set(index, file)
            }
            const fileOffset = position % this.chunkBytes
            const count = Math.min(part.length - read, this.chunkBytes - fileOffset)
            const { bytesRead } = await file.read(pcm, read, count, fileOffset)
            if (!bytesRead) throw new Error(MISSING_PACK)
            read += bytesRead
          }
          while (
            !this.cache.has(part.text) &&
            this.cacheBytes + pcm.length > 12 * 1024 * 1024 &&
            this.cache.size
          ) {
            const [key, value] = this.cache.entries().next().value!
            this.cache.delete(key)
            this.cacheBytes -= value.length
          }
          if (!this.cache.has(part.text) && pcm.length <= 12 * 1024 * 1024) {
            this.cache.set(part.text, pcm)
            this.cacheBytes += pcm.length
          }
        }
        pcm.copy(audio, offset)
        offset += pcm.length
      }
    } catch {
      throw new Error(MISSING_PACK)
    } finally {
      await Promise.all([...files.values()].map((file) => file.close()))
    }
    return { data: recordedWav(audio), provider: 'recorded', voice: RECORDED_VOICE }
  }

  cacheNamespace(): string {
    return RECORDED_SPEECH_VERSION
  }
  onSettingsChanged(_listener: () => void): () => void {
    void _listener
    return () => {}
  }
  status(): SpeechSettingsStatus {
    return {
      mode: 'recorded',
      region: 'beijing',
      voice: RECORDED_VOICE,
      hasApiKey: false,
      keySource: 'none',
      encryptionAvailable: false,
      lastCloudError: null,
      message: '语音播报已启用。'
    }
  }
  async save(_input: SpeechSettingsInput): Promise<SpeechSettingsStatus> {
    void _input
    // Legacy renderer/settings requests must not re-enable cloud or another voice.
    return this.status()
  }
  async test(): Promise<{ ok: boolean; message: string; audio?: Uint8Array }> {
    try {
      const { data } = await this.synthesize(RECORDED_TEST_TEXT)
      return { ok: true, message: '试听音频已就绪。', audio: new Uint8Array(data) }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : MISSING_PACK }
    }
  }
}
