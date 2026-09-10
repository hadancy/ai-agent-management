import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'

const MAX_TEXT_LENGTH = 2000
const CACHE_LIMIT_BYTES = 24 * 1024 * 1024
const CACHE_TTL_MS = 10 * 60 * 1000

export interface SpeechAudio {
  data: Buffer
  provider: 'qwen' | 'offline'
  cacheTtlMs?: number
}

export function registerSpeechRoutes(
  app: FastifyInstance,
  synthesize: (text: string) => Promise<Buffer | SpeechAudio>,
  cacheNamespace: () => string = () => ''
): void {
  const cache = new Map<string, SpeechAudio & { expires: number }>()
  const pending = new Map<string, Promise<SpeechAudio>>()
  let cacheBytes = 0
  app.post('/api/speech', { bodyLimit: 16_384 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const text = (request.body as { text?: unknown } | null)?.text
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.includes('\0') ||
      text.length > MAX_TEXT_LENGTH
    )
      return reply.code(400).send({ message: `播报文字须为 1–${MAX_TEXT_LENGTH} 个字符。` })
    const normalized = text.trim()
    const key = createHash('sha256')
      .update(cacheNamespace() + '\0' + normalized)
      .digest('hex')
    for (const [id, item] of cache) {
      if (item.expires <= Date.now()) {
        cacheBytes -= item.data.length
        cache.delete(id)
      }
    }
    const cached = cache.get(key)
    if (cached)
      return reply.header('X-Speech-Provider', cached.provider).type('audio/wav').send(cached.data)
    if (!pending.has(key)) {
      if (pending.size >= 3)
        return reply.code(429).send({ message: '平台正在生成其他语音，请稍后重试。' })
      const job = Promise.resolve()
        .then(() => synthesize(normalized))
        .then((result): SpeechAudio =>
          Buffer.isBuffer(result) ? { data: result, provider: 'offline' } : result
        )
      pending.set(key, job)
      void job
        .then((result) => {
          const { data } = result
          if (data.length > CACHE_LIMIT_BYTES) return
          while (cacheBytes + data.length > CACHE_LIMIT_BYTES || cache.size >= 32) {
            const oldest = cache.entries().next().value
            if (!oldest) break
            cacheBytes -= oldest[1].data.length
            cache.delete(oldest[0])
          }
          cache.set(key, { ...result, expires: Date.now() + (result.cacheTtlMs ?? CACHE_TTL_MS) })
          cacheBytes += data.length
        })
        .catch(() => {})
        .finally(() => pending.delete(key))
    }
    try {
      const result = await pending.get(key)!
      return reply.header('X-Speech-Provider', result.provider).type('audio/wav').send(result.data)
    } catch (error) {
      return reply
        .code(503)
        .send({ message: error instanceof Error ? error.message : '平台语音服务暂不可用。' })
    }
  })
  app.addHook('onClose', async () => {
    cache.clear()
  })
}
