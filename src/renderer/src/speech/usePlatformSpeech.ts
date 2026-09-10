import { useCallback, useEffect, useRef, useState } from 'react'
import { getServiceOrigin } from '../realtime'
import { PlatformSpeechPlayer, type VoicePlaybackState } from './PlatformSpeechPlayer'

export function usePlatformSpeech(serviceOrigin = getServiceOrigin()): VoicePlaybackState & {
  speak: (text: string, userInitiated?: boolean) => void
  stop: () => void
  resume: () => boolean
} {
  const [state, setState] = useState<VoicePlaybackState>({
    status: 'idle',
    message: '语音提示待播放'
  })
  const playerRef = useRef<PlatformSpeechPlayer | null>(null)
  useEffect(() => {
    const player = new PlatformSpeechPlayer(serviceOrigin, setState)
    playerRef.current = player
    return () => {
      playerRef.current = null
      player.dispose()
    }
  }, [serviceOrigin])
  const speak = useCallback((text: string, userInitiated = false): void => {
    playerRef.current?.play(text, undefined, userInitiated)
  }, [])
  const stop = useCallback((): void => {
    playerRef.current?.stop()
    setState({ status: 'idle', message: '播报已停止' })
  }, [])
  const resume = useCallback((): boolean => playerRef.current?.resume() ?? false, [])
  return { ...state, speak, stop, resume }
}
