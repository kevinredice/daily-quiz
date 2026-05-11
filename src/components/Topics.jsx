import { useEffect, useState } from 'react'
import { SELECTION_CONSTANTS } from '../lib/selection.js'
import { proposeNewTopics } from '../lib/anthropic.js'

function slugify(s) {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
}

export default function Topics({ adapter }) {
  const [topics, setTopics] = useState([])
  const [settings, setSettings] = useState({})
  const [editing, setEditing] = useState(null)  // topic obj or 'new' or null
  const [filter, setFilter] = useState('all')
  const [showHow, setShowHow] = useState(false)

  // Propose-via-paste state
  const [pasted, setPasted] = useState('')
  const [proposals, setProposals] = useState([])
  const [proposalEdits, setProposalEdits] = useState({})
  const [proposing, setProposing] = useState(false)
  const [proposeError, setProposeError] = useState(null)

  async function reload() {
    const [t, s] = await Promise.all([adapter.getTopics(), adapter.getSettings()])
    setTopics(t)
    setSettings(s)
  }
  useEffect(() => { reload() }, [adapter])

  async function propose() {
    if (!settings.api_key) { setProposeError('Add an Anthropic API key in Settings first.'); return }
    if (!pasted.trim()) { setProposeError('Paste some content first.'); return }
    setProposeError(null)
    setProposing(true)
    try {
      const ps = await proposeNewTopics({ apiKey: settings.api_key, pastedContent: pasted, existingTopicNames: topics.map(t => t.topic) })
      setProposals(ps)
      const edits = {}
      ps.forEach((p, i) => { edits[i] = { ...p } })
      setProposalEdits(edits)
    } catch (e) {
      setProposeError(e.message)
    } finally {
      setProposing(false)
    }
  }

  async function approveProposal(idx) {
    const p = proposalEdits[idx]
    if (!p?.id || !p?.topic || !p?.context) { setProposeError('Need id, topic, and context.'); return }
    if (topics.find(t => t.id === p.id)) { setProposeError(`ID "${p.id}" already exists.`); return }
    await adapter.upsertTopic({ id: p.id, topic: p.topic, context: p.context, tags: p.tags || [], status: 'active', times_quizzed: 0, correct_count: 0, incorrect_count: 0, recent_results: [], created_at: new Date().toISOString(), last_quizzed_at: null, dormant_since: null })
    await reload()
    setProposals(proposals.filter((_, i) => i !== idx))
    const next = { ...proposalEdits }
    delete next[idx]
    setProposalEdits(next)
  }

  function rejectProposal(idx) {
    setProposals(proposals.filter((_, i) => i !== idx))
    const next = { ...proposalEdits }
    delete next[idx]
    setProposalEdits(next)
  }

  function updateProposal(idx, field, value) {
    setProposalEdits({ ...proposalEdits, [idx]: { ...proposalEdits[idx], [field]: value } })
  }

  const counts = {
    all: topics.length,
    active: topics.filter(t => t.status === 'active').length,
    dormant: topics.filter(t => t.status === 'dormant').length,
    retired: topics.filter(t => t.status === 'retired').length,
  }

  const filtered = filter === 'all' ? topics : topics.filter(t => t.status === filter)
  const sorted = [...filtered].sort((a, b) => (b.last_quizzed_at || '').localeCompare(a.last_quizzed_at || ''))

  if (topics.length === 0) return (
    <>
      {editing && (
        <TopicEditor
          topic={null}
          existingIds={[]}
          onSave={async (t) => { await adapter.upsertTopic(t); await reload(); setEditing(null) }}
          onCancel={() => setEditing(null)}
          onDelete={null}
        />
      )}
      {!editing && (
        <div className="card">
          <span className="card-deco" /><span className="card-deco-bl" />
          <div className="eyebrow">Get started</div>
          <h2>Add your first topic.</h2>
          <p style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', color: 'var(--ink-soft)', margin: '0 0 1.5rem' }}>
            A topic is anything you want to retain — a concept, an argument, a set of facts. Give it a title and write a short paragraph of context: the key claims, mechanisms, or details you'd want to be tested on.
          </p>
          <div className="btn-row" style={{ marginBottom: '2rem' }}>
            <button className="primary" onClick={() => setEditing('new')}>+ Add manually</button>
          </div>
          <div style={{ borderTop: '1px solid var(--rule-soft)', paddingTop: '1.5rem' }}>
            <div className="eyebrow" style={{ marginBottom: '0.6rem' }}>Or let Claude propose topics</div>
            <p style={{ fontFamily: 'var(--serif)', color: 'var(--ink-soft)', margin: '0 0 1rem', fontSize: '1rem' }}>
              Paste an article, notes, or anything substantive. Claude will extract 1–3 quizzable topics with context for you to review.
            </p>
            <div className="field">
              <textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={7} placeholder="Paste anything substantive." />
            </div>
            {proposeError && <div className="alert">{proposeError}</div>}
            <div className="btn-row">
              <button className="primary" disabled={proposing || !pasted.trim()} onClick={propose}>
                {proposing ? <><span className="spinner" />Thinking…</> : 'Propose topics'}
              </button>
            </div>
          </div>
        </div>
      )}
      {proposals.map((p, i) => (
        <div className="card" key={i}>
          <span className="card-deco" /><span className="card-deco-bl" />
          <div className="eyebrow">Proposal {i + 1}</div>
          {p.rationale && <p className="kicker">{p.rationale}</p>}
          <div className="field"><label>ID (slug)</label><input type="text" value={proposalEdits[i]?.id || ''} onChange={e => updateProposal(i, 'id', e.target.value)} /></div>
          <div className="field"><label>Title</label><input type="text" value={proposalEdits[i]?.topic || ''} onChange={e => updateProposal(i, 'topic', e.target.value)} /></div>
          <div className="field"><label>Context</label><textarea rows={8} value={proposalEdits[i]?.context || ''} onChange={e => updateProposal(i, 'context', e.target.value)} /></div>
          <div className="field"><label>Tags</label><input type="text" value={(proposalEdits[i]?.tags || []).join(', ')} onChange={e => updateProposal(i, 'tags', e.target.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))} /></div>
          <div className="btn-row">
            <button className="primary" onClick={() => approveProposal(i)}>Approve</button>
            <button className="ghost" onClick={() => rejectProposal(i)}>Reject</button>
          </div>
        </div>
      ))}
    </>
  )

  return (
    <>
      <div className="card">
        <span className="card-deco" /><span className="card-deco-bl" />
        <div className="eyebrow">Topic bank</div>
        <h2>Manage topics.</h2>
        <p className="kicker">{counts.active} active · {counts.dormant} dormant · {counts.retired} retired</p>

        {counts.active >= SELECTION_CONSTANTS.MAX_ACTIVE_WARN && (
          <div className="alert warn">
            {counts.active} active topics. Above {SELECTION_CONSTANTS.MAX_ACTIVE_WARN}, daily quiz coverage thins out per topic.
          </div>
        )}

        <div className="btn-row">
          <button className="primary" onClick={() => setEditing('new')}>+ New topic</button>
          {['all', 'active', 'dormant', 'retired'].map(f => (
            <button key={f} className={filter === f ? '' : 'ghost'} onClick={() => setFilter(f)}>
              {f} ({counts[f]})
            </button>
          ))}
        </div>

        <button
          className="ghost"
          onClick={() => setShowHow(v => !v)}
          style={{ marginTop: '1rem', fontSize: '0.75rem', letterSpacing: '0.1em' }}
        >
          {showHow ? 'Hide' : 'How selection works'} {showHow ? '▴' : '▾'}
        </button>

        {showHow && (
          <div style={{ marginTop: '1rem', fontFamily: 'var(--serif)', fontSize: '1rem', lineHeight: 1.7, color: 'var(--ink-soft)', borderTop: '1px solid var(--rule-soft)', paddingTop: '1rem' }}>
            <p style={{ margin: '0 0 0.8rem' }}>
              Each daily quiz draws up to <strong>{SELECTION_CONSTANTS.MIN_ACTIVE}</strong> topics and generates <strong>8</strong> multiple choice questions distributed across them.
            </p>
            <p style={{ margin: '0 0 0.8rem' }}>
              <strong>New topics</strong> are guaranteed to appear in every quiz until they've shown up {SELECTION_CONSTANTS.WARMUP_GUARANTEE} times or are more than 7 days old.
            </p>
            <p style={{ margin: '0 0 0.8rem' }}>
              A topic goes <strong>dormant</strong> automatically once you've quizzed it at least {SELECTION_CONSTANTS.DORMANCY_THRESHOLD_QUIZZES} times and scored {Math.round(SELECTION_CONSTANTS.DORMANCY_THRESHOLD_ACCURACY * 100)}%+ on your last 5 attempts — it means you know it well. Dormant topics still resurface for a retest every {SELECTION_CONSTANTS.DORMANT_RETEST_DAYS}+ days.
            </p>
            <p style={{ margin: '0 0 0.8rem' }}>
              If you <strong>miss a dormant retest</strong>, the topic goes back to active so it gets more practice.
            </p>
            <p style={{ margin: 0 }}>
              <strong>Retired</strong> topics are removed from all quizzes permanently. You can retire a topic manually via Edit.
            </p>
          </div>
        )}
      </div>

      {editing && (
        <TopicEditor
          topic={editing === 'new' ? null : editing}
          existingIds={topics.map(t => t.id)}
          onSave={async (t) => {
            await adapter.upsertTopic(t)
            await reload()
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
          onDelete={async (id) => {
            if (!confirm('Permanently delete this topic? Quiz history is kept.')) return
            await adapter.deleteTopic(id)
            await reload()
            setEditing(null)
          }}
        />
      )}

      <div className="card">
        {sorted.length === 0 ? (
          <div className="empty">No topics in this filter.</div>
        ) : (
          sorted.map(t => (
            <div key={t.id} className="topic-row">
              <div style={{ flex: 1 }}>
                <span className={`topic-status ${t.status}`}>{t.status}</span>
                <div className="topic-name" style={{ marginTop: '0.4rem' }}>{t.topic}</div>
                <div className="topic-meta">
                  {t.times_quizzed || 0} quizzed · {accuracy(t)} · last {t.last_quizzed_at ? t.last_quizzed_at.slice(0, 10) : 'never'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button className="ghost" onClick={() => setEditing(t)}>Edit</button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <span className="card-deco" /><span className="card-deco-bl" />
        <div className="eyebrow">Propose via Claude</div>
        <p style={{ fontFamily: 'var(--serif)', color: 'var(--ink-soft)', margin: '0 0 1rem' }}>
          Paste an article, chat excerpt, or notes. Claude proposes 1–3 quizzable topics with context paragraphs for you to approve or edit.
        </p>
        <div className="field">
          <textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={8} placeholder="Paste anything substantive." />
        </div>
        {proposeError && <div className="alert">{proposeError}</div>}
        <div className="btn-row">
          <button className="primary" disabled={proposing || !pasted.trim()} onClick={propose}>
            {proposing ? <><span className="spinner" />Thinking…</> : 'Propose topics'}
          </button>
        </div>
      </div>

      {proposals.map((p, i) => (
        <div className="card" key={i}>
          <span className="card-deco" /><span className="card-deco-bl" />
          <div className="eyebrow">Proposal {i + 1}</div>
          {p.rationale && <p className="kicker">{p.rationale}</p>}
          <div className="field">
            <label>ID (slug)</label>
            <input type="text" value={proposalEdits[i]?.id || ''} onChange={e => updateProposal(i, 'id', e.target.value)} />
          </div>
          <div className="field">
            <label>Title</label>
            <input type="text" value={proposalEdits[i]?.topic || ''} onChange={e => updateProposal(i, 'topic', e.target.value)} />
          </div>
          <div className="field">
            <label>Context</label>
            <textarea rows={8} value={proposalEdits[i]?.context || ''} onChange={e => updateProposal(i, 'context', e.target.value)} />
          </div>
          <div className="field">
            <label>Tags</label>
            <input type="text" value={(proposalEdits[i]?.tags || []).join(', ')} onChange={e => updateProposal(i, 'tags', e.target.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))} />
          </div>
          <div className="btn-row">
            <button className="primary" onClick={() => approveProposal(i)}>Approve</button>
            <button className="ghost" onClick={() => rejectProposal(i)}>Reject</button>
          </div>
        </div>
      ))}
    </>
  )
}

function accuracy(t) {
  const total = (t.correct_count || 0) + (t.incorrect_count || 0)
  if (!total) return 'no data'
  return `${Math.round(100 * (t.correct_count || 0) / total)}% accuracy`
}

function TopicEditor({ topic, existingIds, onSave, onCancel, onDelete }) {
  const isNew = !topic
  const [name, setName] = useState(topic?.topic || '')
  const [context, setContext] = useState(topic?.context || '')
  const [tags, setTags] = useState((topic?.tags || []).join(', '))
  const [status, setStatus] = useState(topic?.status || 'active')
  const [error, setError] = useState(null)

  function save() {
    if (!name.trim()) return setError('Name required')
    if (!context.trim()) return setError('Context required — even a paragraph is fine')
    let id = topic?.id
    if (isNew) {
      id = slugify(name)
      if (!id) return setError('Could not derive a slug from the name')
      if (existingIds.includes(id)) return setError(`Slug "${id}" already exists. Rename slightly.`)
    }
    const out = {
      id,
      topic: name.trim(),
      context: context.trim(),
      tags: tags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      status,
    }
    if (isNew) {
      out.times_quizzed = 0
      out.correct_count = 0
      out.incorrect_count = 0
      out.recent_results = []
      out.created_at = new Date().toISOString()
      out.last_quizzed_at = null
      out.dormant_since = null
    }
    onSave({ ...(topic || {}), ...out })
  }

  return (
    <div className="card">
      <span className="card-deco" /><span className="card-deco-bl" />
      <div className="eyebrow">{isNew ? 'New topic' : 'Edit topic'}</div>
      <h3>{isNew ? 'Add to bank' : topic.topic}</h3>
      <div className="field">
        <label>Title</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pricing power and cost pass-through" />
      </div>
      <div className="field">
        <label>Context (study notes — facts, mechanisms, sources)</label>
        <textarea value={context} onChange={e => setContext(e.target.value)} rows={10} />
      </div>
      <div className="field">
        <label>Tags (comma separated)</label>
        <input type="text" value={tags} onChange={e => setTags(e.target.value)} placeholder="economics, business" />
      </div>
      {!isNew && (
        <div className="field">
          <label>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="active">active</option>
            <option value="dormant">dormant</option>
            <option value="retired">retired</option>
          </select>
        </div>
      )}
      {error && <div className="alert">{error}</div>}
      <div className="btn-row">
        <button className="primary" onClick={save}>Save</button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
        {!isNew && <button className="ghost" style={{ marginLeft: 'auto', borderColor: 'var(--error)', color: 'var(--error)' }} onClick={() => onDelete(topic.id)}>Delete</button>}
      </div>
    </div>
  )
}
