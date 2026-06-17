// Vercel Edge Function — proxy for Yahoo Finance RSS + Google News RSS
// Returns merged, deduped, newest-first JSON array for the requested symbols.
// Edge runtime avoids Lambda IP blocks that Yahoo Finance enforces.
export const config = { runtime: 'edge' }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

function parseRSS(xml, fallbackSource) {
  const items = []
  const itemRe = /<item>([\s\S]*?)<\/item>/g
  let m
  while ((m = itemRe.exec(xml)) !== null) {
    const s = m[1]
    const val = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${tag}>`)
      const mm = r.exec(s)
      return mm ? (mm[1] ?? mm[2] ?? '').trim() : ''
    }
    const title = val('title')
    if (!title) continue
    const link = /<link>([^<]+)<\/link>/.exec(s)?.[1]?.trim() || ''
    const pubDate = val('pubDate') || val('dc:date') || ''
    const desc = val('description').replace(/<[^>]+>/g, '').slice(0, 300)
    const srcEl = /<source[^>]*>([^<]+)<\/source>/.exec(s)
    const source = srcEl ? srcEl[1].trim() : fallbackSource
    const thumb = /<media:content[^>]+url="([^"]+)"/.exec(s)?.[1] || null
    items.push({ title, link, pubDate, description: desc, source, thumbnail: thumb })
  }
  return items
}

async function fetchYahoo(sym) {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/xml,*/*', Referer: 'https://finance.yahoo.com/' },
    signal: AbortSignal.timeout(7000),
  })
  if (!r.ok) throw new Error(`Yahoo ${r.status}`)
  return parseRSS(await r.text(), 'Yahoo Finance').map(i => ({ ...i, ticker: sym }))
}

async function fetchGoogle(sym) {
  const base = sym.replace(/\.BK$/, '').replace(/-USD$/, '')
  const q = `${base} stock`
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en&gl=TH&ceid=TH:en`
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/xml,*/*', Referer: 'https://news.google.com/' },
    signal: AbortSignal.timeout(7000),
  })
  if (!r.ok) throw new Error(`Google ${r.status}`)
  const raw = parseRSS(await r.text(), 'Google News')
  return raw.map(item => {
    const srcM = / - ([^-\n]{3,40})$/.exec(item.title)
    return { ...item, ticker: sym, source: srcM ? srcM[1].trim() : 'Google News' }
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    })
  }

  const { searchParams } = new URL(req.url)
  const syms = (searchParams.get('symbols') || '')
    .split(',').map(s => s.trim()).filter(Boolean).slice(0, 12)
  const maxPer = Math.min(parseInt(searchParams.get('count') || '8', 10), 15)

  if (!syms.length) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  const tasks = syms.flatMap(sym => {
    const arr = [fetchYahoo(sym)]
    if (sym.endsWith('.BK') || sym.endsWith('-USD')) arr.push(fetchGoogle(sym))
    return arr
  })
  const settled = await Promise.allSettled(tasks)

  const all = []
  for (const r of settled) {
    if (r.status === 'fulfilled') all.push(...r.value)
  }

  // Dedup by title prefix
  const seen = new Set()
  const deduped = all.filter(item => {
    const key = item.title.toLowerCase().replace(/\s+/g, ' ').slice(0, 80)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Sort newest first
  deduped.sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0
    return tb - ta
  })

  // Cap per-ticker
  const counts = {}
  const final = deduped.filter(item => {
    const c = counts[item.ticker] || 0
    if (c >= maxPer) return false
    counts[item.ticker] = c + 1
    return true
  })

  return new Response(JSON.stringify(final), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 's-maxage=600, stale-while-revalidate=1200',
    },
  })
}
