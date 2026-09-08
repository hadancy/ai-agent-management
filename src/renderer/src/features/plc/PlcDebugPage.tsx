import { useEffect, useRef, useState } from 'react'
import {
  PLC_CLOCK_FIELDS,
  PLC_POINTS,
  validatePlcClock,
  type PlcClockValues,
  type PlcConfigResponse,
  type PlcConnection,
  type PlcPointId,
  type PlcReadResponse,
  type PlcWriteRequest,
  type PlcWriteResponse,
  type PlcWriteResult
} from '../../../../shared/plc'
import { plcRequest, plcServiceOrigin } from './api'
import './plc.css'

type ConnectionDraft = Record<keyof PlcConnection, string>
type ClockDraft = Partial<Record<keyof PlcClockValues, string>>
const STORAGE_KEY = 'plc-debug.connection.v1'
const RESULT_LABELS: Record<PlcWriteResult['status'], string> = {
  verified: '回读一致',
  mismatch: '回读不一致',
  unknown: '状态未确认',
  rejected: 'PLC已拒绝',
  not_written: '未写入'
}

function toConnectionDraft(connection: PlcConnection): ConnectionDraft {
  return Object.fromEntries(
    Object.entries(connection).map(([key, value]) => [key, String(value)])
  ) as ConnectionDraft
}

function toClockDraft(clock: PlcClockValues): ClockDraft {
  return Object.fromEntries(PLC_CLOCK_FIELDS.map((field) => [field.id, String(clock[field.id])]))
}

function formatValue(value: number | null | undefined): string {
  if (value === undefined) return '—'
  if (value === null) return '无效 REAL'
  return String(Number(value.toPrecision(8)))
}

function formatClock(clock: PlcClockValues): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)} ${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)} · 星期值 ${clock.weekday}`
}

export default function PlcDebugPage(): React.JSX.Element {
  const [config, setConfig] = useState<PlcConfigResponse>()
  const [target, setTarget] = useState<ConnectionDraft>({
    host: '',
    port: '503',
    unitId: '1',
    registerAddressOffset: '0'
  })
  const [snapshot, setSnapshot] = useState<PlcReadResponse>()
  const [draft, setDraft] = useState<Partial<Record<PlcPointId, string>>>({})
  const [clockDraft, setClockDraft] = useState<ClockDraft>({})
  const [selected, setSelected] = useState<PlcPointId[]>([])
  const [results, setResults] = useState<PlcWriteResult[]>([])
  const [notice, setNotice] = useState<{ kind: 'info' | 'success' | 'error'; text: string }>({
    kind: 'info',
    text: '填写目标地址后，点击「连接并读取」获取真实 PLC 的当前点位。'
  })
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState(false)
  const operation = useRef(false)
  const targetEdited = useRef(false)
  const shareUrl = config?.pageUrl ?? `${plcServiceOrigin()}/plc`

  useEffect(() => {
    document.title = 'PLC 点位调试 · AI智能体辅助管理平台'
    let active = true
    void plcRequest<PlcConfigResponse>('config')
      .then((data) => {
        if (!active) return
        setConfig(data)
        let connection = data.connection
        try {
          const saved = JSON.parse(
            localStorage.getItem(STORAGE_KEY) ?? 'null'
          ) as PlcConnection | null
          if (
            saved &&
            typeof saved.host === 'string' &&
            ['port', 'unitId', 'registerAddressOffset'].every(
              (key) => typeof saved[key] === 'number'
            )
          )
            connection = saved
        } catch {
          /* Local storage may be unavailable in a private browser. */
        }
        if (!targetEdited.current) setTarget(toConnectionDraft(connection))
      })
      .catch((error: Error) => {
        if (active)
          setNotice({
            kind: 'error',
            text: `配置加载失败：${error.message}。可手动填写地址后读取。`
          })
      })
    return () => {
      active = false
    }
  }, [])

  const connection: PlcConnection = {
    host: target.host.trim(),
    port: Number(target.port),
    unitId: Number(target.unitId),
    registerAddressOffset: Number(target.registerAddressOffset)
  }
  const connectionValid =
    connection.host.length > 0 &&
    [
      ['port', 1, 65535],
      ['unitId', 0, 255],
      ['registerAddressOffset', 0, 65232]
    ].every(([key, min, max]) => {
      const value = connection[key as keyof PlcConnection]
      return (
        target[key as keyof PlcConnection].trim() !== '' &&
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= Number(min) &&
        value <= Number(max)
      )
    })
  const validValue = (id: PlcPointId): boolean => {
    const value = draft[id]
    return value !== undefined && value.trim() !== '' && Number.isFinite(Math.fround(Number(value)))
  }
  const parsedClock = Object.fromEntries(
    PLC_CLOCK_FIELDS.map((field) => [
      field.id,
      clockDraft[field.id]?.trim() ? Number(clockDraft[field.id]) : NaN
    ])
  ) as PlcClockValues
  const clockError = validatePlcClock(parsedClock)

  const changeTarget = (key: keyof PlcConnection, value: string): void => {
    targetEdited.current = true
    setTarget((current) => ({ ...current, [key]: value }))
    setSnapshot(undefined)
    setDraft({})
    setClockDraft({})
    setSelected([])
    setResults([])
    setNotice({ kind: 'info', text: '目标参数已改变，请重新连接并读取。' })
  }

  const acceptSnapshot = (data: PlcReadResponse): void => {
    setSnapshot(data)
    setDraft((current) =>
      Object.fromEntries(
        PLC_POINTS.map((point) => [
          point.id,
          current[point.id] ?? (data.values[point.id] === null ? '' : String(data.values[point.id]))
        ])
      )
    )
    setClockDraft((current) => (Object.keys(current).length ? current : toClockDraft(data.clock)))
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data.connection))
    } catch {
      /* Optional persistence. */
    }
  }

  const read = async (): Promise<void> => {
    if (operation.current || !connectionValid) return
    operation.current = true
    setBusy('读取中…')
    try {
      const data = await plcRequest<PlcReadResponse>('read', { connection })
      acceptSnapshot(data)
      setNotice({
        kind: 'success',
        text: `已读取 ${connection.host}:${connection.port} 的全部 17 个点位。待写值中的手动编辑会保留。`
      })
    } catch (error) {
      setSnapshot(undefined)
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : '读取失败' })
    } finally {
      operation.current = false
      setBusy('')
    }
  }

  const write = async (ids: PlcPointId[], includeClock = false): Promise<void> => {
    if (
      operation.current ||
      !snapshot ||
      !connectionValid ||
      ids.some((id) => !validValue(id)) ||
      (includeClock && clockError)
    )
      return
    operation.current = true
    setBusy('写入并回读中…')
    setResults([])
    const body: PlcWriteRequest = {
      connection,
      values: Object.fromEntries(ids.map((id) => [id, Number(draft[id])])),
      ...(includeClock ? { clock: parsedClock } : {})
    }
    try {
      const data = await plcRequest<PlcWriteResponse>('write', body)
      setResults(data.results)
      if (data.snapshot) acceptSnapshot(data.snapshot)
      else setSnapshot(undefined)
      setSelected((current) =>
        current.filter(
          (id) => !data.results.some((item) => item.id === id && item.status === 'verified')
        )
      )
      setNotice({ kind: data.ok ? 'success' : 'error', text: data.message })
    } catch (error) {
      setSnapshot(undefined)
      setNotice({
        kind: 'error',
        text: `${error instanceof Error ? error.message : '网络请求失败'}。若请求已发出，请重新读取确认设备状态后再操作。`
      })
    } finally {
      operation.current = false
      setBusy('')
    }
  }

  const useLocalTime = (): void => {
    const now = new Date()
    setClockDraft(
      toClockDraft({
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds(),
        weekday: now.getDay() + 1
      })
    )
  }

  const copyLink = async (): Promise<void> => {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(shareUrl)
      else {
        // LAN HTTP pages may not expose the secure-context Clipboard API.
        const input = document.createElement('textarea')
        input.value = shareUrl
        input.style.position = 'fixed'
        input.style.opacity = '0'
        document.body.append(input)
        input.select()
        try {
          if (!document.execCommand('copy')) throw new Error('copy unavailable')
        } finally {
          input.remove()
        }
      }
      setCopied(true)
    } catch {
      setCopied(false)
      setNotice({ kind: 'info', text: '浏览器未允许自动复制，请手动复制页面顶部的链接。' })
    }
  }

  return (
    <main className="plc-page">
      <header className="plc-header">
        <div>
          <div className="plc-eyebrow">
            <span className="plc-logo">P</span> 设备工具 <span>/</span> MODBUS TCP
          </div>
          <h1>
            PLC 点位调试 <span className="plc-tag">真实设备</span>
          </h1>
          <p>配置连接、编辑点位、写入后回读核对。</p>
        </div>
        <div className="plc-share">
          <button type="button" onClick={() => void copyLink()}>
            {copied ? '链接已复制' : '复制页面链接 ↗'}
          </button>
          <a href={shareUrl}>{shareUrl}</a>
        </div>
      </header>

      <section className="plc-card plc-connection" aria-label="PLC连接配置">
        <div className="plc-section-heading">
          <div>
            <span className="plc-step">01</span>
            <h2>目标连接</h2>
          </div>
          <span className={`plc-state ${snapshot ? 'plc-state--ready' : ''}`}>
            {busy || (snapshot ? '最近读取成功' : '尚未读取')}
          </span>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void read()
          }}
        >
          <fieldset disabled={Boolean(busy)} className="plc-connection-fields">
            <label className="plc-host">
              PLC IP 地址
              <input
                aria-label="PLC IP 地址"
                placeholder="192.168.0.1"
                value={target.host}
                onChange={(event) => changeTarget('host', event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              TCP 端口
              <input
                aria-label="TCP 端口"
                type="number"
                min="1"
                max="65535"
                value={target.port}
                onChange={(event) => changeTarget('port', event.target.value)}
              />
            </label>
            <label>
              Unit ID
              <input
                aria-label="Unit ID"
                type="number"
                min="0"
                max="255"
                value={target.unitId}
                onChange={(event) => changeTarget('unitId', event.target.value)}
              />
            </label>
            <label>
              寄存器偏移
              <input
                aria-label="寄存器偏移"
                type="number"
                min="0"
                max="65232"
                value={target.registerAddressOffset}
                onChange={(event) => changeTarget('registerAddressOffset', event.target.value)}
              />
            </label>
            <button className="plc-primary" type="submit" disabled={!connectionValid}>
              {busy || (snapshot ? '重新读取点位' : '连接并读取')} <span>↻</span>
            </button>
          </fieldset>
        </form>
        <p className="plc-connection-note">
          此地址是调试写入目标。主监控采集：
          {config
            ? config.collectorMode === 'simulation'
              ? '模拟模式'
              : `${config.connection.host}:${config.connection.port} · Unit ${config.connection.unitId}`
            : '配置加载中…'}
          ；修改此处不会切换主监控采集配置。
        </p>
      </section>

      <div className={`plc-notice plc-notice--${notice.kind}`} role="status" aria-live="polite">
        <span>{notice.kind === 'success' ? '✓' : notice.kind === 'error' ? '!' : 'i'}</span>
        {notice.text}
      </div>

      <section className="plc-card" aria-label="电压电流点位">
        <div className="plc-section-heading">
          <div>
            <span className="plc-step">02</span>
            <h2>电压与电流</h2>
            <span className="plc-count">10 个点位</span>
          </div>
          <div className="plc-batch">
            <span>已选 {selected.length} 项</span>
            <button
              className="plc-primary"
              type="button"
              disabled={
                Boolean(busy) ||
                !snapshot ||
                !selected.length ||
                selected.some((id) => !validValue(id))
              }
              onClick={() => void write(selected)}
            >
              写入已选点位
            </button>
          </div>
        </div>
        <div className="plc-table-scroll">
          <table className="plc-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="选择全部电压电流点位"
                    disabled={Boolean(busy) || !snapshot}
                    checked={selected.length === PLC_POINTS.length}
                    onChange={(event) =>
                      setSelected(event.target.checked ? PLC_POINTS.map((point) => point.id) : [])
                    }
                  />
                </th>
                <th>点位名称</th>
                <th>PLC / 寄存器地址</th>
                <th>当前读取值</th>
                <th>待写入值</th>
                <th>上次写入结果</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {PLC_POINTS.map((point, index) => {
                const result = results.find((item) => item.id === point.id)
                const register = point.register + connection.registerAddressOffset
                return (
                  <tr key={point.id} className={index % 2 === 0 ? 'plc-group-start' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择${point.label}`}
                        disabled={Boolean(busy) || !snapshot}
                        checked={selected.includes(point.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, point.id]
                              : current.filter((id) => id !== point.id)
                          )
                        }
                      />
                    </td>
                    <td>
                      <strong>{point.label}</strong>
                      <span className="plc-type">REAL · 32 位浮点</span>
                    </td>
                    <td>
                      <code>{point.address}</code>
                      <span className="plc-type">
                        HR{register}–{register + 1}
                      </span>
                    </td>
                    <td className="plc-current" title={String(snapshot?.values[point.id] ?? '')}>
                      {formatValue(snapshot?.values[point.id])} <small>{point.unit}</small>
                    </td>
                    <td>
                      <div className="plc-value-input">
                        <input
                          type="number"
                          step="any"
                          aria-label={`${point.label}待写入值`}
                          placeholder="输入数值"
                          disabled={Boolean(busy) || !snapshot}
                          value={draft[point.id] ?? ''}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, [point.id]: event.target.value }))
                          }
                        />
                        <span>{point.unit}</span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`plc-result ${result ? `plc-result--${result.status}` : ''}`}
                        title={result?.message}
                      >
                        {result ? RESULT_LABELS[result.status] : '—'}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="plc-write-one"
                        disabled={Boolean(busy) || !snapshot || !validValue(point.id)}
                        onClick={() => void write([point.id])}
                      >
                        写入
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="plc-table-footer">
          <span>仅提交单点或已勾选点位；批量操作逐项执行，遇到异常后停止后续写入。</span>
          <span>
            {snapshot
              ? `读取于 ${new Date(snapshot.readAt).toLocaleTimeString('zh-CN', { hour12: false })}`
              : '等待设备数据'}
          </span>
        </div>
      </section>

      <section className="plc-card plc-clock" aria-label="PLC时钟点位">
        <div className="plc-section-heading">
          <div>
            <span className="plc-step">03</span>
            <h2>PLC 时钟</h2>
            <span className="plc-count">7 个点位</span>
          </div>
          <span className="plc-clock-current">
            {snapshot ? formatClock(snapshot.clock) : '当前时间：—'}
          </span>
        </div>
        <fieldset className="plc-clock-fields" disabled={Boolean(busy) || !snapshot}>
          {PLC_CLOCK_FIELDS.map((field) => (
            <label key={field.id}>
              {field.label}
              <input
                type="number"
                min={field.min}
                max={field.max}
                step="1"
                aria-label={`PLC时钟${field.label}`}
                value={clockDraft[field.id] ?? ''}
                onChange={(event) =>
                  setClockDraft((current) => ({ ...current, [field.id]: event.target.value }))
                }
              />
              <code>{field.address}</code>
            </label>
          ))}
        </fieldset>
        <div className="plc-clock-actions">
          <p>
            年为 UInt，其余为 USInt；星期 1=周日、7=周六。整组写入 HR
            {300 + connection.registerAddressOffset}–HR{303 + connection.registerAddressOffset}。
          </p>
          <div>
            <button type="button" disabled={Boolean(busy) || !snapshot} onClick={useLocalTime}>
              填入本机时间
            </button>
            <button
              type="button"
              className="plc-primary"
              disabled={Boolean(busy) || !snapshot || Boolean(clockError)}
              onClick={() => void write([], true)}
            >
              写入 PLC 时钟
            </button>
          </div>
        </div>
        {snapshot && clockError && <p className="plc-field-error">{clockError}</p>}
      </section>

      {results.length > 0 && (
        <section className="plc-card plc-operation-results" aria-label="本次写入明细">
          <div className="plc-section-heading">
            <div>
              <h2>本次写入明细</h2>
              <span className="plc-count">
                {connection.host}:{connection.port}
              </span>
            </div>
          </div>
          <ul>
            {results.map((result) => (
              <li key={result.id}>
                <span className={`plc-result plc-result--${result.status}`}>
                  {RESULT_LABELS[result.status]}
                </span>
                <div>
                  <strong>
                    {result.id === 'clock'
                      ? 'PLC 时钟'
                      : PLC_POINTS.find((point) => point.id === result.id)?.label}
                  </strong>
                  <p>
                    提交：
                    {typeof result.requested === 'number'
                      ? result.requested
                      : formatClock(result.requested)}
                    {result.actual !== undefined &&
                      ` · 回读：${typeof result.actual === 'object' && result.actual !== null ? formatClock(result.actual) : formatValue(result.actual)}`}
                  </p>
                  <p>{result.message}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <footer className="plc-page-footer">
        AI 智能体辅助管理平台 <span>页面通过运行平台的电脑连接 PLC · 写入后请以设备回读为准</span>
      </footer>
    </main>
  )
}
