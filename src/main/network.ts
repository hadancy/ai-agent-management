import { networkInterfaces } from 'node:os'

function scoreAddress(address: string): number {
  if (address.startsWith('192.168.')) return 3
  if (address.startsWith('10.')) return 2
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 1
  return 0
}

export function getPrimaryLanAddress(): string {
  const candidates = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)

  return (
    candidates.sort((left, right) => scoreAddress(right) - scoreAddress(left))[0] ?? '127.0.0.1'
  )
}
