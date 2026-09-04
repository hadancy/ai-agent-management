import { useEffect, useRef } from 'react'
import { echarts, type EChartsOption } from './chartRuntime'

export default function EChartCanvas({
  option,
  ariaLabel
}: {
  option: EChartsOption
  ariaLabel: string
}): React.JSX.Element {
  const elementRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null)

  useEffect(() => {
    if (!elementRef.current) return

    const chart = echarts.init(elementRef.current, undefined, { renderer: 'canvas' })
    chartRef.current = chart
    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(elementRef.current)

    return () => {
      resizeObserver.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={elementRef} className="echart-canvas" role="img" aria-label={ariaLabel} />
}
