import { useEffect, useRef } from 'react'

type Point3D = { x: number; y: number; z: number }
type ProjectedPoint = Point3D & { depth: number }

const WIDTH = 900
const HEIGHT = 620
const RADIUS = 250
const CENTER_X = WIDTH / 2
const CENTER_Y = 294

// Evenly distributed points keep the mesh spherical as it rotates.
const POINTS: Point3D[] = Array.from({ length: 460 }, (_, index) => {
  const y = 1 - (index / 459) * 2
  const radius = Math.sqrt(1 - y * y)
  const angle = Math.PI * (3 - Math.sqrt(5)) * index
  return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius }
})

const EDGES: [number, number][] = []
POINTS.forEach((point, index) => {
  for (let next = index + 1; next < POINTS.length; next++) {
    const other = POINTS[next]
    const distance = (point.x - other.x) ** 2 + (point.y - other.y) ** 2 + (point.z - other.z) ** 2
    if (distance < 0.037) EDGES.push([index, next])
  }
})

function project(point: Point3D, rotation: number): ProjectedPoint {
  const x = point.x * Math.cos(rotation) + point.z * Math.sin(rotation)
  const z = point.z * Math.cos(rotation) - point.x * Math.sin(rotation)
  const tilt = -0.16
  const y = point.y * Math.cos(tilt) - z * Math.sin(tilt)
  const depth = point.y * Math.sin(tilt) + z * Math.cos(tilt)
  return { x: CENTER_X + x * RADIUS, y: CENTER_Y + y * RADIUS, z, depth }
}

export default function EnergyGlobe({ animated }: { animated: boolean }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rotationRef = useRef(0.35)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let previousTime = 0
    let elapsed = 0

    const draw = (): void => {
      context.clearRect(0, 0, WIDTH, HEIGHT)

      const halo = context.createRadialGradient(CENTER_X, CENTER_Y, 120, CENTER_X, CENTER_Y, 320)
      halo.addColorStop(0, 'rgba(0, 191, 79, 0.015)')
      halo.addColorStop(0.73, 'rgba(0, 200, 86, 0.045)')
      halo.addColorStop(0.82, 'rgba(22, 236, 108, 0.07)')
      halo.addColorStop(1, 'rgba(0, 83, 35, 0)')
      context.fillStyle = halo
      context.fillRect(0, 0, WIDTH, HEIGHT)

      // Quiet stars provide depth without using a bitmap background.
      for (let index = 0; index < 76; index++) {
        const x = (index * 173.31 + 41) % WIDTH
        const y = (index * 97.17 + 18) % (HEIGHT - 50)
        context.fillStyle = `rgba(83, 243, 144, ${0.12 + (index % 4) * 0.065})`
        context.fillRect(x, y, index % 7 === 0 ? 2 : 1, index % 7 === 0 ? 2 : 1)
      }

      context.strokeStyle = 'rgba(42, 229, 113, 0.22)'
      context.lineWidth = 0.7
      context.beginPath()
      context.arc(CENTER_X, CENTER_Y, RADIUS + 28, 0, Math.PI * 2)
      context.stroke()
      context.setLineDash([2, 10])
      context.beginPath()
      context.arc(CENTER_X, CENTER_Y, RADIUS + 37, 0, Math.PI * 2)
      context.stroke()
      context.setLineDash([])

      for (let tick = 0; tick < 72; tick++) {
        const angle = (tick / 72) * Math.PI * 2
        const inner = RADIUS + 43
        const outer = inner + (tick % 6 === 0 ? 7 : 3)
        context.beginPath()
        context.moveTo(CENTER_X + Math.cos(angle) * inner, CENTER_Y + Math.sin(angle) * inner)
        context.lineTo(CENTER_X + Math.cos(angle) * outer, CENTER_Y + Math.sin(angle) * outer)
        context.stroke()
      }

      const points = POINTS.map((point) => project(point, rotationRef.current))
      // Draw the rear surface first, then the brighter front surface.
      for (const front of [false, true]) {
        for (const [start, end] of EDGES) {
          const a = points[start]
          const b = points[end]
          const depth = (a.depth + b.depth) / 2
          if (depth >= 0 !== front) continue
          const alpha = front ? 0.24 + depth * 0.4 : 0.07
          context.strokeStyle = `rgba(38, 235, 113, ${alpha})`
          context.lineWidth = front ? 0.9 : 0.5
          context.beginPath()
          context.moveTo(a.x, a.y)
          context.lineTo(b.x, b.y)
          context.stroke()
        }
      }

      // Three tilted orbits turn the globe into an interconnected energy network.
      for (let orbit = 0; orbit < 3; orbit++) {
        context.save()
        context.translate(CENTER_X, CENTER_Y)
        context.rotate([-0.32, 0.48, -0.95][orbit])
        context.strokeStyle = [
          'rgba(83, 255, 150, 0.65)',
          'rgba(154, 239, 60, 0.38)',
          'rgba(36, 225, 158, 0.3)'
        ][orbit]
        context.lineWidth = orbit === 0 ? 1 : 0.75
        context.beginPath()
        context.ellipse(0, 0, RADIUS + 66 - orbit * 12, 84 + orbit * 31, 0, 0, Math.PI * 2)
        context.stroke()
        const angle = elapsed * 0.00028 + orbit * 2.1
        const x = Math.cos(angle) * (RADIUS + 66 - orbit * 12)
        const y = Math.sin(angle) * (84 + orbit * 31)
        context.shadowColor = '#3aff8c'
        context.shadowBlur = 14
        context.fillStyle = '#d5ffe2'
        context.beginPath()
        context.arc(x, y, orbit === 0 ? 3 : 2, 0, Math.PI * 2)
        context.fill()
        context.restore()
      }

      points.forEach((point, index) => {
        if (point.depth < -0.2) return
        const bright = index % 17 === 0
        context.fillStyle = `rgba(${bright ? '207, 255, 221' : '62, 251, 128'}, ${0.3 + Math.max(0, point.depth) * 0.6})`
        context.shadowColor = '#24ff79'
        context.shadowBlur = bright ? 9 : 0
        context.beginPath()
        context.arc(point.x, point.y, bright ? 2.3 : 1.15, 0, Math.PI * 2)
        context.fill()
      })
      context.shadowBlur = 0

      // Small packets travel along actual mesh edges.
      for (let packet = 0; packet < 14; packet++) {
        const [start, end] = EDGES[(packet * 83) % EDGES.length]
        const a = points[start]
        const b = points[end]
        if (a.depth < 0 || b.depth < 0) continue
        const progress = (elapsed * 0.00035 + packet * 0.13) % 1
        context.fillStyle = '#e8fff0'
        context.shadowColor = '#60ff6b'
        context.shadowBlur = 10
        context.beginPath()
        context.arc(a.x + (b.x - a.x) * progress, a.y + (b.y - a.y) * progress, 1.7, 0, Math.PI * 2)
        context.fill()
      }
      context.shadowBlur = 0

      const floor = context.createRadialGradient(CENTER_X, 583, 0, CENTER_X, 583, 245)
      floor.addColorStop(0, 'rgba(25, 233, 96, 0.18)')
      floor.addColorStop(1, 'rgba(25, 233, 96, 0)')
      context.save()
      context.translate(0, 496)
      context.scale(1, 0.15)
      context.fillStyle = floor
      context.fillRect(100, 330, 700, 510)
      context.restore()
      context.strokeStyle = 'rgba(36, 237, 112, 0.35)'
      context.beginPath()
      context.ellipse(CENTER_X, 584, 160, 14, 0, 0, Math.PI * 2)
      context.stroke()
    }

    const render = (time: number): void => {
      if (time - previousTime >= 1000 / 30) {
        const delta = previousTime === 0 ? 0 : Math.min(time - previousTime, 80)
        rotationRef.current += delta * 0.000045
        elapsed += delta
        previousTime = time
        draw()
      }
      frame = window.requestAnimationFrame(render)
    }

    const syncAnimation = (): void => {
      window.cancelAnimationFrame(frame)
      previousTime = 0
      draw()
      if (animated && !motionPreference.matches && !document.hidden) {
        frame = window.requestAnimationFrame(render)
      }
    }

    const resize = (): void => {
      const scale = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = WIDTH * scale
      canvas.height = HEIGHT * scale
      context.setTransform(scale, 0, 0, scale, 0, 0)
      draw()
    }

    resize()
    syncAnimation()
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', syncAnimation)
    motionPreference.addEventListener('change', syncAnimation)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', syncAnimation)
      motionPreference.removeEventListener('change', syncAnimation)
    }
  }, [animated])

  return <canvas className="energy-globe" ref={canvasRef} aria-hidden="true" />
}
