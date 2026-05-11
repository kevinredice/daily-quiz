import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Link, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import { LocalStorageAdapter, SupabaseAdapter } from './lib/storage.js'
import { localDateString } from './lib/dates.js'

import Today from './components/Today.jsx'
import Topics from './components/Topics.jsx'
import History from './components/History.jsx'
import Settings from './components/Settings.jsx'
import SignIn from './components/SignIn.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [adapter, setAdapter] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let unsub
    async function init() {
      if (supabase) {
        const { data } = await supabase.auth.getSession()
        setSession(data.session)
        const sub = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
        unsub = sub.data.subscription
      }
      setLoading(false)
    }
    init()
    return () => unsub?.unsubscribe?.()
  }, [])

  // Pick adapter based on session.
  useEffect(() => {
    async function setup() {
      if (session && supabase) {
        const a = new SupabaseAdapter(supabase, session.user.id)
        await a.ensureSeeded()
        setAdapter(a)
      } else {
        setAdapter(new LocalStorageAdapter())
      }
    }
    if (!loading) setup()
  }, [session, loading])

  if (loading || !adapter) {
    return <div className="app"><div className="empty"><span className="spinner" />Loading.</div></div>
  }

  return (
    <div className="app">
      <Masthead session={session} adapter={adapter} />
      <Routes>
        <Route path="/" element={<Today adapter={adapter} session={session} />} />
        <Route path="/topics" element={<Topics adapter={adapter} />} />
        <Route path="/history" element={<History adapter={adapter} />} />
        <Route path="/settings" element={<Settings adapter={adapter} session={session} />} />
        <Route path="/signin" element={<SignIn />} />
      </Routes>
    </div>
  )
}

function Masthead({ session, adapter }) {
  const today = new Date()
  const todayLong = today.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  return (
    <header className="masthead">
      <div className="masthead-top">
        <span>{todayLong}</span>
      </div>
      <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="wordmark">Daily Quiz</div>
      </Link>
      <div className="masthead-rule">
        {adapter.kind === 'supabase' ? 'Synced' : 'Local'} · {session?.user?.email || 'Visitor'}
      </div>
      <nav className="nav">
        <NavLink to="/" end>Today</NavLink>
        <NavLink to="/topics">Topics</NavLink>
        <NavLink to="/history">History</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
    </header>
  )
}
