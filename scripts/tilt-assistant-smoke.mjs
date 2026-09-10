import { buildSync } from 'esbuild'
import electron from 'electron'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const cache = resolve('node_modules/.cache')
mkdirSync(cache, { recursive: true })
const directory = mkdtempSync(join(cache, 'tilt-smoke-'))
const dataDirectory = mkdtempSync(join(tmpdir(), 'tilt-ui-data-'))
const screenshot = process.env.TILT_SMOKE_SCREENSHOT || join(tmpdir(), 'tilt-assistant-smoke.png')
try {
  buildSync({
    entryPoints: ['scripts/tilt-assistant-smoke.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.DEV': 'false' },
    outfile: join(directory, 'ui.js')
  })
  buildSync({
    stdin: {
      contents:
        "export { createAppDatabase } from './src/main/server/database'; export { WorkOrderService, registerWorkOrderRoutes } from './src/main/server/work-orders'; export { runTiltWorkOrderSmoke } from './scripts/tilt-work-order-smoke'",
      resolveDir: process.cwd()
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    outfile: join(directory, 'server.cjs')
  })
  writeFileSync(
    join(directory, 'index.html'),
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><title>倾角助手验证</title><div id="root"></div><script src="ui.js"></script></html>'
  )
  writeFileSync(
    join(directory, 'preload.cjs'),
    `const { ipcRenderer } = require('electron')
window.fetch = async (url, options = {}) => {
  const result = await ipcRenderer.invoke('api', { url: String(url), method: options.method || 'GET', body: options.body })
  return new Response(result.body, { status: result.statusCode, headers: { 'Content-Type': 'application/json' } })
}
window.saveTiltScreenshot = () => ipcRenderer.invoke('screenshot')
`
  )
  writeFileSync(
    join(directory, 'main.cjs'),
    `const { app, BrowserWindow, ipcMain } = require('electron')
const { join } = require('node:path')
const { writeFileSync } = require('node:fs')
const Fastify = require('fastify')
const { createAppDatabase, WorkOrderService, registerWorkOrderRoutes, runTiltWorkOrderSmoke } = require('./server.cjs')
app.setPath('userData', ${JSON.stringify(join(dataDirectory, 'electron'))})
app.whenReady().then(async () => {
  let database, api
  try {
    await runTiltWorkOrderSmoke()
    database = createAppDatabase(${JSON.stringify(dataDirectory)})
    api = Fastify()
    registerWorkOrderRoutes(api, new WorkOrderService({ database, broadcast: () => {}, getLatestSnapshot: () => undefined }))
    ipcMain.handle('api', async (_, request) => {
      const response = await api.inject({ method: request.method, url: new URL(request.url).pathname + new URL(request.url).search, ...(request.body ? { payload: JSON.parse(request.body) } : {}) })
      return { statusCode: response.statusCode, body: response.body }
    })
    const window = new BrowserWindow({ width: 1680, height: 977, show: false, webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false } })
    ipcMain.handle('screenshot', async () => { writeFileSync(${JSON.stringify(screenshot)}, (await window.webContents.capturePage()).toPNG()) })
    await window.loadFile(join(__dirname, 'index.html'))
    const reports = await window.webContents.executeJavaScript('window.runTiltAssistantSmoke()')
    reports.forEach(report => console.log(report))
    console.log('Screenshot: ' + ${JSON.stringify(screenshot)})
    await api.close(); database.close(); app.exit(0)
  } catch (error) { console.error(error); if (api) await api.close(); if (database) database.close(); app.exit(1) }
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
