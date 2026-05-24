// Yahoo Finance symbol mapping + price fetching with session cache

const CACHE_TTL = 15 * 60 * 1000 // 15 minutes
let _cache = { key: '', ts: 0, data: {} }

// Map user ticker + region to Yahoo Finance symbol
export function toYahooSymbol(ticker, region = 'TH', assetClass = 'Equity') {
  const t = ticker.toUpperCase()
  if (assetClass === 'Crypto') {
    // BTC → BTC-USD, ETH → ETH-USD
    return t.includes('-') ? t : `${t}-USD`
  }
  if (assetClass === 'Commodity') {
    if (t === 'GOLD' || t === 'XAU')  return 'GC=F'   // Gold futures
    if (t === 'SILVER' || t === 'XAG') return 'SI=F'  // Silver futures
    if (t === 'OIL')                  return 'CL=F'   // Crude oil
  }
  if (region === 'TH') return `${t}.BK`
  return t // US or other exchange
}

// Fetch prices for a list of raw holdings from Supabase
export async function fetchPrices(holdings) {
  if (!holdings || holdings.length === 0) return {}

  const symbols = [...new Set(
    holdings.map(h => toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity'))
  )]
  const cacheKey = [...symbols].sort().join(',')
  const now = Date.now()

  if (_cache.key === cacheKey && now - _cache.ts < CACHE_TTL) {
    return _cache.data
  }

  const res = await fetch(`/api/prices?symbols=${encodeURIComponent(symbols.join(','))}`)
  if (!res.ok) throw new Error(`Price API ${res.status}`)

  const data = await res.json()
  _cache = { key: cacheKey, ts: now, data }
  return data
}

// Force refresh (bypass cache)
export function clearPriceCache() {
  _cache = { key: '', ts: 0, data: {} }
}
