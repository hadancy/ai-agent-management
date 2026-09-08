import { buildSync } from 'esbuild'
import electron from 'electron'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const directory = mkdtempSync(join(tmpdir(), 'risk-alarm-smoke-'))
try {
  buildSync({
    entryPoints: [fileURLToPath(new URL('./risk-alarm-smoke.tsx', import.meta.url))],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    outfile: join(directory, 'smoke.js')
  })
  writeFileSync(
    join(directory, 'index.html'),
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="smoke.css"><title>告警回归验证</title><div id="root"></div><script src="smoke.js"></script></html>'
  )
  writeFileSync(
    join(directory, 'main.cjs'),
    `const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1000, height: 800, show: false,
    webPreferences: { backgroundThrottling: false }
  })
  try {
    await window.loadFile(join(__dirname, 'index.html'))
    const reports = await window.webContents.executeJavaScript('window.runRiskAlarmSmoke()')
    reports.forEach(report => console.log(report))
    if (process.env.ALARM_SMOKE_SCREENSHOT) {
      const image = await window.webContents.capturePage()
      writeFileSync(process.env.ALARM_SMOKE_SCREENSHOT, image.toPNG())
    }
    console.log(await window.webContents.executeJavaScript('window.cleanupRiskAlarmSmoke()'))
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
`
  )
  const result = spawnSync(electron, [join(directory, 'main.cjs')], {
    stdio: 'inherit',
    timeout: 30000
  })
  if (result.error) throw result.error
  if (result.signal) throw new Error(`Electron exited with ${result.signal}`)
  process.exitCode = result.status ?? 1
} finally {
  rmSync(directory, { recursive: true, force: true })
}
