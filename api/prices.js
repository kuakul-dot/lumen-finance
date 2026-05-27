// Vercel Edge Function — runs on Cloudflare network, not AWS
// Edge IPs are not blocked by Yahoo Finance (unlike serverless Lambda IPs)
export const config = { runtime: 'edge' }

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    })
  }

  const { searchParams } = new URL(request.url)
  const symbols = searchParams.get('symbols')
  if (!symbols) {
    return new Response(JSON.stringify({ error: 'symbols required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const syms = symbols.split(',').map(s => s.trim()).filter(Boolean)
  const result = await fetchQuotes(syms)

  return new Response(JSON.stringify(result), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 's-maxage=900, stale-while-revalidate=1800',
    },
  })
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
}

async function fetchQuotes(syms) {
  const result = {}

  // ── Step 1: batch v7/finance/quote (price + yield when available) ──────────
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(
        `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms.join(','))}`,
        { headers: HEADERS, signal: AbortSignal.timeout(8000) }
      )
      if (r.ok) {
        const json = await r.json()
        const quotes = json?.quoteResponse?.result || []
        quotes.forEach(q => {
          if (q.regularMarketPrice != null) result[q.symbol] = parseQuote(q)
        })
        if (Object.keys(result).length > 0) break
      }
    } catch { /* try next host */ }
  }

  // ── Step 2: v8/chart fallback for any symbol the batch missed ─────────────
  const missing = syms.filter(s => !result[s])
  if (missing.length > 0) {
    const fallbacks = await Promise.all(missing.map(sym => fetchChart(sym)))
    fallbacks.forEach(({ sym, data }) => { if (data) result[sym] = data })
  }

  // ── Step 3: for symbols with divYield=0 fetch trailing dividend events ────
  // Yahoo Finance meta often omits yield for non-US stocks; the actual
  // dividend payment history is reliably present in chart events.
  const needsDiv = Object.entries(result)
    .filter(([, d]) => d.divYield === 0 && d.price > 0)
    .map(([sym]) => sym)

  if (needsDiv.length > 0) {
    await Promise.all(needsDiv.map(async sym => {
      const divYield = await fetchDividendYield(sym, result[sym].price)
      if (divYield > 0) result[sym] = { ...result[sym], divYield }
    }))
  }

  return result
}

// Trailing 12-month dividend yield from actual payment events
async function fetchDividendYield(sym, currentPrice) {
  if (currentPrice <= 0) return 0
  const cutoffSec = Date.now() / 1000 - 365 * 86400
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1y&events=div`,
        { headers: HEADERS, signal: AbortSignal.timeout(8000) }
      )
      if (r.ok) {
        const json = await r.json()
        const dividends = json?.chart?.result?.[0]?.events?.dividends
        if (!dividends) return 0
        const annual = Object.values(dividends)
          .filter(d => d.date >= cutoffSec)
          .reduce((sum, d) => sum + (d.amount || 0), 0)
        return annual > 0 ? (annual / currentPrice) * 100 : 0
      }
    } catch { /* try next host */ }
  }
  return 0
}

function parseQuote(q) {
  const price = q.regularMarketPrice
  const prev  = q.regularMarketPreviousClose ?? q.previousClose ?? price
  const changeAbs = price - prev
  const changePct = prev > 0 ? (changeAbs / prev) * 100 : 0
  // Yahoo yields are decimals (0.05 = 5%) — convert to percentage
  const rawYield = q.trailingAnnualDividendYield ?? q.dividendYield ?? 0
  const divYield = rawYield > 0 ? rawYield * 100 : 0
  return {
    price,
    currency:  q.currency  || 'USD',
    changePct: q.regularMarketChangePercent ?? changePct,
    changeAbs,
    high:   q.regularMarketDayHigh  ?? price,
    low:    q.regularMarketDayLow   ?? price,
    volume: q.regularMarketVolume   ?? 0,
    name:   q.longName || q.shortName || '',
    divYield,
  }
}

async function fetchChart(sym) {
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`,
        { headers: HEADERS, signal: AbortSignal.timeout(8000) }
      )
      if (r.ok) {
        const data = parseChart(await r.json())
        if (data) return { sym, data }
      }
    } catch { /* try next host */ }
  }
  return { sym, data: null }
}

function parseChart(json) {
  const meta = json?.chart?.result?.[0]?.meta
  if (!meta || meta.regularMarketPrice == null) return null
  const price     = meta.regularMarketPrice
  const prev      = meta.previousClose ?? meta.chartPreviousClose ?? price
  const changeAbs = price - prev
  const changePct = prev > 0 ? (changeAbs / prev) * 100 : 0
  const rawYield  = meta.dividendYield ?? meta.trailingAnnualDividendYield ?? 0
  const divYield  = rawYield > 0 ? rawYield * 100 : 0
  return {
    price,
    currency:  meta.currency || 'USD',
    changePct: meta.regularMarketChangePercent ?? changePct,
    changeAbs,
    high:   meta.regularMarketDayHigh  ?? price,
    low:    meta.regularMarketDayLow   ?? price,
    volume: meta.regularMarketVolume   ?? 0,
    name:   meta.longName || meta.shortName || '',
    divYield,
  }
}
