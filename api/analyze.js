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
  const rebalanceHealth = body?.rebalanceHealth || null
  const holding = body?.holding || null
  const fundamentals = body?.fundamentals || null
  const ta = body?.ta || null
  // Limit chat history to the last 6 messages (≈3 Q&A pairs).
  const HISTORY_TAIL = 6
  const rawHistory = Array.isArray(body?.history) ? body.history : []
  const history = rawHistory.filter(m => m && m.role && m.content).slice(-HISTORY_TAIL)
  while (history.length && history[0].role === 'user') history.shift()
  const isFollowUp = history.length > 0
  // Pick the right prompt builder based on what the client asked for. Follow-ups
  // always use the compact continuation prompt regardless of kind.
  let prompt
  if (isFollowUp)                prompt = buildFollowUpPrompt(portfolio, lang)
  else if (kind === 'rebalance') prompt = buildRebalancePrompt(portfolio, extra, lang)
  else if (kind === 'portfolioReview') prompt = buildPortfolioReviewPrompt(portfolio, rebalanceHealth, lang)
  else if (kind === 'holding')   prompt = buildHoldingPrompt(portfolio, holding, fundamentals, ta, lang)
  else                           prompt = buildPrompt(portfolio, lang)
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

// Per-holding deep-dive — used by the Portfolio page's per-row AI button.
function buildHoldingPrompt(portfolio, h, fund, ta, lang) {
  h = h || {}
  const counts = portfolio?.counts || {}
  const totals = portfolio?.totals || {}
  const stocksTotal = Number(totals.stocksTHB) || 0
  // Identify same-region and same-class peers in the user's portfolio so AI
  // can talk about correlation/concentration with actual neighbours.
  const peers = (portfolio?.stocks || []).filter(s => s.ticker !== h.ticker)
  const sameClass = peers.filter(s => s.cls === h.cls).slice(0, 8)
  const regionLabel = h.region === 'TH' ? 'หุ้นไทย' : 'หุ้น US'
  const enRegion = h.region === 'TH' ? 'Thai' : 'US'

  // Build fundamentals block (only if we got data from Yahoo/FMP)
  const fundBlock = fund ? formatFundamentals(fund, lang) : null
  // Build TA block (only if we got enough price history)
  const taBlock = ta ? formatTA(ta, lang) : null

  // When no live fundamental data, instruct AI to draw on its training knowledge
  const noFundNote = fund ? null : h.region === 'TH'
    ? `⚠️ ไม่มีข้อมูลงบการเงินแบบ real-time (หุ้นไทยใน SET มักไม่ครบใน Yahoo Finance)
ให้ใช้ความรู้จาก training data เกี่ยวกับ ${h.ticker} (${h.name || ''}) ดังนี้:
- ธุรกิจหลักและ sector ของบริษัท
- ขนาด (large-cap / mid-cap) และสถานะในตลาด SET
- ประวัติเงินปันผล / ความสม่ำเสมอของ dividend
- ปัจจัยเสี่ยงและโอกาสที่รู้จาก public record
- ตัวเลขใดๆ ที่ระบุต้องบอกว่า "จาก training data ณ วันที่รู้จัก" ไม่ใช่ real-time`
    : `⚠️ No real-time fundamental data available. Use training knowledge about ${h.ticker} (${h.name || ''}): describe the business, sector, rough valuation context, dividend history, and key risks. Label any figures as "from training data, not real-time".`

  return lang === 'th'
    ? `คุณคือผู้ช่วยวิเคราะห์การลงทุนรายตัว ทำหน้าที่ "เพื่อนผู้รู้" — ไม่ใช่ที่ปรึกษาทางการเงิน ห้ามแนะนำซื้อ-ขายเด็ดขาด

ผู้ใช้คลิกที่หุ้น **${h.ticker}** (${h.name || h.ticker}) เพื่อขอบทวิเคราะห์เฉพาะตัว

ข้อมูลที่ผู้ใช้ถือ:
- กลุ่ม: ${regionLabel} · ${h.cls || 'Equity'}
- ถือ ${h.shares} หุ้น · ราคาทุน ${h.costNative} → ปัจจุบัน ${h.priceNative} ${h.nativeCcy}/หุ้น
- มูลค่ารวม: ฿${(h.valueTHB || 0).toLocaleString()} · กำไร/ขาดทุน ${h.plPct != null ? (h.plPct >= 0 ? '+' : '') + h.plPct + '%' : 'n/a'}
- น้ำหนักในพอร์ตหุ้น: ${h.pctOfStocks}% (จากหุ้นรวม ฿${stocksTotal.toLocaleString()})
- ปันผลคาดการณ์: ${h.divYield}% · วันนี้ ${h.changePct != null ? (h.changePct >= 0 ? '+' : '') + h.changePct + '%' : 'n/a'}

พอร์ตทั้งหมด: ${counts.stocksTotal || 0} หลักทรัพย์ (${counts.stocksTH || 0} TH, ${counts.stocksUS || 0} US)

หุ้นกลุ่ม "${h.cls}" อื่นในพอร์ตนี้:
${sameClass.length ? sameClass.map(s => `- ${s.ticker} (${s.region}) · ${s.pctOfStocks}% · ${s.plPct != null ? (s.plPct >= 0 ? '+' : '') + s.plPct + '%' : 'n/a'}`).join('\n') : '(ไม่มี)'}
${fundBlock ? '\n' + fundBlock : ''}
${noFundNote ? '\n' + noFundNote : ''}
${taBlock ? '\n' + taBlock : ''}

โปรดวิเคราะห์เป็นภาษาไทยกระชับ ในรูปแบบ markdown 4 หัวข้อ:

## บทบาทในพอร์ต
- น้ำหนัก, สถานะ (top/concentration), ผลงานเทียบสัดส่วน

## งบการเงิน (Fundamentals)
${fund
  ? '- ใช้ตัวเลขจากบล็อก "งบการเงิน" ข้างต้น ตีความ valuation, profitability, growth, debt, dividend\n- ระบุจุดแข็ง/อ่อน — ห้ามแต่งตัวเลขที่ไม่มีในบล็อก'
  : '- ไม่มีข้อมูล real-time — ให้ใช้ความรู้จาก training ตามที่ระบุในบล็อก noFundNote ข้างต้น\n- ให้ข้อมูลที่มีประโยชน์จริง: ธุรกิจ, sector, dividend history, ปัจจัยเสี่ยง\n- ห้ามปฏิเสธว่า "วิเคราะห์ไม่ได้" ให้ใช้ความรู้ที่มีแล้วบอก disclaimer ท้าย'}

## มุมมองเทคนิค (Technical)
${ta ? '- ใช้ตัวเลขจากบล็อก "เทคนิค" — ตำแหน่งราคาเทียบ MA, RSI, แนวรับ-แนวต้านจาก swing high/low + 52-week range\n- ห้ามแต่งระดับราคาที่ไม่มีในบล็อก' : '- ไม่มีข้อมูลราคาย้อนหลัง → ระบุสั้นๆ'}

## สิ่งที่อาจพิจารณา
2-3 ข้อ — ใช้คำ "อาจ/ควรพิจารณา" ห้าม "ต้อง" ห้ามแนะนำซื้อ-ขายโดยตรง

ลงท้าย: "บทวิเคราะห์นี้สร้างโดย AI เพื่อการศึกษาเท่านั้น ไม่ใช่คำแนะนำการลงทุน"`
    : `You are a single-holding analysis helper. Never recommend buying or selling.

User clicked **${h.ticker}** (${h.name || h.ticker}).

User's position:
- Class: ${enRegion} · ${h.cls || 'Equity'}
- Holds ${h.shares} · Cost ${h.costNative} → Now ${h.priceNative} ${h.nativeCcy}/share
- Value: ฿${(h.valueTHB || 0).toLocaleString()} · P/L: ${h.plPct != null ? (h.plPct >= 0 ? '+' : '') + h.plPct + '%' : 'n/a'}
- Weight in stocks: ${h.pctOfStocks}% (of ฿${stocksTotal.toLocaleString()})
- Div yield: ${h.divYield}% · Today: ${h.changePct != null ? (h.changePct >= 0 ? '+' : '') + h.changePct + '%' : 'n/a'}

Portfolio: ${counts.stocksTotal || 0} holdings (${counts.stocksTH || 0} TH, ${counts.stocksUS || 0} US).

Same-class peers in this portfolio:
${sameClass.length ? sameClass.map(s => `- ${s.ticker} (${s.region}) · ${s.pctOfStocks}% · ${s.plPct != null ? (s.plPct >= 0 ? '+' : '') + s.plPct + '%' : 'n/a'}`).join('\n') : '(none)'}
${fundBlock ? '\n' + fundBlock : ''}
${noFundNote ? '\n' + noFundNote : ''}
${taBlock ? '\n' + taBlock : ''}

Reply in markdown with 4 sections:
## Role in portfolio — weight, status, performance vs peers
## Fundamentals — ${fund ? 'use figures from the block above; cite sources; no fabrication' : 'no real-time data; use training knowledge per noFundNote above; describe business/sector/dividend history/risks; add "from training data" disclaimer; do NOT refuse to analyse'}
## Technical — ${ta ? 'use levels from block above; no fabrication' : 'note data unavailable briefly'}
## Things to consider — 2-3 bullets, "might/consider", no direct buy/sell

End with: "AI-generated analysis for education only — not investment advice."`
}

// Format the fundamentals data Yahoo gave us into a compact bullet block.
// Skips fields that came back as null so the prompt stays tight.
function formatFundamentals(f, lang) {
  if (!f) return null
  const isTh = lang === 'th'
  const rows = []
  const push = (label, value, suffix = '') => {
    if (value != null && value !== '') rows.push(`- ${label}: ${value}${suffix}`)
  }
  const fmtMoney = (v) => v == null ? null : v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v.toLocaleString()
  push(isTh ? 'ราคา/Target' : 'Price/Target', f.currentPrice != null ? `${f.currentPrice}${f.targetMeanPrice ? ` (target ${f.targetMeanPrice})` : ''}` : null)
  push('P/E (trailing/forward)', [f.trailingPE, f.forwardPE].filter(x => x != null).join(' / ') || null)
  push('P/B · P/S', [f.priceToBook, f.priceToSales].filter(x => x != null).join(' · ') || null)
  push(isTh ? 'อัตรากำไร (gross/op/net)' : 'Margins (gross/op/net)',
    [f.grossMargin, f.operatingMargin, f.profitMargin].filter(x => x != null).map(x => x + '%').join(' / ') || null)
  push('ROE · ROA', [f.roe, f.roa].filter(x => x != null).map(x => x + '%').join(' · ') || null)
  push(isTh ? 'เติบโต รายได้/กำไร YoY' : 'Growth rev/earnings YoY',
    [f.revenueGrowth, f.earningsGrowth].filter(x => x != null).map(x => (x >= 0 ? '+' : '') + x + '%').join(' / ') || null)
  push('Debt/Equity · Current ratio', [f.debtToEquity, f.currentRatio].filter(x => x != null).join(' · ') || null)
  push(isTh ? 'ปันผล yield/payout' : 'Dividend yield/payout',
    [f.dividendYield, f.payoutRatio].filter(x => x != null).map(x => x + '%').join(' / ') || null)
  push(isTh ? 'ช่วง 52 สัปดาห์' : '52-week range', (f.fiftyTwoWeekLow && f.fiftyTwoWeekHigh) ? `${f.fiftyTwoWeekLow} – ${f.fiftyTwoWeekHigh}` : null)
  push('Market cap', fmtMoney(f.marketCap))
  push(isTh ? 'คำแนะนำนักวิเคราะห์' : 'Analyst rating', f.recommendationKey ? `${f.recommendationKey}${f.numAnalystOpinions ? ' (' + f.numAnalystOpinions + ' analysts)' : ''}` : null)
  // Income history (4 yrs)
  if (f.incomeHistory && f.incomeHistory.length) {
    const lines = f.incomeHistory
      .filter(r => r.period)
      .map(r => `${r.period}: rev ${fmtMoney(r.revenue) || '?'} · netIncome ${fmtMoney(r.netIncome) || '?'}`)
      .join(' · ')
    if (lines) rows.push(`- ${isTh ? 'รายได้/กำไรย้อนหลัง' : 'Income history'}: ${lines}`)
  }
  if (rows.length === 0) return null
  const heading = isTh ? '📊 งบการเงิน (จาก Yahoo Finance)' : '📊 Fundamentals (from Yahoo Finance)'
  return `${heading}:\n${rows.join('\n')}`
}

// Format computed TA indicators into a compact block.
function formatTA(t, lang) {
  if (!t) return null
  const isTh = lang === 'th'
  const rows = []
  if (t.price != null && t.ma20 != null && t.ma50 != null) {
    rows.push(`- ${isTh ? 'ราคาเทียบ MA' : 'Price vs MA'}: ${t.price} · MA20 ${t.ma20} · MA50 ${t.ma50}${t.ma200 != null ? ` · MA200 ${t.ma200}` : ''}`)
  }
  if (t.rsi14 != null) rows.push(`- RSI (14): ${t.rsi14} ${t.rsi14 >= 70 ? '(overbought)' : t.rsi14 <= 30 ? '(oversold)' : ''}`)
  if (t.high52 != null && t.low52 != null) {
    rows.push(`- ${isTh ? '52 สัปดาห์' : '52-week'}: low ${t.low52} – high ${t.high52} (ตอนนี้ ${t.range52pct}% ของช่วง)`)
  }
  if (t.recentHigh != null && t.recentLow != null) {
    rows.push(`- ${isTh ? 'แนวรับ/ต้านล่าสุด (3 เดือน)' : 'Recent S/R (3mo)'}: support ${t.recentLow} · resistance ${t.recentHigh}`)
  }
  if (t.bollinger) rows.push(`- Bollinger (20,2): ${t.bollinger.lower} – ${t.bollinger.mid} – ${t.bollinger.upper}`)
  if (t.momentum) {
    const m = t.momentum
    const parts = []
    if (m.d20 != null) parts.push(`20d ${m.d20 >= 0 ? '+' : ''}${m.d20}%`)
    if (m.d50 != null) parts.push(`50d ${m.d50 >= 0 ? '+' : ''}${m.d50}%`)
    if (m.d200 != null) parts.push(`200d ${m.d200 >= 0 ? '+' : ''}${m.d200}%`)
    if (parts.length) rows.push(`- ${isTh ? 'momentum' : 'Momentum'}: ${parts.join(' · ')}`)
  }
  if (rows.length === 0) return null
  const heading = isTh ? '📈 เทคนิค (คำนวณจากราคาปิดจริง)' : '📈 Technical (computed from real closes)'
  return `${heading}:\n${rows.join('\n')}`
}

// Explain a set of suggested rebalancing trades — used by the Tools page.
function buildRebalancePrompt(portfolio, rb, lang) {
  rb = rb || {}
  const totals = portfolio?.totals || {}
  const counts = portfolio?.counts || {}
  const driftSummary = (rb.drift || []).map(d =>
    `${d.name}: เป้า ${d.targetPct}%, ปัจจุบัน ${d.nowPct}%, หลังปรับ ${d.afterPct}% (ส่วนต่าง ${d.diffPct >= 0 ? '+' : ''}${d.diffPct}%)`
  ).join('\n')
  const tradeSummary = (rb.trades || []).map(t => {
    const action = t.action === 'Sell' ? 'ขาย' : 'ซื้อ'
    const line = `${action} ${t.ticker} (${t.name || t.ticker}) ${t.shares} หุ้น @ ${t.priceNative} ${t.nativeCcy} ≈ ฿${Math.round(t.amount).toLocaleString()}`
    const ctx = []
    if (t.withinClassPct != null && t.withinClassTarget != null)
      ctx.push(`น้ำหนักในกลุ่ม ${t.cls}: ปัจจุบัน ${t.withinClassPct}% → เป้า ${t.withinClassTarget}% (drift ${(t.withinClassPct - t.withinClassTarget).toFixed(1)}%)`)
    if (t.plPct != null)
      ctx.push(`P/L: ${t.plPct >= 0 ? '+' : ''}${t.plPct}%`)
    if (t.peers && t.peers.length > 0)
      ctx.push(`หุ้นอื่นในกลุ่มเดียวกัน: ${t.peers.map(p => `${p.ticker} (${p.withinClassPct}%)`).join(', ')}`)
    return ctx.length ? `${line}\n  └ ${ctx.join(' · ')}` : line
  }).join('\n')
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

กรุณาอธิบาย markdown 5 หัวข้อ:

## เหตุผลของแผน (Why)
ทำไมระบบเลือก trade เหล่านี้ — โยงกับ drift, target และ weight ภายในกลุ่ม bullet 2-3 ข้อ

## วิเคราะห์รายเทรด (Per-trade)
สำหรับแต่ละ trade อธิบาย 1 bullet ว่า:
- ทำไมเลือก ticker นี้ (เทียบกับ peers ในกลุ่มเดียวกัน ถ้ามี)
- ข้อดี/ข้อควรระวังเฉพาะตัว เช่น P/L, timing, concentration
- หากมี peer ที่อาจพิจารณาแทนได้ → ระบุพร้อมเหตุผลสั้น ๆ

## ผลกระทบต่อพอร์ต (Impact)
หลัง execute: risk concentration, FX exposure, dividend stream — bullet 2-3 ข้อ

## ทางเลือกที่อาจพิจารณา (Alternatives)
2 ทางเลือก เช่น DCA แทน lump-sum, เลื่อน, ขายตัวอื่นแทน

## ข้อควรระวัง (Watch-outs)
ค่าธรรมเนียม, ภาษี withholding, FX timing — bullet 2-3 ข้อ

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

// Portfolio health review — does the user need to rebalance?
// Returns recommendations based on calendar-based (1 year) and drift-based (±5%) rules.
function buildPortfolioReviewPrompt(portfolio, health, lang) {
  health = health || {}
  const totals = portfolio?.totals || {}
  const counts = portfolio?.counts || {}
  const driftSummary = (health.recommendations?.calendarRule || '') + '\n' + (health.recommendations?.driftRule || '')

  return lang === 'th'
    ? `คุณคือผู้ช่วยวิเคราะห์ว่าพอร์ตการลงทุนของผู้ใช้ควรปรับ (rebalance) หรือไม่ ตอบเป็นภาษาไทยลื่นๆ ไม่ใช่ที่ปรึกษาทางการเงิน

ภาพรวมพอร์ต:
- Net worth ฿${(totals.netWorthTHB || 0).toLocaleString()} (หุ้น ฿${(totals.stocksTHB || 0).toLocaleString()}, เงินสด ฿${(totals.cashTHB || 0).toLocaleString()})
- หลักทรัพย์ทั้งหมด ${counts.stocksTotal || 0} (TH ${counts.stocksTH || 0}, US ${counts.stocksUS || 0})

สถานะการปรับพอร์ต:
- สัดส่วนเบี่ยงไปสูงสุด: ${health.maxDrift || 0}% จากเป้า
- ปรับครั้งล่าสุด: ${health.lastRebalanceDate || "ไม่เคยปรับ"}
- วันที่ผ่านมา: ${health.daysSinceRebalance || 0} วัน
- ความเร่งด่วน (Overdue): ${health.isOverdue ? 'ใช่ (ครบ 1 ปีแล้ว)' : 'ไม่ยัง'}
- เบี่ยงมากกว่า 5%: ${health.isDriftHigh ? 'ใช่' : 'ไม่'}

กฎการปรับ:
- กฎปฏิทิน: ${health.recommendations?.calendarRule || '?'}
- กฎเบี่ยง: ${health.recommendations?.driftRule || '?'}

โปรดวิเคราะห์กระชับใน 3 หัวข้อ:

## สถานะพอร์ต
ว่าพอร์ตอยู่ในสภาพไหน — ชั้นดีหรือต้องปรับ bullet 2-3 ข้อ

## ควรปรับหรือไม่
ตอบตรงประเด็น: "ควรปรับแล้ว" หรือ "ยังไม่ต้องปรับ" พร้อมเหตุผล (อ้างอิงกฎปฏิทินและเบี่ยง)

## สิ่งที่ควรทำต่อไป
1. ถ้าควรปรับ: ลองตั้ง tolerance band 5% แล้วกด Calculate เพื่อดูแผนการปรับ
2. ถ้ายังไม่ต้อง: เช็คพอร์ตอีกครั้งเมื่อไหร่ (bullet 1-2 ข้อ เช่น "อีก X เดือน" หรือ "เมื่อใด drift เกิน Y%")

ห้ามแนะนำซื้อ-ขาย ใช้คำว่า "ควร/อาจพิจารณา"`
    : `You are a portfolio rebalance health checker. Reply in English concisely.

Portfolio: net worth ฿${(totals.netWorthTHB || 0).toLocaleString()}, ${counts.stocksTotal || 0} holdings.
Max drift: ${health.maxDrift || 0}% from target
Last rebalance: ${health.lastRebalanceDate || "Never"}
Days since: ${health.daysSinceRebalance || 0}
Status: ${health.isOverdue ? '1+ year' : 'under 1 year'} · ${health.isDriftHigh ? 'drifted >5%' : 'within 5%'}

Rules:
- Calendar: ${health.recommendations?.calendarRule || '?'}
- Drift: ${health.recommendations?.driftRule || '?'}

Reply in 3 sections:
## Portfolio Health
Current state (2-3 bullets).

## Should you rebalance?
Answer directly: "Yes, time to rebalance" or "Not yet" with reasons.

## Next step
If yes: Set tolerance band to 5%, click Calculate, see the plan.
If no: When to check next (1-2 bullets, e.g. "in X months" or "when drift exceeds Y%").

Never recommend specific buys/sells; use "might/consider".`
}

// Compact prompt for follow-up turns — the AI already saw the full data on
// the initial call (in the assistant message in history), so we only re-state
// the bare essentials and let the conversation flow.
function buildFollowUpPrompt(portfolio, lang) {
  const totals = portfolio?.totals || {}
  const counts = portfolio?.counts || {}
  const stocks = portfolio?.stocks || []
  const cashList = portfolio?.cash || []
  // Pre-compute by-region totals so follow-ups can answer "What % is TH?"
  // accurately without the model having to re-aggregate the holdings array.
  const thStocks = stocks.filter(s => s.region === 'TH')
  const usStocks = stocks.filter(s => s.region !== 'TH')
  const thValue = thStocks.reduce((sum, s) => sum + (Number(s.valueTHB) || 0), 0)
  const usValue = usStocks.reduce((sum, s) => sum + (Number(s.valueTHB) || 0), 0)
  const netWorth = Number(totals.netWorthTHB) || 0
  const stocksTotal = Number(totals.stocksTHB) || (thValue + usValue)
  const pct = (v) => netWorth > 0 ? ((v / netWorth) * 100).toFixed(1) : '0'
  const cashSummary = cashList.length
    ? cashList.map(c => `${c.currency} ${c.balanceTHB.toLocaleString()}`).join(', ')
    : 'none'
  const summary = `Net worth ฿${netWorth.toLocaleString()} ` +
    `(all stocks ฿${stocksTotal.toLocaleString()} = ${pct(stocksTotal)}% of NW, ` +
    `Thai stocks ฿${thValue.toLocaleString()} = ${pct(thValue)}% of NW, ` +
    `US stocks ฿${usValue.toLocaleString()} = ${pct(usValue)}% of NW, ` +
    `cash ฿${(Number(totals.cashTHB) || 0).toLocaleString()} = ${pct(Number(totals.cashTHB) || 0)}% of NW). ` +
    `${counts.stocksTotal || 0} holdings (${counts.stocksTH || 0} TH, ${counts.stocksUS || 0} US). ` +
    `Cash accounts: ${cashSummary}.`
  return lang === 'th'
    ? `คุณกำลังต่อยอดบทสนทนาเดิม ตอบคำถามผู้ใช้ตรงประเด็น กระชับ เป็นไทยลื่นๆ
ห้ามแนะนำซื้อ-ขายหุ้นรายตัว ใช้คำว่า "อาจ/ควรพิจารณา" ไม่ใช่ "ต้อง"
เมื่อพูดถึง "หุ้น TH" หมายถึง **หุ้นไทยเท่านั้น** (ไม่ใช่ stocks total)

ภาพรวมพอร์ตปัจจุบัน: ${summary}`
    : `Continue the prior conversation. Answer concisely.
"TH stocks" means Thai-listed stocks only, NOT total stocks.
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
