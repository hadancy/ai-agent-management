import { ElectronAPI } from '@electron-toolkit/preload'
import type { DesktopAPI } from '../shared/window-controls'

declare global {
  interface Window {
    electron: ElectronAPI
    api?: DesktopAPI
  }
}
