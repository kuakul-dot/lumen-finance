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
  // permissive ones on 404 (renamed/retired model) or 429 (rate-limited).
  const requested = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
  const fallbacks = [requested, 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b']
  const tried = []
  let lastErr = null
  for (const model of [...new Set(fallbacks)]) {
    try {
      tried.push(model)
      return await callGeminiModel(model, prompt)
    } catch (e) {
      lastErr = e
      const m = e.message || ''
      // Only fall back on retriable problems; surface real errors immediately
      if (!/404|not\s*found|429|quota|rate/i.test(m)) throw e
    }
  }
  // Bubble up the most useful tail of the last error
  throw new Error(lastErr?.message || `no gemini model worked (tried ${tried.join(', ')})`)
}

async function callGeminiModel(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!r.ok) throw new Error(`gemini ${r.status}`)
  const j = await r.json()
  const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || ''
  if (!text) throw new Error('empty response')
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
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!r.ok) throw new Error(`claude ${r.status}`)
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
