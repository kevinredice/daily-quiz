import { useEffect, useState } from 'react'

export default function History({ adapter }) {
  const [quizzes, setQuizzes] = useState([])
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([adapter.getQuizzes(), adapter.getTopics()])
      .then(([q, t]) => { setQuizzes(q); setTopics(t); setLoading(false) })
  }, [adapter])

  if (loading) return <div className="empty"><span className="spinner" />Loading.</div>

  const completed = quizzes.filter(q => q.completed_at).sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <div className="card">
        <span className="card-deco" /><span className="card-deco-bl" />
        <div className="eyebrow">Score history</div>
        <h2>Performance over time.</h2>
        {completed.length === 0
          ? <div className="empty">No completed quizzes yet.</div>
          : <ScoreChart quizzes={[...completed].reverse()} />
        }
      </div>

      <div className="card">
        <div className="eyebrow">Per-topic accuracy</div>
        <TopicAccuracy topics={topics} />
      </div>

      <div className="card">
        <div className="eyebrow">All quizzes</div>
        {completed.length === 0
          ? <div className="empty">No quizzes yet.</div>
          : completed.map(q => (
            <div key={q.id} className="history-row">
              <span className="history-date">{q.date}</span>
              <span className="history-score">{q.score} / {q.questions.length}</span>
              <span className="history-pct">{Math.round(100 * q.score / q.questions.length)}%</span>
            </div>
          ))
        }
      </div>
    </>
  )
}

function ScoreChart({ quizzes }) {
  // Simple inline SVG line chart, deco-styled.
  const w = 640, h = 200, pad = 28
  if (quizzes.length === 0) return null
  const xs = quizzes.map((_, i) => pad + (i * (w - 2*pad) / Math.max(1, quizzes.length - 1)))
  const ys = quizzes.map(q => {
    const pct = q.score / q.questions.length
    return h - pad - pct * (h - 2*pad)
  })
  const path = xs.map((x, i) => (i === 0 ? `M${x},${ys[i]}` : `L${x},${ys[i]}`)).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--rule)" strokeWidth="1"/>
        </pattern>
      </defs>
      {/* y gridlines at 0, 50, 100% */}
      {[0, 0.5, 1].map(p => {
        const y = h - pad - p * (h - 2*pad)
        return (
          <g key={p}>
            <line x1={pad} y1={y} x2={w-pad} y2={y} stroke="var(--rule-soft)" strokeDasharray="2,3" />
            <text x={pad - 6} y={y + 4} textAnchor="end" fontFamily="var(--mono)" fontSize="10" fill="var(--ink-mute)">
              {Math.round(p * 100)}
            </text>
          </g>
        )
      })}
      <path d={path} fill="none" stroke="var(--ink)" strokeWidth="1.5" />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r="3" fill="var(--brass)" stroke="var(--ink)" strokeWidth="1" />
      ))}
    </svg>
  )
}

function TopicAccuracy({ topics }) {
  const withData = topics
    .filter(t => (t.correct_count || 0) + (t.incorrect_count || 0) > 0)
    .map(t => {
      const total = t.correct_count + t.incorrect_count
      return { ...t, total, pct: t.correct_count / total }
    })
    .sort((a, b) => a.pct - b.pct)

  if (withData.length === 0) return <div className="empty">No data yet.</div>

  return (
    <div>
      {withData.map(t => (
        <div key={t.id} style={{ padding: '0.7rem 0', borderBottom: '1px solid var(--rule-soft)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem' }}>{t.topic}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: 'var(--ink-mute)' }}>
              {Math.round(t.pct * 100)}% · {t.correct_count}/{t.total}
            </span>
          </div>
          <div style={{ height: 4, background: 'var(--rule-soft)', marginTop: '0.4rem' }}>
            <div style={{
              width: `${t.pct * 100}%`,
              height: '100%',
              background: t.pct >= 0.7 ? 'var(--success)' : t.pct >= 0.4 ? 'var(--brass)' : 'var(--error)',
            }} />
          </div>
        </div>
      ))}
    </div>
  )
}
