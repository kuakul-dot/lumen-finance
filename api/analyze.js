// Vercel Edge Function — POST /api/analyze
// Body: { portfolio: { totals, stocks, cash }, lang: 'th'|'en' }
// Returns: { text: "<markdown-ish analysis>" } from a provider-agnostic adapter.
// Provider is chosen by env AI_PROVIDER (default 'gemini'). Removing the
// matching API key auto-disables the feature — /api/analyze just returns 503
// and the UI hides the button.
export const config = { runtime: 'edge' }
export const maxDuration = 60   // give Claude room to think on long conversations

const PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase()

function ok(payload) {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}
function err(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
    })
  }
  // GET /api/analyze → quick availability check used by the UI to hide the
  // button when no key is configured.
  if (request.method === 'GET') {
    return ok({ available: hasKeyFor(PROVIDER), provider: PROVIDER })
  }
  if (request.method !== 'POST') return err(405, 'method not allowed')
  if (!hasKeyFor(PROVIDER)) return err(503, 'AI not configured')

  let body
  try { body = await request.json() }
  catch { return err(400, 'invalid JSON body') }

  const lang = body?.lang === 'en' ? 'en' : 'th'
  const portfolio = body?.portfolio || {}
  // Limit chat history to the last 6 messages (≈3 Q&A pairs).
  const HISTORY_TAIL = 6
  const rawHistory = Array.isArray(body?.history) ? body.history : []
  const history = rawHistory.filter(m => m && m.role && m.content).slice(-HISTORY_TAIL)
  while (history.length && history[0].role === 'user') history.shift()
  // For follow-ups, the initial analysis already lives in the chat history —
  // re-sending the full portfolio JSON + structured-reply instructions wastes
  // tokens and pushes the request over Vercel's edge timeout. Use a compact
  // continuation prompt instead.
  const isFollowUp = history.length > 0
  const prompt = isFollowUp ? buildFollowUpPrompt(portfolio, lang) : buildPrompt(portfolio, lang)
  const messages = [{ role: 'user', content: prompt }, ...history]
  // Cap output too — follow-ups are answers to single questions, not the
  // 4-section structured analysis the initial call asks for.
  const maxOut = isFollowUp ? 1500 : 4096

  try {
    const text = await callProvider(PROVIDER, messages, maxOut)
    return ok({ text, provider: PROVIDER })
  } catch (e) {
    return err(502, `provider error: ${e.message || String(e)}`)
  }
}

// Compact prompt for follow-up turns — the AI already saw the full data on
// the initial call (in the assistant message in history), so we only re-state
// the bare essentials and let the conversation flow.
function buildFollowUpPrompt(portfolio, lang) {
  const totals = portfolio?.totals || {}
  const counts = portfolio?.counts || {}
  const cashList = portfolio?.cash || []
  const cashSummary = cashList.length
    ? cashList.map(c => `${c.currency} ${c.balanceTHB.toLocaleString()}`).join(', ')
    : 'none'
  const summary = `Net worth ฿${(totals.netWorthTHB || 0).toLocaleString()} ` +
    `(stocks ฿${(totals.stocksTHB || 0).toLocaleString()}, cash ฿${(totals.cashTHB || 0).toLocaleString()}). ` +
    `${counts.stocksTotal || 0} holdings (${counts.stocksTH || 0} TH, ${counts.stocksUS || 0} US). ` +
    `Cash accounts: ${cashSummary}.`
  return lang === 'th'
    ? `คุณกำลังต่อยอดบทสนทนาเดิม ตอบคำถามผู้ใช้ตรงประเด็น กระชับ เป็นไทยลื่นๆ
ห้ามแนะนำซื้อ-ขายหุ้นรายตัว ใช้คำว่า "อาจ/ควรพิจารณา" ไม่ใช่ "ต้อง"

ภาพรวมพอร์ตปัจจุบัน: ${summary}`
    : `Continue the prior conversation. Answer the user's question concisely.
Never recommend buying or selling specific stocks; use "might/consider" not "should".

Current portfolio: ${summary}`
}

function hasKeyFor(p) {
  if (p === 'gemini') return !!process.env.GEMINI_API_KEY
  if (p === 'claude') return !!process.env.ANTHROPIC_API_KEY
  if (p === 'openai') return !!process.env.OPENAI_API_KEY
  return false
}

function buildPrompt(portfolio, lang) {
  const intro = lang === 'th'
    ? `คุณคือผู้ช่วยวิเคราะห์การลงทุนสำหรับนักลงทุนรายย่อย ทำหน้าที่ "เพื่อนผู้รู้" ที่ตรงไปตรงมา ไม่ใช่ที่ปรึกษาทางการเงิน เด็ดขาด

ข้อมูลพอร์ตของผู้ใช้ (สกุล THB ทั้งหมด ค่า value/balance ถูกแปลงเป็นบาทแล้ว):
${JSON.stringify(portfolio, null, 2)}

⚠️ คำเตือนสำคัญเรื่องการคิดสัดส่วน:
- **เมื่อพูดถึง "% ของพอร์ต" ให้ใช้ \`pctOfNetWorth\` เสมอ** (คิดจาก net worth = หุ้น + เงินสด)
- \`pctOfStocks\` คือสัดส่วนใน "หุ้นทั้งหมด" เท่านั้น — ห้ามเอามาเรียกว่า "ของพอร์ต"
- ตัวเลข weight/% ใน totals ของ allocation ต้องคิดจาก net worth ทั้งหมด ไม่ใช่จากแค่หุ้น
- คำนวณ FX exposure (USD%) จาก: (sum valueTHB ของหุ้น US + sum balanceTHB ของ cash USD) / netWorthTHB × 100

⚠️ การนับจำนวน:
- **ใช้ \`counts\` ที่ให้มาเสมอ** ห้ามไปนับจาก array \`stocks\` เอง (จะนับผิดได้)
- \`counts.stocksTH\` = จำนวนหุ้นไทย, \`counts.stocksUS\` = จำนวนหุ้น US, \`counts.stocksTotal\` = รวมทั้งหมด

โปรดวิเคราะห์เป็นภาษาไทย โดยตอบสั้นกระชับใน 4 หัวข้อ (markdown headings ##):

## จุดเด่น (Strengths)
จุดที่พอร์ตทำได้ดี — bullet 2-3 ข้อ

## ความเสี่ยงที่เห็น (Risks)
สิ่งที่อาจเป็นปัญหา เช่น กระจุกตัว, FX, sector — bullet 2-4 ข้อ พร้อมตัวเลขอ้างอิงจากข้อมูล

## ข้อสังเกตเรื่อง allocation
เปรียบเทียบสัดส่วนที่ถือ vs หลักการกระจายความเสี่ยงทั่วไป

## สิ่งที่อาจพิจารณา (Consider)
2-3 ข้อ — ใช้คำว่า "อาจ", "ควรพิจารณา" ไม่ใช่ "ต้อง" — ห้ามแนะนำซื้อ-ขายหุ้นรายตัวเด็ดขาด

ลงท้ายด้วย disclaimer 1 บรรทัด: "บทวิเคราะห์นี้สร้างโดย AI เพื่อการศึกษาเท่านั้น ไม่ใช่คำแนะนำการลงทุน"
`
    : `You are a portfolio analysis helper acting like a knowledgeable friend — never a financial advisor.

Portfolio data (all values in THB):
${JSON.stringify(portfolio, null, 2)}

Reply in English, concisely, using these markdown sections:

## Strengths
2-3 bullets on what's done well

## Risks
2-4 bullets with specific numbers from the data

## Allocation observations
Compare current allocation with general diversification principles

## Things to consider
2-3 ideas using "might", "consider" — never recommend specific stocks to buy/sell

End with: "This is an AI-generated analysis for education only — not investment advice."
`
  return intro
}

// ── Provider adapters (all receive a normalised messages array now) ────────
async function callProvider(provider, messages, maxOut = 4096) {
  if (provider === 'gemini') return callGemini(messages, maxOut)
  if (provider === 'claude') return callClaude(messages, maxOut)
  if (provider === 'openai') return callOpenAI(messages, maxOut)
  throw new Error(`unknown provider: ${provider}`)
}

async function callGemini(messages, maxOut = 4096) {
  // Try the requested model first, then fall back through progressively more
  // permissive ones on 404 (renamed/retired/region-locked) or 429 (rate-limited).
  const requested = process.env.GEMINI_MODEL || 'gemini-1.5-flash'
  const fallbacks = [requested, 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.0-flash', 'gemini-2.5-flash']
  const tried = []
  let lastErr = null
  for (const model of [...new Set(fallbacks)]) {
    try {
      tried.push(model)
      return await callGeminiModel(model, messages, maxOut)
    } catch (e) {
      lastErr = e
      const m = e.message || ''
      if (!/404|not\s*found|429|quota|rate/i.test(m)) throw e
    }
  }
  // All fallbacks failed — fetch which models the key CAN use, so the UI can show a hint.
  let hint = ''
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`, { signal: AbortSignal.timeout(8000) })
    if (r.ok) {
      const j = await r.json()
      const supported = (j?.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name?.replace(/^models\//, ''))
        .filter(Boolean).slice(0, 8)
      hint = supported.length ? ` · key supports: ${supported.join(', ')}` : ' · key returned 0 models — Generative Language API may not be enabled in your Google Cloud project'
    } else if (r.status === 403) {
      hint = ' · key forbidden (403) — Generative Language API not enabled, or key restricted'
    } else if (r.status === 400) {
      hint = ' · key invalid (400) — double-check the value in Vercel env'
    }
  } catch { /* ignore */ }
  throw new Error(`gemini: no model accepted the request (tried ${tried.join(', ')})${hint}`)
}

async function callGeminiModel(model, messages, maxOut = 4096) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.4, maxOutputTokens: maxOut },
    }),
    signal: AbortSignal.timeout(45000),
  })
  if (!r.ok) throw new Error(`gemini ${r.status}`)
  const j = await r.json()
  const cand = j?.candidates?.[0]
  const text = cand?.content?.parts?.map(p => p.text).join('') || ''
  if (!text) throw new Error('empty response')
  // If Gemini still cuts the response off, append a marker so the UI / user
  // knows it wasn't a complete answer.
  if (cand?.finishReason && cand.finishReason !== 'STOP') {
    return text + `\n\n_(หมายเหตุ: คำตอบถูกตัดจบเอง · finishReason=${cand.finishReason})_`
  }
  return text
}

async function callClaude(messages, maxOut = 4096) {
  const requested = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'
  const wantSonnet = /sonnet/i.test(requested)
  // Build a fallback chain that tries the requested family first, then
  // gracefully degrades. Sonnet-requested falls through to Haiku as a last
  // resort so the feature keeps working even if Sonnet is unavailable.
  const sonnetChain = ['claude-sonnet-4-5', 'claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-latest']
  const haikuChain  = ['claude-haiku-4-5',  'claude-3-5-haiku-20241022',  'claude-3-5-haiku-latest', 'claude-3-haiku-20240307']
  const fallbacks = wantSonnet
    ? [requested, ...sonnetChain, ...haikuChain]
    : [requested, ...haikuChain]
  const tried = []
  let lastErr = null
  for (const model of [...new Set(fallbacks)]) {
    try {
      tried.push(model)
      return await callClaudeModel(model, messages, maxOut)
    } catch (e) {
      lastErr = e
      const m = e.message || ''
      // Only fall back on model-not-found (404). Anything else (auth, rate
      // limit, billing) means the next model won't help either.
      if (!/404|not_found_error/i.test(m)) throw e
    }
  }
  throw new Error(`claude: no model worked (tried ${tried.join(', ')}) — ${lastErr?.message || ''}`)
}

async function callClaudeModel(model, messages, maxOut = 4096) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOut,
      messages,
    }),
    signal: AbortSignal.timeout(45000),
  })
  if (!r.ok) {
    let detail = ''
    try {
      const e = await r.json()
      detail = e?.error?.type
        ? ` ${e.error.type}: ${e.error.message || ''}`.trim()
        : ''
    } catch { /* ignore */ }
    throw new Error(`claude ${r.status}${detail}`)
  }
  const j = await r.json()
  return j?.content?.[0]?.text || ''
}

async function callOpenAI(messages, maxOut = 4096) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOut,
      temperature: 0.4,
      messages,
    }),
    signal: AbortSignal.timeout(45000),
  })
  if (!r.ok) throw new Error(`openai ${r.status}`)
  const j = await r.json()
  return j?.choices?.[0]?.message?.content || ''
}
