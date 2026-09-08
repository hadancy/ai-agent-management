type FlowPoint = { x: number; y: number }
type FlowSegment = {
  start: FlowPoint
  end: FlowPoint
  offset: number
  length: number
}

export type FlowPath = {
  points: number[]
  segments: FlowSegment[]
  length: number
}

export function createFlowPath(points: number[], reverse = false): FlowPath {
  const vertices = Array.from({ length: Math.floor(points.length / 2) }, (_, index) => ({
    x: points[index * 2],
    y: points[index * 2 + 1]
  }))
  if (reverse) vertices.reverse()

  const segments: FlowSegment[] = []
  let length = 0
  for (let index = 1; index < vertices.length; index += 1) {
    const start = vertices[index - 1]
    const end = vertices[index]
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y)
    if (segmentLength === 0) continue
    segments.push({ start, end, offset: length, length: segmentLength })
    length += segmentLength
  }
  return { points: vertices.flatMap(({ x, y }) => [x, y]), segments, length }
}

export function getFlowPosition(path: FlowPath, distance: number): FlowPoint {
  const clampedDistance = Math.max(0, Math.min(distance, path.length))
  const segment = path.segments.find(({ offset, length }) => clampedDistance <= offset + length)
  if (!segment) return { x: path.points[0] ?? 0, y: path.points[1] ?? 0 }
  const progress = (clampedDistance - segment.offset) / segment.length
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * progress,
    y: segment.start.y + (segment.end.y - segment.start.y) * progress
  }
}

export function getFlowTrail(path: FlowPath, distance: number, length = 22): number[] {
  const endDistance = Math.max(0, Math.min(distance, path.length))
  const startDistance = Math.max(0, endDistance - length)
  const start = getFlowPosition(path, startDistance)
  const end = getFlowPosition(path, endDistance)
  const points = [start.x, start.y]
  for (const segment of path.segments) {
    const cornerDistance = segment.offset + segment.length
    if (cornerDistance > startDistance && cornerDistance < endDistance) {
      points.push(segment.end.x, segment.end.y)
    }
  }
  return [...points, end.x, end.y]
}
