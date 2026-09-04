import { app, shell, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { WINDOW_CONTROL_CHANNELS } from '../shared/window-controls'
import { startEmbeddedServer, type EmbeddedServer } from './server'

let embeddedServer: EmbeddedServer | undefined
let shuttingDown = false

const DESIGN_WIDTH = 1680
const DESIGN_HEIGHT = 977
const DESIGN_ASPECT_RATIO = DESIGN_WIDTH / DESIGN_HEIGHT
const INITIAL_CONTENT_WIDTH = 1440
const INITIAL_CONTENT_HEIGHT = Math.round(INITIAL_CONTENT_WIDTH / DESIGN_ASPECT_RATIO)
const MINIMUM_CONTENT_WIDTH = 1180
const MINIMUM_CONTENT_HEIGHT = Math.round(MINIMUM_CONTENT_WIDTH / DESIGN_ASPECT_RATIO)

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    title: 'AI智能体辅助管理平台',
    width: INITIAL_CONTENT_WIDTH,
    height: INITIAL_CONTENT_HEIGHT,
    minWidth: MINIMUM_CONTENT_WIDTH,
    minHeight: MINIMUM_CONTENT_HEIGHT,
    useContentSize: true,
    frame: false,
    backgroundColor: '#020b16',
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.setAspectRatio(DESIGN_ASPECT_RATIO)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadURL('http://127.0.0.1:17880/b')
  }
}

function getEventWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function registerWindowControlHandlers(): void {
  ipcMain.handle(WINDOW_CONTROL_CHANNELS.minimize, (event) => {
    getEventWindow(event)?.minimize()
  })
  ipcMain.handle(WINDOW_CONTROL_CHANNELS.toggleMaximize, (event) => {
    const window = getEventWindow(event)
    if (!window) return false

    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
    return window.isMaximized()
  })
  ipcMain.handle(WINDOW_CONTROL_CHANNELS.close, (event) => {
    getEventWindow(event)?.close()
  })
}

app
  .whenReady()
  .then(async () => {
    electronApp.setAppUserModelId('com.aiagent.management')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerWindowControlHandlers()

    embeddedServer = await startEmbeddedServer({
      dataDirectory: join(app.getPath('userData'), 'data'),
      rendererDirectory: join(__dirname, '../renderer'),
      developmentRendererUrl: is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error: unknown) => {
    console.error('Failed to start embedded server', error)
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('启动失败', `内置服务无法启动：${message}`)
    app.quit()
  })

app.on('before-quit', (event) => {
  if (!embeddedServer || shuttingDown) return
  event.preventDefault()
  shuttingDown = true
  void embeddedServer.stop().finally(() => {
    embeddedServer = undefined
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
