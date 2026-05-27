// Vercel Edge Function — proxy Yahoo Finance symbol search
// GET /api/search?q=PTT   →  [{symbol, name, exchange, type}]
export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Content-Type': 'application/json',
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  if (q.length < 1) return new Response('[]', { headers: CORS })

  try {
    const url =
      `https://query1.finance.yahoo.com/v1/finance/search` +
      `?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0&enableFuzzyQuery=false`

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    })
    const data = await res.json()

    const quotes = (data.quotes || [])
      .filter(q => q.symbol && (q.longname || q.shortname))
      .map(q => ({
        symbol:   q.symbol,
        name:     q.longname || q.shortname || q.symbol,
        exchange: q.exchange || '',
        type:     q.quoteType || 'EQUITY',
      }))

    return new Response(JSON.stringify(quotes), { headers: CORS })
  } catch {
    return new Response('[]', { headers: CORS })
  }
}
