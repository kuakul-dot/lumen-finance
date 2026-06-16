import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { PageHead, Delta, Icon, TickerLogo } from './Nav'
import { CalcInput } from './CalcInput'
import { LineChart, Donut, BarChart } from './Charts'
import { LUMEN_FMT, LUMEN_DERIVE, LUMEN_HISTORY, LUMEN_BENCH } from '../data'
import { deriveHoldings, getTransactions, getSnapshots, getAllTransactions, upsertSnapshots, deleteAllSnapshots, deleteSnapshotsAfterDate, buildSnapshotSeries, computeRealized, addTransaction, updateTransaction, deleteTransaction } from '../lib/db'
import { fetchHistory, toYahooSymbol } from '../lib/prices'

export function AnalyticsPage({ t, lang, ccy, dataState, liveHoldings = [], prices = {}, fxRate = 36, portfolio, cashAccounts = [] }) {
  const [tab, setTab] = useState("common")
  const [transactions, setTransactions] = useState([])
  const [pendingDivCount, setPendingDivCount] = useState(0)
  // Bump this counter after any snapshot rebuild so all tab components re-fetch
  const [snapsVersion, setSnapsVersion] = useState(0)
  const bumpSnapsVersion = useCallback(() => setSnapsVersion(v => v + 1), [])

  // Fetch ALL transactions — the earliest-investment date and per-ticker
  // purchase dates must see the full history, not just the latest 50.
  useEffect(() => {
    if (dataState !== "live" || !portfolio?.id) return
    let cancelled = false
    getAllTransactions(portfolio.id)
      .then(d => { if (!cancelled) setTransactions(d || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [dataState, portfolio?.id])

  // ── Silent auto-rebuild when snapshots are stale ──────────────────────────────
  // If the most recent snapshot is >5 days old (gap between last rebuild and
  // today's live data), silently re-run the full backfill so the chart stays
  // smooth and up-to-date without the user having to visit the Metrics tab.
  const autoRebuildDoneRef = useRef(false)
  useEffect(() => {
    if (dataState !== "live" || !portfolio?.id || autoRebuildDoneRef.current) return
    if (transactions.length === 0 || liveHoldings.length === 0) return
    let cancelled = false
    getSnapshots(portfolio.id).then(async snaps => {
      if (cancelled || autoRebuildDoneRef.current) return
      const lastDate = snaps[snaps.length - 1]?.date
      const daysSinceLast = lastDate
        ? Math.floor((Date.now() - new Date(lastDate + 'T12:00:00Z').getTime()) / 86400000)
        : 999
      if (daysSinceLast < 5) return   // fresh enough — skip
      autoRebuildDoneRef.current = true
      try {
        const txs = transactions
        const ccyByTicker = {}
        for (const tx of txs) {
          const tk = (tx.ticker || '').toUpperCase()
          if (tk && !ccyByTicker[tk]) ccyByTicker[tk] = tx.currency || 'THB'
        }
        // priceCcyByTicker: currency Yahoo Finance prices are quoted in.
        // GoldTH (GC=F) and Crypto (BTC-USD) are always USD on Yahoo regardless
        // of how the user recorded the transaction. US-region equities are also USD.
        const clsByTicker = {}
        const priceCcyByTicker = { ...ccyByTicker }
        for (const h of liveHoldings) {
          const tk = (h.ticker || '').toUpperCase()
          if (!tk) continue
          clsByTicker[tk] = h.cls || 'Equity'
          const pc = (h.cls === 'GoldTH' || h.cls === 'Crypto' || h.region === 'US') ? 'USD' : 'THB'
          if (pc !== priceCcyByTicker[tk])
            console.log(`[Lumen] rebuild: ${tk} cls=${h.cls} region=${h.region} → price_ccy overridden to ${pc}`)
          priceCcyByTicker[tk] = pc
        }
        const tickers = Object.keys(ccyByTicker)
        const spanDays = (Date.now() - new Date(txs[0].transacted_at)) / 86400000
        const range = spanDays > 365 * 2 ? '5y' : spanDays > 365 ? '2y' : spanDays > 180 ? '1y'
                    : spanDays > 90 ? '6mo' : spanDays > 30 ? '3mo' : '1mo'
        const seriesByTicker = {}
        await Promise.all(tickers.map(async tk => {
          const region = priceCcyByTicker[tk] === 'USD' ? 'US' : 'TH'
          const sym = toYahooSymbol(tk, region, clsByTicker[tk] || 'Equity')
          const h = await fetchHistory(sym, range).catch(() => ({ series: [] }))
          seriesByTicker[tk] = (h?.series || []).map(p => ({ d: new Date(p.t * 1000).toISOString().split('T')[0], c: p.c }))
        }))
        const fxByDate = {}
        if (Object.values(priceCcyByTicker).some(c => c === 'USD')) {
          const fxH = await fetchHistory('USDTHB=X', range).catch(() => ({ series: [] }))
          for (const p of (fxH?.series || []))
            fxByDate[new Date(p.t * 1000).toISOString().split('T')[0]] = p.c
        }
        const series = buildSnapshotSeries(txs, seriesByTicker, ccyByTicker, fxRate, fxByDate, priceCcyByTicker, clsByTicker)
        if (series.length && !cancelled) {
          await deleteAllSnapshots(portfolio.id)
          await upsertSnapshots(portfolio.id, series)
          if (!cancelled) bumpSnapsVersion()
        }
      } catch (err) {
        console.warn('[Lumen] auto-rebuild:', err?.message)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [dataState, portfolio?.id, transactions, liveHoldings, fxRate, bumpSnapsVersion])

  // ── Proactively count pending (unsynced) dividends for the tab badge ─────────
  // Runs when transactions load. Reuses the same /api/dividends endpoint that the
  // full Sync uses, so results are consistent. Count resets to 0 after a sync
  // (handleTransactionAdded fires → transactions changes → this re-runs).
  useEffect(() => {
    if (dataState !== "live" || liveHoldings.length === 0 || transactions.length === 0) return
    let cancelled = false
    const symbols = [...new Set(
      liveHoldings.map(h => toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity'))
    )].join(',')
    fetch(`/api/dividends?symbols=${encodeURIComponent(symbols)}`)
      .then(r => r.json())
      .then(history => {
        if (cancelled) return
        const nowSec = Date.now() / 1000
        const divTxs = transactions.filter(tx => tx.type === 'Dividend')
        // Count XD events that passed, haven't been recorded, AND user held shares before XD.
        // Must mirror the sync-modal logic exactly (sharesAsOf check) so badge === modal count.
        const sharesBeforeXd = (ticker, xdDateStr) => {
          let s = 0
          for (const tx of transactions) {
            if (tx.ticker !== ticker || !tx.transacted_at) continue
            if (tx.transacted_at.slice(0, 10) >= xdDateStr) continue // bought on/after XD → not entitled
            const q = Number(tx.shares) || 0
            if (tx.type === 'Buy')  s += q
            else if (tx.type === 'Sell') s -= q
          }
          return Math.max(0, s)
        }
        let count = 0
        liveHoldings.forEach(h => {
          const sym = toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity')
          ;(history[sym] || []).forEach(e => {
            if (e.date > nowSec) return
            const xdDateStr = toXdStr(e.date)
            if (isDivRecorded(divTxs, h.ticker, xdDateStr)) return
            if (sharesBeforeXd(h.ticker, xdDateStr) > 0) count++
          })
        })
        setPendingDivCount(count)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [dataState, liveHoldings, transactions])

  // Called by AnalyticsDiv2 after new Dividend transactions are saved
  const handleTransactionAdded = useCallback((newTxs) => {
    setTransactions(prev => [...newTxs, ...prev])
  }, [])

  const handleTransactionUpdated = useCallback((updated) => {
    setTransactions(prev => prev.map(tx => tx.id === updated.id ? { ...tx, ...updated } : tx))
  }, [])

  const handleTransactionDeleted = useCallback((id) => {
    setTransactions(prev => prev.filter(tx => tx.id !== id))
  }, [])

  const liveRows = useMemo(
    () => dataState === "live" ? deriveHoldings(liveHoldings, ccy, prices, fxRate) : [],
    [liveHoldings, ccy, prices, fxRate, dataState]
  )
  const demoData = useMemo(() => dataState !== "live" ? LUMEN_DERIVE() : null, [dataState])

  const rows       = dataState === "live" ? liveRows : (demoData?.rows || [])
  const totalValue = rows.reduce((s, r) => s + r.value, 0)
  const totalPL    = rows.reduce((s, r) => s + r.pl, 0)
  const totalCost  = totalValue - totalPL
  const totalPlPct = totalCost > 0 ? (totalPL / totalCost) * 100 : 0
  const hasLivePrices = rows.some(r => r.hasLivePrice)

  // Earliest *real* investment date — prefer transactions.transacted_at (the
  // date the user actually entered when logging a Buy), fall back to
  // holdings.purchased_at, then created_at as a last resort.
  const earliestHoldingDate = useMemo(() => {
    if (dataState !== "live") return null
    const candidates = []
    // 1. Buy transactions — the most authoritative source
    transactions
      .filter(tx => (tx.type || 'Buy') === 'Buy')
      .forEach(tx => { if (tx.transacted_at) candidates.push(new Date(tx.transacted_at)) })
    // 2. Holding-level purchased_at / created_at as fallback
    liveHoldings.forEach(h => {
      if (h.purchased_at) candidates.push(new Date(h.purchased_at))
      else if (h.created_at) candidates.push(new Date(h.created_at))
    })
    const valid = candidates.filter(d => !isNaN(d.getTime()))
    return valid.length ? new Date(Math.min(...valid.map(d => d.getTime()))) : null
  }, [transactions, liveHoldings, dataState])

  if (dataState === "empty") {
    return (
      <div className="shell fade-in">
        <PageHead title={t.analytics.heading} sub={t.analytics.sub} />
        <div className="card empty">
          <h2 className="display" style={{ fontSize: 28 }}>
            {lang === "th" ? "ยังไม่มีข้อมูลให้วิเคราะห์" : "Nothing to analyze yet"}
          </h2>
          <p>{lang === "th" ? "เพิ่มหลักทรัพย์เพื่อปลดล็อกการวิเคราะห์" : "Add holdings to unlock analytics"}</p>
        </div>
      </div>
    )
  }

  const tabs = [
    { id: "common",          label: t.analytics.tabs.common,          icon: "spark" },
    { id: "diversification", label: t.analytics.tabs.diversification, icon: "filter" },
    { id: "dividends",       label: t.analytics.tabs.dividends,       icon: "dividend" },
    { id: "growth",          label: t.analytics.tabs.growth,          icon: "play" },
    { id: "metrics",         label: t.analytics.tabs.metrics,         icon: "info" },
    { id: "tax",             label: t.analytics.tabs.tax,             icon: "receipt" },
    { id: "health",          label: t.analytics.tabs.health,          icon: "shield" },
  ]

  return (
    <div className="shell fade-in" data-screen-label="Analytics">
      <PageHead
        title={t.analytics.heading}
        sub={t.analytics.sub}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {dataState === "live" && hasLivePrices && (
              <span style={{ fontSize: 12, color: "var(--gain)", fontWeight: 600 }}>● LIVE</span>
            )}
            <button className="btn btn-outline btn-sm">
              <Icon name="filter" size={14} />
              {lang === "th" ? "ทุกหลักทรัพย์" : "All holdings"}
              <Icon name="down" size={12} />
            </button>
          </div>
        }
      />

      <div className="tabs" style={{ position: "sticky", top: 0, background: "var(--bg)", zIndex: 5, paddingTop: 4, paddingBottom: 4 }}>
        {tabs.map(tb => (
          <button key={tb.id} className={"tab" + (tab === tb.id ? " active" : "")} onClick={() => setTab(tb.id)}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name={tb.icon} size={13} /> {tb.label}
              {tb.id === "dividends" && pendingDivCount > 0 && (
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  minWidth: 16, height: 16, borderRadius: 8,
                  padding: "0 4px",
                  background: "var(--loss)", color: "#fff",
                  fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)",
                  lineHeight: 1,
                }}>
                  {pendingDivCount > 9 ? "9+" : pendingDivCount}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {tab === "common"          && <AnalyticsCommon t={t} lang={lang} ccy={ccy} rows={rows} totalValue={totalValue} totalPL={totalPL} totalPlPct={totalPlPct} totalCost={totalCost} hasLivePrices={hasLivePrices} demoData={demoData} dataState={dataState} earliestHoldingDate={earliestHoldingDate} liveHoldings={liveHoldings} transactions={transactions} fxRate={fxRate} portfolio={portfolio} snapsVersion={snapsVersion} />}
      {tab === "diversification" && <AnalyticsDiv t={t} lang={lang} ccy={ccy} rows={rows} totalValue={totalValue} demoData={demoData} dataState={dataState} />}
      {tab === "dividends"       && <AnalyticsDiv2 t={t} lang={lang} ccy={ccy} rows={rows} totalValue={totalValue} dataState={dataState} liveHoldings={liveHoldings} fxRate={fxRate} transactions={transactions} portfolio={portfolio} onTransactionAdded={handleTransactionAdded} onTransactionUpdated={handleTransactionUpdated} onTransactionDeleted={handleTransactionDeleted} />}
      {tab === "growth"          && <AnalyticsGrowth t={t} lang={lang} ccy={ccy} rows={rows} fxRate={fxRate} totalValue={totalValue} totalCost={totalCost} totalPL={totalPL} totalPlPct={totalPlPct} dataState={dataState} earliestHoldingDate={earliestHoldingDate} portfolio={portfolio} snapsVersion={snapsVersion} />}
      {tab === "metrics"         && <AnalyticsMetrics t={t} lang={lang} ccy={ccy} rows={rows} totalValue={totalValue} totalPL={totalPL} totalPlPct={totalPlPct} dataState={dataState} portfolio={portfolio} fxRate={fxRate} onSnapsRebuild={bumpSnapsVersion} />}
      {tab === "tax"             && <AnalyticsTax t={t} lang={lang} ccy={ccy} dataState={dataState} transactions={transactions} fxRate={fxRate} />}
      {tab === "health"          && <AnalyticsHealth t={t} lang={lang} ccy={ccy} rows={rows} totalValue={totalValue} totalPL={totalPL} totalPlPct={totalPlPct} dataState={dataState} cashAccounts={cashAccounts} fxRate={fxRate} />}
    </div>
  )
}

/* ─── Shared helpers ────────────────────────────────────────────────────────── */
// Convert Yahoo Finance Unix timestamp → YYYY-MM-DD (add 12h to handle midnight-UTC edge)
const toXdStr = (sec) => new Date((sec + 43200) * 1000).toISOString().slice(0, 10)

// Returns true if a dividend for (ticker, xdDateStr) is already in divTxs
const isDivRecorded = (divTxs, ticker, xdDateStr) =>
  divTxs.filter(tx => tx.ticker === ticker && tx.transacted_at).some(tx => {
    if (tx.note?.includes(`xd:${xdDateStr}`)) return true
    const noteXd = tx.note?.match(/xd:(\d{4}-\d{2}-\d{2})/)?.[1]
    const refDate = noteXd ?? tx.transacted_at.slice(0, 10)
    return Math.abs(new Date(refDate) - new Date(xdDateStr)) < 14 * 86400 * 1000
  })

/* ─── Helper: merge same-ticker lots into a single row ──────────────────────── */
function groupRowsByTicker(rows) {
  const map = new Map()
  rows.forEach(r => {
    if (!map.has(r.ticker)) {
      map.set(r.ticker, { ...r, _lots: 1 })
    } else {
      const g = map.get(r.ticker)
      const totalShares = g.shares + r.shares
      const totalValue  = g.value + r.value
      const totalPL     = g.pl + r.pl
      const costBasis   = totalValue - totalPL
      map.set(r.ticker, {
        ...g,
        shares: totalShares,
        value:  totalValue,
        pl:     totalPL,
        plPct:  costBasis > 0 ? (totalPL / costBasis) * 100 : 0,
        _lots:  g._lots + 1,
      })
    }
  })
  return [...map.values()]
}

/* ─── Common tab ─────────────────────────────────────────────────────────────── */
function AnalyticsCommon({ t, lang, ccy, rows, totalValue, totalPL, totalPlPct, totalCost, hasLivePrices, demoData, dataState, earliestHoldingDate, liveHoldings = [], transactions = [], fxRate = 36, portfolio, snapsVersion = 0 }) {
  const FMT = LUMEN_FMT
  const th = lang === "th"

  // Days of actual investment history available (for live mode)
  const daysSinceFirst = useMemo(() => {
    if (dataState !== "live" || !earliestHoldingDate) return 365 * 5
    return Math.max(1, Math.round((Date.now() - earliestHoldingDate.getTime()) / 86400000))
  }, [dataState, earliestHoldingDate])

  // Auto-pick the largest period that fits within available history
  const defaultPeriod = useMemo(() => {
    if (dataState !== "live") return "1y"
    if (daysSinceFirst >= 365)      return "1y"
    if (daysSinceFirst >= 180)      return "6m"
    if (daysSinceFirst >= 90)       return "3m"
    return "1m"
  }, [dataState, daysSinceFirst])
  const [chartPeriod, setChartPeriod] = useState(defaultPeriod)
  useEffect(() => { setChartPeriod(defaultPeriod) }, [defaultPeriod])
  const [chartMode, setChartMode] = useState("pct")   // "pct" = growth %, "value" = THB value
  const [activeBenchKeys, setActiveBenchKeys] = useState(['sp500', 'set'])
  const toggleBench = useCallback((k) => {
    setActiveBenchKeys(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k])
  }, [])

  // Which buttons are usable in live mode? (need enough history)
  const periodDaysMap = useMemo(() => {
    const startOfYear = new Date(new Date().getFullYear(), 0, 1)
    const ytdDays = Math.max(1, Math.round((Date.now() - startOfYear.getTime()) / 86400000))
    return { "1m": 30, "3m": 90, "6m": 180, "ytd": ytdDays, "1y": 365, "5y": 365 * 5, "all": daysSinceFirst }
  }, [daysSinceFirst])
  const isPeriodEnabled = (k) => dataState !== "live" || periodDaysMap[k] <= daysSinceFirst + 7  // small tolerance

  // Fetch history for all active benchmarks when they change or the time-range changes.
  const [benchData, setBenchData] = useState({})
  useEffect(() => {
    if (dataState !== "live") return
    const range = daysSinceFirst >= 365*2 ? "5y" : daysSinceFirst >= 365 ? "2y" : daysSinceFirst >= 180 ? "1y" : daysSinceFirst >= 90 ? "6mo" : "3mo"
    const keys = activeBenchKeys.filter(k => BENCHMARKS[k]?.symbol)
    if (!keys.length) { setBenchData({}); return }
    let cancelled = false
    Promise.all(keys.map(k => fetchHistory(BENCHMARKS[k].symbol, range).then(d => [k, d]).catch(() => [k, { series: [] }])))
      .then(results => {
        if (!cancelled) {
          const map = {}
          results.forEach(([k, d]) => { map[k] = d })
          setBenchData(map)
        }
      })
    return () => { cancelled = true }
  }, [dataState, daysSinceFirst, activeBenchKeys])

  // Daily portfolio value/cost snapshots — power the accurate, contribution-
  // neutral growth comparison against S&P 500.
  const [snaps, setSnaps] = useState([])
  useEffect(() => {
    if (dataState !== "live" || !portfolio?.id) { setSnaps([]); return }
    let cancelled = false
    getSnapshots(portfolio.id).then(d => { if (!cancelled) setSnaps(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [dataState, portfolio?.id, snapsVersion])

  // ── Real holding price histories (same logic as Dashboard) ─────────────────
  const [holdingHistories, setHoldingHistories] = useState({})
  useEffect(() => {
    if (dataState !== "live" || liveHoldings.length === 0) return
    let cancelled = false
    const range = daysSinceFirst > 365 * 2 ? '5y' : daysSinceFirst > 365 ? '2y' : '1y'
    const symbols = [...new Set(liveHoldings.map(h => toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity')))]
    Promise.all(symbols.map(sym => fetchHistory(sym, range).then(d => [sym, d]).catch(() => [sym, { series: [] }])))
      .then(results => {
        if (!cancelled) {
          const map = {}
          results.forEach(([sym, d]) => { map[sym] = d })
          setHoldingHistories(map)
        }
      })
    return () => { cancelled = true }
  }, [dataState, liveHoldings, daysSinceFirst])

  // Earliest Buy timestamp per ticker (for pre-purchase filtering)
  const purchaseSecByTicker = useMemo(() => {
    const map = {}
    transactions.filter(tx => tx.type === 'Buy' && tx.transacted_at && tx.ticker).forEach(tx => {
      const sec = new Date(tx.transacted_at).getTime() / 1000
      if (!(tx.ticker in map) || sec < map[tx.ticker]) map[tx.ticker] = sec
    })
    return map
  }, [transactions])

  const hasRealHistory = useMemo(() =>
    liveHoldings.some(h => {
      const sym = toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity')
      return (holdingHistories[sym]?.series?.length || 0) >= 5
    })
  , [liveHoldings, holdingHistories])
  const annualIncome = rows.reduce((a, r) => a + r.value * (r.divYield || 0) / 100, 0)
  const yieldOnPort  = totalValue > 0 ? (annualIncome / totalValue) * 100 : 0

  const monthLabels = ["Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May"]
  const series = demoData ? [
    {
      name: th ? "พอร์ตของคุณ" : "Your portfolio",
      color: "var(--ink)", fill: true,
      data: LUMEN_HISTORY.map((p, i) => ({ x: i, y: p.v * 1000, label: monthLabels[i % 12] + " '" + (24 + Math.floor(i / 12)) })),
    },
    {
      name: "S&P 500",
      color: "var(--accent)",
      data: LUMEN_BENCH.map((p, i) => ({ x: i, y: p.v * 1000, label: monthLabels[i % 12] + " '" + (24 + Math.floor(i / 12)) })),
    },
  ] : null

  // Live mode chart:
  //  - Portfolio: synthetic (we lack daily portfolio snapshots) — multi-octave noise + ease curve
  //  - S&P 500:  REAL historical close prices from Yahoo (^GSPC), rebased so the
  //              first visible day equals totalCost (so both lines start at the same anchor)
  //  - Both series share the SAME x-axis positions (0…N-1) and length so hover tooltips
  //    don't read out-of-bounds indices on the shorter series.
  const liveSeries = useMemo(() => {
    if (dataState !== "live" || totalCost <= 0 || totalValue <= 0) return null
    const now = new Date()
    const requestedDays = periodDaysMap[chartPeriod] || 365
    const totalDays = Math.max(7, Math.min(requestedDays, daysSinceFirst))
    const cutoffSec = (now.getTime() - totalDays * 86400000) / 1000

    const locale = th ? "th-TH" : "en-US"
    // Always show month + year (e.g. "May '25") regardless of window size
    const mkLabel = d => {
      if (totalDays < 60) return d.toLocaleString(locale, { month: "short", day: "numeric" })
      return d.toLocaleString(locale, { month: "short" }) + " '" + String(d.getFullYear()).slice(2)
    }

    // ── Forward-fill helper ───────────────────────────────────────────────────
    const getPriceAt = (sorted, ts) => {
      let price = null
      for (const p of sorted) { if (p.t <= ts) price = p.c; else break }
      return price
    }

    // ── Try to build real portfolio series ────────────────────────────────────
    let realPortfolioPoints = null
    if (liveHoldings.length > 0) {
      const holdingData = liveHoldings.map(h => {
        const sym = toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity')
        const series = (holdingHistories[sym]?.series || []).filter(p => p.t >= cutoffSec)
        const purchaseSec = purchaseSecByTicker[h.ticker] || 0
        const priceCcy = (h.region || 'TH') === 'TH' ? 'THB' : 'USD'
        return { ...h, sym, series, purchaseSec, priceCcy }
      })
      if (holdingData.some(h => h.series.length >= 5)) {
        const allTs = new Set()
        holdingData.forEach(h => h.series.forEach(p => allTs.add(p.t)))
        const sortedTs = [...allTs].sort((a, b) => a - b)
        if (sortedTs.length >= 2) {
          const targetPts = Math.max(8, Math.min(60, Math.round(totalDays / 7)))
          const stride = Math.max(1, Math.floor(sortedTs.length / targetPts))
          let sampled = sortedTs.filter((_, i) => i % stride === 0)
          if (sampled[sampled.length - 1] !== sortedTs[sortedTs.length - 1]) {
            sampled = [...sampled, sortedTs[sortedTs.length - 1]]
          }
          const lookups = holdingData.map(h => ({ ...h, sorted: [...h.series].sort((a, b) => a.t - b.t) }))
          const pts = sampled.map((ts, idx) => {
            let val = 0
            lookups.forEach(h => {
              if (h.purchaseSec > 0 && ts < h.purchaseSec - 86400) return
              const price = getPriceAt(h.sorted, ts)
              if (!price || price <= 0) return
              const priceTHB = h.priceCcy === 'USD' ? price * fxRate : price
              val += h.shares * priceTHB
            })
            return { x: idx, y: val, label: mkLabel(new Date(ts * 1000)), ts }
          }).filter(p => p.y > 50)
          if (pts.length >= 2) realPortfolioPoints = pts
        }
      }
    }

    // ── Primary benchmark slice (used as x-axis anchor for synthetic fallback) ──
    const primaryKey = activeBenchKeys.find(k => BENCHMARKS[k]?.symbol) || null
    const primarySlice = primaryKey ? ((benchData[primaryKey]?.series || []).filter(p => p.t >= cutoffSec)) : []
    const hasSpx = primarySlice.length >= 2

    // ── Build final series ────────────────────────────────────────────────────
    if (realPortfolioPoints) {
      const portfolioSeries = {
        name: th ? "พอร์ตของคุณ" : "Your portfolio",
        color: "var(--ink)", fill: true,
        data: realPortfolioPoints.map((p, i) => ({ x: i, y: p.y, label: p.label })),
      }
      const firstPortVal = realPortfolioPoints[0].y
      const firstPortTs  = realPortfolioPoints[0].ts

      // Build one series per active benchmark — all rebased to portfolio's first point
      const benchSeries = activeBenchKeys.filter(k => BENCHMARKS[k]?.symbol).map(k => {
        const bSlice = (benchData[k]?.series || []).filter(p => p.t >= cutoffSec)
        if (bSlice.length < 2) return null
        const bSorted = [...bSlice].sort((a, b) => a.t - b.t)
        const bAtStart = getPriceAt(bSorted, firstPortTs) || bSorted[0]?.c
        if (!bAtStart) return null
        const bench = BENCHMARKS[k]
        return {
          name: th ? bench.labelTh : bench.labelEn,
          color: bench.color || "var(--accent)",
          data: realPortfolioPoints.map((p, i) => {
            const bPrice = getPriceAt(bSorted, p.ts)
            return { x: i, y: bPrice != null ? firstPortVal * (bPrice / bAtStart) : firstPortVal, label: p.label }
          }),
        }
      }).filter(Boolean)

      return [portfolioSeries, ...benchSeries]
    }

    // ── Synthetic fallback (while history loads) ──────────────────────────────
    const valRange = totalValue - totalCost
    const noiseScale = Math.max(Math.abs(valRange) * 0.1, totalCost * 0.015)
    const easeAt = p => p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p
    const noiseAt = (i, seed) => (
      Math.sin(i * 0.61 + seed) * 0.55 + Math.sin(i * 1.43 + seed * 1.7) * 0.30 +
      Math.sin(i * 2.91 + seed * 2.3) * 0.18 + Math.cos(i * 4.27 + seed * 3.1) * 0.10
    )

    if (!hasSpx) {
      const portPts = Math.max(8, Math.min(60, Math.round(totalDays / 7)))
      const portStepD = totalDays / (portPts - 1)
      return [{
        name: th ? "พอร์ตของคุณ" : "Your portfolio",
        color: "var(--ink)", fill: true,
        data: Array.from({ length: portPts }, (_, i) => {
          const p = i / (portPts - 1)
          const d = new Date(now); d.setDate(d.getDate() - (portPts - 1 - i) * portStepD)
          return { x: i, y: totalCost + valRange * easeAt(p) + noiseAt(i, 1.7) * noiseScale * Math.sin(Math.PI * p), label: mkLabel(d) }
        })
      }]
    }

    const targetPts = Math.max(8, Math.min(60, Math.round(totalDays / 7)))
    const stride = Math.max(1, Math.floor(primarySlice.length / targetPts))
    let sampled = primarySlice.filter((_, i) => i % stride === 0)
    if (sampled.length === 0 || sampled[sampled.length - 1] !== primarySlice[primarySlice.length - 1]) {
      sampled = [...sampled, primarySlice[primarySlice.length - 1]]
    }
    const N = sampled.length
    const baseClose = sampled[0].c
    const primaryBench = primaryKey ? BENCHMARKS[primaryKey] : BENCHMARKS.sp500
    return [
      {
        name: th ? "พอร์ตของคุณ" : "Your portfolio",
        color: "var(--ink)", fill: true,
        data: sampled.map((p, i) => {
          const prog = i / (N - 1)
          return { x: i, y: totalCost + valRange * easeAt(prog) + noiseAt(i, 1.7) * noiseScale * Math.sin(Math.PI * prog), label: mkLabel(new Date(p.t * 1000)) }
        })
      },
      {
        name: th ? primaryBench.labelTh : primaryBench.labelEn,
        color: primaryBench.color || "var(--accent)",
        data: sampled.map((p, i) => ({ x: i, y: totalCost * (p.c / baseClose), label: mkLabel(new Date(p.t * 1000)) }))
      }
    ]
  }, [dataState, totalCost, totalValue, th, chartPeriod, periodDaysMap, daysSinceFirst, benchData, liveHoldings, holdingHistories, purchaseSecByTicker, fxRate, activeBenchKeys])

  // Snapshots sliced to the selected period (shared by both chart modes)
  const windowSnaps = useMemo(() => {
    if (snaps.length < 2) return []
    let from = "0000-00-00"
    if (chartPeriod === "ytd") from = new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0]
    else if (chartPeriod !== "all") {
      const days = periodDaysMap[chartPeriod] || 365
      from = new Date(Date.now() - days * 86400000).toISOString().split("T")[0]
    }
    const w = snaps.filter(s => s.date >= from)
    const windowed = w.length >= 2 ? w : snaps
    // Drop data-artifact snapshots: day-over-day jump >50%, or isolated spike
    // (point >15% above both neighbors — catches bad Yahoo Finance prices)
    const wr = windowed.map(s => Number(s.total_cost) > 0 ? Number(s.total_value) / Number(s.total_cost) : null)
    const filtered = windowed.filter((s, i) => {
      const ci = wr[i]
      if (ci == null) return true
      if (i > 0) {
        const pi = wr[i - 1]
        if (pi != null && pi > 0 && Math.abs(ci / pi - 1) > 0.50) return false
      }
      if (i > 0 && i < windowed.length - 1) {
        const pi = wr[i - 1], ni = wr[i + 1]
        if (pi != null && ni != null && pi > 0 && ni > 0 && ci > pi * 1.15 && ci > ni * 1.15) return false
      }
      return true
    })
    // Always make the last chart point the current live value so the tooltip
    // matches the live portfolio KPI exactly — even if today's snapshot was
    // already stored earlier (intraday prices would have moved since then).
    if (totalValue > 0 && totalCost > 0 && filtered.length) {
      const today = new Date().toISOString().split("T")[0]
      const last = filtered[filtered.length - 1]
      const livePoint = { date: today, total_value: totalValue, total_cost: totalCost, _live: true }
      if (last.date < today)  return [...filtered, livePoint]
      if (last.date === today) return [...filtered.slice(0, -1), livePoint]
    }
    return filtered
  }, [snaps, chartPeriod, periodDaysMap, totalValue, totalCost])

  const labelFor = useMemo(() => {
    const locale = th ? "th-TH" : "en-US"
    return d => d.toLocaleString(locale, { month: "short" }) + " '" + String(d.getFullYear()).slice(2)
  }, [th])

  // ── Mode A: growth % comparison (rebased to 100) ───────────────────────────
  // "All" period: base = 1 (cost basis) so the final point matches the Total
  // Return KPI exactly.  Other periods: base = value/cost at window start so
  // the chart shows in-period movement.  S&P 500 is rebased to the same start.
  const growthSeries = useMemo(() => {
    if (dataState !== "live" || windowSnaps.length < 2) return null
    const win = windowSnaps
    const indexOf = s => Number(s.total_cost) > 0 ? Number(s.total_value) / Number(s.total_cost) : null

    // "All" period anchors to cost basis (ratio = 1) so the last plotted value
    // equals Total Return (value/cost – 1). Other periods rebase to window start.
    const base = chartPeriod === "all" ? 1 : (indexOf(win.find(s => indexOf(s) != null)) ?? 1)
    if (base === 0) return null

    // Build portfolio series
    const port = []
    win.forEach(s => {
      const gi = indexOf(s)
      port.push({ x: port.length, y: 100 * (gi != null ? gi : base) / base, label: labelFor(new Date(s.date)) })
    })
    const out = [{ name: th ? "พอร์ตของคุณ" : "Your portfolio", color: "var(--ink)", fill: true, data: port }]

    // Build one series per active benchmark — each rebased to its own start price
    const baseDate = chartPeriod === "all" && earliestHoldingDate
      ? earliestHoldingDate.toISOString().slice(0, 10)
      : win[0].date
    activeBenchKeys.filter(k => BENCHMARKS[k]?.symbol).forEach(k => {
      const bSorted = [...(benchData[k]?.series || [])].sort((a, b) => a.t - b.t)
      const bOnOrBefore = dateStr => {
        const sec = new Date(dateStr + "T23:59:59Z").getTime() / 1000
        let best = null
        for (const p of bSorted) { if (p.t <= sec) best = p.c; else break }
        return best
      }
      const bBase = bSorted.length ? bOnOrBefore(baseDate) : null
      if (!bBase) return
      const bPts = win.map((s, i) => {
        const c = bOnOrBefore(s.date)
        return { x: i, y: c ? 100 * c / bBase : 100, label: labelFor(new Date(s.date)) }
      })
      if (bPts.length < 2) return
      const bench = BENCHMARKS[k]
      out.push({ name: th ? bench.labelTh : bench.labelEn, color: bench.color, data: bPts })
    })
    return out
  }, [dataState, windowSnaps, benchData, th, labelFor, activeBenchKeys, chartPeriod, earliestHoldingDate])

  // ── Mode B: actual value (THB) — market value vs cost basis over time ──────
  const valueSeries = useMemo(() => {
    if (dataState !== "live" || windowSnaps.length < 2) return null
    const win = windowSnaps
    const val = [], cost = []
    win.forEach((s) => {
      const label = labelFor(new Date(s.date))
      val.push({ x: val.length, y: Number(s.total_value) || 0, label })
      cost.push({ x: cost.length, y: Number(s.total_cost) || 0, label })
    })
    return [
      { name: th ? "มูลค่าตลาด" : "Market value", color: "var(--ink)", fill: true, data: val },
      { name: th ? "ต้นทุน" : "Cost basis", color: "var(--accent)", data: cost },
    ]
  }, [dataState, windowSnaps, th, labelFor])

  const snapSeries = chartMode === "value" ? valueSeries : growthSeries

  // Merge same-ticker lots before sorting (so QH with 2 lots appears once)
  const livePerformers = useMemo(() => {
    const src = hasLivePrices ? rows.filter(r => r.hasLivePrice) : rows
    return dataState === "live" ? groupRowsByTicker(src) : src
  }, [rows, hasLivePrices, dataState])

  return (
    <div className="fade-in">
      <div className="grid grid-12" style={{ marginBottom: 16 }}>
        <BigKpi className="col-span-3"
          label={th ? "มูลค่าตลาด" : "Market value"}
          value={FMT.money(totalValue, ccy)}
          sub={FMT.money(totalCost, ccy, { compact: true }) + " " + (th ? "ต้นทุน" : "cost basis")} />
        <BigKpi className="col-span-3"
          label={th ? "กำไร/ขาดทุน รวม" : "Total P/L"}
          value={(totalPL >= 0 ? "+" : "") + FMT.money(totalPL, ccy, { compact: true })}
          sub={<Delta value={totalPlPct} />}
          tone={totalPL >= 0 ? "gain" : "loss"} />
        <BigKpi className="col-span-3"
          label={t.analytics.yield}
          value={FMT.pct(yieldOnPort, 2)}
          sub={th ? "ปันผลกระแสรายปี" : "annual income"} />
        {dataState === "live" ? (
          <BigKpi className="col-span-3"
            label={th ? "ผลตอบแทนรวม" : "Total return"}
            value={(totalPlPct >= 0 ? "+" : "") + totalPlPct.toFixed(1) + "%"}
            sub={th ? "เทียบต้นทุน · ดูรายละเอียดที่แท็บ Metrics" : "vs. cost · see Metrics tab for details"}
            tone={totalPlPct >= 0 ? "gain" : "loss"} />
        ) : (
          <BigKpi className="col-span-3" label={th ? "ผลตอบแทนรวม" : "Total return"} value="+18.3%" sub={th ? "12 เดือนล่าสุด" : "trailing 12-mo"} tone="gain" />
        )}
      </div>

      {dataState === "live" && !liveSeries ? (
        <div className="card" style={{ marginBottom: 16, padding: "36px 48px", display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="48" height="48" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
            <rect x="4" y="8" width="40" height="32" rx="4" fill="none" stroke="var(--line-2)" strokeWidth="1.5" strokeDasharray="4 4" />
            <path d="M8 32 L16 22 L24 26 L34 14 L44 20" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4 }}>
              {th ? "ยังไม่มีข้อมูลพอร์ต" : "No portfolio data yet"}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {th ? "เพิ่มหลักทรัพย์เพื่อดูกราฟ" : "Add holdings to see the chart"}
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
            <div>
              <h3 className="section-title">{
                dataState === "live" && snapSeries
                  ? (chartMode === "value"
                      ? (th ? "มูลค่าพอร์ต & ต้นทุน (฿)" : "Portfolio value & cost basis")
                      : (chartPeriod === "all"
                          ? (th ? "การเติบโต: พอร์ต vs. Benchmarks (เทียบต้นทุน)" : "Growth: Portfolio vs. Benchmarks (vs. cost basis)")
                          : (th ? "การเติบโต: พอร์ต vs. Benchmarks (ฐาน 100%)" : "Growth: Portfolio vs. Benchmarks (rebased)")))
                  : (th ? "มูลค่าพอร์ต vs. Benchmarks" : "Portfolio value vs. Benchmarks")}</h3>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                <span className="dot" style={{ background: "var(--ink)" }} /> {dataState === "live" && snapSeries && chartMode === "value" ? (th ? "มูลค่าตลาด" : "Market value") : (th ? "พอร์ตของคุณ" : "Your portfolio")}
                {dataState === "live" && chartMode !== "value" && (
                  <span style={{ fontSize: 11, marginLeft: 4, color: hasRealHistory ? "var(--green)" : "var(--ink-4)" }}>
                    {hasRealHistory
                      ? (th ? "(ราคาจริงจาก Yahoo Finance)" : "(real prices · Yahoo Finance)")
                      : (th ? "(กำลังโหลดข้อมูล…)" : "(loading real prices…)")}
                  </span>
                )}
                {dataState === "live" && chartMode === "value" && (
                  <span style={{ marginLeft: 12 }}>
                    <span className="dot" style={{ background: "var(--accent)" }} />
                    {" "}{th ? "ต้นทุน" : "Cost basis"}
                  </span>
                )}
                {dataState === "live" && chartMode === "pct" && activeBenchKeys.filter(k => BENCHMARKS[k]?.symbol).map(k => {
                  const bench = BENCHMARKS[k]
                  return (
                    <span key={k} style={{ marginLeft: 12 }}>
                      <span className="dot" style={{ background: bench.color }} />
                      {" "}{th ? bench.labelTh : bench.labelEn}
                    </span>
                  )
                })}
                {dataState !== "live" && (
                  <span style={{ marginLeft: 12 }}>
                    <span className="dot" style={{ background: "var(--accent)" }} />
                    {" "}S&P 500
                  </span>
                )}
                {dataState === "live" && earliestHoldingDate && (
                  <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 2 }}>
                    {th
                      ? `ตั้งแต่ลงทุนครั้งแรก · ${daysSinceFirst} วัน (${earliestHoldingDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })})`
                      : `Since first holding · ${daysSinceFirst} days (${earliestHoldingDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })})`}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {/* Benchmark toggle buttons — only in % growth mode */}
              {dataState === "live" && chartMode === "pct" && (
                <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                  {Object.entries(BENCHMARKS).filter(([k]) => k !== 'none').map(([k, b]) => {
                    const isOn = activeBenchKeys.includes(k)
                    const noData = isOn && (benchData[k]?.series?.length || 0) === 0
                    const col = b.color || "var(--accent)"
                    return (
                      <button key={k} onClick={() => toggleBench(k)}
                        style={{ padding: "4px 10px", borderRadius: 8, fontSize: 11, cursor: "pointer",
                                 border: `1.5px solid ${isOn ? col : "var(--line)"}`,
                                 background: isOn ? col + "22" : "transparent",
                                 color: isOn ? col : "var(--ink-4)",
                                 fontFamily: "var(--font-mono)", transition: "all 0.15s" }}>
                        {th ? b.labelTh : b.labelEn}{noData ? " ⚠" : ""}
                      </button>
                    )
                  })}
                </div>
              )}
              <div className="segmented">
                {["1m","3m","6m","ytd","1y","5y","all"].map(k => {
                  const enabled = isPeriodEnabled(k)
                  const active = dataState === "live" ? chartPeriod === k : k === "all"
                  return (
                    <button key={k}
                            className={active ? "on" : ""}
                            disabled={dataState === "live" && !enabled}
                            title={dataState === "live" && !enabled ? (th ? "ข้อมูลย้อนหลังไม่พอ" : "Not enough history yet") : undefined}
                            style={{ opacity: dataState === "live" && !enabled ? 0.35 : 1, cursor: dataState === "live" && !enabled ? "not-allowed" : "pointer" }}
                            onClick={() => dataState === "live" && enabled && setChartPeriod(k)}>
                      {t.analytics.timeRange[k]}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <LineChart
            series={dataState === "live" ? (snapSeries || liveSeries) : series}
            height={340}
            fmt={dataState === "live" && snapSeries && chartMode === "pct"
              ? (v => (v >= 100 ? "+" : "") + (v - 100).toFixed(1) + "%")
              : (v => FMT.money(v, ccy, { compact: true }))} />
        </div>
      )}

      {livePerformers.length >= 2 && totalCost > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className="section-title" style={{ marginBottom: 4 }}>
            {th ? "Attribution — การมีส่วนร่วมต่อผลตอบแทน" : "Performance attribution"}
          </h3>
          <div className="muted" style={{ fontSize: 11, marginBottom: 16 }}>
            {th ? "แต่ละหลักทรัพย์มีส่วนร่วมต่อผลตอบแทนรวมกี่ percentage point (pp)" : "Each holding's contribution to total portfolio return (percentage points)"}
          </div>
          <AttributionChart rows={livePerformers} totalCost={totalCost} totalPlPct={totalPlPct} ccy={ccy} th={th} />
        </div>
      )}

      {(() => {
        // Demo mode: keep old behavior (no positive/negative split)
        // Live mode: filter — Top = gainers only (plPct > 0), Under = losers only (plPct < 0)
        const gainers = dataState === "live"
          ? livePerformers.filter(r => r.plPct > 0)
          : livePerformers
        const losers  = dataState === "live"
          ? livePerformers.filter(r => r.plPct < 0)
          : livePerformers
        return (
          <div className="grid grid-2">
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 16 }}>{th ? "ผลงานดีที่สุด" : "Top performers"}</h3>
              {livePerformers.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "16px 0" }}>{th ? "รอราคาตลาด…" : "Waiting for live prices…"}</div>
              ) : gainers.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "16px 0" }}>
                  {th ? "ยังไม่มีหลักทรัพย์ที่กำไร" : "No gaining positions yet"}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {[...gainers].sort((a, b) => b.plPct - a.plPct).slice(0, 4).map(r => (
                    <PerfRow key={r.ticker} r={r} ccy={ccy} />
                  ))}
                </div>
              )}
            </div>
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: 16 }}>{th ? "ผลงานที่แย่ที่สุด" : "Underperformers"}</h3>
              {livePerformers.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "16px 0" }}>{th ? "รอราคาตลาด…" : "Waiting for live prices…"}</div>
              ) : losers.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, padding: "16px 0" }}>
                  {th ? "ยังไม่มีหลักทรัพย์ที่ขาดทุน" : "No losing positions"}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {[...losers].sort((a, b) => a.plPct - b.plPct).slice(0, 4).map(r => (
                    <PerfRow key={r.ticker} r={r} ccy={ccy} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function PerfRow({ r, ccy }) {
  const FMT = LUMEN_FMT
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 12, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
      <TickerLogo ticker={r.ticker} logoUrl={r.logo_url} region={r.region} cls={r.cls} size={30} />
      <div>
        <div style={{ fontWeight: 500, fontSize: 13 }}>{r.ticker}</div>
        <div className="muted" style={{ fontSize: 11 }}>{r.name}</div>
      </div>
      <div className="mono" style={{ fontSize: 13 }}>{FMT.money(r.value, ccy, { compact: true })}</div>
      <div style={{ textAlign: "right" }}>
        <div style={{ color: r.pl >= 0 ? "var(--gain)" : "var(--loss)", fontVariant: "tabular-nums", fontSize: 13 }}>
          {r.pl >= 0 ? "+" : ""}{FMT.money(r.pl, ccy, { compact: true })}
        </div>
        <Delta value={r.plPct} size={11} />
      </div>
    </div>
  )
}

function AttributionChart({ rows, totalCost, totalPlPct, ccy, th }) {
  const FMT = LUMEN_FMT
  const [filter, setFilter]   = useState("all")
  const [sortKey, setSortKey] = useState("contrib")
  const [sortDir, setSortDir] = useState("desc")

  const withContrib = useMemo(() =>
    rows.map(r => ({ ...r, contrib: totalCost > 0 ? (r.pl / totalCost) * 100 : 0 }))
  , [rows, totalCost])

  // Build filter categories from actual holdings only
  const categories = useMemo(() => {
    const has = (cls)         => withContrib.some(r => r.cls === cls)
    const hasRC = (cls, reg)  => withContrib.some(r => r.cls === cls && r.region === reg)
    const cats = [{ key: "all", label: th ? "ทั้งหมด" : "All" }]
    if (hasRC("Equity", "TH"))            cats.push({ key: "th_eq",  label: th ? "หุ้นไทย"   : "TH Equity" })
    if (hasRC("Equity", "US"))            cats.push({ key: "us_eq",  label: th ? "หุ้น US"   : "US Equity" })
    if (has("GoldTH") || has("Commodity"))cats.push({ key: "gold",   label: th ? "ทอง"       : "Gold"      })
    if (has("Crypto"))                    cats.push({ key: "crypto", label: "Crypto"                         })
    if (has("Bond"))                      cats.push({ key: "bond",   label: th ? "พันธบัตร"  : "Bond"      })
    if (has("MutualFund"))                cats.push({ key: "mf",     label: th ? "กองทุน"    : "Fund"      })
    return cats
  }, [withContrib, th])

  const filtered = useMemo(() => withContrib.filter(r => {
    if (filter === "all")    return true
    if (filter === "th_eq")  return r.cls === "Equity"   && r.region === "TH"
    if (filter === "us_eq")  return r.cls === "Equity"   && r.region === "US"
    if (filter === "gold")   return r.cls === "GoldTH"   || r.cls === "Commodity"
    if (filter === "crypto") return r.cls === "Crypto"
    if (filter === "bond")   return r.cls === "Bond"
    if (filter === "mf")     return r.cls === "MutualFund"
    return true
  }), [withContrib, filter])

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0
      return sortDir === "desc" ? bv - av : av - bv
    })
  , [filtered, sortKey, sortDir])

  const maxAbs = useMemo(() => Math.max(...sorted.map(r => Math.abs(r.contrib)), 0.01), [sorted])
  const filteredContrib = filtered.reduce((s, r) => s + r.contrib, 0)
  const isFiltered = filter !== "all"

  const toggleSort = key => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc")
    else { setSortKey(key); setSortDir("desc") }
  }

  const SORT_OPTS = [
    { key: "contrib", label: "pp"                        },
    { key: "plPct",   label: "P/L%"                      },
    { key: "value",   label: th ? "มูลค่า" : "Value"    },
  ]

  const chipStyle = active => ({
    fontSize: 11, padding: "4px 10px", borderRadius: 99, cursor: "pointer",
    border: active ? "1.5px solid var(--ink)" : "1px solid var(--line)",
    background: active ? "var(--ink)" : "transparent",
    color: active ? "var(--bg)" : "var(--ink-2)",
    fontWeight: active ? 700 : 400,
    fontFamily: "var(--font-mono)",
  })

  const sortBtnStyle = active => ({
    padding: "4px 8px", borderRadius: 6, fontSize: 11, cursor: "pointer",
    border: "1px solid var(--line)",
    background: active ? "var(--ink)" : "var(--bg)",
    color: active ? "var(--bg)" : "var(--ink-2)",
    fontWeight: active ? 700 : 400,
    display: "flex", alignItems: "center", gap: 3,
  })

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {categories.map(c => (
            <button key={c.key} onClick={() => setFilter(c.key)} style={chipStyle(filter === c.key)}>
              {c.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 11, marginRight: 2 }}>{th ? "เรียงตาม" : "Sort:"}</span>
          {SORT_OPTS.map(o => (
            <button key={o.key} onClick={() => toggleSort(o.key)} style={sortBtnStyle(sortKey === o.key)}>
              {o.label}
              {sortKey === o.key && <span style={{ fontSize: 9 }}>{sortDir === "desc" ? "↓" : "↑"}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div style={{ display: "grid", gap: 10 }}>
        {sorted.map(r => {
          const isPos = r.contrib >= 0
          const barPct = Math.abs(r.contrib) / maxAbs * 50
          return (
            <div key={r.ticker} style={{ display: "grid", gridTemplateColumns: "28px 60px 1fr 68px 80px", gap: 10, alignItems: "center" }}>
              <TickerLogo ticker={r.ticker} logoUrl={r.logo_url} region={r.region} cls={r.cls} size={24} />
              <span style={{ fontWeight: 600, fontSize: 12, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.ticker}
              </span>
              <div style={{ position: "relative", height: 8, background: "var(--bg-2)", borderRadius: 99 }}>
                <div style={{
                  position: "absolute", top: 0, bottom: 0, borderRadius: 99,
                  background: isPos ? "var(--gain)" : "var(--loss)",
                  width: `${barPct}%`,
                  ...(isPos ? { left: "50%" } : { right: "50%" }),
                }} />
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--line-2)" }} />
              </div>
              <div className="mono" style={{ fontSize: 12, textAlign: "right", fontWeight: 700, color: isPos ? "var(--gain)" : "var(--loss)" }}>
                {isPos ? "+" : ""}{r.contrib.toFixed(2)}pp
              </div>
              <div className="mono" style={{ fontSize: 11, textAlign: "right", color: "var(--ink-3)" }}>
                {r.pl >= 0 ? "+" : ""}{FMT.money(r.pl, ccy, { compact: true })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{ marginTop: 8, paddingTop: 12, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {isFiltered ? (th ? "รวมกลุ่มนี้" : "Group total") : (th ? "ผลตอบแทนรวม" : "Total return")}
        </span>
        <span className="mono" style={{ fontWeight: 700, fontSize: 14, color: (isFiltered ? filteredContrib : totalPlPct) >= 0 ? "var(--gain)" : "var(--loss)" }}>
          {isFiltered
            ? (filteredContrib >= 0 ? "+" : "") + filteredContrib.toFixed(2) + "pp"
            : (totalPlPct >= 0 ? "+" : "") + totalPlPct.toFixed(2) + "%"}
        </span>
      </div>
    </div>
  )
}

/* ─── Diversification tab ────────────────────────────────────────────────────── */
function AnalyticsDiv({ t, lang, ccy, rows, totalValue, demoData, dataState }) {
  const th = lang === "th"
  const cash = demoData?.cash || 0
  const total = dataState === "live" ? totalValue : (totalValue + cash)

  const byClass  = bucket(rows, r => r.cls === "Equity" ? (r.region === "TH" ? (th ? "หุ้นไทย" : "TH Equity") : (th ? "หุ้น US" : "US Equity")) : r.cls, total, dataState !== "live" ? cash : 0)
  const bySector = bucket(rows, r => (r.sector && r.sector !== "—") ? r.sector : (th ? "ไม่ระบุ" : "Unclassified"), total)
  const byRegion = bucket(rows, r => r.region === "—" ? "Global" : r.region, total)

  return (
    <div className="fade-in grid grid-12">
      <DivCard className="col-span-4" title={t.analytics.byAsset}  data={byClass} />
      <DivCard className="col-span-4" title={t.analytics.bySector} data={bySector} />
      <DivCard className="col-span-4" title={t.analytics.byRegion} data={byRegion} />
    </div>
  )
}

function bucket(rows, keyFn, total, extraCash) {
  const map = {}
  rows.forEach(r => {
    const k = keyFn(r)
    map[k] = (map[k] || 0) + r.value
  })
  if (extraCash) map["Cash"] = extraCash
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({ name, value, color: paletteColor(i) }))
}
function paletteColor(i) { return ["var(--c1)","var(--c2)","var(--c3)","var(--c4)","var(--c5)","var(--c6)","var(--c7)"][i % 7] }

function DivCard({ title, data, className }) {
  const total = data.reduce((a, b) => a + b.value, 0)
  return (
    <div className={"card " + className}>
      <h3 className="section-title" style={{ marginBottom: 16 }}>{title}</h3>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <Donut data={data} size={170} thickness={22} />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {data.map((s, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", fontSize: 12 }}>
            <span className="dot" style={{ background: s.color }} />
            <span>{s.name}</span>
            <span className="mono">{((s.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Dividend Tax Summary (WHT report) ─────────────────────────────────────── */
function DividendTaxSummary({ transactions, lang, ccy, fxRate = 36 }) {
  const th = lang === "th"
  const FMT = LUMEN_FMT
  const [expandedYears, setExpandedYears] = useState(new Set())

  const toggleYear = (y) => setExpandedYears(prev => {
    const next = new Set(prev); next.has(y) ? next.delete(y) : next.add(y); return next
  })

  // Parse "WHT 10%" from note → decimal (0.10) or null if not present
  const parseWHTRate = (note) => {
    const m = note?.match(/WHT\s*(\d+)%/)
    return m ? parseInt(m[1]) / 100 : null
  }

  // Build { year: { gross, wht, net, rows: [{ticker, currency, gross, wht, net}] } }
  const summary = useMemo(() => {
    const byYear = {}
    const divTxs = transactions.filter(tx =>
      tx.type === 'Dividend' && tx.transacted_at && Number(tx.amount) > 0
    )
    divTxs.forEach(tx => {
      const year = tx.transacted_at.slice(0, 4)
      const isTHB = (tx.currency || 'THB') !== 'USD'
      const netTHB = Number(tx.amount) * (isTHB ? 1 : fxRate)
      const whtRate = parseWHTRate(tx.note)
      const grossTHB = whtRate != null && whtRate > 0 ? netTHB / (1 - whtRate) : netTHB
      const whtTHB  = grossTHB - netTHB

      if (!byYear[year]) byYear[year] = { gross: 0, wht: 0, net: 0, tickers: {} }
      byYear[year].gross += grossTHB
      byYear[year].wht   += whtTHB
      byYear[year].net   += netTHB

      const tk = tx.ticker || '—'
      if (!byYear[year].tickers[tk]) byYear[year].tickers[tk] = { gross: 0, wht: 0, net: 0, whtRate, currency: tx.currency || 'THB' }
      byYear[year].tickers[tk].gross += grossTHB
      byYear[year].tickers[tk].wht   += whtTHB
      byYear[year].tickers[tk].net   += netTHB
    })
    return Object.entries(byYear)
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([year, data]) => ({
        year,
        ...data,
        rows: Object.entries(data.tickers)
          .sort(([, a], [, b]) => b.gross - a.gross)
          .map(([ticker, d]) => ({ ticker, ...d })),
      }))
  }, [transactions, fxRate])

  // Export all dividend transactions as WHT-enriched CSV
  const handleExportCSV = () => {
    const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`
    const header = ['Date','Year','Ticker','Currency','Net (THB)','WHT Rate','WHT (THB)','Gross (THB)','Note']
    const rows = transactions
      .filter(tx => tx.type === 'Dividend' && tx.transacted_at && Number(tx.amount) > 0)
      .sort((a, b) => a.transacted_at.localeCompare(b.transacted_at))
      .map(tx => {
        const isTHB = (tx.currency || 'THB') !== 'USD'
        const netTHB = +(Number(tx.amount) * (isTHB ? 1 : fxRate)).toFixed(2)
        const whtRate = parseWHTRate(tx.note)
        const grossTHB = whtRate != null && whtRate > 0 ? +(netTHB / (1 - whtRate)).toFixed(2) : netTHB
        const whtTHB  = +(grossTHB - netTHB).toFixed(2)
        return [
          tx.transacted_at.slice(0, 10),
          tx.transacted_at.slice(0, 4),
          tx.ticker || '',
          tx.currency || 'THB',
          netTHB, whtRate != null ? (whtRate * 100).toFixed(0) + '%' : '',
          whtTHB, grossTHB,
          esc(tx.note || ''),
        ].join(',')
      })
    const csv = '﻿' + [header.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `lumen-dividend-tax-${new Date().getFullYear()}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (summary.length === 0) return null

  const colHd = { fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textAlign: "right", padding: "6px 0" }
  const cell  = { fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "right", padding: "5px 0" }

  return (
    <div className="card col-span-12">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h3 className="section-title">{th ? "สรุปภาษีปันผล (WHT)" : "Dividend Tax Summary (WHT)"}</h3>
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {th ? "กรอง TH 10% · US 15% · ยอดในสกุล THB ณ อัตรา FX ขณะนั้น"
                : "TH 10% · US 15% withholding · amounts in THB at prevailing FX rate"}
          </p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={handleExportCSV}>
          <Icon name="upload" size={13} style={{ transform: "rotate(180deg)" }} />
          {th ? "ส่งออก CSV" : "Export CSV"}
        </button>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...colHd, textAlign: "left" }}>{th ? "ปี" : "Year"}</th>
              <th style={colHd}>{th ? "ปันผลรวม (Gross)" : "Gross dividend"}</th>
              <th style={colHd}>{th ? "ภาษีหัก ณ ที่จ่าย" : "WHT withheld"}</th>
              <th style={colHd}>{th ? "รับสุทธิ (Net)" : "Net received"}</th>
              <th style={{ ...colHd, textAlign: "center", width: 32 }} />
            </tr>
          </thead>
          <tbody>
            {summary.map(yr => (
              // Fragment with key — required in React 18 when a list item renders multiple <tr> rows
              <Fragment key={yr.year}>
                {/* Year summary row */}
                <tr
                  style={{ cursor: "pointer", borderTop: "1px solid var(--line)" }}
                  onClick={() => toggleYear(yr.year)}>
                  <td style={{ fontSize: 14, fontWeight: 700, padding: "8px 0" }}>
                    {th ? `ปี ${yr.year}` : yr.year}
                  </td>
                  <td style={{ ...cell, fontWeight: 600 }}>{FMT.money(yr.gross, ccy)}</td>
                  <td style={{ ...cell, fontWeight: 600, color: "var(--loss)" }}>
                    −{FMT.money(yr.wht, ccy)}
                  </td>
                  <td style={{ ...cell, fontWeight: 600, color: "var(--gain)" }}>{FMT.money(yr.net, ccy)}</td>
                  <td style={{ textAlign: "center", padding: "8px 0", color: "var(--ink-3)" }}>
                    <span style={{ display: "inline-block", transform: expandedYears.has(yr.year) ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
                  </td>
                </tr>
                {/* Per-ticker breakdown */}
                {expandedYears.has(yr.year) && yr.rows.map(r => (
                  <tr key={r.ticker} style={{ background: "var(--bg-2)" }}>
                    <td style={{ fontSize: 12, padding: "5px 0 5px 16px", color: "var(--ink-2)" }}>
                      {r.ticker}
                      <span className="chip chip-soft" style={{ marginLeft: 6, fontSize: 9, padding: "1px 5px" }}>
                        {r.whtRate != null ? `WHT ${(r.whtRate * 100).toFixed(0)}%` : r.currency}
                      </span>
                    </td>
                    <td style={cell}>{FMT.money(r.gross, ccy)}</td>
                    <td style={{ ...cell, color: "var(--loss)" }}>−{FMT.money(r.wht, ccy)}</td>
                    <td style={{ ...cell, color: "var(--gain)" }}>{FMT.money(r.net, ccy)}</td>
                    <td />
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ─── Dividend Calendar ──────────────────────────────────────────────────────── */
function DividendCalendar({ divHistory, transactions, liveHoldings, lang }) {
  const th = lang === "th"
  const todayStr = new Date().toISOString().slice(0, 10)
  const [calDate, setCalDate] = useState(() => {
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  // Build map: "YYYY-MM-DD" → [{ticker, status}]
  // status: 'received' | 'pending' | 'upcoming'
  const eventMap = useMemo(() => {
    if (!divHistory) return {}
    const map = {}
    const nowSec = Date.now() / 1000
    const divTxs = transactions.filter(tx => tx.type === 'Dividend')
    liveHoldings.forEach(h => {
      const sym = toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity')
      ;(divHistory[sym] || []).forEach(e => {
        const xdDateStr = toXdStr(e.date)
        const status = e.date > nowSec ? 'upcoming'
          : isDivRecorded(divTxs, h.ticker, xdDateStr) ? 'received'
          : 'pending'
        if (!map[xdDateStr]) map[xdDateStr] = []
        // Avoid duplicates if same ticker has multiple lots
        if (!map[xdDateStr].some(x => x.ticker === h.ticker))
          map[xdDateStr].push({ ticker: h.ticker, status })
      })
    })
    return map
  }, [divHistory, transactions, liveHoldings])

  const year = calDate.getFullYear()
  const month = calDate.getMonth()
  const firstDOW = (new Date(year, month, 1).getDay() + 6) % 7  // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = [...Array(firstDOW).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  const monthLabel = calDate.toLocaleString(th ? "th-TH" : "en-US", { month: "long", year: "numeric" })
  const dayHdrs = th ? ["จ","อ","พ","พฤ","ศ","ส","อา"] : ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]

  const btnStyle = { background: "none", border: "1px solid var(--line)", borderRadius: 6, cursor: "pointer", padding: "4px 10px", fontSize: 14, color: "var(--ink-2)" }
  const dotStyle = (color) => ({ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: color, marginRight: 4 })

  return (
    <div className="card col-span-12">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h3 className="section-title">{th ? "ปฏิทินปันผล" : "Dividend Calendar"}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Legend */}
          <span style={{ fontSize: 11, color: "var(--ink-3)", display: "flex", gap: 12, marginRight: 8 }}>
            <span><span style={dotStyle("var(--gain)")} />{th ? "รับแล้ว" : "Received"}</span>
            <span><span style={dotStyle("var(--loss)")} />{th ? "รอ Sync" : "Pending"}</span>
            <span><span style={dotStyle("var(--accent-ink)")} />{th ? "กำลังมา" : "Upcoming"}</span>
          </span>
          <button style={btnStyle} onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>◀</button>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, minWidth: 148, textAlign: "center" }}>{monthLabel}</span>
          <button style={btnStyle} onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>▶</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {/* Day headers */}
        {dayHdrs.map(h => (
          <div key={h} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--ink-3)", padding: "4px 2px" }}>{h}</div>
        ))}
        {/* Day cells */}
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const events = eventMap[dateStr] || []
          const isToday = dateStr === todayStr
          const hasPending = events.some(e => e.status === 'pending')
          return (
            <div key={day} style={{
              minHeight: 52, padding: "4px 5px", borderRadius: 6,
              background: isToday ? "var(--accent-soft)"
                : events.length > 0 ? "var(--bg-2)" : "transparent",
              border: `1px solid ${isToday ? "var(--accent)" : hasPending ? "var(--loss)" : "transparent"}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? "var(--accent-ink)" : "var(--ink-2)", marginBottom: 2 }}>
                {day}
              </div>
              {events.map((ev, j) => (
                <div key={j} style={{
                  fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)",
                  borderRadius: 3, padding: "1px 4px", marginBottom: 2,
                  background: ev.status === 'received' ? "var(--gain-soft)"
                    : ev.status === 'pending' ? "var(--loss-soft)"
                    : "var(--accent-soft)",
                  color: ev.status === 'received' ? "var(--gain)"
                    : ev.status === 'pending' ? "var(--loss)"
                    : "var(--accent-ink)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {ev.ticker}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Dividends tab ──────────────────────────────────────────────────────────── */
function AnalyticsDiv2({ t, lang, ccy, rows, totalValue, dataState, liveHoldings = [], fxRate = 36, transactions = [], portfolio = null, onTransactionAdded, onTransactionUpdated, onTransactionDeleted }) {
  const FMT = LUMEN_FMT
  const th = lang === "th"

  // ── Fetch 5-year dividend event history for all live holdings ──────────────
  const [divHistory, setDivHistory] = useState(null)  // { "QH.BK": [{date, amount}], ... }
  const [divLoading, setDivLoading] = useState(false)

  useEffect(() => {
    if (dataState !== "live" || liveHoldings.length === 0) return
    let cancelled = false
    setDivLoading(true)
    const symbols = liveHoldings
      .map(h => toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity'))
      .filter((v, i, a) => a.indexOf(v) === i)  // deduplicate
      .join(',')
    fetch(`/api/dividends?symbols=${encodeURIComponent(symbols)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setDivHistory(d); setDivLoading(false) } })
      .catch(() => { if (!cancelled) setDivLoading(false) })
    return () => { cancelled = true }
  }, [dataState, liveHoldings])

  // ── Primary: use recorded Dividend transactions (exact net amounts) ──────────
  // transactions.amount = actual net received after withholding tax & fees.
  // This is more accurate than estimating from Yahoo Finance event prices × shares.
  const receivedFromTx = useMemo(() => {
    const divTxs = transactions.filter(tx => tx.type === 'Dividend')
    if (divTxs.length === 0) return null

    const byYear = {}
    const byTicker = {}
    let totalReceived = 0

    divTxs.forEach(tx => {
      // amount = net received; fall back to shares × price if amount missing
      const rawAmount = tx.amount != null
        ? Number(tx.amount)
        : (tx.shares != null && tx.price != null ? Number(tx.shares) * Number(tx.price) : 0)
      if (rawAmount <= 0) return

      const isTHB = (tx.currency || 'THB') === 'THB'
      const amountTHB = isTHB ? rawAmount : rawAmount * fxRate

      totalReceived += amountTHB
      const year = tx.transacted_at
        ? String(new Date(tx.transacted_at).getFullYear())
        : String(new Date().getFullYear())
      byYear[year] = (byYear[year] || 0) + amountTHB
      const ticker = tx.ticker || ''
      if (ticker) byTicker[ticker] = (byTicker[ticker] || 0) + amountTHB
    })

    return { totalReceived, byYear, byTicker, source: 'transactions' }
  }, [transactions, fxRate])

  // ── Earliest Buy date per ticker (purchase date cutoff, also used by Sync) ──
  const tickerPurchaseSec = useMemo(() => {
    const map = {}
    transactions
      .filter(tx => tx.type === 'Buy' && tx.transacted_at)
      .forEach(tx => {
        const sec = new Date(tx.transacted_at).getTime() / 1000
        const ticker = tx.ticker || ''
        if (ticker && (!(ticker in map) || sec < map[ticker])) map[ticker] = sec
      })
    return map
  }, [transactions])

  const receivedFromApi = useMemo(() => {
    if (receivedFromTx || dataState !== "live" || !divHistory) return null
    const byYear = {}
    const byTicker = {}
    let totalReceived = 0

    liveHoldings.forEach(h => {
      const sym = toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity')
      const events = divHistory[sym] || []
      const purchaseSec = tickerPurchaseSec[h.ticker]
        ?? (h.purchased_at ? new Date(h.purchased_at).getTime() / 1000
          : h.created_at   ? new Date(h.created_at).getTime()   / 1000
          : 0)
      const isTHB = (h.region || 'TH') === 'TH'

      events
        .filter(e => e.date >= purchaseSec)
        .forEach(e => {
          const amountTHB = isTHB ? e.amount * h.shares : e.amount * h.shares * fxRate
          totalReceived += amountTHB
          const year = String(new Date(e.date * 1000).getFullYear())
          byYear[year]       = (byYear[year]       || 0) + amountTHB
          byTicker[h.ticker] = (byTicker[h.ticker] || 0) + amountTHB
        })
    })
    return { totalReceived, byYear, byTicker, source: 'api' }
  }, [receivedFromTx, dataState, divHistory, liveHoldings, fxRate, tickerPurchaseSec])

  // receivedFromTx takes priority; fall back to API estimate
  const receivedData = receivedFromTx ?? receivedFromApi

  // ── Sync: check Yahoo Finance for unrecorded dividends ────────────────────
  const [syncModal, setSyncModal] = useState(null)  // null | 'loading' | suggestion[]
  const [syncSaving, setSyncSaving] = useState(false)

  // ── Edit recorded dividends ───────────────────────────────────────────────
  const [editModal, setEditModal] = useState(null)  // null | [{...tx, editedAmount, editedDate, markedDelete}]
  const [editSaving, setEditSaving] = useState(false)

  function openEditModal() {
    const meta = {}
    liveHoldings.forEach(h => { meta[h.ticker] = { region: h.region, cls: h.asset_class, logo_url: h.logo_url } })
    const divTxs = transactions
      .filter(tx => tx.type === 'Dividend')
      .sort((a, b) => new Date(b.transacted_at) - new Date(a.transacted_at))
      .map(tx => ({
        ...tx,
        ...(meta[tx.ticker] || {}),
        editedAmount: tx.amount ?? 0,
        editedShares: tx.shares ?? '',
        editedDate: tx.transacted_at ?? '',
        markedDelete: false,
      }))
    setEditModal(divTxs)
  }

  async function handleSaveEdits() {
    if (!editModal) return
    setEditSaving(true)
    try {
      for (const row of editModal) {
        if (row.markedDelete) {
          await deleteTransaction(row.id)
          onTransactionDeleted?.(row.id)
        } else {
          const amtChanged    = Number(row.editedAmount) !== Number(row.amount ?? 0)
          const sharesChanged = String(row.editedShares) !== String(row.shares ?? '')
          const dateChanged   = row.editedDate !== (row.transacted_at ?? '')
          if (amtChanged || sharesChanged || dateChanged) {
            const updates = {
              amount: Number(row.editedAmount),
              shares: row.editedShares !== '' ? Number(row.editedShares) : row.shares,
              transacted_at: row.editedDate,
            }
            const { data } = await updateTransaction(row.id, updates)
            if (data) onTransactionUpdated?.(data)
          }
        }
      }
      setEditModal(null)
    } catch (err) {
      console.error('[Lumen] edit dividends:', err)
    } finally {
      setEditSaving(false)
    }
  }

  async function handleSync() {
    setSyncModal('loading')
    try {
      // Build full ticker metadata: live holdings first, then any ticker in Buy/Sell history
      // (covers tickers that were fully sold — they still deserve dividend lookups)
      const tickerMeta = {}
      liveHoldings.forEach(h => { if (!tickerMeta[h.ticker]) tickerMeta[h.ticker] = h })
      transactions.forEach(tx => {
        if ((tx.type === 'Buy' || tx.type === 'Sell') && tx.ticker && !tickerMeta[tx.ticker]) {
          // Infer region from currency; asset_class defaults to Equity (most dividend payers)
          const region = (tx.currency === 'USD' || tx.currency === 'usd') ? 'US' : 'TH'
          tickerMeta[tx.ticker] = { ticker: tx.ticker, region, asset_class: 'Equity', logo_url: null }
        }
      })

      let history = divHistory
      if (!history) {
        const syms = Object.values(tickerMeta)
          .map(h => toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity'))
          .filter((v, i, a) => a.indexOf(v) === i).join(',')
        history = await fetch(`/api/dividends?symbols=${encodeURIComponent(syms)}`).then(r => r.json())
        setDivHistory(history)
      } else {
        // If divHistory was cached from live-holdings-only fetch, re-fetch to include sold tickers
        const cachedSyms = new Set(Object.keys(history))
        const allSyms = Object.values(tickerMeta)
          .map(h => toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity'))
          .filter((v, i, a) => a.indexOf(v) === i)
        const missing = allSyms.filter(s => !cachedSyms.has(s))
        if (missing.length > 0) {
          const extra = await fetch(`/api/dividends?symbols=${encodeURIComponent(missing.join(','))}`).then(r => r.json())
          history = { ...history, ...extra }
          setDivHistory(history)
        }
      }

      const nowSec = Date.now() / 1000
      const divTxs = transactions.filter(tx => tx.type === 'Dividend')
      const alreadyRecorded = (ticker, xdDateStr) => isDivRecorded(divTxs, ticker, xdDateStr)
      // Shares actually held BEFORE the ex-dividend date (from the transaction ledger).
      // Uses date-string comparison to be timezone-safe.
      // Shares bought on or after XD date are excluded — you need to hold before XD to receive the dividend.
      const sharesAsOf = (ticker, xdDateStr) => {
        let s = 0
        for (const tx of transactions) {
          if (tx.ticker !== ticker || !tx.transacted_at) continue
          if (tx.transacted_at.slice(0, 10) >= xdDateStr) continue  // bought on/after XD → not entitled
          const q = Number(tx.shares) || 0
          if (tx.type === 'Buy') s += q
          else if (tx.type === 'Sell') s -= q
        }
        return Math.max(0, s)
      }
      const suggestions = []
      Object.values(tickerMeta).forEach(h => {
        const sym = toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity');
        (history[sym] || [])
          .filter(e => {
            const xdDateStr = toXdStr(e.date)
            return e.date <= nowSec && !alreadyRecorded(h.ticker, xdDateStr)
          })
          .forEach(e => {
            const xdDateStr = toXdStr(e.date)
            const sharesHeld = sharesAsOf(h.ticker, xdDateStr)
            if (sharesHeld <= 0) return   // didn't hold it before the ex-date
            const region  = h.region || 'TH'
            const isTHB   = region === 'TH'
            const gross   = +(e.amount * sharesHeld).toFixed(2)
            const taxRate = region === 'TH' ? 0.10 : region === 'US' ? 0.15 : 0
            const net     = +(gross * (1 - taxRate)).toFixed(2)
            suggestions.push({
              ticker: h.ticker,
              region, cls: h.asset_class || 'Equity', logo_url: h.logo_url || null,
              xdDate:    xdDateStr,   // ex-dividend date from Yahoo
              date:      xdDateStr,   // editedDate default = xdDate; user can change to pay date
              dateLabel: new Date(xdDateStr + 'T12:00:00Z').toLocaleDateString(th ? 'th-TH' : 'en-US', { day: 'numeric', month: 'short', year: '2-digit' }),
              pricePerShare: e.amount,
              shares: sharesHeld,
              gross, taxRate, net,
              editedNet: net,
              currency: isTHB ? 'THB' : 'USD',
              checked: true,
            })
          })
      })
      suggestions.sort((a, b) => b.date.localeCompare(a.date))
      setSyncModal(suggestions)
    } catch (err) {
      console.error('[Lumen] sync dividends:', err)
      setSyncModal([])
    }
  }

  async function handleConfirmSync(items) {
    if (!portfolio?.id) return
    setSyncSaving(true)
    const toSave = items.filter(s => s.checked)
    const newTxs = []
    for (const s of toSave) {
      const { data } = await addTransaction(portfolio.id, {
        type: 'Dividend',
        ticker: s.ticker,
        shares: s.shares,
        price:  s.pricePerShare,
        amount: s.editedNet,
        currency: s.currency,
        transacted_at: s.date,
        note: `Synced · xd:${s.xdDate} · ${s.currency === 'USD' ? '$' : '฿'}${s.pricePerShare}/share gross · WHT ${(s.taxRate * 100).toFixed(0)}%`,
      })
      if (data) newTxs.push(data)
    }
    if (newTxs.length > 0) onTransactionAdded?.(newTxs)
    setSyncSaving(false)
    setSyncModal(null)
  }

  // Historical received bar chart (years sorted asc)
  const histBarData = useMemo(() => {
    if (!receivedData?.byYear) return []
    return Object.entries(receivedData.byYear)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, value]) => ({ label: year, value }))
  }, [receivedData])

  // ── Forward-looking (projected) metrics ───────────────────────────────────
  const annual      = rows.reduce((a, r) => a + r.value * (r.divYield || 0) / 100, 0)
  const yieldOnPort = totalValue > 0 ? (annual / totalValue) * 100 : 0
  // Aggregate per-lot rows into one entry per ticker
  const payerMap = {}
  rows.filter(r => r.divYield > 0).forEach(r => {
    if (!payerMap[r.ticker]) payerMap[r.ticker] = { ...r, value: 0 }
    payerMap[r.ticker].value += r.value
  })
  const payers = Object.values(payerMap)
    .map(p => ({ ...p, annual: p.value * p.divYield / 100 }))
    .sort((a, b) => b.annual - a.annual)

  // Estimated monthly payouts (next 12 months) — quarterly-weighted
  const months = ["Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May"]
  const quarterlyWeights = [0.6, 0.4, 0.3, 1.6, 0.5, 0.4, 1.7, 0.4, 0.3, 1.6, 0.5, 1.7]
  const monthlyData = months.map((m, i) => ({
    label: m,
    value: dataState === "live"
      ? (annual / 10) * quarterlyWeights[i]
      : (annual / 12) * (1 + Math.sin(i) * 0.3 + Math.cos(i * 1.7) * 0.18),
  }))

  const hasReceivedData = dataState === "live" && receivedData && receivedData.totalReceived > 0

  return (
    <div className="fade-in grid grid-12">
      {/* ── KPI row ── */}
      <BigKpi className="col-span-3" label={t.analytics.yield}
        value={FMT.pct(yieldOnPort, 2)} sub={th ? "บนมูลค่าตลาด" : "on market value"} />
      <BigKpi className="col-span-3" label={t.analytics.payout}
        value={annual > 0 ? FMT.money(annual, ccy, { compact: true }) : "—"}
        sub={annual > 0
          ? FMT.money(annual / 12, ccy, { compact: true }) + " " + (th ? "ต่อเดือน" : "/mo")
          : (th ? "ยังไม่มีปันผล" : "no payers yet")}
        tone={annual > 0 ? "gain" : undefined} />
      {dataState === "live" ? (
        <BigKpi className="col-span-3"
          label={th ? "รับจริงทั้งหมด" : "Total received"}
          value={divLoading && !receivedData
            ? (th ? "กำลังโหลด…" : "Loading…")
            : (receivedData?.totalReceived > 0
              ? FMT.money(receivedData.totalReceived, ccy, { compact: true })
              : "฿0")}
          sub={receivedData?.source === 'transactions'
            ? (th ? "จากบันทึกธุรกรรมจริง (สุทธิ)" : "from transaction records (net)")
            : (th ? "ประมาณจาก Yahoo Finance" : "estimated · Yahoo Finance")}
          tone={receivedData?.totalReceived > 0 ? "gain" : undefined} />
      ) : (
        <BigKpi className="col-span-3" label={th ? "เติบโต 5 ปี" : "5y div growth"}
          value={th ? "ต้องการประวัติ" : "Needs history"} sub={th ? "ยังไม่มีข้อมูล" : "no data"} />
      )}
      <BigKpi className="col-span-3" label={th ? "หลักทรัพย์จ่ายปันผล" : "Payers"}
        value={payers.length + "/" + rows.length}
        sub={th ? "หลักทรัพย์จ่ายปันผล" : "income-producing"} />

      {/* ── Action buttons row (live mode, portfolio available) ── */}
      {dataState === "live" && portfolio && (
        <div className="col-span-12" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {transactions.some(tx => tx.type === 'Dividend') && (
            <button className="btn btn-outline btn-sm" onClick={openEditModal}>
              <Icon name="edit" size={13} />
              {th ? "แก้ไขรายการ" : "Edit recorded"}
            </button>
          )}
          <button className="btn btn-outline btn-sm" onClick={handleSync} disabled={syncModal === 'loading'}>
            <Icon name="refresh" size={13} />
            {syncModal === 'loading'
              ? (th ? "กำลังตรวจสอบ…" : "Checking…")
              : (th ? "ตรวจสอบปันผลใหม่" : "Sync dividends")}
          </button>
        </div>
      )}

      {/* ── Dividend Calendar (live mode, history loaded) ── */}
      {dataState === "live" && divHistory && (
        <DividendCalendar
          divHistory={divHistory}
          transactions={transactions}
          liveHoldings={liveHoldings}
          lang={lang}
        />
      )}

      {/* ── Historical received by year (only when real data exists) ── */}
      {hasReceivedData && (
        <div className="card col-span-6">
          <h3 className="section-title" style={{ marginBottom: 16 }}>
            {th ? "ปันผลที่ได้รับจริง รายปี" : "Dividends received by year"}
          </h3>
          <BarChart data={histBarData} height={200} color="var(--gain)"
            fmt={v => FMT.money(v, ccy, { compact: true })}
            labelFmt={v => FMT.money(v, ccy)} />
        </div>
      )}

      {/* ── Estimated monthly payouts ── */}
      <div className={"card " + (hasReceivedData ? "col-span-6" : "col-span-7")}>
        <h3 className="section-title" style={{ marginBottom: 16 }}>
          {th ? "ปันผลรายเดือน (ประมาณ 12 เดือนถัดไป)" : "Estimated monthly payouts (next 12 months)"}
        </h3>
        {annual > 0 ? (
          <BarChart data={monthlyData} height={220} color="var(--accent-ink)"
            fmt={v => FMT.money(v, ccy, { compact: true })}
            labelFmt={v => FMT.money(v, ccy)} />
        ) : (
          <div style={{ padding: "48px 0", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
            {th
              ? "ยังไม่มีหลักทรัพย์ที่จ่ายปันผล เพิ่ม div yield % ตอนเพิ่มหลักทรัพย์"
              : "No dividend-paying holdings yet. Add a div yield % when adding a holding."}
          </div>
        )}
      </div>

      {/* ── Top payers ── */}
      <div className={"card " + (hasReceivedData ? "col-span-12" : "col-span-5")}>
        <h3 className="section-title" style={{ marginBottom: 16 }}>
          {th ? "ผู้จ่ายปันผลสูงสุด" : "Top dividend payers"}
        </h3>
        {payers.length === 0 ? (
          <div style={{ padding: "20px 0", color: "var(--ink-3)", fontSize: 13 }}>
            {th ? "ยังไม่มีข้อมูลปันผล" : "No dividend data yet"}
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
            gap: 10,
          }}>
            {payers.slice(0, 6).map(p => {
              const received = receivedData?.byTicker?.[p.ticker] || 0
              return (
                <div key={p.ticker} style={{
                  display: "flex", flexDirection: "column", gap: 10,
                  padding: "14px 16px", borderRadius: 12,
                  background: "var(--bg-2)",
                }}>
                  {/* Header: logo + ticker + yield badge */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                      <TickerLogo ticker={p.ticker} logoUrl={p.logo_url} region={p.region} cls={p.cls} size={32} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{p.ticker}</div>
                        <div className="muted" style={{ fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 90 }}>
                          {p.name || ""}
                        </div>
                      </div>
                    </div>
                    <div style={{
                      flexShrink: 0,
                      background: "oklch(0.93 0.08 150)", color: "oklch(0.40 0.14 150)",
                      borderRadius: 6, padding: "3px 7px", fontSize: 11, fontWeight: 700,
                      fontFamily: "var(--font-mono)",
                    }}>
                      {FMT.pct(p.divYield, 1)}
                    </div>
                  </div>

                  {/* Value + Annual payout */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {FMT.money(p.value, ccy, { compact: true })}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: "var(--accent-ink)" }}>
                      +{FMT.money(p.annual, ccy, { compact: true })}/y
                    </span>
                  </div>

                  {/* Received YTD */}
                  {received > 0 && (
                    <div style={{ fontSize: 11, color: "var(--gain)", display: "flex", alignItems: "center", gap: 4, marginTop: -4 }}>
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><polyline points="2 6 5 9 10 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      {th ? "รับแล้ว " : "received "}{FMT.money(received, ccy, { compact: true })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── WHT / Tax Summary ── */}
      {dataState === "live" && (
        <DividendTaxSummary transactions={transactions} lang={lang} ccy={ccy} fxRate={fxRate} />
      )}

      {/* ── Sync modal ── */}
      {syncModal && createPortal(
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget && !syncSaving) setSyncModal(null) }}>
          <div style={{ background: "var(--bg)", borderRadius: 18, padding: 28, width: "100%", maxWidth: 540, maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.2)", overflow: "hidden" }}>
            {syncModal === 'loading' ? (
              <div style={{ padding: "48px 0", textAlign: "center", opacity: 0.5, fontSize: 14 }}>
                {th ? "กำลังดึงข้อมูลจาก Yahoo Finance…" : "Fetching from Yahoo Finance…"}
              </div>
            ) : syncModal.length === 0 ? (
              <>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                  {th ? "ไม่พบปันผลใหม่" : "No new dividends found"}
                </h3>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  {th ? "ทุกรายการปันผลบันทึกครบแล้ว" : "All dividend events are already recorded."}
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button className="btn btn-outline" onClick={() => setSyncModal(null)}>
                    {th ? "ปิด" : "Close"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                      {th ? `พบปันผลใหม่ ${syncModal.length} รายการ` : `${syncModal.length} unrecorded dividend${syncModal.length > 1 ? "s" : ""} found`}
                    </h3>
                    <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                      {th ? "ตรวจสอบยอดสุทธิ (TH หัก 10%, US หัก 15%) ก่อนบันทึก — แก้ไขได้" : "Verify net amounts (TH WHT 10%, US WHT 15%) — tap to edit"}
                    </p>
                  </div>
                  <button onClick={() => !syncSaving && setSyncModal(null)}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-3)", lineHeight: 1, padding: 4 }}>✕</button>
                </div>
                <div style={{ overflowY: "auto", flex: 1, minHeight: 0, margin: "0 -4px", padding: "0 4px" }}>
                  {/* Sticky column header with Select-All checkbox */}
                  {(() => {
                    const allChecked  = syncModal.every(s => s.checked)
                    const someChecked = !allChecked && syncModal.some(s => s.checked)
                    const toggleAll   = () => setSyncModal(prev => prev.map(p => ({ ...p, checked: !allChecked })))
                    return (
                      <div style={{ position: "sticky", top: 0, background: "var(--bg)", zIndex: 1, paddingBottom: 6, borderBottom: "1.5px solid var(--line)", marginBottom: 2 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "20px 36px 1fr auto 88px", gap: 10, alignItems: "center" }}>
                          {/* Select-all checkbox */}
                          <input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = someChecked }}
                            onChange={toggleAll}
                            title={th ? (allChecked ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด") : (allChecked ? "Deselect all" : "Select all")}
                            style={{ width: 16, height: 16, cursor: "pointer", accentColor: "var(--accent)" }} />
                          <div />
                          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{th ? "หลักทรัพย์" : "Holding"}</div>
                          <div style={{ textAlign: "right", fontSize: 10, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{th ? "รวม" : "Gross"}</div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{th ? "สุทธิ" : "Net"}</div>
                        </div>
                      </div>
                    )
                  })()}
                  {syncModal.map((s, i) => (
                    <SyncRow key={i} s={s} th={th} FMT={FMT} ccy={ccy}
                      onChange={upd => setSyncModal(prev => prev.map((p, j) => j === i ? { ...p, ...upd } : p))} />
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                  <button className="btn btn-outline" onClick={() => !syncSaving && setSyncModal(null)} disabled={syncSaving}>
                    {th ? "ยกเลิก" : "Cancel"}
                  </button>
                  <button className="btn" disabled={syncSaving || syncModal.every(s => !s.checked)} onClick={() => handleConfirmSync(syncModal)}>
                    {syncSaving
                      ? (th ? "กำลังบันทึก…" : "Saving…")
                      : th
                        ? `บันทึก ${syncModal.filter(s => s.checked).length} รายการ`
                        : `Save ${syncModal.filter(s => s.checked).length} item${syncModal.filter(s => s.checked).length !== 1 ? "s" : ""}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      , document.body)}

      {/* ── Edit recorded dividends modal ── */}
      {editModal !== null && createPortal(
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget && !editSaving) setEditModal(null) }}>
          <div style={{ background: "var(--bg)", borderRadius: 18, padding: 28, width: "100%", maxWidth: 620, maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                  {th ? "แก้ไขรายการปันผลที่บันทึก" : "Edit recorded dividends"}
                </h3>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                  {th ? "แก้ไขหุ้น / ยอด / วันที่ หรือกด 🗑 เพื่อลบ" : "Edit shares / amount / date, or tap 🗑 to delete"}
                </p>
              </div>
              <button onClick={() => !editSaving && setEditModal(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-3)", lineHeight: 1, padding: 4 }}>✕</button>
            </div>

            {editModal.length === 0 ? (
              <p className="muted" style={{ fontSize: 13, textAlign: "center", padding: "32px 0" }}>
                {th ? "ยังไม่มีรายการปันผลที่บันทึก" : "No dividend records yet."}
              </p>
            ) : (
              <div style={{ overflow: "auto", flex: 1, margin: "0 -4px", padding: "0 4px" }}>
                {/* Header */}
                <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 80px 90px 90px 32px", gap: 8, alignItems: "center", padding: "0 0 6px", borderBottom: "2px solid var(--line)", fontSize: 10, color: "var(--ink-4)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  <div />
                  <div>{th ? "หลักทรัพย์ / วันที่" : "Ticker / Date"}</div>
                  <div style={{ textAlign: "right" }}>{th ? "หุ้น" : "Shares"}</div>
                  <div style={{ textAlign: "right" }}>{th ? "ยอดสุทธิ" : "Net amount"}</div>
                  <div>{th ? "วันที่รับ" : "Pay date"}</div>
                  <div />
                </div>
                {editModal.map((row, i) => (
                  <div key={row.id} style={{
                    display: "grid", gridTemplateColumns: "36px 1fr 80px 90px 90px 32px", gap: 8,
                    alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--line)",
                    opacity: row.markedDelete ? 0.35 : 1, transition: "opacity 0.15s"
                  }}>
                    <TickerLogo ticker={row.ticker || '?'} logoUrl={row.logo_url} region={row.region} cls={row.cls} size={30} />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{row.ticker || '—'}</div>
                      {row.note && <div className="muted" style={{ fontSize: 10 }}>{row.note}</div>}
                    </div>
                    <CalcInput
                      value={row.editedShares} disabled={row.markedDelete}
                      onChange={e => setEditModal(prev => prev.map((r, j) => j === i ? { ...r, editedShares: e.target.value } : r))}
                      style={{ padding: "4px 6px", fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "right", border: "1px solid var(--line)", borderRadius: 6, background: "var(--bg-2)", color: "var(--ink)", width: "100%" }}
                    />
                    <CalcInput
                      value={row.editedAmount} disabled={row.markedDelete}
                      onChange={e => setEditModal(prev => prev.map((r, j) => j === i ? { ...r, editedAmount: e.target.value } : r))}
                      style={{ padding: "4px 6px", fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "right", border: "1px solid var(--line)", borderRadius: 6, background: "var(--bg-2)", color: "var(--ink)", width: "100%" }}
                    />
                    <input
                      type="date" value={row.editedDate} disabled={row.markedDelete}
                      onChange={e => setEditModal(prev => prev.map((r, j) => j === i ? { ...r, editedDate: e.target.value } : r))}
                      style={{ padding: "4px 6px", fontSize: 11, border: "1px solid var(--line)", borderRadius: 6, background: "var(--bg-2)", color: "var(--ink)", width: "100%" }}
                    />
                    <button
                      onClick={() => setEditModal(prev => prev.map((r, j) => j === i ? { ...r, markedDelete: !r.markedDelete } : r))}
                      title={row.markedDelete ? (th ? "ยกเลิกลบ" : "Undo") : (th ? "ลบรายการ" : "Delete")}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: row.markedDelete ? "var(--gain)" : "var(--loss)", padding: 4, lineHeight: 1 }}>
                      {row.markedDelete ? "↩" : "🗑"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 12, borderTop: "1px solid var(--line)" }}>
              <button className="btn btn-outline" onClick={() => !editSaving && setEditModal(null)} disabled={editSaving}>
                {th ? "ยกเลิก" : "Cancel"}
              </button>
              <button className="btn" disabled={editSaving || editModal.length === 0} onClick={handleSaveEdits}>
                {editSaving ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "บันทึกการแก้ไข" : "Save changes")}
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  )
}

/* ─── Sync row (inside sync modal) ───────────────────────────────────────────── */
function SyncRow({ s, th, FMT, ccy, onChange }) {
  const tax = +(s.gross * s.taxRate).toFixed(2)
  const sym = s.currency === 'USD' ? '$' : '฿'
  const dateChanged = s.date !== s.xdDate
  return (
    <div style={{ display: "grid", gridTemplateColumns: "20px 36px 1fr auto 88px", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
      <input type="checkbox" checked={s.checked} onChange={e => onChange({ checked: e.target.checked })}
        style={{ width: 16, height: 16, cursor: "pointer", accentColor: "var(--accent)" }} />
      <TickerLogo ticker={s.ticker} logoUrl={s.logo_url} region={s.region} cls={s.cls} size={30} />
      <div>
        <div style={{ fontWeight: 500, fontSize: 13, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span>{s.ticker}</span>
          {/* Editable date — shows XD badge when unchanged, pay-date when edited */}
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input type="date" value={s.date} onChange={e => onChange({ date: e.target.value })}
              style={{ fontSize: 11, padding: "1px 4px", borderRadius: 5, border: "1px solid var(--line)", background: "var(--bg-2)", color: "var(--ink)", fontFamily: "var(--font-mono)", cursor: "pointer", width: 110 }} />
            {!dateChanged && (
              <span style={{ fontSize: 9, background: "oklch(0.90 0.06 60)", color: "oklch(0.45 0.10 60)", padding: "1px 5px", borderRadius: 3, fontWeight: 600, letterSpacing: "0.04em" }}>XD</span>
            )}
            {dateChanged && (
              <span style={{ fontSize: 9, background: "var(--gain-soft)", color: "var(--gain)", padding: "1px 5px", borderRadius: 3, fontWeight: 600 }}>✓</span>
            )}
          </span>
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          {s.shares} {th ? "หุ้น" : "shares"} × {sym}{s.pricePerShare}
          {s.taxRate > 0 && (
            <span style={{ color: "var(--loss)", marginLeft: 6 }}>
              WHT {(s.taxRate * 100).toFixed(0)}% = −{sym}{tax}
            </span>
          )}
        </div>
      </div>
      {/* Gross — label removed (now in sticky column header above the list) */}
      <div style={{ textAlign: "right", fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--ink-2)" }}>
        {sym}{s.gross}
      </div>
      {/* Net editable — label removed */}
      <CalcInput value={s.editedNet}
        onChange={e => onChange({ editedNet: parseFloat(e.target.value) || 0 })}
        style={{ width: "100%", padding: "4px 6px", fontSize: 13, fontFamily: "var(--font-mono)", textAlign: "right", border: "1px solid var(--line)", borderRadius: 6, background: "var(--bg-2)", color: "var(--ink)" }} />
    </div>
  )
}

// Benchmark definitions — outside component so the reference is stable (no stale closure)
const BENCHMARKS = {
  none:   { labelTh: "ไม่เปรียบเทียบ", labelEn: "None",        symbol: null,          color: null },
  sp500:  { labelTh: "S&P 500",         labelEn: "S&P 500",     symbol: "^GSPC",       color: "var(--accent)" },
  set50:  { labelTh: "SET 50 (TDEX)",     labelEn: "SET 50 (TDEX)", symbol: "TDEX.BK",   color: "var(--c7)" },
  set:    { labelTh: "SET Index",        labelEn: "SET Index",   symbol: "^SET.BK",     color: "var(--c3)" },
  nasdaq: { labelTh: "Nasdaq 100",       labelEn: "Nasdaq 100",  symbol: "^NDX",        color: "var(--c2)" },
}

/* ─── Growth tab ─────────────────────────────────────────────────────────────── */
function AnalyticsGrowth({ t, lang, ccy, rows = [], fxRate = 36, totalValue, totalCost, totalPL, totalPlPct, dataState, earliestHoldingDate, portfolio, snapsVersion = 0 }) {
  const FMT = LUMEN_FMT
  const th = lang === "th"
  const isLive = dataState === "live"

  // ── Real daily NAV history — load snapshots; if none, auto-reconstruct them
  // once from historical prices + the transaction ledger, then render the real
  // path. Falls back to the estimated curve while building / if unavailable.
  const [snaps, setSnaps] = useState([])
  const [building, setBuilding] = useState(false)

  useEffect(() => {
    if (!isLive || !portfolio?.id) { setSnaps([]); return }
    let cancelled = false
    ;(async () => {
      let d = await getSnapshots(portfolio.id).catch(() => [])
      if (cancelled) return
      if (d.length >= 2) { setSnaps(d); return }
      // No stored history yet — build it from Yahoo price history once.
      setBuilding(true)
      try {
        const txs = await getAllTransactions(portfolio.id)
        if (txs.length) {
          // Sort oldest-first so txs[0] is reliably the first purchase
          const sorted = [...txs].sort((a, b) => new Date(a.transacted_at) - new Date(b.transacted_at))
          const ccyByTicker = {}
          // Build asset-class lookup from live holdings so GoldTH/Crypto get correct Yahoo symbols
          const clsByTicker = {}
          for (const r of rows) clsByTicker[(r.ticker || "").toUpperCase()] = r.cls || "Equity"
          for (const tx of sorted) {
            const tk = (tx.ticker || "").toUpperCase()
            if (tk && !ccyByTicker[tk]) ccyByTicker[tk] = tx.currency || "THB"
          }
          // priceCcyByTicker: currency Yahoo Finance quotes prices in.
          // GoldTH (GC=F) and Crypto (BTC-USD) are always USD on Yahoo.
          const priceCcyByTicker = { ...ccyByTicker }
          for (const r of rows) {
            const tk = (r.ticker || "").toUpperCase()
            if (!tk) continue
            clsByTicker[tk] = r.cls || "Equity"
            const pc = (r.cls === "GoldTH" || r.cls === "Crypto" || r.region === "US") ? "USD" : "THB"
            if (pc !== priceCcyByTicker[tk])
              console.log(`[Lumen] growth rebuild: ${tk} cls=${r.cls} region=${r.region} → price_ccy overridden to ${pc}`)
            priceCcyByTicker[tk] = pc
          }
          const tickers = Object.keys(ccyByTicker)
          const spanDays = (Date.now() - new Date(sorted[0].transacted_at)) / 86400000
          const range = spanDays > 365 * 2 ? "5y" : spanDays > 365 ? "2y" : spanDays > 180 ? "1y"
                      : spanDays > 90 ? "6mo" : spanDays > 30 ? "3mo" : "1mo"
          const seriesByTicker = {}
          await Promise.all(tickers.map(async tk => {
            const region = priceCcyByTicker[tk] === "USD" ? "US" : "TH"
            const sym = toYahooSymbol(tk, region, clsByTicker[tk] || "Equity")
            const h = await fetchHistory(sym, range).catch(() => ({ series: [] }))
            seriesByTicker[tk] = (h?.series || []).map(p => ({ d: new Date(p.t * 1000).toISOString().split("T")[0], c: p.c }))
          }))
          // Fetch historical USDTHB rates so each date uses its own FX rate (not today's)
          const fxByDate = {}
          if (Object.values(priceCcyByTicker).some(c => c === "USD")) {
            const fxH = await fetchHistory("USDTHB=X", range).catch(() => ({ series: [] }))
            for (const p of (fxH?.series || []))
              fxByDate[new Date(p.t * 1000).toISOString().split("T")[0]] = p.c
          }
          const series = buildSnapshotSeries(txs, seriesByTicker, ccyByTicker, fxRate, fxByDate, priceCcyByTicker, clsByTicker)
          if (series.length) {
            await upsertSnapshots(portfolio.id, series)
            d = await getSnapshots(portfolio.id).catch(() => d)
          }
        }
      } catch { /* keep estimated path on failure */ }
      if (!cancelled) { setSnaps(d || []); setBuilding(false) }
    })()
    return () => { cancelled = true }
  }, [isLive, portfolio?.id, fxRate, snapsVersion])

  // ── How many calendar days since first purchase ────────────────────────────
  const daysSinceFirst = useMemo(() => {
    if (dataState !== "live" || !earliestHoldingDate) return 365 * 5
    return Math.max(1, Math.round((Date.now() - earliestHoldingDate.getTime()) / 86400000))
  }, [dataState, earliestHoldingDate])

  const holdingYears = daysSinceFirst / 365   // e.g. 2.7

  // ── Period picker for chart ────────────────────────────────────────────────
  const [chartPeriod, setChartPeriod] = useState("1Y")

  // ── Benchmark comparison ───────────────────────────────────────────────────
  const [benchKey, setBenchKey] = useState("none")
  const [benchHistory, setBenchHistory] = useState({})  // { symbol: [{t, c}] }

  useEffect(() => {
    const sym = BENCHMARKS[benchKey]?.symbol
    if (!sym || benchHistory[sym]) return   // already cached
    let cancelled = false
    fetchHistory(sym, "5y")
      .then(d => { if (!cancelled) setBenchHistory(prev => ({ ...prev, [sym]: d.series || [] })) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [benchKey])
  const growthPeriodDaysMap = { "1Y": 365, "3Y": 365 * 3, "5Y": 365 * 5 }
  const isGrowthEnabled = k => dataState !== "live" || growthPeriodDaysMap[k] <= daysSinceFirst + 14

  // ── Demo series ────────────────────────────────────────────────────────────
  const monthLabels = ["Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May"]
  const port = LUMEN_HISTORY, bench = LUMEN_BENCH
  const v0 = port[0].v, b0 = bench[0].v
  const demoSeries = [
    { name: th ? "พอร์ตตัวอย่าง" : "Demo portfolio", color: "var(--ink)", fill: true,
      data: port.map((p, i) => ({ x: i, y: (p.v / v0 - 1) * 100, label: monthLabels[i % 12] + " '" + (24 + Math.floor(i / 12)) })) },
    { name: "S&P 500", color: "var(--accent)", dashed: true,
      data: bench.map((p, i) => ({ x: i, y: (p.v / b0 - 1) * 100, label: monthLabels[i % 12] + " '" + (24 + Math.floor(i / 12)) })) },
  ]

  // ── Live: estimated cumulative-return path (start=0%, end=totalPlPct) ──────
  // We don't store daily NAV, so we simulate a plausible growth path that
  // anchors to the real start date and the real current return.
  const liveSeries = useMemo(() => {
    if (dataState !== "live" || totalCost <= 0 || totalValue <= 0) return null
    const now = new Date()
    const requestedDays = growthPeriodDaysMap[chartPeriod] || 365
    const totalDays = Math.max(7, Math.min(requestedDays, daysSinceFirst))
    const pts = Math.max(8, Math.min(60, Math.round(totalDays / 7)))
    const stepD = totalDays / (pts - 1)
    const finalPct = totalPlPct
    const noiseScale = Math.max(Math.abs(finalPct) * 0.12, 1.0)
    const ease = p => p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p
    const noise = (i, s) => (
      Math.sin(i * 0.61 + s) * 0.55 + Math.sin(i * 1.43 + s * 1.7) * 0.30 +
      Math.sin(i * 2.91 + s * 2.3) * 0.18 + Math.cos(i * 4.27 + s * 3.1) * 0.10
    )
    const locale = th ? "th-TH" : "en-US"
    const mkLabel = d => {
      if (totalDays < 60)  return d.toLocaleString(locale, { month: "short", day: "numeric" })
      if (totalDays < 730) return d.toLocaleString(locale, { month: "short" }) + " '" + String(d.getFullYear()).slice(2)
      return "'" + String(d.getFullYear()).slice(2)
    }
    return [{
      name: th ? "พอร์ตของคุณ" : "Your portfolio",
      color: "var(--ink)", fill: true,
      data: Array.from({ length: pts }, (_, i) => {
        const p = i / (pts - 1)
        const fade = Math.sin(Math.PI * p)
        const y = finalPct * ease(p) + noise(i, 1.7) * noiseScale * fade
        const d = new Date(now); d.setDate(d.getDate() - (pts - 1 - i) * stepD)
        return { x: i, y, label: mkLabel(d) }
      })
    }]
  }, [dataState, totalCost, totalValue, totalPlPct, th, chartPeriod, daysSinceFirst])

  // ── Real cumulative-return path from stored daily snapshots ────────────────
  // Each day's return = total_value / total_cost − 1 (handles contributions),
  // windowed to the selected period.
  const realSeries = useMemo(() => {
    if (!isLive || snaps.length < 2) return null
    const days = growthPeriodDaysMap[chartPeriod] || 365
    const fromTs = Date.now() - days * 86400000
    let w = snaps.filter(s => new Date(s.date).getTime() >= fromTs)
    if (w.length < 2) w = snaps
    // Drop data-artifact snapshots: day-over-day jump >50%, or isolated spike
    const wr2 = w.map(s => Number(s.total_cost) > 0 ? Number(s.total_value) / Number(s.total_cost) : null)
    w = w.filter((s, i) => {
      const ci = wr2[i]
      if (ci == null) return true
      if (i > 0) {
        const pi = wr2[i - 1]
        if (pi != null && pi > 0 && Math.abs(ci / pi - 1) > 0.50) return false
      }
      if (i > 0 && i < w.length - 1) {
        const pi = wr2[i - 1], ni = wr2[i + 1]
        if (pi != null && ni != null && pi > 0 && ni > 0 && ci > pi * 1.15 && ci > ni * 1.15) return false
      }
      return true
    })
    if (w.length < 2) return null
    const locale = th ? "th-TH" : "en-US"
    const span = (new Date(w[w.length - 1].date) - new Date(w[0].date)) / 86400000
    const mkLabel = dt => span < 60 ? dt.toLocaleString(locale, { month: "short", day: "numeric" })
      : span < 730 ? dt.toLocaleString(locale, { month: "short" }) + " '" + String(dt.getFullYear()).slice(2)
      : "'" + String(dt.getFullYear()).slice(2)
    return [{
      name: th ? "พอร์ตของคุณ" : "Your portfolio",
      color: "var(--ink)", fill: true,
      data: w.map((s, i) => {
        const c = Number(s.total_cost), v = Number(s.total_value)
        return { x: i, y: c > 0 ? (v / c - 1) * 100 : 0, label: mkLabel(new Date(s.date)) }
      }),
    }]
  }, [isLive, snaps, chartPeriod, th])

  // Prefer real history; fall back to the estimated curve until snapshots exist.
  const portSeries = realSeries || liveSeries
  const usingReal = !!realSeries

  // ── Benchmark overlay: rebase to 0% at the same start date as the portfolio
  const benchSeries = useMemo(() => {
    const sym = BENCHMARKS[benchKey]?.symbol
    const raw = sym ? (benchHistory[sym] || []) : []
    if (!raw.length || !portSeries?.[0]?.data?.length) return null

    const days = growthPeriodDaysMap[chartPeriod] || 365
    const fromTs = (Date.now() - days * 86400000) / 1000
    // Strip null/zero prices — Yahoo Finance sometimes returns null on holidays
    const window = raw.filter(p => p.t >= fromTs && p.c != null && p.c > 0)
    if (window.length < 2) return null

    const base = window[0].c
    if (!base || !Number.isFinite(base)) return null
    const locale = th ? "th-TH" : "en-US"
    const span = (window[window.length - 1].t - window[0].t) / 86400
    const mkLabel = ts => {
      const d = new Date(ts * 1000)
      if (span < 60)  return d.toLocaleString(locale, { month: "short", day: "numeric" })
      if (span < 730) return d.toLocaleString(locale, { month: "short" }) + " '" + String(d.getFullYear()).slice(2)
      return "'" + String(d.getFullYear()).slice(2)
    }

    // Downsample to match portfolio series length
    const targetPts = portSeries[0].data.length
    const stride = Math.max(1, Math.floor(window.length / targetPts))
    let sampled = window.filter((_, i) => i % stride === 0)
    if (sampled[sampled.length - 1] !== window[window.length - 1])
      sampled = [...sampled, window[window.length - 1]]

    const data = sampled
      .map((p, i) => ({ x: i, y: (p.c / base - 1) * 100, label: mkLabel(p.t) }))
      .filter(d => Number.isFinite(d.y))   // drop any surviving NaN/Infinity points
    if (data.length < 2) return null

    return {
      name: th ? BENCHMARKS[benchKey].labelTh : BENCHMARKS[benchKey].labelEn,
      color: BENCHMARKS[benchKey].color,
      dashed: true,
      data,
    }
  }, [benchKey, benchHistory, portSeries, chartPeriod, th])

  // Merge portfolio + benchmark into one series array for the chart
  const chartSeries = useMemo(() => {
    if (!portSeries) return null
    return benchSeries ? [portSeries[0], benchSeries] : portSeries
  }, [portSeries, benchSeries])

  // ── CAGR using actual holding period ─────────────────────────────────────
  // Formula: (market_value / cost_basis) ^ (1 / years) - 1
  const cagr = dataState === "live" && totalCost > 0 && totalValue > 0 && holdingYears >= 0.08
    ? (Math.pow(totalValue / totalCost, 1 / holdingYears) - 1) * 100
    : null

  // ── Max drawdown from the active curve (real snapshots when available) ─────
  const drawdown = useMemo(() => {
    if (!chartSeries?.[0]?.data?.length) return null
    let peak = -Infinity, maxDd = 0
    chartSeries[0].data.forEach(p => {
      if (p.y > peak) peak = p.y
      const dd = p.y - peak
      if (dd < maxDd) maxDd = dd
    })
    return maxDd
  }, [chartSeries])

  // ── Per-ticker performance (aggregated from multi-lot rows) ───────────────
  // cost (THB) = value - pl  (both are already in THB from deriveHoldings)
  const holdingPerf = useMemo(() => {
    if (!rows.length) return []
    const map = {}
    rows.forEach(r => {
      if (!map[r.ticker]) map[r.ticker] = { ticker: r.ticker, name: r.name, region: r.region, cls: r.cls, logo_url: r.logo_url, value: 0, pl: 0 }
      map[r.ticker].value += r.value
      map[r.ticker].pl   += r.pl
    })
    return Object.values(map)
      .map(h => {
        const cost = h.value - h.pl
        return { ...h, cost, plPct: cost > 0 ? (h.pl / cost) * 100 : 0 }
      })
      .sort((a, b) => b.plPct - a.plPct)
  }, [rows])

  // ── Demo annual-returns table ─────────────────────────────────────────────
  const yrs = [
    { label: "2023", port: 12.4, bench: 24.2 },
    { label: "2024", port: 18.9, bench: 23.3 },
    { label: "2025", port: 22.1, bench: 14.0 },
    { label: "2026 YTD", port: 8.4, bench: 5.1 },
  ]

  // ── Helpers ───────────────────────────────────────────────────────────────
  const sign = v => v >= 0 ? "+" : ""
  const periodLabel = holdingYears >= 1
    ? holdingYears.toFixed(1) + (th ? " ปี" : " yr" + (holdingYears.toFixed(1) !== "1.0" ? "s" : ""))
    : Math.round(daysSinceFirst / 30.5) + (th ? " เดือน" : " mo")

  return (
    <div className="fade-in">

      {/* ── KPI row ── */}
      <div className="grid grid-12" style={{ marginBottom: 16 }}>
        {dataState === "live" ? (
          <>
            {/* Total Return: (current_value − cost) / cost */}
            <BigKpi className="col-span-3"
              label={th ? "ผลตอบแทนรวม" : "Total return"}
              value={sign(totalPlPct) + totalPlPct.toFixed(1) + "%"}
              sub={th
                ? `(มูลค่า − ต้นทุน) ÷ ต้นทุน`
                : `(value − cost) ÷ cost`}
              tone={totalPlPct >= 0 ? "gain" : "loss"} />

            {/* CAGR: (value/cost)^(1/yrs) − 1 */}
            <BigKpi className="col-span-3"
              label={`CAGR · ${periodLabel}`}
              value={cagr != null ? sign(cagr) + cagr.toFixed(1) + "%/yr" : "—"}
              sub={th
                ? `(มูลค่า÷ต้นทุน)^(1/${holdingYears.toFixed(2)}) − 1`
                : `(value÷cost)^(1/${holdingYears.toFixed(2)}) − 1`}
              tone={cagr != null ? (cagr >= 0 ? "gain" : "loss") : undefined} />

            {/* Absolute P&L: market_value − cost_basis */}
            <BigKpi className="col-span-3"
              label={th ? "กำไร/ขาดทุน (unrealized)" : "Unrealized P&L"}
              value={sign(totalPL) + FMT.money(totalPL, ccy, { compact: true })}
              sub={th
                ? `${FMT.money(totalValue, ccy, { compact: true })} − ${FMT.money(totalCost, ccy, { compact: true })}`
                : `mkt value − cost basis`}
              tone={totalPL >= 0 ? "gain" : "loss"} />

            {/* Max drawdown — real when snapshots exist, else estimated */}
            <BigKpi className="col-span-3"
              label={usingReal ? "Max Drawdown" : (th ? "Max Drawdown (ประมาณ)" : "Max Drawdown (est.)")}
              value={drawdown != null ? drawdown.toFixed(1) + "%" : "—"}
              sub={usingReal
                ? (th ? "ลดลงสูงสุดจากจุดสูงสุด (ข้อมูลจริง)" : "peak-to-trough · real daily NAV")
                : (th ? "ลดลงสูงสุดจากจุดสูงสุด (เส้นโค้งประมาณ)" : "peak-to-trough on estimated path")}
              tone={drawdown != null && drawdown < -5 ? "loss" : undefined} />
          </>
        ) : (
          <>
            <BigKpi className="col-span-3" label={th ? "ผลตอบแทนรวม" : "Total return"} value="+58.7%" sub={th ? "ตั้งแต่เริ่มพอร์ต" : "since inception"} tone="gain" />
            <BigKpi className="col-span-3" label="CAGR · 3 yrs" value="+16.6%/yr" sub={th ? "(มูลค่า÷ต้นทุน)^(1/3) − 1" : "(value÷cost)^(1/3) − 1"} tone="gain" />
            <BigKpi className="col-span-3" label={t.analytics.vsBench} value="+4.2pp" sub={th ? "ดีกว่า S&P 500 · ข้อมูลตัวอย่าง" : "vs S&P 500 · demo data"} tone="gain" />
            <BigKpi className="col-span-3" label={t.analytics.drawdown} value="-9.8%" sub={th ? "ก.ค. 2024 · peak-to-trough" : "Jul 2024 · peak-to-trough"} tone="loss" />
          </>
        )}
      </div>

      {/* ── Growth chart ── */}
      {dataState === "live" ? (
        chartSeries ? (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
              <div>
                <h3 className="section-title">
                  {th ? "เส้นทางผลตอบแทนสะสม" : "Cumulative return path"}
                </h3>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {usingReal
                    ? (th
                        ? "ผลตอบแทนสะสมรายวันจากราคาจริง (มูลค่า ÷ ต้นทุน − 1)"
                        : "Real daily cumulative return from market prices (value ÷ cost − 1)")
                    : building
                      ? (th ? "กำลังสร้างประวัติรายวันจากราคาย้อนหลัง…" : "Building daily history from price data…")
                      : (th
                          ? "จุดเริ่ม = 0% (ต้นทุน) · จุดสิ้นสุด = มูลค่าปัจจุบัน · เส้นทางประมาณการ (ยังไม่มีประวัติราคารายวัน)"
                          : "Start = 0% (cost) · End = current return · Estimated path — no daily NAV history yet")}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                {/* Benchmark picker */}
                <select value={benchKey} onChange={e => setBenchKey(e.target.value)}
                  style={{ padding: "5px 24px 5px 10px", borderRadius: 8, fontSize: 12, border: "1.5px solid var(--line)", background: "var(--bg)", color: "var(--ink)", outline: "none", fontFamily: "var(--font-mono)", cursor: "pointer" }}>
                  {Object.entries(BENCHMARKS).map(([k, b]) => (
                    <option key={k} value={k}>{k === "none" ? (th ? "เทียบกับ…" : "Compare to…") : (th ? b.labelTh : b.labelEn)}</option>
                  ))}
                </select>
                {/* Period picker */}
                <div className="segmented">
                  {["1Y","3Y","5Y"].map(k => {
                    const enabled = isGrowthEnabled(k)
                    return (
                      <button key={k} className={chartPeriod === k ? "on" : ""}
                        disabled={!enabled}
                        title={!enabled ? (th ? "ข้อมูลย้อนหลังไม่พอ" : "Not enough history yet") : undefined}
                        style={{ opacity: enabled ? 1 : 0.35, cursor: enabled ? "pointer" : "not-allowed" }}
                        onClick={() => enabled && setChartPeriod(k)}>{k}</button>
                    )
                  })}
                </div>
              </div>
            </div>
            <LineChart series={chartSeries} height={300} fmt={v => (v >= 0 ? "+" : "") + v.toFixed(1) + "%"} />
          </div>
        ) : (
          <div className="card" style={{ marginBottom: 16, padding: "36px 48px", display: "flex", alignItems: "center", gap: 24 }}>
            <svg width="48" height="48" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
              <rect x="4" y="8" width="40" height="32" rx="4" fill="none" stroke="var(--line-2)" strokeWidth="1.5" strokeDasharray="4 4" />
              <path d="M8 28 L18 18 L26 22 L36 12 L44 16" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{th ? "ยังไม่มีข้อมูลพอร์ต" : "No portfolio data yet"}</div>
              <div className="muted" style={{ fontSize: 13 }}>{th ? "เพิ่มหลักทรัพย์เพื่อดูกราฟ" : "Add holdings to see the chart"}</div>
            </div>
          </div>
        )
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
              <div>
                <h3 className="section-title">{th ? "ผลตอบแทนสะสม (เริ่มที่ 0%)" : "Cumulative return (rebased to 0%)"}</h3>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {th ? "ข้อมูลตัวอย่าง · เส้นทึบ = พอร์ต, เส้นประ = S&P 500" : "Demo data · solid = portfolio, dashed = S&P 500"}
                </div>
              </div>
              <div className="segmented">
                {["3m","6m","ytd","1y","3y","all"].map(k => (
                  <button key={k} className={k === "all" ? "on" : ""}>{t.analytics.timeRange[k] || k.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <LineChart series={demoSeries} height={300} fmt={v => v.toFixed(0) + "%"} />
          </div>
          <div className="card">
            <h3 className="section-title" style={{ marginBottom: 16 }}>{th ? "ผลตอบแทนรายปี (ข้อมูลตัวอย่าง)" : "Annual returns (demo data)"}</h3>
            <div className="grid grid-4" style={{ gap: 14 }}>
              {yrs.map(y => (
                <div key={y.label} style={{ padding: 16, border: "1px solid var(--line)", borderRadius: 12 }}>
                  <div className="label-up" style={{ marginBottom: 8 }}>{y.label}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 }}>
                    <div className="display" style={{ fontSize: 24, color: y.port >= 0 ? "var(--gain)" : "var(--loss)" }}>{sign(y.port)}{y.port}%</div>
                    <div className="mono muted" style={{ fontSize: 12 }}>S&P {sign(y.bench)}{y.bench}%</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <div style={{ fontSize: 10, color: "var(--ink-4)" }}>{th ? "พอร์ต" : "Port"}</div>
                    <div className="bar" style={{ flex: 1, height: 4 }}><span style={{ width: Math.min(100, Math.abs(y.port) / 30 * 100) + "%", background: y.port >= 0 ? "var(--gain)" : "var(--loss)" }} /></div>
                    <div style={{ fontSize: 10, color: "var(--ink-4)" }}>S&P</div>
                    <div className="bar" style={{ flex: 1, height: 4 }}><span style={{ width: Math.min(100, Math.abs(y.bench) / 30 * 100) + "%", background: "var(--accent)" }} /></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Per-holding performance table (live only) ── */}
      {dataState === "live" && holdingPerf.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 className="section-title" style={{ marginBottom: 4 }}>
            {th ? "ผลตอบแทนแต่ละหลักทรัพย์" : "Per-holding breakdown"}
          </h3>
          <p className="muted" style={{ fontSize: 11, margin: "0 0 14px" }}>
            {th
              ? "ต้นทุน = ราคาซื้อ × จำนวนหุ้น (THB) · กำไร/ขาดทุน = มูลค่าตลาด − ต้นทุน (unrealized)"
              : "Cost = avg buy price × shares (THB) · P&L = market value − cost · unrealized"}
          </p>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 110px 110px 110px 70px", gap: 8, alignItems: "center", padding: "0 0 8px", borderBottom: "2px solid var(--line)", fontSize: 10, color: "var(--ink-4)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            <div />
            <div>{th ? "หลักทรัพย์" : "Ticker"}</div>
            <div style={{ textAlign: "right" }}>{th ? "ต้นทุน" : "Cost"}</div>
            <div style={{ textAlign: "right" }}>{th ? "มูลค่าปัจจุบัน" : "Mkt value"}</div>
            <div style={{ textAlign: "right" }}>P&L</div>
            <div style={{ textAlign: "right" }}>Return</div>
          </div>
          {holdingPerf.map(h => (
            <div key={h.ticker} style={{ display: "grid", gridTemplateColumns: "36px 1fr 110px 110px 110px 70px", gap: 8, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
              <TickerLogo ticker={h.ticker} logoUrl={h.logo_url} region={h.region} cls={h.cls} size={32} />
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{h.ticker}</div>
                <div className="muted" style={{ fontSize: 11 }}>{h.name}</div>
              </div>
              <div className="mono" style={{ fontSize: 12, textAlign: "right", color: "var(--ink-3)" }}>
                {FMT.money(h.cost, ccy, { compact: true })}
              </div>
              <div className="mono" style={{ fontSize: 12, textAlign: "right" }}>
                {FMT.money(h.value, ccy, { compact: true })}
              </div>
              <div className="mono" style={{ fontSize: 12, textAlign: "right", color: h.pl >= 0 ? "var(--gain)" : "var(--loss)" }}>
                {sign(h.pl)}{FMT.money(h.pl, ccy, { compact: true })}
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: h.plPct >= 0 ? "var(--gain)" : "var(--loss)" }}>
                  {sign(h.plPct)}{h.plPct.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
          {/* Total row */}
          <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 110px 110px 110px 70px", gap: 8, alignItems: "center", padding: "10px 0 0", fontSize: 12, fontWeight: 600 }}>
            <div />
            <div style={{ color: "var(--ink-3)" }}>{th ? "รวมพอร์ต" : "Portfolio total"}</div>
            <div className="mono" style={{ textAlign: "right", color: "var(--ink-3)" }}>{FMT.money(totalCost, ccy, { compact: true })}</div>
            <div className="mono" style={{ textAlign: "right" }}>{FMT.money(totalValue, ccy, { compact: true })}</div>
            <div className="mono" style={{ textAlign: "right", color: totalPL >= 0 ? "var(--gain)" : "var(--loss)" }}>
              {sign(totalPL)}{FMT.money(totalPL, ccy, { compact: true })}
            </div>
            <div style={{ textAlign: "right", color: totalPlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>
              {sign(totalPlPct)}{totalPlPct.toFixed(1)}%
            </div>
          </div>
        </div>
      )}

      {/* ── Methodology note (live only) ── */}
      {dataState === "live" && (
        <div className="card" style={{ marginTop: 16, padding: "16px 20px", background: "var(--bg-2)" }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>
            {th ? "📐 วิธีคำนวณ" : "📐 How it's calculated"}
          </div>
          <div style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--ink-3)", lineHeight: 1.6 }}>
            <div><span style={{ fontWeight: 500, color: "var(--ink-2)" }}>{th ? "ผลตอบแทนรวม" : "Total Return"}</span>{" — "}{th ? "(มูลค่าตลาดทุกหลักทรัพย์ − ต้นทุนรวม) ÷ ต้นทุนรวม · ยังไม่รวมปันผลที่ได้รับ (unrealized)" : "(sum of market values − total cost) ÷ total cost · excludes dividends received · unrealized gain only"}</div>
            <div><span style={{ fontWeight: 500, color: "var(--ink-2)" }}>CAGR</span>{" — "}{th ? "(มูลค่า ÷ ต้นทุน)^(1 ÷ จำนวนปีที่ถือ) − 1 · จำนวนปีนับจากวันที่ Buy แรกในบันทึก" : "(value ÷ cost)^(1 ÷ years held) − 1 · years counted from earliest recorded Buy transaction"}</div>
            <div><span style={{ fontWeight: 500, color: "var(--ink-2)" }}>{th ? "กราฟเส้นทาง" : "Return path chart"}</span>{" — "}{th ? "ประมาณการเส้นทางจากจุดเริ่ม (ต้นทุน = 0%) ถึงปัจจุบัน — ยังไม่มีประวัติ NAV รายวัน เส้นโค้งไม่ใช่ข้อมูลจริง" : "Estimated trajectory from start (cost = 0%) to current return — no daily NAV history stored yet, path is illustrative"}</div>
            <div><span style={{ fontWeight: 500, color: "var(--ink-2)" }}>Max Drawdown</span>{" — "}{th ? "ลดลงมากที่สุดจากจุดสูงสุด วัดจากเส้นโค้งประมาณ (ไม่ใช่ข้อมูลจริง)" : "Largest peak-to-trough drop on the estimated curve — not from real price history"}</div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Metrics tab — live-aware ──────────────────────────────────────────────── */
function AnalyticsMetrics({ t, lang, ccy, rows = [], totalValue = 0, totalPL = 0, totalPlPct = 0, dataState, portfolio, fxRate = 36, onSnapsRebuild }) {
  const th = lang === "th"
  const isLive = dataState === "live"
  const [openKey, setOpenKey] = useState(null)   // which metric's formula is expanded
  const [snaps, setSnaps] = useState([])
  const [backfilling, setBackfilling] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState(null)
  const [showInspect, setShowInspect] = useState(false)

  // Load the daily value series (recorded by App once per day)
  useEffect(() => {
    if (!isLive || !portfolio?.id) { setSnaps([]); return }
    let cancelled = false
    getSnapshots(portfolio.id).then(d => { if (!cancelled) setSnaps(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [isLive, portfolio?.id])

  // Backfill: reconstruct the daily value series from transactions + historical
  // prices, so TWR / Sharpe / Beta work immediately without waiting days.
  const handleBackfill = useCallback(async () => {
    if (!portfolio?.id) return
    setBackfilling(true); setBackfillMsg(null)
    try {
      const txs = await getAllTransactions(portfolio.id)
      if (!txs.length) { setBackfillMsg(th ? "ไม่พบธุรกรรมให้สร้างประวัติ" : "No transactions to rebuild from"); return }

      // Diagnostics — surface the earliest transaction(s) so an old/mis-dated
      // entry that stretches the history is easy to spot.
      const earliest = txs[0]?.transacted_at?.split('T')[0]
      console.log(`[backfill] ${txs.length} transactions · earliest ${earliest}`)
      console.table(txs.slice(0, 6).map(t => ({ date: t.transacted_at?.split('T')[0], type: t.type, ticker: t.ticker, shares: t.shares, price: t.price })))

      const ccyByTicker = {}
      for (const tx of txs) {
        const tk = (tx.ticker || "").toUpperCase()
        if (tk && !ccyByTicker[tk]) ccyByTicker[tk] = tx.currency || "THB"
      }
      // priceCcyByTicker: currency Yahoo Finance quotes prices in.
      // GoldTH (GC=F) and Crypto (BTC-USD) are always USD on Yahoo.
      const clsByTicker = {}
      const priceCcyByTicker = { ...ccyByTicker }
      for (const r of rows) {
        const tk = (r.ticker || "").toUpperCase()
        if (!tk) continue
        clsByTicker[tk] = r.cls || "Equity"
        const pc = (r.cls === "GoldTH" || r.cls === "Crypto" || r.region === "US") ? "USD" : "THB"
        if (pc !== priceCcyByTicker[tk])
          console.log(`[Lumen] backfill: ${tk} cls=${r.cls} region=${r.region} → price_ccy overridden to ${pc}`)
        priceCcyByTicker[tk] = pc
      }
      const tickers = Object.keys(ccyByTicker)
      const spanDays = (Date.now() - new Date(txs[0].transacted_at)) / 86400000
      const range = spanDays > 365 * 2 ? "5y" : spanDays > 365 ? "2y" : spanDays > 180 ? "1y"
                  : spanDays > 90 ? "6mo" : spanDays > 30 ? "3mo" : "1mo"

      const seriesByTicker = {}
      await Promise.all(tickers.map(async tk => {
        const region = priceCcyByTicker[tk] === "USD" ? "US" : "TH"
        const sym = toYahooSymbol(tk, region, clsByTicker[tk] || "Equity")
        const h = await fetchHistory(sym, range).catch(() => ({ series: [] }))
        seriesByTicker[tk] = (h?.series || []).map(p => ({ d: new Date(p.t * 1000).toISOString().split("T")[0], c: p.c }))
      }))
      // Fetch historical USDTHB rates so each date uses its own FX rate (not today's)
      const fxByDate = {}
      if (Object.values(priceCcyByTicker).some(c => c === "USD")) {
        const fxH = await fetchHistory("USDTHB=X", range).catch(() => ({ series: [] }))
        for (const p of (fxH?.series || []))
          fxByDate[new Date(p.t * 1000).toISOString().split("T")[0]] = p.c
      }

      const series = buildSnapshotSeries(txs, seriesByTicker, ccyByTicker, fxRate, fxByDate, priceCcyByTicker, clsByTicker)
      if (!series.length) { setBackfillMsg(th ? "ดึงราคาย้อนหลังไม่ได้ ลองใหม่อีกครั้ง" : "Couldn't fetch historical prices — try again"); return }

      // Nuclear: delete ALL existing snapshots first so weekend/holiday entries
      // recorded by App.jsx (which aren't in Yahoo data and wouldn't be overwritten
      // by upsert) don't survive as orphan bad data points.
      await deleteAllSnapshots(portfolio.id)
      const { error } = await upsertSnapshots(portfolio.id, series)
      if (error) { setBackfillMsg((th ? "บันทึกไม่สำเร็จ: " : "Save failed: ") + error.message); return }

      const fresh = await getSnapshots(portfolio.id)
      setSnaps(fresh)
      onSnapsRebuild?.()   // notify Common + Growth tabs to re-fetch
      setBackfillMsg(th
        ? `สร้างประวัติ ${series.length} วัน · ${txs.length} ธุรกรรม · เริ่มจาก ${earliest}`
        : `Rebuilt ${series.length} days · ${txs.length} transactions · since ${earliest}`)
    } catch (err) {
      setBackfillMsg((th ? "ผิดพลาด: " : "Error: ") + (err?.message || String(err)))
    } finally {
      setBackfilling(false)
    }
  }, [portfolio?.id, fxRate, th, onSnapsRebuild])

  // Auto-trigger backfill when Metrics tab opens and data is missing or stale (>5 days)
  const autoFilled = useRef(false)
  useEffect(() => {
    if (!isLive || autoFilled.current || backfilling) return
    const lastDate = snaps[snaps.length - 1]?.date
    const daysSinceLast = lastDate
      ? Math.floor((Date.now() - new Date(lastDate + 'T12:00:00Z').getTime()) / 86400000)
      : 999
    if (snaps.length > 0 && daysSinceLast < 5) return
    autoFilled.current = true
    handleBackfill()
  }, [isLive, snaps, backfilling, handleBackfill])

  // History-based metrics from the value/cost ratio index:
  // the ratio tracks market price performance; daily chain-linked returns
  // (idx[i]/idx[i-1]−1) feed Sharpe, Sortino, and drawdown calculations.
  const histMetrics = useMemo(() => {
    const idx = snaps.map(s => Number(s.total_cost) > 0 ? Number(s.total_value) / Number(s.total_cost) : null)
                     .filter(v => v != null && isFinite(v))
    if (idx.length < 2) return { days: snaps.length, ready: false }

    const rets = []
    for (let i = 1; i < idx.length; i++) rets.push(idx[i] / idx[i - 1] - 1)
    const n = rets.length
    const mean = rets.reduce((a, b) => a + b, 0) / n
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / n
    const sd = Math.sqrt(variance)
    const negs = rets.filter(r => r < 0)
    const downside = negs.length ? Math.sqrt(negs.reduce((a, b) => a + b * b, 0) / n) : 0
    const ANN = 252

    const twr = idx[idx.length - 1] / idx[0] - 1
    const vol = sd * Math.sqrt(ANN)
    const sharpe  = sd > 0       ? (mean * ANN) / vol : 0
    const sortino = downside > 0 ? (mean * ANN) / (downside * Math.sqrt(ANN)) : 0
    let peak = idx[0], mdd = 0
    for (const v of idx) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1) }

    return { ready: true, days: snaps.length, twr, vol, sharpe, sortino, mdd }
  }, [snaps])

  // ── Beta vs a market benchmark (region-chosen) ─────────────────────────────
  // Fetch the benchmark's daily closes covering the snapshot span, then compare
  // portfolio interval returns to the benchmark over the same intervals.
  const [bench, setBench] = useState(null)
  useEffect(() => {
    if (!isLive || snaps.length < 3) { setBench(null); return }
    const usW = rows.filter(r => r.region === "US").reduce((s, r) => s + r.weight, 0)
    const thW = rows.filter(r => r.region === "TH").reduce((s, r) => s + r.weight, 0)
    const sym  = usW >= thW ? "^GSPC" : "^SET.BK"
    const name = usW >= thW ? "S&P 500" : "SET Index"
    const spanDays = (new Date(snaps[snaps.length - 1].date) - new Date(snaps[0].date)) / 86400000
    const range = spanDays > 365 * 2 ? "5y" : spanDays > 365 ? "2y" : "1y"
    let cancelled = false
    fetchHistory(sym, range)
      .then(d => { if (!cancelled) setBench({ name, series: d?.series || [] }) })
      .catch(() => { if (!cancelled) setBench(null) })
    return () => { cancelled = true }
  }, [isLive, snaps, rows])

  const beta = useMemo(() => {
    if (!bench?.series?.length || snaps.length < 3) return null
    const closes = bench.series
      .map(p => ({ d: new Date(p.t * 1000).toISOString().split("T")[0], c: p.c }))
      .sort((a, b) => a.d.localeCompare(b.d))
    const closeOnOrBefore = (date) => {
      let best = null
      for (const x of closes) { if (x.d <= date) best = x.c; else break }
      return best
    }
    const idx = snaps.map(s => Number(s.total_cost) > 0 ? Number(s.total_value) / Number(s.total_cost) : null)
    const pr = [], mr = []
    for (let i = 1; i < snaps.length; i++) {
      if (idx[i] == null || idx[i - 1] == null) continue
      const c1 = closeOnOrBefore(snaps[i - 1].date), c2 = closeOnOrBefore(snaps[i].date)
      if (!c1 || !c2) continue
      pr.push(idx[i] / idx[i - 1] - 1)
      mr.push(c2 / c1 - 1)
    }
    const n = pr.length
    if (n < 3) return null
    const mMean = mr.reduce((a, b) => a + b, 0) / n
    const pMean = pr.reduce((a, b) => a + b, 0) / n
    let cov = 0, varM = 0
    for (let i = 0; i < n; i++) { cov += (pr[i] - pMean) * (mr[i] - mMean); varM += (mr[i] - mMean) ** 2 }
    if (varM === 0) return null
    return { value: cov / varM, n, name: bench.name }
  }, [bench, snaps])

  // ── Live-computable metrics (no historical data needed) ────────────────────
  const liveMetrics = useMemo(() => {
    if (!isLive || rows.length === 0 || totalValue <= 0) return null

    const weights = rows.map(r => r.weight / 100)
    const hhi = weights.reduce((s, w) => s + w * w, 0)          // Herfindahl 0-1
    const concentration = hhi * 100                             // 0-100 scale
    const sorted = [...rows].sort((a, b) => b.weight - a.weight)
    const top3 = sorted.slice(0, 3).reduce((s, r) => s + r.weight, 0)
    const topOne = sorted[0]?.weight || 0
    const wYield = rows.reduce((s, r) => s + (r.divYield || 0) * (r.weight / 100), 0)
    const thWeight = rows.filter(r => r.region === "TH").reduce((s, r) => s + r.weight, 0)
    const usWeight = rows.filter(r => r.region === "US").reduce((s, r) => s + r.weight, 0)
    const uniqueClasses = new Set(rows.map(r => r.cls)).size

    return [
      { key: "concentration", value: concentration.toFixed(0), unit: "/100", scale: Math.min(1, hhi * 2),
        min: "0", max: "100", inverse: true,
        sub: th ? "ความกระจุกตัว (HHI)" : "Concentration (HHI)",
        body: th ? "0 = กระจายมาก · 100 = หุ้นเดียว — ต่ำ = ดี" : "0 = highly diversified · 100 = single holding — lower is safer",
        formula: "HHI = Σ(wᵢ)² × 100\nwᵢ = มูลค่าหุ้น i ÷ มูลค่าพอร์ตรวม" },
      { key: "top3", value: top3.toFixed(0) + "%", scale: top3 / 100,
        min: "0%", max: "100%", inverse: top3 > 60,
        sub: th ? "น้ำหนัก 3 อันดับแรก" : "Top-3 weight",
        body: th ? "% ของพอร์ตในตำแหน่ง 3 อันดับแรก (มาก = กระจุก)" : "% in top 3 positions (high = concentrated)",
        formula: "Σ weight ของหุ้น 3 ตัวที่มูลค่าสูงสุด" },
      { key: "largest", value: topOne.toFixed(1) + "%", scale: Math.min(1, topOne / 50),
        min: "0%", max: "50%+", inverse: topOne > 30,
        sub: th ? "ตำแหน่งใหญ่สุด" : "Largest position",
        body: th ? "หุ้นใหญ่สุด — เกิน 30% ถือว่าเสี่ยงกระจุก" : "Largest single holding — >30% is concentration risk",
        formula: "max(weightᵢ) ของทุกหุ้นในพอร์ต" },
      { key: "classes", value: uniqueClasses.toString(), scale: Math.min(1, uniqueClasses / 6),
        min: "1", max: "6+",
        sub: th ? "ประเภทสินทรัพย์" : "Asset classes",
        body: th ? "ความหลากหลายของประเภทสินทรัพย์ในพอร์ต" : "Number of distinct asset classes held",
        formula: th ? "นับจำนวนประเภทสินทรัพย์ที่ไม่ซ้ำกัน\n(Equity / ETF / Bond / Crypto / Commodity)" : "count of distinct asset classes" },
      { key: "yield", value: wYield.toFixed(2) + "%", scale: Math.min(1, wYield / 6),
        min: "0%", max: "6%+",
        sub: th ? "อัตราปันผลถ่วงน้ำหนัก" : "Weighted div yield",
        body: th ? "อัตราปันผลเฉลี่ยตามน้ำหนักของแต่ละหลักทรัพย์" : "Dividend yield weighted by each holding's portfolio weight",
        formula: "Σ (อัตราปันผลหุ้น i × weightᵢ)" },
      { key: "geo", value: thWeight.toFixed(0) + "% / " + usWeight.toFixed(0) + "%", scale: Math.abs(thWeight - usWeight) / 100,
        min: "TH", max: "US", inverse: Math.abs(thWeight - usWeight) > 70,
        sub: th ? "สัดส่วนภูมิภาค (TH / US)" : "Region split (TH / US)",
        body: th ? "ยิ่งเอียงสุดทาง ความเสี่ยงตลาดเดียวยิ่งสูง" : "Lopsided splits expose you to single-market risk",
        formula: th ? "Σ weight หุ้น TH  /  Σ weight หุ้น US" : "Σ weight of TH holdings / Σ weight of US holdings" },
    ]
  }, [isLive, rows, totalValue, th])

  // ── Demo metrics (require historical data — illustrative only) ─────────────
  const demoMetrics = [
    { key: "twr",      value: "+18.3%", scale: 0.61, min: "-50%", max: "+50%",  sub: t.analytics.twr },
    { key: "pe",       value: "21.4x",  scale: 0.31, min: "0x",   max: "70x",   sub: t.analytics.pe },
    { key: "beta",     value: "0.92",   scale: 0.46, min: "0",    max: "2.0",   sub: t.analytics.beta },
    { key: "sharpe",   value: "1.42",   scale: 0.71, min: "0",    max: "2.0",   sub: t.analytics.sharpe },
    { key: "sortino",  value: "1.95",   scale: 0.65, min: "0",    max: "3.0",   sub: t.analytics.sortino },
    { key: "drawdown", value: "-9.8%",  scale: 0.19, min: "-50%", max: "0%",    sub: t.analytics.drawdown, inverse: true },
  ]
  const demoBody = {
    twr:      th ? "ผลตอบแทนสะสมจากการเปลี่ยนแปลงราคา วัดจากดัชนี มูลค่า ÷ ต้นทุน" : "Cumulative return from price changes, measured via value ÷ cost index",
    pe:       th ? "ค่าเฉลี่ยถ่วงน้ำหนักของ P/E ตามน้ำหนักในพอร์ต" : "Weighted average P/E across all individual stocks",
    beta:     th ? "ความผันผวนเทียบกับตลาด (S&P 500)"                : "Volatility relative to the market (S&P 500)",
    sharpe:   th ? "วัดผลตอบแทนต่อความเสี่ยงรวม"                     : "How well profitability compensates for total risk",
    sortino:  th ? "วัดผลตอบแทนต่อความเสี่ยงขาลงเท่านั้น"           : "How well profitability compensates for downside risk",
    drawdown: th ? "การลดลงสูงสุดจากจุดสูงสุดในประวัติ"              : "Largest peak-to-trough decline observed",
  }
  const demoFormula = {
    twr:      "Π(1 + rₜ) − 1\nrₜ = ผลตอบแทนช่วงย่อยระหว่างกระแสเงินสด",
    pe:       "Σ (P/Eᵢ × weightᵢ)",
    beta:     "Cov(พอร์ต, ตลาด) ÷ Var(ตลาด)",
    sharpe:   "(Rₚ − R_f) ÷ σₚ\nσₚ = ส่วนเบี่ยงเบนมาตรฐานผลตอบแทน",
    sortino:  "(Rₚ − R_f) ÷ σ_ขาลง",
    drawdown: "min((Vₜ − peakₜ) ÷ peakₜ)",
  }

  // Which list is actually on screen — live metrics need holdings; otherwise
  // fall back to the demo set.  Body/formula lookups must follow THIS, not just
  // login state, or demo cards (shown while live but empty) lose their text.
  const showingLive = isLive && liveMetrics
  const metricsList = showingLive ? liveMetrics : demoMetrics
  const bodyMap = showingLive ? null : demoBody
  const formulaMap = showingLive ? null : demoFormula

  return (
    <div className="fade-in">
      <div className="card" style={{ padding: "12px 20px", marginBottom: 16, background: "var(--bg-2)", display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name="info" size={14} />
        <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
          {isLive
            ? (th
              ? "ตัวชี้วัดด้านล่างคำนวณจากพอร์ตจริง · ตัวที่ต้องการประวัติย้อนหลัง (ผลตอบแทน/Beta/Sharpe) ยังไม่พร้อม"
              : "Metrics below are computed from your live portfolio · history-dependent ones (Return/Beta/Sharpe) require daily snapshots")
            : (th
              ? "ตัวชี้วัดเหล่านี้ต้องการข้อมูลราคาย้อนหลังรายวัน — ค่าที่แสดงเป็นตัวอย่าง (Demo)"
              : "These metrics require daily historical price data — values shown are illustrative (Demo).")}
        </span>
      </div>

      {isLive && liveMetrics === null && (
        <div className="card empty" style={{ padding: 40, textAlign: "center" }}>
          <h3 className="display" style={{ fontSize: 22, margin: 0 }}>
            {th ? "ยังไม่มีหลักทรัพย์ให้คำนวณ" : "Nothing to measure yet"}
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            {th ? "เพิ่มหลักทรัพย์เพื่อดูตัวชี้วัดความเสี่ยง" : "Add holdings to see risk metrics"}
          </p>
        </div>
      )}

      <div className="grid grid-2" style={{ gap: 16 }}>
        {metricsList.map(m => {
          const formula = showingLive ? m.formula : formulaMap[m.key]
          const open = openKey === m.key
          return (
          <div key={m.key} className="card" style={{ padding: 28 }}>
            <button
              onClick={() => formula && setOpenKey(open ? null : m.key)}
              title={th ? "ดูสูตรการคำนวณ" : "Show formula"}
              style={{
                width: "100%", background: "none", border: "none", padding: 0, margin: 0,
                cursor: formula ? "pointer" : "default", textAlign: "left",
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 14, fontWeight: 500, fontFamily: "inherit", color: "var(--ink)",
              }}
            >
              <span>{m.sub}</span>
              {formula && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 3, marginLeft: "auto",
                  fontSize: 11, fontWeight: 600, color: open ? "var(--accent-ink)" : "var(--ink-3)",
                }}>
                  <Icon name="info" size={13} /> {th ? "สูตร" : "Formula"}
                </span>
              )}
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: open ? 12 : 22 }}>
              {showingLive ? m.body : bodyMap[m.key]}
            </p>
            {open && formula && (
              <div style={{
                marginBottom: 18, padding: "12px 14px", borderRadius: 10,
                background: "var(--bg-2)", border: "1px solid var(--line)",
              }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-3)", marginBottom: 6, letterSpacing: 0.4 }}>
                  {th ? "สูตรการคำนวณ" : "FORMULA"}
                </div>
                <pre style={{
                  margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--ink-2)",
                  fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap",
                }}>{formula}</pre>
              </div>
            )}
            <div className="display" style={{ fontSize: 48, lineHeight: 1, color: m.inverse ? "var(--loss)" : "var(--ink)" }}>
              {m.value}{m.unit && <span style={{ fontSize: 20, color: "var(--ink-3)", marginLeft: 4 }}>{m.unit}</span>}
            </div>
            <div style={{ marginTop: 24, position: "relative", height: 8, background: "var(--bg-2)", borderRadius: 999 }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: (m.scale * 100) + "%", background: m.inverse ? "var(--loss)" : "var(--accent)", borderRadius: 999 }} />
              <div style={{ position: "absolute", left: (m.scale * 100) + "%", top: -2, width: 2, height: 12, background: "var(--ink)" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
              <span>{m.min}</span><span>{m.max}</span>
            </div>
          </div>
          )
        })}
      </div>

      {isLive && (
        <div className="card" style={{ marginTop: 16, padding: "20px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                {th ? "ตัวชี้วัดจากประวัติพอร์ต (รายวัน)" : "History-based metrics (daily series)"}
              </h4>
              <p className="muted" style={{ fontSize: 12, margin: "0 0 16px" }}>
                {th
                  ? `บันทึกแล้ว ${histMetrics.days} วัน · คำนวณจากดัชนีมูลค่า/ต้นทุน (ตัดผลการฝากถอน) · ยิ่งเก็บนานยิ่งแม่น`
                  : `${histMetrics.days} day(s) recorded · computed from the value/cost index (contribution-neutral) · accuracy improves over time`}
              </p>
            </div>
            <button className="btn btn-sm btn-outline" onClick={handleBackfill} disabled={backfilling}
                    style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
              {backfilling
                ? (th ? "กำลังสร้าง…" : "Rebuilding…")
                : (th ? "สร้างประวัติย้อนหลัง" : "Rebuild history")}
            </button>
          </div>
          {backfillMsg && (
            <div style={{ fontSize: 12, color: "var(--ink-2)", marginBottom: 14, padding: "8px 12px",
                          background: "var(--bg-2)", borderRadius: 8 }}>
              {backfillMsg}
            </div>
          )}

          {snaps.length > 0 && (() => {
            const ratios = snaps.map(s => Number(s.total_value) / Number(s.total_cost))
            // Detect outliers using same look-ahead logic as buildSnapshotSeries:
            // isolated spike >15% above both neighbors = likely bad Yahoo Finance price
            const isOutlier = ratios.map((r, i) => {
              if (i === 0 || i === ratios.length - 1) return false
              const pi = ratios[i - 1], ni = ratios[i + 1]
              return r > pi * 1.15 && r > ni * 1.15
            })
            const outlierCount = isOutlier.filter(Boolean).length
            const minR = Math.min(...ratios), maxR = Math.max(...ratios)
            const first = snaps[0]?.date, last = snaps[snaps.length - 1]?.date
            return (
              <div style={{ marginBottom: 14 }}>
                <button
                  onClick={() => setShowInspect(v => !v)}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                           fontSize: 12, color: "var(--ink-3)", fontFamily: "inherit",
                           display: "flex", alignItems: "center", gap: 6 }}
                >
                  <Icon name={showInspect ? "chevron-down" : "chevron-right"} size={12} />
                  {th ? "ตรวจสอบข้อมูล Snapshot" : "Inspect snapshot data"}
                  <span style={{ color: outlierCount > 0 ? "var(--loss)" : "var(--gain)", fontWeight: 600 }}>
                    {outlierCount > 0 ? ` ⚠ ${outlierCount} outlier${outlierCount > 1 ? "s" : ""}` : " ✓ clean"}
                  </span>
                </button>
                {showInspect && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 8, display: "flex", gap: 24 }}>
                      <span>{th ? "จำนวน" : "Count"}: <b>{snaps.length}</b></span>
                      <span>{th ? "ช่วงวันที่" : "Range"}: <b>{first} → {last}</b></span>
                      <span>{th ? "ช่วง ratio" : "Ratio range"}: <b>{((minR-1)*100).toFixed(1)}% → {((maxR-1)*100).toFixed(1)}%</b></span>
                    </div>
                    <div style={{ maxHeight: 260, overflowY: "auto", borderRadius: 8,
                                  border: "1px solid var(--line)", fontSize: 11 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "var(--bg-2)", position: "sticky", top: 0 }}>
                            <th style={{ padding: "6px 10px", textAlign: "left", color: "var(--ink-3)", fontWeight: 500 }}>Date</th>
                            <th style={{ padding: "6px 10px", textAlign: "right", color: "var(--ink-3)", fontWeight: 500 }}>Value (฿)</th>
                            <th style={{ padding: "6px 10px", textAlign: "right", color: "var(--ink-3)", fontWeight: 500 }}>Cost (฿)</th>
                            <th style={{ padding: "6px 10px", textAlign: "right", color: "var(--ink-3)", fontWeight: 500 }}>Return</th>
                          </tr>
                        </thead>
                        <tbody>
                          {snaps.map((s, i) => {
                            const ratio = ratios[i]
                            const pct = ((ratio - 1) * 100).toFixed(2) + "%"
                            const bad = isOutlier[i]
                            return (
                              <tr key={s.date} style={{ borderTop: "1px solid var(--line)",
                                                        background: bad ? "rgba(var(--loss-rgb,220,50,50),0.08)" : "transparent" }}>
                                <td style={{ padding: "4px 10px", color: bad ? "var(--loss)" : "var(--ink-2)", fontFamily: "var(--font-mono)" }}>
                                  {bad ? "⚠ " : ""}{s.date}
                                </td>
                                <td style={{ padding: "4px 10px", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                                  {Number(s.total_value).toLocaleString("th-TH", { maximumFractionDigits: 0 })}
                                </td>
                                <td style={{ padding: "4px 10px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--ink-3)" }}>
                                  {Number(s.total_cost).toLocaleString("th-TH", { maximumFractionDigits: 0 })}
                                </td>
                                <td style={{ padding: "4px 10px", textAlign: "right", fontFamily: "var(--font-mono)",
                                             color: bad ? "var(--loss)" : ratio >= 1 ? "var(--gain)" : "var(--loss)", fontWeight: bad ? 700 : 400 }}>
                                  {ratio >= 1 ? "+" : ""}{pct}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          {!histMetrics.ready ? (
            <div style={{ padding: "16px 0", color: "var(--ink-3)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="info" size={14} />
              {th
                ? `กำลังเก็บข้อมูล — ต้องมีอย่างน้อย 2 วันจึงเริ่มคำนวณได้ (ตอนนี้ ${histMetrics.days} วัน)`
                : `Collecting data — need at least 2 days to compute (currently ${histMetrics.days})`}
            </div>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
              {[
                { key: "twr", label: th ? "ผลตอบแทนพอร์ต" : "Portfolio Return", val: (histMetrics.twr * 100).toFixed(2) + "%", neg: histMetrics.twr < 0,
                  desc: th ? "ผลตอบแทนสะสมตั้งแต่ snapshot แรก วัดจากการเปลี่ยนแปลงของอัตราส่วน มูลค่า ÷ ต้นทุน" : "Cumulative return since first snapshot, measured as change in the value ÷ cost ratio",
                  formula: th ? "ดัชนีล่าสุด ÷ ดัชนีแรก − 1\n(ดัชนี = มูลค่า ÷ ต้นทุน)" : "last index ÷ first index − 1\n(index = value ÷ cost)" },
                { key: "vol", label: th ? "ความผันผวน (ปีละ)" : "Volatility (ann.)", val: (histMetrics.vol * 100).toFixed(1) + "%",
                  desc: th ? "ความแกว่งของผลตอบแทน — สูง = เสี่ยง/เหวี่ยงแรง" : "Swing of returns — higher = riskier",
                  formula: "SD(ผลตอบแทนรายช่วง) × √252" },
                { key: "sharpe", label: "Sharpe", val: histMetrics.sharpe.toFixed(2), neg: histMetrics.sharpe < 0,
                  desc: th ? "ผลตอบแทนต่อความเสี่ยงรวม — สูง = คุ้มกว่า" : "Return per unit of total risk — higher is better",
                  formula: th ? "ผลตอบแทนเฉลี่ยต่อปี ÷ ความผันผวน" : "annualized mean return ÷ volatility" },
                { key: "sortino", label: "Sortino", val: histMetrics.sortino.toFixed(2), neg: histMetrics.sortino < 0,
                  desc: th ? "ผลตอบแทนต่อความเสี่ยงเฉพาะขาลง — สูง = ดี" : "Return per unit of downside risk — higher is better",
                  formula: th ? "ผลตอบแทนเฉลี่ยต่อปี ÷ (SD เฉพาะช่วงติดลบ × √252)" : "annualized mean ÷ (downside SD × √252)" },
                { key: "mdd", label: th ? "ขาดทุนสูงสุด" : "Max Drawdown", val: (histMetrics.mdd * 100).toFixed(1) + "%", neg: true,
                  desc: th ? "การร่วงหนักสุดจากจุดสูงสุดถึงจุดต่ำสุด" : "Largest peak-to-trough drop",
                  formula: "min((ดัชนีₜ − พีคₜ) ÷ พีคₜ)" },
                { key: "beta", label: beta ? `Beta · ${beta.name}` : "Beta",
                  val: beta ? beta.value.toFixed(2) : "—",
                  neg: beta ? beta.value > 1 : false,
                  desc: th ? "แกว่งเทียบตลาด — 1 = เท่าตลาด, <1 = นิ่งกว่า" : "Swing vs market — 1 = same, <1 = calmer",
                  formula: beta ? "Cov(พอร์ต, ตลาด) ÷ Var(ตลาด)" : null },
              ].map(s => {
                const hk = "h_" + s.key
                const hopen = openKey === hk
                return (
                <div key={s.key}>
                  <button
                    onClick={() => s.formula && setOpenKey(hopen ? null : hk)}
                    title={th ? "ดูสูตร" : "Show formula"}
                    style={{ background: "none", border: "none", padding: 0, margin: "0 0 4px", textAlign: "left",
                             cursor: s.formula ? "pointer" : "default", display: "flex", alignItems: "center", gap: 4,
                             fontSize: 11, color: "var(--ink-3)", fontFamily: "inherit" }}
                  >
                    {s.label} {s.formula && <Icon name="info" size={11} />}
                  </button>
                  <div className="display" style={{ fontSize: 26, lineHeight: 1, color: s.neg ? "var(--loss)" : "var(--ink)" }}>{s.val}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>{s.desc}</div>
                  {hopen && s.formula && (
                    <pre style={{ margin: "8px 0 0", padding: "8px 10px", borderRadius: 8, background: "var(--bg-2)",
                                  border: "1px solid var(--line)", fontSize: 11, lineHeight: 1.5, color: "var(--ink-2)",
                                  fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap" }}>{s.formula}</pre>
                  )}
                </div>
                )
              })}
            </div>
          )}

          <p className="muted" style={{ fontSize: 11, margin: "16px 0 0", lineHeight: 1.5 }}>
            {th
              ? `หมายเหตุ: บันทึกเมื่อเปิดแอปแต่ละวัน (ไม่ใช่ทุกวันต่อเนื่อง) ค่า annualize จึงเป็นค่าประมาณ · Beta เทียบกับ ${beta ? beta.name : "S&P 500 / SET ตามภูมิภาคหลัก"} (ต้องการข้อมูลพอสมควรจึงจะแสดง)`
              : `Note: recorded when you open the app each day (not strictly continuous), so annualized figures are approximate · Beta is vs ${beta ? beta.name : "S&P 500 / SET by dominant region"} (shows once enough data exists)`}
          </p>
        </div>
      )}
    </div>
  )
}

/* ─── BigKpi ─────────────────────────────────────────────────────────────────── */
function BigKpi({ label, value, sub, tone, className }) {
  const color = tone === "gain" ? "var(--gain)" : tone === "loss" ? "var(--loss)" : "var(--ink)"
  return (
    <div className={"card " + (className || "")}>
      <div className="label-up" style={{ marginBottom: 8 }}>{label}</div>
      <div className="display" style={{ fontSize: 32, color, lineHeight: 1 }}>{value}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{sub}</div>
    </div>
  )
}

/* ─── Tax tab ────────────────────────────────────────────────────────────────── */
function AnalyticsTax({ t, lang, ccy, dataState, transactions = [], fxRate = 36 }) {
  const FMT = LUMEN_FMT
  const th = lang === "th"

  // ── Compute realized P/L once from all transactions ──────────────────────────
  const realized = useMemo(() => computeRealized(transactions, fxRate), [transactions, fxRate])

  // ── Available tax years ───────────────────────────────────────────────────────
  const years = useMemo(() => {
    const set = new Set()
    transactions.forEach(tx => {
      const y = String(tx.transacted_at || '').slice(0, 4)
      if (y) set.add(y)
    })
    return [...set].sort().reverse()
  }, [transactions])

  const currentYear = String(new Date().getFullYear())
  const [selYear, setSelYear] = useState(currentYear)

  // ── Sales filtered to selected year ──────────────────────────────────────────
  const salesThisYear = useMemo(
    () => realized.sales.filter(s => s.date.startsWith(selYear)),
    [realized.sales, selYear]
  )
  const salesTH = salesThisYear.filter(s => s.currency === 'THB')
  const salesUS = salesThisYear.filter(s => s.currency === 'USD')
  const gainTH  = salesTH.reduce((a, s) => a + s.gainTHB, 0)
  const gainUS  = salesUS.reduce((a, s) => a + s.gainTHB, 0)

  // ── Dividends filtered to selected year ───────────────────────────────────────
  const divTxsYear = useMemo(
    () => transactions.filter(tx =>
      tx.type === 'Dividend' && String(tx.transacted_at || '').startsWith(selYear)
    ),
    [transactions, selYear]
  )
  const divByTicker = useMemo(() => {
    const map = {}
    divTxsYear.forEach(tx => {
      const tk = tx.ticker || '—'
      if (!map[tk]) map[tk] = { ticker: tk, currency: tx.currency || 'THB', total: 0, count: 0, withholding: 0 }
      const amt = Number(tx.shares) * Number(tx.price)   // shares × price used as amount
      const fx  = tx.currency === 'USD' ? fxRate : 1
      map[tk].total      += amt * fx
      map[tk].withholding += (Number(tx.tax) || 0) * fx
      map[tk].count++
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [divTxsYear, fxRate])
  const totalDiv         = divByTicker.reduce((a, d) => a + d.total, 0)
  const totalWithholding = divByTicker.reduce((a, d) => a + d.withholding, 0)

  // ── CSV export ────────────────────────────────────────────────────────────────
  const exportCSV = useCallback(() => {
    const rows = [
      ['Section', 'Date', 'Ticker', 'Region', 'Shares', 'Price', 'Proceeds (THB)', 'Cost (THB)', 'Gain/Loss (THB)', 'Gain/Loss %'],
      ...salesThisYear.map(s => [
        'Realized P/L',
        s.date,
        s.ticker,
        s.currency === 'USD' ? 'US' : 'TH',
        s.shares,
        s.price,
        s.proceedsTHB.toFixed(2),
        s.costTHB.toFixed(2),
        s.gainTHB.toFixed(2),
        s.gainPct.toFixed(2) + '%',
      ]),
      [],
      ['Section', 'Ticker', 'Currency', 'Total Dividend (THB)', 'Withholding Tax (THB)', 'Times'],
      ...divByTicker.map(d => [
        'Dividend',
        d.ticker,
        d.currency,
        d.total.toFixed(2),
        d.withholding.toFixed(2),
        d.count,
      ]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `tax-report-${selYear}.csv`; a.click()
    URL.revokeObjectURL(url)
  }, [salesThisYear, divByTicker, selYear])

  if (dataState !== 'live') {
    return (
      <div className="fade-in" style={{ padding: '48px 0', textAlign: 'center', color: 'var(--ink-4)' }}>
        {th ? 'ใช้งานได้เฉพาะโหมด Live' : 'Available in live mode only'}
      </div>
    )
  }

  const fmtB = v => FMT.money(v, 'THB', { compact: false })
  const fmtG = v => (
    <span style={{ color: v >= 0 ? 'var(--gain)' : 'var(--loss)', fontWeight: 600 }}>
      {v >= 0 ? '+' : ''}{fmtB(v)}
    </span>
  )

  return (
    <div className="fade-in">
      {/* ── Year picker + export ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{th ? 'ปีภาษี' : 'Tax year'}</span>
          <select value={selYear} onChange={e => setSelYear(e.target.value)}
            style={{ padding: '5px 10px', borderRadius: 8, fontSize: 13, border: '1.5px solid var(--line)',
                     background: 'var(--bg)', color: 'var(--ink)', cursor: 'pointer', outline: 'none',
                     fontFamily: 'var(--font-mono)' }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
            {!years.includes(currentYear) && <option value={currentYear}>{currentYear}</option>}
          </select>
        </div>
        <button className="btn btn-outline btn-sm" onClick={exportCSV}
          title={th ? 'ดาวน์โหลด CSV' : 'Download CSV'}>
          <Icon name="upload" size={14} />
          {th ? 'ดาวน์โหลด CSV' : 'Download CSV'}
        </button>
      </div>

      {/* ── Summary cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-12" style={{ marginBottom: 20 }}>
        <div className="card col-span-3">
          <div className="label-up" style={{ marginBottom: 8 }}>{th ? 'กำไร/ขาดทุนรับรู้ (TH)' : 'Realized P/L · TH'}</div>
          <div className="display" style={{ fontSize: 26, lineHeight: 1.1, color: gainTH >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
            {gainTH >= 0 ? '+' : ''}{fmtB(gainTH)}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {salesTH.length} {th ? 'รายการขาย' : 'sales'} · {th ? 'ยกเว้นภาษี (SET)' : 'tax-exempt (SET)'}
          </div>
        </div>
        <div className="card col-span-3">
          <div className="label-up" style={{ marginBottom: 8 }}>{th ? 'กำไร/ขาดทุนรับรู้ (US)' : 'Realized P/L · US'}</div>
          <div className="display" style={{ fontSize: 26, lineHeight: 1.1, color: gainUS >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
            {gainUS >= 0 ? '+' : ''}{fmtB(gainUS)}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {salesUS.length} {th ? 'รายการขาย' : 'sales'} · {th ? 'รายได้ต่างประเทศ' : 'foreign income'}
          </div>
        </div>
        <div className="card col-span-3">
          <div className="label-up" style={{ marginBottom: 8 }}>{th ? 'ปันผลรับรวม' : 'Total dividends'}</div>
          <div className="display" style={{ fontSize: 26, lineHeight: 1.1, color: 'var(--gain)' }}>
            +{fmtB(totalDiv)}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {divTxsYear.length} {th ? 'ครั้ง' : 'payments'}
          </div>
        </div>
        <div className="card col-span-3">
          <div className="label-up" style={{ marginBottom: 8 }}>{th ? 'ภาษีหัก ณ ที่จ่าย' : 'Withholding tax'}</div>
          <div className="display" style={{ fontSize: 26, lineHeight: 1.1 }}>
            {fmtB(totalWithholding)}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {th ? 'สามารถขอคืน/เครดิตได้' : 'claimable as tax credit'}
          </div>
        </div>
      </div>

      {/* ── Tax notes ─────────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20, padding: '12px 16px', background: 'var(--line-2)', border: 'none' }}>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--ink)' }}>{th ? 'หมายเหตุด้านภาษี' : 'Tax notes'}</strong>
          {th ? (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              <li>หุ้น SET: <strong>ไม่เสียภาษี capital gains</strong> (ยกเว้นตามกฎหมาย)</li>
              <li>หุ้น US: ถือเป็น<strong>รายได้ต่างประเทศ</strong> — ต้องนำรวมยื่น ภ.ง.ด. 90</li>
              <li>ปันผล TH: ถูกหัก ณ ที่จ่าย 10% — ขอเครดิตภาษีคืนได้เมื่อยื่น ภ.ง.ด. 90</li>
              <li>ปันผล US: หัก ณ ที่จ่าย 30% (อนุสัญญาภาษีไทย-สหรัฐ ลดเหลือ 15%)</li>
            </ul>
          ) : (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              <li>TH stocks: <strong>capital gains are tax-exempt</strong> (SET-listed)</li>
              <li>US stocks: treated as <strong>foreign income</strong> — declare in annual return (ภ.ง.ด. 90)</li>
              <li>TH dividends: 10% withheld — claimable as tax credit in annual return</li>
              <li>US dividends: 30% withheld (Thailand–US treaty reduces to 15%)</li>
            </ul>
          )}
        </div>
      </div>

      {/* ── Realized sales table ──────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title" style={{ marginBottom: 14 }}>
          {th ? 'รายการขาย (Realized P/L)' : 'Realized sales'}
          <span className="muted" style={{ fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
            {th ? 'คำนวณต้นทุนแบบ weighted average' : 'weighted average cost method'}
          </span>
        </h3>
        {salesThisYear.length === 0 ? (
          <div style={{ color: 'var(--ink-4)', fontSize: 13, padding: '12px 0' }}>
            {th ? `ไม่มีรายการขายในปี ${selYear}` : `No sales in ${selYear}`}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1.5px solid var(--line)' }}>
                  {[
                    th ? 'วันที่' : 'Date',
                    'Ticker',
                    th ? 'หน่วย' : 'Shares',
                    th ? 'ราคาขาย' : 'Sell price',
                    th ? 'รายรับสุทธิ' : 'Proceeds',
                    th ? 'ต้นทุน' : 'Cost basis',
                    th ? 'กำไร/ขาดทุน' : 'Gain / Loss',
                    '%',
                  ].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--ink-3)',
                                        fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {salesThisYear.map((s, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <td style={{ padding: '7px 8px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{s.date}</td>
                    <td style={{ padding: '7px 8px', fontWeight: 600 }}>
                      {s.ticker}
                      <span style={{ fontSize: 10, marginLeft: 4, color: 'var(--ink-4)',
                                     background: 'var(--line-2)', borderRadius: 4, padding: '1px 4px' }}>
                        {s.currency === 'USD' ? 'US' : 'TH'}
                      </span>
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{s.shares}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtB(s.price * (s.currency === 'USD' ? fxRate : 1))}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtB(s.proceedsTHB)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtB(s.costTHB)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmtG(s.gainTHB)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)',
                                 color: s.gainPct >= 0 ? 'var(--gain)' : 'var(--loss)' }}>
                      {s.gainPct >= 0 ? '+' : ''}{s.gainPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1.5px solid var(--line)' }}>
                  <td colSpan={6} style={{ padding: '8px 8px', fontWeight: 600, fontSize: 12 }}>
                    {th ? 'รวม' : 'Total'}
                  </td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700 }}>{fmtG(salesThisYear.reduce((a, s) => a + s.gainTHB, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Dividends table ───────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title" style={{ marginBottom: 14 }}>
          {th ? 'ปันผลรับ' : 'Dividends received'}
        </h3>
        {divByTicker.length === 0 ? (
          <div style={{ color: 'var(--ink-4)', fontSize: 13, padding: '12px 0' }}>
            {th ? `ไม่มีปันผลในปี ${selYear}` : `No dividends in ${selYear}`}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1.5px solid var(--line)' }}>
                  {[
                    'Ticker',
                    th ? 'ปันผลรับ (฿)' : 'Dividend (THB)',
                    th ? 'ภาษีหัก ณ ที่จ่าย (฿)' : 'Withholding (THB)',
                    th ? 'รับสุทธิ (฿)' : 'Net received (THB)',
                    th ? 'ครั้ง' : 'Payments',
                  ].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--ink-3)', fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {divByTicker.map((d, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line-2)' }}>
                    <td style={{ padding: '7px 8px', fontWeight: 600 }}>
                      {d.ticker}
                      <span style={{ fontSize: 10, marginLeft: 4, color: 'var(--ink-4)',
                                     background: 'var(--line-2)', borderRadius: 4, padding: '1px 4px' }}>
                        {d.currency === 'USD' ? 'US' : 'TH'}
                      </span>
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtB(d.total)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--loss)' }}>{d.withholding > 0 ? '−' + fmtB(d.withholding) : '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--gain)', fontWeight: 600 }}>+{fmtB(d.total - d.withholding)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--ink-3)' }}>{d.count}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1.5px solid var(--line)' }}>
                  <td style={{ padding: '8px 8px', fontWeight: 600, fontSize: 12 }}>{th ? 'รวม' : 'Total'}</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700 }}>{fmtB(totalDiv)}</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--loss)', fontWeight: 700 }}>{totalWithholding > 0 ? '−' + fmtB(totalWithholding) : '—'}</td>
                  <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--gain)', fontWeight: 700 }}>+{fmtB(totalDiv - totalWithholding)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Health tab ─────────────────────────────────────────────────────────────── */
const REBAL_TARGETS_KEY  = "lumen_rebalance_targets"
const REBAL_TICKER_W_KEY = "lumen_rebalance_ticker_weights"
const REBAL_MODE_KEY     = "lumen_rebalance_mode"
const REBAL_BAND_KEY     = "lumen_rebalance_band"

const RISK_BY_CLASS  = { Cash: 0, Bond: 1, GoldTH: 2, MutualFund: 2.5, Equity: 3, Crypto: 5 }
const LIQUID_CLASSES = new Set(['Cash', 'Bond', 'MutualFund'])

function healthGrade(score) {
  if (score >= 85) return 'A'
  if (score >= 70) return 'B'
  if (score >= 55) return 'C'
  return 'D'
}

function ScoreRing({ score }) {
  const r = 38, circ = 2 * Math.PI * r
  const offset = circ * (1 - score / 100)
  const color = score >= 70 ? 'var(--gain)' : score >= 50 ? 'oklch(0.65 0.15 60)' : 'var(--loss)'
  return (
    <div style={{ position: 'relative', width: 96, height: 96, flexShrink: 0 }}>
      <svg width="96" height="96" viewBox="0 0 96 96" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--line)" strokeWidth="9" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="9"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color }}>{score}</span>
        <span style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>/100</span>
      </div>
    </div>
  )
}

function MetricCard({ icon, name, grade, detail, barPct }) {
  const palette = {
    A: { bg: 'oklch(0.95 0.04 160)', txt: 'var(--gain)',           bar: 'var(--gain)' },
    B: { bg: 'oklch(0.96 0.06 80)',  txt: 'oklch(0.55 0.15 60)',   bar: 'oklch(0.65 0.15 60)' },
    C: { bg: 'oklch(0.96 0.05 50)',  txt: 'oklch(0.55 0.18 45)',   bar: 'oklch(0.65 0.18 45)' },
    D: { bg: 'oklch(0.96 0.04 25)',  txt: 'var(--loss)',            bar: 'var(--loss)' },
  }
  const p = palette[grade] || palette.D
  return (
    <div className="tbl-card" style={{ padding: '16px', borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 800, padding: '3px 9px', borderRadius: 7, background: p.bg, color: p.txt, letterSpacing: '.5px' }}>{grade}</span>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 3, color: 'var(--ink-1)' }}>{name}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45 }}>{detail}</div>
      </div>
      <div style={{ height: 5, background: 'var(--line)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${barPct}%`, height: '100%', background: p.bar, borderRadius: 99, transition: 'width .4s ease' }} />
      </div>
    </div>
  )
}

function AnalyticsHealth({ t, lang, rows = [], totalValue = 0, totalPlPct = 0, dataState, cashAccounts = [], fxRate = 36 }) {
  const th = lang === 'th'

  // Cash value from bank/savings accounts (not in rows)
  const cashValue = useMemo(() =>
    cashAccounts.reduce((s, a) => s + (a.currency === 'USD' ? (a.balance || 0) * fxRate : (a.balance || 0)), 0)
  , [cashAccounts, fxRate])

  const fullValue = totalValue + cashValue  // total incl. cash for liquidity denominator

  const rebalState = useMemo(() => ({
    targets: JSON.parse(localStorage.getItem(REBAL_TARGETS_KEY) || '{}'),
    tickerW: JSON.parse(localStorage.getItem(REBAL_TICKER_W_KEY) || '{}'),
    mode:    localStorage.getItem(REBAL_MODE_KEY) || 'class',
    band:    parseFloat(localStorage.getItem(REBAL_BAND_KEY) || '5') || 5,
  }), [])

  // 1 — Diversification
  const divScore = useMemo(() => {
    const classes = new Set(rows.map(r => r.cls || 'Equity'))
    if (cashValue > 0) classes.add('Cash')
    const regions = new Set(rows.map(r => r.region || 'TH'))
    const base  = [0, 20, 45, 65, 80, 90][Math.min(classes.size, 5)]
    const score = Math.min(100, base + (regions.size >= 2 ? 10 : 0))
    return { score, nClasses: classes.size, nRegions: regions.size }
  }, [rows, cashValue])

  // 2 — Concentration (weight relative to investment portfolio only, excl. cash)
  const conScore = useMemo(() => {
    const sorted = [...rows].sort((a, b) => b.weight - a.weight)
    const maxW   = sorted[0]?.weight || 0
    const top3   = sorted.slice(0, 3).reduce((s, r) => s + r.weight, 0)
    const score  = Math.round(Math.max(20, 100 - maxW * 1.8) - (top3 > 65 ? 10 : 0))
    return { score: Math.min(100, score), maxW, top3, topTicker: sorted[0]?.ticker }
  }, [rows])

  // 3 — Rebalance
  const rebalScore = useMemo(() => {
    const { targets, tickerW, mode, band } = rebalState
    const hasClass  = Object.keys(targets).length > 0
    const hasTicker = Object.keys(tickerW).length > 0
    if (!hasClass && !hasTicker) return { score: 75, hasTargets: false, outOfBand: 0, total: 0 }

    const classTotals = {}
    rows.forEach(r => { const c = r.cls || 'Equity'; classTotals[c] = (classTotals[c] || 0) + r.weight })

    let outOfBand = 0, total = 0
    if (mode !== 'ticker' && hasClass) {
      for (const [cls, tgt] of Object.entries(targets)) {
        total++; if (Math.abs((classTotals[cls] || 0) - tgt) > band) outOfBand++
      }
    }
    if (mode !== 'class' && hasTicker) {
      for (const r of rows) {
        const tgt = tickerW[r.ticker]; if (tgt == null) continue
        total++; if (Math.abs(r.weight - tgt) > band) outOfBand++
      }
    }
    if (total === 0) return { score: 75, hasTargets: true, outOfBand: 0, total: 0 }
    return { score: Math.round(((total - outOfBand) / total) * 100), hasTargets: true, outOfBand, total }
  }, [rows, rebalState])

  // 4 — Return
  const retScore = useMemo(() => {
    const pos      = rows.filter(r => r.pl >= 0).length
    const posScore = rows.length > 0 ? (pos / rows.length) * 70 : 0
    const plScore  = Math.min(30, Math.max(0, (totalPlPct || 0) * 1.0))
    return { score: Math.round(posScore + plScore), pos, total: rows.length }
  }, [rows, totalPlPct])

  // 5 — Risk
  const riskScore = useMemo(() => {
    const totalW = rows.reduce((s, r) => s + r.weight, 0)
    const wr = totalW > 0
      ? rows.reduce((s, r) => s + (RISK_BY_CLASS[r.cls] ?? 3) * r.weight, 0) / totalW
      : 0
    const levels = [
      { max: 1,        score: 70, en: 'Conservative',  th: 'อนุรักษ์นิยม' },
      { max: 2,        score: 80, en: 'Moderate-Low',  th: 'ค่อนข้างอนุรักษ์' },
      { max: 3,        score: 90, en: 'Moderate',      th: 'สมดุล' },
      { max: 4,        score: 75, en: 'Moderate-High', th: 'ค่อนข้างรุนแรง' },
      { max: Infinity, score: 55, en: 'High Risk',     th: 'ความเสี่ยงสูง' },
    ]
    const lv = levels.find(l => wr < l.max)
    return { score: lv.score, label: th ? lv.th : lv.en, wr }
  }, [rows, th])

  // 6 — Liquidity (includes cash accounts as numerator + denominator)
  const liqScore = useMemo(() => {
    const liquidInvValue = rows
      .filter(r => LIQUID_CLASSES.has(r.cls))
      .reduce((s, r) => s + r.value, 0)
    const liquidTotal = liquidInvValue + cashValue
    const liqPct = fullValue > 0 ? (liquidTotal / fullValue) * 100 : 0
    const score = liqPct >= 25 ? 100 : liqPct >= 20 ? 85 : liqPct >= 15 ? 70 : liqPct >= 10 ? 55 : liqPct >= 5 ? 35 : 20
    return { score, liqPct: Math.round(liqPct * 10) / 10, cashValue }
  }, [rows, cashValue, fullValue])

  const composite = Math.round(
    divScore.score * 0.20 + conScore.score * 0.20 + rebalScore.score * 0.15 +
    retScore.score * 0.25 + riskScore.score * 0.10 + liqScore.score * 0.10
  )

  const overallLabel = composite >= 80 ? (th ? 'พอร์ตสุขภาพดีเยี่ยม' : 'Excellent portfolio health')
    : composite >= 65 ? (th ? 'พอร์ตสุขภาพดี' : 'Good portfolio health')
    : composite >= 50 ? (th ? 'พอร์ตควรปรับปรุง' : 'Portfolio needs attention')
    : (th ? 'พอร์ตมีความเสี่ยงสูง' : 'Portfolio at risk')

  const overallColor = composite >= 70 ? 'var(--gain)' : composite >= 50 ? 'oklch(0.65 0.15 60)' : 'var(--loss)'

  const overallSub = (() => {
    const weak = [
      liqScore.score  < 55 && (th ? 'สภาพคล่องต่ำ'    : 'low liquidity'),
      conScore.score  < 55 && (th ? 'ความเข้มข้นสูง'   : 'high concentration'),
      divScore.score  < 55 && (th ? 'กระจายน้อย'       : 'low diversification'),
      rebalScore.hasTargets && rebalScore.score < 60 && (th ? 'Rebalance ค้าง' : 'rebalancing needed'),
    ].filter(Boolean)
    return weak.length > 0
      ? (th ? `ควรแก้ไข: ${weak.join(', ')}` : `Address: ${weak.join(', ')}`)
      : (th ? 'ทุกมิติอยู่ในเกณฑ์ดี' : 'All metrics within healthy range')
  })()

  const metrics = [
    {
      icon: '🧩', score: divScore.score,
      name: th ? 'การกระจาย' : 'Diversification',
      detail: th
        ? `${divScore.nClasses} ประเภทสินทรัพย์ · ${divScore.nRegions} ภูมิภาค`
        : `${divScore.nClasses} asset class${divScore.nClasses !== 1 ? 'es' : ''} · ${divScore.nRegions} region(s)`,
    },
    {
      icon: '⚖️', score: conScore.score,
      name: th ? 'ความเข้มข้น' : 'Concentration',
      detail: th
        ? `${conScore.topTicker || '—'} ${conScore.maxW.toFixed(1)}% · Top-3 รวม ${conScore.top3.toFixed(0)}%`
        : `${conScore.topTicker || '—'} ${conScore.maxW.toFixed(1)}% · top-3 sum ${conScore.top3.toFixed(0)}%`,
    },
    {
      icon: '🎯', score: rebalScore.score,
      name: th ? 'Rebalance' : 'Rebalance',
      detail: rebalScore.hasTargets
        ? (th ? `${rebalScore.outOfBand}/${rebalScore.total} รายการนอกเป้า` : `${rebalScore.outOfBand}/${rebalScore.total} outside target`)
        : (th ? 'ยังไม่ได้ตั้งเป้าหมาย' : 'No targets set yet'),
    },
    {
      icon: '📈', score: retScore.score,
      name: th ? 'ผลตอบแทน' : 'Return',
      detail: th
        ? `${retScore.pos}/${retScore.total} กำไร · รวม ${totalPlPct >= 0 ? '+' : ''}${totalPlPct.toFixed(1)}%`
        : `${retScore.pos}/${retScore.total} profitable · ${totalPlPct >= 0 ? '+' : ''}${totalPlPct.toFixed(1)}% total`,
    },
    {
      icon: '🌡️', score: riskScore.score,
      name: th ? 'ระดับความเสี่ยง' : 'Risk Level',
      detail: riskScore.label,
    },
    {
      icon: '💧', score: liqScore.score,
      name: th ? 'สภาพคล่อง' : 'Liquidity',
      detail: th
        ? `เงินสด+พันธบัตร ${liqScore.liqPct}%${liqScore.liqPct < 15 ? ' · ต่ำกว่าเป้า 15%' : ''}`
        : `Cash+bonds ${liqScore.liqPct}%${liqScore.liqPct < 15 ? ' · below 15% target' : ''}`,
    },
  ]

  // Action items
  const actions = useMemo(() => {
    const items = []
    if (liqScore.score < 70)
      items.push({ sev: 'high', text: th
        ? `เพิ่มเงินสด/พันธบัตร — สภาพคล่อง ${liqScore.liqPct}% ควรมีอย่างน้อย 15%`
        : `Increase cash or bonds — liquidity ${liqScore.liqPct}%, target ≥15%` })
    if (conScore.score < 65 && conScore.topTicker)
      items.push({ sev: 'high', text: th
        ? `ลดน้ำหนัก ${conScore.topTicker} — ถือ ${conScore.maxW.toFixed(1)}% เสี่ยงหากราคาตก`
        : `Reduce ${conScore.topTicker} — ${conScore.maxW.toFixed(1)}% single-asset concentration` })
    if (rebalScore.hasTargets && rebalScore.outOfBand > 0)
      items.push({ sev: 'med', text: th
        ? `${rebalScore.outOfBand} รายการนอกกรอบเป้าหมาย — ควร Rebalance ตามแผน`
        : `${rebalScore.outOfBand} item(s) outside target band — consider rebalancing` })
    if (divScore.nRegions < 2)
      items.push({ sev: 'med', text: th
        ? 'ลงทุนในภูมิภาคเดียว — เพิ่มหุ้น/กองทุนต่างประเทศเพื่อกระจายความเสี่ยง'
        : 'Single-region portfolio — add international assets to reduce country risk' })
    if (retScore.score >= 75)
      items.push({ sev: 'ok', text: th
        ? `${retScore.pos}/${retScore.total} หลักทรัพย์กำไร · ผลตอบแทนรวม ${totalPlPct >= 0 ? '+' : ''}${totalPlPct.toFixed(1)}%`
        : `${retScore.pos}/${retScore.total} holdings profitable · overall ${totalPlPct >= 0 ? '+' : ''}${totalPlPct.toFixed(1)}%` })
    if (divScore.score >= 85)
      items.push({ sev: 'ok', text: th
        ? `กระจายครบ ${divScore.nClasses} ประเภทสินทรัพย์ · ${divScore.nRegions} ภูมิภาค`
        : `Well diversified — ${divScore.nClasses} asset classes · ${divScore.nRegions} region(s)` })
    return items
  }, [liqScore, conScore, rebalScore, divScore, retScore, totalPlPct, th])

  if (rows.length === 0 && cashValue === 0) {
    return (
      <div className="shell-section" style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--ink-3)' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🛡️</div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{th ? 'ไม่มีข้อมูลพอร์ต' : 'No portfolio data'}</div>
        <div style={{ fontSize: 13 }}>{th ? 'เพิ่มหลักทรัพย์ก่อนเพื่อดูสุขภาพพอร์ต' : 'Add holdings to see your portfolio health'}</div>
      </div>
    )
  }

  const sevColor = { high: 'var(--loss)', med: 'oklch(0.65 0.15 60)', ok: 'var(--gain)' }
  const sevBg    = { high: 'oklch(0.96 0.04 25)', med: 'oklch(0.96 0.06 80)', ok: 'oklch(0.95 0.04 160)' }
  const sevIcon  = { high: '!', med: '↻', ok: '✓' }

  return (
    <div className="shell-section">

      {/* ── Score card ── */}
      <div className="tbl-card" style={{ borderRadius: 18, marginBottom: 20, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '22px 24px 18px' }}>
          <ScoreRing score={composite} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 750, marginBottom: 5, color: 'var(--ink-1)' }}>{overallLabel}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55 }}>{overallSub}</div>
            {/* Grade pill summary */}
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {metrics.map(m => {
                const g = healthGrade(m.score)
                const p = { A: { bg: 'oklch(0.95 0.04 160)', txt: 'var(--gain)' }, B: { bg: 'oklch(0.96 0.06 80)', txt: 'oklch(0.55 0.15 60)' }, C: { bg: 'oklch(0.96 0.05 50)', txt: 'oklch(0.55 0.18 45)' }, D: { bg: 'oklch(0.96 0.04 25)', txt: 'var(--loss)' } }[g]
                return (
                  <span key={m.name} style={{ fontSize: 11, background: p.bg, color: p.txt, borderRadius: 6, padding: '2px 7px', fontWeight: 700 }}>
                    {m.icon} {g}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
        {/* colored accent bar at bottom */}
        <div style={{ height: 4, background: `linear-gradient(90deg, ${overallColor} ${composite}%, var(--line) ${composite}%)` }} />
      </div>

      {/* ── 6 metrics ── */}
      <div className="label-up" style={{ marginBottom: 10 }}>{th ? '6 มิติสุขภาพ' : '6 health dimensions'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 20 }}>
        {metrics.map(m => (
          <MetricCard key={m.name} icon={m.icon} name={m.name} grade={healthGrade(m.score)} detail={m.detail} barPct={m.score} />
        ))}
      </div>

      {/* ── Action items ── */}
      {actions.length > 0 && (
        <>
          <div className="label-up" style={{ marginBottom: 10 }}>{th ? 'สิ่งที่ควรทำ' : 'Recommended actions'}</div>
          <div className="tbl-card" style={{ borderRadius: 14, overflow: 'hidden' }}>
            {actions.map((a, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 14,
                padding: '14px 18px',
                borderBottom: i < actions.length - 1 ? '1px solid var(--line)' : 'none',
                borderLeft: `3px solid ${sevColor[a.sev]}`,
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: sevBg[a.sev], color: sevColor[a.sev],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800, flexShrink: 0, marginTop: 1,
                }}>
                  {sevIcon[a.sev]}
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>{a.text}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
