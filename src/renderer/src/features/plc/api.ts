export function plcServiceOrigin(): string {
  const url = new URL(window.location.origin)
  if (import.meta.env.DEV) url.port = '17880'
  return url.origin
}

export async function plcRequest<T>(
  action: 'config' | 'read' | 'write',
  body?: unknown
): Promise<T> {
  const response = await fetch(`${plcServiceOrigin()}/api/plc/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Plc-Request': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message ?? `请求失败（${response.status}）`)
  return data as T
}
