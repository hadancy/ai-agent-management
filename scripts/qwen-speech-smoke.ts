import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { SpeechSettingsStore, type SpeechSecretStorage } from '../src/main/speech-settings'
import { trustedSpeechSettingsUrl } from '../src/main/speech-access'
import {
  audioDownloadUrl,
  joinSpeechWavs,
  splitSpeechText,
  synthesizeQwenSpeech,
  type SpeechFetch
} from '../src/main/server/qwen-speech'
import { SpeechService } from '../src/main/server/speech-service'
import { registerSpeechRoutes } from '../src/main/server/speech'
import {
  DEFAULT_SPEECH_VOICE,
  resolveSpeechApiHost,
  type SpeechSettingsInput
} from '../src/shared/speech-settings'

const key = 'sk-test-credential-for-tests-only'
const host = 'ws-test123.cn-beijing.maas.aliyuncs.com'
const config = { apiKey: key, region: 'beijing' as const, voice: DEFAULT_SPEECH_VOICE }
const settings: SpeechSettingsInput = { ...config, mode: 'qwen' }
const signedUrl = 'http://dashscope-result.oss-cn-wulanchabu.aliyuncs.com/audio.wav?Signature=test'

function wav(rate = 24000): Buffer {
  const file = Buffer.alloc(244)
  file.write('RIFF')
  file.writeUInt32LE(file.length - 8, 4)
  file.write('WAVEfmt ', 8)
  file.writeUInt32LE(16, 16)
  file.writeUInt16LE(1, 20)
  file.writeUInt16LE(1, 22)
  file.writeUInt32LE(rate, 24)
  file.writeUInt32LE(rate * 2, 28)
  file.writeUInt16LE(2, 32)
  file.writeUInt16LE(16, 34)
  file.write('data', 36)
  file.writeUInt32LE(file.length - 44, 40)
  for (let offset = 44; offset < file.length; offset += 2) file.writeInt16LE(offset * 12, offset)
  return file
}

const audio = wav()
const apiResponse = (): Response => Response.json({ output: { audio: { url: signedUrl } } })
const audioResponse = (): Response => new Response(new Uint8Array(audio))
const goodFetch: SpeechFetch = async (_url, init) =>
  init?.method === 'POST' ? apiResponse() : audioResponse()
const unavailable: SpeechFetch = async () =>
  new Response('sensitive provider error', { status: 403 })

async function run(): Promise<void> {
  const text = '中'.repeat(499) + '😀' + '请检查设备。'.repeat(160)
  const pieces = splitSpeechText(text)
  assert.equal(pieces.join(''), text)
  assert.ok(pieces.every((part) => part.length <= 500 && !/[\uD800-\uDBFF]$/.test(part)))
  assert.deepEqual(
    joinSpeechWavs([audio, audio]).subarray(44),
    Buffer.concat([audio.subarray(44), audio.subarray(44)])
  )
  for (const [riffSize, dataSize] of [
    [0x7fffffbf, 0x7fffff9b],
    [0xffffffff, 0xffffffff]
  ]) {
    const streaming = Buffer.from(audio)
    streaming.writeUInt32LE(riffSize, 4)
    streaming.writeUInt32LE(dataSize, 40)
    assert.deepEqual(
      joinSpeechWavs([streaming]),
      audio,
      'streaming length markers become playable exact lengths'
    )
  }
  assert.throws(() => joinSpeechWavs([audio.subarray(0, 90)]), /不完整/)
  assert.throws(() => joinSpeechWavs([audio, wav(8000)]), /格式不一致/)
  const badPcm = Buffer.from(audio)
  badPcm.writeUInt32LE(0, 24)
  assert.throws(() => joinSpeechWavs([badPcm]), /PCM WAV/)
  assert.equal(audioDownloadUrl(signedUrl), signedUrl.replace('http:', 'https:'))
  for (const url of [
    'https://example.com/a.wav',
    'http://127.0.0.1/a.wav',
    'https://a.oss-cn-beijing.aliyuncs.com.evil.test/a',
    'https://user@a.oss-cn-beijing.aliyuncs.com/a'
  ])
    assert.throws(() => audioDownloadUrl(url))
  assert.equal(resolveSpeechApiHost('beijing', host), host)
  assert.throws(() => resolveSpeechApiHost('singapore', host), /地域/)
  assert.throws(() => resolveSpeechApiHost('beijing', 'example.com'), /域名/)
  const calls: { url: string; init?: RequestInit }[] = []
  const request: SpeechFetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return init?.method === 'POST' ? apiResponse() : audioResponse()
  }
  const result = await synthesizeQwenSpeech(text, { ...config, apiHost: host }, request)
  const requests = calls.filter((call) => call.init?.method === 'POST')
  assert.equal(
    requests.map((call) => JSON.parse(String(call.init?.body)).input.text).join(''),
    text
  )
  assert.equal(result.length, 44 + pieces.length * 200)
  for (const call of requests) {
    assert.ok(call.url.startsWith(`https://${host}/api/v1/`))
    assert.equal(new Headers(call.init?.headers).get('Authorization'), `Bearer ${key}`)
    const body = JSON.parse(String(call.init?.body))
    assert.equal(body.model, 'qwen3-tts-instruct-flash')
    assert.equal(body.input.voice, 'Elias')
    assert.equal(body.input.language_type, 'Chinese')
    assert.match(body.input.instructions, /正式.*中性.*不带情感色彩.*音调平直/)
    assert.equal(body.input.optimize_instructions, false, 'keep neutral instructions unchanged')
    assert.equal(call.init?.redirect, 'error')
  }
  for (const call of calls.filter((call) => call.init?.method !== 'POST')) {
    assert.equal(
      new Headers(call.init?.headers).has('Authorization'),
      false,
      'never send credential to OSS'
    )
    assert.ok(call.url.startsWith('https:'))
  }
  calls.length = 0
  await synthesizeQwenSpeech('测试', { ...config, region: 'singapore' }, request)
  assert.ok(calls[0].url.startsWith('https://dashscope-intl.aliyuncs.com/'))
  await assert.rejects(
    synthesizeQwenSpeech('测试', { ...config, apiKey: 'sk-ws-test' }, request),
    /API Host/
  )
  for (const code of [400, 401, 403, 429, 500]) {
    await assert.rejects(
      synthesizeQwenSpeech('测试', config, async () => new Response(key, { status: code })),
      (error) => {
        assert.ok(error instanceof Error && !error.message.includes(key))
        return true
      }
    )
  }
  await assert.rejects(
    synthesizeQwenSpeech('测试', config, async () => {
      throw new Error(key)
    }),
    /无法连接阿里云/
  )
  await assert.rejects(
    synthesizeQwenSpeech('测试', config, async () => Response.json({ output: {} })),
    /未返回完整/
  )
  await assert.rejects(
    synthesizeQwenSpeech('测试', config, async () => new Response('x'.repeat(1024 * 1024 + 1))),
    /响应过大/
  )
  await assert.rejects(
    synthesizeQwenSpeech(
      '测试',
      config,
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout guard')), 100)
          init?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(new Error('aborted'))
            },
            { once: true }
          )
        }),
      5
    ),
    /超时/
  )
  console.log(
    'PASS: Qwen request scope, regions/workspace hosts, safe errors, deadlines, text segmentation and streaming WAV normalization'
  )

  const directory = await mkdtemp(join(tmpdir(), 'qwen-settings-'))
  // Test the storage boundary with a reversible test codec; actual safeStorage is exercised in the desktop integration check.
  const secrets: SpeechSecretStorage = {
    available: () => true,
    encrypt: (value) => Buffer.from(value.split('').reverse().join('')),
    decrypt: (value) => value.toString().split('').reverse().join('')
  }
  try {
    const filename = join(directory, 'settings.json')
    const store = new SpeechSettingsStore(filename, secrets, '')
    await store.load()
    assert.equal(store.status().mode, 'offline')
    assert.equal(store.status().voice, 'Elias')
    await assert.rejects(store.save({ ...settings, apiKey: '' }), /填写/)
    await store.save(settings)
    const saved = await readFile(filename, 'utf8')
    assert.ok(!saved.includes(key) && !Object.hasOwn(JSON.parse(saved), 'apiKey'))
    assert.ok(!JSON.stringify(store.status()).includes(key))
    if (process.platform !== 'win32') assert.equal((await stat(filename)).mode & 0o777, 0o600)

    const legacyFilename = join(directory, 'legacy.json')
    const legacy = { ...JSON.parse(saved), voice: 'Cherry', apiHost: host }
    delete legacy.voiceDefaultsVersion
    await writeFile(legacyFilename, JSON.stringify(legacy))
    const migrated = new SpeechSettingsStore(legacyFilename, secrets, '')
    await migrated.load()
    assert.equal(
      migrated.status().voice,
      'Elias',
      'existing Cherry defaults adopt the neutral voice'
    )
    assert.equal(migrated.status().mode, 'qwen')
    assert.equal(migrated.status().apiHost, host)
    assert.equal(migrated.snapshot().apiKey, key, 'migration retains credentials')
    await migrated.save({ ...migrated.snapshot(), apiKey: '' })
    const migratedAgain = new SpeechSettingsStore(legacyFilename, secrets, '')
    await migratedAgain.load()
    assert.equal(
      migratedAgain.status().voice,
      'Elias',
      'neutral default survives saving and restart'
    )
    await migratedAgain.save({ ...migratedAgain.snapshot(), voice: 'Cherry', apiKey: '' })
    const explicitChoice = new SpeechSettingsStore(legacyFilename, secrets, '')
    await explicitChoice.load()
    assert.equal(
      explicitChoice.status().voice,
      'Cherry',
      'later explicit voice choices are retained'
    )
    await writeFile(legacyFilename, JSON.stringify({ ...legacy, voice: 'Serena' }))
    const custom = new SpeechSettingsStore(legacyFilename, secrets, '')
    await custom.load()
    assert.equal(custom.status().voice, 'Serena', 'migration preserves other custom voices')

    await writeFile(
      legacyFilename,
      JSON.stringify({ ...legacy, voice: 'Neil', voiceDefaultsVersion: 1 })
    )
    const previousDefault = new SpeechSettingsStore(legacyFilename, secrets, '')
    await previousDefault.load()
    assert.equal(
      previousDefault.status().voice,
      'Elias',
      'previous news voice adopts the neutral default'
    )
    await previousDefault.save({ ...previousDefault.snapshot(), voice: 'Neil', apiKey: '' })
    const explicitNewsVoice = new SpeechSettingsStore(legacyFilename, secrets, '')
    await explicitNewsVoice.load()
    assert.equal(
      explicitNewsVoice.status().voice,
      'Neil',
      'new explicit voice choices survive restart'
    )

    const loaded = new SpeechSettingsStore(filename, secrets, '')
    await loaded.load()
    assert.equal(loaded.snapshot().apiKey, key)
    await loaded.save({ ...settings, apiKey: '', voice: 'Serena' })
    assert.equal(loaded.snapshot().apiKey, key)
    const revision = loaded.revision
    await assert.rejects(loaded.save({ ...settings, apiHost: 'attacker.test' }), /域名/)
    assert.equal(loaded.revision, revision)
    await loaded.save({ ...settings, mode: 'offline', clearApiKey: true })
    assert.equal(loaded.status().hasApiKey, false)
    const noEncryption = new SpeechSettingsStore(
      join(directory, 'blocked.json'),
      { ...secrets, available: () => false },
      ''
    )
    await assert.rejects(noEncryption.save(settings), /安全存储不可用/)
    assert.equal(noEncryption.status().hasApiKey, false)
    const brokenEncryption = new SpeechSettingsStore(
      join(directory, 'broken.json'),
      {
        ...secrets,
        encrypt: () => {
          throw new Error(key)
        }
      },
      ''
    )
    await assert.rejects(brokenEncryption.save(settings), /系统密钥加密失败/)
    const envStore = new SpeechSettingsStore(join(directory, 'env.json'), secrets, key)
    assert.equal(envStore.status().keySource, 'environment')
    await envStore.save({ ...settings, apiKey: '' })
    assert.equal(
      JSON.parse(await readFile(join(directory, 'env.json'), 'utf8')).encryptedApiKey,
      ''
    )

    let time = 1000
    let cloudCalls = 0
    const offlineTexts: string[] = []
    const service = new SpeechService(
      store,
      async (value) => {
        offlineTexts.push(value)
        return audio
      },
      async (url, init) => {
        if (init?.method === 'POST' && ++cloudCalls === 2) return unavailable(url, init)
        return goodFetch(url, init)
      },
      () => time
    )
    const fallback = await service.synthesize(text)
    assert.equal(fallback.provider, 'offline')
    assert.equal(fallback.cacheTtlMs, 5000)
    assert.deepEqual(
      offlineTexts,
      [text],
      'a later segment failure falls back with the complete original text'
    )
    assert.ok(service.status().lastCloudError)
    await service.synthesize('冷却期')
    assert.equal(cloudCalls, 2)
    time += 30001
    assert.equal((await service.synthesize('恢复')).provider, 'qwen')
    assert.equal(service.status().lastCloudError, null)
    let offlineCalls = 0
    const strict = new SpeechService(
      store,
      async () => {
        offlineCalls++
        return audio
      },
      unavailable
    )
    assert.equal((await strict.test()).ok, false)
    assert.equal(offlineCalls, 0, 'the cloud test never reports offline speech as cloud success')

    const modelRequests: { model: string; input: Record<string, unknown> }[] = []
    const compatible = new SpeechService(
      store,
      async () => {
        throw new Error('An allowed Qwen model must not fall back to offline speech')
      },
      async (_url, init) => {
        if (init?.method !== 'POST') return audioResponse()
        const body = JSON.parse(String(init.body))
        modelRequests.push(body)
        return body.model === 'qwen3-tts-instruct-flash'
          ? Response.json({ code: 'AccessDenied' }, { status: 403 })
          : apiResponse()
      }
    )
    let settingsChanges = 0
    const unsubscribe = compatible.onSettingsChanged(() => settingsChanges++)
    for (const text of ['设备运行告警', 'AI故障分析', '倾角分析', '工单关闭提醒', 'Pad员工任务']) {
      const result = await compatible.synthesize(text)
      assert.equal(result.provider, 'qwen')
      assert.equal(result.voice, 'Elias', 'every announcement keeps the selected voice')
    }
    assert.equal(
      modelRequests.filter(({ model }) => model === 'qwen3-tts-instruct-flash').length,
      1
    )
    for (const body of modelRequests.filter(({ model }) => model === 'qwen3-tts-flash')) {
      assert.equal(body.input.voice, 'Elias')
      assert.equal(
        body.input.instructions,
        undefined,
        'standard model gets only supported parameters'
      )
    }
    assert.equal(compatible.status().activeModel, 'qwen3-tts-flash')
    assert.equal(compatible.status().lastCloudError, null)
    assert.equal((await compatible.test()).ok, true)
    await compatible.save({ ...settings, apiKey: '' })
    assert.equal(settingsChanges, 1, 'saving settings notifies connected clients')
    assert.equal(compatible.status().activeModel, 'qwen3-tts-instruct-flash')
    unsubscribe()
    await compatible.save({ ...settings, apiKey: '' })
    assert.equal(settingsChanges, 1, 'closing the server releases its settings listener')

    const app = Fastify()
    let httpCalls = 0
    const cachedService = new SpeechService(
      store,
      async () => {
        httpCalls++
        return audio
      },
      goodFetch
    )
    registerSpeechRoutes(
      app,
      (value) => cachedService.synthesize(value),
      () => cachedService.cacheNamespace()
    )
    try {
      const post = (): ReturnType<typeof app.inject> =>
        app.inject({ method: 'POST', url: '/api/speech', payload: { text: '工单提示' } })
      const cloudAudio = await post()
      assert.equal(cloudAudio.headers['x-speech-provider'], 'qwen')
      assert.equal(cloudAudio.headers['x-speech-voice'], 'Elias')
      assert.equal(
        (await post()).headers['x-speech-voice'],
        'Elias',
        'cached audio retains its voice metadata'
      )
      await cachedService.save({ ...settings, mode: 'offline', apiKey: '' })
      assert.equal(
        (await post()).headers['x-speech-provider'],
        'offline',
        'saved settings invalidate prior provider cache'
      )
      await post()
      assert.equal(httpCalls, 1)
      const fallbackApp = Fastify()
      registerSpeechRoutes(fallbackApp, (value) => strict.synthesize(value))
      try {
        // Restore cloud mode to exercise the true offline fallback headers.
        await strict.save({ ...settings, apiKey: '' })
        const fallbackAudio = await fallbackApp.inject({
          method: 'POST',
          url: '/api/speech',
          payload: { text: '告警' }
        })
        assert.equal(fallbackAudio.headers['x-speech-provider'], 'offline')
        assert.equal(fallbackAudio.headers['x-speech-fallback'], '1')
      } finally {
        await fallbackApp.close()
      }
      assert.equal(
        (await app.inject({ method: 'POST', url: '/api/speech-settings', payload: {} })).statusCode,
        404
      )
    } finally {
      await app.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  assert.equal(trustedSpeechSettingsUrl('http://127.0.0.1:17880/b'), true)
  assert.equal(trustedSpeechSettingsUrl('http://localhost:5173/', 'http://localhost:5173'), true)
  for (const url of [
    'http://127.0.0.1:17880/pad',
    'http://192.168.1.1:17880/b',
    'https://attacker.test/b',
    'http://user@127.0.0.1:17880/b',
    'file:///b',
    'broken'
  ])
    assert.equal(trustedSpeechSettingsUrl(url), false)
  console.log(
    'PASS: encrypted settings boundary, key retention/clearing, whole-text fallback, cooldown/recovery, strict cloud test, cache invalidation and desktop-only configuration'
  )
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
