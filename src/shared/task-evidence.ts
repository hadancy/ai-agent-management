import type { TiltAdjustmentPlan } from './tilt-adjustment'
import { getPlanAdvice, seasonalStrategy } from './agrivoltaic-analysis'

export const PAD_PLATFORM_NAME = '智诊精巡-高精度只能运维系统'
export const MAX_TASK_PHOTOS = 6
export const MAX_TASK_PHOTO_BYTES = 3 * 1024 * 1024
export interface TaskPhoto {
  id: string
  taskId: string
  fileName: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  size: number
  createdAt: string
}
export interface SeasonalInspectionResult {
  kind: 'seasonal_inspection'
  role: 'A' | 'B' | 'C'
  checks: boolean[]
  remarks: string[]
  signature: string
  signedAt: string
  beforeAngle?: number
  adjustedAngle?: number
  sampleCount?: number
  archiveNumber?: string
  photoReference?: string
}
export const SEASONAL_ROLES = {
  A: { title: '完工验收表', signer: '监理 / 运维管理员', start: '开始完工验收' },
  B: { title: '作业前检查确认表', signer: '作业负责人', start: '开始作业前检查' },
  C: { title: '现场作业实施记录', signer: '现场作业人员', start: '开始倾角调整' }
} as const
export function hasSeasonalFieldWorkflow(plan?: TiltAdjustmentPlan): boolean {
  return plan?.analysisVersion === 2 && plan.fieldWorkflowVersion === 1
}
export function seasonalChecklist(
  role: 'A' | 'B' | 'C',
  plan: TiltAdjustmentPlan
): Array<[string, string]> {
  const advice = getPlanAdvice(plan)
  const target = (advice.minAngle + advice.maxAngle) / 2
  const previous =
    {
      春季: '冬季档位 33–35°',
      夏季: '春季档位 19–21°',
      秋季: '夏季档位 18–20°',
      冬季: '秋季档位 21–23°'
    }[advice.season] ?? '上一季节档位'
  if (role === 'B')
    return [
      ['作业阵列确认', '核对阵列编号范围，标记固定倾角非作业区域'],
      ['支架本体状态', '支架无变形、锈蚀，接地系统完好'],
      ['安全防护布置', '现场设置安全警示围挡'],
      ['调整前原始倾角', `记录调整前实际倾角（${previous}），拍摄留存照片`]
    ]
  if (role === 'C')
    return [
      ['安全技术交底', '作业负责人完成安全、技术交底，明确参数与风险点'],
      ['倾角调节操作', `松开铰接螺栓，调至目标倾角 ${target}°，倾角仪实测校验`],
      ['螺栓紧固锁止', '锁紧全部调节螺栓、安装防松垫片，防止风力偏移角度'],
      ['板下光照复核', '调角后板下保留充足漫射光，不造成茶园过度遮阴'],
      ['现场清理', '回收工具，撤除围挡，清理现场杂物，无构件压损茶株']
    ]
  return [
    ['支架倾角', `目标 ${target}°，偏差控制 ±1° 以内`],
    ['紧固件状态', '调节螺栓全部锁紧，防松垫片齐全，无松动虚接'],
    ['组件与阵列', '组件无移位、无隐裂，阵列无互相遮挡'],
    [
      '板下农业环境',
      advice.season === '秋季'
        ? '未损伤茶株，光照满足茶树采收、越冬准备需求'
        : '未损伤茶株，光照满足茶树采收及生长需求'
    ],
    ['资料归档', '调整前后照片、倾角检测记录完整录入运维台账']
  ]
}
export function seasonalTaskVoice(plan: TiltAdjustmentPlan): string {
  const angle =
    plan.analysisVersion === 2
      ? seasonalStrategy(plan.analysisDate!).targetAngle
      : (getPlanAdvice(plan).minAngle + getPlanAdvice(plan).maxAngle) / 2
  return `您有新的工单，请将光伏组件倾角调整至 ${angle}°。`
}
export function isSeasonalInspectionResult(value: unknown): value is SeasonalInspectionResult {
  if (!value || typeof value !== 'object') return false
  const result = value as SeasonalInspectionResult
  return (
    result.kind === 'seasonal_inspection' &&
    ['A', 'B', 'C'].includes(result.role) &&
    Array.isArray(result.checks) &&
    Array.isArray(result.remarks) &&
    typeof result.signature === 'string' &&
    typeof result.signedAt === 'string'
  )
}
