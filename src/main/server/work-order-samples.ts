import type { WorkOrder, WorkOrderTask, WorkOrderTaskResult } from '../../shared/contracts'

const SAMPLES = [
  {
    id: 'builtin-work-order-3',
    day: '29',
    priority: 'normal',
    closed: false,
    faultType: '绝缘阻抗低',
    stringNumber: 2,
    componentName: '直流绝缘回路',
    alarm: { voltage: 210, current: 19 },
    handlingSuggestion: '检查直流回路绝缘状态，定位绝缘薄弱点，处理后复测确认。',
    taskTitle: '绝缘回路检查与处理',
    taskDescription: '检查直流线缆和连接部位的绝缘状态，记录异常位置及处理后的绝缘复测结果。',
    risks: ['绝缘破损触电', '误碰带电部位'],
    treatmentSummary: '已处理绝缘薄弱点，绝缘阻抗复测合格，告警解除。'
  },
  {
    id: 'builtin-work-order-2',
    day: '28',
    priority: 'normal',
    closed: false,
    faultType: '逆变器输出功率异常',
    stringNumber: 3,
    componentName: '并网逆变器',
    alarm: { voltage: 210, current: 7 },
    handlingSuggestion: '检查逆变器运行记录与并网参数，排查输出功率异常原因并复测。',
    taskTitle: '逆变器输出检查与处理',
    taskDescription: '核对逆变器运行记录、输入输出数据及并网状态，记录异常原因和复测结果。',
    risks: ['设备意外启动', '误碰带电部位'],
    treatmentSummary: '已排查逆变器输出异常，输出功率恢复稳定，复测通过。'
  },
  {
    id: 'builtin-work-order-5',
    day: '31',
    priority: 'urgent',
    closed: true,
    faultType: '组串电流归零',
    stringNumber: 4,
    componentName: '组串输出回路',
    alarm: { voltage: 210, current: 0 },
    handlingSuggestion: '检查组串输出回路及连接状态，定位电流归零原因，处理后确认输出恢复。',
    taskTitle: '组串回路检查与恢复',
    taskDescription: '检查组串连接与回路状态，核对采集电流，记录异常原因及恢复后的复测数据。',
    risks: ['直流回路触电', '误碰带电部位'],
    treatmentSummary: '组串回路已恢复，输出电流复测正常。'
  },
  {
    id: 'builtin-work-order-4',
    day: '30',
    priority: 'urgent',
    closed: true,
    faultType: '通信中断',
    stringNumber: 3,
    componentName: '通信采集模块',
    alarm: { voltage: 210, current: 19 },
    handlingSuggestion: '检查采集模块供电、通信连接及配置，恢复通信后确认数据持续更新。',
    taskTitle: '通信链路检查与恢复',
    taskDescription: '核对采集模块连接、通信配置和设备在线状态，定位中断原因并记录恢复结果。',
    risks: ['误断设备连接', '配置错误影响采集'],
    treatmentSummary: '通信链路已恢复，采集数据持续更新。'
  }
] as const

// 固定历史日期，避免样例时间随重启变化；编号由数据库分配，兼容已有工单。
export function createBuiltInWorkOrders(
  nextOrderNumber: (datePart: string) => string
): WorkOrder[] {
  return SAMPLES.map((sample) => {
    const id = sample.id
    const at = (time: string): string => `2026-08-${sample.day}T${time}:00.000Z`
    const createdAt = at('01:00')
    const reviewedAt = sample.closed ? at('01:05') : null
    const submittedAt = sample.closed ? at('01:45') : null
    const closedAt = sample.closed ? at('01:46') : null
    const updatedAt = closedAt ?? createdAt
    const componentName = sample.componentName
    const stringName = `${sample.stringNumber}号光伏组串`
    const results: Record<WorkOrderTask['role'], WorkOrderTaskResult> = {
      A: {
        role: 'A',
        monitoringCompleted: true,
        unresolvedHazards: false,
        notes: '现场作业已完成，无遗留安全隐患。'
      },
      B: {
        role: 'B',
        isolationConfirmed: true,
        voltageTestPassed: true,
        safetyMeasuresConfirmed: true,
        restorationConfirmed: true,
        powerRestored: true,
        checkpointNotes: '已完成组串隔离、验电并设置安全围栏。',
        restorationNotes: '已恢复连接和送电，现场检查正常。'
      },
      C: {
        role: 'C',
        faultConfirmed: true,
        retestPassed: true,
        treatmentSummary: sample.treatmentSummary
      }
    }
    const templates = [
      {
        role: 'A',
        title: '安全监护',
        description: '全程安全监护，监督作业安全，发现违章立即制止。',
        risks: ['监护失效', '应急响应不到位']
      },
      {
        role: 'B',
        title: '隔离、验电与恢复确认',
        description: `作业前隔离${stringName}并完成验电和安全措施，作业后确认恢复连接和送电。`,
        risks: ['直流高压触电', '带负荷拉闸产生电弧']
      },
      {
        role: 'C',
        title: sample.taskTitle,
        description: sample.taskDescription,
        risks: [...sample.risks]
      }
    ] satisfies Pick<WorkOrderTask, 'role' | 'title' | 'description' | 'risks'>[]

    return {
      id,
      orderNumber: nextOrderNumber(`202608${sample.day}`),
      stationName: '光明村光伏电站',
      deviceId: `pv-${sample.stringNumber}`,
      stringName,
      componentName,
      faultType: sample.faultType,
      priority: sample.priority,
      handlingSuggestion: sample.handlingSuggestion,
      alarm: sample.alarm,
      normalRange: {
        normalVoltage: 210,
        normalCurrent: 19,
        tolerancePercent: 10,
        voltageMin: 189,
        voltageMax: 231,
        currentMin: 17.1,
        currentMax: 20.9
      },
      status: sample.closed ? 'closed' : 'pending_review',
      reviewedBy: sample.closed ? '运维管理员（示例）' : null,
      createdAt,
      updatedAt,
      reviewedAt,
      dispatchedAt: reviewedAt,
      verifyingAt: submittedAt,
      closedAt,
      plcVerification: {
        requiredConsecutiveSamples: 5,
        consecutiveNormalSamples: sample.closed ? 5 : 0,
        lastCheckedAt: closedAt,
        lastVoltage: sample.closed ? 210 : null,
        lastCurrent: sample.closed ? 19 : null,
        lastSampleNormal: sample.closed ? true : null
      },
      tasks: templates.map((template) => ({
        ...template,
        id: `${id}-${template.role}`,
        workOrderId: id,
        assigneeName: `${template.role}员工`,
        status: sample.closed ? 'submitted' : 'pending',
        result: sample.closed ? results[template.role] : null,
        startedAt: sample.closed
          ? at(template.role === 'A' ? '01:10' : template.role === 'B' ? '01:15' : '01:25')
          : null,
        checkpointAt: sample.closed && template.role === 'B' ? at('01:20') : null,
        submittedAt: sample.closed
          ? at(template.role === 'C' ? '01:35' : template.role === 'B' ? '01:40' : '01:45')
          : null,
        updatedAt,
        allowedActions: [],
        blockedReason: sample.closed ? '工单已关闭' : '工单尚未审核下达'
      }))
    }
  })
}
