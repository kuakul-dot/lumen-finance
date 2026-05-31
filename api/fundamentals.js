// Vercel Edge Function — GET /api/fundamentals?symbol=NVDA
// Returns a compact financial-statements snapshot from Yahoo Finance's
// quoteSummary endpoint (unofficial). The full payload Yahoo returns is huge,
// so we strip it down to the figures the AI prompt actually needs.
export const config = { runtime: 'edge' }

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
}

const MODULES = [
  'financialData',
  'defaultKeyStatistics',
  'summaryDetail',
  'incomeStatementHistory',
  'earningsTrend',
  'price',
].join(',')

// Yahoo locked down quoteSummary in 2024 — it now requires a cookie + crumb
// CSRF pair before returning data. Cache the pair across requests so warm
// edge instances reuse it.
let cachedAuth = null

async function getYahooAuth() {
  if (cachedAuth && cachedAuth.expires > Date.now()) return cachedAuth
  try {
    // 1. Hit fc.yahoo.com to receive the EuConsent / A1 / A3 cookies
    const r1 = await fetch('https://fc.yahoo.com/', { headers: HEADERS, signal: AbortSignal.timeout(6000) })
    const rawCookie = r1.headers.get('set-cookie') || ''
    // Edge runtime returns the comma-joined header verbatim — split on the
    // boundary between cookies, keep only the name=value before the first ';'
    const cookies = rawCookie.split(/,(?=[A-Za-z])/).map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')
    if (!cookies) return null
    // 2. Exchange cookies for a crumb token
    const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...HEADERS, Cookie: cookies },
      signal: AbortSignal.timeout(6000),
    })
    if (!r2.ok) return null
    const crumb = (await r2.text()).trim()
    if (!crumb) return null
    cachedAuth = { cookies, crumb, expires: Date.now() + 3600 * 1000 }   // 1h
    return cachedAuth
  } catch { return null }
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
        signal: AbortSignal.timeout(10000),
      })
      if (r.ok) {
        const j = await r.json()
        const result = j?.quoteSummary?.result?.[0]
        if (result) return json(extract(result))
      } else if (r.status === 401 || r.status === 403) {
        // Auth went stale — clear cache so the next request retries fresh
        cachedAuth = null
      }
    } catch { /* try next host */ }
  }
  // Fall back to the lighter v7 quote endpoint — it doesn't always need auth
  // and gives enough partial data (PE, marketCap, 52w range, EPS, divYield)
  // to keep the AI useful when quoteSummary is blocked.
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}` +
      (auth?.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : '')
    const r = await fetch(url, {
      headers: { ...HEADERS, ...(auth?.cookies ? { Cookie: auth.cookies } : {}) },
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) {
      const j = await r.json()
      const q = j?.quoteResponse?.result?.[0]
      if (q) return json(extractQuote(q))
    }
  } catch { /* ignore */ }
  return json({})
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

function num(x) { return (x && typeof x.raw === 'number') ? x.raw : null }
function round(x, d = 2) { return x == null ? null : +x.toFixed(d) }

// Lighter parse for the v7/quote fallback — the shape is flat, not the
// {raw, fmt} envelope that quoteSummary uses.
function extractQuote(q) {
  const r = (x, d = 2) => (typeof x === 'number' ? +x.toFixed(d) : null)
  return {
    name: q.shortName || q.longName || null,
    currency: q.currency || null,
    marketCap: typeof q.marketCap === 'number' ? q.marketCap : null,
    trailingPE: r(q.trailingPE),
    forwardPE: r(q.forwardPE),
    priceToBook: r(q.priceToBook),
    dividendYield: r(typeof q.trailingAnnualDividendYield === 'number' ? q.trailingAnnualDividendYield * 100 : null, 2),
    currentPrice: typeof q.regularMarketPrice === 'number' ? q.regularMarketPrice : null,
    fiftyTwoWeekLow: typeof q.fiftyTwoWeekLow === 'number' ? q.fiftyTwoWeekLow : null,
    fiftyTwoWeekHigh: typeof q.fiftyTwoWeekHigh === 'number' ? q.fiftyTwoWeekHigh : null,
    targetMeanPrice: null,
    recommendationKey: null,
    profitMargin: null, operatingMargin: null, grossMargin: null,
    roe: null, roa: null,
    revenueGrowth: null, earningsGrowth: null,
    debtToEquity: null, currentRatio: null,
    incomeHistory: [],
  }
}

function extract(d) {
  const fd = d.financialData || {}
  const ks = d.defaultKeyStatistics || {}
  const sd = d.summaryDetail || {}
  const price = d.price || {}
  const income = (d.incomeStatementHistory?.incomeStatementHistory || []).slice(0, 4).map(s => ({
    period:      s.endDate?.fmt || null,
    revenue:     num(s.totalRevenue),
    grossProfit: num(s.grossProfit),
    operatingIncome: num(s.operatingIncome),
    netIncome:   num(s.netIncome),
  }))
  return {
    name:        price.shortName || price.longName || null,
    currency:    price.currency || null,
    marketCap:   num(price.marketCap),
    // Valuation
    trailingPE:  round(num(ks.trailingPE)),
    forwardPE:   round(num(ks.forwardPE)),
    priceToBook: round(num(ks.priceToBook)),
    priceToSales: round(num(ks.priceToSalesTrailing12Months)),
    // Profitability (these come as 0..1 decimals)
    profitMargin:    round(num(fd.profitMargins) * 100, 1),
    operatingMargin: round(num(fd.operatingMargins) * 100, 1),
    grossMargin:     round(num(fd.grossMargins) * 100, 1),
    roe:             round(num(fd.returnOnEquity) * 100, 1),
    roa:             round(num(fd.returnOnAssets) * 100, 1),
    // Growth (year-over-year, decimals)
    revenueGrowth:  round(num(fd.revenueGrowth) * 100, 1),
    earningsGrowth: round(num(fd.earningsGrowth) * 100, 1),
    // Balance sheet
    debtToEquity:  round(num(fd.debtToEquity)),
    currentRatio:  round(num(fd.currentRatio)),
    quickRatio:    round(num(fd.quickRatio)),
    totalCash:     num(fd.totalCash),
    totalDebt:     num(fd.totalDebt),
    // Dividend
    dividendYield: round(num(sd.dividendYield) * 100, 2),
    payoutRatio:   round(num(sd.payoutRatio) * 100, 1),
    // Price context
    currentPrice:    num(fd.currentPrice),
    fiftyTwoWeekLow: num(sd.fiftyTwoWeekLow),
    fiftyTwoWeekHigh: num(sd.fiftyTwoWeekHigh),
    // Analyst
    targetMeanPrice: num(fd.targetMeanPrice),
    recommendationKey: fd.recommendationKey || null,
    numAnalystOpinions: num(fd.numberOfAnalystOpinions),
    // History
    incomeHistory: income,
  }
}
