import { memo, useEffect, useMemo, useRef, useState } from 'react'
import Konva from 'konva'
import {
  Arrow,
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text
} from 'react-konva'

import bulbUrl from '../../../assets/equipment-bulb-v4.png'
import communicationUrl from '../../../assets/equipment-communication-v4.png'
import converterUrl from '../../../assets/equipment-converter-v4.png'
import fanUrl from '../../../assets/equipment-fan-v4.png'
import motorUrl from '../../../assets/equipment-motor-v4.png'
import solarUrl from '../../../assets/equipment-solar-v4.png'
import storageUrl from '../../../assets/equipment-storage-v4.png'
import towerUrl from '../../../assets/equipment-tower-v4.png'
import { createFlowPath, getFlowPosition, getFlowTrail, type FlowPath } from './flowAnimation'
import '../styles/energy-flow.css'

const SCENE_WIDTH = 1040
const SCENE_HEIGHT = 620
const SOLAR_CENTERS = [344, 456, 568, 680]
const FONT_FAMILY = 'Inter, PingFang SC, Microsoft YaHei, sans-serif'

export type EnergyRouteState = 'normal' | 'disconnected' | 'low'

export type EnergyRouteStates = {
  grid: EnergyRouteState
  converter: EnergyRouteState
  photovoltaic: EnergyRouteState
  dcBus: EnergyRouteState
  storage: EnergyRouteState
  primaryLoad: EnergyRouteState
  secondaryLoad: EnergyRouteState
  tertiaryLoad: EnergyRouteState
}

const FLOW_STATE_STYLE: Record<
  EnergyRouteState,
  { color: string; highlight: string; label: string; shadowOpacity: number }
> = {
  normal: {
    color: '#43d6a0',
    highlight: '#d5fff0',
    label: '正常流向',
    shadowOpacity: 0.36
  },
  disconnected: {
    color: '#697783',
    highlight: '#697783',
    label: '断开/无输出',
    shadowOpacity: 0.16
  },
  low: {
    color: '#f2c94c',
    highlight: '#fff4bd',
    label: '电压/电流异常',
    shadowOpacity: 0.62
  }
}

const STATUS_BADGE_STYLE: Record<
  EnergyRouteState,
  { fill: string; stroke: string; color: string; dot: string; text: string }
> = {
  normal: {
    fill: 'rgba(24, 111, 81, 0.16)',
    stroke: 'rgba(67, 214, 160, 0.3)',
    color: '#79e5bd',
    dot: '#43d6a0',
    text: '运行正常'
  },
  low: {
    fill: 'rgba(132, 100, 23, 0.18)',
    stroke: 'rgba(242, 201, 76, 0.9)',
    color: '#ffe48b',
    dot: '#f2c94c',
    text: '参数异常'
  },
  disconnected: {
    fill: 'rgba(64, 81, 96, 0.22)',
    stroke: 'rgba(105, 119, 131, 0.4)',
    color: '#a7b0b7',
    dot: '#697783',
    text: '无输出'
  }
}

const DEFAULT_ROUTE_STATES: EnergyRouteStates = {
  grid: 'normal',
  converter: 'normal',
  photovoltaic: 'normal',
  dcBus: 'normal',
  storage: 'normal',
  primaryLoad: 'normal',
  secondaryLoad: 'normal',
  tertiaryLoad: 'normal'
}

type SceneSize = {
  width: number
  height: number
}

type CropArea = {
  x: number
  y: number
  width: number
  height: number
}

type FlowWireProps = {
  points: number[]
  state: EnergyRouteState
  arrow?: boolean
  reverse?: boolean
  width?: number
  speed?: 'normal' | 'slow'
}

type CanvasImageProps = {
  image?: HTMLImageElement
  x: number
  y: number
  width: number
  height: number
  crop?: CropArea
  opacity?: number
  state?: EnergyRouteState
}

function useCanvasImage(source: string): HTMLImageElement | undefined {
  const [image, setImage] = useState<HTMLImageElement>()

  useEffect(() => {
    let active = true
    const nextImage = new window.Image()
    nextImage.decoding = 'async'
    nextImage.onload = () => active && setImage(nextImage)
    nextImage.src = source
    return () => {
      active = false
    }
  }, [source])

  return image
}

function getDeviceStateNodeName(state: EnergyRouteState): string {
  return state === 'low' ? 'energy-device-state energy-device-alert' : 'energy-device-state'
}

function CanvasImage({
  image,
  x,
  y,
  width,
  height,
  crop,
  opacity = 1,
  state
}: CanvasImageProps): React.JSX.Element | null {
  if (!image) return null

  return (
    <KonvaImage
      name={state === undefined ? undefined : getDeviceStateNodeName(state)}
      image={image}
      x={x}
      y={y}
      width={width}
      height={height}
      crop={crop}
      opacity={opacity}
      listening={false}
    />
  )
}

const FlowWire = memo(
  function FlowWire({
    points,
    state,
    arrow = true,
    reverse = false,
    width = 2.5,
    speed = 'normal'
  }: FlowWireProps): React.JSX.Element {
    const style = FLOW_STATE_STYLE[state]
    const path = useMemo(() => createFlowPath(points, reverse), [points, reverse])
    const isFlowing = state !== 'disconnected' && path.length > 0
    const flowSpeed = state === 'low' ? 14 : speed === 'slow' ? 21 : 30
    const particleCount = Math.max(1, Math.ceil(path.length / 140))

    return (
      <Group listening={false}>
        <Line
          points={path.points}
          stroke={style.color}
          strokeWidth={width}
          lineCap="round"
          lineJoin="round"
          shadowColor={style.color}
          shadowBlur={4}
          shadowOpacity={style.shadowOpacity}
          perfectDrawEnabled={false}
        />
        {isFlowing && (
          <Line
            name="energy-flow-dash"
            flowSpeed={flowSpeed}
            points={path.points}
            stroke={style.highlight}
            strokeWidth={Math.max(1.4, width - 1.2)}
            lineCap="round"
            lineJoin="round"
            dash={[8, 22]}
            opacity={0.65}
            shadowColor={style.color}
            shadowBlur={3}
            shadowOpacity={0.45}
            perfectDrawEnabled={false}
          />
        )}
        {isFlowing &&
          Array.from({ length: particleCount }, (_, index) => {
            const offset = ((index + 0.5) / particleCount) * path.length
            const position = getFlowPosition(path, offset)
            return (
              <Group
                key={index}
                name="energy-flow-particle"
                flowPath={path}
                flowOffset={offset}
                flowSpeed={flowSpeed}
                listening={false}
              >
                <Line
                  name="energy-flow-trail"
                  points={getFlowTrail(path, offset)}
                  stroke={style.highlight}
                  strokeWidth={width + 0.5}
                  lineCap="round"
                  lineJoin="round"
                  opacity={0.7}
                  shadowColor={style.color}
                  shadowBlur={9}
                  shadowOpacity={0.85}
                  perfectDrawEnabled={false}
                />
                <Group name="energy-flow-head" x={position.x} y={position.y}>
                  <Circle radius={width + 4} fill={style.color} opacity={0.18} />
                  <Circle
                    radius={width / 2 + 1.5}
                    fill={style.highlight}
                    shadowColor={style.color}
                    shadowBlur={10}
                    shadowOpacity={1}
                    perfectDrawEnabled={false}
                  />
                </Group>
              </Group>
            )
          })}
        {arrow && (
          <Arrow
            points={path.points.slice(-4)}
            // Draw only the arrowhead so its shaft cannot cover the moving light.
            strokeEnabled={false}
            fill={style.color}
            strokeWidth={width}
            pointerLength={7}
            pointerWidth={7}
            lineCap="round"
            lineJoin="round"
            shadowColor={style.color}
            shadowBlur={3}
            shadowOpacity={style.shadowOpacity}
            perfectDrawEnabled={false}
          />
        )}
      </Group>
    )
  },
  (previous, next) =>
    previous.state === next.state &&
    previous.arrow === next.arrow &&
    previous.reverse === next.reverse &&
    previous.width === next.width &&
    previous.speed === next.speed &&
    previous.points.length === next.points.length &&
    previous.points.every((value, index) => value === next.points[index])
)

function StatusBadge({
  x,
  y,
  width = 86,
  state
}: {
  x: number
  y: number
  width?: number
  state: EnergyRouteState
}): React.JSX.Element {
  const style = STATUS_BADGE_STYLE[state]
  return (
    <Group name={getDeviceStateNodeName(state)} x={x} y={y} listening={false}>
      <Rect width={width} height={22} cornerRadius={11} fill={style.fill} stroke={style.stroke} />
      <Circle x={12} y={11} radius={3} fill={style.dot} />
      <Text
        x={21}
        y={6}
        width={width - 26}
        text={style.text}
        fill={style.color}
        fontFamily={FONT_FAMILY}
        fontSize={10}
        align="center"
      />
    </Group>
  )
}

function DeviceAlertFrame({
  state,
  x = 0,
  y = 0,
  width,
  height,
  cornerRadius = 10
}: {
  state: EnergyRouteState
  x?: number
  y?: number
  width: number
  height: number
  cornerRadius?: number
}): React.JSX.Element | null {
  if (state !== 'low') return null

  return (
    <Rect
      name="energy-device-state energy-device-alert-glow"
      x={x}
      y={y}
      width={width}
      height={height}
      cornerRadius={cornerRadius}
      stroke={FLOW_STATE_STYLE.low.color}
      strokeWidth={2}
      fill="rgba(242, 201, 76, 0.1)"
      shadowColor={FLOW_STATE_STYLE.low.color}
      shadowBlur={14}
      shadowOpacity={0.65}
      listening={false}
    />
  )
}

function SourceZone({
  x,
  width,
  title,
  caption,
  accent
}: {
  x: number
  width: number
  title: string
  caption: string
  accent: string
}): React.JSX.Element {
  return (
    <Group x={x} y={14} listening={false}>
      <Rect
        width={width}
        height={334}
        cornerRadius={12}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 0, y: 334 }}
        fillLinearGradientColorStops={[0, 'rgba(20, 51, 72, 0.52)', 1, 'rgba(7, 25, 42, 0.24)']}
        stroke="rgba(68, 115, 146, 0.3)"
      />
      <Rect x={17} y={21} width={3} height={15} cornerRadius={2} fill={accent} />
      <Text
        x={29}
        y={20}
        text={title}
        fill="#e1edf5"
        fontFamily={FONT_FAMILY}
        fontSize={15}
        fontStyle="bold"
      />
      <Text
        x={width - 116}
        y={23}
        width={98}
        text={caption}
        align="right"
        fill="#7492a8"
        fontFamily={FONT_FAMILY}
        fontSize={10}
      />
      <Line points={[17, 51, width - 17, 51]} stroke="rgba(76, 123, 153, 0.18)" />
    </Group>
  )
}

function DeviceNode({
  image,
  centerX,
  top,
  imageWidth,
  imageHeight,
  title,
  state,
  crop
}: {
  image?: HTMLImageElement
  centerX: number
  top: number
  imageWidth: number
  imageHeight: number
  title: string
  state: EnergyRouteState
  crop?: CropArea
}): React.JSX.Element {
  return (
    <Group x={centerX} y={top} listening={false}>
      <DeviceAlertFrame
        state={state}
        x={-Math.max(imageWidth + 16, 136) / 2}
        y={-5}
        width={Math.max(imageWidth + 16, 136)}
        height={imageHeight + 40}
      />
      <CanvasImage
        image={image}
        x={-imageWidth / 2}
        y={0}
        width={imageWidth}
        height={imageHeight}
        crop={crop}
        state={state}
      />
      <Text
        x={-68}
        y={imageHeight + 6}
        width={136}
        text={title}
        align="center"
        fill="#c6d9e6"
        fontFamily={FONT_FAMILY}
        fontSize={12}
      />
      <Circle x={0} y={imageHeight + 30} radius={3} fill={FLOW_STATE_STYLE[state].color} />
    </Group>
  )
}

function SolarNode({
  image,
  centerX,
  index,
  state
}: {
  image?: HTMLImageElement
  centerX: number
  index: number
  state: EnergyRouteState
}): React.JSX.Element {
  return (
    <Group x={centerX - 46} y={79} listening={false}>
      <Rect
        width={92}
        height={105}
        cornerRadius={8}
        fill="rgba(5, 21, 36, 0.55)"
        stroke="rgba(74, 122, 153, 0.3)"
      />
      <DeviceAlertFrame state={state} width={92} height={105} cornerRadius={8} />
      <Text
        y={10}
        width={92}
        text={`光伏组串 ${index}`}
        align="center"
        fill="#c6d9e6"
        fontFamily={FONT_FAMILY}
        fontSize={11}
      />
      <CanvasImage
        image={image}
        x={15}
        y={29}
        width={62}
        height={57}
        crop={{ x: 18, y: 126, width: 348, height: 322 }}
        state={state}
      />
      <Group name={getDeviceStateNodeName(state)}>
        <Circle x={23} y={94} radius={2.5} fill={FLOW_STATE_STYLE[state].color} />
        <Text
          x={31}
          y={89}
          width={57}
          text={STATUS_BADGE_STYLE[state].text}
          fill={STATUS_BADGE_STYLE[state].color}
          fontFamily={FONT_FAMILY}
          fontSize={9}
        />
      </Group>
    </Group>
  )
}

function ControlNode({
  centerX,
  top = 238,
  width,
  title,
  subtitle,
  state,
  image
}: {
  centerX: number
  top?: number
  width: number
  title: string
  subtitle: string
  state: EnergyRouteState
  image?: HTMLImageElement
}): React.JSX.Element {
  return (
    <Group x={centerX - width / 2} y={top} listening={false}>
      <Rect
        width={width}
        height={82}
        cornerRadius={10}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: width, y: 82 }}
        fillLinearGradientColorStops={[0, '#14344a', 1, '#0a2135']}
        stroke="#34566e"
        shadowColor="#000"
        shadowBlur={8}
        shadowOpacity={0.18}
      />
      <DeviceAlertFrame state={state} width={width} height={82} />
      {image ? (
        <CanvasImage image={image} x={13} y={13} width={38} height={53} state={state} />
      ) : (
        <Group name={getDeviceStateNodeName(state)} x={15} y={22}>
          <Rect
            width={38}
            height={36}
            cornerRadius={6}
            fill="rgba(81, 182, 217, 0.08)"
            stroke="#659eb5"
          />
          <Line points={[7, 28, 31, 8]} stroke="#a0d3e2" strokeWidth={1.5} />
          <Line points={[8, 11, 17, 11]} stroke="#a0d3e2" strokeWidth={1.5} />
          <Line points={[22, 26, 31, 26]} stroke="#a0d3e2" strokeWidth={1.5} />
        </Group>
      )}
      <Text
        x={64}
        y={12}
        width={width - 72}
        text={title}
        fill="#e0ecf5"
        fontFamily={FONT_FAMILY}
        fontSize={12}
        fontStyle="bold"
      />
      <Text
        x={64}
        y={31}
        width={width - 72}
        text={subtitle}
        fill="#789aaf"
        fontFamily={FONT_FAMILY}
        fontSize={10}
      />
      <StatusBadge x={64} y={50} state={state} />
    </Group>
  )
}

function StorageNode({
  image,
  state
}: {
  image?: HTMLImageElement
  state: EnergyRouteState
}): React.JSX.Element {
  return (
    <Group x={784} y={80} listening={false}>
      <Rect
        width={208}
        height={124}
        cornerRadius={10}
        fill="rgba(5, 21, 36, 0.45)"
        stroke="rgba(74, 122, 153, 0.3)"
      />
      <DeviceAlertFrame state={state} width={208} height={124} />
      <CanvasImage image={image} x={4} y={2} width={90} height={120} state={state} />
      <Text
        x={106}
        y={36}
        width={94}
        text="储能系统"
        fill="#e0ecf5"
        fontFamily={FONT_FAMILY}
        fontSize={13}
        fontStyle="bold"
      />
      <StatusBadge x={106} y={62} state={state} />
    </Group>
  )
}

function LoadNode({
  image,
  centerX,
  title,
  subtitle,
  state
}: {
  image?: HTMLImageElement
  centerX: number
  title: string
  subtitle: string
  state: EnergyRouteState
}): React.JSX.Element {
  return (
    <Group x={centerX - 122} y={476} listening={false}>
      <Rect
        width={244}
        height={122}
        cornerRadius={12}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 244, y: 122 }}
        fillLinearGradientColorStops={[0, '#102f45', 1, '#091e31']}
        stroke="rgba(78, 130, 163, 0.5)"
      />
      <DeviceAlertFrame state={state} width={244} height={122} cornerRadius={12} />
      <Rect x={12} y={16} width={84} height={90} cornerRadius={10} fill="rgba(5, 20, 33, 0.48)" />
      <CanvasImage
        image={image}
        x={15}
        y={22}
        width={78}
        height={72}
        crop={{ x: 14, y: 52, width: 356, height: 327 }}
        state={state}
      />
      <Text x={112} y={22} text={title} fill="#829fb3" fontFamily={FONT_FAMILY} fontSize={11} />
      <Text
        x={112}
        y={43}
        text={subtitle}
        fill="#e0edf4"
        fontFamily={FONT_FAMILY}
        fontSize={16}
        fontStyle="bold"
      />
      <StatusBadge x={112} y={77} state={state} />
    </Group>
  )
}

function BusLabel({ state }: { state: EnergyRouteState }): React.JSX.Element {
  return (
    <Group x={408} y={379} listening={false}>
      <Rect
        width={208}
        height={42}
        cornerRadius={21}
        fill="#0d2b3b"
        stroke={FLOW_STATE_STYLE[state].color}
        strokeWidth={1}
      />
      <DeviceAlertFrame state={state} width={208} height={42} cornerRadius={21} />
      <Circle x={22} y={21} radius={4} fill={FLOW_STATE_STYLE[state].color} />
      <Text
        x={35}
        y={14}
        text="直流母线"
        fill="#e6f6f5"
        fontFamily={FONT_FAMILY}
        fontSize={14}
        fontStyle="bold"
      />
      <Text x={160} y={15} text="DC" fill="#74b6bc" fontFamily={FONT_FAMILY} fontSize={12} />
    </Group>
  )
}

export default function EnergyFlowCanvas({
  routeStates,
  photovoltaicStates
}: {
  routeStates?: Partial<EnergyRouteStates>
  photovoltaicStates?: EnergyRouteState[]
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const wireLayerRef = useRef<Konva.Layer>(null)
  const deviceLayerRef = useRef<Konva.Layer>(null)
  const [motionEnabled, setMotionEnabled] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  const [sceneSize, setSceneSize] = useState<SceneSize>({
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT
  })

  const towerImage = useCanvasImage(towerUrl)
  const communicationImage = useCanvasImage(communicationUrl)
  const converterImage = useCanvasImage(converterUrl)
  const solarImage = useCanvasImage(solarUrl)
  const storageImage = useCanvasImage(storageUrl)
  const bulbImage = useCanvasImage(bulbUrl)
  const fanImage = useCanvasImage(fanUrl)
  const motorImage = useCanvasImage(motorUrl)
  const states: EnergyRouteStates = { ...DEFAULT_ROUTE_STATES, ...routeStates }
  const solarStates = Array.from(
    { length: 4 },
    (_, index) => photovoltaicStates?.[index] ?? states.photovoltaic
  )
  const stateValues = Object.values(states)
  const accessibilitySummary = `实时能源流向：${stateValues.filter((state) => state === 'normal').length}路正常，${stateValues.filter((state) => state === 'disconnected').length}路断开或无输出，${stateValues.filter((state) => state === 'low').length}路电压或电流异常`

  useEffect(() => {
    if (!containerRef.current) return
    const syncSize = (): void => {
      if (!containerRef.current) return
      // Layout dimensions are not affected by the console shell's CSS transform.
      // Using getBoundingClientRect here would apply viewportScale a second time
      // whenever this component is remounted after navigating between pages.
      const { clientWidth: width, clientHeight: height } = containerRef.current
      if (width > 0 && height > 0) setSceneSize({ width, height })
    }
    const observer = new ResizeObserver(syncSize)
    observer.observe(containerRef.current)
    syncSize()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const layer = deviceLayerRef.current
    if (!layer || !motionEnabled) return

    const animation = new Konva.Animation((frame) => {
      if (!frame) return
      const pulse = (Math.cos((frame.time / 1800) * Math.PI * 2) + 1) / 2
      layer.find('.energy-device-state').forEach((node) => {
        node.opacity(
          node.hasName('energy-device-alert-glow')
            ? 0.18 + pulse * 0.82
            : node.hasName('energy-device-alert')
              ? 0.55 + pulse * 0.45
              : 1
        )
      })
    }, layer)
    animation.start()
    return () => {
      animation.stop()
      layer.find('.energy-device-state').forEach((node) => node.opacity(1))
      layer.batchDraw()
    }
  }, [motionEnabled])

  useEffect(() => {
    const layer = wireLayerRef.current
    if (!layer || !motionEnabled) return

    const animation = new Konva.Animation((frame) => {
      if (!frame) return
      layer.find('.energy-flow-dash').forEach((node) => {
        const speed = node.getAttr('flowSpeed') as number
        node.setAttr('dashOffset', -((frame.time / 1000) * speed))
      })
      layer.find<Konva.Group>('.energy-flow-particle').forEach((particle) => {
        const path = particle.getAttr('flowPath') as FlowPath
        const speed = particle.getAttr('flowSpeed') as number
        const offset = particle.getAttr('flowOffset') as number
        const distance = (offset + (frame.time / 1000) * speed) % path.length
        particle
          .findOne<Konva.Group>('.energy-flow-head')
          ?.position(getFlowPosition(path, distance))
        particle.findOne<Konva.Line>('.energy-flow-trail')?.points(getFlowTrail(path, distance))
      })
    }, layer)
    animation.start()
    return () => {
      animation.stop()
    }
  }, [motionEnabled])

  const sceneTransform = useMemo(() => {
    const scale = Math.min(sceneSize.width / SCENE_WIDTH, sceneSize.height / SCENE_HEIGHT)
    return {
      scale,
      x: (sceneSize.width - SCENE_WIDTH * scale) / 2,
      y: (sceneSize.height - SCENE_HEIGHT * scale) / 2
    }
  }, [sceneSize])

  return (
    <section className="panel energy-panel energy-panel--konva" aria-labelledby="energy-flow-title">
      <header className="energy-heading">
        <div className="energy-heading__title">
          <span className="energy-heading__mark" aria-hidden="true">
            ϟ
          </span>
          <div>
            <h2 id="energy-flow-title">实时能源流向</h2>
            <p>光 · 储 · 直 · 柔协同拓扑</p>
          </div>
        </div>
        <div className="energy-legend" aria-label="能源流向状态图例">
          {(['normal', 'disconnected', 'low'] as const).map((state) => (
            <span key={state}>
              <i style={{ backgroundColor: FLOW_STATE_STYLE[state].color }} />
              {FLOW_STATE_STYLE[state].label}
            </span>
          ))}
        </div>
      </header>
      <div
        ref={containerRef}
        className="konva-energy-canvas"
        role="img"
        aria-label={accessibilitySummary}
      >
        <Stage width={sceneSize.width} height={sceneSize.height} listening={false}>
          <Layer
            x={sceneTransform.x}
            y={sceneTransform.y}
            scaleX={sceneTransform.scale}
            scaleY={sceneTransform.scale}
            listening={false}
          >
            <SourceZone x={16} width={248} title="电网接入" caption="AC / DC" accent="#5eb9ef" />
            <SourceZone x={280} width={456} title="光伏发电" caption="4 路组串" accent="#43d6a0" />
            <SourceZone x={752} width={272} title="储能调节" caption="双向变换" accent="#a3a1ed" />
            <Rect
              x={70}
              y={366}
              width={904}
              height={68}
              cornerRadius={12}
              fill="rgba(29, 106, 99, 0.07)"
              stroke="rgba(64, 152, 139, 0.14)"
            />
            <Text
              x={22}
              y={452}
              text="负载分配"
              fill="#7e9eb3"
              fontFamily={FONT_FAMILY}
              fontSize={11}
            />
          </Layer>
          <Layer
            ref={wireLayerRef}
            x={sceneTransform.x}
            y={sceneTransform.y}
            scaleX={sceneTransform.scale}
            scaleY={sceneTransform.scale}
            listening={false}
          >
            <FlowWire points={[111, 128, 169, 128]} state={states.grid} />
            <FlowWire points={[199, 187, 199, 211, 140, 211, 140, 238]} state={states.grid} />
            <FlowWire points={[140, 320, 140, 400]} state={states.converter} />
            {SOLAR_CENTERS.map((centerX, index) => (
              <FlowWire
                key={centerX}
                points={[centerX, 184, centerX, 209]}
                state={solarStates[index]}
              />
            ))}
            <FlowWire points={[344, 209, 508, 209]} state={states.photovoltaic} arrow={false} />
            <FlowWire points={[680, 209, 508, 209]} state={states.photovoltaic} arrow={false} />
            <FlowWire points={[508, 209, 508, 238]} state={states.photovoltaic} />
            <FlowWire points={[508, 320, 508, 370]} state={states.photovoltaic} />
            <FlowWire points={[508, 370, 508, 400]} state={states.photovoltaic} arrow={false} />
            <FlowWire points={[876, 204, 876, 258]} state={states.storage} />
            <FlowWire points={[900, 258, 900, 204]} state={states.storage} />
            <FlowWire points={[880, 340, 880, 390]} state={states.storage} />
            <FlowWire points={[880, 390, 880, 400]} state={states.storage} arrow={false} />
            <FlowWire points={[896, 400, 896, 340]} state={states.storage} />
            <FlowWire
              points={[110, 400, 934, 400]}
              state={states.dcBus}
              arrow={false}
              width={4}
              speed="slow"
            />
            <FlowWire points={[212, 400, 212, 476]} state={states.primaryLoad} />
            <FlowWire points={[520, 400, 520, 476]} state={states.secondaryLoad} />
            <FlowWire points={[828, 400, 828, 476]} state={states.tertiaryLoad} />
            {[140, 212, 508, 520, 828, 880, 896].map((x) => (
              <Circle
                key={x}
                x={x}
                y={400}
                radius={3.5}
                fill="#092335"
                stroke={FLOW_STATE_STYLE[states.dcBus].color}
                strokeWidth={1.5}
              />
            ))}
          </Layer>
          <Layer
            ref={deviceLayerRef}
            x={sceneTransform.x}
            y={sceneTransform.y}
            scaleX={sceneTransform.scale}
            scaleY={sceneTransform.scale}
            listening={false}
          >
            <DeviceNode
              image={towerImage}
              centerX={80}
              top={79}
              imageWidth={64}
              imageHeight={96}
              title="电网"
              state={states.grid}
            />
            <DeviceNode
              image={communicationImage}
              centerX={199}
              top={94}
              imageWidth={52}
              imageHeight={62}
              title="电网通信接口"
              state={states.grid}
            />
            <ControlNode
              centerX={140}
              width={204}
              title="双向变流器"
              subtitle="AC / DC"
              image={converterImage}
              state={states.converter}
            />
            {SOLAR_CENTERS.map((centerX, index) => (
              <SolarNode
                key={centerX}
                image={solarImage}
                centerX={centerX}
                index={index + 1}
                state={solarStates[index]}
              />
            ))}
            <ControlNode
              centerX={508}
              width={208}
              title="光伏汇流"
              subtitle="DC / DC"
              state={states.photovoltaic}
            />
            <StorageNode image={storageImage} state={states.storage} />
            <Text
              x={826}
              y={225}
              width={38}
              text="放电"
              align="right"
              fill="#8aaabb"
              fontFamily={FONT_FAMILY}
              fontSize={11}
            />
            <Text
              x={912}
              y={225}
              width={38}
              text="充电"
              fill="#8aaabb"
              fontFamily={FONT_FAMILY}
              fontSize={11}
            />
            <ControlNode
              centerX={888}
              top={258}
              width={208}
              title="双向 DC/DC"
              subtitle="储能充放电"
              state={states.storage}
            />
            <BusLabel state={states.dcBus} />
            <LoadNode
              image={bulbImage}
              centerX={212}
              title="一级负载"
              subtitle="直流灯"
              state={states.primaryLoad}
            />
            <LoadNode
              image={fanImage}
              centerX={520}
              title="二级负载"
              subtitle="直流风扇"
              state={states.secondaryLoad}
            />
            <LoadNode
              image={motorImage}
              centerX={828}
              title="三级负载"
              subtitle="直流电机"
              state={states.tertiaryLoad}
            />
          </Layer>
        </Stage>
      </div>
      <footer className="energy-footer">
        <span>
          <i aria-hidden="true" /> 箭头表示能量传输方向
        </span>
        <div className="energy-footer__actions">
          <span>
            4 路光伏接入 <b /> 3 级直流负载
          </span>
          <button
            type="button"
            className="energy-motion-control"
            onClick={() => setMotionEnabled((enabled) => !enabled)}
            aria-pressed={!motionEnabled}
            aria-label={motionEnabled ? '暂停能源流向动画' : '播放能源流向动画'}
          >
            <span aria-hidden="true">{motionEnabled ? 'Ⅱ' : '▷'}</span>
            {motionEnabled ? '暂停动效' : '播放动效'}
          </button>
        </div>
      </footer>
    </section>
  )
}
