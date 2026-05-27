// Vercel Edge Function — historical price series from Yahoo Finance
// GET /api/history?symbol=^GSPC&range=1y[&interval=1d]
//
// Returns { symbol, range, currency, series: [{ t: unix-seconds, c: close }, ...] }
export const config = { runtime: 'edge' }

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    })
  }

  const { searchParams } = new URL(request.url)
  const symbol   = searchParams.get('symbol')
  const range    = normalizeRange(searchParams.get('range') || '1y')
  const interval = searchParams.get('interval') || '1d'
  if (!symbol) {
    return new Response(JSON.stringify({ error: 'symbol required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://finance.yahoo.com/',
    Origin: 'https://finance.yahoo.com',
  }
  const params = `?interval=${interval}&range=${range}`

  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}${params}`,
        { headers, signal: AbortSignal.timeout(8000) }
      )
      if (r.ok) {
        const j = await r.json()
        const result = j?.chart?.result?.[0]
        if (result) {
          const timestamps = result.timestamp || []
          const closes = result.indicators?.quote?.[0]?.close || []
          const series = timestamps
            .map((t, i) => ({ t, c: closes[i] }))
            .filter(p => p.c != null)
          return new Response(JSON.stringify({
            symbol,
            range,
            currency: result.meta?.currency || 'USD',
            series,
          }), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200',
            },
          })
        }
      }
    } catch { /* try next host */ }
  }

  return new Response(JSON.stringify({ symbol, range, series: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

// Accept "1m","3m","6m","1y","2y","5y","10y","max" — convert to Yahoo's "1mo" etc.
function normalizeRange(r) {
  if (/^\d+m$/.test(r)) return r.replace(/m$/, 'mo')
  const allowed = ['1d','5d','1mo','3mo','6mo','1y','2y','5y','10y','ytd','max']
  return allowed.includes(r) ? r : '1y'
}
