export function trustedSpeechSettingsUrl(value: string, developmentUrl?: string): boolean {
  try {
    const url = new URL(value)
    const origin = new URL(developmentUrl ?? 'http://127.0.0.1:17880').origin
    return (
      url.origin === origin && ['/', '/b'].includes(url.pathname) && !url.username && !url.password
    )
  } catch {
    return false
  }
}
