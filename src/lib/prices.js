// Yahoo Finance prices — fetches via CORS proxy (Yahoo Finance blocks cross-origin requests)

const CACHE_TTL = 15 * 60 * 1000
let _cache = { key: '', ts: 0, data: {} }

export function toYahooSymbol(ticker, region = 'TH', assetClass = 'Equity') {
  const t = ticker.toUpperCase()
  if (assetClass === 'Crypto')    return t.includes('-') ? t : `${t}-USD`
  if (assetClass === 'Commodity') {
    if (t === 'GOLD' || t === 'XAU')   return 'GC=F'
    if (t === 'SILVER' || t === 'XAG') return 'SI=F'
    if (t === 'OIL')                   return 'CL=F'
  }
  if (region === 'TH') return `${t}.BK`
  return t
}

// Build candidate URLs for a Yahoo Finance chart request (direct + two CORS proxies)
function candidateUrls(sym) {
  const base =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
    `?interval=1d&range=1d`
  return [
    // 1. Direct (works if user's browser/network doesn't enforce CORS)
    base,
    // 2. allorigins.win — free CORS proxy, different IP pool
    `https://api.allorigins.win/raw?url=${encodeURIComponent(base)}`,
    // 3. corsproxy.io — second free CORS proxy as final fallback
    `https://corsproxy.io/?${encodeURIComponent(base)}`,
  ]
}

async function fetchOneChart(sym) {
  for (const url of candidateUrls(sym)) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!r.ok) continue
      const data = parseChartMeta(await r.json())
      if (data) return data
    } catch {
      // CORS block or timeout → try next
    }
  }
  return null
}

function parseChartMeta(json) {
  const meta = json?.chart?.result?.[0]?.meta
  if (!meta || meta.regularMarketPrice == null) return null
  const price     = meta.regularMarketPrice
  const prev      = meta.previousClose ?? meta.chartPreviousClose ?? price
  const changeAbs = price - prev
  const changePct = prev > 0 ? (changeAbs / prev) * 100 : 0
  return {
    price,
    currency:  meta.currency || 'USD',
    changePct: meta.regularMarketChangePercent ?? changePct,
    changeAbs,
    high:   meta.regularMarketDayHigh  ?? price,
    low:    meta.regularMarketDayLow   ?? price,
    volume: meta.regularMarketVolume   ?? 0,
    name:   meta.longName || meta.shortName || '',
  }
}

export async function fetchPrices(holdings) {
  if (!holdings || holdings.length === 0) return {}

  const symbols = [...new Set(
    holdings.map(h => toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity'))
  )]
  const cacheKey = [...symbols].sort().join(',')
  const now = Date.now()
  if (_cache.key === cacheKey && now - _cache.ts < CACHE_TTL) return _cache.data

  const results = await Promise.all(symbols.map(fetchOneChart))
  const data = {}
  symbols.forEach((sym, i) => { if (results[i]) data[sym] = results[i] })

  _cache = { key: cacheKey, ts: now, data }
  return data
}

export function clearPriceCache() {
  _cache = { key: '', ts: 0, data: {} }
}
