import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { SPEECH_CHANNELS, type SpeechSettingsInput } from '../shared/speech-settings'
import type { SpeechService } from './server/speech-service'
import { trustedSpeechSettingsUrl } from './speech-access'

export function registerSpeechSettingsIpc(service: SpeechService, developmentUrl?: string): void {
  const check = (event: IpcMainInvokeEvent): void => {
    if (
      !BrowserWindow.fromWebContents(event.sender) ||
      event.senderFrame !== event.sender.mainFrame ||
      !trustedSpeechSettingsUrl(event.senderFrame.url, developmentUrl)
    )
      throw new Error('只能在管理端桌面软件中修改语音设置。')
  }
  ipcMain.handle(SPEECH_CHANNELS.get, (event) => {
    check(event)
    return service.status()
  })
  ipcMain.handle(SPEECH_CHANNELS.save, (event, input: SpeechSettingsInput) => {
    check(event)
    return service.save(input)
  })
  ipcMain.handle(SPEECH_CHANNELS.test, (event) => {
    check(event)
    return service.test()
  })
}
