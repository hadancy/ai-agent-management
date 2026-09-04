import { execFileSync } from 'node:child_process'
import { networkInterfaces } from 'node:os'

interface LanAddressCandidate {
  interfaceName: string
  address: string
}

const WINDOWS_WIFI_INTERFACE_COMMAND = [
  "$ErrorActionPreference = 'Stop'",
  "$wifiNames = @(Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' -and (([int]$_.NdisPhysicalMedium -eq 1) -or ([int]$_.NdisPhysicalMedium -eq 9) -or ($_.InterfaceDescription -match 'Wi-?Fi|Wireless|WLAN|802\\.11')) } | Select-Object -ExpandProperty Name)",
  'ConvertTo-Json -Compress -InputObject $wifiNames'
].join('\n')

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

function interfaceNamesEqual(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
}

function getWindowsWifiInterfaceNames(): string[] {
  if (process.platform !== 'win32') return []

  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_WIFI_INTERFACE_COMMAND],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10_000,
        windowsHide: true
      }
    ).trim()

    if (!output) return []

    const parsed: unknown = JSON.parse(output)
    if (typeof parsed === 'string') return [parsed]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    console.warn(
      '[network] Windows could not report the active Wi-Fi adapter; trying adapter-name detection.'
    )
    return []
  }
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
      candidates.filter((candidate) =>
        interfaceNamesEqual(candidate.interfaceName, configuredInterface)
      )
    )

    if (configuredCandidate) {
      console.info(
        `[network] Sharing address uses configured Wi-Fi interface ${configuredCandidate.interfaceName} (${configuredCandidate.address}).`
      )
      return configuredCandidate.address
    }

    console.warn(
      `[network] Wi-Fi interface "${configuredInterface}" has no active IPv4 address; trying automatic detection.`
    )
  }

  const windowsWifiInterfaceNames = getWindowsWifiInterfaceNames()
  const windowsWifiCandidate = selectBestAddress(
    candidates.filter((candidate) =>
      windowsWifiInterfaceNames.some((interfaceName) =>
        interfaceNamesEqual(candidate.interfaceName, interfaceName)
      )
    )
  )

  if (windowsWifiCandidate) {
    console.info(
      `[network] Sharing address uses Windows Wi-Fi interface ${windowsWifiCandidate.interfaceName} (${windowsWifiCandidate.address}).`
    )
    return windowsWifiCandidate.address
  }

  const wifiCandidate = selectBestAddress(
    candidates.filter((candidate) => isLikelyWifiInterface(candidate.interfaceName))
  )

  if (wifiCandidate) {
    console.info(
      `[network] Sharing address uses Wi-Fi interface ${wifiCandidate.interfaceName} (${wifiCandidate.address}).`
    )
    return wifiCandidate.address
  }

  const availableInterfaces = [...new Set(candidates.map((candidate) => candidate.interfaceName))]
  console.warn(
    `[network] No active Wi-Fi IPv4 address was detected; sharing is limited to localhost. Available interfaces: ${availableInterfaces.join(', ') || 'none'}. Set APP_WIFI_INTERFACE if the Wi-Fi adapter uses a custom name.`
  )
  return '127.0.0.1'
}
