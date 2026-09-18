import { getTiltReply } from '../src/shared/tilt-adjustment'
import {
  OVERVIEW_CONCLUSION,
  SEASONAL_RESULT,
  seasonalSpeechText
} from '../src/shared/agrivoltaic-analysis'
import { ENERGY_ARCHITECTURES } from '../src/renderer/src/features/monitor/energy/architecture'
import { DIAGNOSIS_SPEECH_TEXT, RECORDED_TEST_TEXT } from '../src/shared/recorded-speech'
export * from '../src/shared/recorded-speech'

export const fullRecordings = [
  DIAGNOSIS_SPEECH_TEXT,
  RECORDED_TEST_TEXT,
  OVERVIEW_CONCLUSION,
  seasonalSpeechText(),
  SEASONAL_RESULT.join('\n'),
  ...SEASONAL_RESULT,
  ...Array.from({ length: 12 }, (_, index) => getTiltReply(index + 1)),
  ...Object.values(ENERGY_ARCHITECTURES).map((item) => item.speech),
  '工单语音播报已开启。',
  '处理完成，PLC数据已恢复正常，工单已自动关闭。',
  '警告！检测到',
  '存在运行异常或预测风险，请立即查看处理。',
  '现在是',
  '日，执行',
  '倾角，工单已生成。',
  '您的任务：',
  '风险点：',
  '作业位置：',
  '工单编号',
  '工单',
  'GZ',
  ...['A', 'B', 'C'].map((role) => `${role}员工您有新工单。`),
  ...Array.from({ length: 4 }, (_, n) => `${n + 1}号光伏组件`),
  ...[19, 20, 22, 34, 45, 22.5].map((angle) => `您有新的工单，请将光伏组件倾角调整至 ${angle}°。`)
]

export const phraseSources = [
  'src/main/server/work-orders.ts',
  'src/shared/tilt-adjustment.ts',
  'src/shared/agrivoltaic-analysis.ts',
  'src/shared/task-evidence.ts',
  'src/renderer/src/features/pad/useTaskSpeech.ts',
  'src/renderer/src/features/monitor/alerts/riskDetection.ts'
]
