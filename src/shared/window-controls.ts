export const WINDOW_CONTROL_CHANNELS = {
  minimize: 'window-control:minimize',
  toggleMaximize: 'window-control:toggle-maximize',
  close: 'window-control:close'
} as const

export interface WindowControlsAPI {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<boolean>
  close: () => Promise<void>
}

export interface DesktopAPI {
  windowControls: WindowControlsAPI
  speechSettings: SpeechSettingsAPI
}
import type { SpeechSettingsAPI } from './speech-settings'
