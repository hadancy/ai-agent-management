import { buildSync } from 'esbuild'
import electron from 'electron'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const directory = mkdtempSync(join(tmpdir(), 'pad-speech-smoke-'))
try {
  const rendererHtml = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8')
  const csp = rendererHtml.match(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/)?.[0]
  if (!csp) throw new Error('Renderer CSP must be present in the audio integration test')
  buildSync({
    entryPoints: [fileURLToPath(new URL('./pad-speech-smoke.tsx', import.meta.url))],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    outfile: join(directory, 'smoke.js')
  })
  writeFileSync(
    join(directory, 'index.html'),
    `<!doctype html><meta charset="utf-8">${csp}<div id="root"></div><script src="smoke.js"></script>`
  )
  writeFileSync(
    join(directory, 'main.cjs'),
    `
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  try {
    await window.loadFile(join(__dirname, 'index.html'))
    const reports = await window.webContents.executeJavaScript('window.runPadSpeechSmoke()')
    reports.forEach(report => console.log(report))
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
})
`
  )
  const result = spawnSync(electron, [join(directory, 'main.cjs')], {
    stdio: 'inherit',
    timeout: 30_000
  })
  if (result.error) throw result.error
  if (result.signal) throw new Error(`Electron exited with ${result.signal}`)
  process.exitCode = result.status ?? 1
} finally {
  rmSync(directory, { recursive: true, force: true })
}
