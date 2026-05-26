// Yahoo Finance prices via Vercel Edge Function proxy (/api/prices)

const CACHE_TTL    = 15 * 60 * 1000   // 15 min for stock prices
const FX_CACHE_TTL = 60 * 60 * 1000   // 1 hr for FX rate
let _cache   = { key: '', ts: 0, data: {} }
let _fxCache = { ts: 0, rate: null }

// Fetch live USD → THB exchange rate (USDTHB=X via Yahoo Finance)
export async function fetchFxRate() {
  const now = Date.now()
  if (_fxCache.rate && now - _fxCache.ts < FX_CACHE_TTL) return _fxCache.rate
  try {
    const res = await fetch('/api/prices?symbols=USDTHB%3DX')
    if (res.ok) {
      const data = await res.json()
      const rate = data['USDTHB=X']?.price
      if (rate && rate > 20 && rate < 100) {   // sanity check — realistic THB/USD range
        _fxCache = { ts: now, rate }
        return rate
      }
    }
  } catch {}
  return _fxCache.rate ?? 36   // fall back to last known or 36
}

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
