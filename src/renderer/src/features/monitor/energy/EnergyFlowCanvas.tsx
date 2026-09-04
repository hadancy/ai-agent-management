import { useEffect, useMemo, useRef, useState } from 'react'
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
import '../styles/energy-flow.css'

const SCENE_WIDTH = 1124
const SCENE_HEIGHT = 427
const DEVICE_IMAGE_SCALE = 0.8
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
    color: '#32e875',
    highlight: '#d9ffe5',
    label: '能源正常',
    shadowOpacity: 0.72
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
    fill: 'rgba(14, 73, 35, 0.82)',
    stroke: 'rgba(62, 183, 61, 0.88)',
    color: '#6de650',
    dot: '#65e84d',
    text: '运行正常'
  },
  low: {
    fill: 'rgba(92, 70, 12, 0.84)',
    stroke: 'rgba(242, 201, 76, 0.9)',
    color: '#ffe48b',
    dot: '#f2c94c',
    text: '参数异常'
  },
  disconnected: {
    fill: 'rgba(39, 49, 57, 0.88)',
    stroke: 'rgba(105, 119, 131, 0.9)',
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
  return state === 'normal' ? 'energy-device-state' : 'energy-device-state energy-device-alert'
}

function CanvasImage({
  image,
  x,
  y,
  width,
  height,
  crop,
  opacity = 1
}: CanvasImageProps): React.JSX.Element | null {
  if (!image) return null

  return (
    <KonvaImage
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

function FlowWire({
  points,
  state,
  arrow = true,
  reverse = false,
  width = 3,
  speed = 'normal'
}: FlowWireProps): React.JSX.Element {
  const style = FLOW_STATE_STYLE[state]
  const isFlowing = state !== 'disconnected'
  const arrowPoints = points.slice(-4)
  const animationName = [
    'energy-flow-dash',
    reverse ? 'energy-flow-reverse' : 'energy-flow-forward',
    speed === 'slow' || state === 'low' ? 'energy-flow-slow' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Group listening={false}>
      <Line
        points={points}
        stroke={style.color}
        strokeWidth={width}
        lineCap="round"
        lineJoin="round"
        shadowColor={style.color}
        shadowBlur={7}
        shadowOpacity={style.shadowOpacity}
        perfectDrawEnabled={false}
      />
      {isFlowing && (
        <Line
          name={animationName}
          points={points}
          stroke={style.highlight}
          strokeWidth={Math.max(1.4, width - 1.2)}
          lineCap="round"
          lineJoin="round"
          dash={[10, 18]}
          opacity={0.86}
          shadowColor={style.color}
          shadowBlur={6}
          shadowOpacity={0.95}
          perfectDrawEnabled={false}
        />
      )}
      {arrow && (
        <Arrow
          points={arrowPoints}
          stroke={style.color}
          fill={style.color}
          strokeWidth={width}
          pointerLength={10}
          pointerWidth={9}
          lineCap="round"
          lineJoin="round"
          shadowColor={style.color}
          shadowBlur={6}
          shadowOpacity={style.shadowOpacity}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  )
}

function CompactFlowArrow({
  points,
  state
}: {
  points: number[]
  state: EnergyRouteState
}): React.JSX.Element {
  const style = FLOW_STATE_STYLE[state]

  return (
    <Arrow
      points={points}
      stroke={style.color}
      fill={style.color}
      strokeWidth={2}
      pointerLength={7}
      pointerWidth={7}
      lineCap="round"
      lineJoin="round"
      shadowColor={style.color}
      shadowBlur={2}
      shadowOpacity={style.shadowOpacity}
      perfectDrawEnabled={false}
      listening={false}
    />
  )
}

function StatusBadge({
  x,
  y,
  width = 72,
  text,
  state = 'normal'
}: {
  x: number
  y: number
  width?: number
  text?: string
  state?: EnergyRouteState
}): React.JSX.Element {
  const style = STATUS_BADGE_STYLE[state]
  return (
    <Group x={x} y={y} listening={false}>
      <Rect
        width={width}
        height={18}
        cornerRadius={3}
        fill={style.fill}
        stroke={style.stroke}
        strokeWidth={1}
      />
      <Circle x={10} y={9} radius={3.4} fill={style.dot} shadowColor={style.dot} shadowBlur={5} />
      <Text
        x={17}
        y={3.5}
        width={width - 20}
        text={text ?? style.text}
        fill={style.color}
        fontFamily={FONT_FAMILY}
        fontSize={9}
        align="center"
        listening={false}
      />
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
  containerWidth,
  crop,
  titleAbove = false,
  statusWidth = 72,
  state = 'normal'
}: {
  image?: HTMLImageElement
  centerX: number
  top: number
  imageWidth: number
  imageHeight: number
  title: string
  containerWidth: number
  crop?: CropArea
  titleAbove?: boolean
  statusWidth?: number
  state?: EnergyRouteState
}): React.JSX.Element {
  const scaledImageWidth = imageWidth * DEVICE_IMAGE_SCALE
  const scaledImageHeight = imageHeight * DEVICE_IMAGE_SCALE
  const imageY = titleAbove ? 18 : 0
  const titleY = titleAbove ? 0 : imageY + scaledImageHeight + 3
  const statusY = titleAbove ? imageY + scaledImageHeight + 4 : titleY + 17

  return (
    <Group
      name={getDeviceStateNodeName(state)}
      x={centerX - containerWidth / 2}
      y={top}
      listening={false}
    >
      <CanvasImage
        image={image}
        x={(containerWidth - scaledImageWidth) / 2}
        y={imageY}
        width={scaledImageWidth}
        height={scaledImageHeight}
        crop={crop}
      />
      <Text
        x={0}
        y={titleY}
        width={containerWidth}
        text={title}
        fill="#dfe2e6"
        fontFamily={FONT_FAMILY}
        fontSize={11}
        align="center"
        listening={false}
      />
      <StatusBadge
        x={(containerWidth - statusWidth) / 2}
        y={statusY}
        width={statusWidth}
        state={state}
      />
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
  const imageWidth = 80 * DEVICE_IMAGE_SCALE
  const imageHeight = 74 * DEVICE_IMAGE_SCALE
  const style = FLOW_STATE_STYLE[state]

  return (
    <Group name={getDeviceStateNodeName(state)} x={centerX - 42} y={7} listening={false}>
      <Text
        width={84}
        text={`光伏 ${index}`}
        fill={state === 'normal' ? '#dde0e5' : style.highlight}
        fontFamily={FONT_FAMILY}
        fontSize={10}
        align="center"
      />
      <Circle x={72} y={5} radius={3} fill={style.color} shadowColor={style.color} shadowBlur={5} />
      <Group clipX={0} clipY={15} clipWidth={84} clipHeight={62}>
        <CanvasImage
          image={image}
          x={(84 - imageWidth) / 2}
          y={15}
          width={imageWidth}
          height={imageHeight}
          crop={{ x: 18, y: 126, width: 348, height: 322 }}
        />
      </Group>
    </Group>
  )
}

function ControlNode({
  centerX,
  top,
  width,
  title,
  state = 'normal'
}: {
  centerX: number
  top: number
  width: number
  title: string
  state?: EnergyRouteState
}): React.JSX.Element {
  return (
    <Group name={getDeviceStateNodeName(state)} x={centerX - width / 2} y={top} listening={false}>
      <Rect
        width={width}
        height={57}
        cornerRadius={5}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: width, y: 57 }}
        fillLinearGradientColorStops={[0, '#24384a', 1, '#071d2f']}
        stroke="#5a748b"
        strokeWidth={1}
        shadowColor="#000"
        shadowBlur={10}
        shadowOpacity={0.35}
        shadowOffsetY={4}
      />
      <Rect x={10} y={10} width={38} height={36} stroke="#8cd8e5" strokeWidth={2} />
      <Line points={[15, 38, 42, 17]} stroke="#8cd8e5" strokeWidth={2} lineCap="round" />
      <Line points={[16, 20, 27, 20]} stroke="#8cd8e5" strokeWidth={2} lineCap="round" />
      <Line points={[31, 36, 42, 36]} stroke="#8cd8e5" strokeWidth={2} lineCap="round" />
      <Text
        x={54}
        y={10}
        width={width - 67}
        text={title}
        fill="#e2e4e8"
        fontFamily={FONT_FAMILY}
        fontSize={11}
        align="center"
      />
      <StatusBadge x={57} y={31} width={Math.min(76, width - 70)} state={state} />
      <Circle
        x={width - 9}
        y={42}
        radius={2.5}
        fill={FLOW_STATE_STYLE[state].color}
        shadowColor={FLOW_STATE_STYLE[state].color}
        shadowBlur={5}
      />
    </Group>
  )
}

function LoadNode({
  image,
  centerX,
  title,
  subtitle,
  crop,
  state = 'normal'
}: {
  image?: HTMLImageElement
  centerX: number
  title: string
  subtitle: string
  crop: CropArea
  state?: EnergyRouteState
}): React.JSX.Element {
  const imageWidth = 110 * DEVICE_IMAGE_SCALE
  const imageHeight = 79 * DEVICE_IMAGE_SCALE

  return (
    <Group name={getDeviceStateNodeName(state)} x={centerX - 56} y={306} listening={false}>
      <Rect
        width={112}
        height={100}
        cornerRadius={5}
        fillLinearGradientStartPoint={{ x: 0, y: 0 }}
        fillLinearGradientEndPoint={{ x: 112, y: 100 }}
        fillLinearGradientColorStops={[0, '#26394b', 1, '#091d2e']}
        stroke="#60798f"
        strokeWidth={1}
        shadowColor="#000"
        shadowBlur={9}
        shadowOpacity={0.32}
        shadowOffsetY={4}
      />
      <CanvasImage
        image={image}
        x={(112 - imageWidth) / 2}
        y={1}
        width={imageWidth}
        height={imageHeight}
        crop={crop}
      />
      <Rect x={1} y={64} width={110} height={35} fill="rgba(4, 18, 29, 0.78)" />
      <Text
        x={2}
        y={68}
        width={108}
        text={title}
        fill="#e4e5e8"
        fontFamily={FONT_FAMILY}
        fontSize={11}
        align="center"
      />
      <Text
        x={2}
        y={83}
        width={108}
        text={subtitle}
        fill="#c8ced5"
        fontFamily={FONT_FAMILY}
        fontSize={10}
        align="center"
      />
      <StatusBadge x={20} y={104} state={state} />
    </Group>
  )
}

function BusLabel({ state }: { state: EnergyRouteState }): React.JSX.Element {
  const style = FLOW_STATE_STYLE[state]

  return (
    <Group name={getDeviceStateNodeName(state)} x={670} y={251} listening={false}>
      <Rect
        width={160}
        height={32}
        cornerRadius={4}
        fill="rgba(5, 27, 43, 0.96)"
        stroke="#3f899b"
        strokeWidth={1}
        shadowColor={style.color}
        shadowBlur={8}
        shadowOpacity={0.25}
      />
      <Text
        y={6}
        width={160}
        text="直流母线 DC"
        fill="#edf0f2"
        fontFamily={FONT_FAMILY}
        fontSize={15}
        align="center"
      />
      <StatusBadge x={44} y={-20} state={state} />
    </Group>
  )
}

function SceneLegend(): React.JSX.Element {
  const items: EnergyRouteState[] = ['normal', 'disconnected', 'low']

  return (
    <Group x={975} y={5} listening={false}>
      <Rect
        width={141}
        height={52}
        cornerRadius={5}
        fill="rgba(2, 17, 30, 0.9)"
        stroke="rgba(27, 101, 151, 0.76)"
        strokeWidth={1}
      />
      {items.map((state, index) => {
        const style = FLOW_STATE_STYLE[state]
        const y = 10 + index * 16

        return (
          <Group key={state}>
            <Line
              points={[10, y, 37, y]}
              stroke={style.color}
              strokeWidth={3}
              lineCap="round"
              shadowColor={style.color}
              shadowBlur={state === 'disconnected' ? 0 : 4}
            />
            <Text
              x={45}
              y={y - 5.5}
              width={90}
              text={style.label}
              fill="#d9dfe5"
              fontFamily={FONT_FAMILY}
              fontSize={9}
            />
          </Group>
        )
      })}
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
    if (!layer || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const animation = new Konva.Animation((frame) => {
      if (!frame) return
      const pulseOpacity = 0.58 + ((Math.sin(frame.time / 180) + 1) / 2) * 0.42
      layer.find('.energy-device-state').forEach((node) => {
        node.opacity(node.hasName('energy-device-alert') ? pulseOpacity : 1)
      })
    }, layer)
    animation.start()
    return () => {
      animation.stop()
      layer.find('.energy-device-state').forEach((node) => node.opacity(1))
      layer.batchDraw()
    }
  }, [])

  useEffect(() => {
    const layer = wireLayerRef.current
    if (!layer || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const animation = new Konva.Animation((frame) => {
      if (!frame) return
      layer.find('.energy-flow-dash').forEach((node) => {
        const direction = node.hasName('energy-flow-reverse') ? 1 : -1
        const speed = node.hasName('energy-flow-slow') ? 42 : 27
        node.setAttr('dashOffset', (frame.time / speed) * direction)
      })
    }, layer)
    animation.start()
    return () => {
      animation.stop()
    }
  }, [])

  const sceneTransform = useMemo(() => {
    const scale = Math.min(sceneSize.width / SCENE_WIDTH, sceneSize.height / SCENE_HEIGHT)
    return {
      scale,
      x: (sceneSize.width - SCENE_WIDTH * scale) / 2,
      y: (sceneSize.height - SCENE_HEIGHT * scale) / 2
    }
  }, [sceneSize])

  return (
    <section className="panel energy-panel energy-panel--konva">
      <div
        ref={containerRef}
        className="konva-energy-canvas"
        role="img"
        aria-label={accessibilitySummary}
      >
        <Stage width={sceneSize.width} height={sceneSize.height} listening={false}>
          <Layer
            ref={wireLayerRef}
            x={sceneTransform.x}
            y={sceneTransform.y}
            scaleX={sceneTransform.scale}
            scaleY={sceneTransform.scale}
            listening={false}
          >
            <FlowWire points={[107, 185, 177, 185]} state={states.grid} />
            <FlowWire points={[223, 185, 265, 185]} state={states.grid} />
            <FlowWire points={[265, 185, 309, 185]} state={states.grid} />

            <FlowWire points={[395, 196, 445, 196, 460, 211, 460, 258]} state={states.converter} />
            <FlowWire points={[460, 258, 460, 267]} state={states.converter} arrow={false} />

            <FlowWire points={[450, 76, 450, 119]} state={solarStates[0]} />
            <FlowWire points={[575, 76, 575, 119]} state={solarStates[1]} />
            <FlowWire points={[700, 76, 700, 119]} state={solarStates[2]} />
            <FlowWire points={[825, 76, 825, 119]} state={solarStates[3]} />
            <FlowWire
              points={[450, 119, 825, 119]}
              state={states.photovoltaic}
              arrow={false}
              speed="slow"
            />
            <FlowWire points={[638, 119, 638, 143]} state={states.photovoltaic} />
            <FlowWire points={[638, 198, 638, 231]} state={states.photovoltaic} />
            <FlowWire points={[638, 231, 638, 258]} state={states.photovoltaic} />
            <FlowWire points={[638, 258, 638, 267]} state={states.photovoltaic} arrow={false} />

            <FlowWire
              points={[455, 267, 1050, 267]}
              state={states.dcBus}
              arrow={false}
              width={5}
              speed="slow"
            />
            <FlowWire points={[530, 267, 530, 307]} state={states.primaryLoad} />
            <FlowWire points={[750, 267, 750, 307]} state={states.secondaryLoad} />
            <FlowWire points={[920, 267, 920, 307]} state={states.tertiaryLoad} />
          </Layer>

          <Layer
            ref={deviceLayerRef}
            x={sceneTransform.x}
            y={sceneTransform.y}
            scaleX={sceneTransform.scale}
            scaleY={sceneTransform.scale}
            listening={false}
          >
            <Text
              x={18}
              y={15}
              text="实时能源流向"
              fill="#ece8e9"
              fontFamily={FONT_FAMILY}
              fontSize={17}
            />
            <SceneLegend />
            <Text
              x={230}
              y={168}
              text="交流 AC"
              fill="#dce5ec"
              fontFamily={FONT_FAMILY}
              fontSize={11}
              fontStyle="bold"
            />

            <DeviceNode
              image={towerImage}
              centerX={70}
              top={103}
              imageWidth={90}
              imageHeight={135}
              title="电网"
              containerWidth={110}
              state={states.grid}
            />
            <DeviceNode
              image={communicationImage}
              centerX={200}
              top={153}
              imageWidth={54}
              imageHeight={64}
              title="电网通信接口"
              containerWidth={116}
              state={states.grid}
            />
            <DeviceNode
              image={converterImage}
              centerX={350}
              top={103}
              imageWidth={100}
              imageHeight={135}
              title="AC/DC 双向变流器"
              containerWidth={155}
              statusWidth={78}
              state={states.converter}
            />

            <SolarNode image={solarImage} centerX={450} index={1} state={solarStates[0]} />
            <SolarNode image={solarImage} centerX={575} index={2} state={solarStates[1]} />
            <SolarNode image={solarImage} centerX={700} index={3} state={solarStates[2]} />
            <SolarNode image={solarImage} centerX={825} index={4} state={solarStates[3]} />
            <ControlNode
              centerX={638}
              top={143}
              width={174}
              title="光伏汇流 / DC/DC"
              state={states.photovoltaic}
            />

            <DeviceNode
              image={storageImage}
              centerX={970}
              top={60}
              imageWidth={112}
              imageHeight={90}
              crop={{ x: 18, y: 112, width: 348, height: 279 }}
              title="储能系统"
              containerWidth={150}
              titleAbove
              state={states.storage}
            />
            <ControlNode
              centerX={970}
              top={201}
              width={154}
              title="双向 DC/DC"
              state={states.storage}
            />
            <BusLabel state={states.dcBus} />

            <LoadNode
              image={bulbImage}
              centerX={530}
              title="一级负载"
              subtitle="直流灯"
              crop={{ x: 14, y: 52, width: 356, height: 327 }}
              state={states.primaryLoad}
            />
            <LoadNode
              image={fanImage}
              centerX={750}
              title="二级负载"
              subtitle="直流风扇"
              crop={{ x: 14, y: 52, width: 356, height: 327 }}
              state={states.secondaryLoad}
            />
            <LoadNode
              image={motorImage}
              centerX={920}
              title="三级负载"
              subtitle="直流电机"
              crop={{ x: 14, y: 52, width: 356, height: 327 }}
              state={states.tertiaryLoad}
            />

            <CompactFlowArrow points={[962, 172, 962, 200]} state={states.storage} />
            <CompactFlowArrow points={[978, 201, 978, 173]} state={states.storage} />
            <CompactFlowArrow points={[962, 258, 962, 266]} state={states.storage} />
            <CompactFlowArrow points={[978, 267, 978, 259]} state={states.storage} />
          </Layer>
        </Stage>
      </div>
    </section>
  )
}
