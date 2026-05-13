// Daily selection — 5 topics, 2 questions each (1 MC + 1 SA) = 10 questions total:
//   3 active (weighted: recency, inverse times_quizzed, low accuracy)
//   1 dormant retest (any dormant whose last quiz was 7+ days ago)
//   1 fresh slot (newest topic if added in last 7 days; else another active)
//
// Dormancy transitions, applied AFTER each quiz:
//   active → dormant  if times_quizzed >= 8 AND avg(last 5 results) >= 0.8
//   dormant → active  if a dormant retest is missed (incorrect)
//   retired only manually
//
// Floor: never let active count drop below 5 — block new dormancy if it would breach.
// Warmup: any topic with status='active' and created_at within last 7 days gets
//   guaranteed inclusion in next quiz, until appearance count >= 3.

import { daysBetween } from './dates.js'

const ACTIVE_TARGET = 3
const DORMANT_RETEST_DAYS = 7
const WARMUP_GUARANTEE = 3
const WARMUP_WINDOW_DAYS = 7
const MIN_ACTIVE = 1
const MAX_ACTIVE_WARN = 30
const DORMANCY_THRESHOLD_QUIZZES = 8
const DORMANCY_THRESHOLD_ACCURACY = 0.8

const DORMANCY_BY_DIFFICULTY = {
  basic:        { quizzes: 6,  accuracy: 0.90 },
  intermediate: { quizzes: 8,  accuracy: 0.80 },
  advanced:     { quizzes: 10, accuracy: 0.70 },
}

function avgRecent(arr) {
  if (!arr || arr.length === 0) return 0
  return arr.reduce((s, b) => s + (b ? 1 : 0), 0) / arr.length
}

function topicAccuracy(t) {
  const total = (t.correct_count || 0) + (t.incorrect_count || 0)
  if (!total) return null
  return (t.correct_count || 0) / total
}

// Deterministic pseudo-random from a seed string. Refreshing the page on the
// same day shouldn't reroll the quiz.
function mulberry32(seed) {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function weightedSampleNoReplace(items, weightFn, k, rng) {
  const pool = items.map(it => ({ it, w: Math.max(1e-6, weightFn(it)) }))
  const out = []
  for (let i = 0; i < k && pool.length > 0; i++) {
    const total = pool.reduce((s, p) => s + p.w, 0)
    let r = rng() * total
    let pickIdx = 0
    for (let j = 0; j < pool.length; j++) {
      r -= pool[j].w
      if (r <= 0) { pickIdx = j; break }
    }
    out.push(pool[pickIdx].it)
    pool.splice(pickIdx, 1)
  }
  return out
}

// Count appearances per topic across all completed quizzes (used for warmup).
function appearancesByTopic(quizzes) {
  const counts = {}
  for (const q of quizzes) {
    if (!q.questions) continue
    for (const qq of q.questions) {
      counts[qq.topic_id] = (counts[qq.topic_id] || 0) + 1
    }
  }
  return counts
}

// Pick 5 topics for today's quiz. Returns ordered list with slot metadata.
// Claude generates 2 questions per topic (1 MC + 1 SA) = 10 questions total.
export function selectDailyTopics({ topics, quizzes, todayKey }) {
  const rng = mulberry32(todayKey)
  const counts = appearancesByTopic(quizzes)

  const active = topics.filter(t => t.status === 'active')
  const dormant = topics.filter(t => t.status === 'dormant')

  // Warmup: active topics created in last 7 days w/ <3 appearances → guaranteed
  const warmup = active.filter(t => {
    if (!t.created_at) return false
    const ageDays = daysBetween(t.created_at.slice(0, 10), todayKey)
    return ageDays >= 0 && ageDays <= WARMUP_WINDOW_DAYS && (counts[t.id] || 0) < WARMUP_GUARANTEE
  })

  // Fresh slot: newest active topic if it's <=7d old (and not already in warmup)
  const newestActive = [...active]
    .filter(t => t.created_at && daysBetween(t.created_at.slice(0, 10), todayKey) <= 7)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0]

  // Dormant retest: pick a dormant topic last quizzed >=7d ago
  const dormantEligible = dormant.filter(t => {
    if (!t.last_quizzed_at) return true
    return daysBetween(t.last_quizzed_at.slice(0, 10), todayKey) >= DORMANT_RETEST_DAYS
  })
  const dormantPick = dormantEligible.length > 0
    ? dormantEligible[Math.floor(rng() * dormantEligible.length)]
    : null

  // Build result with reservations
  const reserved = new Set()
  const out = []

  for (const w of warmup) {
    if (out.length >= 5) break
    if (!reserved.has(w.id)) {
      out.push({ topic: w, slot: 'warmup' })
      reserved.add(w.id)
    }
  }

  if (dormantPick && !reserved.has(dormantPick.id) && out.length < 5) {
    out.push({ topic: dormantPick, slot: 'dormant_retest' })
    reserved.add(dormantPick.id)
  }

  if (newestActive && !reserved.has(newestActive.id) && out.length < 5) {
    out.push({ topic: newestActive, slot: 'fresh' })
    reserved.add(newestActive.id)
  }

  // Fill remainder with active topics by weight.
  // Weight = recency * inverse_times_quizzed * low_accuracy_bonus
  const remainingActive = active.filter(t => !reserved.has(t.id))
  const remainingNeeded = 5 - out.length

  const weightFn = (t) => {
    // Recency: more recent = higher weight (last_quizzed_at older = higher score
    // because we want to surface stale topics).
    let recencyBonus
    if (!t.last_quizzed_at) recencyBonus = 3.0  // never quizzed → high
    else {
      const days = daysBetween(t.last_quizzed_at.slice(0, 10), todayKey)
      recencyBonus = Math.min(3.0, 0.5 + days * 0.2)
    }
    const inverseQuizzed = 1 / Math.sqrt((t.times_quizzed || 0) + 1)
    const acc = topicAccuracy(t)
    const lowAccBonus = acc === null ? 1.0 : (1.5 - acc)  // 0% acc → 1.5x, 100% → 0.5x
    return recencyBonus * inverseQuizzed * lowAccBonus
  }

  const filler = weightedSampleNoReplace(remainingActive, weightFn, remainingNeeded, rng)
  for (const t of filler) out.push({ topic: t, slot: 'active' })

  // If still short (very low active count), pad with any remaining topics.
  if (out.length < 5) {
    const leftover = topics.filter(t => !reserved.has(t.id) && t.status !== 'retired')
    for (const t of leftover) {
      if (out.length >= 5) break
      out.push({ topic: t, slot: 'fallback' })
    }
  }

  // Each topic gets 1 MC + 1 SA question (assigned by Claude). Shuffle order.
  const shuffled = [...out].sort(() => rng() - 0.5)
  return shuffled.slice(0, 5).map((s, i) => ({
    ...s,
    position: i,
  }))
}

// Apply post-quiz mutations to topics. Returns new topic array + warnings.
export function applyQuizResults({ topics, questions, responses }) {
  const updates = {}
  const todayISO = new Date().toISOString()

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const r = responses[i]
    if (!r) continue
    const tid = q.topic_id
    const wasCorrect = !!r.correct
    if (!updates[tid]) updates[tid] = { delta_quizzed: 0, delta_correct: 0, delta_incorrect: 0, results: [], prompts: [] }
    updates[tid].delta_quizzed += 1
    if (wasCorrect) updates[tid].delta_correct += 1
    else updates[tid].delta_incorrect += 1
    updates[tid].results.push(wasCorrect)
    if (q.prompt) updates[tid].prompts.push(q.prompt)
  }

  // Apply
  let next = topics.map(t => {
    const u = updates[t.id]
    if (!u) return t
    const newRecent = [...(t.recent_results || []), ...u.results].slice(-5)
    const newPastQuestions = [...(t.past_questions || []), ...u.prompts].slice(-20)
    return {
      ...t,
      times_quizzed: (t.times_quizzed || 0) + u.delta_quizzed,
      correct_count: (t.correct_count || 0) + u.delta_correct,
      incorrect_count: (t.incorrect_count || 0) + u.delta_incorrect,
      recent_results: newRecent,
      past_questions: newPastQuestions,
      last_quizzed_at: todayISO,
    }
  })

  // Dormancy transitions (active → dormant), respecting MIN_ACTIVE floor
  let activeCount = next.filter(t => t.status === 'active').length
  next = next.map(t => {
    if (t.status !== 'active') return t
    const thresh = DORMANCY_BY_DIFFICULTY[t.difficulty] || DORMANCY_BY_DIFFICULTY.intermediate
    if ((t.times_quizzed || 0) < thresh.quizzes) return t
    if (avgRecent(t.recent_results) < thresh.accuracy) return t
    if (activeCount <= MIN_ACTIVE) return t  // floor
    activeCount -= 1
    return { ...t, status: 'dormant', dormant_since: todayISO }
  })

  // Wake dormant on missed retest
  next = next.map(t => {
    if (t.status !== 'dormant') return t
    const u = updates[t.id]
    if (!u) return t
    const recentlyMissed = u.results.some(r => !r)
    if (recentlyMissed) return { ...t, status: 'active', dormant_since: null }
    return t
  })

  const warnings = []
  const finalActive = next.filter(t => t.status === 'active').length
  if (finalActive >= MAX_ACTIVE_WARN) {
    warnings.push(`You have ${finalActive} active topics. Above ${MAX_ACTIVE_WARN}, daily quizzes thin out per topic — consider letting some go dormant or retiring.`)
  }
  if (finalActive < MIN_ACTIVE) {
    warnings.push(`Only ${finalActive} active topics. Add more or wake some dormant ones — quiz quality will degrade.`)
  }

  return { topics: next, warnings }
}

export const SELECTION_CONSTANTS = {
  MIN_ACTIVE,
  MAX_ACTIVE_WARN,
  DORMANCY_THRESHOLD_QUIZZES,
  DORMANCY_THRESHOLD_ACCURACY,
  DORMANCY_BY_DIFFICULTY,
  WARMUP_GUARANTEE,
  DORMANT_RETEST_DAYS,
}
