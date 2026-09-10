import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { WINDOW_CONTROL_CHANNELS, type DesktopAPI } from '../shared/window-controls'
import { SPEECH_CHANNELS } from '../shared/speech-settings'

// Custom APIs for renderer
const api: DesktopAPI = {
  speechSettings: {
    get: () => ipcRenderer.invoke(SPEECH_CHANNELS.get),
    save: (input) => ipcRenderer.invoke(SPEECH_CHANNELS.save, input),
    test: () => ipcRenderer.invoke(SPEECH_CHANNELS.test)
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke(WINDOW_CONTROL_CHANNELS.minimize),
    toggleMaximize: () => ipcRenderer.invoke(WINDOW_CONTROL_CHANNELS.toggleMaximize),
    close: () => ipcRenderer.invoke(WINDOW_CONTROL_CHANNELS.close)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
