// Vercel Edge Function — analyst consensus, price targets, forward estimates, quarterly financials
export const config = { runtime: 'edge' }

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
}

const MODULES = [
  'recommendationTrend',
  'financialData',
  'earningsTrend',
  'earningsHistory',
  'incomeStatementHistoryQuarterly',
  'defaultKeyStatistics',
  'summaryDetail',
  'price',
].join(',')

let cachedAuth = null

async function getYahooAuth() {
  if (cachedAuth && cachedAuth.expires > Date.now()) return cachedAuth
  try {
    const r1 = await fetch('https://fc.yahoo.com/', { headers: HEADERS, signal: AbortSignal.timeout(6000) })
    const rawCookie = r1.headers.get('set-cookie') || ''
    const cookies = rawCookie.split(/,(?=[A-Za-z])/).map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')
    if (!cookies) return null
    const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...HEADERS, Cookie: cookies },
      signal: AbortSignal.timeout(6000),
    })
    if (!r2.ok) return null
    const crumb = (await r2.text()).trim()
    if (!crumb) return null
    cachedAuth = { cookies, crumb, expires: Date.now() + 3600 * 1000 }
    return cachedAuth
  } catch { return null }
}

const num = x => (x && typeof x.raw === 'number') ? x.raw : null
const r2  = x => x == null ? null : +x.toFixed(2)

function fmtHistQ(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const yr2 = (d.getFullYear() + 543) % 100
  const q   = Math.ceil((d.getMonth() + 1) / 3)
  return `Q${q}/${yr2}`
}

function extract(d) {
  const fd    = d.financialData || {}
  const ks    = d.defaultKeyStatistics || {}
  const sd    = d.summaryDetail || {}
  const price = d.price || {}

  // Analyst consensus — use most recent period (index 0)
  const trend = (d.recommendationTrend?.recommendationTrend || [])[0] || {}
  const sb = trend.strongBuy || 0, b = trend.buy || 0, h = trend.hold || 0
  const s  = trend.sell || 0,      ss = trend.strongSell || 0

  // Forward estimates (0q, +1q, 0y, +1y)
  const PERIOD_FALLBACK = { '0q': 'This Q', '+1q': 'Next Q', '0y': 'This FY', '+1y': 'Next FY' }
  const estimates = (d.earningsTrend?.trend || []).slice(0, 4).map(t => {
    const endRaw  = t.endDate
    const endDate = endRaw
      ? (typeof endRaw === 'string' ? endRaw : endRaw.fmt || null)
      : null
    let label = PERIOD_FALLBACK[t.period] || t.period || ''
    if (endDate) {
      const dt  = new Date(endDate)
      const yr  = dt.getFullYear() + 543
      const yr2 = yr % 100
      const q   = Math.ceil((dt.getMonth() + 1) / 3)
      label = (t.period === '0y' || t.period === '+1y') ? `FY${yr}E` : `Q${q}/${yr2}E`
    }
    return {
      period: t.period || '',
      label,
      endDate,
      epsEst:    r2(num(t.earningsEstimate?.avg)),
      epsLow:    r2(num(t.earningsEstimate?.low)),
      epsHigh:   r2(num(t.earningsEstimate?.high)),
      epsYearAgo:r2(num(t.earningsEstimate?.yearAgoEps)),
      revEst:    num(t.revenueEstimate?.avg),
      growth:    t.growth?.raw != null ? r2(t.growth.raw * 100) : null,
      analysts:  num(t.earningsEstimate?.numberOfAnalysts),
      upRev:     num(t.epsRevisions?.upLast30days),
      downRev:   num(t.epsRevisions?.downLast30days),
    }
  })

  // EPS beat/miss history — last 4 quarters, most recent first
  const beats = (d.earningsHistory?.history || [])
    .slice(-4)
    .map(h => ({
      label:    h.quarter?.fmt ? fmtHistQ(h.quarter.fmt) : null,
      actual:   r2(num(h.epsActual)),
      estimate: r2(num(h.epsEstimate)),
      surprise: h.surprisePercent?.raw != null ? r2(h.surprisePercent.raw * 100) : null,
    }))
    .reverse()

  // Quarterly income history — sort newest first, compute QoQ net income growth
  const allQ = (d.incomeStatementHistoryQuarterly?.incomeStatementHistory || [])
    .map(q => ({
      date:      q.endDate?.fmt || '',
      label:     fmtHistQ(q.endDate?.fmt || ''),
      revenue:   num(q.totalRevenue),
      netIncome: num(q.netIncome),
      eps:       r2(num(q.basicEPS) ?? num(q.dilutedEPS) ?? null),
    }))
    .filter(q => q.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))

  const quarterly = allQ.slice(0, 4).map((q, i) => {
    const prev = allQ[i + 1]
    const qoq  = prev?.netIncome && q.netIncome
      ? r2((q.netIncome - prev.netIncome) / Math.abs(prev.netIncome) * 100)
      : null
    return { ...q, qoq }
  })

  return {
    name:         price.shortName || price.longName || null,
    currency:     price.currency  || 'THB',
    currentPrice: num(fd.currentPrice),
    marketCap:    num(price.marketCap),
    trailingPE:   r2(num(ks.trailingPE)),
    forwardPE:    r2(num(ks.forwardPE)),
    priceToBook:  r2(num(ks.priceToBook)),
    dividendYield:r2((num(sd.dividendYield) || 0) * 100),
    w52high:      num(sd.fiftyTwoWeekHigh),
    w52low:       num(sd.fiftyTwoWeekLow),
    consensus: {
      strongBuy: sb, buy: b, hold: h, sell: s, strongSell: ss,
      total: sb + b + h + s + ss,
      key: (() => {
        const raw = (fd.recommendationKey || '').replace(/_([a-z])/g, (_, c) => c.toUpperCase())
        const MAP = { overweight: 'buy', outperform: 'buy', marketOutperform: 'buy', sectorOutperform: 'buy', neutral: 'hold', marketPerform: 'hold', sectorPerform: 'hold', marketWeight: 'hold', equalWeight: 'hold', underperform: 'sell', underweight: 'sell', sectorUnderperform: 'sell' }
        return MAP[raw] || raw || null
      })(),
    },
    target: {
      mean:     r2(num(fd.targetMeanPrice)),
      high:     r2(num(fd.targetHighPrice)),
      low:      r2(num(fd.targetLowPrice)),
      median:   r2(num(fd.targetMedianPrice)),
      analysts: num(fd.numberOfAnalystOpinions),
    },
    estimates,
    quarterly,
    beats,
  }
}

function json(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200',
    },
  })
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } })
  }
  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') || '').trim()
  if (!symbol) return json({})

  const auth = await getYahooAuth()

  for (const host of ['query2', 'query1']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES}` +
        (auth?.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : '')
      const r = await fetch(url, {
        headers: { ...HEADERS, ...(auth?.cookies ? { Cookie: auth.cookies } : {}) },
        signal: AbortSignal.timeout(12000),
      })
      if (r.ok) {
        const j = await r.json()
        const result = j?.quoteSummary?.result?.[0]
        if (result) return json(extract(result))
      } else if (r.status === 401 || r.status === 403) {
        cachedAuth = null
      }
    } catch { /* try next host */ }
  }
  return json({})
}
