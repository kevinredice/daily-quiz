import { useEffect, useState } from 'react'
import { proposeNewTopics } from '../lib/anthropic.js'
import { daysBetween, quizDateForNow } from '../lib/dates.js'

export default function Review({ adapter }) {
  const [topics, setTopics] = useState([])
  const [settings, setSettings] = useState({})
  const [pasted, setPasted] = useState('')
  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState({})  // { idx: { topic, context, tags, id } }

  useEffect(() => {
    Promise.all([adapter.getTopics(), adapter.getSettings()]).then(([t, s]) => {
      setTopics(t)
      setSettings(s)
    })
  }, [adapter])

  const todayKey = quizDateForNow()
  const surfaced = surfaceForReview(topics, todayKey)

  async function generate() {
    if (!settings.api_key) { setError('Add an Anthropic API key in Settings first.'); return }
    if (!pasted.trim()) { setError('Paste some content first.'); return }
    setError(null)
    setLoading(true)
    try {
      const ps = await proposeNewTopics({
        apiKey: settings.api_key,
        pastedContent: pasted,
        existingTopicNames: topics.map(t => t.topic),
      })
      setProposals(ps)
      const initEdits = {}
      ps.forEach((p, i) => initEdits[i] = { ...p })
      setEditing(initEdits)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function approve(idx) {
    const p = editing[idx]
    if (!p?.id || !p?.topic || !p?.context) {
      setError('Need id, topic, and context.')
      return
    }
    if (topics.find(t => t.id === p.id)) {
      setError(`ID "${p.id}" already exists in your bank.`)
      return
    }
    await adapter.upsertTopic({
      id: p.id,
      topic: p.topic,
      context: p.context,
      tags: p.tags || [],
      status: 'active',
      times_quizzed: 0,
      correct_count: 0,
      incorrect_count: 0,
      recent_results: [],
      created_at: new Date().toISOString(),
      last_quizzed_at: null,
      dormant_since: null,
    })
    const newTopics = await adapter.getTopics()
    setTopics(newTopics)
    setProposals(proposals.filter((_, i) => i !== idx))
    const newEditing = { ...editing }
    delete newEditing[idx]
    setEditing(newEditing)
  }

  function reject(idx) {
    setProposals(proposals.filter((_, i) => i !== idx))
    const newEditing = { ...editing }
    delete newEditing[idx]
    setEditing(newEditing)
  }

  function updateProposal(idx, field, value) {
    setEditing({ ...editing, [idx]: { ...editing[idx], [field]: value } })
  }

  return (
    <>
      <div className="card">
        <span className="card-deco" /><span className="card-deco-bl" />
        <div className="eyebrow">Weekly review</div>
        <p className="kicker">Skipping the review doesn't break anything. But spending five minutes here once a week is what keeps the bank alive.</p>
      </div>

      {surfaced.lowestAccuracy.length > 0 && (
        <div className="card">
          <div className="eyebrow">Weak spots</div>
          {surfaced.lowestAccuracy.map(t => (
            <div key={t.id} className="topic-row">
              <div>
                <div className="topic-name">{t.topic}</div>
                <div className="topic-meta">{Math.round((t.correct_count / (t.correct_count + t.incorrect_count)) * 100)}% accuracy across {t.correct_count + t.incorrect_count}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {surfaced.dormantThisWeek.length > 0 && (
        <div className="card">
          <div className="eyebrow">Newly dormant</div>
          {surfaced.dormantThisWeek.map(t => (
            <div key={t.id} className="topic-row">
              <div>
                <div className="topic-name">{t.topic}</div>
                <div className="topic-meta">Dormant since {t.dormant_since?.slice(0, 10) || 'unknown'}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {surfaced.oldestActive.length > 0 && (
        <div className="card">
          <div className="eyebrow">Active</div>
          {surfaced.oldestActive.map(t => (
            <div key={t.id} className="topic-row">
              <div>
                <div className="topic-name">{t.topic}</div>
                <div className="topic-meta">Last quizzed {t.last_quizzed_at ? t.last_quizzed_at.slice(0, 10) : 'never'}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <span className="card-deco" /><span className="card-deco-bl" />
        <div className="eyebrow">Add new topics</div>
        <h3>Paste recent intellectual content.</h3>
        <p style={{ fontFamily: 'var(--serif)', color: 'var(--ink-soft)' }}>
          Chat excerpts, articles, half-formed thoughts, raw notes. Claude proposes 1-3 quizzable topics, drafts context paragraphs, you approve or edit.
        </p>
        <div className="field">
          <textarea
            value={pasted}
            onChange={e => setPasted(e.target.value)}
            rows={10}
            placeholder="Paste anything substantive."
          />
        </div>
        {error && <div className="alert">{error}</div>}
        <div className="btn-row">
          <button className="primary" disabled={loading || !pasted.trim()} onClick={generate}>
            {loading ? <><span className="spinner" />Thinking…</> : 'Propose topics'}
          </button>
        </div>
      </div>

      {proposals.map((p, i) => (
        <div className="card" key={i}>
          <span className="card-deco" /><span className="card-deco-bl" />
          <div className="eyebrow">Proposal {i + 1}</div>
          {p.rationale && (
            <p className="kicker">{p.rationale}</p>
          )}
          <div className="field">
            <label>ID (slug)</label>
            <input type="text" value={editing[i]?.id || ''} onChange={e => updateProposal(i, 'id', e.target.value)} />
          </div>
          <div className="field">
            <label>Title</label>
            <input type="text" value={editing[i]?.topic || ''} onChange={e => updateProposal(i, 'topic', e.target.value)} />
          </div>
          <div className="field">
            <label>Context</label>
            <textarea rows={8} value={editing[i]?.context || ''} onChange={e => updateProposal(i, 'context', e.target.value)} />
          </div>
          <div className="field">
            <label>Tags</label>
            <input
              type="text"
              value={(editing[i]?.tags || []).join(', ')}
              onChange={e => updateProposal(i, 'tags', e.target.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))}
            />
          </div>
          <div className="btn-row">
            <button className="primary" onClick={() => approve(i)}>Approve</button>
            <button className="ghost" onClick={() => reject(i)}>Reject</button>
          </div>
        </div>
      ))}
    </>
  )
}

function surfaceForReview(topics, todayKey) {
  // Lowest accuracy among active w/ at least 3 attempts
  const lowestAccuracy = topics
    .filter(t => t.status === 'active' && (t.correct_count + t.incorrect_count) >= 3)
    .map(t => ({ ...t, _acc: t.correct_count / (t.correct_count + t.incorrect_count) }))
    .sort((a, b) => a._acc - b._acc)
    .slice(0, 5)

  // Dormant in last 7 days
  const dormantThisWeek = topics
    .filter(t => t.status === 'dormant' && t.dormant_since)
    .filter(t => daysBetween(t.dormant_since.slice(0, 10), todayKey) <= 7)

  // Oldest-quizzed active topics
  const oldestActive = topics
    .filter(t => t.status === 'active' && t.last_quizzed_at)
    .sort((a, b) => (a.last_quizzed_at || '').localeCompare(b.last_quizzed_at || ''))
    .slice(0, 5)

  return { lowestAccuracy, dormantThisWeek, oldestActive }
}
