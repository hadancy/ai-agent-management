import { STATION_TIME_ZONE } from './plc-clock'

export const MAX_TILT_REQUEST_LENGTH = 2000

export interface TiltAdjustmentPlan {
  month: number
  fileName: string
  fileSize: number
  requestId: string
  userRequest?: string
  analysisVersion?: 2
  analysisDate?: string
  fieldWorkflowVersion?: 1
}

export function isAnalysisDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  )
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
    (plan.fieldWorkflowVersion === undefined ||
      (plan.fieldWorkflowVersion === 1 && plan.analysisVersion === 2)) &&
    (plan.analysisVersion === undefined
      ? plan.analysisDate === undefined
      : plan.analysisVersion === 2 &&
        isAnalysisDate(plan.analysisDate) &&
        Number(plan.analysisDate.slice(5, 7)) === plan.month) &&
    Number.isInteger(plan.month) &&
    plan.month >= 1 &&
    plan.month <= 12 &&
    typeof plan.fileName === 'string' &&
    (plan.fileName.trim().length > 0 || typeof plan.userRequest === 'string') &&
    plan.fileName.length <= 255 &&
    (plan.userRequest === undefined ||
      (typeof plan.userRequest === 'string' &&
        plan.userRequest.trim().length > 0 &&
        plan.userRequest.length <= MAX_TILT_REQUEST_LENGTH)) &&
    Number.isSafeInteger(plan.fileSize) &&
    plan.fileSize >= 0 &&
    (plan.fileName.trim().length > 0 || plan.fileSize === 0) &&
    typeof plan.requestId === 'string' &&
    /^[a-zA-Z0-9-]{1,80}$/.test(plan.requestId)
  )
}
