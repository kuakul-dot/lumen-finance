const CACHE_KEY        = 'lumen_news_v1'
const MARKET_CACHE_KEY = 'lumen_market_news_v1'
const MACRO_CACHE_KEY  = 'lumen_macro_news_v1'
const TTL = 15 * 60 * 1000

function loadCache(storageKey, subKey) {
  try {
    const c = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (!c) return null
    if (subKey !== undefined && c.key !== subKey) return null
    return Date.now() - c.ts < TTL ? c.items : null
  } catch { return null }
}

function saveCache(storageKey, items, subKey) {
  try {
    const obj = subKey !== undefined
      ? { key: subKey, ts: Date.now(), items }
      : { ts: Date.now(), items }
    localStorage.setItem(storageKey, JSON.stringify(obj))
  } catch {}
}

export async function fetchNews(yahooSymbols, { force = false } = {}) {
  if (!yahooSymbols?.length) return []
  const cacheKey = [...yahooSymbols].sort().join(',')
  if (!force) {
    const cached = loadCache(CACHE_KEY, cacheKey)
    if (cached) return cached
  }
  const r = await fetch(`/api/news?symbols=${encodeURIComponent(yahooSymbols.join(','))}&count=8`)
  if (!r.ok) throw new Error(`news ${r.status}`)
  const items = await r.json()
  saveCache(CACHE_KEY, items, cacheKey)
  return items
}

export async function fetchMarketNews({ force = false } = {}) {
  if (!force) {
    const cached = loadCache(MARKET_CACHE_KEY)
    if (cached) return cached
  }
  const r = await fetch('/api/news?preset=market&count=6')
  if (!r.ok) throw new Error(`market news ${r.status}`)
  const items = await r.json()
  saveCache(MARKET_CACHE_KEY, items)
  return items
}

export async function fetchMacroNews({ force = false } = {}) {
  if (!force) {
    const cached = loadCache(MACRO_CACHE_KEY)
    if (cached) return cached
  }
  const r = await fetch('/api/news?preset=macro&count=6')
  if (!r.ok) throw new Error(`macro news ${r.status}`)
  const items = await r.json()
  saveCache(MACRO_CACHE_KEY, items)
  return items
}

export function timeAgo(dateStr, lang = 'en') {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  if (isNaN(diff) || diff < 0) return ''
  const mins = Math.floor(diff / 60000)
  const hrs  = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (lang === 'th') {
    if (mins < 2)  return 'เมื่อกี้'
    if (mins < 60) return `${mins} นาทีที่แล้ว`
    if (hrs  < 24) return `${hrs} ชั่วโมงที่แล้ว`
    return `${days} วันที่แล้ว`
  }
  if (mins < 2)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs  < 24) return `${hrs}h ago`
  return `${days}d ago`
}
