# Daily Quiz

Editorial/art-deco daily quiz app. Two-tier: signed-in (Supabase, synced across devices) and visitor (localStorage, single-device, BYO Anthropic key). 10 Q/day at 4am local rollover, 7 MC + 3 short answer, Claude generates and grades.

## Stack

- **React 18 + Vite** — single-page app
- **Supabase** — auth (Google OAuth) + Postgres for signed-in users
- **Anthropic SDK** — direct browser calls (`dangerouslyAllowBrowser: true`)
- **Vercel** — static hosting

The app degrades gracefully: leave Supabase env vars unset and it runs in pure-local mode for everyone.

---

## Quick start (local dev)

```bash
git clone <repo>
cd quiz-app
npm install
cp .env.example .env.local      # optional — leave blank for local-only mode
npm run dev
```

Open http://localhost:5173. On first load you'll see seed topics. Add an Anthropic API key in Settings (it stays in localStorage), then start your first quiz.

---

## Setup: Supabase (only needed for synced/signed-in tier)

If you don't care about cross-device sync, skip this whole section. The app works fine without Supabase env vars — every user just gets their own localStorage bank.

### 1. Create the project

1. Go to [supabase.com](https://supabase.com) → New project. Note your project URL and **anon** (public) key — both go in `.env.local`.
2. In SQL Editor, paste the contents of `supabase/schema.sql` and run. This creates `topics`, `quizzes`, `settings` tables with RLS policies scoped per user.

### 2. Enable Google OAuth

1. Auth → Providers → Google → Enable.
2. You need a Google OAuth client. In [Google Cloud Console](https://console.cloud.google.com):
   - APIs & Services → Credentials → Create OAuth client ID → Web application
   - Authorized redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
   - Copy the client ID and secret back into Supabase's Google provider config.
3. Auth → URL Configuration:
   - Site URL: your Vercel deploy URL (or `http://localhost:5173` during dev)
   - Redirect URLs: add both your prod URL and `http://localhost:5173`

### 3. Wire up env vars

```bash
# .env.local
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJh...
```

Restart `npm run dev`. The "Sign in with Google" button on the Settings page will now work.

### 4. (Optional) Restrict to your account only

If you want this to be private — only you can sign in — the simplest path is to leave the Supabase project as-is (it's invite-only by default unless you enable email signups) and only sign in with your one Google account. The RLS policies already scope every row by `auth.uid()`, so even if someone else got in, they couldn't see your data.

For tighter control, add a row-level allowlist:

```sql
-- after running schema.sql:
create table allowed_users (email text primary key);
insert into allowed_users values ('you@example.com');

create policy "topics_only_allowed" on public.topics
  for all using (
    auth.uid() = user_id
    and (auth.jwt() ->> 'email') in (select email from allowed_users)
  );
```

(Repeat the wrap for `quizzes` and `settings`, dropping the prior policies.)

---

## Setup: Vercel deployment

1. Push to GitHub.
2. [vercel.com](https://vercel.com) → New project → import the repo. Vercel auto-detects Vite.
3. Add env vars under Project Settings → Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. The included `vercel.json` rewrites all non-asset routes to `index.html` so React Router works on hard refresh.
5. Update Supabase Auth → URL Configuration with your Vercel URL.

---

## Anthropic API key

Each user supplies their own. Stored:

- Signed-in users: `settings.api_key` row in Supabase, RLS-protected (only you can read your own row).
- Visitors: localStorage in their browser.

The key is sent only to `api.anthropic.com` from the browser — there's no backend proxy. The Anthropic SDK is configured with `dangerouslyAllowBrowser: true`, which is the documented flag for client-side use. The "dangerous" branding refers to shipping a *shared* key to many users, which we are not doing.

The app uses `claude-sonnet-4-6` for question generation, short-answer grading, and weekly review topic proposals.

---

## Architecture notes

### Storage adapter

`src/lib/storage.js` defines two adapter classes (`LocalStorageAdapter`, `SupabaseAdapter`) with the same interface (`getTopics`, `upsertQuiz`, `setSettings`, etc.). The rest of the app receives an `adapter` prop and never knows which backend is active. Adding a third backend (IndexedDB? a different DB?) means writing one new class.

### Daily rollover

The "current quiz date" rolls over at 4am local time. `quizDateForNow()` in `src/lib/dates.js` shifts `now()` back 4 hours and takes the local date. Result: if it's 2am, you're still on yesterday's quiz; at 4:01am, today's quiz becomes available. No server cron needed — pure client-side.

### Topic selection algorithm

`src/lib/selection.js`:

- 10 slots: 1 dormant retest (if any eligible), 1 fresh slot (newest topic if added in last 7d), warmup slots (new topics get guaranteed 3 appearances), remainder filled from active pool by weight.
- Weights combine recency (older `last_quizzed_at` = higher), inverse `times_quizzed`, and low-accuracy bonus. So weak topics surface more, recently-mastered ones less.
- Selection is deterministic per date — refreshing the page on the same day yields the same quiz (seeded RNG by date string).
- After completion, `applyQuizResults` mutates topic stats and runs the dormancy state machine. Active → dormant requires 8+ quizzes AND ≥80% on last 5 results AND active count > 5 (the floor). Dormant → active happens immediately on a missed retest.

### Streak

Stored as `current_streak` + `last_streak_date`. On read, computed: if `last_streak_date` is older than yesterday, the value is stale and the effective streak is 0. On completion, increment if yesterday, set to 1 if not.

### Question generation

One batched API call generates all 10 questions. Slot plan is computed first (selection algo), then one prompt with all 10 topics is sent to Claude with a strict-JSON output requirement. Topic IDs are re-attached from the slot plan defensively (don't trust the model to round-trip them perfectly).

Short-answer grading is a separate single call per question, made when the user submits their answer. Weekly review is another separate call.

### Resume mid-quiz

Quizzes persist after every answer. If you close the tab mid-quiz, reopening the app lands you on the first unanswered question.

---

## File map

```
src/
├── App.jsx                 # router + adapter selection
├── main.jsx                # entry
├── components/
│   ├── Today.jsx           # quiz lifecycle: load, generate, take, grade, results
│   ├── Topics.jsx          # CRUD + filter
│   ├── History.jsx         # score chart + per-topic accuracy
│   ├── Review.jsx          # weekly review UI
│   ├── Settings.jsx        # API key, sign-in, export
│   └── SignIn.jsx          # redirect helper
├── lib/
│   ├── anthropic.js        # API wrappers (generate, grade, propose)
│   ├── dates.js            # 4am-local rollover, streak math
│   ├── seed.js             # default topic bank
│   ├── selection.js        # daily picker + dormancy state machine
│   ├── storage.js          # LocalStorage + Supabase adapters
│   └── supabase.js         # client init
├── styles/global.css
├── App.jsx
└── main.jsx
supabase/schema.sql         # tables + RLS
.env.example
vercel.json
```

---

## Tunables (selection algo)

In `src/lib/selection.js`:

| constant | default | effect |
| --- | --- | --- |
| `DORMANCY_THRESHOLD_QUIZZES` | 8 | min times_quizzed before a topic can go dormant |
| `DORMANCY_THRESHOLD_ACCURACY` | 0.8 | required accuracy on last 5 results to dormancy |
| `DORMANT_RETEST_DAYS` | 7 | min days between dormant retests of same topic |
| `WARMUP_GUARANTEE` | 3 | guaranteed appearances for new topics |
| `WARMUP_WINDOW_DAYS` | 7 | new-topic eligibility window |
| `MIN_ACTIVE` | 5 | floor — block dormancy if active count would drop below |
| `MAX_ACTIVE_WARN` | 30 | UI warns above this |

---

## Known limitations / extensions

- The 4am rollover uses the user's *current* timezone via the browser. Cross-timezone travel may produce a quiz that "should have" been today's becoming tomorrow's. Mostly a non-issue.
- Anthropic API failures during generation leave you in the `ready` state — retry button works. Mid-quiz SA grading failures show an inline error and let you retry.
- No rate limiting on the Anthropic side from the app — if your key has limits, you'll hit them naturally.
- Score chart is hand-rolled SVG. If you want a richer chart later, swap in Recharts (already a popular pairing in the AI infra).
- The export button dumps your API key in the JSON. Don't share the file.
