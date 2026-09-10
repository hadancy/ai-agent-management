import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { release, tmpdir } from 'node:os'
import { join } from 'node:path'

export interface SpeechResources {
  modelDirectory: string
  runtimeDirectory: string
}

export function speechResourcePaths(
  appDirectory: string,
  packaged: boolean,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): SpeechResources {
  const root = join(appDirectory, ...(packaged ? ['offline-tts'] : ['resources', 'offline-tts']))
  const os = { win32: 'win', darwin: 'mac', linux: 'linux' }[platform as string]
  return {
    modelDirectory: join(root, 'model'),
    runtimeDirectory: join(root, packaged ? 'runtime' : `${os}-${arch}`)
  }
}

export async function synthesizeSpeech(text: string, resources?: SpeechResources): Promise<Buffer> {
  if (!resources) throw new Error('平台离线语音资源未配置，请更新并重启平台。')
  if (process.platform === 'win32' && Number(release().split('.')[2]) < 18362)
    throw new Error('内置中文语音需要 Windows 10 1903 或更高版本。')
  const executable = join(
    resources.runtimeDirectory,
    'bin',
    `sherpa-onnx-offline-tts${process.platform === 'win32' ? '.exe' : ''}`
  )
  const modelFiles = [
    'model.onnx',
    'tokens.txt',
    'lexicon.txt',
    'phone.fst',
    'date.fst',
    'number.fst'
  ]
  try {
    await Promise.all([
      access(executable),
      ...modelFiles.map((name) => access(join(resources.modelDirectory, name)))
    ])
  } catch {
    throw new Error('平台内置中文语音资源缺失，请重新安装完整版本的管理平台。')
  }
  const directory = await mkdtemp(join(tmpdir(), 'platform-speech-'))
  const output = join(directory, 'speech.wav')
  try {
    // Relative model paths also work when the installation directory contains commas.
    // Arguments are passed directly, with an end-of-options delimiter for user text.
    await new Promise<void>((resolve, reject) => {
      execFile(
        executable,
        [
          '--vits-model=model.onnx',
          '--vits-tokens=tokens.txt',
          '--vits-lexicon=lexicon.txt',
          '--tts-rule-fsts=phone.fst,date.fst,number.fst',
          '--sid=10',
          '--speed=1',
          '--num-threads=2',
          '--print-args=false',
          `--output-filename=${output}`,
          '--',
          text
        ],
        {
          cwd: resources.modelDirectory,
          timeout: 90_000,
          killSignal: 'SIGKILL',
          windowsHide: true,
          maxBuffer: 1024 * 1024
        },
        (error) => (error ? reject(error) : resolve())
      )
    })
    const data = await readFile(output)
    if (
      data.length <= 44 ||
      data.length > 24 * 1024 * 1024 ||
      data.toString('ascii', 0, 4) !== 'RIFF' ||
      data.toString('ascii', 8, 12) !== 'WAVE'
    )
      throw new Error('INVALID_WAV')
    return data
  } catch {
    // Do not return child-process stderr: it includes the task's full text and local paths.
    throw new Error('平台离线语音生成失败或超时，请重试；持续失败时请重新安装完整版本。')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
