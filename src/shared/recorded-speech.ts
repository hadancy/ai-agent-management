export const RECORDED_VOICE = 'Tingting'
export const RECORDED_SPEECH_VERSION = 'tingting-185-v2'
export const RECORDED_SAMPLE_RATE = 24000
export const DIAGNOSIS_SPEECH_TEXT =
  '故障类型：组件热斑。故障位置：光明村光伏电站1号组件。可能原因：局部遮挡、组件内部缺陷、热斑效应。处理建议：隔离该组串，现场确认并更换或清洗组件。工单草稿已生成，等待人工审核下达。'
export const RECORDED_TEST_TEXT = DIAGNOSIS_SPEECH_TEXT

const DIGITS = '零一二三四五六七八九'
function spokenNumber(value: string): string {
  if (value.includes('.')) {
    const [whole, decimal] = value.split('.')
    return `${spokenNumber(whole)}点${[...decimal].map((n) => DIGITS[Number(n)]).join('')}`
  }
  if (value.length > 4 || (value.length > 1 && value.startsWith('0')))
    return [...value].map((n) => DIGITS[Number(n)]).join('')
  const number = Number(value)
  if (!number) return '零'
  let result = ''
  let pendingZero = false
  for (let place = 3; place >= 0; place--) {
    const digit = Math.floor(number / 10 ** place) % 10
    if (digit) {
      if (pendingZero) result += '零'
      result += DIGITS[digit] + ['', '十', '百', '千'][place]
      pendingZero = false
    } else if (result) pendingZero = true
  }
  return result.replace(/^一十/, '十')
}

// Shared by the recording tool and playback lookup: units, dates and identifiers
// have one pronunciation on every platform. No speech engine runs in the app.
export function normalizeRecordedText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(
      /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g,
      (_, year, month, day) =>
        `${[...year].map((n) => DIGITS[Number(n)]).join('')}年${spokenNumber(String(Number(month)))}月${spokenNumber(String(Number(day)))}日`
    )
    .replace(
      /\b([A-Za-z]+)[-_]?(\d[\d_-]*)/g,
      (_, prefix, number) =>
        prefix.toUpperCase() +
        [...number].map((n) => (/\d/.test(n) ? DIGITS[Number(n)] : '杠')).join('')
    )
    .replace(/(\d+(?:\.\d+)?)\s*%/g, (_, number) => `百分之${spokenNumber(number)}`)
    .replace(/℃|°C/g, '摄氏度')
    .replace(/°/g, '度')
    .replace(/(\d)\s*m\/s\b/g, '$1米每秒')
    .replace(/(\d)\s*m\b/g, '$1米')
    .replace(/(\d)\s*V\b/g, '$1伏')
    .replace(/(\d)\s*A\b/g, '$1安')
    .replace(/(\d)-(?=\d)/g, '$1至')
    .replace(/-(?=\d)/g, '负')
    .replace(/[−]/g, '减')
    .replace(/[–~～]/g, '至')
    .replace(/±/g, '正负')
    .replace(/\+/g, '加')
    .replace(/≤/g, '小于等于')
    .replace(/≥/g, '大于等于')
    .replace(/\d+(?:\.\d+)?/g, spokenNumber)
    .replace(/[\r\n]+/g, '。')
    .replace(/\s+/g, '')
    .replace(/[，,]/g, '，')
    .replace(/[:：]/g, '：')
    .replace(/[;；]/g, '；')
    .replace(/[!！]/g, '！')
    .replace(/[?？]/g, '？')
    .replace(/[.。…]+/g, '。')
}
