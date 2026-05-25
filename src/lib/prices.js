// Yahoo Finance symbol mapping + direct browser-side price fetching
// Fetches directly from Yahoo Finance v8/chart (CORS allowed, no cloud-IP blocking)

const CACHE_TTL = 15 * 60 * 1000 // 15 minutes
let _cache = { key: '', ts: 0, data: {} }

// Map user ticker + region to Yahoo Finance symbol
export function toYahooSymbol(ticker, region = 'TH', assetClass = 'Equity') {
  const t = ticker.toUpperCase()
  if (assetClass === 'Crypto') return t.includes('-') ? t : `${t}-USD`
  if (assetClass === 'Commodity') {
    if (t === 'GOLD' || t === 'XAU')   return 'GC=F'
    if (t === 'SILVER' || t === 'XAG') return 'SI=F'
    if (t === 'OIL')                   return 'CL=F'
  }
  if (region === 'TH') return `${t}.BK`
  return t
}

// Fetch a single symbol directly from Yahoo Finance v8/chart
async function fetchOneChart(sym) {
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
      `?interval=1d&range=1d&events=div,splits`
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) {
      // Fallback to query2
      const r2 = await fetch(
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`,
        { signal: AbortSignal.timeout(8000) }
      )
      if (!r2.ok) return null
      return parseChartMeta(await r2.json())
    }
    return parseChartMeta(await r.json())
  } catch {
    return null
  }
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

// Fetch prices for a list of raw holdings — runs in the browser (no server proxy)
export async function fetchPrices(holdings) {
  if (!holdings || holdings.length === 0) return {}

  const symbols = [...new Set(
    holdings.map(h => toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity'))
  )]
  const cacheKey = [...symbols].sort().join(',')
  const now = Date.now()
  if (_cache.key === cacheKey && now - _cache.ts < CACHE_TTL) return _cache.data

  // Parallel fetch — browser requests are not IP-blocked by Yahoo Finance
  const results = await Promise.all(symbols.map(fetchOneChart))
  const data = {}
  symbols.forEach((sym, i) => { if (results[i]) data[sym] = results[i] })

  _cache = { key: cacheKey, ts: now, data }
  return data
}

export function clearPriceCache() {
  _cache = { key: '', ts: 0, data: {} }
}
