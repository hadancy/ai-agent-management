import { validatePlcPointValue, type PlcPoint } from '../../shared/plc'

export function decodePlcPoint(point: PlcPoint, data: Buffer, offset = 0): number {
  return point.type === 'WORD' ? data.readUInt16BE(offset) / point.scale : data.readFloatBE(offset)
}

export function encodePlcPoint(point: PlcPoint, value: number): Buffer {
  const error = validatePlcPointValue(point, value)
  if (error) throw new Error(error)
  const data = Buffer.alloc(point.type === 'WORD' ? 2 : 4)
  if (point.type === 'WORD') data.writeUInt16BE(Math.round(value * point.scale))
  else data.writeFloatBE(value)
  return data
}
