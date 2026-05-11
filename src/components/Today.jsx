import { useEffect, useState, useCallback } from 'react'
import { quizDateForNow, applyCompletion, effectiveStreak } from '../lib/dates.js'
import { selectDailyTopics, applyQuizResults } from '../lib/selection.js'
import { generateQuestions, gradeShortAnswer } from '../lib/anthropic.js'

export default function Today({ adapter, session }) {
  const [phase, setPhase] = useState('loading')  // loading | needs_key | empty | ready | generating | active | done | error
  const [generatingProgress, setGeneratingProgress] = useState(0)
  const [generatingTotal, setGeneratingTotal] = useState(10)
  const [error, setError] = useState(null)
  const [todayKey] = useState(() => quizDateForNow())
  const [quiz, setQuiz] = useState(null)
  const [topics, setTopics] = useState([])
  const [settings, setSettings] = useState({})
  const [responses, setResponses] = useState({})  // { idx: { selected, correct, explanation } }
  const [currentIdx, setCurrentIdx] = useState(0)
  const [grading, setGrading] = useState(false)
  const [warnings, setWarnings] = useState([])

  const loadOrInit = useCallback(async () => {
    setPhase('loading')
    setError(null)
    try {
      const [t, s, existing] = await Promise.all([
        adapter.getTopics(),
        adapter.getSettings(),
        adapter.getQuizByDate(todayKey),
      ])
      setTopics(t)
      setSettings(s)

      if (existing) {
        setQuiz(existing)
        setResponses(existing.responses || {})
        if (existing.completed_at) setPhase('done')
        else {
          // resume
          const firstUnanswered = (existing.questions || []).findIndex(
            (_, i) => !(existing.responses || {})[i]
          )
          setCurrentIdx(firstUnanswered === -1 ? 0 : firstUnanswered)
          setPhase('active')
        }
        return
      }

      // No quiz yet for today. Need API key.
      if (!s.api_key) {
        setPhase('needs_key')
        return
      }
      const active = t.filter(x => x.status !== 'retired')
      if (active.length === 0) {
        setPhase('empty')
        return
      }
      setPhase('ready')
    } catch (e) {
      setError(e.message)
      setPhase('error')
    }
  }, [adapter, todayKey])

  useEffect(() => { loadOrInit() }, [loadOrInit])

  async function startQuiz() {
    setPhase('generating')
    setGeneratingProgress(0)
    setError(null)
    try {
      const quizzes = await adapter.getQuizzes()
      const slotPlan = selectDailyTopics({ topics, quizzes, todayKey })
      setGeneratingTotal(8)
      const generated = await generateQuestions({
        apiKey: settings.api_key,
        slotPlan,
        todayKey,
        onProgress: setGeneratingProgress,
      })
      // Annotate questions with metadata from slotPlan, looked up by topic_id.
      // slotPlan has 5 entries; generated has 10 (2 per topic).
      const slotMeta = Object.fromEntries(slotPlan.map(s => [s.topic.id, s]))
      const questions = generated.map((q, i) => {
        const s = slotMeta[q.topic_id]
        return {
          ...q,
          topic_name: s?.topic.topic ?? q.topic_id,
          slot: s?.slot ?? 'active',
          position: i,
        }
      })
      const newQuiz = {
        id: `${adapter.kind}-${todayKey}-${Date.now()}`,
        date: todayKey,
        questions,
        responses: {},
        score: null,
        completed_at: null,
      }
      await adapter.upsertQuiz(newQuiz)
      setQuiz(newQuiz)
      setResponses({})
      setCurrentIdx(0)
      setPhase('active')
    } catch (e) {
      setError(e.message)
      setPhase('ready')  // let them retry
    }
  }

  async function answerMC(idx, choiceIdx) {
    const q = quiz.questions[idx]
    const correct = choiceIdx === q.correct_index
    const next = {
      ...responses,
      [idx]: {
        type: 'mc',
        selected: choiceIdx,
        correct,
        explanation: q.explanation,
      }
    }
    setResponses(next)
    await adapter.upsertQuiz({ ...quiz, responses: next })
  }

  async function answerSA(idx, text) {
    const q = quiz.questions[idx]
    setGrading(true)
    try {
      const result = await gradeShortAnswer({
        apiKey: settings.api_key,
        question: q,
        userAnswer: text,
      })
      const next = {
        ...responses,
        [idx]: {
          type: 'sa',
          user_text: text,
          correct: !!result.correct,
          explanation: result.explanation,
          reference: q.reference_answer,
        }
      }
      setResponses(next)
      await adapter.upsertQuiz({ ...quiz, responses: next })
    } catch (e) {
      setError(e.message)
    } finally {
      setGrading(false)
    }
  }

  async function finish() {
    const score = quiz.questions.reduce((s, _, i) => s + (responses[i]?.correct ? 1 : 0), 0)
    const completed = {
      ...quiz,
      responses,
      score,
      completed_at: new Date().toISOString(),
    }
    await adapter.upsertQuiz(completed)

    // Mutate topics
    const { topics: newTopics, warnings } = applyQuizResults({
      topics,
      questions: quiz.questions,
      responses,
    })
    await adapter.setTopics(newTopics)
    setTopics(newTopics)
    setWarnings(warnings)

    // Streak
    const newSettings = applyCompletion(settings, todayKey)
    await adapter.setSettings(newSettings)
    setSettings(newSettings)

    setQuiz(completed)
    setPhase('done')
  }

  // === renders ===

  if (phase === 'loading') return <div className="empty"><span className="spinner" />Loading.</div>

  if (phase === 'error') return <ErrorView error={error} onRetry={loadOrInit} />

  if (phase === 'needs_key') return (
    <div className="card">
      <span className="card-deco" /><span className="card-deco-bl" />
      <div className="eyebrow">Setup required</div>
      <h2>Add your Anthropic API key</h2>
      <p style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', lineHeight: 1.5 }}>
        The quiz uses Claude to generate questions and grade short answers.
        Your key is stored {adapter.kind === 'supabase' ? 'in your synced settings' : 'in this browser only'} and sent only to api.anthropic.com.
      </p>
      <div className="btn-row">
        <a href="/settings" className="primary" style={{
          display: 'inline-block', padding: '0.6rem 1.2rem',
          background: 'var(--ink)', color: 'var(--bg)',
          textDecoration: 'none', fontSize: '0.9rem',
          textTransform: 'uppercase', letterSpacing: '0.04em',
          border: '1px solid var(--ink)',
        }}>Open settings</a>
      </div>
    </div>
  )

  if (phase === 'empty') return (
    <div className="card">
      <div className="eyebrow">No topics yet</div>
      <h2>Add your first topic to get started.</h2>
      <p style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem' }}>
        Head to Topics and add something you want to remember — a concept, an argument, a set of facts. Even one topic is enough to begin.
      </p>
      <div className="btn-row">
        <a href="/topics" className="primary" style={{
          display: 'inline-block', padding: '0.6rem 1.2rem',
          background: 'var(--ink)', color: 'var(--bg)',
          textDecoration: 'none', fontSize: '0.9rem',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>Add topics</a>
      </div>
    </div>
  )

  if (phase === 'generating') {
    const streak = effectiveStreak(settings, todayKey)
    const pct = Math.round((generatingProgress / generatingTotal) * 100)
    return (
      <>
        <StatsStrip topics={topics} settings={settings} streak={streak} />
        <div className="card">
          <span className="card-deco" /><span className="card-deco-bl" />
          <div className="eyebrow">{new Date(todayKey + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
          <h2>Generating your quiz…</h2>
          <p className="kicker">
            {generatingProgress > 0
              ? `${generatingProgress} of ${generatingTotal} questions ready`
              : 'Contacting Claude…'}
          </p>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </>
    )
  }

  if (phase === 'ready') {
    const streak = effectiveStreak(settings, todayKey)
    return (
      <>
        <StatsStrip topics={topics} settings={settings} streak={streak} />
        <div className="card">
          <span className="card-deco" /><span className="card-deco-bl" />
          <div className="eyebrow">{new Date(todayKey + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
          <h2>Your quiz awaits.</h2>
          <p className="kicker">8 multiple choice questions, generated fresh from your topic bank.</p>
          {error && <div className="alert">{error}</div>}
          <div className="btn-row">
            <button className="primary" onClick={startQuiz}>Begin</button>
          </div>
        </div>
      </>
    )
  }

  if (phase === 'active') {
    return (
      <ActiveQuiz
        quiz={quiz}
        responses={responses}
        currentIdx={currentIdx}
        setCurrentIdx={setCurrentIdx}
        onAnswerMC={answerMC}
        onAnswerSA={answerSA}
        grading={grading}
        onFinish={finish}
        error={error}
      />
    )
  }

  if (phase === 'done') {
    return <Results quiz={quiz} topics={topics} warnings={warnings} settings={settings} todayKey={todayKey} />
  }

  return null
}

function StatsStrip({ topics, settings, streak }) {
  const active = topics.filter(t => t.status === 'active').length
  const longest = settings.longest_streak || 0
  return (
    <div className="stats-strip">
      <div className="stat">
        <span className="stat-num">{streak}</span>
        <span className="stat-label">Current streak</span>
      </div>
      <div className="stat">
        <span className="stat-num">{longest}</span>
        <span className="stat-label">Longest</span>
      </div>
      <div className="stat">
        <span className="stat-num">{active}</span>
        <span className="stat-label">Active topics</span>
      </div>
    </div>
  )
}

function ErrorView({ error, onRetry }) {
  return (
    <div className="card">
      <div className="eyebrow">Error</div>
      <h2>Something went sideways.</h2>
      <div className="alert">{error}</div>
      <button onClick={onRetry}>Retry</button>
    </div>
  )
}

function ActiveQuiz({ quiz, responses, currentIdx, setCurrentIdx, onAnswerMC, onAnswerSA, grading, onFinish, error }) {
  const q = quiz.questions[currentIdx]
  const r = responses[currentIdx]
  const allAnswered = quiz.questions.every((_, i) => responses[i])

  return (
    <>
      <div className="card">
        <span className="card-deco" /><span className="card-deco-bl" />
        <span className="q-num">Question {currentIdx + 1} of {quiz.questions.length}</span>
        <span className="q-topic">{q.topic_name}</span>
        <div className="q-prompt">{q.prompt}</div>

        {q.q_type === 'mc' && (
          <MCChoices q={q} response={r} onPick={i => onAnswerMC(currentIdx, i)} />
        )}
        {q.q_type === 'sa' && (
          <SAEntry q={q} response={r} grading={grading} onSubmit={text => onAnswerSA(currentIdx, text)} />
        )}

        {r && (
          <div className={`feedback ${r.correct ? 'correct' : 'incorrect'}`}>
            <div className="feedback-label">{r.correct ? 'Correct' : 'Incorrect'}</div>
            {r.explanation}
            {r.type === 'sa' && r.reference && (
              <div style={{ marginTop: '0.7rem', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '0.95rem' }}>
                <strong style={{ fontStyle: 'normal' }}>Reference:</strong> {r.reference}
              </div>
            )}
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(q.prompt)}`}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'block', marginTop: '0.8rem', fontSize: '0.8rem', fontFamily: 'var(--mono)', letterSpacing: '0.08em', textTransform: 'uppercase' }}
            >Search this →</a>
          </div>
        )}

        {error && <div className="alert" style={{ marginTop: '1rem' }}>{error}</div>}

        <div style={{ marginTop: '1.2rem', paddingTop: '1rem', borderTop: '1px solid var(--rule-soft)' }}>
          <a
            href={`https://www.google.com/search?q=${encodeURIComponent(q.topic_name)}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: '0.78rem', fontFamily: 'var(--mono)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}
          >No clue? Search this topic →</a>
        </div>

        <div className="btn-row">
          <button className="ghost" disabled={currentIdx === 0} onClick={() => setCurrentIdx(currentIdx - 1)}>← Previous</button>
          {currentIdx < quiz.questions.length - 1 && (
            <button className={r ? 'primary' : 'ghost'} disabled={!r} onClick={() => setCurrentIdx(currentIdx + 1)}>Next →</button>
          )}
          {currentIdx === quiz.questions.length - 1 && (
            <button className="primary" disabled={!allAnswered} onClick={onFinish}>Finish quiz</button>
          )}
        </div>

        <div style={{ marginTop: '1.2rem', fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--ink-mute)', letterSpacing: '0.1em' }}>
          {quiz.questions.map((_, i) => (
            <span
              key={i}
              onClick={() => setCurrentIdx(i)}
              style={{
                display: 'inline-block', width: 14, height: 14,
                marginRight: 6, cursor: 'pointer',
                border: i === currentIdx ? '1px solid var(--ink)' : '1px solid var(--rule)',
                background: responses[i] ? (responses[i].correct ? 'var(--success)' : 'var(--error)') : 'transparent',
              }}
              title={`Q${i + 1}`}
            />
          ))}
        </div>
      </div>
    </>
  )
}

function MCChoices({ q, response, onPick }) {
  const letters = ['A', 'B', 'C', 'D']
  return (
    <div className="choices">
      {q.choices.map((c, i) => {
        let cls = 'choice'
        if (response) {
          if (i === q.correct_index) cls += ' correct'
          else if (i === response.selected) cls += ' incorrect'
        }
        return (
          <button
            key={i}
            className={cls}
            disabled={!!response}
            onClick={() => onPick(i)}
          >
            <span className="choice-letter">{letters[i]}.</span>
            <span>{c}</span>
          </button>
        )
      })}
    </div>
  )
}

function SAEntry({ q, response, grading, onSubmit }) {
  const [text, setText] = useState(response?.user_text || '')
  if (response) {
    return (
      <div>
        <label>Your answer</label>
        <div style={{
          padding: '0.8rem', border: '1px solid var(--rule)', background: 'var(--bg-card)',
          fontFamily: 'var(--serif)', fontSize: '1.05rem', whiteSpace: 'pre-wrap'
        }}>{response.user_text}</div>
      </div>
    )
  }
  return (
    <div>
      <label>Your answer</label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="A few sentences."
        disabled={grading}
      />
      <div className="btn-row">
        <button className="primary" disabled={!text.trim() || grading} onClick={() => onSubmit(text.trim())}>
          {grading ? <><span className="spinner" />Grading…</> : 'Submit'}
        </button>
      </div>
    </div>
  )
}

function Results({ quiz, topics, warnings, settings, todayKey }) {
  const score = quiz.score ?? 0
  const total = quiz.questions.length
  const pct = Math.round((score / total) * 100)
  const streak = effectiveStreak(settings, todayKey)

  return (
    <>
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="card-deco" /><span className="card-deco-bl" />
        <div className="eyebrow">Today's results · {todayKey}</div>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 'clamp(3rem, 10vw, 5rem)', fontWeight: 600, lineHeight: 1, color: 'var(--ink)' }}>
          {score}<span style={{ color: 'var(--ink-mute)', fontStyle: 'italic' }}> / {total}</span>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem', color: 'var(--ink-mute)', marginTop: '0.6rem', letterSpacing: '0.15em' }}>
          {pct}% · STREAK {streak}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="card">
          <div className="eyebrow">Notice</div>
          {warnings.map((w, i) => <div key={i} className="alert warn">{w}</div>)}
        </div>
      )}

      <div className="card">
        <div className="eyebrow">Question by question</div>
        <div>
          {quiz.questions.map((q, i) => {
            const r = quiz.responses[i]
            return (
              <div key={i} style={{
                padding: '1rem 0',
                borderBottom: '1px solid var(--rule-soft)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                  <span className="q-topic">{q.topic_name}</span>
                  <span style={{
                    fontFamily: 'var(--mono)', fontSize: '0.7rem',
                    color: r?.correct ? 'var(--success)' : 'var(--error)',
                    letterSpacing: '0.15em',
                  }}>{r?.correct ? '✓ CORRECT' : '✗ MISSED'}</span>
                </div>
                <div style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', margin: '0.4rem 0 0.6rem' }}>{q.prompt}</div>
                <div style={{ fontSize: '0.92rem', color: 'var(--ink-soft)' }}>{r?.explanation}</div>
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(q.prompt)}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'inline-block', marginTop: '0.4rem', fontSize: '0.75rem', fontFamily: 'var(--mono)', letterSpacing: '0.08em', textTransform: 'uppercase' }}
                >Search this →</a>
                {r?.type === 'sa' && q.reference_answer && (
                  <div style={{ marginTop: '0.6rem', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '0.95rem', color: 'var(--ink-mute)', borderLeft: '2px solid var(--rule)', paddingLeft: '0.8rem' }}>
                    <strong style={{ fontStyle: 'normal', fontFamily: 'var(--mono)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-mute)' }}>Reference answer: </strong>
                    {q.reference_answer}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
