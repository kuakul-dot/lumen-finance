// Vercel Edge Function — GET /api/fundamentals?symbol=NVDA
// Returns a compact financial-statements snapshot from Yahoo Finance's
// quoteSummary endpoint (unofficial). The full payload Yahoo returns is huge,
// so we strip it down to the figures the AI prompt actually needs.
export const config = { runtime: 'edge' }

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
}

const MODULES = [
  'financialData',
  'defaultKeyStatistics',
  'summaryDetail',
  'incomeStatementHistory',
  'earningsTrend',
  'price',
].join(',')

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } })
  }
  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') || '').trim()
  if (!symbol) return json({})

  for (const host of ['query2', 'query1']) {
    try {
      const r = await fetch(
        `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES}`,
        { headers: HEADERS, signal: AbortSignal.timeout(10000) }
      )
      if (r.ok) {
        const j = await r.json()
        const result = j?.quoteSummary?.result?.[0]
        if (result) return json(extract(result))
      }
    } catch { /* try next host */ }
  }
  return json({})
}

function json(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200',
    },
  })
}

function num(x) { return (x && typeof x.raw === 'number') ? x.raw : null }
function round(x, d = 2) { return x == null ? null : +x.toFixed(d) }

function extract(d) {
  const fd = d.financialData || {}
  const ks = d.defaultKeyStatistics || {}
  const sd = d.summaryDetail || {}
  const price = d.price || {}
  const income = (d.incomeStatementHistory?.incomeStatementHistory || []).slice(0, 4).map(s => ({
    period:      s.endDate?.fmt || null,
    revenue:     num(s.totalRevenue),
    grossProfit: num(s.grossProfit),
    operatingIncome: num(s.operatingIncome),
    netIncome:   num(s.netIncome),
  }))
  return {
    name:        price.shortName || price.longName || null,
    currency:    price.currency || null,
    marketCap:   num(price.marketCap),
    // Valuation
    trailingPE:  round(num(ks.trailingPE)),
    forwardPE:   round(num(ks.forwardPE)),
    priceToBook: round(num(ks.priceToBook)),
    priceToSales: round(num(ks.priceToSalesTrailing12Months)),
    // Profitability (these come as 0..1 decimals)
    profitMargin:    round(num(fd.profitMargins) * 100, 1),
    operatingMargin: round(num(fd.operatingMargins) * 100, 1),
    grossMargin:     round(num(fd.grossMargins) * 100, 1),
    roe:             round(num(fd.returnOnEquity) * 100, 1),
    roa:             round(num(fd.returnOnAssets) * 100, 1),
    // Growth (year-over-year, decimals)
    revenueGrowth:  round(num(fd.revenueGrowth) * 100, 1),
    earningsGrowth: round(num(fd.earningsGrowth) * 100, 1),
    // Balance sheet
    debtToEquity:  round(num(fd.debtToEquity)),
    currentRatio:  round(num(fd.currentRatio)),
    quickRatio:    round(num(fd.quickRatio)),
    totalCash:     num(fd.totalCash),
    totalDebt:     num(fd.totalDebt),
    // Dividend
    dividendYield: round(num(sd.dividendYield) * 100, 2),
    payoutRatio:   round(num(sd.payoutRatio) * 100, 1),
    // Price context
    currentPrice:    num(fd.currentPrice),
    fiftyTwoWeekLow: num(sd.fiftyTwoWeekLow),
    fiftyTwoWeekHigh: num(sd.fiftyTwoWeekHigh),
    // Analyst
    targetMeanPrice: num(fd.targetMeanPrice),
    recommendationKey: fd.recommendationKey || null,
    numAnalystOpinions: num(fd.numberOfAnalystOpinions),
    // History
    incomeHistory: income,
  }
}
