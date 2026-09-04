import { networkInterfaces } from 'node:os'

interface LanAddressCandidate {
  interfaceName: string
  address: string
}

function scoreAddress(address: string): number {
  if (address.startsWith('192.168.')) return 3
  if (address.startsWith('10.')) return 2
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 1
  return 0
}

function isLikelyWifiInterface(interfaceName: string): boolean {
  const normalizedName = interfaceName.trim().toLowerCase()

  if (process.platform === 'darwin' && normalizedName === 'en0') return true

  return (
    /(^|[\s_-])(wi-?fi|wifi|wlan|wireless)([\s_-]|$)/i.test(normalizedName) ||
    /^wl[a-z0-9]/i.test(normalizedName) ||
    normalizedName.includes('无线')
  )
}

function getLanAddressCandidates(): LanAddressCandidate[] {
  return Object.entries(networkInterfaces()).flatMap(([interfaceName, entries]) =>
    (entries ?? [])
      .filter((entry) => entry.family === 'IPv4' && !entry.internal)
      .map((entry) => ({ interfaceName, address: entry.address }))
  )
}

function selectBestAddress(candidates: LanAddressCandidate[]): LanAddressCandidate | undefined {
  return candidates.sort(
    (left, right) => scoreAddress(right.address) - scoreAddress(left.address)
  )[0]
}

export function getWifiLanAddress(): string {
  const candidates = getLanAddressCandidates()
  const configuredInterface = process.env['APP_WIFI_INTERFACE']?.trim()

  if (configuredInterface) {
    const configuredCandidate = selectBestAddress(
      candidates.filter(
        (candidate) =>
          candidate.interfaceName.localeCompare(configuredInterface, undefined, {
            sensitivity: 'accent'
          }) === 0
      )
    )

    if (configuredCandidate) return configuredCandidate.address

    console.warn(
      `[network] Wi-Fi interface "${configuredInterface}" has no active IPv4 address; trying automatic detection.`
    )
  }

  const wifiCandidate = selectBestAddress(
    candidates.filter((candidate) => isLikelyWifiInterface(candidate.interfaceName))
  )

  if (wifiCandidate) return wifiCandidate.address

  const fallbackCandidate = selectBestAddress(candidates)
  if (fallbackCandidate) {
    console.warn(
      `[network] Wi-Fi interface was not detected; falling back to ${fallbackCandidate.interfaceName} (${fallbackCandidate.address}). Set APP_WIFI_INTERFACE to lock the sharing address.`
    )
    return fallbackCandidate.address
  }

  return '127.0.0.1'
}
