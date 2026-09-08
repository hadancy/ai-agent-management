import type { WorkOrder } from './contracts'

type SortableWorkOrder = Pick<WorkOrder, 'id' | 'status' | 'priority' | 'createdAt' | 'closedAt'>

const PRIORITY_RANK: Record<WorkOrder['priority'], number> = { urgent: 2, normal: 1 }

export function compareWorkOrders(left: SortableWorkOrder, right: SortableWorkOrder): number {
  const leftClosed = left.status === 'closed'
  const rightClosed = right.status === 'closed'
  if (leftClosed !== rightClosed) return leftClosed ? 1 : -1

  if (!leftClosed) {
    const priorityDifference = PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority]
    if (priorityDifference !== 0) return priorityDifference
  }

  const leftTime = leftClosed ? (left.closedAt ?? left.createdAt) : left.createdAt
  const rightTime = rightClosed ? (right.closedAt ?? right.createdAt) : right.createdAt
  return Date.parse(rightTime) - Date.parse(leftTime) || left.id.localeCompare(right.id)
}
