/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- electron-builder loads this hook directly as CommonJS. */
const { execFile } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')
const assets = require('./speech-assets.json')

const exec = promisify(execFile)
const root = path.resolve(__dirname, '..')
const destination = path.join(root, 'resources/offline-tts')
const cache = path.join(root, 'node_modules/.cache/offline-tts/downloads')
const revision = 1
const hash = (data) => createHash('sha256').update(data).digest('hex')

function targetName(platform = process.platform, arch = process.arch) {
  return `${{ win32: 'win', darwin: 'mac', linux: 'linux' }[platform]}-${arch}`
}

async function valid(directory, asset) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'asset.json'), 'utf8'))
    if (manifest.revision !== revision || manifest.archiveSha256 !== asset.sha256) return false
    if (!manifest.files?.length) return false
    for (const file of manifest.files) {
      if (hash(await fs.readFile(path.join(directory, file.name))) !== file.sha256) return false
    }
    return true
  } catch {
    return false
  }
}

async function download(asset) {
  await fs.mkdir(cache, { recursive: true })
  const archive = path.join(cache, `${asset.name}.tar.bz2`)
  try {
    if (hash(await fs.readFile(archive)) === asset.sha256) return archive
  } catch {
    // First build downloads the pinned official asset. End users never download models.
  }
  console.log(`Downloading offline speech: ${asset.name}`)
  const temporary = `${archive}.${process.pid}.download`
  try {
    await exec(
      process.platform === 'win32' ? 'curl.exe' : 'curl',
      [
        '--fail',
        '--location',
        '--silent',
        '--show-error',
        '--retry',
        '2',
        '--connect-timeout',
        '30',
        '--max-time',
        '600',
        asset.url ??
          `https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.7/${asset.name}.tar.bz2`,
        '--output',
        temporary
      ],
      { timeout: 650_000, windowsHide: true }
    )
    if (hash(await fs.readFile(temporary)) !== asset.sha256)
      throw new Error(`Offline speech checksum mismatch: ${asset.name}`)
    await fs.rename(temporary, archive)
    return archive
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

// The upstream CLI uses narrow argv. Set UTF-8 for this process only on Windows
// 10 1903+, preserving its asInvoker manifest; no system locale changes required.
async function enableWindowsUtf8(filename) {
  const { NtExecutable, NtExecutableResource } = require('resedit')
  const executable = NtExecutable.from(await fs.readFile(filename))
  const resources = NtExecutableResource.from(executable)
  const manifest = resources.entries.find((item) => item.type === 24 && item.id === 1)
  if (!manifest) throw new Error('Speech executable has no application manifest')
  const xml = Buffer.from(manifest.bin).toString('utf8')
  if (!xml.includes('</assembly>') || xml.includes('activeCodePage'))
    throw new Error('Unexpected upstream speech manifest')
  manifest.bin = Buffer.from(
    xml.replace(
      '</assembly>',
      `
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">UTF-8</activeCodePage>
    </windowsSettings>
  </application>
</assembly>`
    )
  )
  resources.outputResource(executable)
  await fs.writeFile(filename, Buffer.from(executable.generate()))
}

async function prepareAsset(asset, folder, target) {
  const output = path.join(destination, folder)
  if (await valid(output, asset)) return
  const archive = await download(asset)
  await fs.mkdir(destination, { recursive: true })
  const temporary = await fs.mkdtemp(path.join(destination, '.prepare-'))
  try {
    await exec('tar', ['-xjf', archive, '-C', temporary], { windowsHide: true })
    const source = path.join(temporary, asset.name)
    const staging = path.join(temporary, 'staging')
    let files
    if (!target) {
      files = ['model.onnx', 'lexicon.txt', 'tokens.txt', 'phone.fst', 'date.fst', 'number.fst']
    } else if (target.startsWith('win-')) {
      files = [
        'bin/sherpa-onnx-offline-tts.exe',
        'bin/onnxruntime.dll',
        'bin/onnxruntime_providers_shared.dll'
      ]
    } else {
      files = [
        'bin/sherpa-onnx-offline-tts',
        ...(await fs.readdir(path.join(source, 'lib')))
          .filter((name) => /^libonnxruntime.*\.(dylib|so(?:\..*)?)$/.test(name))
          .map((name) => `lib/${name}`)
      ]
      if (files.length < 2) throw new Error('Offline speech runtime library missing')
    }
    for (const name of files) {
      await fs.mkdir(path.dirname(path.join(staging, name)), { recursive: true })
      await fs.cp(path.join(source, name), path.join(staging, name), { verbatimSymlinks: true })
    }
    if (target?.startsWith('win-'))
      await enableWindowsUtf8(path.join(staging, 'bin/sherpa-onnx-offline-tts.exe'))
    const manifest = { revision, archiveSha256: asset.sha256, files: [] }
    for (const name of files) {
      const data = await fs.readFile(path.join(staging, name))
      manifest.files.push({ name, bytes: data.length, sha256: hash(data) })
    }
    await fs.writeFile(path.join(staging, 'asset.json'), JSON.stringify(manifest, null, 2) + '\n')
    await fs.rm(output, { recursive: true, force: true })
    await fs.rename(staging, output)
    console.log(
      `Prepared offline speech ${folder}: ${(manifest.files.reduce((n, f) => n + f.bytes, 0) / 1024 / 1024).toFixed(1)} MiB`
    )
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

async function prepareSpeech(target = targetName()) {
  const runtime = assets.runtimes[target]
  if (!runtime) throw new Error(`Offline speech does not yet support build target ${target}`)
  await prepareAsset(assets.model, 'model')
  await prepareAsset(runtime, target, target)
  console.log(`Offline Chinese speech ready: ${target}`)
}

// electron-builder passes the target architecture, which can differ from the host.
module.exports = async (context) => {
  const { Arch } = require('builder-util')
  await prepareSpeech(targetName(context.electronPlatformName, Arch[context.arch]))
}
module.exports.prepareSpeech = prepareSpeech
module.exports.targetName = targetName

if (require.main === module) {
  prepareSpeech(process.argv[2]).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
