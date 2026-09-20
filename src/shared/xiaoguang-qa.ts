export const XIAOGUANG_QA = [
  {
    topic: '项目概况',
    question: '小光小光，现在光明村茶园装光伏设备，最急需解决的问题是什么呀？',
    answer:
      '咱们先看下光明村的基本情况：该村以茶树种植为主要经济来源，地处丘陵山地，平地少、山地多。目前推进农光一体化，难题主要集中在安装侧和网荷储运维侧两大块。'
  },
  {
    topic: '安装空间',
    question: '那先说说光伏安装这边有什么问题吧。',
    answer:
      '最核心的矛盾是怎么兼顾茶树种植和光伏发电的空间需求。传统农光一体化都采用高支架安装，高空安装工序多、效率低、风险高；要是支架高度、光伏板倾斜角度选得不合理，还会挤占茶树的生长空间，影响茶叶正常种植。'
  },
  {
    topic: '成本维护',
    question: '那安装侧还有别的难点吗？',
    answer:
      '还有成本和后期维护的现实问题。如果加装电动逐日设备来追光提效，前期资金投入很高；而且村里缺乏对应的专业维护技术，设备后续出了故障很难及时检修。'
  },
  {
    topic: '并网消纳',
    question: '那电网和用电这边呢，又有什么问题？',
    answer:
      '首先是并网损耗和绿电消纳的问题。传统交流并网需要经过两次电能变换，本身损耗就高；再加上乡村电网稳定性差、波动大，发出来的绿电就地消纳能力不足，利用率上不去。'
  },
  {
    topic: '巡检运维',
    question: '日常巡检和运维的情况怎么样呀？',
    answer:
      '运维这块的短板也很明显。现在用的巡检无人机普遍续航不足，缺陷识别的效果也不理想；而且很多茶农看不懂专业用电数据，故障排查大多靠人工巡检，整体处置效率很有限。'
  }
] as const

// Punctuation and spacing may change when the student edits the filled question.
export function findXiaoguangQuestion(request: string): number {
  const normalize = (text: string): string => text.normalize('NFKC').replace(/[\p{P}\s]/gu, '')
  return XIAOGUANG_QA.findIndex((item) => normalize(item.question) === normalize(request))
}
