import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Fastify, { type LightMyRequestResponse } from 'fastify'
import { registerSpeechRoutes } from '../src/main/server/speech'
import { speechResourcePaths, synthesizeSpeech } from '../src/main/server/offline-speech'

async function run(): Promise<void> {
  const app = Fastify()
  let calls = 0
  let release: (() => void) | undefined
  const wav = Buffer.alloc(100)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(92, 4)
  wav.write('WAVE', 8)
  registerSpeechRoutes(app, async (text) => {
    calls++
    if (text === '失败') throw new Error('平台内置中文语音资源缺失。')
    if (text === '等待')
      await new Promise<void>((resolve) => {
        release = resolve
      })
    return wav
  })
  const post = (text: unknown): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'POST', url: '/api/speech', payload: { text } })
  try {
    for (const text of ['', ' ', null, 1, '字'.repeat(2001), '中文\0文字'])
      assert.equal((await post(text)).statusCode, 400)
    assert.equal(calls, 0)
    const response = await post('工单测试')
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'audio/wav')
    assert.equal(response.headers['cache-control'], 'no-store')
    assert.deepEqual(response.rawPayload, wav)
    await post('工单测试')
    assert.equal(calls, 1, 'identical speech is cached')
    const a = post('等待')
    const b = post('等待')
    const both = Promise.all([a, b])
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(calls, 2, 'concurrent identical requests share synthesis')
    release!()
    assert.ok((await both).every((item) => item.statusCode === 200))
    assert.equal((await post('失败')).statusCode, 503)
    assert.match((await post('失败')).json().message, /中文语音/)
    console.log(
      'PASS: input validation, WAV response, cache, concurrent deduplication and useful errors'
    )
  } finally {
    await app.close()
  }

  await assert.rejects(synthesizeSpeech('测试'), /离线语音资源未配置/)
  const absent = await mkdtemp(join(tmpdir(), 'speech-missing-'))
  try {
    await assert.rejects(
      synthesizeSpeech('测试', speechResourcePaths(absent, true)),
      /语音资源缺失/
    )
  } finally {
    await rm(absent, { recursive: true, force: true })
  }

  if (process.env.SPEECH_SMOKE_NATIVE === '1') {
    const installed = process.env.SPEECH_SMOKE_RESOURCES
    const source = speechResourcePaths(installed ? resolve(installed) : process.cwd(), !!installed)
    const temporary = await mkdtemp(join(tmpdir(), 'speech-integration-'))
    // Exercise the installed layout, Unicode/spaces/commas in paths, and real CPU synthesis.
    const resources = speechResourcePaths(join(temporary, '平台 安装,测试'), true)
    try {
      await cp(source.modelDirectory, resources.modelDirectory, { recursive: true })
      await cp(source.runtimeDirectory, resources.runtimeDirectory, { recursive: true })
      const start = Date.now()
      const data = await synthesizeSpeech(
        '您有一项新的工单任务。请检查3号设备，温度75摄氏度。请注意安全。',
        resources
      )
      verifyWav(data)
      const special = await synthesizeSpeech('--工单“巡检” $() `测试`；请注意安全。', resources)
      verifyWav(special)
      if (process.env.SPEECH_SMOKE_OUTPUT) {
        const output = resolve(process.env.SPEECH_SMOKE_OUTPUT)
        await mkdir(join(output, '..'), { recursive: true })
        await writeFile(output, data)
      }
      console.log(
        `PASS: offline ${process.platform} Chinese synthesis; two utterances in ${Date.now() - start} ms, packaged paths and literal arguments`
      )
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
}

function verifyWav(data: Buffer): void {
  assert.equal(data.toString('ascii', 0, 4), 'RIFF')
  assert.equal(data.toString('ascii', 8, 12), 'WAVE')
  // Inspect PCM chunks: a valid header alone is insufficient evidence of synthesized speech.
  let offset = 12
  let samples: Buffer | undefined
  while (offset + 8 <= data.length) {
    const size = data.readUInt32LE(offset + 4)
    if (data.toString('ascii', offset, offset + 4) === 'data') {
      samples = data.subarray(offset + 8, offset + 8 + size)
      break
    }
    offset += 8 + size + (size % 2)
  }
  assert.equal(data.readUInt32LE(24), 8000, 'lightweight AISHELL3 sample rate')
  assert.ok(samples && samples.length > 8000, 'at least half a second of PCM audio')
  assert.ok(
    samples.some((byte) => byte !== 0),
    'PCM is not silent'
  )
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
