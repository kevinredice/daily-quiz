// All quiz dates are "local calendar dates" — the user's timezone.
// "4am local" = a quiz dated YYYY-MM-DD becomes available at 4am local on that date.
// We store dates as YYYY-MM-DD strings to dodge TZ pain.

export function localDateString(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// "Today's quiz" = the quiz dated todayKey, where todayKey rolls over at 4am local.
// Before 4am, you're still on yesterday's quiz.
export function quizDateForNow(d = new Date()) {
  const shifted = new Date(d)
  shifted.setHours(d.getHours() - 4)
  return localDateString(shifted)
}

export function nextRolloverISO(d = new Date()) {
  const next = new Date(d)
  next.setHours(4, 0, 0, 0)
  if (next <= d) next.setDate(next.getDate() + 1)
  return next.toISOString()
}

// Days between two YYYY-MM-DD strings, treating them as calendar days.
export function daysBetween(a, b) {
  const ad = new Date(a + 'T00:00:00')
  const bd = new Date(b + 'T00:00:00')
  return Math.round((bd - ad) / (1000 * 60 * 60 * 24))
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return localDateString(d)
}

// Streak logic:
//   - Completing today's quiz: if last_streak_date is yesterday, increment.
//     If last_streak_date is today, no-op. Otherwise reset to 1.
//   - Reading current_streak: if last_streak_date is older than yesterday, the
//     stored value is stale — actual streak is 0. We compute on read.
export function effectiveStreak(settings, todayKey) {
  if (!settings.last_streak_date) return 0
  const gap = daysBetween(settings.last_streak_date, todayKey)
  if (gap <= 0) return settings.current_streak || 0    // today or earlier-stamped
  if (gap === 1) return settings.current_streak || 0   // yesterday — still alive, just hasn't completed today
  return 0  // missed at least one day
}

export function applyCompletion(settings, todayKey) {
  const last = settings.last_streak_date
  let next
  if (!last) next = 1
  else {
    const gap = daysBetween(last, todayKey)
    if (gap === 0) return settings  // already counted today
    if (gap === 1) next = (settings.current_streak || 0) + 1
    else next = 1
  }
  return {
    ...settings,
    last_streak_date: todayKey,
    current_streak: next,
    longest_streak: Math.max(settings.longest_streak || 0, next),
  }
}
