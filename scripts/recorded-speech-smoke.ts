import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Fastify from 'fastify'
import {
  RecordedSpeechService,
  recordedSpeechDirectory,
  type RecordedSpeechManifest
} from '../src/main/server/recorded-speech'
import { registerSpeechRoutes } from '../src/main/server/speech'
import { DIAGNOSIS_SPEECH_TEXT, normalizeRecordedText } from '../src/shared/recorded-speech'
import { fullRecordings } from './recorded-speech-catalog'
import { seasonalSpeechText } from '../src/shared/agrivoltaic-analysis'
import { seasonalTaskVoice } from '../src/shared/task-evidence'

function checkWav(data: Buffer): void {
  assert.equal(data.toString('ascii', 0, 4), 'RIFF')
  assert.equal(data.toString('ascii', 8, 12), 'WAVE')
  assert.equal(data.readUInt32LE(4), data.length - 8)
  assert.equal(data.readUInt32LE(40), data.length - 44)
  assert.equal(data.readUInt32LE(24), 24000)
  assert.equal(data.readUInt16LE(22), 1)
  assert.ok(data.length > 1000)
  assert.ok(data.subarray(44).some((byte) => byte !== 0))
}

async function run(): Promise<void> {
  const installed = process.env.SPEECH_SMOKE_RESOURCES
  const directory = recordedSpeechDirectory(
    installed ? resolve(installed) : process.cwd(),
    !!installed
  )
  const service = new RecordedSpeechService(directory)
  // A runtime regression must not contact any speech provider.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('Runtime speech must never use the internet')
  }
  try {
    assert.equal(
      normalizeRecordedText('2026-09-17，21–23°，2.0 m，91.2%'),
      '二零二六年九月十七日，二十一至二十三度，二点零米，百分之九十一点二'
    )
    assert.equal(normalizeRecordedText('WO-20260917-001'), 'WO二零二六零九一七杠零零一')
    assert.equal(normalizeRecordedText('GZ-20260917-001'), 'GZ二零二六零九一七杠零零一')
    for (const text of fullRecordings) {
      const parts = await service.plan(text)
      assert.equal(parts.length, 1, `Fixed content must use one whole recording: ${text}`)
    }
    const sample = await service.synthesize(DIAGNOSIS_SPEECH_TEXT)
    checkWav(sample.data)
    assert.equal(sample.provider, 'recorded')
    assert.equal(sample.voice, 'Tingting')
    assert.deepEqual((await service.synthesize(DIAGNOSIS_SPEECH_TEXT)).data, sample.data)
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      assert.deepEqual(
        (await service.synthesize(letter)).data,
        (await service.synthesize(letter.toLowerCase())).data,
        `${letter} must play its plain letter name without a capital/lowercase announcement`
      )
    }
    const identifierParts = await service.plan('工单编号GZ-20260917-001')
    assert.ok(identifierParts.some((part) => 'text' in part && part.text === 'GZ'))
    assert.ok(!identifierParts.some((part) => 'text' in part && ['G', 'Z'].includes(part.text)))

    const scenarios: string[] = []
    const seasonalAdvice = [
      '冬季：基准+12°，多发电、自动除雪、防霜冻。',
      '春季：基准倾角−2°，保春茶氨基酸含量，发电效率提升8%。',
      '春季：基准倾角−2°，保春茶氨基酸含量，发电效率提升8%。',
      '春季：基准倾角−2°，保春茶氨基酸含量，发电效率提升8%。',
      '夏季：基准−3°，板下降温8–13℃，消除光合午休，减少水分蒸发30%。',
      '夏季：基准−3°，板下降温8–13℃，消除光合午休，减少水分蒸发30%。',
      '夏季：基准−3°，板下降温8–13℃，消除光合午休，减少水分蒸发30%。',
      '秋季：回归基准，平衡发电与秋茶品质。',
      '秋季：回归基准，平衡发电与秋茶品质。',
      '秋季：回归基准，平衡发电与秋茶品质。',
      '冬季：基准+12°，多发电、自动除雪、防霜冻。',
      '冬季：基准+12°，多发电、自动除雪、防霜冻。'
    ]
    for (let month = 1; month <= 12; month++) {
      const date = `2026-${String(month).padStart(2, '0')}-17`
      const speech = seasonalSpeechText(date)
      const advice = seasonalAdvice[month - 1]
      assert.equal(
        speech,
        `基准倾角为21–23°\n${advice}\n现在是${month}月17日，执行${advice.slice(0, 2)}倾角，工单已生成。`
      )
      const parts = await service.plan(speech)
      assert.ok(
        parts.some((part) => 'text' in part && part.text === normalizeRecordedText(advice)),
        'Seasonal advice should use its complete recording'
      )
      scenarios.push(speech)
      scenarios.push(
        seasonalTaskVoice({
          month,
          analysisVersion: 2,
          analysisDate: date,
          fileName: '项目.docx',
          fileSize: 123,
          requestId: 'test'
        })
      )
    }
    for (let mask = 1; mask < 16; mask++) {
      const names = [1, 2, 3, 4].filter((n) => mask & (1 << (n - 1))).map((n) => `${n}号光伏组件`)
      scenarios.push(`警告！检测到${names.join('、')}存在运行异常或预测风险，请立即查看处理。`)
    }
    for (const role of ['A', 'B', 'C'])
      scenarios.push(
        `${role}员工您有新工单。工单编号WO-20260917-001，故障类型：组件热斑。作业位置：长乐镇光伏电站，4号组件。您的任务：检查组件并清理遮挡物，复测后恢复送电。风险点：直流高压触电、高处作业坠落。请规范操作，注意安全。`
      )
    const closure = '工单GZ-20260917-007处理完成，PLC数据已恢复正常，工单已自动关闭。'
    scenarios.push('工单编号GZ-20260917-001，故障类型：组件热斑。', '工单编号NG-GQ-20260917-002。')
    scenarios.push(closure, '请检查75摄氏度的设备，倾角为22.5度，风险点：误碰带电部位。')
    for (const text of scenarios) {
      const parts = await service.plan(text)
      const spoken = parts.flatMap((part) => ('text' in part ? [part.text] : [])).join('')
      const letters = (value: string): string => value.replace(/[\p{P}\p{S}\s]/gu, '')
      assert.equal(
        letters(spoken),
        letters(normalizeRecordedText(text)),
        'Dynamic content must not be omitted'
      )
    }
    checkWav((await service.synthesize(closure)).data)
    // Exercise an audio clip crossing a pack boundary, not just clips in file 0.
    const manifest = JSON.parse(
      await readFile(join(directory, 'manifest.json'), 'utf8')
    ) as RecordedSpeechManifest
    const crossing = Object.entries(manifest.clips).find(
      ([, [offset, length]]) =>
        Math.floor(offset / manifest.chunkBytes) !==
        Math.floor((offset + length - 1) / manifest.chunkBytes)
    )
    assert.ok(crossing, 'Fixture includes a recording spanning two pack files')
    const [word, [offset, length]] = crossing
    const index = Math.floor(offset / manifest.chunkBytes)
    const before = await readFile(join(directory, manifest.files[index].name))
    const after = await readFile(join(directory, manifest.files[index + 1].name))
    const first = before.subarray(offset % manifest.chunkBytes)
    assert.deepEqual(
      (await service.synthesize(word)).data.subarray(44),
      Buffer.concat([first, after.subarray(0, length - first.length)])
    )

    const previous = service.cacheNamespace()
    await service.save({ mode: 'qwen', voice: 'Elias', region: 'beijing', apiKey: 'ignored' })
    assert.equal(service.status().mode, 'recorded')
    assert.equal(service.status().voice, 'Tingting')
    assert.equal(service.status().hasApiKey, false)
    assert.equal(service.cacheNamespace(), previous)
    assert.equal((await service.test()).ok, true)
    await assert.rejects(service.synthesize('𰻞'), /尚未收录/)
    console.log(
      `PASS: complete recordings, ${scenarios.length} dynamic scenarios, pack boundaries, stable voice and no cloud calls`
    )

    const app = Fastify()
    let calls = 0
    registerSpeechRoutes(
      app,
      async (text) => {
        calls++
        return service.synthesize(text)
      },
      () => service.cacheNamespace()
    )
    try {
      for (const text of ['', ' ', null, 1, '字'.repeat(2001), '中文\0文字'])
        assert.equal(
          (await app.inject({ method: 'POST', url: '/api/speech', payload: { text } })).statusCode,
          400
        )
      assert.equal(calls, 0)
      const post = (): ReturnType<typeof app.inject> =>
        app.inject({ method: 'POST', url: '/api/speech', payload: { text: DIAGNOSIS_SPEECH_TEXT } })
      const results = await Promise.all([post(), post()])
      assert.equal(calls, 1, 'Concurrent callers share the same recorded audio')
      for (const response of results) {
        assert.equal(response.statusCode, 200)
        assert.equal(response.headers['content-type'], 'audio/wav')
        assert.equal(response.headers['x-speech-provider'], 'recorded')
        assert.equal(response.headers['x-speech-voice'], 'Tingting')
        assert.equal(response.headers['x-speech-fallback'], '0')
        assert.deepEqual(response.rawPayload, sample.data)
      }
      await post()
      assert.equal(calls, 1)
    } finally {
      await app.close()
    }
    console.log(
      'PASS: actual audio endpoint, metadata, validation, caching and concurrent deduplication'
    )

    const temporary = await mkdtemp(join(tmpdir(), 'tingting-pack-'))
    try {
      const target = recordedSpeechDirectory(join(temporary, '平台 安装,测试'), true)
      const missing = new RecordedSpeechService(target)
      assert.equal((await missing.test()).ok, false)
      await assert.rejects(missing.synthesize('测试'), /语音资源缺失/)
      await cp(directory, target, { recursive: true })
      checkWav((await missing.synthesize(DIAGNOSIS_SPEECH_TEXT)).data)
      await writeFile(join(target, manifest.files[0].name), 'damaged')
      await assert.rejects(new RecordedSpeechService(target).synthesize('测试'), /语音资源缺失/)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
    if (process.env.SPEECH_SMOKE_OUTPUT) {
      const filename = resolve(process.env.SPEECH_SMOKE_OUTPUT)
      await mkdir(join(filename, '..'), { recursive: true })
      await writeFile(filename, sample.data)
      await writeFile(
        filename.replace(/\.wav$/, '-dynamic.wav'),
        (await service.synthesize(closure)).data
      )
      await writeFile(
        filename.replace(/\.wav$/, '-identifier.wav'),
        (await service.synthesize('工单编号GZ-20260917-001。')).data
      )
    }
    console.log(
      'PASS: installed Unicode paths, missing/damaged pack errors and recovery; no native TTS required'
    )
  } finally {
    globalThis.fetch = originalFetch
  }
}
void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
