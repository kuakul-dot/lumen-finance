// Vercel Edge Function — GET /api/splits?symbols=NVDA,AAPL
// Returns { "NVDA": [{ date: unixSec, numerator, denominator, ratio }], ... }
// ratio = shares multiplier (10:1 forward split → 10 ; 1:5 reverse → 0.2)
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
    return new Response(JSON.stringify({}), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  const syms = symbols.split(',').map(s => s.trim()).filter(Boolean)
  const entries = await Promise.all(syms.map(fetchSplitEvents))
  const result = {}
  entries.forEach(({ sym, events }) => { if (events.length > 0) result[sym] = events })

  return new Response(JSON.stringify(result), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 's-maxage=21600, stale-while-revalidate=43200',
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

async function fetchSplitEvents(sym) {
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=10y&events=split`,
        { headers: HEADERS, signal: AbortSignal.timeout(10000) }
      )
      if (r.ok) {
        const json = await r.json()
        const splits = json?.chart?.result?.[0]?.events?.splits
        if (splits) {
          const events = Object.values(splits)
            .map(s => {
              const num = Number(s.numerator) || 0
              const den = Number(s.denominator) || 0
              return { date: s.date, numerator: num, denominator: den, ratio: den > 0 ? num / den : 0 }
            })
            .filter(s => s.ratio > 0 && s.ratio !== 1)
            .sort((a, b) => a.date - b.date)
          return { sym, events }
        }
      }
    } catch { /* try next host */ }
  }
  return { sym, events: [] }
}
