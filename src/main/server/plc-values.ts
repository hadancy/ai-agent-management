import {
  PLC_POWER_POINTS,
  validatePlcPointValue,
  type PlcPoint,
  type PlcPowerValues
} from '../../shared/plc'

export function decodePlcPoint(point: PlcPoint, data: Buffer, offset = 0): number {
  return point.type === 'REAL' ? data.readFloatBE(offset) : data.readUInt16BE(offset) / point.scale
}

export function encodePlcPoint(point: PlcPoint, value: number): Buffer {
  const error = validatePlcPointValue(point, value)
  if (error) throw new Error(error)
  const data = Buffer.alloc(point.type === 'REAL' ? 4 : 2)
  if (point.type !== 'REAL') data.writeUInt16BE(Math.round(value * point.scale))
  else data.writeFloatBE(value)
  return data
}

// Read only defined power blocks; do not span gaps or exceed FC03's register limit.
export async function readPlcPowers(
  read: (register: number, count: number) => Promise<Buffer>
): Promise<PlcPowerValues> {
  const values = {} as PlcPowerValues
  for (const [register, count] of [
    [55, 5],
    [100, 1],
    [105, 1]
  ]) {
    const data = await read(register, count)
    if (data.length !== count * 2) throw new Error(`功率寄存器 HR${register} 返回长度不匹配`)
    for (const point of PLC_POWER_POINTS) {
      if (point.register >= register && point.register < register + count)
        values[point.id] = decodePlcPoint(point, data, (point.register - register) * 2)
    }
  }
  return values
}
