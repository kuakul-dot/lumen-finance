// Vercel Edge Function — full financial statements (income, balance sheet, cash flow)
export const config = { runtime: 'edge' }

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://finance.yahoo.com/',
  Origin: 'https://finance.yahoo.com',
}

const MODULES = [
  'incomeStatementHistory',
  'incomeStatementHistoryQuarterly',
  'balanceSheetHistory',
  'balanceSheetHistoryQuarterly',
  'cashflowStatementHistory',
  'cashflowStatementHistoryQuarterly',
  'price',
].join(',')

let cachedAuth = null

async function getYahooAuth() {
  if (cachedAuth && cachedAuth.expires > Date.now()) return cachedAuth
  try {
    const r1 = await fetch('https://fc.yahoo.com/', { headers: HEADERS, signal: AbortSignal.timeout(6000) })
    const rawCookie = r1.headers.get('set-cookie') || ''
    const cookies = rawCookie.split(/,(?=[A-Za-z])/).map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')
    if (!cookies) return null
    const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { ...HEADERS, Cookie: cookies },
      signal: AbortSignal.timeout(6000),
    })
    if (!r2.ok) return null
    const crumb = (await r2.text()).trim()
    if (!crumb) return null
    cachedAuth = { cookies, crumb, expires: Date.now() + 3600 * 1000 }
    return cachedAuth
  } catch { return null }
}

const num = x => (x && typeof x.raw === 'number') ? x.raw : null
const r2  = x => x == null ? null : +x.toFixed(2)

function fmtLabel(dateStr, quarterly, isThai) {
  if (!dateStr) return ''
  const d   = new Date(dateStr)
  const yr  = d.getFullYear()
  const q   = Math.ceil((d.getMonth() + 1) / 3)
  if (quarterly) {
    const y2 = isThai ? (yr + 543) % 100 : yr % 100
    return `Q${q}/${y2}`
  }
  return `FY${isThai ? yr + 543 : yr}`
}

function extract(d) {
  const price    = d.price || {}
  const currency = price.currency || 'THB'
  const isThai   = currency === 'THB'

  function mapIncome(list) {
    return list
      .map(q => {
        const date = q.endDate?.fmt || ''
        const rev  = num(q.totalRevenue)
        const gp   = num(q.grossProfit)
        const ni   = num(q.netIncome)
        return {
          date,
          label:          fmtLabel(date, false, isThai),
          revenue:        rev,
          costOfRevenue:  num(q.costOfRevenue),
          grossProfit:    gp,
          grossMargin:    gp != null && rev ? r2(gp / rev * 100) : null,
          operatingIncome:num(q.operatingIncome) ?? num(q.ebit),
          ebitda:         num(q.ebitda),
          netIncome:      ni,
          eps:            r2(num(q.basicEPS) ?? num(q.dilutedEPS)),
        }
      })
      .filter(q => q.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5)
  }

  function mapIncomeQ(list) {
    return list
      .map(q => {
        const date = q.endDate?.fmt || ''
        const rev  = num(q.totalRevenue)
        const gp   = num(q.grossProfit)
        const ni   = num(q.netIncome)
        return {
          date,
          label:          fmtLabel(date, true, isThai),
          revenue:        rev,
          costOfRevenue:  num(q.costOfRevenue),
          grossProfit:    gp,
          grossMargin:    gp != null && rev ? r2(gp / rev * 100) : null,
          operatingIncome:num(q.operatingIncome) ?? num(q.ebit),
          ebitda:         num(q.ebitda),
          netIncome:      ni,
          eps:            r2(num(q.basicEPS) ?? num(q.dilutedEPS)),
        }
      })
      .filter(q => q.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5)
  }

  function mapBalance(list, quarterly) {
    return list
      .map(q => {
        const date = q.endDate?.fmt || ''
        const ta   = num(q.totalAssets)
        const tl   = num(q.totalLiab)
        const eq   = num(q.totalStockholderEquity)
        return {
          date,
          label:             fmtLabel(date, quarterly, isThai),
          cash:              num(q.cash),
          shortTermInvest:   num(q.shortTermInvestments),
          receivables:       num(q.netReceivables),
          inventory:         num(q.inventory),
          currentAssets:     num(q.totalCurrentAssets),
          totalAssets:       ta,
          currentLiabilities:num(q.totalCurrentLiabilities),
          shortTermDebt:     num(q.shortLongTermDebt),
          longTermDebt:      num(q.longTermDebt),
          totalLiabilities:  tl,
          equity:            eq,
          debtToEquity:      eq && tl ? r2(tl / eq) : null,
        }
      })
      .filter(q => q.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5)
  }

  function mapCashflow(list, quarterly) {
    return list
      .map(q => {
        const date = q.endDate?.fmt || ''
        const cfo  = num(q.totalCashFromOperatingActivities)
        const capex= num(q.capitalExpenditures)
        return {
          date,
          label:            fmtLabel(date, quarterly, isThai),
          operatingCashflow:cfo,
          depreciation:     num(q.depreciation),
          workingCapChange: num(q.changeToWorkingCapital),
          capex,
          freeCashflow:     cfo != null && capex != null ? cfo + capex : null,
          investingCashflow:num(q.totalCashflowsFromInvestingActivities),
          financingCashflow:num(q.totalCashFromFinancingActivities),
          dividendsPaid:    num(q.dividendsPaid),
          netBorrowings:    num(q.netBorrowings),
        }
      })
      .filter(q => q.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5)
  }

  return {
    currency,
    income: {
      annual:    mapIncome(d.incomeStatementHistory?.incomeStatementHistory || []),
      quarterly: mapIncomeQ(d.incomeStatementHistoryQuarterly?.incomeStatementHistory || []),
    },
    balance: {
      annual:    mapBalance(d.balanceSheetHistory?.balanceSheetStatements || [], false),
      quarterly: mapBalance(d.balanceSheetHistoryQuarterly?.balanceSheetStatements || [], true),
    },
    cashflow: {
      annual:    mapCashflow(d.cashflowStatementHistory?.cashflowStatements || [], false),
      quarterly: mapCashflow(d.cashflowStatementHistoryQuarterly?.cashflowStatements || [], true),
    },
  }
}

async function fmpFallback(symbol, currency, needed) {
  const key = process.env.FMP_KEY
  if (!key) return {}

  const base = 'https://financialmodelingprep.com/api/v3'
  const sig  = { signal: AbortSignal.timeout(8000) }
  const get  = url => fetch(url, sig).then(r => r.ok ? r.json() : []).catch(() => [])
  const isThai = currency === 'THB'

  const tasks = []
  if (needed.income) {
    tasks.push(get(`${base}/income-statement/${encodeURIComponent(symbol)}?period=annual&limit=5&apikey=${key}`))
    tasks.push(get(`${base}/income-statement/${encodeURIComponent(symbol)}?period=quarter&limit=5&apikey=${key}`))
  } else {
    tasks.push(Promise.resolve(null), Promise.resolve(null))
  }
  if (needed.balance) {
    tasks.push(get(`${base}/balance-sheet-statement/${encodeURIComponent(symbol)}?period=annual&limit=5&apikey=${key}`))
    tasks.push(get(`${base}/balance-sheet-statement/${encodeURIComponent(symbol)}?period=quarter&limit=5&apikey=${key}`))
  } else {
    tasks.push(Promise.resolve(null), Promise.resolve(null))
  }
  if (needed.cashflow) {
    tasks.push(get(`${base}/cash-flow-statement/${encodeURIComponent(symbol)}?period=annual&limit=5&apikey=${key}`))
    tasks.push(get(`${base}/cash-flow-statement/${encodeURIComponent(symbol)}?period=quarter&limit=5&apikey=${key}`))
  } else {
    tasks.push(Promise.resolve(null), Promise.resolve(null))
  }

  const [incAnn, incQ, balAnn, balQ, cfAnn, cfQ] = await Promise.all(tasks)
  const out = {}

  if (Array.isArray(incAnn) && incAnn.length) {
    const mapI = (arr, quarterly) => arr.map(i => {
      const rev = i.revenue || null
      const gp  = i.grossProfit || null
      const ni  = i.netIncome || null
      return {
        date: i.date, label: fmtLabel(i.date, quarterly, isThai),
        revenue: rev, costOfRevenue: i.costOfRevenue || null,
        grossProfit: gp, grossMargin: gp && rev ? r2(gp / rev * 100) : null,
        operatingIncome: i.operatingIncome || null,
        ebitda: i.ebitda || null, netIncome: ni,
        eps: i.eps != null ? r2(i.eps) : null,
      }
    }).filter(q => q.date)

    out.income = {
      annual:    mapI(incAnn, false),
      quarterly: Array.isArray(incQ) ? mapI(incQ, true) : [],
    }
  }

  if (Array.isArray(balAnn) && balAnn.length) {
    const mapB = (arr, quarterly) => arr.map(b => {
      const ta = b.totalAssets || null
      const tl = b.totalLiabilities || null
      const eq = b.totalStockholdersEquity || null
      return {
        date: b.date, label: fmtLabel(b.date, quarterly, isThai),
        cash: b.cashAndCashEquivalents || null,
        shortTermInvest: b.shortTermInvestments || null,
        receivables: b.netReceivables || null,
        inventory: b.inventory || null,
        currentAssets: b.totalCurrentAssets || null,
        totalAssets: ta,
        currentLiabilities: b.totalCurrentLiabilities || null,
        shortTermDebt: b.shortTermDebt || null,
        longTermDebt: b.longTermDebt || null,
        totalLiabilities: tl,
        equity: eq,
        debtToEquity: eq && tl ? r2(tl / eq) : null,
      }
    }).filter(q => q.date)

    out.balance = {
      annual:    mapB(balAnn, false),
      quarterly: Array.isArray(balQ) ? mapB(balQ, true) : [],
    }
  }

  if (Array.isArray(cfAnn) && cfAnn.length) {
    const mapC = (arr, quarterly) => arr.map(c => {
      const cfo  = c.netCashProvidedByOperatingActivities || null
      const capex= c.capitalExpenditure || null
      return {
        date: c.date, label: fmtLabel(c.date, quarterly, isThai),
        operatingCashflow: cfo,
        depreciation: c.depreciationAndAmortization || null,
        workingCapChange: c.changesInWorkingCapital || null,
        capex,
        freeCashflow: c.freeCashFlow || (cfo != null && capex != null ? cfo + capex : null),
        investingCashflow: c.netCashUsedForInvestingActivites || null,
        financingCashflow: c.netCashUsedProvidedByFinancingActivities || null,
        dividendsPaid: c.dividendsPaid || null,
        netBorrowings: c.netDebtIssuance || null,
      }
    }).filter(q => q.date)

    out.cashflow = {
      annual:    mapC(cfAnn, false),
      quarterly: Array.isArray(cfQ) ? mapC(cfQ, true) : [],
    }
  }

  return out
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

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } })
  }

  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') || '').trim()
  if (!symbol) return json({})

  const auth = await getYahooAuth()

  let extracted = null
  for (const host of ['query2', 'query1']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES}` +
        (auth?.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : '')
      const r = await fetch(url, {
        headers: { ...HEADERS, ...(auth?.cookies ? { Cookie: auth.cookies } : {}) },
        signal: AbortSignal.timeout(12000),
      })
      if (r.ok) {
        const j = await r.json()
        const result = j?.quoteSummary?.result?.[0]
        if (result) { extracted = extract(result); break }
      } else if (r.status === 401 || r.status === 403) {
        cachedAuth = null
      }
    } catch { /* try next */ }
  }

  if (!extracted) return json({})

  const currency = extracted.currency
  const needed = {
    income:   extracted.income.annual.length === 0,
    balance:  extracted.balance.annual.length === 0,
    cashflow: extracted.cashflow.annual.length === 0,
  }

  const sources = {
    income:   'Yahoo',
    balance:  extracted.balance.annual.length > 0 ? 'Yahoo' : '—',
    cashflow: extracted.cashflow.annual.length > 0 ? 'Yahoo' : '—',
  }

  if (needed.income || needed.balance || needed.cashflow) {
    const fmp = await fmpFallback(symbol, currency, needed)
    if (fmp.income   && needed.income)   { extracted.income   = fmp.income;   sources.income   = 'FMP' }
    if (fmp.balance  && needed.balance)  { extracted.balance  = fmp.balance;  sources.balance  = 'FMP' }
    if (fmp.cashflow && needed.cashflow) { extracted.cashflow = fmp.cashflow; sources.cashflow = 'FMP' }
  }

  return json({ ...extracted, sources })
}
