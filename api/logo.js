// Vercel Edge Function — GET /api/logo?ticker=NVDA&region=US
// Resolves a TradingView "logoid" via their symbol-search, then 302-redirects
// to the SVG logo CDN. Returns 404 when no logo is found so the <img> onError
// fallback (parqet → initials) can take over. Heavily cached.
export const config = { runtime: 'edge' }

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.tradingview.com/',
  Origin: 'https://www.tradingview.com',
}

const US_EXCH = ['NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'NYSE ARCA', 'BATS', 'CBOE']

function corsMiss(status) {
  return new Response(null, {
    status,
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 's-maxage=86400' },
  })
}

export default async function handler(request) {
  const { searchParams } = new URL(request.url)
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase().replace(/\.BK$/i, '')
  const region = (searchParams.get('region') || 'US').toUpperCase()
  if (!ticker) return corsMiss(400)

  const wantExch = region === 'TH' ? ['SET'] : US_EXCH
  const strip = s => String(s || '').replace(/<[^>]*>/g, '').toUpperCase()

  try {
    const r = await fetch(
      `https://symbol-search.tradingview.com/symbol_search/?text=${encodeURIComponent(ticker)}&hl=0&lang=en&type=stock&domain=production`,
      { headers: HEADERS, signal: AbortSignal.timeout(8000) }
    )
    if (!r.ok) return corsMiss(404)
    const list = await r.json()
    if (!Array.isArray(list) || list.length === 0) return corsMiss(404)

    // 1) exact ticker + preferred exchange + has logo
    // 2) exact ticker with any logo
    // 3) any result on a preferred exchange with a logo
    const exact = list.filter(x => strip(x.symbol) === ticker && x.logoid)
    const pick =
      exact.find(x => wantExch.includes(strip(x.exchange))) ||
      exact[0] ||
      list.find(x => x.logoid && wantExch.includes(strip(x.exchange)))
    if (!pick?.logoid) return corsMiss(404)

    const url = `https://s3-symbol-logo.tradingview.com/${pick.logoid}.svg`
    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=604800, stale-while-revalidate=2592000',
      },
    })
  } catch {
    return corsMiss(404)
  }
}
