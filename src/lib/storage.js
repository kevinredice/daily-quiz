// Storage adapter — the rest of the app uses this interface and doesn't care
// whether data lives in localStorage or Supabase.
//
// Schema (same shape both backends):
//
//   topics: [{ id, topic, context, tags, status, times_quizzed,
//              correct_count, incorrect_count, recent_results,
//              created_at, last_quizzed_at, dormant_since }]
//   quizzes: [{ id, date, questions, responses, score, completed_at }]
//   settings: { api_key, last_streak_date, current_streak, longest_streak }
//
// recent_results is a small array (cap 5) of booleans for "last 5 appearances"
// dormancy logic. Not for analytics — that's correct/incorrect_count.

import { SEED_TOPICS } from './seed.js'

const LS_PREFIX = 'dq:'
const KEY_TOPICS = LS_PREFIX + 'topics'
const KEY_QUIZZES = LS_PREFIX + 'quizzes'
const KEY_SETTINGS = LS_PREFIX + 'settings'
const KEY_INIT = LS_PREFIX + 'initialized'

function nowISO() { return new Date().toISOString() }

function decorateSeed(t) {
  return {
    ...t,
    status: 'active',
    times_quizzed: 0,
    correct_count: 0,
    incorrect_count: 0,
    recent_results: [],
    created_at: nowISO(),
    last_quizzed_at: null,
    dormant_since: null,
  }
}

// === localStorage adapter ===

class LocalStorageAdapter {
  constructor() {
    this.kind = 'local'
    this._initIfNeeded()
  }

  _initIfNeeded() {
    if (!localStorage.getItem(KEY_INIT)) {
      const seeded = SEED_TOPICS.map(decorateSeed)
      localStorage.setItem(KEY_TOPICS, JSON.stringify(seeded))
      localStorage.setItem(KEY_QUIZZES, JSON.stringify([]))
      localStorage.setItem(KEY_SETTINGS, JSON.stringify({
        api_key: '',
        last_streak_date: null,
        current_streak: 0,
        longest_streak: 0,
      }))
      localStorage.setItem(KEY_INIT, '1')
    }
  }

  async getTopics() {
    return JSON.parse(localStorage.getItem(KEY_TOPICS) || '[]')
  }

  async setTopics(topics) {
    localStorage.setItem(KEY_TOPICS, JSON.stringify(topics))
  }

  async upsertTopic(topic) {
    const topics = await this.getTopics()
    const idx = topics.findIndex(t => t.id === topic.id)
    if (idx >= 0) topics[idx] = { ...topics[idx], ...topic }
    else topics.push(topic)
    await this.setTopics(topics)
  }

  async deleteTopic(id) {
    const topics = await this.getTopics()
    await this.setTopics(topics.filter(t => t.id !== id))
  }

  async getQuizzes() {
    return JSON.parse(localStorage.getItem(KEY_QUIZZES) || '[]')
  }

  async getQuizByDate(date) {
    const all = await this.getQuizzes()
    return all.find(q => q.date === date) || null
  }

  async upsertQuiz(quiz) {
    const all = await this.getQuizzes()
    const idx = all.findIndex(q => q.id === quiz.id || q.date === quiz.date)
    if (idx >= 0) all[idx] = quiz
    else all.push(quiz)
    localStorage.setItem(KEY_QUIZZES, JSON.stringify(all))
  }

  async getSettings() {
    return JSON.parse(localStorage.getItem(KEY_SETTINGS) || '{}')
  }

  async setSettings(patch) {
    const cur = await this.getSettings()
    localStorage.setItem(KEY_SETTINGS, JSON.stringify({ ...cur, ...patch }))
  }
}

// === Supabase adapter ===
// Tables: topics, quizzes, settings — all keyed on user_id w/ RLS.
// Row shapes mirror localStorage shape exactly.

class SupabaseAdapter {
  constructor(supabase, userId) {
    this.kind = 'supabase'
    this.sb = supabase
    this.userId = userId
  }

  async ensureSeeded() {
    const { count } = await this.sb
      .from('topics')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', this.userId)
    if (count && count > 0) return
    const seeded = SEED_TOPICS.map(t => ({
      ...decorateSeed(t),
      user_id: this.userId,
    }))
    await this.sb.from('topics').insert(seeded)
    await this.sb.from('settings').upsert({
      user_id: this.userId,
      api_key: '',
      last_streak_date: null,
      current_streak: 0,
      longest_streak: 0,
    })
  }

  async getTopics() {
    const { data, error } = await this.sb
      .from('topics').select('*').eq('user_id', this.userId)
    if (error) throw error
    return data || []
  }

  async setTopics(topics) {
    // bulk upsert
    const rows = topics.map(t => ({ ...t, user_id: this.userId }))
    const { error } = await this.sb.from('topics').upsert(rows, { onConflict: 'id,user_id' })
    if (error) throw error
  }

  async upsertTopic(topic) {
    const { error } = await this.sb
      .from('topics')
      .upsert({ ...topic, user_id: this.userId }, { onConflict: 'id,user_id' })
    if (error) throw error
  }

  async deleteTopic(id) {
    const { error } = await this.sb
      .from('topics').delete().eq('id', id).eq('user_id', this.userId)
    if (error) throw error
  }

  async getQuizzes() {
    const { data, error } = await this.sb
      .from('quizzes').select('*').eq('user_id', this.userId).order('date', { ascending: false })
    if (error) throw error
    return data || []
  }

  async getQuizByDate(date) {
    const { data, error } = await this.sb
      .from('quizzes').select('*').eq('user_id', this.userId).eq('date', date).maybeSingle()
    if (error) throw error
    return data
  }

  async upsertQuiz(quiz) {
    const { error } = await this.sb
      .from('quizzes')
      .upsert({ ...quiz, user_id: this.userId }, { onConflict: 'id' })
    if (error) throw error
  }

  async getSettings() {
    const { data, error } = await this.sb
      .from('settings').select('*').eq('user_id', this.userId).maybeSingle()
    if (error) throw error
    return data || {}
  }

  async setSettings(patch) {
    const cur = await this.getSettings()
    const merged = { ...cur, ...patch, user_id: this.userId }
    const { error } = await this.sb
      .from('settings').upsert(merged, { onConflict: 'user_id' })
    if (error) throw error
  }
}

export { LocalStorageAdapter, SupabaseAdapter, decorateSeed }
