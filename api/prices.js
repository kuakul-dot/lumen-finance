// Vercel serverless function — fetches Yahoo Finance quotes via v8/finance/chart
// Uses per-symbol parallel requests (no crumb token required)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { symbols } = req.query
  if (!symbols) return res.status(400).json({ error: 'symbols required' })

  const syms = symbols.split(',').map(s => s.trim()).filter(Boolean)

  try {
    const entries = await Promise.all(syms.map(fetchChart))
    const result = {}
    entries.forEach(({ sym, data }) => { if (data) result[sym] = data })

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800')
    return res.json(result)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

async function fetchChart(sym) {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://finance.yahoo.com/',
    Origin:  'https://finance.yahoo.com',
  }

  try {
    const base = `?interval=1d&range=1d&events=div,splits`
    let r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}${base}`,
      { headers, signal: AbortSignal.timeout(8000) }
    )

    if (!r.ok) {
      r = await fetch(
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}${base}`,
        { headers, signal: AbortSignal.timeout(8000) }
      )
    }

    if (!r.ok) return { sym, data: null }
    return { sym, data: parseChart(await r.json(), sym) }
  } catch {
    return { sym, data: null }
  }
}

function parseChart(json, sym) {
  const meta = json?.chart?.result?.[0]?.meta
  if (!meta || meta.regularMarketPrice == null) return null

  const price      = meta.regularMarketPrice
  const prev       = meta.previousClose ?? meta.chartPreviousClose ?? price
  const changeAbs  = price - prev
  const changePct  = prev > 0 ? (changeAbs / prev) * 100 : 0

  return {
    price,
    currency:  meta.currency  || 'USD',
    changePct: meta.regularMarketChangePercent ?? changePct,
    changeAbs,
    high:   meta.regularMarketDayHigh  ?? price,
    low:    meta.regularMarketDayLow   ?? price,
    volume: meta.regularMarketVolume   ?? 0,
    name:   meta.longName || meta.shortName || sym,
  }
}
