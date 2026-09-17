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

import { useFontScale } from '../../../settings/fontSize'
import { usePlatformSpeech } from '../../../speech/usePlatformSpeech'

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
import type { TelemetrySnapshot } from '../../../../../shared/contracts'
import { formatPower, getEnergyPowerReadings } from './powerReadings'
import {
  ARCHITECTURE_UPGRADE_MS,
  ENERGY_ARCHITECTURES,
  STORAGE_RATED_POWER_KW,
  TRADITIONAL_POWERS,
  type EnergyArchitecture
} from './architecture'
import { EfficiencyHighlight } from './ArchitectureScene'

const SCENE_WIDTH = 1040
const SCENE_HEIGHT = 620
const SOLAR_CENTERS = [344, 456, 568, 680]
const FONT_FAMILY = 'Inter, PingFang SC, Microsoft YaHei, sans-serif'

// Canvas text cannot inherit rem sizes from the document.
function EnergyText({
  fontSize = 12,
  fitWidth = false,
  ...props
}: Konva.TextConfig & { fitWidth?: boolean }): React.JSX.Element {
  const fontScale = useFontScale()
  const { text, width, fontFamily, fontStyle } = props
  const scaledFontSize = fontSize * fontScale
  const fittedFontSize = useMemo(() => {
    if (!fitWidth || !width || !text) return scaledFontSize
    const measure = new Konva.Text({ text, fontFamily, fontStyle, fontSize: scaledFontSize })
    const naturalWidth = measure.measureSize(text).width
    measure.destroy()
    return naturalWidth > width ? (scaledFontSize * width) / naturalWidth : scaledFontSize
  }, [fitWidth, width, text, fontFamily, fontStyle, scaledFontSize])
  return <Text {...props} fontSize={fittedFontSize} />
}

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
      <EnergyText
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
      <EnergyText
        x={29}
        y={20}
        text={title}
        fill="#e1edf5"
        fontFamily={FONT_FAMILY}
        fontSize={15}
        fontStyle="bold"
      />
      <EnergyText
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
      <EnergyText
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
    <Group name="energy-solar-node" x={centerX - 46} y={79} listening={false}>
      <Rect
        width={92}
        height={124}
        cornerRadius={8}
        fill="rgba(5, 21, 36, 0.55)"
        stroke="rgba(74, 122, 153, 0.3)"
      />
      <DeviceAlertFrame state={state} width={92} height={124} cornerRadius={8} />
      <EnergyText
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
        x={22}
        y={40}
        width={48}
        height={44}
        crop={{ x: 18, y: 126, width: 348, height: 322 }}
        state={state}
      />
      <Group name={getDeviceStateNodeName(state)}>
        <Circle x={15} y={110} radius={2.5} fill={FLOW_STATE_STYLE[state].color} />
        <EnergyText
          x={23}
          y={105}
          width={65}
          text={STATUS_BADGE_STYLE[state].text}
          fill={STATUS_BADGE_STYLE[state].color}
          fontFamily={FONT_FAMILY}
          fontSize={9}
        />
      </Group>
    </Group>
  )
}

function TransformerIcon({ state }: { state: EnergyRouteState }): React.JSX.Element {
  return (
    <Group name={`${getDeviceStateNodeName(state)} energy-transformer-icon`} x={10} y={10}>
      <Rect x={4} y={56} width={45} height={5} cornerRadius={1} fill="#142531" />
      <Line points={[7, 24, 16, 18, 48, 18, 39, 24]} closed fill="#7b9cae" stroke="#9bb5c4" />
      <Rect
        x={7}
        y={24}
        width={32}
        height={31}
        cornerRadius={2}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 32, y: 31 }}
        fillLinearGradientColorStops={[0, '#658396', 1, '#263d50']}
        stroke="#8aafc3"
        strokeWidth={1}
      />
      <Line points={[39, 24, 48, 18, 48, 49, 39, 55]} closed fill="#253e51" stroke="#668ca3" />
      {[12, 18, 24, 30].map((x) => (
        <Rect
          key={x}
          x={x}
          y={29}
          width={3}
          height={21}
          cornerRadius={1}
          fill="#1d3445"
          stroke="#7899ad"
          strokeWidth={0.6}
        />
      ))}
      {[15, 26, 37].map((x) => (
        <Group key={x} x={x} y={3}>
          <Rect x={-2} width={4} height={16} fill="#779fb1" />
          {[3, 7, 11].map((y) => (
            <Rect key={y} x={-4} y={y} width={8} height={2} cornerRadius={1} fill="#b4cfd8" />
          ))}
          <Circle y={1} radius={2} fill="#dbb778" />
        </Group>
      ))}
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
  image,
  transformer = false,
  power,
  emphasizePower = false
}: {
  centerX: number
  top?: number
  width: number
  title: string
  subtitle: string
  state: EnergyRouteState
  image?: HTMLImageElement
  transformer?: boolean
  power?: number
  emphasizePower?: boolean
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
      {transformer ? (
        <TransformerIcon state={state} />
      ) : image ? (
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
      <EnergyText
        x={64}
        y={emphasizePower ? 8 : 12}
        width={width - 72}
        text={title}
        fill="#e0ecf5"
        fontFamily={FONT_FAMILY}
        fontSize={12}
        fontStyle="bold"
      />
      <EnergyText
        x={64}
        y={emphasizePower ? 26 : 31}
        width={width - 72}
        text={subtitle}
        fill="#789aaf"
        fontFamily={FONT_FAMILY}
        fontSize={emphasizePower ? 9 : 10}
      />
      {emphasizePower && (
        <EnergyText
          name="energy-power energy-photovoltaic-power"
          fitWidth
          x={64}
          y={38}
          width={width - 72}
          text={formatPower(power)}
          fill="#7ee9d2"
          fontFamily={FONT_FAMILY}
          fontSize={14}
          fontStyle="bold"
        />
      )}
      <StatusBadge x={64} y={emphasizePower ? 59 : 50} state={state} />
    </Group>
  )
}

function StorageNode({
  image,
  state,
  power,
  traditional
}: {
  image?: HTMLImageElement
  state: EnergyRouteState
  power?: number
  traditional: boolean
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
      <EnergyText
        x={100}
        y={12}
        width={108}
        text="储能系统"
        fill="#e0ecf5"
        fontFamily={FONT_FAMILY}
        fontSize={13}
        fontStyle="bold"
      />
      <EnergyText
        x={100}
        y={36}
        text={traditional ? '功率（示例）' : '实时功率（计算）'}
        fill="#829fb3"
        fontFamily={FONT_FAMILY}
        fontSize={9}
      />
      <EnergyText
        name="energy-power"
        fitWidth
        x={100}
        y={53}
        width={106}
        text={formatPower(power)}
        fill="#7ee9d2"
        fontFamily={FONT_FAMILY}
        fontSize={14}
        fontStyle="bold"
      />
      <EnergyText
        name="energy-rated-power"
        x={100}
        y={78}
        text={`满载 ${formatPower(STORAGE_RATED_POWER_KW)}`}
        fill="#a9c7da"
        fontFamily={FONT_FAMILY}
        fontSize={10}
      />
      <StatusBadge x={100} y={98} width={100} state={state} />
    </Group>
  )
}

function LoadNode({
  image,
  centerX,
  title,
  subtitle,
  state,
  power
}: {
  image?: HTMLImageElement
  centerX: number
  title: string
  subtitle: string
  state: EnergyRouteState
  power?: number
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
      <EnergyText
        x={112}
        y={14}
        text={title}
        fill="#829fb3"
        fontFamily={FONT_FAMILY}
        fontSize={11}
      />
      <EnergyText
        x={112}
        y={34}
        text={subtitle}
        fill="#e0edf4"
        fontFamily={FONT_FAMILY}
        fontSize={14}
        fontStyle="bold"
      />
      <EnergyText
        name="energy-power"
        fitWidth
        x={112}
        y={60}
        width={126}
        text={formatPower(power)}
        fill="#7ee9d2"
        fontFamily={FONT_FAMILY}
        fontSize={17}
        fontStyle="bold"
      />
      <StatusBadge x={112} y={91} width={114} state={state} />
    </Group>
  )
}

function BusLabel({
  state,
  traditional
}: {
  state: EnergyRouteState
  traditional: boolean
}): React.JSX.Element {
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
      <EnergyText
        x={35}
        y={14}
        text={traditional ? '交流母线' : '直流母线'}
        fill="#e6f6f5"
        fontFamily={FONT_FAMILY}
        fontSize={14}
        fontStyle="bold"
      />
      <EnergyText
        x={160}
        y={15}
        text={traditional ? 'AC' : 'DC'}
        fill="#74b6bc"
        fontFamily={FONT_FAMILY}
        fontSize={12}
      />
    </Group>
  )
}

export default function EnergyFlowCanvas({
  routeStates,
  photovoltaicStates,
  telemetry,
  online = true
}: {
  routeStates?: Partial<EnergyRouteStates>
  photovoltaicStates?: EnergyRouteState[]
  telemetry?: TelemetrySnapshot
  online?: boolean
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const wireLayerRef = useRef<Konva.Layer>(null)
  const deviceLayerRef = useRef<Konva.Layer>(null)
  const [architecture, setArchitecture] = useState<EnergyArchitecture>('traditional')
  const [upgrading, setUpgrading] = useState(false)
  const [efficiencyVisible, setEfficiencyVisible] = useState(false)
  const upgradeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const efficiencyButtonRef = useRef<HTMLButtonElement>(null)
  const architectureButtonRef = useRef<HTMLButtonElement>(null)
  const previousArchitecture = useRef(architecture)
  const speech = usePlatformSpeech()
  const traditional = architecture === 'traditional'
  const nextArchitecture: EnergyArchitecture = traditional ? 'direct' : 'traditional'
  const nextModeLabel = traditional ? '光储直柔模式' : '传统交流模式'
  const presentation = ENERGY_ARCHITECTURES[architecture]
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
  const readings = traditional
    ? {
        powers: TRADITIONAL_POWERS,
        storage: TRADITIONAL_POWERS.storageRatedPower,
        photovoltaic: []
      }
    : getEnergyPowerReadings(telemetry, online)
  const { powers } = readings
  const loadState = (power: number | undefined): EnergyRouteState =>
    power === undefined || !Number.isFinite(power) || power <= 0 ? 'disconnected' : 'normal'
  states.primaryLoad = loadState(powers.primaryLoadPower)
  states.secondaryLoad = loadState(powers.secondaryLoadPower)
  states.tertiaryLoad = loadState(powers.tertiaryLoadPower)
  if (!online || telemetry?.plcConnected === false) {
    for (const key of Object.keys(states) as Array<keyof EnergyRouteStates>)
      states[key] = 'disconnected'
  }
  const solarStates = Array.from({ length: 4 }, (_, index) =>
    !online || telemetry?.plcConnected === false
      ? 'disconnected'
      : (photovoltaicStates?.[index] ?? states.photovoltaic)
  )
  const directionalState = (
    power: number | undefined,
    forward: boolean,
    state: EnergyRouteState
  ): EnergyRouteState =>
    power !== undefined && Number.isFinite(power) && (forward ? power > 0 : power < 0)
      ? state
      : 'disconnected'
  // The PLC convention is positive for charging and negative for discharging.
  const storageDischargeState = directionalState(readings.storage, false, states.storage)
  const storageChargeState = traditional
    ? states.storage
    : directionalState(readings.storage, true, states.storage)
  // No grid direction register is supplied. Infer the net exchange from live power balance.
  // Keep calculation precision for flow direction; display rounding must not change the balance.
  const gridPower =
    powers.totalLoadPower !== undefined && powers.renewableSupplyPower !== undefined
      ? Number((powers.totalLoadPower - powers.renewableSupplyPower).toFixed(6))
      : undefined
  const gridImportState = traditional ? states.grid : directionalState(gridPower, true, states.grid)
  const gridExportState = directionalState(gridPower, false, states.grid)
  const converterImportState = traditional
    ? states.converter
    : gridImportState === 'disconnected'
      ? 'disconnected'
      : states.converter
  const converterExportState =
    gridExportState === 'disconnected' ? 'disconnected' : states.converter
  const stateValues = Object.values(states)
  const accessibilitySummary =
    (traditional
      ? `${presentation.title}：固定示例，电网经变压器、光伏经并网逆变器接入交流母线，供给交流灯、交流风扇和交流电机；储能经双向变流器充电。`
      : `${presentation.title}：同一套电网接入、光伏组串和储能设备，光伏经DC/DC变换接入直流母线，直接供给直流灯、直流风扇和直流电机。`) +
    `${stateValues.filter((state) => state === 'normal').length}路正常，${stateValues.filter((state) => state === 'disconnected').length}路断开或无输出，${stateValues.filter((state) => state === 'low').length}路电压或电流异常。` +
    `光伏总功率 ${formatPower(powers.photovoltaicPower)}，储能${traditional ? '示例' : '实时'}功率 ${formatPower(readings.storage)}，储能满载功率 ${formatPower(STORAGE_RATED_POWER_KW)}` +
    `，一级负载 ${formatPower(powers.primaryLoadPower)}，二级负载 ${formatPower(powers.secondaryLoadPower)}，三级负载 ${formatPower(powers.tertiaryLoadPower)}，负载总功率 ${formatPower(powers.totalLoadPower)}，新能源供电总功率 ${formatPower(powers.renewableSupplyPower)}`

  useEffect(
    () => () => {
      if (upgradeTimer.current !== null) clearTimeout(upgradeTimer.current)
    },
    []
  )

  useEffect(() => {
    if (previousArchitecture.current !== architecture) {
      previousArchitecture.current = architecture
      architectureButtonRef.current?.focus()
    }
  }, [architecture])

  const closeEfficiency = (): void => {
    setEfficiencyVisible(false)
    speech.stop()
    efficiencyButtonRef.current?.focus()
  }

  const toggleEfficiency = (): void => {
    if (upgradeTimer.current !== null) return
    if (efficiencyVisible) {
      closeEfficiency()
      return
    }
    setEfficiencyVisible(true)
    speech.speak(presentation.speech, true)
  }

  const upgradeArchitecture = (): void => {
    if (upgradeTimer.current !== null) return
    speech.stop()
    setEfficiencyVisible(false)
    setUpgrading(true)
    upgradeTimer.current = setTimeout(() => {
      upgradeTimer.current = null
      setArchitecture(nextArchitecture)
      setUpgrading(false)
    }, ARCHITECTURE_UPGRADE_MS)
  }

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
    <section
      className={`panel energy-panel energy-panel--konva${motionEnabled ? '' : ' energy-panel--paused'}`}
      aria-labelledby="energy-flow-title"
      data-architecture={architecture}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && efficiencyVisible) closeEfficiency()
      }}
    >
      <header className="energy-heading">
        <div className="energy-heading__title">
          <span className="energy-heading__mark" aria-hidden="true">
            ϟ
          </span>
          <div>
            <h2 id="energy-flow-title">{presentation.title}</h2>
            <p>{presentation.caption}</p>
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
        className={`konva-energy-canvas${upgrading ? ' konva-energy-canvas--upgrading' : ''}`}
        aria-busy={upgrading}
      >
        <div role="img" aria-label={accessibilitySummary}>
          <Stage width={sceneSize.width} height={sceneSize.height} listening={false}>
            <Layer
              x={sceneTransform.x}
              y={sceneTransform.y}
              scaleX={sceneTransform.scale}
              scaleY={sceneTransform.scale}
              listening={false}
            >
              <SourceZone
                x={16}
                width={248}
                title="电网接入"
                caption={traditional ? '交流接入' : 'AC / DC'}
                accent="#5eb9ef"
              />
              <SourceZone
                x={280}
                width={456}
                title="光伏发电"
                caption="4 路组串"
                accent="#43d6a0"
              />
              <SourceZone
                x={752}
                width={272}
                title="储能调节"
                caption="双向变换"
                accent="#a3a1ed"
              />
              <Rect
                x={70}
                y={366}
                width={904}
                height={68}
                cornerRadius={12}
                fill="rgba(29, 106, 99, 0.07)"
                stroke="rgba(64, 152, 139, 0.14)"
              />
              <EnergyText
                x={traditional ? 32 : 22}
                y={452}
                text={traditional ? '负载侧 AC / DC' : '负载分配'}
                fill="#7e9eb3"
                fontFamily={FONT_FAMILY}
                fontSize={11}
              />
              {efficiencyVisible && <EfficiencyHighlight architecture={architecture} />}
            </Layer>
            <Layer
              ref={wireLayerRef}
              x={sceneTransform.x}
              y={sceneTransform.y}
              scaleX={sceneTransform.scale}
              scaleY={sceneTransform.scale}
              listening={false}
            >
              <FlowWire points={[111, 128, 169, 128]} state={gridImportState} />
              <FlowWire points={[199, 187, 199, 211, 140, 211, 140, 238]} state={gridImportState} />
              <FlowWire points={[140, 320, 140, 400]} state={converterImportState} />
              {!traditional && (
                <>
                  <FlowWire points={[169, 140, 111, 140]} state={gridExportState} />
                  <FlowWire
                    points={[152, 238, 152, 223, 211, 223, 211, 187]}
                    state={gridExportState}
                  />
                  <FlowWire points={[152, 400, 152, 320]} state={converterExportState} />
                </>
              )}
              {SOLAR_CENTERS.map((centerX, index) => (
                <FlowWire
                  key={centerX}
                  points={[centerX, 203, centerX, 218]}
                  state={solarStates[index]}
                />
              ))}
              <FlowWire points={[344, 218, 508, 218]} state={states.photovoltaic} arrow={false} />
              <FlowWire points={[680, 218, 508, 218]} state={states.photovoltaic} arrow={false} />
              <FlowWire points={[508, 218, 508, 238]} state={states.photovoltaic} />
              <FlowWire points={[508, 320, 508, 370]} state={states.photovoltaic} />
              <FlowWire points={[508, 370, 508, 400]} state={states.photovoltaic} arrow={false} />
              {!traditional && (
                <FlowWire points={[876, 204, 876, 258]} state={storageDischargeState} />
              )}
              <FlowWire points={[900, 258, 900, 204]} state={storageChargeState} />
              {!traditional && (
                <>
                  <FlowWire points={[880, 340, 880, 390]} state={storageDischargeState} />
                  <FlowWire
                    points={[880, 390, 880, 400]}
                    state={storageDischargeState}
                    arrow={false}
                  />
                </>
              )}
              <FlowWire points={[896, 400, 896, 340]} state={storageChargeState} />
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
              {[
                140,
                ...(traditional ? [] : [152]),
                212,
                508,
                520,
                828,
                ...(traditional ? [] : [880]),
                896
              ].map((x) => (
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
                title={traditional ? '变压器' : '双向变流器'}
                subtitle={traditional ? '交流接入' : 'AC / DC'}
                image={converterImage}
                transformer={traditional}
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
                title={traditional ? '并网逆变器' : '光伏变换器'}
                subtitle={
                  traditional ? `总功率 ${formatPower(powers.photovoltaicPower)}` : '总功率'
                }
                power={powers.photovoltaicPower}
                emphasizePower={!traditional}
                state={states.photovoltaic}
              />
              <StorageNode
                image={storageImage}
                state={states.storage}
                power={readings.storage}
                traditional={traditional}
              />
              {!traditional && (
                <EnergyText
                  x={826}
                  y={225}
                  width={38}
                  text="放电"
                  align="right"
                  fill={FLOW_STATE_STYLE[storageDischargeState].color}
                  fontFamily={FONT_FAMILY}
                  fontSize={11}
                />
              )}
              <EnergyText
                x={912}
                y={225}
                width={38}
                text="充电"
                fill={FLOW_STATE_STYLE[storageChargeState].color}
                fontFamily={FONT_FAMILY}
                fontSize={11}
              />
              <ControlNode
                centerX={888}
                top={258}
                width={208}
                title={traditional ? '双向变流器' : '储能变换器'}
                subtitle={traditional ? 'AC/DC 充放电' : 'DC/DC 充放电'}
                state={states.storage}
              />
              <BusLabel state={states.dcBus} traditional={traditional} />
              <EnergyText
                x={420}
                y={330}
                width={176}
                text={traditional ? 'DC → AC' : 'DC → DC'}
                align="center"
                fill="#87b6c5"
                fontFamily={FONT_FAMILY}
                fontSize={11}
              />
              <EnergyText
                name="energy-power"
                fitWidth
                x={650}
                y={368}
                width={164}
                text={`新能源供电 ${formatPower(powers.renewableSupplyPower)}`}
                fill="#a8dcd4"
                fontFamily={FONT_FAMILY}
                fontSize={12}
              />
              <EnergyText
                name="energy-power"
                fitWidth
                x={650}
                y={408}
                width={164}
                text={`负载总功率 ${formatPower(powers.totalLoadPower)}`}
                fill="#a8dcd4"
                fontFamily={FONT_FAMILY}
                fontSize={12}
              />
              <LoadNode
                image={bulbImage}
                centerX={212}
                title="一级负载"
                subtitle={traditional ? '交流灯' : '直流灯'}
                state={states.primaryLoad}
                power={powers.primaryLoadPower}
              />
              <LoadNode
                image={fanImage}
                centerX={520}
                title="二级负载"
                subtitle={traditional ? '交流风扇' : '直流风扇'}
                state={states.secondaryLoad}
                power={powers.secondaryLoadPower}
              />
              <LoadNode
                image={motorImage}
                centerX={828}
                title="三级负载"
                subtitle={traditional ? '交流电机' : '直流电机'}
                state={states.tertiaryLoad}
                power={powers.tertiaryLoadPower}
              />
            </Layer>
          </Stage>
        </div>
        {efficiencyVisible && (
          <div
            className={`energy-efficiency-callout energy-efficiency-callout--${architecture}`}
            style={{
              left: sceneTransform.x + 520 * sceneTransform.scale,
              top: sceneTransform.y + 427 * sceneTransform.scale,
              transform: `translateX(-50%) scale(${sceneTransform.scale})`
            }}
            role="status"
          >
            <strong>{presentation.efficiency}</strong>
          </div>
        )}
        {upgrading && (
          <div className="energy-upgrade-overlay" role="status">
            <span className="energy-upgrade-spinner" aria-hidden="true">
              ↻
            </span>
            <strong>正在切换为{nextModeLabel}…</strong>
            <span>{traditional ? '交流配电 → 直流直供' : '直流直供 → 交流配电'}</span>
          </div>
        )}
      </div>
      <footer className="energy-footer">
        <span className="energy-footer__note">
          <i aria-hidden="true" />
          {traditional
            ? '传统交流模式功率为固定示例值'
            : '新能源供电：光伏 + 储能放电 − 储能充电 · 正值充电，负值放电'}
        </span>
        <div className="energy-footer__actions">
          <button
            type="button"
            className="energy-motion-control"
            onClick={() => setMotionEnabled((enabled) => !enabled)}
            aria-pressed={!motionEnabled}
            aria-label={motionEnabled ? '暂停能源流向动画' : '播放能源流向动画'}
          >
            <span aria-hidden="true">{motionEnabled ? 'Ⅱ' : '▷'}</span>
            {motionEnabled ? '智能设计' : '播放动效'}
          </button>
          <button
            ref={efficiencyButtonRef}
            type="button"
            className="energy-efficiency-button"
            onClick={toggleEfficiency}
            aria-pressed={efficiencyVisible}
            title={
              speech.status === 'blocked'
                ? '语音播放被拦截，点击收起，再次点击重试'
                : speech.status === 'error'
                  ? `${speech.message}，点击收起，再次点击重试`
                  : efficiencyVisible
                    ? '点击或按 Esc 收起高亮并停止播报'
                    : '点击显示效率高亮并播报'
            }
            disabled={upgrading}
          >
            <span aria-hidden="true">%</span>综合变换效率
          </button>
          <button
            ref={architectureButtonRef}
            type="button"
            className="energy-upgrade-button"
            onClick={upgradeArchitecture}
            disabled={upgrading}
            aria-label={`${upgrading ? '正在切换为' : '切换为'}${nextModeLabel}`}
            title={`切换为${nextModeLabel}`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 7v5h-5M4 17v-5h5M6.3 6.3A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.7 5.7" />
            </svg>
            {upgrading ? '切换中' : traditional ? '更新架构' : '还原架构'}
          </button>
        </div>
      </footer>
    </section>
  )
}
