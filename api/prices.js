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
  const entries = await Promise.all(syms.map(fetchChart))
  const result = {}
  entries.forEach(({ sym, data }) => { if (data) result[sym] = data })

  return new Response(JSON.stringify(result), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 's-maxage=900, stale-while-revalidate=1800',
    },
  })
}

async function fetchChart(sym) {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://finance.yahoo.com/',
    Origin: 'https://finance.yahoo.com',
  }
  const params = '?interval=1d&range=1d&events=div,splits'

  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}${params}`,
        { headers, signal: AbortSignal.timeout(8000) }
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
  // Yahoo returns yield as a decimal (0.05 = 5%); convert to percentage
  const rawYield = meta.dividendYield ?? meta.trailingAnnualDividendYield ?? 0
  const divYield = rawYield > 0 ? rawYield * 100 : 0
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
