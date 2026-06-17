const CACHE_KEY = 'lumen_news_v1'
const TTL = 15 * 60 * 1000

function loadCache(key) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    return c?.key === key && Date.now() - c.ts < TTL ? c.items : null
  } catch { return null }
}

function saveCache(key, items) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key, ts: Date.now(), items })) } catch {}
}

export async function fetchNews(yahooSymbols, { force = false } = {}) {
  if (!yahooSymbols?.length) return []
  const cacheKey = [...yahooSymbols].sort().join(',')
  if (!force) {
    const cached = loadCache(cacheKey)
    if (cached) return cached
  }
  const r = await fetch(`/api/news?symbols=${encodeURIComponent(yahooSymbols.join(','))}&count=8`)
  if (!r.ok) throw new Error(`news ${r.status}`)
  const items = await r.json()
  saveCache(cacheKey, items)
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
