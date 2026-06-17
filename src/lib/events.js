const CACHE_KEY = 'lumen_events_v1'
const TTL = 60 * 60 * 1000

// Central bank meeting dates — approximate, updated annually via code
const STATIC_CB_EVENTS = [
  // FOMC 2026 (Federal Reserve)
  { symbol: 'FOMC', type: 'fomc', date: '2026-07-29' },
  { symbol: 'FOMC', type: 'fomc', date: '2026-09-15' },
  { symbol: 'FOMC', type: 'fomc', date: '2026-10-27' },
  { symbol: 'FOMC', type: 'fomc', date: '2026-12-08' },
  // กนง 2026 (Bank of Thailand MPC)
  { symbol: 'กนง', type: 'gnb', date: '2026-06-25' },
  { symbol: 'กนง', type: 'gnb', date: '2026-08-27' },
  { symbol: 'กนง', type: 'gnb', date: '2026-10-29' },
  { symbol: 'กนง', type: 'gnb', date: '2026-12-17' },
]

function getUpcomingStatic() {
  const now = Date.now()
  return STATIC_CB_EVENTS.filter(ev => {
    const ms = new Date(ev.date + 'T00:00:00').getTime()
    return ms >= now - 86400000 && ms <= now + 90 * 86400000
  })
}

function loadCache(key) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    return c?.key === key && Date.now() - c.ts < TTL ? c.items : null
  } catch { return null }
}

function saveCache(key, items) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key, ts: Date.now(), items })) } catch {}
}

export async function fetchEvents(yahooSymbols, { force = false } = {}) {
  const staticEvs = getUpcomingStatic()
  if (!yahooSymbols?.length) return staticEvs

  const cacheKey = [...yahooSymbols].sort().join(',')
  if (!force) {
    const cached = loadCache(cacheKey)
    if (cached) return cached
  }
  const r = await fetch(`/api/events?symbols=${encodeURIComponent(yahooSymbols.join(','))}`)
  if (!r.ok) throw new Error(`events ${r.status}`)
  const apiItems = await r.json()

  const merged = [...apiItems, ...staticEvs]
  merged.sort((a, b) => new Date(a.date) - new Date(b.date))
  saveCache(cacheKey, merged)
  return merged
}

export function fmtEventDate(iso, lang = 'en') {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((d - today) / 86400000)
  if (lang === 'th') {
    if (diff === 0)  return 'วันนี้'
    if (diff === 1)  return 'พรุ่งนี้'
    if (diff === -1) return 'เมื่อวาน'
    if (diff > 1 && diff <= 14) return `ใน ${diff} วัน`
    const mo = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
    return `${d.getDate()} ${mo[d.getMonth()]}`
  }
  if (diff === 0)  return 'today'
  if (diff === 1)  return 'tomorrow'
  if (diff === -1) return 'yesterday'
  if (diff > 1 && diff <= 14) return `in ${diff}d`
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getDate()} ${mo[d.getMonth()]}`
}
