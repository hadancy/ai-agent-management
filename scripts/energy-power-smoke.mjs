import { buildSync } from 'esbuild'
import electron from 'electron'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const directory = mkdtempSync(join(tmpdir(), 'energy-power-smoke-'))
const dataDirectory = mkdtempSync(join(tmpdir(), 'energy-power-data-'))
const screenshots = resolve(process.env.ENERGY_POWER_SCREENSHOTS ?? tmpdir())
try {
  buildSync({
    entryPoints: ['scripts/energy-power-smoke.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    loader: { '.png': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"development"' },
    outfile: join(directory, 'smoke.js')
  })
  writeFileSync(
    join(directory, 'index.html'),
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="smoke.css"><div id="root"></div><script src="smoke.js"></script></html>'
  )
  writeFileSync(
    join(directory, 'main.cjs'),
    `
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')
app.setPath('userData', ${JSON.stringify(dataDirectory)})
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1040, height: 720, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } })
  try {
    await window.loadFile(join(__dirname, 'index.html'))
    const reports = await window.webContents.executeJavaScript('window.runEnergyPowerSmoke()')
    reports.forEach(report => console.log(report))
    mkdirSync(${JSON.stringify(screenshots)}, { recursive: true })
    writeFileSync(join(${JSON.stringify(screenshots)}, 'energy-power.png'), (await window.webContents.capturePage()).toPNG())
    window.setContentSize(760, 550)
    await window.webContents.executeJavaScript('window.runEnergyPowerSmoke()')
    writeFileSync(join(${JSON.stringify(screenshots)}, 'energy-power-small.png'), (await window.webContents.capturePage()).toPNG())
    console.log('PASS: smaller 760px topology and screenshots')
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
})
`
  )
  const result = spawnSync(electron, [join(directory, 'main.cjs')], {
    stdio: 'inherit',
    timeout: 45_000
  })
  if (result.error) throw result.error
  if (result.signal) throw new Error(`Electron exited with ${result.signal}`)
  process.exitCode = result.status ?? 1
} finally {
  rmSync(directory, { recursive: true, force: true })
  rmSync(dataDirectory, { recursive: true, force: true })
}
