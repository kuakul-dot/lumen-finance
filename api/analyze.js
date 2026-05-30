// Vercel Edge Function — POST /api/analyze
// Body: { portfolio: { totals, stocks, cash }, lang: 'th'|'en' }
// Returns: { text: "<markdown-ish analysis>" } from a provider-agnostic adapter.
// Provider is chosen by env AI_PROVIDER (default 'gemini'). Removing the
// matching API key auto-disables the feature — /api/analyze just returns 503
// and the UI hides the button.
export const config = { runtime: 'edge' }

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
  const prompt = buildPrompt(portfolio, lang)

  try {
    const text = await callProvider(PROVIDER, prompt, lang)
    return ok({ text, provider: PROVIDER })
  } catch (e) {
    return err(502, `provider error: ${e.message || String(e)}`)
  }
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

// ── Provider adapters ──────────────────────────────────────────────────────
async function callProvider(provider, prompt) {
  if (provider === 'gemini') return callGemini(prompt)
  if (provider === 'claude') return callClaude(prompt)
  if (provider === 'openai') return callOpenAI(prompt)
  throw new Error(`unknown provider: ${provider}`)
}

async function callGemini(prompt) {
  // Try the requested model first, then fall back through progressively more
  // permissive ones on 404 (renamed/retired/region-locked) or 429 (rate-limited).
  const requested = process.env.GEMINI_MODEL || 'gemini-1.5-flash'
  const fallbacks = [requested, 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.0-flash', 'gemini-2.5-flash']
  const tried = []
  let lastErr = null
  for (const model of [...new Set(fallbacks)]) {
    try {
      tried.push(model)
      return await callGeminiModel(model, prompt)
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

async function callGeminiModel(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      // Thai text uses ~2x more tokens per character than English. Headroom
      // is more useful than a tight cap, so use the per-call ceiling that
      // gemini-1.5/2.0-flash supports (8192). The 5-per-day client cap
      // already bounds total spend.
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
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

async function callClaude(prompt) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,                   // headroom for long Thai answers
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(45000),
  })
  if (!r.ok) {
    // Anthropic returns rich JSON errors; surface the type and message so the
    // UI can tell rate-limit from billing from invalid-model.
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

async function callOpenAI(prompt) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.4,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!r.ok) throw new Error(`openai ${r.status}`)
  const j = await r.json()
  return j?.choices?.[0]?.message?.content || ''
}
