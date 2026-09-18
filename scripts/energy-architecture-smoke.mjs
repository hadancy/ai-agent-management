import { buildSync } from 'esbuild'
import electron from 'electron'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const directory = mkdtempSync(join(tmpdir(), 'energy-architecture-smoke-'))
const dataDirectory = mkdtempSync(join(tmpdir(), 'energy-architecture-data-'))
const screenshots = resolve(
  process.env.ENERGY_ARCHITECTURE_SCREENSHOTS ?? join(tmpdir(), 'energy-architecture-screenshots')
)
try {
  buildSync({
    entryPoints: ['scripts/energy-architecture-smoke.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    loader: { '.png': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.DEV': 'false' },
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
  const window = new BrowserWindow({ width: 1080, height: 760, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } })
  try {
    await window.loadFile(join(__dirname, 'index.html'))
    const reports = await window.webContents.executeJavaScript('window.runEnergyArchitectureSmoke()')
    reports.forEach(report => console.log(report))
    mkdirSync(${JSON.stringify(screenshots)}, { recursive: true })
    for (const [width, height, scale] of [[1080, 760, 1], [760, 550, 1.3]]) {
      window.setContentSize(width, height)
      for (const [mode, highlighted] of [['traditional', false], ['traditional', true], ['direct', false], ['direct', true], ['upgrading', false]]) {
        await window.webContents.executeJavaScript('window.showEnergyArchitecture(' + JSON.stringify(mode) + ',' + highlighted + ',' + scale + ')')
        writeFileSync(join(${JSON.stringify(screenshots)}, mode + (highlighted ? '-efficiency' : '') + '-' + width + '.png'), (await window.webContents.capturePage()).toPNG())
      }
    }
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await window.webContents.executeJavaScript('window.showEnergyArchitecture("direct", true, 1.3)')
    const reduced = await window.webContents.executeJavaScript('getComputedStyle(document.querySelector(".energy-efficiency-callout strong")).animationName')
    if (reduced !== 'none') throw new Error('Reduced motion must suppress zoom animation')
    console.log('PASS: full and compact layouts, 130% font size, no text occlusion and reduced motion')
    console.log('Screenshots: ' + ${JSON.stringify(screenshots)})
    app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
})
`
  )
  const result = spawnSync(electron, [join(directory, 'main.cjs')], {
    stdio: 'inherit',
    timeout: 55_000
  })
  if (result.error) throw result.error
  if (result.signal) throw new Error(`Electron exited with ${result.signal}`)
  process.exitCode = result.status ?? 1
} finally {
  rmSync(directory, { recursive: true, force: true })
  rmSync(dataDirectory, { recursive: true, force: true })
}
