import { buildSync } from 'esbuild'
import electron from 'electron'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const cache = resolve('node_modules/.cache')
mkdirSync(cache, { recursive: true })
const directory = mkdtempSync(join(cache, 'pad-field-ui-'))
const dataDirectory = mkdtempSync(join(tmpdir(), 'pad-field-data-'))
const screenshots = process.env.PAD_FIELD_SCREENSHOTS || tmpdir()
const productionPolicy = readFileSync('src/renderer/index.html', 'utf8').match(
  /content="(default-src[^"]+)"/
)[1]
mkdirSync(screenshots, { recursive: true })
try {
  buildSync({
    entryPoints: ['scripts/pad-field-smoke.tsx'],
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
        "export { createAppDatabase } from './src/main/server/database'; export { WorkOrderService, registerWorkOrderRoutes } from './src/main/server/work-orders'; export { runPadFieldWorkOrderSmoke } from './scripts/pad-field-work-order-smoke'",
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
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script></html>'
  )
  writeFileSync(
    join(directory, 'preload.cjs'),
    "const { ipcRenderer } = require('electron'); window.savePadScreenshot = (name) => ipcRenderer.invoke('screenshot', name)"
  )
  writeFileSync(
    join(directory, 'main.cjs'),
    `
const { app, BrowserWindow, ipcMain } = require('electron')
const { join } = require('node:path')
const { writeFileSync } = require('node:fs')
const Fastify = require('fastify')
const { createAppDatabase, WorkOrderService, registerWorkOrderRoutes, runPadFieldWorkOrderSmoke } = require('./server.cjs')
app.setPath('userData', ${JSON.stringify(join(dataDirectory, 'electron'))})
app.whenReady().then(async () => {
  let database, api
  try {
    await runPadFieldWorkOrderSmoke()
    database = createAppDatabase(${JSON.stringify(dataDirectory)})
    api = Fastify()
    registerWorkOrderRoutes(api, new WorkOrderService({ database, broadcast: () => {}, getLatestSnapshot: () => undefined }))
    await api.register(require('@fastify/cors'), { origin: true })
    const address = await api.listen({ host: '127.0.0.1', port: 0 })
    const policy = ${JSON.stringify(productionPolicy)}.replaceAll(':17880', ':' + new URL(address).port)
    writeFileSync(join(__dirname, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + policy + '"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script></html>')
    const window = new BrowserWindow({ width: 1280, height: 1050, show: false, webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false } })
    ipcMain.handle('screenshot', async (_, name) => { if (!/^[a-z-]+$/.test(name)) throw new Error('Invalid name'); writeFileSync(join(${JSON.stringify(screenshots)}, name + '.png'), (await window.webContents.capturePage()).toPNG()) })
    window.webContents.on('console-message', (event) => { if (event.message.startsWith('PASS:') || event.level === 'error') console.log(event.message) })
    await window.loadFile(join(__dirname, 'index.html'), { query: { service: address } })
    await window.webContents.executeJavaScript('window.runPadFieldSmoke()')
    console.log('Screenshots: ' + ${JSON.stringify(screenshots)})
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
