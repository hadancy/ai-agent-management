/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { createHash } = require('node:crypto')
const { readFile } = require('node:fs/promises')
const { join } = require('node:path')

async function prepareSpeech(directory = join(__dirname, '../resources/recorded-speech')) {
  let manifest
  try {
    manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
    if (
      manifest.version !== 'tingting-185-v2' ||
      manifest.voice !== 'Tingting' ||
      manifest.sampleRate !== 24000 ||
      manifest.channels !== 1 ||
      manifest.bitsPerSample !== 16 ||
      !manifest.clips ||
      Object.keys(manifest.clips).length < 6000 ||
      !manifest.files?.length
    )
      throw new Error('Invalid manifest')
    let size = 0
    const digest = createHash('sha256')
    for (const [index, file] of manifest.files.entries()) {
      if (file.name !== `audio-${String(index).padStart(3, '0')}.pcm`)
        throw new Error('Invalid pack name')
      const data = await readFile(join(directory, file.name))
      if (
        data.length !== file.bytes ||
        createHash('sha256').update(data).digest('hex') !== file.sha256
      )
        throw new Error('Recording checksum mismatch')
      if (data.length !== Math.min(manifest.chunkBytes, manifest.bytes - size))
        throw new Error('Invalid pack size')
      size += data.length
      digest.update(data)
    }
    if (size !== manifest.bytes || digest.digest('hex') !== manifest.sha256)
      throw new Error('Incomplete pack')
    for (const range of Object.values(manifest.clips)) {
      if (
        !Array.isArray(range) ||
        range.length !== 2 ||
        !range.every(Number.isSafeInteger) ||
        range[0] < 0 ||
        range[1] <= 0 ||
        range.some((n) => n % 2) ||
        range[0] + range[1] > size
      )
        throw new Error('Invalid clip')
    }
    console.log(
      `Tingting recordings verified: ${Object.keys(manifest.clips).length} clips, ${(size / 1024 / 1024).toFixed(1)} MiB`
    )
  } catch (error) {
    throw new Error(
      `婷婷预录语音包缺失或校验失败。请恢复 resources/recorded-speech，或在 macOS 上运行 npm run generate:speech。${error.message}`
    )
  }
}
module.exports = async () => prepareSpeech()
module.exports.prepareSpeech = prepareSpeech
if (require.main === module)
  prepareSpeech(process.argv[2]).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
