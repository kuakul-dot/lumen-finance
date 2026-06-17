// Vercel Edge Function — upcoming earnings & ex-dividend dates from Yahoo Finance
export const config = { runtime: 'edge' }

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
}

async function fetchCalendar(sym) {
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(
        `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=calendarEvents`,
        { headers: HEADERS, signal: AbortSignal.timeout(7000) }
      )
      if (!r.ok) continue
      const json = await r.json()
      const cal = json?.quoteSummary?.result?.[0]?.calendarEvents
      if (!cal) return null
      return {
        symbol: sym,
        earningsDates: (cal.earnings?.earningsDate || []).map(d => d.fmt).filter(Boolean),
        exDividendDate: cal.exDividendDate?.fmt || null,
        dividendDate:   cal.dividendDate?.fmt   || null,
      }
    } catch { /* try next host */ }
  }
  return null
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } })
  }

  const { searchParams } = new URL(req.url)
  const syms = (searchParams.get('symbols') || '')
    .split(',').map(s => s.trim()).filter(Boolean).slice(0, 15)

  if (!syms.length) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  const settled = await Promise.allSettled(syms.map(fetchCalendar))

  const now = Date.now()
  const events = []

  for (const r of settled) {
    if (r.status !== 'fulfilled' || !r.value) continue
    const { symbol, earningsDates, exDividendDate } = r.value

    // Earnings: show if within next 90 days or past 3 days
    for (const date of earningsDates) {
      const ms = new Date(date).getTime()
      if (!isNaN(ms) && ms >= now - 3 * 86400000 && ms <= now + 90 * 86400000) {
        events.push({ symbol, type: 'earnings', date })
        break // only the nearest earnings date
      }
    }

    // Ex-dividend: show if within next 45 days or past 7 days
    if (exDividendDate) {
      const ms = new Date(exDividendDate).getTime()
      if (!isNaN(ms) && ms >= now - 7 * 86400000 && ms <= now + 45 * 86400000) {
        events.push({ symbol, type: 'exdiv', date: exDividendDate })
      }
    }
  }

  events.sort((a, b) => new Date(a.date) - new Date(b.date))

  return new Response(JSON.stringify(events), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200',
    },
  })
}
