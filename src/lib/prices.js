// Yahoo Finance prices via Vercel Edge Function proxy (/api/prices)

const CACHE_TTL         = 15 * 60 * 1000      // 15 min for stock prices
const FX_CACHE_TTL      = 60 * 60 * 1000      // 1 hr for FX rate
const HISTORY_CACHE_TTL = 60 * 60 * 1000      // 1 hr for historical series
let _cache        = { key: '', ts: 0, data: {} }
let _fxCache      = { ts: 0, rate: null }
const _histCache  = {}   // key: "symbol|range" → { ts, series, currency }

// Fetch historical close-price series for an index/symbol (e.g. ^GSPC, ^DJI).
// Returns: { series: [{ t: unixSeconds, c: close }], currency }
// Cached per symbol+range for 1 hour. Falls back to empty series on error.
export async function fetchHistory(symbol, range = '1y') {
  const key = `${symbol}|${range}`
  const now = Date.now()
  const cached = _histCache[key]
  if (cached && now - cached.ts < HISTORY_CACHE_TTL) return cached
  try {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`)
    if (res.ok) {
      const data = await res.json()
      const series = data?.series || []
      const out = { ts: now, series, currency: data?.currency || 'USD' }
      _histCache[key] = out
      return out
    }
  } catch {}
  return cached || { ts: now, series: [], currency: 'USD' }
}

// Fetch split history for symbols → { "NVDA": [{ date, ratio }], ... }
export async function fetchSplits(symbols) {
  const list = [...new Set(symbols)].filter(Boolean)
  if (list.length === 0) return {}
  try {
    const res = await fetch(`/api/splits?symbols=${encodeURIComponent(list.join(','))}`)
    if (res.ok) return await res.json()
  } catch { /* ignore */ }
  return {}
}

// Fetch live USD → THB exchange rate (USDTHB=X via Yahoo Finance)
export async function fetchFxRate() {
  const now = Date.now()
  if (_fxCache.rate && now - _fxCache.ts < FX_CACHE_TTL) return _fxCache.rate
  try {
    const res = await fetch('/api/prices?symbols=USDTHB%3DX')
    if (res.ok) {
      const data = await res.json()
      const rate = data['USDTHB=X']?.price
      if (rate && rate > 15 && rate < 150) {   // sanity check — wide enough for extreme FX moves
        _fxCache = { ts: now, rate }
        return rate
      }
    }
  } catch {}
  return _fxCache.rate ?? 36   // fall back to last known or 36
}

export function toYahooSymbol(ticker, region = 'TH', assetClass = 'Equity') {
  const t = ticker.toUpperCase()
  // Gold tickers always use futures regardless of how the asset class was entered
  if (t === 'XAU' || t === 'GOLD') return 'GC=F'
  if (assetClass === 'Crypto')     return t.includes('-') ? t : `${t}-USD`
  if (assetClass === 'GoldTH')     return 'GC=F'   // Thai physical gold → gold futures
  if (assetClass === 'Commodity') {
    if (t === 'GOLD' || t === 'XAU')   return 'GC=F'
    if (t === 'SILVER' || t === 'XAG') return 'SI=F'
    if (t === 'OIL')                   return 'CL=F'
  }
  if (assetClass === 'MutualFund') return `${t}.BK`  // Thai mutual funds listed on Yahoo
  if (region === 'TH') return `${t}.BK`
  return t
}

export async function fetchPrices(holdings) {
  if (!holdings || holdings.length === 0) return {}

  const symbols = [...new Set(
    holdings.map(h => toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity'))
  )]
  const cacheKey = [...symbols].sort().join(',')
  const now = Date.now()
  if (_cache.key === cacheKey && now - _cache.ts < CACHE_TTL) return _cache.data

  const res = await fetch(`/api/prices?symbols=${encodeURIComponent(symbols.join(','))}`)
  if (!res.ok) throw new Error(`Price API ${res.status}`)

  const data = await res.json()
  _cache = { key: cacheKey, ts: now, data }
  return data
}

export function clearPriceCache() {
  _cache = { key: '', ts: 0, data: {} }
}
