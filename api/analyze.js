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
  const kind = body?.kind || 'overview'
  const extra = body?.rebalance || null
  // Limit chat history to the last 6 messages (≈3 Q&A pairs).
  const HISTORY_TAIL = 6
  const rawHistory = Array.isArray(body?.history) ? body.history : []
  const history = rawHistory.filter(m => m && m.role && m.content).slice(-HISTORY_TAIL)
  while (history.length && history[0].role === 'user') history.shift()
  const isFollowUp = history.length > 0
  // Pick the right prompt builder based on what the client asked for. Follow-ups
  // always use the compact continuation prompt regardless of kind.
  let prompt
  if (isFollowUp)               prompt = buildFollowUpPrompt(portfolio, lang)
  else if (kind === 'rebalance') prompt = buildRebalancePrompt(portfolio, extra, lang)
  else                          prompt = buildPrompt(portfolio, lang)
  const messages = [{ role: 'user', content: prompt }, ...history]
  // Cap output too — follow-ups are answers to single questions, not the
  // 4-section structured analysis the initial call asks for.
  const maxOut = isFollowUp ? 1500 : 4096
  // Hybrid model strategy for Claude: the initial structured response is
  // deterministic and benefits more from Haiku's speed (avoids Vercel Hobby's
  // ~25 s edge timeout), while follow-ups gain from Sonnet's reasoning.
  // Auto-downgrade Sonnet → Haiku for the initial call when ANTHROPIC_MODEL
  // requests Sonnet, unless ANTHROPIC_FORCE_INITIAL=1 overrides.
  let claudeOverride = null
  const requested = process.env.ANTHROPIC_MODEL || ''
  if (PROVIDER === 'claude' && !isFollowUp && /sonnet/i.test(requested) && process.env.ANTHROPIC_FORCE_INITIAL !== '1') {
    claudeOverride = 'claude-haiku-4-5'
  }

  // Stream the provider response back to the client as it arrives. The TTFB
  // is the only thing Vercel times against, so streaming bypasses the 25 s
  // edge cap even for slower models like Sonnet.
  try {
    const stream = await streamProvider(PROVIDER, messages, maxOut, claudeOverride)
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Provider': PROVIDER,
        'X-Accel-Buffering': 'no',           // hint reverse-proxies not to buffer
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-Provider',
      },
    })
  } catch (e) {
    return err(502, `provider error: ${e.message || String(e)}`)
  }
}

// Explain a set of suggested rebalancing trades — used by the Tools page.
function buildRebalancePrompt(portfolio, rb, lang) {
  rb = rb || {}
  const totals = portfolio?.totals || {}
  const counts = portfolio?.counts || {}
  const driftSummary = (rb.drift || []).map(d =>
    `${d.name}: เป้า ${d.targetPct}%, ปัจจุบัน ${d.nowPct}%, หลังปรับ ${d.afterPct}% (ส่วนต่าง ${d.diffPct >= 0 ? '+' : ''}${d.diffPct}%)`
  ).join('\n')
  const tradeSummary = (rb.trades || []).map(t =>
    `${t.action === 'Sell' ? 'ขาย' : 'ซื้อ'} ${t.ticker} ${t.shares} หุ้น @ ${t.priceNative} ${t.nativeCcy} (≈ ฿${Math.round(t.amount).toLocaleString()})`
  ).join('\n')
  const modeText = rb.mode === 'withdraw' ? 'ถอนเงินออก' : 'เติมเงินเข้า'
  const cashRemainingTxt = typeof rb.cashRemaining === 'number'
    ? `เงินสดคงเหลือหลังเทรด: ฿${Math.round(rb.cashRemaining).toLocaleString()}`
    : ''

  return lang === 'th'
    ? `คุณคือผู้ช่วยอธิบายแผน rebalance ของพอร์ตการลงทุน ตอบสั้นกระชับเป็นไทยลื่นๆ ไม่ใช่ที่ปรึกษาทางการเงิน

ภาพรวมพอร์ต:
- Net worth ฿${(totals.netWorthTHB || 0).toLocaleString()} (หุ้น ฿${(totals.stocksTHB || 0).toLocaleString()}, เงินสด ฿${(totals.cashTHB || 0).toLocaleString()})
- หลักทรัพย์ทั้งหมด ${counts.stocksTotal || 0} (TH ${counts.stocksTH || 0}, US ${counts.stocksUS || 0})

โหมด: ${modeText} ฿${(rb.amount || 0).toLocaleString()}
ขายได้: ${rb.allowSales ? 'ใช่' : 'ไม่'}
Tolerance band: ${rb.band || 0}%

เป้าหมาย vs หลังปรับ:
${driftSummary || '(ไม่มี)'}

รายการซื้อ-ขายที่แนะนำ (${(rb.trades || []).length} รายการ):
${tradeSummary || '(ไม่มี)'}
${cashRemainingTxt}

กรุณาอธิบาย markdown 4 หัวข้อ:

## เหตุผลของแผน (Why)
ทำไมระบบแนะนำ trade เหล่านี้ — bullet 2-3 ข้อ โยงกับ drift และ target

## ผลกระทบต่อพอร์ต (Impact)
หลัง execute trades จะเกิดอะไร — เช่น risk concentration ลด, FX exposure เปลี่ยน, dividend stream เปลี่ยนแปลง

## ทางเลือกที่อาจพิจารณา (Alternatives)
2-3 ทางเลือกที่แตกต่างจากแผนระบบ — เช่น "ขายตัวอื่นแทน", "ใช้ DCA แทน lump-sum", "เลื่อนทำเดือนหน้า"

## ข้อควรระวัง (Watch-outs)
สิ่งที่ต้องคิดก่อนกดทำ — ค่าธรรมเนียม, ภาษี (capital gains TH withholding), market timing, FX timing — bullet 2-3 ข้อ

ลงท้ายด้วย: "บทวิเคราะห์นี้สร้างโดย AI เพื่อการศึกษาเท่านั้น ไม่ใช่คำแนะนำการลงทุน"

ห้ามแนะนำซื้อ-ขายหุ้นรายตัวอื่นนอกเหนือจากในแผน · ใช้ "อาจ/ควรพิจารณา" ไม่ใช่ "ต้อง"`
    : `You are a rebalancing-plan explainer. Reply concisely in English.

Portfolio: net worth ฿${(totals.netWorthTHB || 0).toLocaleString()}, ${counts.stocksTotal || 0} holdings.
Mode: ${rb.mode === 'withdraw' ? 'withdraw' : 'deposit'} ฿${(rb.amount || 0).toLocaleString()}, sales ${rb.allowSales ? 'allowed' : 'disabled'}, tolerance ${rb.band || 0}%.

Target vs after:
${driftSummary || '(none)'}

Suggested trades:
${tradeSummary || '(none)'}
${cashRemainingTxt}

Reply in markdown with sections: ## Why, ## Impact, ## Alternatives, ## Watch-outs (each 2-3 bullets). End with: "This is an AI-generated analysis for education only — not investment advice." Use "might/consider"; never recommend specific buys/sells outside the plan.`
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

// ── Streaming adapters — each returns a ReadableStream<Uint8Array> of plain
// text chunks (no SSE envelope; the client just concatenates). ─────────────
async function streamProvider(provider, messages, maxOut = 4096, modelOverride = null) {
  if (provider === 'claude') return streamClaude(messages, maxOut, modelOverride)
  if (provider === 'gemini') return streamGemini(messages, maxOut)
  // OpenAI streaming would go here; for now fall back to non-stream wrapping.
  const text = await callOpenAI(messages, maxOut)
  return new Response(text).body
}

async function streamClaude(messages, maxOut, modelOverride) {
  const requested = modelOverride || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'
  const wantSonnet = /sonnet/i.test(requested)
  const sonnetChain = ['claude-sonnet-4-5', 'claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-latest']
  const haikuChain  = ['claude-haiku-4-5',  'claude-3-5-haiku-20241022',  'claude-3-5-haiku-latest', 'claude-3-haiku-20240307']
  const fallbacks = wantSonnet ? [requested, ...sonnetChain, ...haikuChain] : [requested, ...haikuChain]
  let lastErr = null
  for (const model of [...new Set(fallbacks)]) {
    try { return await openClaudeStream(model, messages, maxOut) }
    catch (e) {
      lastErr = e
      if (!/404|not_found_error/i.test(e.message || '')) throw e
    }
  }
  throw lastErr || new Error('no claude model worked')
}

async function openClaudeStream(model, messages, maxOut) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxOut, messages, stream: true }),
    signal: AbortSignal.timeout(120000),
  })
  if (!r.ok) {
    let detail = ''
    try { const e = await r.json(); detail = e?.error?.type ? ` ${e.error.type}: ${e.error.message || ''}` : '' } catch {}
    throw new Error(`claude ${r.status}${detail}`)
  }
  // Parse Anthropic SSE — extract text deltas from content_block_delta events.
  return decodeAnthropicStream(r.body)
}

function decodeAnthropicStream(body) {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let idx
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            const dataLine = block.split('\n').find(l => l.startsWith('data: '))
            if (!dataLine) continue
            const json = dataLine.slice(6).trim()
            if (json === '[DONE]') continue
            try {
              const ev = JSON.parse(json)
              if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
                controller.enqueue(encoder.encode(ev.delta.text))
              }
            } catch { /* ignore malformed line */ }
          }
        }
        controller.close()
      } catch (e) {
        controller.error(e)
      }
    },
  })
}

async function streamGemini(messages, maxOut) {
  // Simple non-stream fallback for Gemini — most users on Gemini are free-tier
  // and responses fit in the budget. (Adding full streamGenerateContent SSE
  // is straightforward but not required for the 504 fix.)
  const text = await callGemini(messages, maxOut)
  return new Response(text).body
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

async function callClaude(messages, maxOut = 4096, modelOverride = null) {
  const requested = modelOverride || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'
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
