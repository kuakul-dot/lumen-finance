// Vercel Edge Function — proxy Yahoo Finance symbol search
// GET /api/search?q=QH  →  [{symbol, name, exchange, type}]
//
// Thai stock fix: short queries without a dot also try with ".BK" appended
// so "QH" finds "QH.BK", "PTT" finds "PTT.BK", etc.
export const config = { runtime: 'edge' }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Content-Type': 'application/json',
}

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
}

async function searchYahoo(q) {
  const url =
    `https://query1.finance.yahoo.com/v1/finance/search` +
    `?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0&enableFuzzyQuery=false`
  const res = await fetch(url, { headers: YF_HEADERS })
  const data = await res.json()
  return data.quotes || []
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  if (q.length < 1) return new Response('[]', { headers: CORS })

  try {
    // For short queries without a dot (e.g. "QH", "PTT"), also search "{q}.BK"
    // so Thai SET stocks appear even without the suffix
    const queries = [q]
    if (!q.includes('.') && q.length <= 8) {
      queries.push(q + '.BK')
    }

    const allResults = await Promise.all(queries.map(qry => searchYahoo(qry).catch(() => [])))

    // Merge + deduplicate by symbol, preserving order (original query first)
    const seen = new Set()
    const merged = allResults.flat().filter(item => {
      if (!item.symbol || !(item.longname || item.shortname)) return false
      if (seen.has(item.symbol)) return false
      seen.add(item.symbol)
      return true
    })

    const quotes = merged.map(item => ({
      symbol:   item.symbol,
      name:     item.longname || item.shortname || item.symbol,
      exchange: item.exchange || '',
      type:     item.quoteType || 'EQUITY',
    }))

    return new Response(JSON.stringify(quotes), { headers: CORS })
  } catch {
    return new Response('[]', { headers: CORS })
  }
}
