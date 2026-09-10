import { STATION_TIME_ZONE } from './plc-clock'

export interface TiltAdjustmentPlan {
  month: number
  fileName: string
  fileSize: number
  requestId: string
}

export interface TiltAdvice {
  season: '冬季' | '春秋季' | '夏季'
  minAngle: number
  maxAngle: number
  explanation: string
}

export function getStationMonth(clock: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: STATION_TIME_ZONE,
      month: 'numeric'
    }).format(clock)
  )
}

export function getTiltAdvice(month: number): TiltAdvice {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('月份必须为 1 至 12 月')
  }
  if (month === 12 || month <= 2) {
    return {
      season: '冬季',
      minAngle: 42,
      maxAngle: 48,
      explanation: '保障积雪滑落，匹配冬季太阳高度，兼顾发电，控制阴影，保障茶树基础光照；'
    }
  }
  if (month >= 6 && month <= 8) {
    return {
      season: '夏季',
      minAngle: 20,
      maxAngle: 25,
      explanation:
        '缩小组件阴影投影，提升板下光照；增强组件通风散热，降低高温衰减；适度遮阴保护茶芽，抵御伏旱强光灼伤。'
    }
  }
  return {
    season: '春秋季',
    minAngle: 30,
    maxAngle: 38,
    explanation: '平衡光伏发电收益与板下茶树光照获取，适配春茶、秋茶关键生长期；'
  }
}

export function getTiltReply(month: number): string {
  const advice = getTiltAdvice(month)
  return `结合项目信息及作物生长习性，建议组件倾角调整为：\n${advice.season}：${advice.minAngle}至${advice.maxAngle}度：${advice.explanation}`
}

export function isTiltAdjustmentPlan(value: unknown): value is TiltAdjustmentPlan {
  if (typeof value !== 'object' || value === null) return false
  const plan = value as TiltAdjustmentPlan
  return (
    Number.isInteger(plan.month) &&
    plan.month >= 1 &&
    plan.month <= 12 &&
    typeof plan.fileName === 'string' &&
    plan.fileName.length > 0 &&
    plan.fileName.length <= 255 &&
    Number.isSafeInteger(plan.fileSize) &&
    plan.fileSize >= 0 &&
    typeof plan.requestId === 'string' &&
    /^[a-zA-Z0-9-]{1,80}$/.test(plan.requestId)
  )
}
