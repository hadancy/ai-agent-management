import { useEffect, useMemo, useRef, useState } from 'react'
import PadTaskCard from './features/pad/PadTaskCard'
import './features/pad/pad.css'
import {
  postTaskAction,
  type PadRole,
  type PadTask,
  type TaskAction
} from './features/pad/taskClient'
import { usePadTasks } from './features/pad/usePadTasks'
import { useTaskSpeech } from './features/pad/useTaskSpeech'
import { useRealtime } from './realtime'

const ROLE_STORAGE_KEY = 'platform-c.bound-role'

const roles: Record<
  PadRole,
  { name: string; duty: string; description: string; shortDuty: string }
> = {
  A: {
    name: 'A员工',
    duty: '安全监护',
    shortDuty: '安全监护',
    description: '全程监护作业安全，发现违章立即制止，完成后提交监护结果。'
  },
  B: {
    name: 'B员工',
    duty: '工作负责人',
    shortDuty: '隔离与验电',
    description: '作业前负责隔离与验电，C 员工处理后负责恢复连接和送电。'
  },
  C: {
    name: 'C员工',
    duty: '检测与处理',
    shortDuty: '热斑检测与处理',
    description: '使用红外热像仪确认热斑，完成清理或更换，并回填复测结果。'
  }
}

type TaskTab = PadTask['status']

function isRole(value: string | null): value is PadRole {
  return value === 'A' || value === 'B' || value === 'C'
}

function readInitialRole(): PadRole | null {
  const queryRole = new URLSearchParams(window.location.search).get('role')?.toUpperCase() ?? null
  if (isRole(queryRole)) return queryRole
  try {
    const storedRole = window.localStorage.getItem(ROLE_STORAGE_KEY)
    return isRole(storedRole) ? storedRole : null
  } catch {
    return null
  }
}

function saveBoundRole(role: PadRole): void {
  try {
    window.localStorage.setItem(ROLE_STORAGE_KEY, role)
  } catch {
    // The role remains bound for the current session when local storage is unavailable.
  }
  const url = new URL(window.location.href)
  url.searchParams.set('role', role)
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function clearBoundRole(): void {
  try {
    window.localStorage.removeItem(ROLE_STORAGE_KEY)
  } catch {
    // The current session can still return to role selection.
  }
  const url = new URL(window.location.href)
  url.searchParams.delete('role')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function formatSyncTime(value: Date | null): string {
  if (!value) return '尚未同步'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(value)
}

function RoleBinding({ onBind }: { onBind: (role: PadRole) => void }): React.JSX.Element {
  return (
    <main className="pad-binding-page">
      <section className="pad-binding-card" aria-labelledby="pad-binding-title">
        <div className="pad-binding-mark" aria-hidden="true">
          C
        </div>
        <span className="pad-binding-eyebrow">平台 C · 现场任务终端</span>
        <h1 id="pad-binding-title">请绑定本台 Pad 的使用人员</h1>
        <p className="pad-binding-intro">
          每台 Pad 只接收一位操作人员的任务。选择后将保存在本机，下次打开无需重新选择。
        </p>

        <div className="pad-role-options">
          {(Object.keys(roles) as PadRole[]).map((role) => (
            <button key={role} type="button" onClick={() => onBind(role)}>
              <span className={`pad-role-avatar pad-role-avatar--${role.toLowerCase()}`}>
                {role}
              </span>
              <span className="pad-role-option-copy">
                <strong>
                  {roles[role].name} · {roles[role].shortDuty}
                </strong>
                <small>{roles[role].description}</small>
              </span>
              <span className="pad-role-arrow" aria-hidden="true">
                →
              </span>
            </button>
          ))}
        </div>

        <div className="pad-binding-tip">
          <span aria-hidden="true">i</span>
          <p>
            也可由管理员使用 <code>/c?role=A</code>、<code>/c?role=B</code> 或{' '}
            <code>/c?role=C</code> 直接绑定身份。
          </p>
        </div>
      </section>
    </main>
  )
}

function EmptyTaskState({ tab }: { tab: TaskTab }): React.JSX.Element {
  const copy: Record<TaskTab, { title: string; message: string }> = {
    pending: {
      title: '暂无待办任务',
      message: '平台 B 审核并下达工单后，个人任务将自动出现在这里。'
    },
    in_progress: {
      title: '暂无处理中任务',
      message: '待办任务开始后，可在此回填检查点和现场处理结果。'
    },
    completed: {
      title: '暂无已完成任务',
      message: '提交成功的任务将保留在这里，便于现场人员核对。'
    }
  }

  return (
    <div className="pad-empty-state">
      <div aria-hidden="true">✓</div>
      <h2>{copy[tab].title}</h2>
      <p>{copy[tab].message}</p>
    </div>
  )
}

export default function PadApp(): React.JSX.Element {
  const [role, setRole] = useState<PadRole | null>(readInitialRole)
  const [activeTab, setActiveTab] = useState<TaskTab>('pending')
  const [busyTask, setBusyTask] = useState<{ taskId: string; action: TaskAction } | null>(null)
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [successMessage, setSuccessMessage] = useState('')
  const successTimerRef = useRef<number | null>(null)
  const { connectionState, serviceOrigin, workOrderRevision } = useRealtime()
  const { tasks, initialLoading, refreshing, error, lastUpdatedAt, reload } = usePadTasks({
    role,
    serviceOrigin,
    connectionState,
    workOrderRevision
  })
  const speech = useTaskSpeech(role, tasks, serviceOrigin)

  const counts = useMemo(
    () => ({
      pending: tasks.filter((task) => task.status === 'pending').length,
      in_progress: tasks.filter((task) => task.status === 'in_progress').length,
      completed: tasks.filter((task) => task.status === 'completed').length
    }),
    [tasks]
  )
  const visibleTasks = useMemo(
    () => tasks.filter((task) => task.status === activeTab),
    [activeTab, tasks]
  )

  useEffect(
    () => () => {
      if (successTimerRef.current !== null) window.clearTimeout(successTimerRef.current)
    },
    []
  )

  useEffect(() => {
    if (!role) return
    try {
      window.localStorage.setItem(ROLE_STORAGE_KEY, role)
    } catch {
      // URL role binding remains valid for the current session.
    }
  }, [role])

  const bindRole = (nextRole: PadRole): void => {
    saveBoundRole(nextRole)
    setRole(nextRole)
    setActiveTab('pending')
    setActionErrors({})
  }

  const chooseAnotherRole = (): void => {
    clearBoundRole()
    setRole(null)
    setActionErrors({})
    setSuccessMessage('')
  }

  const showSuccess = (message: string): void => {
    if (successTimerRef.current !== null) window.clearTimeout(successTimerRef.current)
    setSuccessMessage(message)
    successTimerRef.current = window.setTimeout(() => setSuccessMessage(''), 4200)
  }

  const performAction = async (
    task: PadTask,
    action: TaskAction,
    body: Record<string, unknown> = {}
  ): Promise<void> => {
    if (busyTask) return
    setBusyTask({ taskId: task.id, action })
    setActionErrors((current) => {
      const next = { ...current }
      delete next[task.id]
      return next
    })
    try {
      await postTaskAction(serviceOrigin, task.id, action, body)
      const message =
        action === 'start'
          ? '任务已开始，请按安全要求执行。'
          : action === 'checkpoint'
            ? '隔离与验电已确认，C 员工将收到处理通知。'
            : '处理结果已回传至平台 B。'
      showSuccess(message)
      await reload()
      if (action === 'start') setActiveTab('in_progress')
      if (action === 'submit') setActiveTab('completed')
    } catch (actionError) {
      setActionErrors((current) => ({
        ...current,
        [task.id]:
          actionError instanceof Error ? actionError.message : '操作失败，请检查网络后重试。'
      }))
    } finally {
      setBusyTask(null)
    }
  }

  if (!role) return <RoleBinding onBind={bindRole} />

  const profile = roles[role]
  const connectionText =
    connectionState === 'connected'
      ? '已连接平台 B'
      : connectionState === 'connecting'
        ? '正在连接平台 B'
        : '与平台 B 连接中断'

  return (
    <div className={`pad-shell pad-shell--role-${role.toLowerCase()}`}>
      <header className="pad-header">
        <div className="pad-header-brand">
          <span className="pad-header-logo" aria-hidden="true">
            C
          </span>
          <div>
            <h1>现场任务终端</h1>
            <p>平台 C · 个人工单处理</p>
          </div>
        </div>
        <div className="pad-header-actions">
          <span className={`connection-pill connection-pill--${connectionState}`}>
            {connectionText}
          </span>
          <button
            type="button"
            className="pad-refresh-button"
            disabled={refreshing}
            onClick={() => void reload()}
          >
            <span className={refreshing ? 'is-spinning' : ''} aria-hidden="true">
              ↻
            </span>
            {refreshing ? '同步中' : '同步任务'}
          </button>
        </div>
      </header>

      <main className="pad-main">
        <section className="pad-identity-card">
          <div className={`pad-role-avatar pad-role-avatar--${role.toLowerCase()}`}>{role}</div>
          <div className="pad-identity-copy">
            <span>本设备已绑定</span>
            <h2>
              {profile.name} · {profile.shortDuty}
            </h2>
            <p>{profile.description}</p>
          </div>
          <div className="pad-identity-tools">
            <small>最近同步：{formatSyncTime(lastUpdatedAt)}</small>
            <button type="button" onClick={chooseAnotherRole}>
              重新绑定人员
            </button>
          </div>
        </section>

        <section className={`pad-voice-card ${speech.enabled ? 'is-enabled' : ''}`}>
          <div className="pad-voice-icon" aria-hidden="true">
            🔊
          </div>
          <div>
            <strong>
              {speech.activated
                ? speech.enabled
                  ? '工单自动播报已开启'
                  : '工单手动播报'
                : '请点击开启或恢复工单播报'}
            </strong>
            <p role="status" aria-live="polite">
              {speech.activated
                ? speech.message
                : '每次打开页面请先点击开启。语音由平台统一生成，完整播完后才记录为已播报。'}
            </p>
          </div>
          <div className="pad-voice-actions">
            {(!speech.enabled ||
              !speech.activated ||
              speech.status === 'blocked' ||
              speech.status === 'error') && (
              <button type="button" className="pad-voice-enable" onClick={speech.enable}>
                {speech.status === 'blocked'
                  ? '点击播放'
                  : speech.status === 'error'
                    ? '重试播报'
                    : speech.enabled
                      ? '点击恢复播报'
                      : '开启语音播报'}
              </button>
            )}
            {speech.activated && (
              <button type="button" className="pad-voice-secondary" onClick={speech.disable}>
                关闭播报
              </button>
            )}
          </div>
        </section>

        {connectionState === 'disconnected' && (
          <div className="pad-offline-banner" role="alert">
            <span aria-hidden="true">!</span>
            <div>
              <strong>当前网络已断开</strong>
              <p>已加载的任务仍可查看；结果无法上传时请保留本页，重连后系统会自动补拉。</p>
            </div>
          </div>
        )}

        {error && (
          <div className="pad-sync-error" role="alert">
            <div>
              <strong>任务同步失败</strong>
              <span>{error}</span>
            </div>
            <button type="button" onClick={() => void reload()}>
              重试
            </button>
          </div>
        )}

        {successMessage && (
          <div className="pad-success-toast" role="status">
            <span aria-hidden="true">✓</span>
            {successMessage}
          </div>
        )}

        <nav className="pad-task-tabs" aria-label="个人任务状态">
          {(
            [
              ['pending', '待办任务'],
              ['in_progress', '处理中'],
              ['completed', '已完成']
            ] as const
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? 'is-active' : ''}
              aria-current={activeTab === tab ? 'page' : undefined}
              onClick={() => setActiveTab(tab)}
            >
              <span>{label}</span>
              <b>{counts[tab]}</b>
            </button>
          ))}
        </nav>

        <section className="pad-task-list" aria-live="polite" aria-busy={initialLoading}>
          {initialLoading ? (
            <div className="pad-task-loading">
              <span />
              <span />
              <span />
              <p>正在同步 {profile.name} 的任务…</p>
            </div>
          ) : visibleTasks.length > 0 ? (
            visibleTasks.map((task) => (
              <PadTaskCard
                key={task.id}
                task={task}
                busyAction={busyTask?.taskId === task.id ? busyTask.action : null}
                actionError={actionErrors[task.id]}
                onAction={performAction}
                onReplay={speech.replay}
              />
            ))
          ) : (
            <EmptyTaskState tab={activeTab} />
          )}
        </section>
      </main>
    </div>
  )
}
