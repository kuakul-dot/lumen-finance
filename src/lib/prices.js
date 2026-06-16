// Yahoo Finance prices via Vercel Edge Function proxy (/api/prices)

const PRICE_TTL       = 5  * 60 * 1000   // 5 min  — serve fresh from API
const PRICE_STALE_TTL = 4  * 60 * 60 * 1000  // 4 hr   — serve stale on 429/error
const FX_CACHE_TTL    = 60 * 60 * 1000   // 1 hr for FX rate
const HISTORY_CACHE_TTL = 60 * 60 * 1000 // 1 hr for historical series

const LS_PRICE_KEY = 'lumen_price_cache'

// ── Persistent price cache (survives page reload) ─────────────────────────────
function _loadLS() {
  try {
    const raw = localStorage.getItem(LS_PRICE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { key: '', ts: 0, data: {} }
}

function _saveLS(c) {
  try { localStorage.setItem(LS_PRICE_KEY, JSON.stringify(c)) } catch {}
}

let _cache       = _loadLS()
let _fxCache     = { ts: 0, rate: null }
const _histCache = {}   // key: "symbol|range" → { ts, series, currency }
let _rateLimited = false  // true while last API call returned 429

// ── Public status API ─────────────────────────────────────────────────────────
// Returns the current cache freshness so UI can show a stale indicator.
export function getPriceStatus() {
  const ageMs = _cache.ts ? Date.now() - _cache.ts : null
  return {
    hasData:      Object.keys(_cache.data || {}).length > 0,
    stale:        ageMs != null && ageMs > PRICE_TTL,
    ageMinutes:   ageMs != null ? Math.floor(ageMs / 60000) : null,
    rateLimited:  _rateLimited,
  }
}

// ── Historical series ─────────────────────────────────────────────────────────
export async function fetchHistory(symbol, range = '1y') {
  const key = `${symbol}|${range}`
  const now = Date.now()
  const cached = _histCache[key]
  if (cached && now - cached.ts < HISTORY_CACHE_TTL) return cached
  try {
    const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`)
    if (res.ok) {
      const data = await res.json()
      const out = { ts: now, series: data?.series || [], currency: data?.currency || 'USD' }
      _histCache[key] = out
      return out
    }
  } catch {}
  return cached || { ts: now, series: [], currency: 'USD' }
}

// ── Stock splits ──────────────────────────────────────────────────────────────
export async function fetchSplits(symbols) {
  const list = [...new Set(symbols)].filter(Boolean)
  if (list.length === 0) return {}
  try {
    const res = await fetch(`/api/splits?symbols=${encodeURIComponent(list.join(','))}`)
    if (res.ok) return await res.json()
  } catch {}
  return {}
}

// ── FX rate ───────────────────────────────────────────────────────────────────
export async function fetchFxRate() {
  const now = Date.now()
  if (_fxCache.rate && now - _fxCache.ts < FX_CACHE_TTL) return _fxCache.rate
  try {
    const res = await fetch('/api/prices?symbols=USDTHB%3DX')
    if (res.ok) {
      const data = await res.json()
      const rate = data['USDTHB=X']?.price
      if (rate && rate > 15 && rate < 150) {
        _fxCache = { ts: now, rate }
        return rate
      }
    }
  } catch {}
  return _fxCache.rate ?? 36
}

// ── Symbol mapping ────────────────────────────────────────────────────────────
export function toYahooSymbol(ticker, region = 'TH', assetClass = 'Equity') {
  const t = ticker.toUpperCase()
  if (t === 'XAU' || t === 'GOLD') return 'GC=F'
  if (assetClass === 'Crypto')     return t.includes('-') ? t : `${t}-USD`
  if (assetClass === 'GoldTH')     return 'GC=F'
  if (assetClass === 'Commodity') {
    if (t === 'GOLD' || t === 'XAU')   return 'GC=F'
    if (t === 'SILVER' || t === 'XAG') return 'SI=F'
    if (t === 'OIL')                   return 'CL=F'
  }
  if (assetClass === 'MutualFund') return `${t}.BK`
  if (region === 'TH') return `${t}.BK`
  return t
}

// ── Main price fetch (cached + 429 fallback) ──────────────────────────────────
// Returns price map { [yahooSymbol]: { price, currency, changePercent } }.
// On rate-limit or network error, returns stale cached data with metadata:
//   _stale: true, _staleMinutes: number
// Callers checking data[symbol].price are unaffected by the extra keys.
export async function fetchPrices(holdings) {
  if (!holdings || holdings.length === 0) return {}

  const symbols = [...new Set(
    holdings.map(h => toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity'))
  )]
  const cacheKey = [...symbols].sort().join(',')
  const now = Date.now()
  const age = _cache.ts ? now - _cache.ts : Infinity
  const keysMatch = _cache.key === cacheKey

  // ── Fresh cache hit ──
  if (keysMatch && age < PRICE_TTL) {
    _rateLimited = false
    return _cache.data
  }

  // ── Try API ──
  try {
    const res = await fetch(`/api/prices?symbols=${encodeURIComponent(symbols.join(','))}`)

    if (res.status === 429) {
      _rateLimited = true
      // Serve stale if within 4-hour window
      if (keysMatch && age < PRICE_STALE_TTL) {
        return { ..._cache.data, _stale: true, _staleMinutes: Math.floor(age / 60000) }
      }
      throw new Error('Price API 429 — rate limited, no usable cache')
    }

    if (!res.ok) throw new Error(`Price API ${res.status}`)

    _rateLimited = false
    const data = await res.json()
    const next = { key: cacheKey, ts: now, data }
    _cache = next
    _saveLS(next)
    return data

  } catch (err) {
    // On any error: serve whatever stale data we have for this symbol set
    if (keysMatch && _cache.ts > 0) {
      const staleMinutes = Math.floor(age / 60000)
      return { ..._cache.data, _stale: true, _staleMinutes: staleMinutes }
    }
    // No matching cache at all — re-throw so callers know
    throw err
  }
}

// ── Cache control ─────────────────────────────────────────────────────────────
export function clearPriceCache() {
  _cache = { key: '', ts: 0, data: {} }
  _rateLimited = false
  try { localStorage.removeItem(LS_PRICE_KEY) } catch {}
}
