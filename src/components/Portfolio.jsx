import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { PageHead, Delta, Icon } from './Nav'
import { Sparkline } from './Charts'
import { LUMEN_FMT, LUMEN_DERIVE } from '../data'
import { addHolding, updateHolding, deleteHolding, deriveHoldings, addTransaction, syncHoldingsFromTransactions, rebuildHolding, getTransactions, updateTransaction, deleteTransaction, deleteTransactionsByTicker } from '../lib/db'

export function PortfolioPage({ t, lang, ccy, setRoute, dataState, portfolio, liveHoldings = [], prices = {}, refreshHoldings, loadingData, dataError, retryLoad, fxRate = 36 }) {
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
      />
    )
  }

  // ── Demo mode ────────────────────────────────────────────────────────────────
  return <DemoPortfolioPage t={t} lang={lang} ccy={ccy} setRoute={setRoute} setShowAdd={setShowAdd} />
}

// ─── Live Portfolio ──────────────────────────────────────────────────────────
function LivePortfolioPage({ t, lang, ccy, portfolio, liveHoldings, prices = {}, refreshHoldings, loadingData, showAdd, setShowAdd, fxRate = 36 }) {
  const th = lang === "th"
  const [tab, setTab] = useState("holdings")
  const [deleting, setDeleting] = useState(null)
  const [editHolding, setEditHolding] = useState(null)
  const [sortKey, setSortKey] = useState("value")
  const [sortDir, setSortDir] = useState("desc")
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState("all")
  const [transactions, setTransactions] = useState([])
  const [txLoading, setTxLoading] = useState(false)

  const loadTransactions = useCallback(async () => {
    if (!portfolio?.id) return
    setTxLoading(true)
    try {
      const data = await getTransactions(portfolio.id)
      setTransactions(data)
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

  const totalValue     = rows.reduce((s, r) => s + r.value, 0)
  const totalPL        = rows.reduce((s, r) => s + r.pl, 0)
  const totalCostBasis = totalValue - totalPL
  const totalPlPct     = totalCostBasis > 0 ? (totalPL / totalCostBasis) * 100 : 0
  const hasLivePrices  = rows.some(r => r.hasLivePrice)
  const annualDiv      = rows.reduce((s, r) => s + r.value * (r.divYield || 0) / 100, 0)
  const largestPos     = rows.length > 0 ? [...rows].sort((a, b) => b.value - a.value)[0] : null

  // All positions merged — used for filter counts and footer total
  const allGrouped = useMemo(() => groupByTicker(rows), [rows])

  // Filter chip definitions — counts based on merged positions, not raw lots
  const filterDefs = useMemo(() => [
    { id: "all",    label: th ? "ทั้งหมด" : "All",       count: allGrouped.length },
    { id: "TH",     label: th ? "หุ้นไทย" : "TH",        count: allGrouped.filter(r => r.region === "TH").length },
    { id: "US",     label: th ? "หุ้น US" : "US",        count: allGrouped.filter(r => r.region === "US").length },
    { id: "ETF",    label: "ETF",                         count: allGrouped.filter(r => r.cls === "ETF").length },
    { id: "Bond",   label: th ? "พันธบัตร" : "Bonds",    count: allGrouped.filter(r => r.cls === "Bond").length },
    { id: "Crypto", label: th ? "คริปโต" : "Crypto",     count: allGrouped.filter(r => r.cls === "Crypto").length },
  ].filter(f => f.id === "all" || f.count > 0), [allGrouped, th])

  const grouped = useMemo(() => {
    let list = rows
    if (filter !== "all") list = list.filter(r => {
      if (filter === "TH")     return r.region === "TH"
      if (filter === "US")     return r.region === "US"
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
        <button className={tab === "transactions" ? "on" : ""} onClick={() => setTab("transactions")}>
          {th ? "ประวัติธุรกรรม" : "Transactions"}
        </button>
      </div>

      {tab === "transactions" ? (
        <TransactionsTab transactions={transactions} loading={txLoading} lang={lang} ccy={ccy} fxRate={fxRate} onReload={async () => { await loadTransactions(); await refreshHoldings?.() }} portfolioId={portfolio?.id} />
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
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr 1fr", gap: 24, alignItems: "center" }}>
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
          <section className="card" style={{ padding: 0, overflow: "hidden" }}>
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
                  const sparkData = Array.from({ length: 20 }, (_, i) =>
                    Math.sin(i / 2 + r.ticker.length) + Math.cos(i / 3 + r.ticker.length * 1.3) + (i / 20) * ((r.changePct || r.plPct / 10) > 0 ? 0.6 : -0.6))
                  const sparkColor = (r.changePct || r.plPct) >= 0 ? "var(--gain)" : "var(--loss)"
                  return (
                    <tr key={r.ticker} style={{ opacity: deleting && r._ids.includes(deleting) ? 0.4 : 1 }}>
                      <td>
                        <div className="ticker">
                          <div className="ticker-mark" style={{ background: classBg(r.cls), color: classFg(r.cls) }}>
                            {r.ticker.slice(0, 2)}
                          </div>
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
                      <td><Sparkline data={sparkData} stroke={sparkColor} fill={sparkColor} /></td>
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
    const { data: newHolding, error: addErr } = await addHolding(portfolioId, {
      ticker: form.ticker.toUpperCase(),
      name: form.name,
      asset_class: form.asset_class,
      region: form.region,
      sector: form.sector || null,
      shares,
      cost_price,
      currency: form.currency,
      div_yield: form.div_yield ? parseFloat(form.div_yield) : 0,
      div_frequency: form.div_frequency ? parseInt(form.div_frequency) : 4,
    })
    setSaving(false)
    if (addErr) { setError(addErr.message); return }
    // Auto-log transaction with actual purchase date
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
        fee:    form.fee  ? parseFloat(form.fee)  : 0,
        tax:    form.tax  ? parseFloat(form.tax)  : 0,
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
      display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000,
      overflowY: "auto", padding: "24px 16px",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg)", borderRadius: 20, padding: "32px 28px 40px",
        width: "100%", maxWidth: 560, margin: "auto",
        boxShadow: "0 8px 48px rgba(0,0,0,0.18)",
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
              <input required type="number" step="any" min="0" value={form.shares}
                     onChange={e => set('shares', e.target.value)}
                     placeholder="0" style={inputStyle} />
            </Field>
            <Field label={th ? "ราคาทุน/หุ้น" : "Cost price/share"}>
              <input required type="number" step="any" min="0" value={form.cost_price}
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
              <input type="number" step="any" min="0" max="100" value={form.div_yield}
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
              <input type="number" step="any" min="0" value={form.fee}
                     onChange={e => set('fee', e.target.value)}
                     placeholder="0.00" style={inputStyle} />
            </Field>
            <Field label={th ? "ภาษี / อากร (ไม่บังคับ)" : "Tax / Duty (optional)"}>
              <input type="number" step="any" min="0" value={form.tax}
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

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
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
    })
    setSaving(false)
    if (updateErr) { setError(updateErr.message); return }
    onSaved()
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000,
      overflowY: "auto", padding: "24px 16px",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg)", borderRadius: 20, padding: "32px 28px 40px",
        width: "100%", maxWidth: 560, margin: "auto",
        boxShadow: "0 8px 48px rgba(0,0,0,0.18)",
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
              <input required type="number" step="any" min="0" value={form.shares}
                     onChange={e => set('shares', e.target.value)} placeholder="0" style={inputStyle} />
            </Field>
            <Field label={th ? "ราคาทุน/หุ้น" : "Cost price/share"}>
              <input required type="number" step="any" min="0" value={form.cost_price}
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
              <input type="number" step="any" min="0" max="100" value={form.div_yield}
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

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
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
function TransactionsTab({ transactions, loading, lang, ccy, fxRate = 36, onReload, portfolioId }) {
  const th = lang === "th"
  const [editTx, setEditTx] = useState(null)     // tx object being edited
  const [deleting, setDeleting] = useState(null)  // id being deleted
  const [showImport, setShowImport] = useState(false)

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
        <button className="btn btn-outline btn-sm" style={{ marginTop: 16 }} onClick={() => setShowImport(true)}>
          <Icon name="upload" size={13} /> {th ? "นำเข้า PDF" : "Import PDF"}
        </button>
      </div>
      {showImport && portfolioId && (
        <ImportPDFModal lang={lang} portfolioId={portfolioId}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); onReload?.() }} />
      )}
    </>
  )

  const typeColor = { Buy: "var(--gain)", Sell: "var(--loss)", Dividend: "var(--accent-ink)", Deposit: "var(--ink-2)", Withdraw: "var(--ink-2)" }
  const typeBg    = { Buy: "var(--gain-soft)", Sell: "var(--loss-soft)", Dividend: "var(--accent-soft)", Deposit: "var(--bg-2)", Withdraw: "var(--bg-2)" }
  const typeLabel = { en: { Buy: "Buy", Sell: "Sell", Dividend: "Dividend", Deposit: "Deposit", Withdraw: "Withdraw" }, th: { Buy: "ซื้อ", Sell: "ขาย", Dividend: "ปันผล", Deposit: "ฝาก", Withdraw: "ถอน" } }
  const typeIcon  = { Buy: "buy", Sell: "sell", Dividend: "dividend", Deposit: "deposit", Withdraw: "deposit" }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button className="btn btn-outline btn-sm" onClick={() => setShowImport(true)}>
          <Icon name="upload" size={13} /> {th ? "นำเข้า PDF" : "Import PDF"}
        </button>
      </div>
      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
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
            {transactions.map(tx => {
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
                      <button
                        onClick={() => setEditTx(tx)}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: 6, color: "var(--ink-3)", lineHeight: 1 }}
                        title={th ? "แก้ไข" : "Edit"}
                      >
                        <Icon name="edit" size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(tx)}
                        disabled={deleting === tx.id}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: 6, color: "var(--loss)", lineHeight: 1 }}
                        title={th ? "ลบ" : "Delete"}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {editTx && (
        <EditTransactionModal
          tx={editTx}
          lang={lang}
          onClose={() => setEditTx(null)}
          onSaved={async (updated) => {
            // Re-sync holdings for the affected ticker(s) — handles renames too
            if (portfolioId) {
              const tickers = new Set([editTx.ticker, updated?.ticker].filter(Boolean))
              for (const tk of tickers) await rebuildHolding(portfolioId, tk)
            }
            setEditTx(null); onReload?.()
          }}
        />
      )}
      {showImport && portfolioId && (
        <ImportPDFModal lang={lang} portfolioId={portfolioId}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); onReload?.() }} />
      )}
    </>
  )
}

// ─── Edit Transaction Modal ───────────────────────────────────────────────────
function EditTransactionModal({ tx, lang, onClose, onSaved }) {
  const th = lang === "th"
  const toDateInput = (v) => {
    if (!v) return new Date().toISOString().split('T')[0]
    return new Date(v).toISOString().split('T')[0]
  }
  const [form, setForm] = useState({
    type:         tx.type || 'Buy',
    ticker:       tx.ticker || '',
    shares:       tx.shares != null ? String(tx.shares) : '',
    price:        tx.price  != null ? String(tx.price)  : '',
    amount:       tx.amount != null ? String(tx.amount) : '',
    fee:          tx.fee    != null && tx.fee  !== 0 ? String(tx.fee)  : '',
    tax:          tx.tax    != null && tx.tax  !== 0 ? String(tx.tax)  : '',
    currency:     tx.currency || 'THB',
    note:         tx.note || '',
    transacted_at: toDateInput(tx.transacted_at),
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

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
      note:          form.note || null,
      transacted_at: form.transacted_at,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved({ ticker: form.ticker.toUpperCase() || null })
  }

  const TX_TYPES = ['Buy', 'Sell', 'Dividend', 'Deposit', 'Withdraw']
  const typeLabel = { en: { Buy: "Buy", Sell: "Sell", Dividend: "Dividend", Deposit: "Deposit", Withdraw: "Withdraw" }, th: { Buy: "ซื้อ", Sell: "ขาย", Dividend: "ปันผล", Deposit: "ฝาก", Withdraw: "ถอน" } }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1000,
      overflowY: "auto", padding: "24px 16px",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg)", borderRadius: 20, padding: "32px 28px 40px",
        width: "100%", maxWidth: 520, margin: "auto",
        boxShadow: "0 8px 48px rgba(0,0,0,0.18)",
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

          {/* Type + Ticker */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "ประเภท" : "Type"}>
              <select value={form.type} onChange={e => set('type', e.target.value)} style={inputStyle}>
                {TX_TYPES.map(t => <option key={t} value={t}>{(typeLabel[lang] || typeLabel.en)[t]}</option>)}
              </select>
            </Field>
            <Field label={th ? "ติ๊กเกอร์" : "Ticker"}>
              <input value={form.ticker} onChange={e => set('ticker', e.target.value)}
                     placeholder="e.g. PTT" style={inputStyle} />
            </Field>
          </div>

          {/* Shares + Price */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "จำนวนหุ้น" : "Shares"}>
              <input type="number" step="any" min="0" value={form.shares}
                     onChange={e => set('shares', e.target.value)} placeholder="0" style={inputStyle} />
            </Field>
            <Field label={th ? "ราคา/หุ้น" : "Price/share"}>
              <input type="number" step="any" min="0" value={form.price}
                     onChange={e => set('price', e.target.value)} placeholder="0.00" style={inputStyle} />
            </Field>
          </div>

          {/* Amount + Currency */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: 12 }}>
            <Field label={th ? "มูลค่ารวม (คำนวณอัตโนมัติหากเว้นว่าง)" : "Total amount (auto if blank)"}>
              <input type="number" step="any" min="0" value={form.amount}
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
              <input type="number" step="any" min="0" value={form.fee}
                     onChange={e => set('fee', e.target.value)}
                     placeholder="0.00" style={inputStyle} />
            </Field>
            <Field label={th ? "ภาษี / อากร (ไม่บังคับ)" : "Tax / Duty (optional)"}>
              <input type="number" step="any" min="0" value={form.tax}
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

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
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
    let ok = 0; const errors = []; const imported = []
    for (const tx of toImport) {
      const { error } = await addTransaction(portfolioId, tx)
      if (error) errors.push(`${tx.ticker || '?'} ${tx.transacted_at}: ${error.message}`)
      else { ok++; imported.push(tx) }
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
      display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 1100,
      overflowY: "auto", padding: "24px 16px",
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg)", borderRadius: 20, padding: "32px 28px 40px",
        width: "100%", maxWidth: step === 2 ? 760 : 600, margin: "auto",
        boxShadow: "0 8px 48px rgba(0,0,0,0.18)",
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
            <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 16, lineHeight: 1.6 }}>
              {th
                ? "อัปโหลด Statement หรือใบยืนยันการซื้อขายจากโบรกเกอร์ (ต้องเป็น PDF แบบข้อความ ไม่ใช่ภาพสแกน)"
                : "Upload a broker statement or trade confirmation. Must be a text-based PDF — scanned images are not supported."}
            </p>

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

                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
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
      if (filter === "US") return r.region === "US"
      if (filter === "Crypto") return r.cls === "Crypto"
      if (filter === "Bonds") return r.cls === "Bond"
      if (filter === "Commodity") return r.cls === "Commodity"
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
    { id: "US",        label: th ? "หุ้น US"  : "US stocks", count: rows.filter(r => r.region === "US").length },
    { id: "Bonds",     label: th ? "พันธบัตร" : "Bonds",     count: rows.filter(r => r.cls === "Bond").length },
    { id: "Commodity", label: th ? "ทองคำ"    : "Gold",      count: rows.filter(r => r.cls === "Commodity").length },
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

      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
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

function PortMetric({ label, value, sub }) {
  return (
    <div>
      <div className="label-up" style={{ marginBottom: 6 }}>{label}</div>
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
