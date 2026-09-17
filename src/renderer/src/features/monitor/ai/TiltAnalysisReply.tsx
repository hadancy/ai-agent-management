import { useEffect, useRef, useState } from 'react'
import {
  ANALYSIS_WAIT_MS,
  ANALYSIS_LINE_MS,
  ANALYSIS_CHARACTER_MS,
  getAnalysisLines,
  getResultSegments,
  HEIGHT_RESULT,
  COMPARISON_HEADERS,
  COMPARISON_ROWS,
  OVERVIEW_CONCLUSION,
  SEASONAL_RESULT,
  type AnalysisRound
} from '../../../../../shared/agrivoltaic-analysis'

export default function TiltAnalysisReply({
  round,
  running,
  active,
  onComplete,
  onProgress
}: {
  round: AnalysisRound
  running: boolean
  active: boolean
  onComplete: () => void
  onProgress: () => void
}): React.JSX.Element {
  const lines = getAnalysisLines(round)
  const resultStart = ANALYSIS_WAIT_MS + lines.length * ANALYSIS_LINE_MS
  const totalCharacters = getResultSegments(round).join('').length
  const duration = resultStart + totalCharacters * ANALYSIS_CHARACTER_MS
  const [elapsed, setElapsed] = useState(running ? 0 : duration)
  const elapsedRef = useRef(0)
  const completed = useRef(false)
  const callbacks = useRef({ onComplete, onProgress })
  useEffect(() => {
    callbacks.current = { onComplete, onProgress }
  }, [onComplete, onProgress])
  useEffect(() => {
    if (!running || !active || completed.current) return
    const started = performance.now() - elapsedRef.current
    const timer = window.setInterval(() => {
      const next = Math.min(performance.now() - started, duration)
      elapsedRef.current = next
      setElapsed(next)
      if (next >= duration) {
        window.clearInterval(timer)
        completed.current = true
        callbacks.current.onComplete()
      }
    }, 50)
    return () => window.clearInterval(timer)
  }, [running, active, duration])
  useEffect(() => {
    callbacks.current.onProgress()
  }, [elapsed])

  const current = running ? elapsed : duration
  const thinkingCount =
    current < ANALYSIS_WAIT_MS
      ? 0
      : Math.min(lines.length, 1 + Math.floor((current - ANALYSIS_WAIT_MS) / ANALYSIS_LINE_MS))
  const budget = Math.max(0, Math.floor((current - resultStart) / ANALYSIS_CHARACTER_MS))
  let offset = 0
  const reveal = (text: string): string => {
    const visible = text.slice(0, Math.max(0, budget - offset))
    offset += text.length
    return visible
  }
  const height = round === 'overview' ? HEIGHT_RESULT.map(reveal) : []
  const headers = round === 'overview' ? COMPARISON_HEADERS.map(reveal) : []
  const rows = round === 'overview' ? COMPARISON_ROWS.map((row) => row.map(reveal)) : []
  const conclusion = round === 'overview' ? reveal(OVERVIEW_CONCLUSION) : ''
  const seasons = round === 'seasonal' ? SEASONAL_RESULT.map(reveal) : []

  return (
    <div className="tilt-analysis" aria-busy={running}>
      {thinkingCount === 0 ? (
        <div className="tilt-thinking-wait" role="status">
          <span />
          正在思考，请稍候…
        </div>
      ) : (
        <details className="tilt-thinking" open={running}>
          <summary>
            分析过程 <span>{current < resultStart ? '正在分析…' : '分析完成'}</span>
          </summary>
          <div>
            {lines.slice(0, thinkingCount).map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
        </details>
      )}
      {budget > 0 && (
        <div className={`tilt-analysis-result${running ? ' tilt-analysis-result--streaming' : ''}`}>
          {round === 'overview' ? (
            <>
              {height.map(
                (line, index) =>
                  line &&
                  (index === 0 || index === 7 ? (
                    <h4 key={index}>{line}</h4>
                  ) : (
                    <p key={index} className={index === 4 ? 'tilt-height-formula' : undefined}>
                      {line}
                    </p>
                  ))
              )}
              {headers[0] && (
                <div
                  className="tilt-comparison-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="三类倾角调节技术方案对比表"
                >
                  <table className="tilt-comparison-table">
                    <thead>
                      <tr>
                        {headers.map((heading, index) => (
                          <th scope="col" key={index}>
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows
                        .filter((row) => row.some(Boolean))
                        .map((row, index) => (
                          <tr key={index}>
                            {row.map((cell, column) =>
                              column === 0 ? (
                                <th scope="row" key={column}>
                                  {cell}
                                </th>
                              ) : (
                                <td key={column}>{cell}</td>
                              )
                            )}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              {conclusion && <p className="tilt-key-conclusion">{conclusion}</p>}
            </>
          ) : (
            <div className="tilt-seasonal-results">
              {seasons.map(
                (line, index) =>
                  line && (index === 0 ? <h4 key={index}>{line}</h4> : <p key={index}>{line}</p>)
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
