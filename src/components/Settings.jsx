import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function Settings({ adapter, session }) {
  const [settings, setSettings] = useState({})
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    adapter.getSettings().then(s => {
      setSettings(s)
      setKeyInput(s.api_key || '')
    })
  }, [adapter])

  async function saveKey() {
    await adapter.setSettings({ api_key: keyInput })
    setSettings({ ...settings, api_key: keyInput })
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  async function signInGoogle() {
    if (!supabase) return alert('Supabase not configured. See README.')
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut()
  }

  async function exportData() {
    const [topics, quizzes, settings] = await Promise.all([
      adapter.getTopics(), adapter.getQuizzes(), adapter.getSettings()
    ])
    const blob = new Blob([JSON.stringify({ topics, quizzes, settings }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `daily-quiz-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="card">
        <span className="card-deco" /><span className="card-deco-bl" />
        <div className="eyebrow">Account</div>
        <h2>{session ? `Signed in as ${session.user.email}` : 'Visitor mode'}</h2>
        <p className="kicker">
          {session
            ? 'Your data syncs across devices via Supabase.'
            : 'Your data is stored in this browser only. Sign in with Google to sync.'}
        </p>
        <div className="btn-row">
          {session
            ? <button onClick={signOut}>Sign out</button>
            : <button className="primary" onClick={signInGoogle} disabled={!supabase}>
                Sign in with Google
              </button>
          }
          {!supabase && <div style={{ fontSize: '0.85rem', color: 'var(--ink-mute)' }}>Supabase env vars not set — sync unavailable.</div>}
        </div>
      </div>

      <div className="card">
        <span className="card-deco" /><span className="card-deco-bl" />
        <div className="eyebrow">Anthropic API key</div>
        <h3>Required for question generation and grading.</h3>
        <p style={{ fontFamily: 'var(--serif)', color: 'var(--ink-soft)' }}>
          Get one at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>.
          Stored {adapter.kind === 'supabase' ? 'in your synced settings (only you can read it)' : 'in this browser only'}.
          Sent only to api.anthropic.com.
        </p>
        <div className="field">
          <label>API key</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="sk-ant-..."
            />
            <button className="ghost" onClick={() => setShowKey(!showKey)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div className="btn-row">
          <button className="primary" onClick={saveKey} disabled={keyInput === settings.api_key}>
            {saved ? 'Saved ✓' : 'Save key'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">Data</div>
        <h3>Export your bank.</h3>
        <p style={{ fontFamily: 'var(--serif)', color: 'var(--ink-soft)' }}>
          Topics, quiz history, and settings as JSON. The API key is included — don't share the file.
        </p>
        <div className="btn-row">
          <button onClick={exportData}>Export JSON</button>
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">Quick links</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Link to="/topics">Manage topics</Link>
          <Link to="/history">View history</Link>
          <Link to="/review">Weekly review</Link>
        </div>
      </div>
    </>
  )
}
