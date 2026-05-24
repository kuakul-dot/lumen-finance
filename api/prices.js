// Vercel serverless function — proxies Yahoo Finance quote API
// Called from frontend at /api/prices?symbols=PTT.BK,AAPL

export default async function handler(req, res) {
  const { symbols } = req.query
  if (!symbols) return res.status(400).json({ error: 'symbols required' })

  try {
    const url =
      `https://query1.finance.yahoo.com/v6/finance/quote` +
      `?symbols=${encodeURIComponent(symbols)}` +
      `&lang=en&region=US&corsDomain=finance.yahoo.com`

    const yf = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    })

    if (!yf.ok) {
      return res.status(yf.status).json({ error: `Yahoo Finance returned ${yf.status}` })
    }

    const json = await yf.json()
    const quotes = json?.quoteResponse?.result || []

    const result = {}
    quotes.forEach(q => {
      if (q.regularMarketPrice != null) {
        result[q.symbol] = {
          price:     q.regularMarketPrice,
          currency:  q.currency || 'USD',
          changePct: q.regularMarketChangePercent ?? 0,
          changeAbs: q.regularMarketChange ?? 0,
          high:      q.regularMarketDayHigh,
          low:       q.regularMarketDayLow,
          volume:    q.regularMarketVolume,
          name:      q.shortName || q.longName || '',
        }
      }
    })

    // Cache at edge for 15 minutes
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800')
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
