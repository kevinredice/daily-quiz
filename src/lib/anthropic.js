// Direct browser-to-Anthropic. Key never touches a backend other than Anthropic.
// `dangerously-allow-browser` is the documented flag for this — it's named to
// scare you off shipping it to a public app w/ a shared key, which is exactly
// what we are NOT doing here. BYO key tier owns its own key.

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'

function client(apiKey) {
  if (!apiKey) throw new Error('No API key set. Add one in Settings.')
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
  })
}

// Strip ```json fences if Claude adds them.
function extractJSON(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (m) return m[1].trim()
  return text.trim()
}

// === Question generation ===

export async function generateQuestions({ apiKey, slotPlan, todayKey, onProgress }) {
  // slotPlan: array of 5 { topic, slot, position } from selectDailyTopics
  // One batched streaming call generates 2 questions per topic (1 MC + 1 SA) = 10 total.

  const c = client(apiKey)

  const topicBlobs = slotPlan.map((s, i) => {
    const past = s.topic.past_questions || []
    const pastSection = past.length > 0
      ? `\n<past_questions>\n${past.map(q => `- ${q}`).join('\n')}\n</past_questions>`
      : ''
    return `<topic index="${i}" id="${s.topic.id}">
<name>${s.topic.topic}</name>
<context>${s.topic.context}</context>${pastSection}
</topic>`
  }).join('\n\n')

  const total = 8  // fixed daily question count regardless of topic count

  const sys = `You write quiz questions for an intellectually serious daily quiz app. The user is well-read, terse, and impatient with fluff. All questions are multiple choice.

Question style:
- Test understanding, not trivia recall. Favor "why does X follow from Y" over "what year did Z happen".
- 4 options, exactly one correct. Distractors must be plausible — common confusions, near-misses, related-but-wrong concepts. No "all of the above" or "none of the above".
- Vary difficulty. Some should be easy enough that a careful reader of the context gets them; some should require synthesis.
- Multiple questions on the same topic must test different aspects — don't ask the same fact two ways.
- If a topic includes <past_questions>, do not repeat or closely paraphrase any of them. Find a different angle.

Each question must include the topic_id (from the id attribute) exactly as given in the input.

Output STRICT JSON ONLY — no preamble, no fences, no commentary. Object with key "questions" mapping to an array of ${total} question objects.

Question object schema:
- topic_id (string)
- q_type ("mc")
- prompt (string)
- choices (array of 4 strings)
- correct_index (int 0–3)
- explanation (string, ~2 sentences)`

  const user = `Today's date: ${todayKey}

Generate exactly ${total} multiple choice questions distributed across the topics below. Aim for roughly even coverage. Use the id attribute as topic_id in each question.

${topicBlobs}`

  const stream = await c.messages.create({
    model: MODEL,
    max_tokens: 3000,
    stream: true,
    system: sys,
    messages: [{ role: 'user', content: user }],
  })

  let text = ''
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      text += event.delta.text
      if (onProgress) {
        onProgress((text.match(/"topic_id"/g) || []).length)
      }
    }
  }

  let parsed
  try {
    parsed = JSON.parse(extractJSON(text))
  } catch (e) {
    throw new Error('Question generation returned non-JSON: ' + text.slice(0, 300))
  }
  if (!parsed.questions || !Array.isArray(parsed.questions) || parsed.questions.length !== total) {
    throw new Error(`Expected ${total} questions, got ` + (parsed.questions?.length ?? 'none'))
  }
  return parsed.questions
}

// === Short-answer grading ===

export async function gradeShortAnswer({ apiKey, question, userAnswer }) {
  const c = client(apiKey)

  const sys = `You grade short-answer responses for a serious quiz. Judge whether the response demonstrates understanding of the key concept, not whether it matches the reference answer word-for-word. Be honest — partial credit only if a real partial understanding is shown.

Output strict JSON only:
{
  "correct": boolean,
  "explanation": "1-2 sentence explanation of what they got right or wrong, written for a smart reader. Reference the actual concept, don't be generic."
}`

  const user = `QUESTION: ${question.prompt}

GRADING RUBRIC: ${question.rubric}

REFERENCE ANSWER: ${question.reference_answer}

USER ANSWER: ${userAnswer}

Grade.`

  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: sys,
    messages: [{ role: 'user', content: user }],
  })

  const text = resp.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  try {
    return JSON.parse(extractJSON(text))
  } catch (e) {
    return { correct: false, explanation: 'Grading failed to parse. Raw: ' + text.slice(0, 200) }
  }
}

// === Fill in context for named topics ===

export async function generateTopicDetails({ apiKey, topicNames }) {
  const c = client(apiKey)

  const sys = `You help build a personal quiz topic bank. Given a list of topic names, write a dense context paragraph for each (100-300 words): key claims, mechanisms, sources, contested points — written like study notes. Specific facts over vague gestures.

Output strict JSON only: { "proposals": [{ "id": "kebab-slug", "topic": "name as given", "context": "...", "tags": ["tag1", "tag2"], "rationale": "one sentence on why it's quizzable" }] }`

  const user = `Generate context for these topics:\n${topicNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}`

  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: sys,
    messages: [{ role: 'user', content: user }],
  })

  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
  try {
    const parsed = JSON.parse(extractJSON(text))
    return parsed.proposals || []
  } catch (e) {
    throw new Error('Topic detail generation returned non-JSON: ' + text.slice(0, 300))
  }
}

// === Weekly review topic generation ===

export async function proposeNewTopics({ apiKey, pastedContent, existingTopicNames }) {
  const c = client(apiKey)

  const sys = `You help maintain a personal quiz topic bank. The user pastes recent intellectual content (chat excerpts, articles, notes, half-formed ideas) and you extract 1-3 new TOPIC entries worth adding to the bank.

A good topic is a meaty, defensible concept the user wants to retain — not trivia, not headlines. Topics should be at the granularity of "Pricing power and cost pass-through" or "Ptolemaic vs Copernican models", not "Apple's Q3 results".

Reject content that's too narrow, too broad, or too time-bound to be quizzable in 6 months. If nothing in the content rises to that bar, return an empty array — better to skip than pad.

DO NOT propose topics that overlap substantially with existing ones in the bank. Existing names will be provided.

Each proposal needs:
- id (kebab-case slug, must be unique vs existing topics)
- topic (short title, max ~60 chars)
- context (a paragraph 100-300 words capturing the meat: key claims, mechanisms, sources, contested points. Written like a study note. Specific facts > vague gestures.)
- tags (array of 1-3 lowercase tags)
- rationale (1 sentence — why this is worth adding, what makes it quizzable)

Output strict JSON only: { "proposals": [...] }`

  const user = `EXISTING TOPICS (do not duplicate):
${existingTopicNames.map(n => '- ' + n).join('\n')}

PASTED CONTENT:
${pastedContent}

Propose 1-3 topics, or fewer if nothing meets the bar.`

  const resp = await c.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: sys,
    messages: [{ role: 'user', content: user }],
  })

  const text = resp.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')

  try {
    const parsed = JSON.parse(extractJSON(text))
    return parsed.proposals || []
  } catch (e) {
    throw new Error('Topic proposal returned non-JSON: ' + text.slice(0, 300))
  }
}
