import { Group, Line, Rect } from 'react-konva'
import type { EnergyArchitecture } from './architecture'

export function EfficiencyHighlight({
  architecture
}: {
  architecture: EnergyArchitecture
}): React.JSX.Element {
  const traditional = architecture === 'traditional'
  return (
    <Group
      name={`energy-efficiency-highlight energy-efficiency-highlight--${architecture}`}
      listening={false}
    >
      <Rect
        x={traditional ? 28 : 70}
        y={traditional ? 228 : 360}
        width={traditional ? 984 : 904}
        height={traditional ? 201 : 75}
        cornerRadius={14}
        fill="rgba(255, 200, 61, 0.14)"
        stroke="#ffd45e"
        strokeWidth={2.5}
        shadowColor="#ffc43d"
        shadowBlur={18}
        shadowOpacity={0.5}
      />
      <Rect
        x={traditional ? 16 : 394}
        y={traditional ? 435 : 228}
        width={traditional ? 1008 : 228}
        height={traditional ? 39 : 126}
        cornerRadius={12}
        fill="rgba(255, 200, 61, 0.1)"
        stroke="#ffd45e"
        strokeWidth={2}
      />
      {[
        [508, 320, 508, 400],
        [110, 400, 934, 400],
        ...[212, 520, 828].map((x) => [x, 400, x, 476])
      ].map((points, index) => (
        <Line
          key={index}
          points={points}
          stroke="#ffd45e"
          strokeWidth={10}
          opacity={0.45}
          lineCap="round"
          lineJoin="round"
          shadowColor="#ffce47"
          shadowBlur={14}
        />
      ))}
    </Group>
  )
}
