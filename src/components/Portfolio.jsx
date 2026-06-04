import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from 'react'
import { PageHead, Delta, Icon, TickerLogo, AllocCategoryIcon } from './Nav'
import { Sparkline } from './Charts'
import { LUMEN_FMT, LUMEN_DERIVE } from '../data'
import { addHolding, updateHolding, deleteHolding, deriveHoldings, addTransaction, syncHoldingsFromTransactions, rebuildHolding, rebuildAllHoldings, updateHoldingMeta, getTransactions, getAllTransactions, computeRealized, updateTransaction, deleteTransaction, deleteTransactionsByTicker, applySplit, upsertCashAccount, deleteCashAccount } from '../lib/db'
import { fetchSplits, toYahooSymbol, fetchHistory } from '../lib/prices'
import { computeTA } from '../lib/ta'
import { AiAnalysisModal } from './AiModal'
import { useAiAnalysis } from '../lib/useAiAnalysis'
import { TradingViewChart } from './TradingViewChart'
import { CalcInput } from './CalcInput'

export function PortfolioPage({ t, lang, ccy, setRoute, dataState, portfolio, liveHoldings = [], prices = {}, refreshHoldings, loadingData, dataError, retryLoad, fxRate = 36, cashAccounts = [], refreshCashAccounts, session }) {
  const [showAdd, setShowAdd] = useState(false)
  const th = lang === "th"

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (dataState === "empty") {
    return (
      <div className="shell fade-in">
        <PageHead title={t.portfolio.heading} sub={t.portfolio.sub} />
        <div className="card empty">
          <h2 className="display" style={{ fontSize: 28, margin: 0 }}>
            {th ? "ยังไม่มีหลักทรัพย์" : "Looks like it's empty"}
          </h2>
          <p style={{ marginTop: 8 }}>{th ? "เพิ่มหลักทรัพย์เพื่อเริ่มต้น" : "Add a holding to get started"}</p>
          <button className="btn" style={{ marginTop: 20 }} onClick={() => setRoute("onboarding")}>
            <Icon name="plus" size={14} /> {t.common.addInvestment}
          </button>
        </div>
      </div>
    )
  }

  // ── Live mode (Supabase) ─────────────────────────────────────────────────────
  if (dataState === "live") {
    if (dataError) {
      return (
        <div className="shell fade-in">
          <PageHead title={t.portfolio.heading} sub={t.portfolio.sub} />
          <div className="card" style={{ padding: 32, background: "oklch(0.97 0.02 25)" }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: "oklch(0.40 0.12 25)" }}>
              {th ? "เชื่อมต่อฐานข้อมูลไม่ได้" : "Database connection error"}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", fontFamily: "monospace", marginBottom: 16, wordBreak: "break-all" }}>
              {dataError}
            </div>
            <button className="btn btn-sm" onClick={retryLoad}>
              {th ? "ลองใหม่" : "Retry"}
            </button>
          </div>
        </div>
      )
    }
    return (
      <LivePortfolioPage
        t={t} lang={lang} ccy={ccy}
        portfolio={portfolio}
        liveHoldings={liveHoldings}
        prices={prices}
        refreshHoldings={refreshHoldings}
        loadingData={loadingData}
        showAdd={showAdd}
        setShowAdd={setShowAdd}
        fxRate={fxRate}
        cashAccounts={cashAccounts}
        refreshCashAccounts={refreshCashAccounts}
        session={session}
      />
    )
  }

  // ── Demo mode ────────────────────────────────────────────────────────────────
  return <DemoPortfolioPage t={t} lang={lang} ccy={ccy} setRoute={setRoute} setShowAdd={setShowAdd} />
}

// ─── Live Portfolio ──────────────────────────────────────────────────────────
function LivePortfolioPage({ t, lang, ccy, portfolio, liveHoldings, prices = {}, refreshHoldings, loadingData, showAdd, setShowAdd, fxRate = 36, cashAccounts = [], refreshCashAccounts, session }) {
  const th = lang === "th"
  const [tab, setTab] = useState("holdings")
  const [deleting, setDeleting] = useState(null)
  const [editHolding, setEditHolding] = useState(null)
  const [sellHolding, setSellHolding] = useState(null)
  const [sortKey, setSortKey] = useState("value")
  const [sortDir, setSortDir] = useState("desc")
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState("all")
  const [transactions, setTransactions] = useState([])
  const [txLoading, setTxLoading] = useState(false)
  const [realized, setRealized] = useState({ total: 0, byTicker: {}, byYear: {}, sales: [] })
  const [showRealized, setShowRealized] = useState(false)
  const [splitModal, setSplitModal] = useState(null)   // null | 'loading' | suggestion[]
  const [splitApplying, setSplitApplying] = useState(false)
  // ── AI per-holding analysis (optional — hides when /api/analyze 503s) ──
  const ai = useAiAnalysis()
  const [aiAvailable, setAiAvailable] = useState(false)
  useEffect(() => {
    fetch('/api/analyze').then(r => r.json()).then(j => setAiAvailable(!!j?.available)).catch(() => setAiAvailable(false))
  }, [])
  // ── Investment journal — notes attached to a holding ─────────────────────
  const [notesHolding, setNotesHolding] = useState(null)   // raw holding row when notes modal is open
  // ── TradingView chart modal (free widget, no API key) ────────────────────
  const [chartHolding, setChartHolding] = useState(null)

  // Realized P/L — recompute from all transactions whenever holdings change
  useEffect(() => {
    if (!portfolio?.id) { setRealized({ total: 0, byTicker: {} }); return }
    let cancelled = false
    getAllTransactions(portfolio.id)
      .then(txs => { if (!cancelled) setRealized(computeRealized(txs, fxRate)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [portfolio?.id, liveHoldings, fxRate])

  const loadTransactions = useCallback(async () => {
    if (!portfolio?.id) return
    setTxLoading(true)
    try {
      const data = await getAllTransactions(portfolio.id)   // full history
      setTransactions([...data].reverse())                  // newest first
    } catch (err) {
      console.error('[Lumen] loadTransactions:', err)
    } finally {
      setTxLoading(false)
    }
  }, [portfolio?.id])

  useEffect(() => {
    if (tab === "transactions") loadTransactions()
  }, [tab, loadTransactions])

  const rows = useMemo(() => deriveHoldings(liveHoldings, ccy, prices, fxRate), [liveHoldings, ccy, prices, fxRate])

  // Real 30-day sparkline data: last month of daily closes per ticker from Yahoo
  const [spark30, setSpark30] = useState({})  // { TICKER: { data: number[], ret: pct } }
  useEffect(() => {
    if (!liveHoldings.length) { setSpark30({}); return }
    let cancelled = false
    const seen = new Set(), uniq = []
    liveHoldings.forEach(h => {
      const sym = toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity')
      if (!seen.has(sym)) { seen.add(sym); uniq.push({ ticker: h.ticker.toUpperCase(), sym }) }
    })
    ;(async () => {
      const out = {}
      await Promise.all(uniq.map(async ({ ticker, sym }) => {
        const h = await fetchHistory(sym, '1mo').catch(() => null)
        const closes = (h?.series || []).map(p => p.c).filter(c => Number.isFinite(c))
        if (closes.length >= 2) out[ticker] = { data: closes, ret: (closes[closes.length - 1] / closes[0] - 1) * 100 }
      }))
      if (!cancelled) setSpark30(out)
    })()
    return () => { cancelled = true }
  }, [liveHoldings])

  // Rows in the current region/class view — the summary reflects the active
  // filter chip (search is applied only to the table below, not the totals).
  const viewRows = useMemo(() => {
    if (filter === "all") return rows
    return rows.filter(r =>
      filter === "TH"     ? r.region === "TH"  :
      filter === "US"     ? (r.region === "US" && r.cls !== "Crypto") :
      filter === "ETF"    ? r.cls === "ETF"    :
      filter === "Bond"   ? r.cls === "Bond"   :
      filter === "Crypto" ? r.cls === "Crypto" : true)
  }, [rows, filter])

  const totalValue     = viewRows.reduce((s, r) => s + r.value, 0)
  const totalPL        = viewRows.reduce((s, r) => s + r.pl, 0)
  const totalCostBasis = totalValue - totalPL
  const totalPlPct     = totalCostBasis > 0 ? (totalPL / totalCostBasis) * 100 : 0
  const hasLivePrices  = viewRows.some(r => r.hasLivePrice)
  const annualDiv      = viewRows.reduce((s, r) => s + r.value * (r.divYield || 0) / 100, 0)
  const largestPos     = viewRows.length > 0 ? [...viewRows].sort((a, b) => b.value - a.value)[0] : null

  // Realized P/L for the current view (all sales when unfiltered). Sum from the
  // sales list — not from current holdings — so fully-sold positions still count.
  const realizedShown = useMemo(() => {
    if (filter === "all") return realized.total
    const sales = realized.sales || []
    if (filter === "US" || filter === "TH") {
      const wantUSD = filter === "US"
      return sales.reduce((s, x) => ((x.currency === "USD") === wantUSD ? s + x.gainTHB : s), 0)
    }
    // Class filters (ETF/Bond/Crypto): fall back to tickers in the current view.
    const set = new Set(viewRows.map(r => r.ticker.toUpperCase()))
    return sales.reduce((s, x) => (set.has(x.ticker) ? s + x.gainTHB : s), 0)
  }, [filter, viewRows, realized])

  // All positions merged — used for filter counts and footer total
  const allGrouped = useMemo(() => groupByTicker(rows), [rows])

  // Filter chip definitions — counts based on merged positions, not raw lots
  const filterDefs = useMemo(() => [
    { id: "all",    label: th ? "ทั้งหมด" : "All",       count: allGrouped.length },
    { id: "TH",     label: th ? "หุ้นไทย" : "TH",        count: allGrouped.filter(r => r.region === "TH").length },
    { id: "US",     label: th ? "หุ้น US" : "US",        count: allGrouped.filter(r => r.region === "US" && r.cls !== "Crypto").length },
    { id: "ETF",    label: "ETF",                         count: allGrouped.filter(r => r.cls === "ETF").length },
    { id: "Bond",   label: th ? "พันธบัตร" : "Bonds",    count: allGrouped.filter(r => r.cls === "Bond").length },
    { id: "Crypto", label: th ? "คริปโต" : "Crypto",     count: allGrouped.filter(r => r.cls === "Crypto").length },
  ].filter(f => f.id === "all" || f.count > 0), [allGrouped, th])

  const grouped = useMemo(() => {
    let list = rows
    if (filter !== "all") list = list.filter(r => {
      if (filter === "TH")     return r.region === "TH"
      if (filter === "US")     return r.region === "US" && r.cls !== "Crypto"
      if (filter === "ETF")    return r.cls === "ETF"
      if (filter === "Bond")   return r.cls === "Bond"
      if (filter === "Crypto") return r.cls === "Crypto"
      return true
    })
    if (q) list = list.filter(r => (r.ticker + r.name).toLowerCase().includes(q.toLowerCase()))
    const g = groupByTicker(list)
    return [...g].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      const cmp = typeof av === "string" ? av.localeCompare(bv) : (av - bv)
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [rows, filter, sortKey, sortDir, q])

  const setSort = k => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(k); setSortDir("desc") }
  }

  const handleDelete = async (ids, ticker = '') => {
    const idArr = Array.isArray(ids) ? ids : [ids]
    const msg = th
      ? `ลบ ${ticker} และ Transactions ทั้งหมดของ ${ticker}?\n\nรายการซื้อ/ขาย/ปันผลของ ${ticker} จะถูกลบด้วย`
      : `Delete ${ticker} and all its transactions?\n\nAll Buy/Sell/Dividend records for ${ticker} will also be removed.`
    if (!window.confirm(msg)) return
    setDeleting(idArr[0])
    for (const id of idArr) await deleteHolding(id)
    if (ticker && portfolio?.id) {
      await deleteTransactionsByTicker(portfolio.id, ticker)
    }
    setDeleting(null)
    await refreshHoldings()
  }

  const [syncing, setSyncing] = useState(false)
  const handleSync = async () => {
    if (!portfolio?.id) return
    const ok = window.confirm(th
      ? "สร้าง Holdings ใหม่จากประวัติธุรกรรมทั้งหมด เพื่อให้ตรงกัน?\n\n• จำนวนหุ้น/ต้นทุนจะคำนวณใหม่จากรายการซื้อ-ขาย\n• ตำแหน่งที่ขายหมดจะถูกลบ\n(ข้อมูล region/ชื่อ ที่ตั้งไว้จะคงอยู่)"
      : "Rebuild all Holdings from your full transaction history so they match?\n\n• Shares/cost recomputed from buys & sells\n• Fully-sold positions are removed\n(region/name metadata is kept)")
    if (!ok) return
    setSyncing(true)
    const r = await rebuildAllHoldings(portfolio.id)
    await refreshHoldings()
    setSyncing(false)
    const summary = th
      ? `ซิงค์เสร็จ — อัปเดต ${r.updated} · เพิ่ม ${r.created} · ลบ ${r.removed}`
      : `Synced — updated ${r.updated} · created ${r.created} · removed ${r.removed}`
    const orphanNote = r.orphans?.length
      ? (th ? `\n\n⚠ ไม่มีธุรกรรมรองรับ (ไม่แตะต้อง): ${r.orphans.join(', ')}` : `\n\n⚠ No transactions found (left as-is): ${r.orphans.join(', ')}`)
      : ''
    window.alert((r.error ? (th ? "มีข้อผิดพลาดบางส่วน: " : "Some errors: ") + r.error + "\n\n" : "") + summary + orphanNote)
  }

  // ── Auto-detect stock splits from Yahoo and suggest restating old trades ──
  // ── Send one specific holding to AI, with the full stocks context ─────
  const [preparingAi, setPreparingAi] = useState(false)
  const analyzeHolding = async (r) => {
    if (preparingAi || ai.loading) return
    setPreparingAi(true)
    const stocksTotal = rows.reduce((s, x) => s + (Number(x.value) || 0), 0)
    const allStocks = rows.map(x => ({
      ticker: x.ticker, region: x.region, cls: x.cls,
      valueTHB: Math.round(x.value),
      pctOfStocks: stocksTotal > 0 ? +((x.value / stocksTotal) * 100).toFixed(1) : 0,
      plPct: Number.isFinite(x.plPct) ? +x.plPct.toFixed(1) : null,
      divYield: +Number(x.divYield || 0).toFixed(2),
    }))
    const holding = {
      ticker: r.ticker,
      name: r.name || r.ticker,
      region: r.region,
      cls: r.cls,
      shares: r.shares,
      costNative: r.costNative,
      priceNative: r.priceNative,
      nativeCcy: r.nativeCcy,
      valueTHB: Math.round(r.value),
      costTHB: Math.round(r.value - (Number(r.pl) || 0)),
      plTHB: Math.round(Number(r.pl) || 0),
      plPct: Number.isFinite(r.plPct) ? +r.plPct.toFixed(1) : null,
      pctOfStocks: stocksTotal > 0 ? +((r.value / stocksTotal) * 100).toFixed(1) : 0,
      divYield: +Number(r.divYield || 0).toFixed(2),
      changePct: Number.isFinite(r.changePct) ? +r.changePct.toFixed(2) : null,
    }
    // Enrich with fundamentals (Yahoo quoteSummary) + computed TA so the AI
    // can reference real financial figures and price levels, not just guess.
    const sym = toYahooSymbol(r.ticker, r.region || 'TH', r.cls || 'Equity')
    const [fundRes, histRes] = await Promise.allSettled([
      fetch(`/api/fundamentals?symbol=${encodeURIComponent(sym)}`).then(res => res.ok ? res.json() : null).catch(() => null),
      fetchHistory(sym, '1y').catch(() => null),
    ])
    const fundamentals = fundRes.status === 'fulfilled' ? fundRes.value : null
    const ta = histRes.status === 'fulfilled' ? computeTA(histRes.value?.series || []) : null
    setPreparingAi(false)
    ai.run({
      lang,
      kind: 'holding',
      holding,
      fundamentals: fundamentals && Object.keys(fundamentals).length ? fundamentals : null,
      ta,
      portfolio: {
        counts: {
          stocksTotal: allStocks.length,
          stocksTH: allStocks.filter(s => s.region === 'TH').length,
          stocksUS: allStocks.filter(s => s.region !== 'TH').length,
        },
        totals: { stocksTHB: Math.round(stocksTotal) },
        stocks: allStocks,
      },
    })
  }

  const handleCheckSplits = async () => {
    if (!portfolio?.id) return
    setSplitModal('loading')
    try {
      const txs = await getAllTransactions(portfolio.id)
      const earliestBuy = {}
      txs.forEach(tx => {
        if (tx.type === 'Buy' && tx.ticker && tx.transacted_at) {
          const k = tx.ticker.toUpperCase(), t = new Date(tx.transacted_at).getTime()
          if (!(k in earliestBuy) || t < earliestBuy[k]) earliestBuy[k] = t
        }
      })
      const symByTicker = {}
      liveHoldings.forEach(h => { symByTicker[h.ticker.toUpperCase()] = toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity') })
      const splitsData = await fetchSplits(Object.values(symByTicker))
      const suggestions = []
      liveHoldings.forEach(h => {
        const tk = h.ticker.toUpperCase()
        const firstBuy = earliestBuy[tk]
        if (firstBuy == null) return
        ;(splitsData[symByTicker[tk]] || []).forEach(ev => {
          const evMs = ev.date * 1000
          if (evMs <= firstBuy) return   // bought after split → Yahoo already adjusted
          const affected = txs.filter(tx =>
            (tx.ticker || '').toUpperCase() === tk &&
            (tx.type === 'Buy' || tx.type === 'Sell') &&
            tx.transacted_at && new Date(tx.transacted_at).getTime() < evMs).length
          if (affected === 0) return
          suggestions.push({
            ticker: tk, region: h.region, cls: h.asset_class, logo_url: h.logo_url,
            ratio: ev.ratio, numerator: ev.numerator, denominator: ev.denominator,
            dateISO: new Date(evMs).toISOString().slice(0, 10), affected, checked: true,
          })
        })
      })
      suggestions.sort((a, b) => a.dateISO.localeCompare(b.dateISO))
      setSplitModal(suggestions)
    } catch (e) {
      console.error('[Lumen] checkSplits:', e)
      setSplitModal([])
    }
  }

  const handleApplySplits = async (items) => {
    setSplitApplying(true)
    try {
      for (const s of items.filter(x => x.checked)) {
        await applySplit(portfolio.id, s.ticker, s.ratio, s.dateISO)
      }
      await refreshHoldings()
      await loadTransactions()
    } catch (e) {
      console.error('[Lumen] applySplits:', e)
    } finally {
      setSplitApplying(false)
      setSplitModal(null)
    }
  }

  if (loadingData) {
    return (
      <div className="shell fade-in">
        <PageHead title={t.portfolio.heading} sub={t.portfolio.sub} />
        <div style={{ padding: 48, textAlign: "center", color: "var(--ink-3)", fontSize: 14 }}>
          {th ? "กำลังโหลด…" : "Loading…"}
        </div>
      </div>
    )
  }

  return (
    <div className="shell fade-in" data-screen-label="Portfolio">
      <PageHead
        title={t.portfolio.heading}
        sub={t.portfolio.sub}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-sm btn-outline" onClick={handleCheckSplits} disabled={splitModal === 'loading'}
                    title={th ? "ตรวจหาการแตกพาร์ (split) จาก Yahoo แล้วปรับธุรกรรมเก่า" : "Detect stock splits from Yahoo and restate old trades"}>
              <Icon name="refresh" size={14} /> {splitModal === 'loading' ? (th ? "กำลังตรวจ…" : "Checking…") : (th ? "ตรวจ Split" : "Splits")}
            </button>
            <button className="btn btn-sm btn-outline" onClick={handleSync} disabled={syncing}
                    title={th ? "สร้าง holdings ใหม่จากประวัติธุรกรรมทั้งหมด" : "Rebuild all holdings from transaction history"}>
              <Icon name="filter" size={14} /> {syncing ? (th ? "กำลังซิงค์…" : "Syncing…") : (th ? "ตรวจสอบ & ซิงค์" : "Reconcile")}
            </button>
            <button className="btn btn-sm" onClick={() => setShowAdd(true)}>
              <Icon name="plus" size={14} /> {t.common.addInvestment}
            </button>
          </div>
        }
      />

      {/* Tab switcher */}
      <div className="segmented" style={{ marginBottom: 16, width: "fit-content" }}>
        <button className={tab === "holdings" ? "on" : ""} onClick={() => setTab("holdings")}>
          {th ? "หลักทรัพย์" : "Holdings"} {allGrouped.length > 0 && <span style={{ opacity: 0.6, marginLeft: 4 }}>{allGrouped.length}</span>}
        </button>
        <button className={tab === "cash" ? "on" : ""} onClick={() => setTab("cash")}>
          {th ? "เงินสด" : "Cash"} {cashAccounts.length > 0 && <span style={{ opacity: 0.6, marginLeft: 4 }}>{cashAccounts.length}</span>}
        </button>
        <button className={tab === "categories" ? "on" : ""} onClick={() => setTab("categories")}>
          {th ? "หมวดหมู่" : "Categories"}
        </button>
        <button className={tab === "transactions" ? "on" : ""} onClick={() => setTab("transactions")}>
          {th ? "ธุรกรรม" : "Transactions"}
        </button>
      </div>

      {tab === "transactions" ? (
        <TransactionsTab transactions={transactions} holdings={liveHoldings} loading={txLoading} lang={lang} ccy={ccy} fxRate={fxRate} onReload={async () => { await loadTransactions(); await refreshHoldings?.() }} portfolioId={portfolio?.id} />
      ) : tab === "cash" ? (
        <CashTab lang={lang} ccy={ccy} portfolioId={portfolio?.id} cashAccounts={cashAccounts} refreshCashAccounts={refreshCashAccounts} fxRate={fxRate} />
      ) : tab === "categories" ? (
        <CategoriesTab rows={rows} lang={lang} ccy={ccy} fxRate={fxRate} />
      ) : rows.length === 0 ? (
        <div className="card empty">
          <h2 className="display" style={{ fontSize: 28, margin: 0 }}>
            {th ? "ยังไม่มีหลักทรัพย์" : "No holdings yet"}
          </h2>
          <p style={{ marginTop: 8 }}>
            {th ? "กดปุ่มด้านบนเพื่อเพิ่มหลักทรัพย์แรก" : "Click the button above to add your first holding"}
          </p>
          <button className="btn" style={{ marginTop: 20 }} onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={14} /> {t.common.addInvestment}
          </button>
        </div>
      ) : (
        <>
          {/* ── Summary card — 5-column PortMetric layout matching demo ── */}
          <section className="card" style={{ padding: "24px 28px", marginBottom: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 24, alignItems: "center" }}>
              <div>
                <div className="label-up" style={{ marginBottom: 6 }}>
                  {t.portfolio.total}
                  {hasLivePrices && <span style={{ marginLeft: 6, color: "var(--gain)", fontWeight: 700 }}>● LIVE</span>}
                </div>
                <div className="display" style={{ fontSize: 36, lineHeight: 1 }}>{LUMEN_FMT.money(totalValue, ccy)}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {grouped.length} {th ? "ตำแหน่ง · หลายหมวด" : "positions · asset classes"}
                </div>
              </div>
              <PortMetric
                label={th ? "กำไร/ขาดทุน รวม" : "Unrealized P/L"}
                value={(totalPL >= 0 ? "+" : "") + LUMEN_FMT.money(totalPL, ccy, { compact: true })}
                sub={<Delta value={totalPlPct} />}
              />
              {realizedShown !== 0 && (
                <PortMetric
                  label={th ? "กำไร/ขาดทุนที่รับรู้" : "Realized P/L"}
                  value={(realizedShown >= 0 ? "+" : "") + LUMEN_FMT.money(realizedShown, ccy, { compact: true })}
                  sub={<span className="muted" style={{ fontSize: 11 }}>{th ? "จากการขาย · ดูรายงาน" : "from sales · view report"}</span>}
                  onClick={() => setShowRealized(true)}
                />
              )}
              <PortMetric
                label={th ? "ปันผล/ปี (ประมาณ)" : "Est. annual dividends"}
                value={annualDiv > 0 ? LUMEN_FMT.money(annualDiv, ccy, { compact: true }) : "—"}
                sub={annualDiv > 0
                  ? <span className="mono">{(annualDiv / totalValue * 100).toFixed(2)}% yield</span>
                  : <span className="muted" style={{ fontSize: 11 }}>{th ? "ยังไม่มีปันผล" : "No dividends"}</span>}
              />
              <PortMetric
                label={th ? "ตัวใหญ่สุด" : "Largest position"}
                value={largestPos ? largestPos.ticker : "—"}
                sub={largestPos ? <span className="mono">{largestPos.weight.toFixed(1)}%</span> : null}
              />
              <PortMetric
                label={th ? "ต้นทุนรวม" : "Total cost basis"}
                value={LUMEN_FMT.money(totalCostBasis, ccy, { compact: true })}
                sub={<span className="mono" style={{ color: totalPlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>
                  {totalPlPct >= 0 ? "+" : ""}{totalPlPct.toFixed(1)}%
                </span>}
              />
            </div>
          </section>

          {/* ── Filter chips + Search — same row like demo ── */}
          <section style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {filterDefs.map(f => (
                <button key={f.id}
                  className={"chip " + (filter === f.id ? "chip-soft" : "")}
                  style={{ cursor: "pointer", padding: "6px 12px", fontSize: 12 }}
                  onClick={() => setFilter(f.id)}>
                  {f.label} <span style={{ opacity: 0.6, marginLeft: 4 }}>{f.count}</span>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 999, padding: "6px 14px", width: 240, flexShrink: 0 }}>
              <Icon name="search" size={14} />
              <input type="text" placeholder={t.common.search} value={q} onChange={e => setQ(e.target.value)}
                     style={{ border: 0, outline: 0, background: "transparent", flex: 1, fontSize: 13 }} />
            </div>
          </section>

          {/* ── Table ── */}
          <section className="card tbl-card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="table">
              <thead>
                <tr>
                  <SortHeader id="ticker" label={t.portfolio.holding} sortKey={sortKey} sortDir={sortDir} onSort={setSort} />
                  <SortHeader id="shares" label={t.portfolio.shares} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
                  <SortHeader id="value"  label={th ? "ต้นทุน" : "Cost"} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
                  <SortHeader id="value"  label={t.portfolio.value} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
                  <th className="num">{th ? "30 วัน" : "30d"}</th>
                  <SortHeader id="pl"     label={t.portfolio.pl} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
                  <SortHeader id="weight" label={t.portfolio.weight} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(r => {
                  const costBasis = r.value - r.pl
                  const sp = spark30[r.ticker?.toUpperCase()]
                  const sparkColor = (sp ? sp.ret : (r.changePct || r.plPct)) >= 0 ? "var(--gain)" : "var(--loss)"
                  return (
                    <tr key={r.ticker} style={{ opacity: deleting && r._ids.includes(deleting) ? 0.4 : 1 }}>
                      <td>
                        <div className="ticker">
                          <TickerLogo ticker={r.ticker} logoUrl={r.logo_url} cls={r.cls} region={r.region} />
                          <div>
                            <div style={{ fontWeight: 500 }}>{r.ticker}</div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {r.name}
                              {r.sector && r.sector !== "—" && (
                                <span style={{ marginLeft: 6, opacity: 0.6 }}>· {r.sector}</span>
                              )}
                              {r._lots > 1 && (
                                <span style={{ marginLeft: 6, fontSize: 10, background: "var(--accent-soft)", color: "var(--accent-ink)", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>
                                  {r._lots} lots
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="num">{r.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td className="num">{LUMEN_FMT.money(costBasis, ccy, { compact: true })}</td>
                      <td className="num">
                        <div style={{ fontWeight: 500 }}>{LUMEN_FMT.money(r.value, ccy, { compact: true })}</div>
                        {r.hasLivePrice && r.changePct !== 0 && (
                          <div style={{ fontSize: 11, color: r.changePct >= 0 ? "var(--gain)" : "var(--loss)" }}>
                            {r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(2)}%
                          </div>
                        )}
                        {!r.hasLivePrice && (
                          <div className="muted" style={{ fontSize: 11 }}>{th ? "รอราคา" : "pending"}</div>
                        )}
                      </td>
                      <td>{sp
                        ? <Sparkline data={sp.data} stroke={sparkColor} fill={sparkColor} />
                        : <span className="muted" style={{ fontSize: 12 }}>—</span>}</td>
                      <td className="num">
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                          <span style={{ color: r.pl >= 0 ? "var(--gain)" : "var(--loss)", fontWeight: 500 }}>
                            {r.pl >= 0 ? "+" : ""}{LUMEN_FMT.money(r.pl, ccy, { compact: true })}
                          </span>
                          <Delta value={r.plPct} size={11} />
                        </div>
                      </td>
                      <td className="num">
                        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                          <div className="bar" style={{ width: 50 }}>
                            <span style={{ width: Math.min(100, r.weight * 3) + "%", background: classFg(r.cls) }} />
                          </div>
                          <span style={{ minWidth: 36 }}>{r.weight.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                          <button
                            onClick={() => setChartHolding(r)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", padding: "4px 6px", borderRadius: 6, lineHeight: 1, display: "inline-flex", alignItems: "center" }}
                            title={th ? "ดูกราฟ (TradingView)" : "View chart (TradingView)"}
                          ><Icon name="chart" size={14} /></button>
                          {aiAvailable && (
                            <button
                              onClick={() => analyzeHolding(r)}
                              disabled={ai.loading || preparingAi}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent-ink)", padding: "4px 6px", borderRadius: 6, lineHeight: 1, display: "inline-flex", alignItems: "center", opacity: (ai.loading || preparingAi) ? 0.4 : 1 }}
                              title={th ? "วิเคราะห์ด้วย AI" : "Analyse with AI"}
                            ><Icon name="spark" size={14} /></button>
                          )}
                          {(() => {
                            const orig = liveHoldings.find(h => h.id === r._ids?.[0])
                            const hasNotes = !!(orig?.notes && orig.notes.trim())
                            return (
                              <button
                                onClick={() => orig && setNotesHolding({ ...orig, displayTicker: r.ticker, logo_url: r.logo_url, region: r.region, cls: r.cls })}
                                style={{ background: "none", border: "none", cursor: "pointer", color: hasNotes ? "var(--accent-ink)" : "var(--ink-4)", padding: "4px 6px", borderRadius: 6, lineHeight: 1, display: "inline-flex", alignItems: "center", position: "relative" }}
                                title={hasNotes ? (th ? "ดู/แก้ไขโน้ต" : "View/edit notes") : (th ? "เพิ่มโน้ต" : "Add notes")}
                              >
                                <Icon name="book" size={14} />
                                {hasNotes && <span style={{ position: "absolute", top: 3, right: 3, width: 5, height: 5, borderRadius: "50%", background: "var(--accent)" }} />}
                              </button>
                            )
                          })()}
                          <button
                            onClick={() => setSellHolding(r)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--loss)", padding: "4px 7px", borderRadius: 6, fontSize: 12, fontWeight: 600, lineHeight: 1 }}
                            title={th ? "ขาย" : "Sell"}
                          >{th ? "ขาย" : "Sell"}</button>
                          <button
                            onClick={() => { const orig = liveHoldings.find(h => h.id === r._ids[0]); if (orig) setEditHolding(orig) }}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", padding: "4px 7px", borderRadius: 6, fontSize: 15, lineHeight: 1 }}
                            title={th ? "แก้ไข" : "Edit"}
                          >✎</button>
                          <button
                            onClick={() => handleDelete(r._ids, r.ticker)}
                            disabled={!!(deleting && r._ids.includes(deleting))}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-4)", padding: "4px 6px", borderRadius: 6, fontSize: 17, lineHeight: 1 }}
                            title={th ? "ลบ" : "Delete"}
                          >×</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                <tr style={{ background: "var(--bg)", fontWeight: 500 }}>
                  <td style={{ paddingTop: 18, paddingBottom: 18 }}><span className="label-up">{t.portfolio.total}</span></td>
                  <td></td>
                  <td className="num">{LUMEN_FMT.money(totalCostBasis, ccy, { compact: true })}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{LUMEN_FMT.money(totalValue, ccy, { compact: true })}</td>
                  <td></td>
                  <td className="num">
                    <span style={{ color: totalPL >= 0 ? "var(--gain)" : "var(--loss)" }}>
                      {totalPL >= 0 ? "+" : ""}{LUMEN_FMT.money(totalPL, ccy, { compact: true })}
                    </span>
                  </td>
                  <td className="num">100.0%</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </section>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, color: "var(--ink-4)", fontSize: 12 }}>
            <span>{th ? `แสดง ${grouped.length} จาก ${allGrouped.length} ตำแหน่ง` : `Showing ${grouped.length} of ${allGrouped.length} positions`}</span>
            <span>{hasLivePrices
              ? (th ? "ราคาตลาดจาก Yahoo Finance · อัปเดตทุก 15 นาที" : "Market prices from Yahoo Finance · 15 min delay")
              : (th ? "กำลังโหลดราคาตลาด…" : "Fetching live market prices…")}</span>
          </div>
        </>
      )}

      {showAdd && (
        <AddHoldingModal
          lang={lang}
          portfolioId={portfolio?.id}
          onClose={() => setShowAdd(false)}
          onSaved={async () => { setShowAdd(false); await refreshHoldings() }}
        />
      )}
      {editHolding && (
        <EditHoldingModal
          lang={lang}
          holding={editHolding}
          onClose={() => setEditHolding(null)}
          onSaved={async () => { setEditHolding(null); await refreshHoldings() }}
        />
      )}
      {sellHolding && (
        <SellModal
          lang={lang}
          ccy={ccy}
          holding={sellHolding}
          portfolioId={portfolio?.id}
          onClose={() => setSellHolding(null)}
          onSaved={async () => { setSellHolding(null); await refreshHoldings() }}
        />
      )}
      {showRealized && (
        <RealizedModal lang={lang} ccy={ccy} realized={realized} onClose={() => setShowRealized(false)} />
      )}

      {ai.open && (
        <AiAnalysisModal th={th}
          title={th ? "วิเคราะห์รายตัวด้วย AI" : "AI per-holding analysis"}
          loading={ai.loading} error={ai.error} provider={ai.provider}
          history={ai.history} chatInput={ai.chatInput} chatLoading={ai.chatLoading}
          onChatInput={ai.setChatInput} onSend={ai.ask} canChat={ai.canChat}
          onClose={ai.close} onRetry={ai.retry} />
      )}

      {notesHolding && (
        <NotesModal th={th} holding={notesHolding}
          onClose={() => setNotesHolding(null)}
          onSaved={async () => { setNotesHolding(null); await refreshHoldings() }} />
      )}

      {chartHolding && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={e => e.target === e.currentTarget && setChartHolding(null)}>
          <div style={{ background: "var(--bg)", borderRadius: 18, padding: 20, width: "100%", maxWidth: 1000, maxHeight: "92vh", display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <TickerLogo ticker={chartHolding.ticker} logoUrl={chartHolding.logo_url} region={chartHolding.region} cls={chartHolding.cls} size={32} />
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{chartHolding.ticker} · {chartHolding.name}</h3>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {th ? "กราฟจาก" : "Chart by"} <span style={{ color: "var(--accent-ink)", fontWeight: 500 }}>TradingView</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setChartHolding(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "var(--ink-3)", padding: 4 }}>✕</button>
            </div>
            <TradingViewChart ticker={chartHolding.ticker} region={chartHolding.region} height={Math.min(560, window.innerHeight * 0.7)} />
            <p className="muted" style={{ margin: 0, fontSize: 10, textAlign: "center" }}>
              {th ? "กราฟ TradingView สำหรับการศึกษา · ไม่ใช่คำแนะนำการลงทุน" : "TradingView chart for education only · not investment advice"}
            </p>
          </div>
        </div>
      )}

      {splitModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget && !splitApplying) setSplitModal(null) }}>
          <div style={{ background: "var(--bg)", borderRadius: 18, padding: 28, width: "100%", maxWidth: 540, maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 18, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
            {splitModal === 'loading' ? (
              <div style={{ padding: "48px 0", textAlign: "center", opacity: 0.5, fontSize: 14 }}>
                {th ? "กำลังตรวจหาการแตกพาร์จาก Yahoo Finance…" : "Checking Yahoo Finance for splits…"}
              </div>
            ) : splitModal.length === 0 ? (
              <>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{th ? "ไม่พบ split ที่ต้องปรับ" : "No splits to apply"}</h3>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  {th ? "ไม่พบการแตกพาร์ที่เกิดหลังจากวันที่คุณซื้อ — ไม่ต้องปรับอะไร" : "No splits occurred after your purchase dates — nothing to restate."}
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button className="btn btn-outline" onClick={() => setSplitModal(null)}>{th ? "ปิด" : "Close"}</button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                    {th ? `พบการแตกพาร์ ${splitModal.length} รายการ` : `${splitModal.length} split${splitModal.length > 1 ? "s" : ""} found`}
                  </h3>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.5 }}>
                    {th
                      ? "ปรับธุรกรรมก่อนวัน split ให้เป็นหน่วยหลัง split (หุ้น×อัตรา, ราคา÷อัตรา) — ต้นทุนรวมไม่เปลี่ยน ⚠ ใช้เฉพาะถ้ายังไม่เคยปรับเอง"
                      : "Restates pre-split trades to post-split units (shares×ratio, price÷ratio) — cost basis unchanged. ⚠ Only apply if you haven't adjusted these manually."}
                  </p>
                </div>
                <div style={{ overflow: "auto", flex: 1, margin: "0 -4px", padding: "0 4px" }}>
                  {splitModal.map((s, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "20px 30px 1fr auto", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                      <input type="checkbox" checked={s.checked}
                        onChange={e => setSplitModal(prev => prev.map((p, j) => j === i ? { ...p, checked: e.target.checked } : p))}
                        style={{ width: 16, height: 16, cursor: "pointer", accentColor: "var(--accent)" }} />
                      <TickerLogo ticker={s.ticker} logoUrl={s.logo_url} region={s.region} cls={s.cls} size={28} />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>
                          {s.ticker} · {s.numerator}:{s.denominator} {th ? "แตกพาร์" : "split"}
                        </div>
                        <div className="muted" style={{ fontSize: 11 }}>{s.dateISO}</div>
                      </div>
                      <div className="mono muted" style={{ fontSize: 11, textAlign: "right" }}>
                        {s.affected} {th ? "รายการก่อนหน้า" : "trades"}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                  <button className="btn btn-outline" onClick={() => !splitApplying && setSplitModal(null)} disabled={splitApplying}>
                    {th ? "ยกเลิก" : "Cancel"}
                  </button>
                  <button className="btn" disabled={splitApplying || splitModal.every(s => !s.checked)} onClick={() => handleApplySplits(splitModal)}>
                    {splitApplying ? (th ? "กำลังปรับ…" : "Applying…") : (th ? `ปรับ ${splitModal.filter(s => s.checked).length} รายการ` : `Apply ${splitModal.filter(s => s.checked).length}`)}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sector options ──────────────────────────────────────────────────────────
const SECTORS = [
  { value: "",                  th: "— ไม่ระบุ —",          en: "— None —" },
  { value: "Technology",        th: "เทคโนโลยี",             en: "Technology" },
  { value: "Financial",         th: "การเงิน / ธนาคาร",     en: "Financial" },
  { value: "Healthcare",        th: "สุขภาพ / เวชภัณฑ์",    en: "Healthcare" },
  { value: "Consumer",          th: "สินค้าผู้บริโภค",       en: "Consumer" },
  { value: "Energy",            th: "พลังงาน",               en: "Energy" },
  { value: "Industrial",        th: "อุตสาหกรรม",           en: "Industrial" },
  { value: "Property",          th: "อสังหาริมทรัพย์",       en: "Property / REIT" },
  { value: "Communication",     th: "สื่อสาร / โทรคมนาคม",  en: "Communication" },
  { value: "Materials",         th: "วัสดุ / เคมี",          en: "Materials" },
  { value: "Utilities",         th: "สาธารณูปโภค",           en: "Utilities" },
  { value: "ETF / Fund",        th: "ETF / กองทุน",          en: "ETF / Fund" },
  { value: "Crypto",            th: "คริปโตเคอร์เรนซี",      en: "Crypto" },
  { value: "Other",             th: "อื่นๆ",                 en: "Other" },
]

// ─── Group holdings by ticker for aggregated display ────────────────────────
function groupByTicker(rows) {
  const map = new Map()
  rows.forEach(r => {
    if (!map.has(r.ticker)) {
      map.set(r.ticker, { ...r, _ids: [r.id], _lots: 1 })
    } else {
      const g = map.get(r.ticker)
      const totalShares = g.shares + r.shares
      const totalValue  = g.value + r.value
      const totalPL     = g.pl + r.pl
      const costBasis   = totalValue - totalPL
      map.set(r.ticker, {
        ...g,
        shares:      totalShares,
        cost:        (g.cost       * g.shares + r.cost       * r.shares) / totalShares,
        costNative:  (g.costNative * g.shares + r.costNative * r.shares) / totalShares,
        value:       totalValue,
        pl:          totalPL,
        plPct:       costBasis > 0 ? (totalPL / costBasis) * 100 : 0,
        _ids:        [...g._ids, r.id],
        _lots:       g._lots + 1,
      })
    }
  })
  const result = [...map.values()]
  const total  = result.reduce((s, r) => s + r.value, 0)
  return result.map(r => ({ ...r, weight: total > 0 ? (r.value / total) * 100 : 0 }))
}

// ─── Add Holding Modal ───────────────────────────────────────────────────────
function AddHoldingModal({ lang, portfolioId, onClose, onSaved }) {
  const th = lang === "th"
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    ticker: '', name: '', asset_class: 'Equity', region: 'TH',
    sector: '',
    shares: '', cost_price: '', currency: 'THB', div_yield: '', div_frequency: '2',
    fee: '', tax: '',
    purchased_at: today,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Auto-update frequency default when region changes (TH=2×, US=4×)
  const set = (k, v) => setForm(f => ({
    ...f,
    [k]: v,
    ...(k === 'region' ? { div_frequency: v === 'TH' ? '2' : '4' } : {}),
  }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!portfolioId) {
      setError(th ? 'ยังไม่ได้โหลด portfolio — ลองรีเฟรชหน้า' : 'Portfolio not loaded yet — please refresh the page')
      return
    }
    setSaving(true)
    setError(null)
    const shares = parseFloat(form.shares)
    const cost_price = parseFloat(form.cost_price)
    const fee = form.fee ? parseFloat(form.fee) : 0
    const tax = form.tax ? parseFloat(form.tax) : 0
    // Cost basis includes buy-side fee + tax (accounting standard)
    const costWithFees = shares > 0 ? cost_price + (fee + tax) / shares : cost_price
    const { data: newHolding, error: addErr } = await addHolding(portfolioId, {
      ticker: form.ticker.toUpperCase(),
      name: form.name,
      asset_class: form.asset_class,
      region: form.region,
      sector: form.sector || null,
      shares,
      cost_price: costWithFees,
      currency: form.currency,
      div_yield: form.div_yield ? parseFloat(form.div_yield) : 0,
      div_frequency: form.div_frequency ? parseInt(form.div_frequency) : 4,
    })
    setSaving(false)
    if (addErr) { setError(addErr.message); return }
    // Auto-log transaction with actual purchase date (price = raw per-share,
    // fee/tax kept separate so the cost basis stays reproducible)
    try {
      const txDate = form.purchased_at
        ? new Date(form.purchased_at).toISOString()
        : new Date().toISOString()
      await addTransaction(portfolioId, {
        type: 'Buy',
        ticker: form.ticker.toUpperCase(),
        shares,
        price: cost_price,
        amount: shares * cost_price,
        fee,
        tax,
        currency: form.currency,
        transacted_at: txDate,
        note: form.name,
      })
    } catch (txErr) {
      console.warn('[Lumen] transaction log failed:', txErr)
    }
    onSaved()
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      overflowY: "auto", padding: "24px 16px",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg)", borderRadius: 20, padding: "32px 28px 40px",
        width: "100%", maxWidth: 560, margin: "auto",
        boxShadow: "0 8px 48px rgba(0,0,0,0.18)", maxHeight: "calc(100dvh - 48px)", overflowY: "auto",
        animation: "fadeIn 0.18s ease",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontFamily: "var(--font-display)" }}>
            {th ? "เพิ่มหลักทรัพย์" : "Add Holding"}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-3)", lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "oklch(0.96 0.05 25)", color: "oklch(0.40 0.12 25)", fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Ticker search autocomplete */}
          <Field label={th ? "ค้นหาหลักทรัพย์" : "Search stock / ETF / Crypto"}>
            <TickerSearch
              lang={lang}
              value={form.ticker}
              onType={v => set('ticker', v.toUpperCase())}
              onSelect={({ ticker, name, region, asset_class, currency, div_frequency }) =>
                setForm(f => ({ ...f, ticker, name, region, asset_class, currency, div_frequency }))
              }
            />
          </Field>

          {/* Name (auto-filled by search, or type manually) */}
          <Field label={th ? "ชื่อหลักทรัพย์" : "Name"}>
            <input required value={form.name} onChange={e => set('name', e.target.value)}
                   placeholder={th ? "ชื่อเต็ม (กรอกเองหรือเลือกจากรายการ)" : "Full name (auto-filled or type manually)"} style={inputStyle} />
          </Field>

          {/* Asset Class + Region */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "ประเภทสินทรัพย์" : "Asset Class"}>
              <select value={form.asset_class} onChange={e => set('asset_class', e.target.value)} style={inputStyle}>
                <option value="Equity">{th ? "หุ้น (Equity)" : "Equity"}</option>
                <option value="ETF">ETF</option>
                <option value="Bond">{th ? "พันธบัตร" : "Bond"}</option>
                <option value="Crypto">{th ? "คริปโต" : "Crypto"}</option>
                <option value="Commodity">{th ? "สินค้าโภคภัณฑ์" : "Commodity"}</option>
              </select>
            </Field>
            <Field label={th ? "ตลาด" : "Region"}>
              <select value={form.region} onChange={e => set('region', e.target.value)} style={inputStyle}>
                <option value="TH">{th ? "ไทย (SET)" : "Thailand (SET)"}</option>
                <option value="US">{th ? "สหรัฐ (NYSE/NASDAQ)" : "US (NYSE/NASDAQ)"}</option>
                <option value="Other">{th ? "อื่นๆ" : "Other"}</option>
              </select>
            </Field>
          </div>

          {/* Sector */}
          <Field label={th ? "กลุ่มอุตสาหกรรม (Sector)" : "Sector (optional)"}>
            <select value={form.sector} onChange={e => set('sector', e.target.value)} style={inputStyle}>
              {SECTORS.map(s => (
                <option key={s.value} value={s.value}>{th ? s.th : s.en}</option>
              ))}
            </select>
          </Field>

          {/* Shares + Cost + Currency */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: 12 }}>
            <Field label={th ? "จำนวนหุ้น" : "Shares"}>
              <CalcInput required value={form.shares}
                     onChange={e => set('shares', e.target.value)}
                     placeholder="0" style={inputStyle} />
            </Field>
            <Field label={th ? "ราคาทุน/หุ้น" : "Cost price/share"}>
              <CalcInput required value={form.cost_price}
                     onChange={e => set('cost_price', e.target.value)}
                     placeholder="0.00" style={inputStyle} />
            </Field>
            <Field label={th ? "สกุล" : "Ccy"}>
              <select value={form.currency} onChange={e => set('currency', e.target.value)} style={inputStyle}>
                <option value="THB">THB</option>
                <option value="USD">USD</option>
              </select>
            </Field>
          </div>

          {/* Dividend yield + Frequency */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "อัตราปันผล % (ไม่บังคับ)" : "Dividend yield % (optional)"}>
              <CalcInput value={form.div_yield}
                     onChange={e => set('div_yield', e.target.value)}
                     placeholder="0.00" style={inputStyle} />
            </Field>
            <Field label={th ? "จ่ายปีละ (ครั้ง)" : "Payments / year"}>
              <select value={form.div_frequency} onChange={e => set('div_frequency', e.target.value)} style={inputStyle}>
                <option value="1">{th ? "1× — รายปี" : "1× — Annual"}</option>
                <option value="2">{th ? "2× — ราย 6 เดือน" : "2× — Semi-annual"}</option>
                <option value="4">{th ? "4× — รายไตรมาส" : "4× — Quarterly"}</option>
                <option value="12">{th ? "12× — รายเดือน" : "12× — Monthly"}</option>
              </select>
            </Field>
          </div>

          {/* Fee + Tax */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "ค่าธรรมเนียม (ไม่บังคับ)" : "Fee (optional)"}>
              <CalcInput value={form.fee}
                     onChange={e => set('fee', e.target.value)}
                     placeholder="0.00" style={inputStyle} />
            </Field>
            <Field label={th ? "ภาษี / อากร (ไม่บังคับ)" : "Tax / Duty (optional)"}>
              <CalcInput value={form.tax}
                     onChange={e => set('tax', e.target.value)}
                     placeholder="0.00" style={inputStyle} />
            </Field>
          </div>

          {/* Purchase date — custom selector avoids OS locale issues */}
          <DateSelectField
            label={th ? "วันที่ซื้อ" : "Purchase date"}
            value={form.purchased_at}
            onChange={v => set('purchased_at', v)}
            lang={lang}
          />

          <div style={{ display: "flex", gap: 10, marginTop: 8, position: "sticky", bottom: 0, background: "var(--bg)", paddingTop: 14, paddingBottom: 2 }}>
            <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
              {th ? "ยกเลิก" : "Cancel"}
            </button>
            <button type="submit" className="btn" style={{ flex: 2 }} disabled={saving}>
              {saving ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "บันทึก" : "Save holding")}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Edit Holding Modal ──────────────────────────────────────────────────────
function EditHoldingModal({ lang, holding, onClose, onSaved }) {
  const th = lang === "th"
  const [form, setForm] = useState({
    ticker:      holding.ticker,
    name:        holding.name,
    asset_class: holding.asset_class || 'Equity',
    region:      holding.region || 'TH',
    sector:      holding.sector || '',
    shares:      String(holding.shares),
    cost_price:  String(holding.cost_price),
    currency:      holding.currency || 'THB',
    div_yield:     String(holding.div_yield || ''),
    div_frequency: String(holding.div_frequency || (holding.region === 'TH' ? 2 : 4)),
    logo_url:      holding.logo_url || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const { error: updateErr } = await updateHolding(holding.id, {
      ticker:      form.ticker.toUpperCase(),
      name:        form.name,
      asset_class: form.asset_class,
      region:      form.region,
      sector:      form.sector || null,
      shares:      parseFloat(form.shares),
      cost_price:  parseFloat(form.cost_price),
      currency:    form.currency,
      div_yield:     form.div_yield ? parseFloat(form.div_yield) : 0,
      div_frequency: form.div_frequency ? parseInt(form.div_frequency) : 4,
      logo_url:      form.logo_url?.trim() || null,
    })
    setSaving(false)
    if (updateErr) { setError(updateErr.message); return }
    onSaved()
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      overflowY: "auto", padding: "24px 16px",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg)", borderRadius: 20, padding: "32px 28px 40px",
        width: "100%", maxWidth: 560, margin: "auto",
        boxShadow: "0 8px 48px rgba(0,0,0,0.18)", maxHeight: "calc(100dvh - 48px)", overflowY: "auto",
        animation: "fadeIn 0.18s ease",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontFamily: "var(--font-display)" }}>
            {th ? `แก้ไข ${holding.ticker}` : `Edit ${holding.ticker}`}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-3)", lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "oklch(0.96 0.05 25)", color: "oklch(0.40 0.12 25)", fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Ticker + Name */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <Field label={th ? "ติ๊กเกอร์" : "Ticker"}>
              <input required value={form.ticker} onChange={e => set('ticker', e.target.value)}
                     placeholder="e.g. PTT" style={inputStyle} />
            </Field>
            <Field label={th ? "ชื่อ" : "Name"}>
              <input required value={form.name} onChange={e => set('name', e.target.value)} style={inputStyle} />
            </Field>
          </div>

          {/* Asset Class + Region */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "ประเภทสินทรัพย์" : "Asset Class"}>
              <select value={form.asset_class} onChange={e => set('asset_class', e.target.value)} style={inputStyle}>
                <option value="Equity">{th ? "หุ้น (Equity)" : "Equity"}</option>
                <option value="ETF">ETF</option>
                <option value="Bond">{th ? "พันธบัตร" : "Bond"}</option>
                <option value="Crypto">{th ? "คริปโต" : "Crypto"}</option>
                <option value="Commodity">{th ? "สินค้าโภคภัณฑ์" : "Commodity"}</option>
              </select>
            </Field>
            <Field label={th ? "ตลาด" : "Region"}>
              <select value={form.region} onChange={e => set('region', e.target.value)} style={inputStyle}>
                <option value="TH">{th ? "ไทย (SET)" : "Thailand (SET)"}</option>
                <option value="US">{th ? "สหรัฐ (NYSE/NASDAQ)" : "US (NYSE/NASDAQ)"}</option>
                <option value="Other">{th ? "อื่นๆ" : "Other"}</option>
              </select>
            </Field>
          </div>

          {/* Sector */}
          <Field label={th ? "กลุ่มอุตสาหกรรม (Sector)" : "Sector (optional)"}>
            <select value={form.sector} onChange={e => set('sector', e.target.value)} style={inputStyle}>
              {SECTORS.map(s => (
                <option key={s.value} value={s.value}>{th ? s.th : s.en}</option>
              ))}
            </select>
          </Field>

          {/* Shares + Cost + Currency */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: 12 }}>
            <Field label={th ? "จำนวนหุ้น" : "Shares"}>
              <CalcInput required value={form.shares}
                     onChange={e => set('shares', e.target.value)} placeholder="0" style={inputStyle} />
            </Field>
            <Field label={th ? "ราคาทุน/หุ้น" : "Cost price/share"}>
              <CalcInput required value={form.cost_price}
                     onChange={e => set('cost_price', e.target.value)} placeholder="0.00" style={inputStyle} />
            </Field>
            <Field label={th ? "สกุล" : "Ccy"}>
              <select value={form.currency} onChange={e => set('currency', e.target.value)} style={inputStyle}>
                <option value="THB">THB</option>
                <option value="USD">USD</option>
              </select>
            </Field>
          </div>

          {/* Dividend yield + Frequency */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "อัตราปันผล % (ไม่บังคับ)" : "Dividend yield % (optional)"}>
              <CalcInput value={form.div_yield}
                     onChange={e => set('div_yield', e.target.value)}
                     placeholder="0.00" style={inputStyle} />
            </Field>
            <Field label={th ? "จ่ายปีละ (ครั้ง)" : "Payments / year"}>
              <select value={form.div_frequency} onChange={e => set('div_frequency', e.target.value)} style={inputStyle}>
                <option value="1">{th ? "1× — รายปี" : "1× — Annual"}</option>
                <option value="2">{th ? "2× — ราย 6 เดือน" : "2× — Semi-annual"}</option>
                <option value="4">{th ? "4× — รายไตรมาส" : "4× — Quarterly"}</option>
                <option value="12">{th ? "12× — รายเดือน" : "12× — Monthly"}</option>
              </select>
            </Field>
          </div>

          {/* Logo URL (optional) — overrides the auto logo / initials */}
          <Field label={th ? "URL โลโก้ (ไม่บังคับ)" : "Logo URL (optional)"}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <TickerLogo ticker={form.ticker} logoUrl={form.logo_url?.trim() || null} cls={form.asset_class} region={form.region} size={36} />
              <input value={form.logo_url} onChange={e => set('logo_url', e.target.value)}
                     placeholder="https://…/logo.png" style={inputStyle} />
            </div>
          </Field>

          <div style={{ display: "flex", gap: 10, marginTop: 8, position: "sticky", bottom: 0, background: "var(--bg)", paddingTop: 14, paddingBottom: 2 }}>
            <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
              {th ? "ยกเลิก" : "Cancel"}
            </button>
            <button type="submit" className="btn" style={{ flex: 2 }} disabled={saving}>
              {saving ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "บันทึกการเปลี่ยนแปลง" : "Save changes")}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Sell Modal ───────────────────────────────────────────────────────────────
function SellModal({ lang, ccy, holding, portfolioId, onClose, onSaved }) {
  const th = lang === "th"
  const today = new Date().toISOString().split('T')[0]
  const nativeCcy = holding.nativeCcy || holding.currency || (holding.region === 'US' ? 'USD' : 'THB')
  const heldShares = Number(holding.shares) || 0
  const avgCostNative = Number(holding.costNative) || 0       // per-share cost (native)
  const isUS = (holding.region === 'US') || nativeCcy === 'USD'

  const [form, setForm] = useState({
    shares: String(heldShares),
    price:  holding.priceNative != null ? String(+Number(holding.priceNative).toFixed(2)) : '',
    fee: '', tax: '',
    date: today,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const sh    = parseFloat(form.shares) || 0
  const price = parseFloat(form.price)  || 0
  const fee   = parseFloat(form.fee)    || 0
  const tax   = parseFloat(form.tax)    || 0
  // Estimated realized P/L (native ccy) = net proceeds − cost of shares sold
  const realizedNative = (price * sh - fee - tax) - (avgCostNative * sh)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (sh <= 0) { setError(th ? "ใส่จำนวนหุ้นที่จะขาย" : "Enter shares to sell"); return }
    if (sh > heldShares + 1e-9) { setError(th ? "จำนวนหุ้นเกินที่ถืออยู่" : "More than you hold"); return }
    setSaving(true); setError(null)
    const { error: err } = await addTransaction(portfolioId, {
      type: 'Sell',
      ticker: holding.ticker,
      shares: sh,
      price,
      amount: +(sh * price).toFixed(2),
      fee, tax,
      currency: nativeCcy,
      transacted_at: new Date(form.date).toISOString(),
      note: holding.name,
    })
    if (err) { setSaving(false); setError(err.message); return }
    await rebuildHolding(portfolioId, holding.ticker)
    setSaving(false)
    onSaved()
  }

  const sym = nativeCcy === 'USD' ? '$' : '฿'

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      overflowY: "auto", padding: "24px 16px",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg)", borderRadius: 20, padding: "32px 28px 40px",
        width: "100%", maxWidth: 460, margin: "auto",
        boxShadow: "0 8px 48px rgba(0,0,0,0.18)", maxHeight: "calc(100dvh - 48px)", overflowY: "auto", animation: "fadeIn 0.18s ease",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontFamily: "var(--font-display)" }}>
            {th ? "ขาย" : "Sell"} {holding.ticker}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-3)", lineHeight: 1 }}>×</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "0 0 20px" }}>
          {th ? "ถืออยู่ " : "Holding "}{heldShares.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          {th ? " หุ้น · ต้นทุนเฉลี่ย " : " shares · avg cost "}{sym}{avgCostNative.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "oklch(0.96 0.05 25)", color: "oklch(0.40 0.12 25)", fontSize: 13 }}>{error}</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "จำนวนหุ้นที่ขาย" : "Shares to sell"}>
              <CalcInput value={form.shares}
                     onChange={e => set('shares', e.target.value)} style={inputStyle} />
            </Field>
            <Field label={(th ? "ราคาขาย/หุ้น " : "Sell price/share ") + `(${nativeCcy})`}>
              <CalcInput value={form.price}
                     onChange={e => set('price', e.target.value)} placeholder="0.00" style={inputStyle} />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "ค่าธรรมเนียม (ไม่บังคับ)" : "Fee (optional)"}>
              <CalcInput value={form.fee}
                     onChange={e => set('fee', e.target.value)} placeholder="0.00" style={inputStyle} />
            </Field>
            <Field label={th ? "ภาษี (ไม่บังคับ)" : "Tax (optional)"}>
              <CalcInput value={form.tax}
                     onChange={e => set('tax', e.target.value)} placeholder="0.00" style={inputStyle} />
            </Field>
          </div>
          <Field label={th ? "วันที่ขาย" : "Sell date"}>
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} style={inputStyle} />
          </Field>

          {/* Realized P/L preview */}
          <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--bg-2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{th ? "กำไร/ขาดทุนโดยประมาณ" : "Estimated realized P/L"}</span>
            <span style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-display)", color: realizedNative >= 0 ? "var(--gain)" : "var(--loss)" }}>
              {realizedNative >= 0 ? "+" : "−"}{sym}{Math.abs(realizedNative).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 8, position: "sticky", bottom: 0, background: "var(--bg)", paddingTop: 14, paddingBottom: 2 }}>
            <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>{th ? "ยกเลิก" : "Cancel"}</button>
            <button type="submit" className="btn" style={{ flex: 2 }} disabled={saving}>
              {saving ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "ยืนยันการขาย" : "Confirm sale")}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Realized P/L report ──────────────────────────────────────────────────────
function RealizedModal({ lang, ccy, realized, onClose }) {
  const th = lang === "th"
  const years = Object.entries(realized.byYear || {}).sort((a, b) => b[0].localeCompare(a[0]))
  const sales = realized.sales || []
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      overflowY: "auto", padding: "24px 16px",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg)", borderRadius: 20, padding: "28px 26px 32px",
        width: "100%", maxWidth: 620, margin: "auto",
        boxShadow: "0 8px 48px rgba(0,0,0,0.18)", maxHeight: "calc(100dvh - 48px)", overflowY: "auto",
        animation: "fadeIn 0.18s ease",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontFamily: "var(--font-display)" }}>
            {th ? "กำไร/ขาดทุนที่รับรู้" : "Realized P/L"}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-3)", lineHeight: 1 }}>×</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "0 0 18px" }}>
          {th ? "กำไรจากการขายจริง = เงินที่ได้รับสุทธิ − ต้นทุนเฉลี่ยของหุ้นที่ขาย (หัก fee/tax)" : "Net proceeds − average cost of shares sold (fees/taxes deducted)"}
        </p>

        {/* Per-year summary */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
          <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--bg-2)", flex: "1 1 120px" }}>
            <div className="label-up" style={{ marginBottom: 4 }}>{th ? "รวมทั้งหมด" : "Total"}</div>
            <div style={{ fontSize: 20, fontWeight: 600, fontFamily: "var(--font-display)", color: realized.total >= 0 ? "var(--gain)" : "var(--loss)" }}>
              {realized.total >= 0 ? "+" : ""}{LUMEN_FMT.money(realized.total, ccy)}
            </div>
          </div>
          {years.map(([y, g]) => (
            <div key={y} style={{ padding: "10px 14px", borderRadius: 10, background: "var(--bg-2)", flex: "1 1 100px" }}>
              <div className="label-up" style={{ marginBottom: 4 }}>{y}</div>
              <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "var(--font-display)", color: g >= 0 ? "var(--gain)" : "var(--loss)" }}>
                {g >= 0 ? "+" : ""}{LUMEN_FMT.money(g, ccy, { compact: true })}
              </div>
            </div>
          ))}
        </div>

        {/* Per-sale list */}
        {sales.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>{th ? "ยังไม่มีการขาย" : "No sales yet"}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{th ? "วันที่" : "Date"}</th>
                <th>{th ? "หลักทรัพย์" : "Holding"}</th>
                <th className="num">{th ? "จำนวน" : "Shares"}</th>
                <th className="num">{th ? "กำไร/ขาดทุน" : "Gain/Loss"}</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s, i) => (
                <tr key={i}>
                  <td className="mono muted" style={{ fontSize: 12 }}>{s.date}</td>
                  <td style={{ fontWeight: 500, fontSize: 13 }}>{s.ticker}</td>
                  <td className="num">{Number(s.shares).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="num" style={{ color: s.gainTHB >= 0 ? "var(--gain)" : "var(--loss)", fontWeight: 500 }}>
                    {s.gainTHB >= 0 ? "+" : ""}{LUMEN_FMT.money(s.gainTHB, ccy, { compact: true })}
                    <div className="muted" style={{ fontSize: 10 }}>{s.gainPct >= 0 ? "+" : ""}{s.gainPct.toFixed(1)}%</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Ticker Search (autocomplete) ────────────────────────────────────────────
// Maps Yahoo Finance exchange codes → our region values
function yahooRegion(exchange) {
  const ex = (exchange || '').toUpperCase()
  if (['BKK', 'SET', 'BKS'].includes(ex)) return 'TH'
  if (['NYQ', 'NMS', 'NGM', 'PCX', 'ASE', 'NNM', 'NAS', 'CCC'].includes(ex)) return 'US'
  return 'Other'
}
function yahooAssetClass(type) {
  const t = (type || '').toUpperCase()
  if (t === 'ETF') return 'ETF'
  if (t === 'CRYPTOCURRENCY') return 'Crypto'
  if (t === 'FUTURE' || t === 'COMMODITY') return 'Commodity'
  if (t === 'BOND') return 'Bond'
  return 'Equity'
}

// Look up a ticker's full company/fund name via the search proxy.
// Returns null on any miss/error (best-effort enrichment).
async function fetchTickerName(ticker) {
  if (!ticker) return null
  try {
    const res  = await fetch(`/api/search?q=${encodeURIComponent(ticker)}`)
    const data = await res.json()
    const up   = ticker.toUpperCase()
    const hit  = data.find(d => d.symbol?.toUpperCase() === up)
              || data.find(d => d.symbol?.toUpperCase().replace(/\.BK$/, '') === up)
              || data[0]
    return hit?.name || null
  } catch {
    return null
  }
}

function TickerSearch({ lang, value, onType, onSelect }) {
  const th = lang === 'th'
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef(null)

  const doSearch = useCallback((q) => {
    if (q.length < 1) { setResults([]); setOpen(false); return }
    setLoading(true)
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(data => { setResults(data); setOpen(data.length > 0); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const handleChange = (e) => {
    const v = e.target.value
    onType(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(v), 280)
  }

  const handlePick = (item) => {
    const region = yahooRegion(item.exchange)
    const asset_class = yahooAssetClass(item.type)
    const currency = region === 'US' ? 'USD' : 'THB'
    const div_frequency = String(region === 'TH' ? 2 : 4)
    // Strip .BK suffix from ticker for Thai stocks
    const ticker = item.symbol.replace(/\.BK$/i, '')
    onSelect({ ticker, name: item.name, region, asset_class, currency, div_frequency })
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Icon name="search" size={14} style={{
          position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--ink-4)', pointerEvents: 'none',
        }} />
        <input
          value={value}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          placeholder={th ? "ค้นหาชื่อหรือ Ticker เช่น PTT, Apple…" : "Search ticker or name, e.g. PTT, Apple…"}
          style={{ ...inputStyle, paddingLeft: 32 }}
          autoComplete="off"
          spellCheck={false}
        />
        {loading && (
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--ink-4)' }}>
            {th ? 'กำลังค้นหา…' : 'searching…'}
          </span>
        )}
      </div>

      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: 'var(--bg)', border: '1.5px solid var(--line)', borderRadius: 12,
          marginTop: 4, boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
          maxHeight: 300, overflowY: 'auto',
        }}>
          {results.map((r, i) => (
            <div key={i} onMouseDown={() => handlePick(r)} style={{
              padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
              borderBottom: i < results.length - 1 ? '1px solid var(--line)' : 'none',
              background: 'transparent', transition: 'background 0.1s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-mono)', minWidth: 72, color: 'var(--ink)' }}>
                {r.symbol}
              </span>
              <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.name}
              </span>
              <span style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                {r.exchange}
              </span>
            </div>
          ))}
          <div style={{ padding: '6px 14px', fontSize: 10, color: 'var(--ink-4)', borderTop: '1px solid var(--line)' }}>
            {th ? 'ข้อมูลจาก Yahoo Finance · คลิกเพื่อเลือก' : 'Powered by Yahoo Finance · click to select'}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </label>
      {children}
    </div>
  )
}

// ─── Investment journal — notes attached to a holding ────────────────────────
function NotesModal({ th, holding, onClose, onSaved }) {
  const [text, setText] = useState(holding?.notes || '')
  const [saving, setSaving] = useState(false)
  const PLACEHOLDER = th
    ? `เหตุผลที่ซื้อ:\n\nราคาเป้าหมาย:\n\nStop loss:\n\nความเสี่ยงที่ต้องจับตา:\n\nวันที่จะทบทวน thesis อีกครั้ง:`
    : `Why I bought:\n\nTarget price:\n\nStop loss:\n\nRisks to watch:\n\nWhen to re-evaluate thesis:`
  const handleSave = async () => {
    if (!holding?.id) return
    setSaving(true)
    const { error } = await updateHolding(holding.id, { notes: text.trim() })
    setSaving(false)
    if (error) { alert(error.message); return }
    onSaved?.()
  }
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <div style={{ background: "var(--bg)", borderRadius: 18, padding: 24, width: "100%", maxWidth: 560, maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <TickerLogo ticker={holding.displayTicker || holding.ticker} logoUrl={holding.logo_url} region={holding.region} cls={holding.cls} size={36} />
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="book" size={15} /> {th ? "บันทึกการลงทุน" : "Investment journal"}
              </h3>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{holding.displayTicker || holding.ticker} · {holding.name}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-3)", padding: 4 }}>✕</button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
          {th
            ? "บันทึกความคิดของคุณก่อนซื้อ — กลับมาดูเมื่อพอร์ตขึ้น/ลง เพื่อรู้ว่าตัดสินใจถูกหรือผิดเพราะอะไร"
            : "Capture your thinking before buying — revisit when the market moves to learn from each decision."}
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={12}
          style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1.5px solid var(--line)", background: "var(--bg)", color: "var(--ink)", outline: "none", fontSize: 13, fontFamily: "inherit", lineHeight: 1.55, resize: "vertical", minHeight: 200, boxSizing: "border-box" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span className="muted" style={{ fontSize: 11 }}>{text.length} {th ? "ตัวอักษร" : "characters"}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-outline" style={{ flex: "0 0 auto", padding: "8px 18px" }} onClick={onClose} disabled={saving}>
              {th ? "ยกเลิก" : "Cancel"}
            </button>
            <button className="btn" style={{ flex: "0 0 auto", padding: "8px 22px" }} onClick={handleSave} disabled={saving}>
              {saving ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "บันทึก" : "Save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputStyle = {
  padding: "10px 12px", borderRadius: 8, fontSize: 14,
  border: "1.5px solid var(--line)", background: "var(--bg)",
  color: "var(--ink)", outline: "none", width: "100%", boxSizing: "border-box",
}

const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTHS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']

function DateSelectField({ label, value, onChange, lang }) {
  const now = new Date()
  const parts = (value || '').split('-')
  const year  = parseInt(parts[0]) || now.getFullYear()
  const month = parseInt(parts[1]) || (now.getMonth() + 1)
  const day   = parseInt(parts[2]) || now.getDate()
  const months = lang === "th" ? MONTHS_TH : MONTHS_EN
  const clampDay = (y, m, d) => Math.min(d, new Date(y, m, 0).getDate())
  const emit = (y, m, d) => {
    const dd = clampDay(y, m, d)
    onChange(`${y}-${String(m).padStart(2,'0')}-${String(dd).padStart(2,'0')}`)
  }
  const years = Array.from({ length: now.getFullYear() - 2009 }, (_, i) => now.getFullYear() - i)
  return (
    <Field label={label}>
      <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 90px', gap: 6 }}>
        <select value={day} onChange={e => emit(year, month, +e.target.value)} style={inputStyle}>
          {Array.from({ length: new Date(year, month, 0).getDate() }, (_, i) => i + 1).map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select value={month} onChange={e => emit(year, +e.target.value, day)} style={inputStyle}>
          {months.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>
        <select value={year} onChange={e => emit(+e.target.value, month, day)} style={inputStyle}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </Field>
  )
}

// ─── Transactions Tab ────────────────────────────────────────────────────────
function TransactionsTab({ transactions, holdings = [], loading, lang, ccy, fxRate = 36, onReload, portfolioId }) {
  const th = lang === "th"
  const [editTx, setEditTx] = useState(null)     // tx object being edited
  const [deleting, setDeleting] = useState(null)  // id being deleted
  const [showImport, setShowImport] = useState(null)  // null | 'pdf' | 'csv'
  const [fType, setFType] = useState("all")       // type filter
  const [fQuery, setFQuery] = useState("")        // ticker/name search
  const [fPeriod, setFPeriod] = useState("all")   // time-range filter (preset, "y:YYYY", or "custom")
  const [customFrom, setCustomFrom] = useState("") // custom range start (YYYY-MM-DD)
  const [customTo, setCustomTo] = useState("")     // custom range end

  const handleDelete = async (tx) => {
    if (!window.confirm(th ? `ลบรายการ ${tx.ticker || ''} ${tx.type} นี้?` : `Delete this ${tx.type} transaction for ${tx.ticker || ''}?`)) return
    setDeleting(tx.id)
    await deleteTransaction(tx.id)
    // Re-sync the affected holding from its remaining transactions
    if (tx.ticker && portfolioId) await rebuildHolding(portfolioId, tx.ticker)
    setDeleting(null)
    onReload?.()
  }

  if (loading) return (
    <div style={{ padding: 48, textAlign: "center", color: "var(--ink-3)", fontSize: 14 }}>
      {th ? "กำลังโหลด…" : "Loading…"}
    </div>
  )

  if (transactions.length === 0) return (
    <>
      <div className="card empty" style={{ padding: "60px 24px" }}>
        <h3 className="display" style={{ fontSize: 24, margin: "0 0 8px" }}>
          {th ? "ยังไม่มีธุรกรรม" : "No transactions yet"}
        </h3>
        <p className="muted" style={{ fontSize: 13 }}>
          {th ? "เมื่อคุณเพิ่มหลักทรัพย์ใหม่ มันจะถูกบันทึกที่นี่โดยอัตโนมัติ" : "When you add holdings they'll be logged here automatically."}
        </p>
        <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
          <button className="btn btn-outline btn-sm" onClick={() => setShowImport('pdf')}>
            <Icon name="upload" size={13} /> PDF
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => setShowImport('csv')}>
            <Icon name="upload" size={13} /> CSV
          </button>
        </div>
      </div>
      {showImport === 'pdf' && portfolioId && (
        <ImportPDFModal lang={lang} portfolioId={portfolioId}
          onClose={() => setShowImport(null)}
          onImported={() => { setShowImport(null); onReload?.() }} />
      )}
      {showImport === 'csv' && portfolioId && (
        <ImportCSVModal lang={lang} portfolioId={portfolioId}
          onClose={() => setShowImport(null)}
          onImported={() => { setShowImport(null); onReload?.() }} />
      )}
    </>
  )

  const typeColor = { Buy: "var(--gain)", Sell: "var(--loss)", Dividend: "var(--accent-ink)", Deposit: "var(--ink-2)", Withdraw: "var(--ink-2)" }
  const typeBg    = { Buy: "var(--gain-soft)", Sell: "var(--loss-soft)", Dividend: "var(--accent-soft)", Deposit: "var(--bg-2)", Withdraw: "var(--bg-2)" }
  const typeLabel = { en: { Buy: "Buy", Sell: "Sell", Dividend: "Dividend", Deposit: "Deposit", Withdraw: "Withdraw" }, th: { Buy: "ซื้อ", Sell: "ขาย", Dividend: "ปันผล", Deposit: "ฝาก", Withdraw: "ถอน" } }
  const typeIcon  = { Buy: "buy", Sell: "sell", Dividend: "dividend", Deposit: "deposit", Withdraw: "deposit" }

  // Filter chips (only show types that actually exist) + ticker/name search
  const typesPresent = [...new Set(transactions.map(tx => tx.type || "Buy"))]
  const q = fQuery.trim().toLowerCase()
  const filtered = transactions.filter(tx => {
    if (fType !== "all" && (tx.type || "Buy") !== fType) return false
    if (q && !(`${tx.ticker || ""} ${tx.note || ""}`).toLowerCase().includes(q)) return false
    return true
  })

  // Years present (newest-first) for the "by year" group
  const yearOf = tx => tx.transacted_at ? String(new Date(tx.transacted_at).getFullYear()) : "—"
  const years = [...new Set(filtered.map(yearOf))].sort((a, b) => b.localeCompare(a))

  // Time-range presets — start date for each rolling window
  const now = new Date()
  const periodStart = {
    "30d": new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30),
    "3m":  new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()),
    "6m":  new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()),
    "ytd": new Date(now.getFullYear(), 0, 1),
    "12m": new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
  }
  const periodOptions = [
    { k: "all", label: th ? "ทั้งหมด" : "All time" },
    { k: "30d", label: th ? "30 วันล่าสุด" : "Last 30 days" },
    { k: "3m",  label: th ? "3 เดือนล่าสุด" : "Last 3 months" },
    { k: "6m",  label: th ? "6 เดือนล่าสุด" : "Last 6 months" },
    { k: "ytd", label: th ? "ปีนี้ (YTD)" : "This year (YTD)" },
    { k: "12m", label: th ? "12 เดือนล่าสุด" : "Last 12 months" },
    { k: "custom", label: th ? "กำหนดเอง…" : "Custom range…" },
  ]
  const inPeriod = (tx, k) => {
    if (k === "all") return true
    if (k.startsWith("y:")) return yearOf(tx) === k.slice(2)
    if (!tx.transacted_at) return false
    const d = new Date(tx.transacted_at)
    if (k === "custom") {
      if (customFrom && d < new Date(customFrom)) return false
      if (customTo && d > new Date(customTo + "T23:59:59")) return false
      return true
    }
    return d >= periodStart[k]
  }
  const shown = filtered.filter(tx => inPeriod(tx, fPeriod))

  const renderRow = (tx) => {
    const type = tx.type || 'Buy'
    const date = tx.transacted_at
      ? new Date(tx.transacted_at).toLocaleDateString(th ? "th-TH" : "en-US", { day: "numeric", month: "short", year: "2-digit" })
      : "—"
    const priceCcy = tx.currency || 'THB'
    const amountDisp = (() => {
      const a = tx.amount || (tx.shares * tx.price) || 0
      return priceCcy === 'USD' ? a * fxRate : a
    })()
    return (
      <tr key={tx.id} style={{ opacity: deleting === tx.id ? 0.4 : 1 }}>
        <td className="mono muted" style={{ fontSize: 12 }}>{date}</td>
        <td>
          <span className="chip" style={{
            background: typeBg[type] || "var(--bg-2)",
            color: typeColor[type] || "var(--ink-2)",
            fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            <Icon name={typeIcon[type] || "buy"} size={11} />
            {(typeLabel[lang] || typeLabel.en)[type] || type}
          </span>
        </td>
        <td>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{tx.ticker || "—"}</div>
          {tx.note && <div className="muted" style={{ fontSize: 11 }}>{tx.note}</div>}
        </td>
        <td className="num">{tx.shares != null ? tx.shares.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}</td>
        <td className="num">
          {tx.price != null
            ? (priceCcy === 'USD' ? '$' : '฿') + tx.price.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : "—"}
        </td>
        <td className="num" style={{ fontWeight: 500 }}>
          {amountDisp > 0 ? LUMEN_FMT.money(amountDisp, ccy, { compact: true }) : "—"}
          {((tx.fee || 0) + (tx.tax || 0)) > 0 && (
            <div className="muted" style={{ fontSize: 10, marginTop: 1 }}>
              {tx.fee > 0 && <span>fee {priceCcy === 'USD' ? '$' : '฿'}{Number(tx.fee).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>}
              {tx.fee > 0 && tx.tax > 0 && <span> · </span>}
              {tx.tax > 0 && <span>tax {priceCcy === 'USD' ? '$' : '฿'}{Number(tx.tax).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>}
            </div>
          )}
        </td>
        <td className="num hide-mob">
          <span className="muted" style={{ fontSize: 11 }}>{priceCcy}</span>
        </td>
        <td>
          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
            <button onClick={() => setEditTx(tx)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: 6, color: "var(--ink-3)", lineHeight: 1 }}
              title={th ? "แก้ไข" : "Edit"}>
              <Icon name="edit" size={13} />
            </button>
            <button onClick={() => handleDelete(tx)} disabled={deleting === tx.id}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: 6, color: "var(--loss)", lineHeight: 1 }}
              title={th ? "ลบ" : "Delete"}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <>
      {/* One clean toolbar: year (left) · search · type · import (right) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: "auto", flexWrap: "wrap" }}>
          <select value={fPeriod} onChange={e => setFPeriod(e.target.value)}
            style={{ ...inputStyle, width: "auto", padding: "7px 28px 7px 12px", fontSize: 13, fontFamily: "var(--font-mono)", fontWeight: 400 }}>
            <optgroup label={th ? "ช่วงเวลา" : "Period"}>
              {periodOptions.map(o => (
                <option key={o.k} value={o.k}>{o.label}{o.k === "custom" ? "" : ` (${filtered.filter(tx => inPeriod(tx, o.k)).length})`}</option>
              ))}
            </optgroup>
            {years.length > 0 && (
              <optgroup label={th ? "รายปี" : "By year"}>
                {years.map(y => (
                  <option key={y} value={"y:" + y}>{th ? `ปี ${y}` : `Year ${y}`} ({filtered.filter(tx => yearOf(tx) === y).length})</option>
                ))}
              </optgroup>
            )}
          </select>
          {fPeriod === "custom" && (
            <>
              <input type="date" value={customFrom} max={customTo || undefined}
                onChange={e => setCustomFrom(e.target.value)}
                style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 13, fontFamily: "var(--font-mono)" }} />
              <span style={{ color: "var(--ink-3)", fontSize: 13 }}>–</span>
              <input type="date" value={customTo} min={customFrom || undefined}
                onChange={e => setCustomTo(e.target.value)}
                style={{ ...inputStyle, width: "auto", padding: "6px 10px", fontSize: 13, fontFamily: "var(--font-mono)" }} />
              <span style={{ color: "var(--ink-3)", fontSize: 12, fontFamily: "var(--font-mono)" }}>{shown.length}</span>
            </>
          )}
        </div>
        <input
          value={fQuery}
          onChange={e => setFQuery(e.target.value)}
          placeholder={th ? "ค้นหา" : "Search"}
          style={{ ...inputStyle, width: 150, padding: "7px 12px", fontSize: 13 }}
        />
        <select value={fType} onChange={e => setFType(e.target.value)}
          style={{ ...inputStyle, width: "auto", padding: "7px 28px 7px 12px", fontSize: 13 }}>
          <option value="all">{th ? "ทุกประเภท" : "All types"}</option>
          {["Buy", "Sell", "Dividend", "Deposit", "Withdraw"].filter(t => typesPresent.includes(t)).map(t => (
            <option key={t} value={t}>{(typeLabel[lang] || typeLabel.en)[t]}</option>
          ))}
        </select>
        <div className="segmented" style={{ flexShrink: 0 }}>
          <button className={showImport === 'pdf' ? "on" : ""} style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => setShowImport('pdf')}>
            <Icon name="upload" size={12} /> PDF
          </button>
          <button className={showImport === 'csv' ? "on" : ""} style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => setShowImport('csv')}>
            <Icon name="upload" size={12} /> CSV
          </button>
        </div>
      </div>

      <section className="card tbl-card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 100 }}>{th ? "วันที่" : "Date"}</th>
              <th>{th ? "ประเภท" : "Type"}</th>
              <th>{th ? "หลักทรัพย์" : "Asset"}</th>
              <th className="num">{th ? "จำนวน" : "Shares"}</th>
              <th className="num">{th ? "ราคา" : "Price"}</th>
              <th className="num">{th ? "มูลค่า" : "Amount"}</th>
              <th className="num hide-mob">{th ? "สกุล" : "Ccy"}</th>
              <th style={{ width: 64 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan="8" style={{ padding: "32px 16px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
                {th ? "ไม่พบรายการที่ตรงกับตัวกรอง" : "No transactions match the filter"}
              </td></tr>
            )}
            {shown.map(renderRow)}
          </tbody>
        </table>
      </section>

      {editTx && (
        <EditTransactionModal
          tx={editTx}
          holding={holdings.find(h => h.ticker?.toUpperCase() === (editTx.ticker || '').toUpperCase())}
          lang={lang}
          onClose={() => setEditTx(null)}
          onSaved={async (updated) => {
            if (portfolioId) {
              // Rebuild positions for the affected ticker(s) — handles renames
              const tickers = new Set([editTx.ticker, updated?.ticker].filter(Boolean))
              for (const tk of tickers) await rebuildHolding(portfolioId, tk)
              // Apply classification (region/sector/asset class/name) to the holding
              if (updated?.ticker && updated.meta) {
                await updateHoldingMeta(portfolioId, updated.ticker, updated.meta)
              }
            }
            setEditTx(null); onReload?.()
          }}
        />
      )}
      {showImport === 'pdf' && portfolioId && (
        <ImportPDFModal lang={lang} portfolioId={portfolioId}
          onClose={() => setShowImport(null)}
          onImported={() => { setShowImport(null); onReload?.() }} />
      )}
      {showImport === 'csv' && portfolioId && (
        <ImportCSVModal lang={lang} portfolioId={portfolioId}
          onClose={() => setShowImport(null)}
          onImported={() => { setShowImport(null); onReload?.() }} />
      )}
    </>
  )
}

// ─── Edit Transaction Modal ───────────────────────────────────────────────────
function EditTransactionModal({ tx, holding, lang, onClose, onSaved }) {
  const th = lang === "th"
  const toDateInput = (v) => {
    if (!v) return new Date().toISOString().split('T')[0]
    return new Date(v).toISOString().split('T')[0]
  }
  // Classification fields default from the existing holding, then fall back to
  // sensible guesses derived from the transaction currency.
  const ccyDefault = tx.currency || holding?.currency || 'THB'
  const [form, setForm] = useState({
    type:         tx.type || 'Buy',
    ticker:       tx.ticker || '',
    name:         holding?.name || tx.note || tx.ticker || '',
    asset_class:  holding?.asset_class || 'Equity',
    region:       holding?.region || (ccyDefault === 'USD' ? 'US' : 'TH'),
    sector:       holding?.sector || '',
    shares:       tx.shares != null ? String(tx.shares) : '',
    price:        tx.price  != null ? String(tx.price)  : '',
    amount:       tx.amount != null ? String(tx.amount) : '',
    fee:          tx.fee    != null && tx.fee  !== 0 ? String(tx.fee)  : '',
    tax:          tx.tax    != null && tx.tax  !== 0 ? String(tx.tax)  : '',
    currency:     ccyDefault,
    note:         tx.note || '',
    transacted_at: toDateInput(tx.transacted_at),
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)
  const set = (k, v) => setForm(f => ({
    ...f, [k]: v,
    ...(k === 'region' ? { div_frequency: v === 'TH' ? 2 : 4 } : {}),
  }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const shares = form.shares !== '' ? parseFloat(form.shares) : null
    const price  = form.price  !== '' ? parseFloat(form.price)  : null
    const amount = form.amount !== '' ? parseFloat(form.amount) : (shares != null && price != null ? shares * price : null)
    const { error: err } = await updateTransaction(tx.id, {
      type:          form.type,
      ticker:        form.ticker.toUpperCase() || null,
      shares,
      price,
      amount,
      fee:           form.fee  !== '' ? parseFloat(form.fee)  : 0,
      tax:           form.tax  !== '' ? parseFloat(form.tax)  : 0,
      currency:      form.currency,
      // Name drives the ledger's asset sub-label; fall back to the free note
      note:          (form.name && form.name !== form.ticker ? form.name : form.note) || null,
      transacted_at: form.transacted_at,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved({
      ticker: form.ticker.toUpperCase() || null,
      meta: {
        name:        form.name || null,
        region:      form.region,
        asset_class: form.asset_class,
        sector:      form.sector || null,
        currency:    form.currency,
        div_frequency: form.div_frequency,
      },
    })
  }

  const TX_TYPES = ['Buy', 'Sell', 'Dividend', 'Deposit', 'Withdraw']
  const typeLabel = { en: { Buy: "Buy", Sell: "Sell", Dividend: "Dividend", Deposit: "Deposit", Withdraw: "Withdraw" }, th: { Buy: "ซื้อ", Sell: "ขาย", Dividend: "ปันผล", Deposit: "ฝาก", Withdraw: "ถอน" } }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      overflowY: "auto", padding: "24px 16px",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg)", borderRadius: 20, padding: "32px 28px 40px",
        width: "100%", maxWidth: 560, margin: "auto",
        boxShadow: "0 8px 48px rgba(0,0,0,0.18)", maxHeight: "calc(100dvh - 48px)", overflowY: "auto",
        animation: "fadeIn 0.18s ease",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontFamily: "var(--font-display)" }}>
            {th ? "แก้ไขธุรกรรม" : "Edit Transaction"}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-3)", lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "oklch(0.96 0.05 25)", color: "oklch(0.40 0.12 25)", fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Type + Ticker search */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "ประเภท" : "Type"}>
              <select value={form.type} onChange={e => set('type', e.target.value)} style={inputStyle}>
                {TX_TYPES.map(t => <option key={t} value={t}>{(typeLabel[lang] || typeLabel.en)[t]}</option>)}
              </select>
            </Field>
            <Field label={th ? "ค้นหาหลักทรัพย์" : "Search ticker"}>
              <TickerSearch
                lang={lang}
                value={form.ticker}
                onType={v => set('ticker', v.toUpperCase())}
                onSelect={({ ticker, name, region, asset_class, currency, div_frequency }) =>
                  setForm(f => ({ ...f, ticker, name, region, asset_class, currency, div_frequency }))
                }
              />
            </Field>
          </div>

          {/* Name */}
          <Field label={th ? "ชื่อหลักทรัพย์" : "Name"}>
            <input value={form.name} onChange={e => set('name', e.target.value)}
                   placeholder={th ? "ชื่อเต็ม (กรอกเองหรือเลือกจากรายการ)" : "Full name (auto-filled or type manually)"} style={inputStyle} />
          </Field>

          {/* Asset Class + Region */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "ประเภทสินทรัพย์" : "Asset Class"}>
              <select value={form.asset_class} onChange={e => set('asset_class', e.target.value)} style={inputStyle}>
                <option value="Equity">{th ? "หุ้น (Equity)" : "Equity"}</option>
                <option value="ETF">ETF</option>
                <option value="Bond">{th ? "พันธบัตร" : "Bond"}</option>
                <option value="Crypto">{th ? "คริปโต" : "Crypto"}</option>
                <option value="Commodity">{th ? "สินค้าโภคภัณฑ์" : "Commodity"}</option>
              </select>
            </Field>
            <Field label={th ? "ตลาด" : "Region"}>
              <select value={form.region} onChange={e => set('region', e.target.value)} style={inputStyle}>
                <option value="TH">{th ? "ไทย (SET)" : "Thailand (SET)"}</option>
                <option value="US">{th ? "สหรัฐ (NYSE/NASDAQ)" : "US (NYSE/NASDAQ)"}</option>
                <option value="Other">{th ? "อื่นๆ" : "Other"}</option>
              </select>
            </Field>
          </div>

          {/* Sector */}
          <Field label={th ? "กลุ่มอุตสาหกรรม (Sector)" : "Sector (optional)"}>
            <select value={form.sector} onChange={e => set('sector', e.target.value)} style={inputStyle}>
              {SECTORS.map(s => (
                <option key={s.value} value={s.value}>{th ? s.th : s.en}</option>
              ))}
            </select>
          </Field>

          {/* Shares + Price */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "จำนวนหุ้น" : "Shares"}>
              <CalcInput value={form.shares}
                     onChange={e => set('shares', e.target.value)} placeholder="0" style={inputStyle} />
            </Field>
            <Field label={th ? "ราคา/หุ้น" : "Price/share"}>
              <CalcInput value={form.price}
                     onChange={e => set('price', e.target.value)} placeholder="0.00" style={inputStyle} />
            </Field>
          </div>

          {/* Amount + Currency */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 12 }}>
            <Field label={th ? "มูลค่ารวม (คำนวณอัตโนมัติหากเว้นว่าง)" : "Total amount (auto if blank)"}>
              <CalcInput value={form.amount}
                     onChange={e => set('amount', e.target.value)} placeholder={th ? "คำนวณอัตโนมัติ" : "Auto"} style={inputStyle} />
            </Field>
            <Field label={th ? "สกุล" : "Ccy"}>
              <select value={form.currency} onChange={e => set('currency', e.target.value)} style={inputStyle}>
                <option value="THB">THB</option>
                <option value="USD">USD</option>
              </select>
            </Field>
          </div>

          {/* Fee + Tax */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "ค่าธรรมเนียม (ไม่บังคับ)" : "Fee (optional)"}>
              <CalcInput value={form.fee}
                     onChange={e => set('fee', e.target.value)}
                     placeholder="0.00" style={inputStyle} />
            </Field>
            <Field label={th ? "ภาษี / อากร (ไม่บังคับ)" : "Tax / Duty (optional)"}>
              <CalcInput value={form.tax}
                     onChange={e => set('tax', e.target.value)}
                     placeholder="0.00" style={inputStyle} />
            </Field>
          </div>

          {/* Date */}
          <Field label={th ? "วันที่" : "Date"}>
            <input type="date" value={form.transacted_at}
                   onChange={e => set('transacted_at', e.target.value)} style={inputStyle} />
          </Field>

          {/* Note */}
          <Field label={th ? "หมายเหตุ (ไม่บังคับ)" : "Note (optional)"}>
            <input value={form.note} onChange={e => set('note', e.target.value)}
                   placeholder={th ? "ชื่อหลักทรัพย์ หรือหมายเหตุ" : "Asset name or note"} style={inputStyle} />
          </Field>

          <div style={{ display: "flex", gap: 10, marginTop: 8, position: "sticky", bottom: 0, background: "var(--bg)", paddingTop: 14, paddingBottom: 2 }}>
            <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
              {th ? "ยกเลิก" : "Cancel"}
            </button>
            <button type="submit" className="btn" style={{ flex: 2 }} disabled={saving}>
              {saving ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "บันทึกการเปลี่ยนแปลง" : "Save changes")}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Import PDF Modal ─────────────────────────────────────────────────────────
function ImportPDFModal({ lang, portfolioId, onClose, onImported }) {
  const th = lang === "th"
  const fileRef = useRef(null)
  const [step, setStep] = useState(1)          // 1=upload, 2=review
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState(null)
  const [rows, setRows] = useState([])          // detected transaction objects
  const [selected, setSelected] = useState(new Set())
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [pdfInfo, setPdfInfo] = useState(null)
  // Password protection
  const [pendingFile, setPendingFile] = useState(null)
  const [needPassword, setNeedPassword] = useState(false)
  const [wrongPassword, setWrongPassword] = useState(false)
  const [password, setPassword] = useState('')

  const TX_TYPES = ['Buy', 'Sell', 'Dividend', 'Deposit', 'Withdraw']
  const typeLabel = {
    en: { Buy: "Buy", Sell: "Sell", Dividend: "Dividend", Deposit: "Deposit", Withdraw: "Withdraw" },
    th: { Buy: "ซื้อ", Sell: "ขาย", Dividend: "ปันผล", Deposit: "ฝาก", Withdraw: "ถอน" },
  }
  const typeColor = { Buy: "var(--gain)", Sell: "var(--loss)", Dividend: "var(--accent-ink)", Deposit: "var(--ink-2)", Withdraw: "var(--ink-2)" }
  const typeBg    = { Buy: "var(--gain-soft)", Sell: "var(--loss-soft)", Dividend: "var(--accent-soft)", Deposit: "var(--bg-2)", Withdraw: "var(--bg-2)" }

  const doExtract = async (file, pw = '') => {
    setExtracting(true)
    setExtractError(null)
    setWrongPassword(false)
    try {
      const { extractPDFRows, detectTransactions } = await import('../lib/pdfParser.js')
      const { rows: textRows, numPages } = await extractPDFRows(file, pw)
      const detected = detectTransactions(textRows)

      if (detected.length === 0) {
        setExtractError(
          th
            ? 'ไม่พบรายการธุรกรรมในไฟล์ PDF นี้\n\nอาจเกิดจาก:\n• PDF เป็นภาพสแกน (ไม่ใช่ข้อความ)\n• รูปแบบตารางไม่มีคอลัมน์วันที่ที่ชัดเจน'
            : 'No transactions detected.\n\nPossible reasons:\n• PDF is a scanned image (not text)\n• Table has no recognisable date column'
        )
        return
      }

      setRows(detected)
      setSelected(new Set(detected.map((_, i) => i)))
      setPdfInfo({ numPages, total: detected.length })
      setNeedPassword(false)
      setPassword('')
      setStep(2)
    } catch (err) {
      // pdfjs-dist throws PasswordException for locked PDFs
      if (err?.name === 'PasswordException' || /password/i.test(String(err))) {
        if (pw) {
          setWrongPassword(true)  // had a password but it was wrong
        } else {
          setNeedPassword(true)   // no password supplied yet
        }
      } else {
        setExtractError(String(err))
      }
    } finally {
      setExtracting(false)
    }
  }

  const handleFile = (file) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setExtractError(th ? 'กรุณาเลือกไฟล์ .pdf' : 'Please select a .pdf file')
      return
    }
    setPendingFile(file)
    setNeedPassword(false)
    setWrongPassword(false)
    setPassword('')
    doExtract(file, '')
  }

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    handleFile(e.dataTransfer.files[0])
  }

  const toggleRow = (i) => setSelected(s => {
    const n = new Set(s)
    if (n.has(i)) n.delete(i); else n.add(i)
    return n
  })

  const toggleAll = () =>
    setSelected(s => s.size === rows.length ? new Set() : new Set(rows.map((_, i) => i)))

  const updateRow = (i, field, value) =>
    setRows(rs => rs.map((r, ri) => ri === i ? { ...r, [field]: value } : r))

  const handleImport = async () => {
    const toImport = rows.filter((_, i) => selected.has(i))
    setImporting(true)

    // Best-effort: look up each ticker's full name so it shows in the ledger
    const nameCache = {}
    for (const tx of toImport) {
      const tk = (tx.ticker || '').toUpperCase()
      if (!tk || nameCache[tk] !== undefined) continue
      nameCache[tk] = await fetchTickerName(tk)
    }

    let ok = 0; const errors = []; const imported = []
    for (const tx of toImport) {
      const tk = (tx.ticker || '').toUpperCase()
      const enriched = { ...tx, note: tx.note || nameCache[tk] || null }
      const { error } = await addTransaction(portfolioId, enriched)
      if (error) errors.push(`${tx.ticker || '?'} ${tx.transacted_at}: ${error.message}`)
      else { ok++; imported.push(enriched) }
    }
    // Roll the imported buys/sells into the Holdings table
    if (imported.length) {
      const { errors: hErr } = await syncHoldingsFromTransactions(portfolioId, imported)
      hErr.forEach(e => errors.push(`holding ${e}`))
    }
    setImporting(false)
    setImportResult({ ok, errors })
    if (errors.length === 0) setTimeout(() => { onImported(); onClose() }, 1400)
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100,
      overflowY: "auto", padding: "24px 16px",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg)", borderRadius: 20, padding: "32px 28px 40px",
        width: "100%", maxWidth: step === 2 ? 760 : 600, margin: "auto",
        boxShadow: "0 8px 48px rgba(0,0,0,0.18)", maxHeight: "calc(100dvh - 48px)", overflowY: "auto",
        animation: "fadeIn 0.18s ease",
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontFamily: "var(--font-display)" }}>
            {th ? "นำเข้า Transactions จาก PDF" : "Import Transactions from PDF"}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-3)", lineHeight: 1 }}>×</button>
        </div>

        {/* Step bar */}
        <div style={{ display: "flex", gap: 6, marginBottom: 28 }}>
          {[th ? "1 · อัปโหลด" : "1 · Upload", th ? "2 · ตรวจสอบ" : "2 · Review"].map((label, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ height: 3, borderRadius: 2, background: i + 1 <= step ? "var(--accent)" : "var(--line)", transition: "background 0.3s" }} />
              <div style={{ fontSize: 10, color: i + 1 === step ? "var(--accent-ink)" : "var(--ink-4)", fontWeight: i + 1 === step ? 700 : 400 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── Step 1: Upload ── */}
        {step === 1 && (
          <div>
            <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 12, lineHeight: 1.6 }}>
              {th
                ? "อัปโหลด Statement หรือใบยืนยันการซื้อขายจากโบรกเกอร์ (ต้องเป็น PDF แบบข้อความ ไม่ใช่ภาพสแกน)"
                : "Upload a broker statement or trade confirmation. Must be a text-based PDF — scanned images are not supported."}
            </p>

            {/* Supported brokers */}
            <div style={{
              marginBottom: 16, padding: "12px 14px", borderRadius: 12,
              background: "var(--bg-2)", border: "1px solid var(--line)",
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-2)", marginBottom: 8 }}>
                {th ? "โบรกเกอร์ที่รองรับ" : "Supported brokers"}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {["Dime!", "InnovestX"].map(b => (
                  <span key={b} style={{
                    fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999,
                    background: "var(--accent-soft)", color: "var(--accent-ink)",
                  }}>✓ {b}</span>
                ))}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.5 }}>
                {th
                  ? "โบรกอื่นที่เป็น PDF ข้อความก็ลองได้ (ระบบจะอ่านอัตโนมัติ) — รองรับทั้งหุ้นไทย (THB) และหุ้นต่างประเทศ (USD)"
                  : "Other text-based PDFs may also work (auto-detected) — both Thai (THB) and foreign (USD) trades are supported."}
              </div>
            </div>

            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => !extracting && fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "var(--accent)" : "var(--line)"}`,
                borderRadius: 16, padding: "52px 24px", textAlign: "center",
                cursor: extracting ? "default" : "pointer", transition: "all 0.2s",
                background: dragOver ? "var(--accent-soft)" : "var(--bg-2)",
              }}
            >
              {extracting ? (
                <div>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📖</div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {th ? "กำลังอ่าน PDF…" : "Reading PDF…"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
                    {th ? "กรุณารอสักครู่" : "Please wait"}
                  </div>
                </div>
              ) : needPassword ? (
                <div>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
                  <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 15 }}>{pendingFile?.name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    {th ? "คลิกเพื่อเลือกไฟล์อื่น" : "Click to choose a different file"}
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 15 }}>
                    {th ? "ลากไฟล์มาวาง หรือคลิกเพื่อเลือก" : "Drag & drop or click to select"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>PDF · text-based only</div>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".pdf,application/pdf" style={{ display: "none" }}
              onChange={e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = '' }} />

            {/* ── Password required ── */}
            {needPassword && (
              <div style={{ marginTop: 16, padding: "18px 20px", borderRadius: 14, border: "1.5px solid var(--line)", background: "var(--bg-2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 22 }}>🔒</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {th ? "PDF นี้ถูกล็อกด้วยรหัสผ่าน" : "This PDF is password protected"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
                      {th ? "โดยทั่วไปคือเลขบัตรประชาชน หรือวันเกิด (DDMMYYYY)" : "Usually your ID card number or date of birth (DDMMYYYY)"}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && password && doExtract(pendingFile, password)}
                    placeholder={th ? "ใส่รหัสผ่าน…" : "Enter password…"}
                    autoFocus
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    className="btn"
                    onClick={() => doExtract(pendingFile, password)}
                    disabled={!password || extracting}
                    style={{ flexShrink: 0 }}
                  >
                    {extracting ? (th ? "กำลังอ่าน…" : "Reading…") : (th ? "ยืนยัน" : "Unlock")}
                  </button>
                </div>
                {wrongPassword && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--loss)", fontWeight: 600 }}>
                    {th ? "❌ รหัสผ่านไม่ถูกต้อง — ลองใหม่อีกครั้ง" : "❌ Incorrect password — please try again"}
                  </div>
                )}
              </div>
            )}

            {extractError && (
              <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 10, background: "oklch(0.96 0.05 25)", color: "oklch(0.40 0.12 25)", fontSize: 13, whiteSpace: "pre-line" }}>
                {extractError}
              </div>
            )}

            {!needPassword && (
              <div style={{ marginTop: 20, padding: "14px 16px", background: "var(--bg-2)", borderRadius: 12, fontSize: 12, color: "var(--ink-3)" }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--ink-2)" }}>
                  {th ? "วิธีการทำงาน:" : "How it works:"}
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
                  <li>{th ? "อ่านข้อความจากทุกหน้าของ PDF" : "Extracts text from every page"}</li>
                  <li>{th ? "รองรับ PDF ที่ล็อกด้วยรหัสผ่าน (เลขบัตร/วันเกิด)" : "Supports password-protected PDFs (ID / date of birth)"}</li>
                  <li>{th ? "รองรับวันที่พุทธศักราชและคริสต์ศักราช" : "Supports Buddhist Era and CE dates"}</li>
                  <li>{th ? "ตรวจสอบและแก้ไขได้ก่อนนำเข้า" : "Review and fix values before importing"}</li>
                </ul>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
                {th ? "ยกเลิก" : "Cancel"}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Review ── */}
        {step === 2 && (
          <div>
            {importResult ? (
              /* Result screen */
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>
                  {importResult.errors.length === 0 ? "✅" : "⚠️"}
                </div>
                <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 8 }}>
                  {importResult.errors.length === 0
                    ? (th ? `นำเข้าสำเร็จ ${importResult.ok} รายการ!` : `Imported ${importResult.ok} transactions!`)
                    : (th ? `สำเร็จ ${importResult.ok} · ล้มเหลว ${importResult.errors.length}` : `${importResult.ok} ok · ${importResult.errors.length} failed`)}
                </div>
                {importResult.errors.length > 0 && (
                  <>
                    <div style={{ textAlign: "left", marginTop: 12, padding: "10px 14px", background: "oklch(0.97 0.02 25)", borderRadius: 10, fontSize: 12, color: "oklch(0.40 0.12 25)", maxHeight: 160, overflowY: "auto" }}>
                      {importResult.errors.map((e, i) => <div key={i} style={{ marginBottom: 2 }}>{e}</div>)}
                    </div>
                    <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={onClose}>
                      {th ? "ปิด" : "Close"}
                    </button>
                  </>
                )}
              </div>
            ) : (
              /* Review table */
              <>
                {pdfInfo && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
                      {th
                        ? `พบ ${pdfInfo.total} รายการ จาก ${pdfInfo.numPages} หน้า · เลือก ${selected.size} รายการ`
                        : `Found ${pdfInfo.total} rows from ${pdfInfo.numPages} pages · ${selected.size} selected`}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-outline btn-sm" onClick={toggleAll}>
                        {selected.size === rows.length
                          ? (th ? "ยกเลิกทั้งหมด" : "Deselect all")
                          : (th ? "เลือกทั้งหมด" : "Select all")}
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 8 }}>
                  {th ? "✏️ แก้ไขวันที่ ประเภท หรือ Ticker ได้โดยตรงในตาราง" : "✏️ You can edit date, type, and ticker inline below"}
                </div>

                <div style={{ maxHeight: 380, overflowY: "auto", overflowX: "auto", border: "1px solid var(--line)", borderRadius: 10 }}>
                  <table className="table" style={{ fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 32, textAlign: "center" }}>
                          <input type="checkbox" checked={selected.size === rows.length} onChange={toggleAll} />
                        </th>
                        <th>{th ? "วันที่" : "Date"}</th>
                        <th>{th ? "ประเภท" : "Type"}</th>
                        <th>{th ? "Ticker" : "Ticker"}</th>
                        <th className="num">{th ? "จำนวน" : "Shares"}</th>
                        <th className="num">{th ? "ราคา" : "Price"}</th>
                        <th className="num">{th ? "มูลค่า" : "Amount"}</th>
                        <th className="num">{th ? "ค่าธรรมเนียม" : "Fee"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} style={{ opacity: selected.has(i) ? 1 : 0.35 }}>
                          <td style={{ textAlign: "center" }}>
                            <input type="checkbox" checked={selected.has(i)} onChange={() => toggleRow(i)} />
                          </td>
                          <td>
                            <input
                              type="date"
                              value={r.transacted_at || ''}
                              onChange={e => updateRow(i, 'transacted_at', e.target.value)}
                              style={{ ...inputStyle, padding: "4px 6px", fontSize: 11, width: 120 }}
                            />
                          </td>
                          <td>
                            <select
                              value={r.type}
                              onChange={e => updateRow(i, 'type', e.target.value)}
                              style={{ ...inputStyle, padding: "4px 6px", fontSize: 11, width: "auto" }}
                            >
                              {TX_TYPES.map(t => (
                                <option key={t} value={t}>
                                  {(typeLabel[lang] || typeLabel.en)[t]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              value={r.ticker || ''}
                              onChange={e => updateRow(i, 'ticker', e.target.value.toUpperCase())}
                              placeholder="—"
                              style={{ ...inputStyle, padding: "4px 6px", fontSize: 11, width: 80 }}
                            />
                          </td>
                          <td className="num" style={{ color: "var(--ink-3)" }}>
                            {r.shares != null ? r.shares.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}
                          </td>
                          <td className="num" style={{ color: "var(--ink-3)" }}>
                            {r.price != null ? r.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                          </td>
                          <td className="num" style={{ fontWeight: 500 }}>
                            {r.amount != null ? r.amount.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                          </td>
                          <td className="num" style={{ color: "var(--ink-3)" }}>
                            {r.fee > 0 ? r.fee.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 10, fontSize: 11, color: "var(--ink-4)" }}>
                  {th
                    ? "* จำนวน ราคา มูลค่า คำนวณอัตโนมัติจาก PDF อาจไม่ตรงทุกแถว — แก้ไขเพิ่มเติมได้หลังนำเข้า"
                    : "* Shares, price, amount are auto-extracted and may not be perfect — you can edit after import."}
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 16, position: "sticky", bottom: 0, background: "var(--bg)", paddingTop: 14, paddingBottom: 2 }}>
                  <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setStep(1)} disabled={importing}>
                    {th ? "← ย้อนกลับ" : "← Back"}
                  </button>
                  <button type="button" className="btn" style={{ flex: 2 }} onClick={handleImport} disabled={importing || selected.size === 0}>
                    {importing
                      ? (th ? "กำลังนำเข้า…" : "Importing…")
                      : (th ? `นำเข้า ${selected.size} รายการ` : `Import ${selected.size} transactions`)}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
// Flexible header detection + multi-format date parsing.
// Supports Lumen's own export format and generic broker CSVs.
function parseCSVText(rawText) {
  if (!rawText?.trim()) return []
  function parseLine(line) {
    const cells = []; let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; continue } inQ = !inQ; continue }
      if (c === ',' && !inQ) { cells.push(cur.trim()); cur = ''; continue }
      cur += c
    }
    cells.push(cur.trim()); return cells
  }
  const allRows = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n').map(parseLine).filter(r => r.some(c => c))
  if (allRows.length < 2) return []
  // Column header aliases (all lowercase)
  const ALIASES = {
    date:     ['date','transacted_at','trade_date','วันที่','date_time','settlement_date'],
    type:     ['type','transaction_type','action','ประเภท','txtype','side'],
    ticker:   ['ticker','symbol','stock','code','หลักทรัพย์','security','asset'],
    shares:   ['shares','quantity','qty','volume','จำนวน','units','share'],
    price:    ['price','unit_price','avg_price','ราคา','trade_price'],
    amount:   ['amount','total','value','net_amount','มูลค่า','total_amount','net','consideration'],
    fee:      ['fee','commission','ค่าธรรมเนียม','brokerage','fees'],
    tax:      ['tax','withholding_tax','vat','ภาษี'],
    currency: ['currency','ccy','สกุล','curr'],
    note:     ['note','remark','description','หมายเหตุ','name','company_name','memo'],
  }
  const hdr = allRows[0].map(h => h.toLowerCase().replace(/\s+/g,'_'))
  const col = {}
  hdr.forEach((h, i) => {
    for (const [f, aliases] of Object.entries(ALIASES)) {
      if (col[f] != null) continue
      if (aliases.some(a => h === a || h.includes(a))) col[f] = i
    }
  })
  if (col.date == null) return []
  function parseDate(s) {
    if (!s) return ''
    s = s.trim()
    let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/)
    if (m) { let [,y,mo,d] = m; if (+y > 2500) y = String(+y-543); return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}` }
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
    if (m) { let [,d,mo,y] = m; if (y.length===2) y='20'+y; if (+y>2500) y=String(+y-543); return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}` }
    return ''
  }
  const TYPE_MAP = {
    buy:'Buy',b:'Buy','ซื้อ':'Buy',purchase:'Buy',
    sell:'Sell',s:'Sell','ขาย':'Sell',
    dividend:'Dividend',div:'Dividend','ปันผล':'Dividend',
    deposit:'Deposit',dep:'Deposit','ฝาก':'Deposit',
    withdraw:'Withdraw',withdrawal:'Withdraw',wth:'Withdraw','ถอน':'Withdraw',
  }
  const parseType = s => { if (!s) return 'Buy'; const k=s.trim().toLowerCase().replace(/[^a-zก-ฮ]/g,''); return TYPE_MAP[k]||'Buy' }
  const result = []
  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i]
    if (!r || r.every(c => !c)) continue
    const get = f => col[f] != null ? (r[col[f]] || '') : ''
    const n   = s => { const v=parseFloat(s.replace(/,/g,'')); return isNaN(v)?null:v }
    const date = parseDate(get('date'))
    if (!date) continue
    const shares = n(get('shares')), price = n(get('price'))
    let amount = n(get('amount'))
    if (amount == null && shares != null && price != null) amount = +(shares * price).toFixed(2)
    result.push({
      transacted_at: date, type: parseType(get('type')),
      ticker: get('ticker').toUpperCase() || null,
      shares, price, amount,
      fee: n(get('fee')) ?? 0, tax: n(get('tax')) ?? 0,
      currency: (get('currency') || 'THB').toUpperCase(),
      note: get('note') || null,
    })
  }
  return result
}

// ─── Import CSV Modal ─────────────────────────────────────────────────────────
function ImportCSVModal({ lang, portfolioId, onClose, onImported }) {
  const th = lang === "th"
  const fileRef = useRef(null)
  const [step, setStep] = useState(1)
  const [rows, setRows] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [parseError, setParseError] = useState(null)
  const [csvInfo, setCsvInfo] = useState(null)
  const [pasteText, setPasteText] = useState('')
  const [showPaste, setShowPaste] = useState(false)

  const TX_TYPES = ['Buy', 'Sell', 'Dividend', 'Deposit', 'Withdraw']
  const typeLabel = {
    en: { Buy: "Buy", Sell: "Sell", Dividend: "Dividend", Deposit: "Deposit", Withdraw: "Withdraw" },
    th: { Buy: "ซื้อ", Sell: "ขาย", Dividend: "ปันผล", Deposit: "ฝาก", Withdraw: "ถอน" },
  }
  const toggleRow = (i) => setSelected(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  const toggleAll = () => setSelected(s => s.size === rows.length ? new Set() : new Set(rows.map((_, i) => i)))
  const updateRow = (i, f, v) => setRows(rs => rs.map((r, ri) => ri === i ? { ...r, [f]: v } : r))

  const processText = (text, filename = '') => {
    setParseError(null)
    const detected = parseCSVText(text)
    if (!detected.length) {
      setParseError(th
        ? 'ไม่พบข้อมูลธุรกรรม\n\nตรวจสอบให้แน่ใจว่ามีแถวหัวตาราง เช่น Date, Type, Ticker'
        : 'No transactions found.\n\nMake sure the file has a header row with Date, Type, Ticker columns.')
      return
    }
    setRows(detected)
    setSelected(new Set(detected.map((_, i) => i)))
    setCsvInfo({ filename, total: detected.length })
    setStep(2)
  }

  const handleFile = (file) => {
    if (!file) return
    const ext = file.name.toLowerCase().split('.').pop()
    if (!['csv', 'txt'].includes(ext)) { setParseError(th ? 'กรุณาเลือกไฟล์ .csv' : 'Please select a .csv file'); return }
    const reader = new FileReader()
    reader.onload = e => processText(e.target.result, file.name)
    reader.onerror = () => setParseError(th ? 'อ่านไฟล์ไม่ได้' : 'Could not read file')
    reader.readAsText(file, 'UTF-8')
  }

  const downloadTemplate = () => {
    const hdr = 'Date,Type,Ticker,Shares,Price,Amount,Fee,Tax,Currency,Note'
    const ex  = ['2024-01-15,Buy,ADVANC,100,245.50,,,,THB,Advanced Info Service',
                 '2024-03-20,Dividend,ADVANC,100,2.50,,,,THB,',
                 '2024-02-01,Buy,NVDA,5,600.00,,,,USD,NVIDIA Corporation'].join('\n')
    const blob = new Blob(['﻿'+hdr+'\n'+ex], { type:'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'lumen-import-template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async () => {
    const toImport = rows.filter((_, i) => selected.has(i))
    setImporting(true)
    const nameCache = {}
    for (const tx of toImport) {
      const tk = (tx.ticker || '').toUpperCase()
      if (!tk || nameCache[tk] !== undefined) continue
      nameCache[tk] = await fetchTickerName(tk)
    }
    let ok = 0; const errors = []; const imported = []
    for (const tx of toImport) {
      const tk = (tx.ticker || '').toUpperCase()
      const enriched = { ...tx, note: tx.note || nameCache[tk] || null }
      const { error } = await addTransaction(portfolioId, enriched)
      if (error) errors.push(`${tx.ticker||'?'} ${tx.transacted_at}: ${error.message}`)
      else { ok++; imported.push(enriched) }
    }
    if (imported.length) {
      const { errors: hErr } = await syncHoldingsFromTransactions(portfolioId, imported)
      hErr.forEach(e => errors.push(`holding ${e}`))
    }
    setImporting(false)
    setImportResult({ ok, errors })
    if (!errors.length) setTimeout(() => { onImported(); onClose() }, 1400)
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", backdropFilter:"blur(4px)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:1100,
      overflowY:"auto", padding:"24px 16px",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:"var(--bg)", borderRadius:20, padding:"32px 28px 40px",
        width:"100%", maxWidth: step===2 ? 760 : 600, margin:"auto",
        boxShadow:"0 8px 48px rgba(0,0,0,0.18)", maxHeight:"calc(100dvh - 48px)", overflowY:"auto",
      }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <h3 style={{ margin:0, fontSize:20, fontFamily:"var(--font-display)" }}>
            {th ? "นำเข้า Transactions จาก CSV" : "Import Transactions from CSV"}
          </h3>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:22, color:"var(--ink-3)", lineHeight:1 }}>✕</button>
        </div>

        {/* Step indicators */}
        <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:24 }}>
          {[th ? "อัปโหลด" : "Upload", th ? "ตรวจสอบ" : "Review"].map((label, i) => (
            <Fragment key={i}>
              {i > 0 && <div style={{ flex:1, height:1, background:"var(--line)" }} />}
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:22, height:22, borderRadius:999, fontSize:11, fontWeight:700,
                  background: i+1===step ? "var(--ink)" : "var(--bg-2)",
                  color: i+1===step ? "var(--bg)" : "var(--ink-3)",
                  display:"grid", placeItems:"center", flexShrink:0 }}>{i+1}</div>
                <div style={{ fontSize:12, color:i+1===step ? "var(--ink)" : "var(--ink-4)", fontWeight:i+1===step?700:400 }}>{label}</div>
              </div>
            </Fragment>
          ))}
        </div>

        {/* Step 1 */}
        {step === 1 && (
          <div>
            <p style={{ fontSize:13, color:"var(--ink-2)", marginBottom:16, lineHeight:1.6 }}>
              {th
                ? "อัปโหลดไฟล์ CSV ที่มีคอลัมน์ Date, Type, Ticker, Shares, Price, Amount, Currency — หรือ Export จาก Lumen แล้ว Import กลับได้เลย"
                : "Upload a CSV with columns Date, Type, Ticker, Shares, Price, Amount, Currency — or use Lumen's own export file."}
            </p>

            {/* Format hint */}
            <div style={{ marginBottom:16, padding:"12px 14px", borderRadius:12, background:"var(--bg-2)", border:"1px solid var(--line)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"var(--ink-2)" }}>
                  {th ? "รูปแบบที่รองรับ" : "Expected columns"}
                </div>
                <button className="btn btn-outline btn-sm" style={{ fontSize:11 }} onClick={downloadTemplate}>
                  ⬇ {th ? "ดาวน์โหลด Template" : "Download template"}
                </button>
              </div>
              <div style={{ fontFamily:"var(--font-mono)", fontSize:10.5, color:"var(--ink-3)", overflowX:"auto", whiteSpace:"nowrap" }}>
                Date, Type, Ticker, Shares, Price, Amount, Fee, Tax, Currency, Note
              </div>
              <div style={{ fontSize:10.5, color:"var(--ink-4)", marginTop:6, lineHeight:1.5 }}>
                {th ? "วันที่: YYYY-MM-DD / DD/MM/YYYY / พ.ศ. ก็ได้ · ประเภท: Buy/Sell/Dividend/Deposit/Withdraw · ซื้อ/ขาย/ปันผล/ฝาก/ถอน ก็ได้" : "Date: YYYY-MM-DD or DD/MM/YYYY · Type: Buy/Sell/Dividend/Deposit/Withdraw"}
              </div>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
              onClick={() => !showPaste && fileRef.current?.click()}
              style={{ border:`2px dashed ${dragOver?"var(--accent)":"var(--line)"}`,
                borderRadius:16, padding:"44px 24px", textAlign:"center",
                cursor:showPaste?"default":"pointer", transition:"all 0.2s",
                background:dragOver?"var(--accent-soft)":"var(--bg-2)" }}
            >
              <div style={{ fontSize:32, marginBottom:10 }}>📊</div>
              <div style={{ fontWeight:600, fontSize:15, marginBottom:6 }}>
                {th ? "ลากไฟล์มาวาง หรือคลิกเพื่อเลือก" : "Drag & drop or click to select"}
              </div>
              <div style={{ fontSize:12, color:"var(--ink-3)" }}>.csv · .txt</div>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display:"none" }}
              onChange={e => { const f=e.target.files[0]; if(f) handleFile(f); e.target.value='' }} />

            {/* Or paste */}
            <div style={{ marginTop:12 }}>
              <button className="btn btn-outline btn-sm" onClick={() => setShowPaste(v => !v)} style={{ width:"100%", justifyContent:"center" }}>
                {showPaste ? (th?"ซ่อน":"Hide") : (th?"วางข้อความ CSV แทน":"Or paste CSV text")}
              </button>
              {showPaste && (
                <div style={{ marginTop:10 }}>
                  <textarea
                    value={pasteText}
                    onChange={e => { setPasteText(e.target.value); setParseError(null) }}
                    placeholder={th ? "วาง CSV ที่นี่…\nDate,Type,Ticker,Shares,Price,Amount,Currency,Note\n2024-01-15,Buy,ADVANC,100,245,24550,THB," : "Paste CSV here…\nDate,Type,Ticker,Shares,Price,Amount,Currency,Note\n2024-01-15,Buy,ADVANC,100,245,24550,THB,"}
                    rows={6}
                    style={{ ...inputStyle, fontFamily:"var(--font-mono)", fontSize:12, resize:"vertical" }}
                  />
                  <button className="btn" style={{ marginTop:8, width:"100%" }} disabled={!pasteText.trim()} onClick={() => processText(pasteText, 'pasted')}>
                    {th ? "วิเคราะห์ข้อความ" : "Parse text"}
                  </button>
                </div>
              )}
            </div>

            {parseError && (
              <div style={{ marginTop:14, padding:"12px 16px", borderRadius:10, background:"oklch(0.96 0.05 25)", color:"oklch(0.40 0.12 25)", fontSize:13, whiteSpace:"pre-line" }}>
                {parseError}
              </div>
            )}

            <div style={{ display:"flex", gap:10, marginTop:20 }}>
              <button type="button" className="btn btn-outline" style={{ flex:1 }} onClick={onClose}>
                {th ? "ยกเลิก" : "Cancel"}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Review */}
        {step === 2 && (
          <div>
            {importResult ? (
              <div style={{ textAlign:"center", padding:"24px 0" }}>
                <div style={{ fontSize:48, marginBottom:12 }}>{importResult.errors.length===0 ? "✅" : "⚠️"}</div>
                <div style={{ fontWeight:600, fontSize:18, marginBottom:8 }}>
                  {importResult.errors.length===0
                    ? (th ? `นำเข้าสำเร็จ ${importResult.ok} รายการ!` : `Imported ${importResult.ok} transactions!`)
                    : (th ? `สำเร็จ ${importResult.ok} · ล้มเหลว ${importResult.errors.length}` : `${importResult.ok} ok · ${importResult.errors.length} failed`)}
                </div>
                {importResult.errors.length > 0 && (
                  <>
                    <div style={{ textAlign:"left", marginTop:12, padding:"10px 14px", background:"oklch(0.97 0.02 25)", borderRadius:10, fontSize:12, color:"oklch(0.40 0.12 25)", maxHeight:160, overflowY:"auto" }}>
                      {importResult.errors.map((e,i) => <div key={i} style={{ marginBottom:2 }}>{e}</div>)}
                    </div>
                    <button className="btn btn-outline" style={{ marginTop:16 }} onClick={onClose}>{th?"ปิด":"Close"}</button>
                  </>
                )}
              </div>
            ) : (
              <>
                {csvInfo && (
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, flexWrap:"wrap", gap:8 }}>
                    <div style={{ fontSize:13, color:"var(--ink-2)" }}>
                      {csvInfo.filename && <span style={{ fontWeight:500, marginRight:6 }}>{csvInfo.filename}</span>}
                      {th ? `พบ ${csvInfo.total} รายการ · เลือก ${selected.size} รายการ` : `Found ${csvInfo.total} rows · ${selected.size} selected`}
                    </div>
                    <button className="btn btn-outline btn-sm" onClick={toggleAll}>
                      {selected.size === rows.length ? (th?"ยกเลิกทั้งหมด":"Deselect all") : (th?"เลือกทั้งหมด":"Select all")}
                    </button>
                  </div>
                )}
                <div style={{ fontSize:12, color:"var(--ink-3)", marginBottom:8 }}>
                  {th ? "✏️ แก้ไขวันที่ ประเภท หรือ Ticker ได้โดยตรงในตาราง" : "✏️ Edit date, type, and ticker inline below"}
                </div>
                <div style={{ maxHeight:380, overflowY:"auto", overflowX:"auto", border:"1px solid var(--line)", borderRadius:10 }}>
                  <table className="table" style={{ fontSize:12 }}>
                    <thead>
                      <tr>
                        <th style={{ width:32, textAlign:"center" }}><input type="checkbox" checked={selected.size===rows.length} onChange={toggleAll}/></th>
                        <th>{th?"วันที่":"Date"}</th>
                        <th>{th?"ประเภท":"Type"}</th>
                        <th>Ticker</th>
                        <th className="num">{th?"จำนวน":"Shares"}</th>
                        <th className="num">{th?"ราคา":"Price"}</th>
                        <th className="num">{th?"มูลค่า":"Amount"}</th>
                        <th className="num">{th?"ค่าธ.":"Fee"}</th>
                        <th>{th?"สกุล":"Ccy"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} style={{ opacity: selected.has(i) ? 1 : 0.35 }}>
                          <td style={{ textAlign:"center" }}>
                            <input type="checkbox" checked={selected.has(i)} onChange={() => toggleRow(i)} />
                          </td>
                          <td>
                            <input type="date" value={r.transacted_at||''} onChange={e => updateRow(i,'transacted_at',e.target.value)}
                              style={{ ...inputStyle, padding:"4px 6px", fontSize:11, width:120 }} />
                          </td>
                          <td>
                            <select value={r.type} onChange={e => updateRow(i,'type',e.target.value)}
                              style={{ ...inputStyle, padding:"4px 6px", fontSize:11, width:"auto" }}>
                              {TX_TYPES.map(t => <option key={t} value={t}>{(typeLabel[lang]||typeLabel.en)[t]}</option>)}
                            </select>
                          </td>
                          <td>
                            <input value={r.ticker||''} onChange={e => updateRow(i,'ticker',e.target.value.toUpperCase())}
                              placeholder="—" style={{ ...inputStyle, padding:"4px 6px", fontSize:11, width:80 }} />
                          </td>
                          <td className="num" style={{ color:"var(--ink-3)" }}>
                            {r.shares!=null ? r.shares.toLocaleString(undefined,{maximumFractionDigits:4}) : "—"}
                          </td>
                          <td className="num" style={{ color:"var(--ink-3)" }}>
                            {r.price!=null ? r.price.toLocaleString(undefined,{maximumFractionDigits:2}) : "—"}
                          </td>
                          <td className="num" style={{ fontWeight:500 }}>
                            {r.amount!=null ? r.amount.toLocaleString(undefined,{maximumFractionDigits:2}) : "—"}
                          </td>
                          <td className="num" style={{ color:"var(--ink-3)" }}>
                            {r.fee>0 ? r.fee.toLocaleString(undefined,{maximumFractionDigits:2}) : "—"}
                          </td>
                          <td style={{ fontSize:11, color:"var(--ink-3)" }}>{r.currency||'THB'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop:10, fontSize:11, color:"var(--ink-4)" }}>
                  {th ? "* แก้ไขเพิ่มเติมได้หลังนำเข้าในหน้า Transactions" : "* You can edit further after import in the Transactions tab."}
                </div>
                <div style={{ display:"flex", gap:10, marginTop:16, position:"sticky", bottom:0, background:"var(--bg)", paddingTop:14, paddingBottom:2 }}>
                  <button className="btn btn-outline" style={{ flex:1 }} onClick={() => { setStep(1); setImportResult(null) }} disabled={importing}>
                    {th ? "← ย้อนกลับ" : "← Back"}
                  </button>
                  <button className="btn" style={{ flex:2 }} onClick={handleImport} disabled={importing || selected.size===0}>
                    {importing ? (th?"กำลังนำเข้า…":"Importing…") : (th?`นำเข้า ${selected.size} รายการ`:`Import ${selected.size} transactions`)}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Cash Tab ─────────────────────────────────────────────────────────────────
function CashTab({ lang, ccy, portfolioId, cashAccounts, refreshCashAccounts, fxRate }) {
  const th = lang === "th"
  const FMT = LUMEN_FMT
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)

  const total = cashAccounts.reduce((s, a) => s + (a.currency === "USD" ? (a.balance || 0) * fxRate : (a.balance || 0)), 0)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>{th ? "รวมเงินสดทั้งหมด" : "Total cash"}</div>
          <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-display)" }}>{FMT.money(total, ccy, { compact: true })}</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => setShowAdd(true)}>
          <Icon name="plus" size={13} /> {th ? "เพิ่มบัญชี" : "Add account"}
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
        {cashAccounts.map(a => {
          const bal = a.currency === "USD" ? (a.balance || 0) * fxRate : (a.balance || 0)
          const isEmergency = a.icon === "shield" && a.target_balance > 0
          const targetBal = isEmergency ? (a.currency === "USD" ? a.target_balance * fxRate : a.target_balance) : 0
          const pct = isEmergency ? Math.min(100, (bal / targetBal) * 100) : 0
          const full = isEmergency && bal >= targetBal
          return (
            <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "14px 16px", borderRadius: 12, border: `1px solid ${isEmergency ? (full ? "oklch(0.85 0.08 150)" : "oklch(0.85 0.08 60)") : "var(--line)"}`, background: "var(--bg)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--accent-soft)", color: "var(--accent-ink)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Icon name={a.icon || "deposit"} size={15} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</div>
                  <div style={{ fontSize: 14, fontFamily: "var(--font-display)", fontWeight: 700 }}>{FMT.money(bal, ccy, { compact: true })}</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={() => setEditing(a)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", padding: "3px 6px", borderRadius: 6, fontSize: 14 }}>✎</button>
                  <button onClick={async () => { if (!window.confirm(th ? "ลบบัญชีนี้?" : "Delete?")) return; await deleteCashAccount(a.id); refreshCashAccounts?.() }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-4)", padding: "3px 5px", borderRadius: 6, fontSize: 16 }}>×</button>
                </div>
              </div>
              {isEmergency && (
                <div>
                  <div style={{ height: 4, borderRadius: 2, background: "var(--line)", overflow: "hidden", marginBottom: 3 }}>
                    <div style={{ height: "100%", width: `${pct}%`, borderRadius: 2, background: full ? "oklch(0.55 0.15 150)" : "oklch(0.65 0.15 60)" }} />
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                    {full ? `✓ ${th ? "เต็มเป้า" : "Target met"}` : `${pct.toFixed(0)}% ${th ? "ของเป้า" : "of"} ${FMT.money(targetBal, ccy, { compact: true })}`}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {cashAccounts.length === 0 && (
          <div style={{ gridColumn: "1/-1", padding: "32px 0", textAlign: "center" }}>
            <p className="muted">{th ? "ยังไม่มีบัญชีเงินสด" : "No cash accounts yet"}</p>
          </div>
        )}
      </div>
      {(showAdd || editing) && (
        <PortfolioCashModal lang={lang} ccy={ccy} portfolioId={portfolioId}
          account={editing}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onSaved={async () => { setShowAdd(false); setEditing(null); await refreshCashAccounts?.() }}
        />
      )}
    </div>
  )
}

// Lightweight cash modal reused from Dashboard (same logic, no dependency on Dashboard)
function PortfolioCashModal({ lang, ccy, portfolioId, account, onClose, onSaved }) {
  const th = lang === "th"
  const isEdit = account != null
  const [form, setForm] = useState({
    label: account?.label ?? "", balance: account?.balance != null ? String(account.balance) : "",
    currency: account?.currency ?? "THB", icon: account?.icon ?? "deposit",
    target_balance: account?.target_balance != null ? String(account.target_balance) : "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const ICONS = [
    { k: "deposit", label: th ? "ทั่วไป" : "General" }, { k: "shield", label: th ? "สำรอง" : "Emergency" },
    { k: "dividend", label: th ? "ปันผล" : "Dividend" }, { k: "home", label: th ? "บ้าน" : "Home" },
    { k: "leaf", label: th ? "ระยะยาว" : "Long-term" }, { k: "currency", label: th ? "ต่างประเทศ" : "Foreign" },
  ]
  const handleSubmit = async (e) => {
    e.preventDefault(); if (!portfolioId) return
    setSaving(true); setError(null)
    const { error } = await upsertCashAccount(portfolioId, {
      ...(isEdit ? { id: account.id } : {}),
      label: form.label.trim(), balance: parseFloat(form.balance) || 0,
      currency: form.currency, icon: form.icon,
      target_balance: form.icon === "shield" && form.target_balance ? parseFloat(form.target_balance) || null : null,
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    onSaved()
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "var(--bg)", borderRadius: 18, padding: 28, width: "100%", maxWidth: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{isEdit ? (th ? "แก้ไขบัญชี" : "Edit account") : (th ? "เพิ่มบัญชี" : "Add account")}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-3)" }}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error && <div style={{ padding: "8px 12px", borderRadius: 8, background: "oklch(0.96 0.05 25)", color: "oklch(0.40 0.12 25)", fontSize: 13 }}>{error}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{th ? "ชื่อบัญชี" : "Label"}</label>
            <input required value={form.label} onChange={e => set("label", e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 6 }}>
            {ICONS.map(opt => (
              <button key={opt.k} type="button" title={opt.label} onClick={() => set("icon", opt.k)}
                style={{ display: "grid", placeItems: "center", aspectRatio: "1", borderRadius: 9, cursor: "pointer", border: form.icon === opt.k ? "1.5px solid var(--accent)" : "1.5px solid var(--line)", background: form.icon === opt.k ? "var(--accent-soft)" : "var(--bg-2)", color: form.icon === opt.k ? "var(--accent-ink)" : "var(--ink-3)" }}>
                <Icon name={opt.k} size={16} />
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{th ? "ยอดคงเหลือ" : "Balance"}</label>
              <CalcInput required value={form.balance} onChange={e => set("balance", e.target.value)} placeholder="0.00" style={inputStyle} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{th ? "สกุล" : "Ccy"}</label>
              <select value={form.currency} onChange={e => set("currency", e.target.value)} style={inputStyle}>
                <option value="THB">THB</option><option value="USD">USD</option>
              </select>
            </div>
          </div>
          {form.icon === "shield" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", borderRadius: 9, background: "oklch(0.97 0.03 60)", border: "1px solid oklch(0.88 0.06 60)" }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "oklch(0.50 0.12 60)", textTransform: "uppercase", letterSpacing: "0.06em" }}>🛡 {th ? "งบฉุกเฉิน (เป้าหมาย)" : "Emergency target"}</label>
              <CalcInput value={form.target_balance} onChange={e => set("target_balance", e.target.value)} placeholder={th ? "เช่น 90000" : "e.g. 90000"} style={inputStyle} />
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>{th ? "ยกเลิก" : "Cancel"}</button>
            <button type="submit" className="btn" style={{ flex: 1 }} disabled={saving}>{saving ? "…" : (th ? "บันทึก" : "Save")}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Categories Tab ───────────────────────────────────────────────────────────
function CategoriesTab({ rows, lang, ccy, fxRate }) {
  const th = lang === "th"
  const FMT = LUMEN_FMT
  const [mode, setMode] = useState("regionclass")
  const [expanded, setExpanded] = useState(new Set())
  const [sortKey, setSortKey] = useState("allocPct")
  const [sortDir, setSortDir] = useState("desc")

  const MODES = [
    { k: "regionclass", label: th ? "ภูมิภาค + ประเภท" : "Region + class" },
    { k: "class",       label: th ? "ประเภทสินทรัพย์" : "Asset class" },
    { k: "region",      label: th ? "ภูมิภาค" : "Region" },
    { k: "sector",      label: th ? "กลุ่มอุตสาหกรรม" : "By sector" },
  ]

  const table = useMemo(() => {
    if (rows.length === 0) return []
    const keyOf = r => {
      if (mode === "class") return r.cls || "Equity"
      if (mode === "region") return r.region === "TH" ? (th ? "ไทย" : "Thailand") : (th ? "สหรัฐฯ" : "United States")
      if (mode === "sector") return r.sector && r.sector !== "—" ? r.sector : (th ? "ไม่ระบุกลุ่ม" : "Unassigned")
      return r.cls === "Equity" ? (r.region === "TH" ? (th ? "หุ้นไทย" : "TH Equity") : (th ? "หุ้น US" : "US Equity")) : r.cls
    }
    const colors = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"]
    const map = {}
    rows.forEach(r => {
      const k = keyOf(r)
      if (!map[k]) map[k] = { name: k, value: 0, costBasis: 0, pl: 0, holdings: [] }
      map[k].value += r.value; map[k].costBasis += r.shares * r.cost; map[k].pl += r.pl; map[k].holdings.push(r)
    })
    const total = rows.reduce((s, r) => s + r.value, 0)
    return Object.values(map).map((g, i) => ({
      ...g, plPct: g.costBasis > 0 ? (g.pl / g.costBasis) * 100 : 0,
      allocPct: total > 0 ? (g.value / total) * 100 : 0,
      count: new Set(g.holdings.map(r => r.ticker)).size,
      color: colors[i % colors.length],
    }))
  }, [rows, mode, th])

  const sorted = useMemo(() => [...table].sort((a, b) => {
    const cmp = (a[sortKey] ?? 0) - (b[sortKey] ?? 0)
    return sortDir === "asc" ? cmp : -cmp
  }), [table, sortKey, sortDir])

  const toggleSort = k => { if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(k); setSortDir("desc") } }
  const toggleExpand = name => setExpanded(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })

  const groupByTicker = (rs) => {
    const m = new Map()
    rs.forEach(r => {
      if (!m.has(r.ticker)) m.set(r.ticker, { ...r })
      else { const g = m.get(r.ticker); m.set(r.ticker, { ...g, value: g.value + r.value, pl: g.pl + r.pl, shares: g.shares + r.shares }) }
    })
    return [...m.values()]
  }

  const thStyle = k => ({ padding: "10px 14px", textAlign: "right", fontWeight: 600, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: sortKey === k ? "var(--accent-ink)" : "var(--ink-3)", cursor: "pointer", userSelect: "none" })

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <select value={mode} onChange={e => setMode(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 8, fontSize: 12, border: "1.5px solid var(--line)", background: "var(--bg)", color: "var(--ink)", outline: "none", cursor: "pointer" }}>
          {MODES.map(m => <option key={m.k} value={m.k}>{m.label}</option>)}
        </select>
      </div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>{th ? "กลุ่ม" : "Category"}</th>
              <th onClick={() => toggleSort("value")} style={thStyle("value")}>{th ? "มูลค่า / ต้นทุน" : "Value / Cost"} {sortKey === "value" ? (sortDir === "desc" ? "↓" : "↑") : ""}</th>
              <th onClick={() => toggleSort("pl")} style={thStyle("pl")}>{th ? "กำไร/ขาดทุน" : "Gain"} {sortKey === "pl" ? (sortDir === "desc" ? "↓" : "↑") : ""}</th>
              <th onClick={() => toggleSort("allocPct")} style={thStyle("allocPct")}>{th ? "สัดส่วน" : "Alloc."} {sortKey === "allocPct" ? (sortDir === "desc" ? "↓" : "↑") : ""}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((g, gi) => {
              const isExp = expanded.has(g.name)
              return (
                <Fragment key={g.name}>
                  <tr onClick={() => g.holdings.length > 0 && toggleExpand(g.name)}
                    style={{ borderBottom: isExp ? "none" : gi < sorted.length - 1 ? "1px solid var(--line)" : "none", cursor: g.holdings.length > 0 ? "pointer" : "default" }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--bg-2)"}
                    onMouseLeave={e => e.currentTarget.style.background = ""}>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 4, height: 32, borderRadius: 2, background: g.color, flexShrink: 0 }} />
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: g.color + "22", display: "grid", placeItems: "center", flexShrink: 0, overflow: "hidden" }}>
                          <AllocCategoryIcon name={g.name} color={g.color} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{g.name}</div>
                          <div className="muted" style={{ fontSize: 10 }}>{g.count} {th ? "รายการ" : "items"}</div>
                        </div>
                        {g.holdings.length > 0 && <span style={{ marginLeft: "auto", color: "var(--ink-4)", fontSize: 11, transform: isExp ? "rotate(90deg)" : "none", display: "inline-block", transition: "transform 0.2s" }}>›</span>}
                      </div>
                    </td>
                    <td style={{ padding: "12px 14px", textAlign: "right" }}>
                      <div style={{ fontWeight: 500 }}>{FMT.money(g.value, ccy, { compact: true })}</div>
                      <div className="muted" style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>{FMT.money(g.costBasis, ccy, { compact: true })}</div>
                    </td>
                    <td style={{ padding: "12px 14px", textAlign: "right" }}>
                      <div style={{ fontWeight: 500, color: g.pl >= 0 ? "var(--gain)" : "var(--loss)" }}>{g.pl >= 0 ? "+" : ""}{FMT.money(g.pl, ccy, { compact: true })}</div>
                      <div style={{ fontSize: 11, color: g.pl >= 0 ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)" }}>{g.plPct >= 0 ? "+" : ""}{g.plPct.toFixed(1)}%</div>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <div style={{ fontWeight: 700 }}>{g.allocPct.toFixed(1)}%</div>
                      <div style={{ height: 3, borderRadius: 99, background: "var(--line)", marginTop: 3 }}>
                        <div style={{ height: "100%", width: g.allocPct + "%", background: g.color, borderRadius: 99 }} />
                      </div>
                    </td>
                  </tr>
                  {isExp && groupByTicker(g.holdings).map((h, hi, arr) => (
                    <tr key={h.ticker} style={{ background: "var(--bg-2)", borderBottom: hi === arr.length - 1 ? "1px solid var(--line)" : "none" }}>
                      <td style={{ padding: "8px 16px 8px 58px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <TickerLogo ticker={h.ticker} logoUrl={h.logo_url} region={h.region} cls={h.cls} size={24} />
                          <div><div style={{ fontSize: 12, fontWeight: 500 }}>{h.ticker}</div><div className="muted" style={{ fontSize: 10 }}>{h.name}</div></div>
                        </div>
                      </td>
                      <td style={{ padding: "8px 14px", textAlign: "right" }}>
                        <div style={{ fontSize: 12 }}>{FMT.money(h.value, ccy, { compact: true })}</div>
                        <div className="muted" style={{ fontSize: 10, fontFamily: "var(--font-mono)" }}>{FMT.money(h.shares * h.cost, ccy, { compact: true })}</div>
                      </td>
                      <td style={{ padding: "8px 14px", textAlign: "right" }}>
                        <div style={{ fontSize: 12, color: h.pl >= 0 ? "var(--gain)" : "var(--loss)" }}>{h.pl >= 0 ? "+" : ""}{FMT.money(h.pl, ccy, { compact: true })}</div>
                        <div style={{ fontSize: 10, color: h.pl >= 0 ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)" }}>{h.plPct >= 0 ? "+" : ""}{h.plPct?.toFixed(1)}%</div>
                      </td>
                      <td style={{ padding: "8px 16px", textAlign: "right" }}>
                        <div className="muted" style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>
                          {rows.reduce((s, r) => s + r.value, 0) > 0 ? (h.value / rows.reduce((s, r) => s + r.value, 0) * 100).toFixed(1) : "0.0"}%
                        </div>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Demo Portfolio (unchanged) ──────────────────────────────────────────────
function DemoPortfolioPage({ t, lang, ccy, setRoute }) {
  const derived = useMemo(() => LUMEN_DERIVE(), [])
  const { rows, value, pl, plPct, cash } = derived
  const [sortKey, setSortKey] = useState("value")
  const [sortDir, setSortDir] = useState("desc")
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState("all")
  const th = lang === "th"

  const sorted = useMemo(() => {
    let list = rows
    if (q) list = list.filter(r => (r.ticker + r.name).toLowerCase().includes(q.toLowerCase()))
    if (filter !== "all") list = list.filter(r => {
      if (filter === "TH") return r.region === "TH"
      if (filter === "US") return r.region === "US" && r.cls !== "Crypto"
      if (filter === "Crypto") return r.cls === "Crypto"
      if (filter === "Bonds") return r.cls === "Bond"
      return true
    })
    return [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir, q, filter])

  const setSort = k => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(k); setSortDir("desc") }
  }

  const filters = [
    { id: "all",       label: th ? "ทั้งหมด"  : "All",       count: rows.length },
    { id: "TH",        label: th ? "หุ้นไทย"  : "TH stocks", count: rows.filter(r => r.region === "TH").length },
    { id: "US",        label: th ? "หุ้น US"  : "US stocks", count: rows.filter(r => r.region === "US" && r.cls !== "Crypto").length },
    { id: "Bonds",     label: th ? "พันธบัตร" : "Bonds",     count: rows.filter(r => r.cls === "Bond").length },
    { id: "Crypto",    label: th ? "คริปโต"   : "Crypto",    count: rows.filter(r => r.cls === "Crypto").length },
  ]

  return (
    <div className="shell fade-in" data-screen-label="Portfolio">
      <PageHead
        title={t.portfolio.heading}
        sub={t.portfolio.sub}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-outline btn-sm"><Icon name="upload" size={14} /> {th ? "นำเข้า" : "Import"}</button>
            <button className="btn btn-sm"><Icon name="plus" size={14} /> {t.common.addInvestment}</button>
          </div>
        }
      />

      <section className="card" style={{ padding: "24px 28px", marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr", gap: 24, alignItems: "center" }}>
          <div>
            <div className="label-up" style={{ marginBottom: 6 }}>{t.portfolio.total}</div>
            <div className="display" style={{ fontSize: 36, lineHeight: 1 }}>{LUMEN_FMT.money(value + cash, ccy)}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {rows.length} {th ? "ตำแหน่ง · หลายหมวด" : "positions · asset classes"}
            </div>
          </div>
          <PortMetric label={th ? "กำไร/ขาดทุน รวม" : "Unrealized P/L"}
                  value={(pl >= 0 ? "+" : "") + LUMEN_FMT.money(pl, ccy, { compact: true })} sub={<Delta value={plPct} />} />
          <PortMetric label={th ? "ปันผล/ปี (ประมาณ)" : "Est. annual dividends"}
                  value={LUMEN_FMT.money(rows.reduce((a, b) => a + b.value * b.divYield / 100, 0), ccy, { compact: true })}
                  sub={<span className="mono">{(rows.reduce((a, b) => a + b.value * b.divYield / 100, 0) / value * 100).toFixed(2)}% yield</span>} />
          <PortMetric label={th ? "ใหญ่สุด" : "Largest position"}
                  value={[...rows].sort((a, b) => b.value - a.value)[0].ticker}
                  sub={<span className="mono">{[...rows].sort((a, b) => b.value - a.value)[0].weight.toFixed(1)}%</span>} />
          <PortMetric label={th ? "สัดส่วนเงินสด" : "Cash weight"}
                  value={(cash / (value + cash) * 100).toFixed(1) + "%"} sub={LUMEN_FMT.money(cash, ccy, { compact: true })} />
        </div>
      </section>

      <section style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {filters.map(f => (
            <button key={f.id}
                    className={"chip " + (filter === f.id ? "chip-soft" : "")}
                    style={{ cursor: "pointer", padding: "6px 12px", fontSize: 12 }}
                    onClick={() => setFilter(f.id)}>
              {f.label} <span style={{ opacity: 0.6, marginLeft: 4 }}>{f.count}</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 999, padding: "6px 14px", width: 240 }}>
          <Icon name="search" size={14} />
          <input type="text" placeholder={t.common.search} value={q} onChange={e => setQ(e.target.value)}
                 style={{ border: 0, outline: 0, background: "transparent", flex: 1, fontSize: 13 }} />
        </div>
      </section>

      <section className="card tbl-card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="table">
          <thead>
            <tr>
              <SortHeader id="ticker" label={t.portfolio.holding} sortKey={sortKey} sortDir={sortDir} onSort={setSort} />
              <SortHeader id="shares" label={t.portfolio.shares} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
              <SortHeader id="cost" label={t.portfolio.cost} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
              <SortHeader id="value" label={t.portfolio.value} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
              <th className="num">{th ? "30 วัน" : "30d"}</th>
              <SortHeader id="pl" label={t.portfolio.pl} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
              <SortHeader id="weight" label={t.portfolio.weight} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => {
              const sparkData = Array.from({ length: 20 }, (_, i) =>
                Math.sin(i / 2 + r.ticker.length) + Math.cos(i / 3 + r.ticker.length * 1.3) + (i / 20) * (r.plPct / 50))
              return (
                <tr key={r.ticker}>
                  <td>
                    <div className="ticker">
                      <div className="ticker-mark" style={{ background: classBg(r.cls), color: classFg(r.cls) }}>
                        {r.ticker.slice(0, 2)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{r.ticker}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{r.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num">{r.shares.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                  <td className="num">{LUMEN_FMT.money(r.cost, ccy, { compact: true })}</td>
                  <td className="num" style={{ fontWeight: 500 }}>{LUMEN_FMT.money(r.value, ccy, { compact: true })}</td>
                  <td className="num"><Sparkline data={sparkData} stroke={r.plPct > 0 ? "var(--gain)" : "var(--loss)"} fill={r.plPct > 0 ? "var(--gain)" : "var(--loss)"} /></td>
                  <td className="num">
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                      <span style={{ color: r.pl >= 0 ? "var(--gain)" : "var(--loss)" }}>
                        {r.pl >= 0 ? "+" : ""}{LUMEN_FMT.money(r.pl, ccy, { compact: true })}
                      </span>
                      <Delta value={r.plPct} size={11} />
                    </div>
                  </td>
                  <td className="num">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                      <div className="bar" style={{ width: 50 }}>
                        <span style={{ width: Math.min(100, r.weight * 3) + "%", background: classFg(r.cls) }} />
                      </div>
                      <span style={{ minWidth: 36 }}>{r.weight.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td style={{ color: "var(--ink-4)", width: 24 }}><Icon name="chevron" size={14} /></td>
                </tr>
              )
            })}
            <tr style={{ background: "var(--bg)", fontWeight: 500 }}>
              <td style={{ paddingTop: 18, paddingBottom: 18 }}><span className="label-up">{t.portfolio.total}</span></td>
              <td></td>
              <td className="num">{LUMEN_FMT.money(rows.reduce((a, b) => a + b.cost, 0), ccy, { compact: true })}</td>
              <td className="num" style={{ fontWeight: 600 }}>{LUMEN_FMT.money(value, ccy, { compact: true })}</td>
              <td></td>
              <td className="num">
                <span style={{ color: pl >= 0 ? "var(--gain)" : "var(--loss)" }}>
                  {pl >= 0 ? "+" : ""}{LUMEN_FMT.money(pl, ccy, { compact: true })}
                </span>
              </td>
              <td className="num">100.0%</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </section>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, color: "var(--ink-3)", fontSize: 12 }}>
        <span>{th ? `แสดง ${sorted.length} จาก ${rows.length} ตำแหน่ง` : `Showing ${sorted.length} of ${rows.length} positions`}</span>
        <span>{th ? "ราคาดีเลย์ 15 นาที" : "Prices delayed 15 min"}</span>
      </div>
    </div>
  )
}

function SortHeader({ id, label, sortKey, sortDir, onSort, align = "left" }) {
  const active = sortKey === id
  return (
    <th style={{ textAlign: align, cursor: "pointer" }} onClick={() => onSort(id)}>
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center", color: active ? "var(--ink)" : "var(--ink-3)" }}>
        {label}
        {active ? (sortDir === "asc"
          ? <svg width="8" height="8" viewBox="0 0 8 8"><path d="M4 1 L7 6 H1 Z" fill="currentColor" /></svg>
          : <svg width="8" height="8" viewBox="0 0 8 8"><path d="M4 7 L1 2 H7 Z" fill="currentColor" /></svg>
        ) : null}
      </span>
    </th>
  )
}

function PortMetric({ label, value, sub, onClick }) {
  return (
    <div onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined} title={onClick ? "ดูรายละเอียด" : undefined}>
      <div className="label-up" style={{ marginBottom: 6 }}>{label}{onClick && <span style={{ marginLeft: 4, color: "var(--ink-4)" }}>›</span>}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1, letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>{sub}</div>
    </div>
  )
}

function classBg(cls) {
  return { Equity: "var(--bg-2)", ETF: "oklch(0.94 0.04 200)", Bond: "oklch(0.94 0.04 280)", Crypto: "oklch(0.94 0.05 65)", Commodity: "oklch(0.94 0.04 90)" }[cls] || "var(--bg-2)"
}
function classFg(cls) {
  return { Equity: "var(--ink-2)", ETF: "var(--c1)", Bond: "var(--c4)", Crypto: "var(--c2)", Commodity: "var(--c7)" }[cls] || "var(--ink-2)"
}

