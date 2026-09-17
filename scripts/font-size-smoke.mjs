import { buildSync } from 'esbuild'
import electron from 'electron'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const directory = mkdtempSync(join(tmpdir(), 'font-size-smoke-'))
const dataDirectory = mkdtempSync(join(tmpdir(), 'font-size-data-'))
try {
  buildSync({
    entryPoints: ['scripts/font-size-smoke.tsx'],
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
const { writeFileSync } = require('node:fs')
app.setPath('userData', ${JSON.stringify(dataDirectory)})
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1680, height: 977, useContentSize: true, show: false, webPreferences: { backgroundThrottling: false } })
  try {
    await window.loadFile(join(__dirname, 'index.html'))
    const reports = await window.webContents.executeJavaScript('window.runFontSizeSmoke()')
    reports.forEach(report => console.log(report))
    for (const [page, filename] of [['设置中心', 'settings'], ['综合监控', 'monitor'], ['首页', 'home'], ['智诊精巡', 'assistant'], ['工单中心', 'work-orders']]) {
      await window.webContents.executeJavaScript('window.showFontSizePage(' + JSON.stringify(page) + ')')
      writeFileSync(join(${JSON.stringify(tmpdir())}, 'font-size-' + filename + '.png'), (await window.webContents.capturePage()).toPNG())
      const layoutError = await window.webContents.executeJavaScript('try { window.getFontSizeLayout(); null } catch (error) { error.message }')
      if (layoutError) throw new Error(page + ': ' + layoutError)
      console.log('PASS: maximum font size layout in ' + page)
    }
    window.setContentSize(1366, 768)
    await window.webContents.executeJavaScript('window.showFontSizePage("设置中心")')
    await window.webContents.executeJavaScript('window.getFontSizeLayout()')
    console.log('PASS: maximum font size header and clock remain visible in a 1366 × 768 window')
    writeFileSync(join(${JSON.stringify(tmpdir())}, 'font-size-settings-small-window.png'), (await window.webContents.capturePage()).toPNG())
    const secondWindow = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
    await secondWindow.loadFile(join(__dirname, 'index.html'))
    const resetReports = await secondWindow.webContents.executeJavaScript('window.runFontSizeSmoke(true)')
    resetReports.forEach(report => console.log(report))
    const synced = await window.webContents.executeJavaScript('getComputedStyle(document.documentElement).fontSize')
    if (synced !== '16px') throw new Error('Open windows must synchronize font changes: ' + synced)
    console.log('PASS: font size synchronized across open windows')
    console.log('Screenshots: ' + join(${JSON.stringify(tmpdir())}, 'font-size-*.png'))
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
