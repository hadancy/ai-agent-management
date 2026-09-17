import { STATION_TIME_ZONE } from './plc-clock'
import { getTiltAdvice, isAnalysisDate, type TiltAdjustmentPlan } from './tilt-adjustment'

export type AnalysisRound = 'overview' | 'seasonal'
export const ANALYSIS_WAIT_MS = 5000
export const ANALYSIS_LINE_MS = 650
export const ANALYSIS_CHARACTER_MS = 25
export const ANALYSIS_PROMPTS = {
  overview: '请结合附件的农光互补项目信息，综合分析光伏支架安装高度以及倾角调节技术方案建议',
  seasonal: '请你提供按季动态倾角加茶树全生长周期的倾角调整建议。'
} as const
export const OVERVIEW_CONCLUSION =
  '本项目光伏支架最低净空高度取 2.0 m，建议采用方案三的倾角调节方式。'

// Supplied presentation script, not model-generated reasoning or independently verified data.
export const OVERVIEW_ANALYSIS =
  `我们需要回答用户。用户中文。要求：内容包含如何计算光伏支架最低净高，得出以后要跟政策核验，通过核心工作模式、一次性投入成本、山区环境可靠性、发电表现、对茶叶生产影响、乡村适配性等方面分析得出三类倾角调节技术方案对比分析结果。
要包含：如何计算最低净高，得出后跟政策核验；通过六个维度分析得出三类方案对比结果。要合理倒推。
需要可能用附件政策：板下沿不低于2.0m。输入茶树盛产期平均树冠高度1.0m，公式净高=树高×1.8±0.2m，代入1.0×1.8+0.2=2.0。
考虑采摘通行、通风、防机械碰撞、树冠与板之间安全距离，作业空间约0.8m，故1.0+0.8=1.8，再加0.2安全余量=2.0。
然后政策核验：某省通知要求板下沿离地原则上不低于2.0m，故2.0m刚好满足底线。
三类方案对比：候选方案一电动逐日跟踪，方案二固定倾角，方案三按季动态+茶树全周期调整。
分析框架六维：核心工作模式、一次性投入、山区可靠性、发电表现、茶叶影响、乡村适配性。
电动跟踪：实时追日，理论发电最高，但成本3.2倍手动，电机传动在山区多雾潮湿雷雨故障率高，维修需专业，机械占地多，板下光照动态剧烈，茶叶品质波动，故障遮光异常，乡村适配差。
固定倾角：全年不变，成本低结构简单，可靠性高，但发电较融合方案低约10%，夏秋强光灼伤茶叶，品质波动，重发电轻农业，农光协同差。
按季动态：分四季人工调整，全年4次，净高2m适配茶树，成本中等，为电动1/3.2？输出说一次性投入为手动按季调整方案的3.2倍，即电动=3.2×按季。
机械简单故障少，培训1小时，综合效益提升15%以上，动态调控漫射光匹配茶叶，稳定品质，适配留守劳动力，适合武陵山区。因此得出方案三最优。
结论：
最低净高：
农业对象茶叶，盛产期树冠1.0m；
作业安全与通风要求：采摘、修剪、通风、防灼伤、防机械碰撞，需预留0.8m作业空间；经验公式树高×1.8±0.2，即1.8m基准，取+0.2安全余量=2.0m。
政策核验：《关于规范...》板下沿不低于2.0m，计算值正好等于政策底线，合规；实际设计最低点控制≥2.0m。
方案对比：
设定三类方案：电动逐日跟踪、固定倾角、按季动态+茶树周期。
六维比较：
核心工作模式：实时追日 vs 固定 vs 四季人工4次。
一次性投入：电动=3.2×按季；固定低；按季中。
山区可靠性：电动故障率高，专业检修；固定无运动件可靠；按季简单，培训1小时。
发电表现：电动理论最高但故障拉低；固定比融合低约10%；按季综合+15%。
茶叶影响：电动光照剧变品质波动；固定夏秋灼伤；按季漫射光匹配稳定品质。
乡村适配：电动成本高运维难；固定农光协同差；按季适合留守劳动力，兼顾发电与茶叶，适合推广。`.split(
    '\n'
  )

export const SEASONAL_ANALYSIS =
  `设计原则：优先满足茶树各物候期光照、光照质量需求，兼顾光伏发电收益；结合本地经纬度太阳高度、山区小气候；季节自适应固定可调支架，每年4次物候节点调角；农光互补，作物优先，发电次之。
作物基础（光明村山地茶叶）：
1.冬季休眠期：茶树停止新梢生长，仅维持基础代谢，光照需求最低，但芽基分化发育，不可长期重度遮阴；
2.春茶采摘季：全年经济价值最高，新梢萌发，喜漫射光、忌长时间正午强遮光，日均有效光照≥7h，利于氨基酸积累，提升春茶品质；
3.夏梢生长期：伏旱高温强光，强光会灼伤茶梢，需要适度遮阴，但不能遮光过重，日均有效光照≥6.8h；
4.秋茶采摘 + 养分回流期：秋茶采收，同时茶树根系储存养分、分化越冬芽，光照要充足，保障光合产物回流。
地理条件：北纬28°25′，亚热带季风湿润山区；冬至正午太阳高度≈38.2°，夏至正午太阳高度≈84.8°；年日照1280h，散射光占比高；支架为季节自适应固定可调支架；前期阵列行距已按农光做放大，规避严重行间自遮挡。
评价约束指标：茶树新梢生长量降幅≤5%（行业阈值）；茶青氨基酸综合达标率作为品质评价指标。`.split('\n')

export const HEIGHT_RESULT = [
  '一、光伏支架最低净高计算',
  '1、输入基础条件',
  '1. 茶树盛产期平均树冠高度：1.0 m；',
  '2. 本项目支架净高计算公式：',
  '支架净高 = 茶树盛产期平均高度 × 1.8 ± 0.2 m',
  '3. 代入计算：1.0 m × 1.8 + 0.2 m = 2 m',
  '结论：本项目光伏支架最低净空高度取 2.0 m。',
  '二、三类倾角调节技术方案对比分析'
]
export const COMPARISON_HEADERS = [
  '对比项',
  '方案一：电动逐日跟踪系统',
  '方案二：固定倾角支架',
  '方案三：按季动态倾角 + 茶树全生长周期调整倾角'
]
export const COMPARISON_ROWS = [
  [
    '核心工作模式',
    '组件跟随太阳实时转动追踪光照',
    '全年倾角固定不变',
    '分四季人工调整倾角，全年仅操作4次；支架净高2.0 m适配茶树完整生长周期'
  ],
  [
    '一次性投入成本',
    '为手动按季调整方案的3.2倍',
    '投入较低，结构简单',
    '投入中等，远低于电动逐日系统'
  ],
  [
    '山区环境可靠性',
    '山区多雾、潮湿、雷雨，电机传动机构故障率高；故障后需专业工程师进山检修',
    '无运动机构，可靠性高，但发电与农业适配性差',
    '机械结构简单，故障点少；普通运维人员培训1小时即可独立完成调角作业'
  ],
  [
    '发电表现',
    '理论发电最高，但山区故障率拉高实际等效收益',
    '相比本融合方案发电效率低约10%',
    '综合效益较单一模式提升15%以上，兼顾发电与板下作物'
  ],
  [
    '对茶叶生产影响',
    '机械占地多，板下光照动态剧烈变化，茶叶品质波动大；设备故障时还会局部遮光异常',
    '倾角全年不变，夏秋季板下强光过多易灼伤茶叶，茶叶品质波动大',
    '分季节调整倾角，动态调控板下漫射光占比，匹配茶叶不同生育期光照需求，稳定茶叶品质'
  ],
  [
    '乡村适配性',
    '成本高，后期运维门槛高，普通村集体、农户负担不起',
    '成本低，但农光协同效果差，“重发电、轻农业”',
    '适配留守劳动力为主的乡村现状，兼顾发电收益与板下茶叶种植，适合武陵山区同类乡村推广'
  ]
]
export const SEASONAL_RESULT = [
  '基准倾角为21–23°',
  '春季：基准倾角−2°，保春茶氨基酸含量，发电效率提升8%。',
  '夏季：基准−3°，板下降温8–13℃，消除光合午休，减少水分蒸发30%。',
  '秋季：回归基准，平衡发电与秋茶品质。',
  '冬季：基准+12°，多发电、自动除雪、防霜冻。'
]
export function getAnalysisLines(round: AnalysisRound): string[] {
  return round === 'overview' ? OVERVIEW_ANALYSIS : SEASONAL_ANALYSIS
}
export function getResultSegments(round: AnalysisRound): string[] {
  return round === 'overview'
    ? [...HEIGHT_RESULT, ...COMPARISON_HEADERS, ...COMPARISON_ROWS.flat(), OVERVIEW_CONCLUSION]
    : SEASONAL_RESULT
}
export function stationDate(clock: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: STATION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(clock)
}
export function seasonalStrategy(date: string): {
  season: '春季' | '夏季' | '秋季' | '冬季'
  targetAngle: number
  minAngle: number
  maxAngle: number
  endDate: string
} {
  if (!isAnalysisDate(date)) throw new Error('作业日期无效')
  const year = Number(date.slice(0, 4))
  const md = date.slice(5)
  // Fixed project phenology milestones; inclusive maintenance end dates.
  const [season, targetAngle, endDate] =
    md < '02-04'
      ? (['冬季', 34, `${year}-02-03`] as const)
      : md < '05-06'
        ? (['春季', 20, `${year}-05-05`] as const)
        : md < '08-08'
          ? (['夏季', 19, `${year}-08-07`] as const)
          : md < '11-08'
            ? (['秋季', 22, `${year}-11-07`] as const)
            : (['冬季', 34, `${year + 1}-02-03`] as const)
  return { season, targetAngle, minAngle: targetAngle - 1, maxAngle: targetAngle + 1, endDate }
}
export function getPlanAdvice(plan: TiltAdjustmentPlan): {
  season: string
  minAngle: number
  maxAngle: number
  explanation: string
} {
  if (plan.analysisVersion !== 2) return getTiltAdvice(plan.month)
  const strategy = seasonalStrategy(plan.analysisDate!)
  return {
    ...strategy,
    explanation: SEASONAL_RESULT.find((line) => line.startsWith(strategy.season))!
  }
}
export function seasonalConclusion(date: string, created: boolean): string {
  const { season } = seasonalStrategy(date)
  return `现在是${Number(date.slice(5, 7))}月${Number(date.slice(8))}日，执行${season}倾角，${created ? '工单已生成。' : '正在生成工单…'}`
}
export function seasonalWorkOrderFields(plan: TiltAdjustmentPlan): Array<[string, string]> {
  const date = plan.analysisDate!
  const strategy = seasonalStrategy(date)
  return [
    ['项目名称', '光明村农光互补智慧农业一体化运维项目'],
    ['作业工单名称', `支架倾角季节性调整-${strategy.season}模式`],
    ['作业日期', date.replaceAll('-', '.')],
    ['计划执行时段', '09:00–17:00'],
    ['天气条件要求', '无暴雨、大风，风速≤10 m/s，晴天/多云，禁止夜间作业'],
    ['作业对象', '手动季节可调支架阵列'],
    [
      '调整依据',
      `1. 光明村光照及茶叶作物生长特性；\n2. 项目倾角技术方案（${strategy.season}：${strategy.minAngle}–${strategy.maxAngle}°）；\n3. 省农光互补项目建设管理规定，保障板下农业生产条件。`
    ],
    ['本次目标倾角', `${strategy.targetAngle}°（允许偏差 ±1°）`],
    ['调整后维持周期', `${date.replaceAll('-', '.')}～${strategy.endDate.replaceAll('-', '.')}`]
  ]
}
