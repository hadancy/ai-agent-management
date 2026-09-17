/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
// Authoring only, on the Mac used to approve the Tingting sample. Shipped apps
// read the finished pack; Windows/Linux builds never execute `say` or download TTS.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const ts = require('typescript')
const { buildSync } = require('esbuild')
const exec = promisify(execFile)
const root = path.resolve(__dirname, '..')
const cache = path.join(root, 'node_modules/.cache/recorded-speech')
const output = path.join(root, 'resources/recorded-speech')
const hash = (data) => createHash('sha256').update(data).digest('hex')
// Audio-cache identity follows voice/rate, not changes to the assembled pack.
const recordingProfile = 'tingting-185-v1'

function pcmFromWav(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Invalid recording')
  let pcm
  let validFormat = false
  for (let offset = 12; offset + 8 <= wav.length;) {
    const name = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    if (offset + 8 + size > wav.length) throw new Error('Truncated recording')
    if (name === 'fmt ')
      validFormat =
        wav.readUInt16LE(offset + 8) === 1 &&
        wav.readUInt16LE(offset + 10) === 1 &&
        wav.readUInt32LE(offset + 12) === 24000 &&
        wav.readUInt16LE(offset + 22) === 16
    if (name === 'data') pcm = wav.subarray(offset + 8, offset + 8 + size)
    offset += 8 + size + (size % 2)
  }
  if (!validFormat || !pcm?.length) throw new Error('Recording must be 24 kHz mono PCM16')
  // Keep 20 ms at each edge, removing only encoder/voice silence, not syllables.
  let start = 0,
    end = pcm.length
  while (start < end && Math.abs(pcm.readInt16LE(start)) < 80) start += 2
  while (end > start && Math.abs(pcm.readInt16LE(end - 2)) < 80) end -= 2
  if (end <= start) throw new Error('Silent recording')
  return pcm.subarray(Math.max(0, start - 960), Math.min(pcm.length, end + 960))
}

async function main() {
  if (process.platform !== 'darwin')
    throw new Error('Regenerate on macOS with the approved Tingting voice.')
  await fs.mkdir(cache, { recursive: true })
  await fs.mkdir(output, { recursive: true })
  const modulePath = path.join(cache, 'catalog.cjs')
  buildSync({
    entryPoints: [path.join(__dirname, 'recorded-speech-catalog.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: modulePath
  })
  const catalog = require(modulePath)
  const recordings = new Set()
  const add = (text) => {
    const normalized = catalog.normalizeRecordedText(text)
    if (/[\p{Script=Han}A-Za-z]/u.test(normalized) && normalized.length <= 2000)
      recordings.add(normalized)
  }
  for (const text of catalog.fullRecordings) add(text)
  for (const name of catalog.phraseSources) {
    const source = ts.createSourceFile(
      name,
      await fs.readFile(path.join(root, name), 'utf8'),
      ts.ScriptTarget.Latest,
      true
    )
    const visit = (node) => {
      if (
        (ts.isStringLiteralLike(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)) &&
        /\p{Script=Han}/u.test(node.text) &&
        node.text.length <= 500
      ) {
        add(node.text)
        for (const part of node.text.split(/(?<=[。，、：；！？\n])/u))
          if (part.length > 1) add(part)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  // Common Chinese characters allow new station names and free-form task text
  // to use the same recorded voice without a hidden cloud/system-voice fallback.
  const decoder = new TextDecoder('gb18030', { fatal: true })
  for (let high = 0xb0; high <= 0xf7; high++)
    for (let low = 0xa1; low <= 0xfe; low++) {
      const character = decoder.decode(Uint8Array.of(high, low))
      if (/^\p{Script=Han}$/u.test(character)) add(character)
    }
  for (const text of [...recordings])
    for (const character of text) if (/^[\p{Script=Han}A-Za-z]$/u.test(character)) add(character)
  for (const character of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz') add(character)
  for (let number = 0; number <= 100; number++) add(String(number))
  for (const text of [
    '正负',
    '小于等于',
    '大于等于',
    '摄氏度',
    '米每秒',
    '百分之',
    '杠',
    '减',
    '加',
    '至',
    '点'
  ])
    add(text)
  const texts = [...recordings].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const files = new Map()
  let cursor = 0,
    done = 0
  console.log(`Preparing ${texts.length} Tingting recordings at 185 words/minute`)
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (cursor < texts.length) {
        const text = texts[cursor++]
        // Isolated capitals are announced as "大写 G" by the native voice.
        // Record plain letter names, retaining uppercase lookup keys and IDs.
        const spokenText = /^[A-Z]+$/.test(text) ? [...text.toLowerCase()].join(' ') : text
        const filename = path.join(cache, `${hash(recordingProfile + '\0' + spokenText)}.wav`)
        let wav
        try {
          wav = await fs.readFile(filename)
          pcmFromWav(wav)
        } catch {
          await exec(
            '/usr/bin/say',
            [
              '-v',
              'Tingting',
              '-r',
              '185',
              '--file-format=WAVE',
              '--data-format=LEI16@24000',
              '-o',
              filename,
              '--',
              spokenText
            ],
            { timeout: 60000 }
          )
          wav = await fs.readFile(filename)
        }
        files.set(text, pcmFromWav(wav))
        done++
        if (done % 250 === 0 || done === texts.length)
          console.log(`Recorded ${done}/${texts.length}`)
      }
    })
  )
  const clips = {},
    buffers = []
  let offset = 0
  for (const text of texts) {
    const pcm = files.get(text)
    clips[text] = [offset, pcm.length]
    buffers.push(pcm)
    offset += pcm.length
  }
  const pack = Buffer.concat(buffers)
  const chunkBytes = 16 * 1024 * 1024
  const packedFiles = []
  for (let offset = 0, index = 0; offset < pack.length; offset += chunkBytes, index++) {
    const chunk = pack.subarray(offset, offset + chunkBytes)
    const name = `audio-${String(index).padStart(3, '0')}.pcm`
    await fs.writeFile(path.join(output, name + '.tmp'), chunk)
    await fs.rename(path.join(output, name + '.tmp'), path.join(output, name))
    packedFiles.push({ name, bytes: chunk.length, sha256: hash(chunk) })
  }
  const manifest = {
    version: catalog.RECORDED_SPEECH_VERSION,
    voice: catalog.RECORDED_VOICE,
    rate: 185,
    sampleRate: 24000,
    channels: 1,
    bitsPerSample: 16,
    bytes: pack.length,
    sha256: hash(pack),
    chunkBytes,
    files: packedFiles,
    clips
  }
  await fs.writeFile(path.join(output, 'manifest.json.tmp'), JSON.stringify(manifest) + '\n')
  await fs.rename(path.join(output, 'manifest.json.tmp'), path.join(output, 'manifest.json'))
  await fs.rm(path.join(output, 'audio.pcm'), { force: true })
  console.log(
    `Recorded speech ready: ${texts.length} clips, ${(pack.length / 1024 / 1024).toFixed(1)} MiB`
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
