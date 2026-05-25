import { useState, useMemo } from 'react'
import { PageHead, Delta, Icon } from './Nav'
import { Sparkline } from './Charts'
import { LUMEN_FMT, LUMEN_DERIVE } from '../data'
import { addHolding, deleteHolding, deriveHoldings } from '../lib/db'

export function PortfolioPage({ t, lang, ccy, setRoute, dataState, portfolio, liveHoldings = [], prices = {}, refreshHoldings, loadingData, dataError, retryLoad }) {
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
      />
    )
  }

  // ── Demo mode ────────────────────────────────────────────────────────────────
  return <DemoPortfolioPage t={t} lang={lang} ccy={ccy} setRoute={setRoute} setShowAdd={setShowAdd} />
}

// ─── Live Portfolio ──────────────────────────────────────────────────────────
function LivePortfolioPage({ t, lang, ccy, portfolio, liveHoldings, prices = {}, refreshHoldings, loadingData, showAdd, setShowAdd }) {
  const th = lang === "th"
  const [deleting, setDeleting] = useState(null)
  const [sortKey, setSortKey] = useState("value")
  const [sortDir, setSortDir] = useState("desc")
  const [q, setQ] = useState("")

  const rows = useMemo(() => deriveHoldings(liveHoldings, ccy, prices), [liveHoldings, ccy, prices])

  const sorted = useMemo(() => {
    let list = rows
    if (q) list = list.filter(r => (r.ticker + r.name).toLowerCase().includes(q.toLowerCase()))
    return [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      const cmp = typeof av === "string" ? av.localeCompare(bv) : (av - bv)
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir, q])

  const setSort = k => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(k); setSortDir("desc") }
  }

  const totalValue = rows.reduce((s, r) => s + r.value, 0)
  const totalPL = rows.reduce((s, r) => s + r.pl, 0)
  const totalCostBasis = totalValue - totalPL
  const totalPlPct = totalCostBasis > 0 ? (totalPL / totalCostBasis) * 100 : 0
  const hasLivePrices = rows.some(r => r.hasLivePrice)

  const handleDelete = async (id) => {
    if (!window.confirm(th ? "ลบหลักทรัพย์นี้?" : "Delete this holding?")) return
    setDeleting(id)
    await deleteHolding(id)
    await refreshHoldings()
    setDeleting(null)
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
          <button className="btn btn-sm" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={14} /> {t.common.addInvestment}
          </button>
        }
      />

      {rows.length === 0 ? (
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
          {/* Summary bar */}
          <section className="card" style={{ padding: "20px 24px", marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 40, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <div className="label-up" style={{ marginBottom: 4 }}>
                  {th ? "มูลค่าตลาด" : "Market value"} · {ccy}
                  {hasLivePrices && <span style={{ marginLeft: 6, color: "var(--gain)", fontWeight: 700 }}>● LIVE</span>}
                </div>
                <div className="display" style={{ fontSize: 32, lineHeight: 1 }}>{LUMEN_FMT.money(totalValue, ccy)}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {rows.length} {th ? "ตำแหน่ง" : "positions"}
                </div>
              </div>
              <div>
                <div className="label-up" style={{ marginBottom: 4 }}>{th ? "กำไร/ขาดทุน" : "Total P/L"}</div>
                <div style={{ fontSize: 22, fontWeight: 600, color: totalPL >= 0 ? "var(--gain)" : "var(--loss)" }}>
                  {totalPL >= 0 ? "+" : ""}{LUMEN_FMT.money(totalPL, ccy, { compact: true })}
                </div>
                <div style={{ fontSize: 12, marginTop: 2, color: totalPlPct >= 0 ? "var(--gain)" : "var(--loss)" }}>
                  {totalPlPct >= 0 ? "+" : ""}{totalPlPct.toFixed(2)}%
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", gap: 28, flexWrap: "wrap" }}>
                {[...new Set(rows.map(r => r.cls))].map(cls => {
                  const clsVal = rows.filter(r => r.cls === cls).reduce((s, r) => s + r.value, 0)
                  return (
                    <div key={cls}>
                      <div className="label-up" style={{ marginBottom: 4 }}>{cls}</div>
                      <div style={{ fontSize: 18, fontWeight: 500 }}>{LUMEN_FMT.money(clsVal, ccy, { compact: true })}</div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {totalValue > 0 ? (clsVal / totalValue * 100).toFixed(1) : 0}%
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          {/* Search */}
          <section style={{ marginBottom: 12 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 999, padding: "6px 14px", width: 240 }}>
              <Icon name="search" size={14} />
              <input type="text" placeholder={t.common.search} value={q} onChange={e => setQ(e.target.value)}
                     style={{ border: 0, outline: 0, background: "transparent", flex: 1, fontSize: 13 }} />
            </div>
          </section>

          {/* Table */}
          <section className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="table">
              <thead>
                <tr>
                  <SortHeader id="ticker" label={t.portfolio.holding} sortKey={sortKey} sortDir={sortDir} onSort={setSort} />
                  <SortHeader id="shares" label={t.portfolio.shares} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
                  <SortHeader id="cost" label={th ? "ราคาทุน" : "Cost/share"} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
                  <SortHeader id="price" label={th ? "ราคาตลาด" : "Mkt price"} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
                  <SortHeader id="value" label={t.portfolio.value} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
                  <SortHeader id="pl" label={t.portfolio.pl} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
                  <SortHeader id="weight" label={t.portfolio.weight} sortKey={sortKey} sortDir={sortDir} onSort={setSort} align="right" />
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.id} style={{ opacity: deleting === r.id ? 0.4 : 1 }}>
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
                    <td className="num">{LUMEN_FMT.moneyNative(r.costNative, r.nativeCcy, { compact: true })}</td>
                    <td className="num">
                      {r.hasLivePrice ? (
                        <div>
                          <div style={{ fontWeight: 500 }}>{LUMEN_FMT.moneyNative(r.priceNative, r.nativeCcy, { compact: true })}</div>
                          {r.changePct !== 0 && (
                            <div style={{ fontSize: 11, color: r.changePct >= 0 ? "var(--gain)" : "var(--loss)" }}>
                              {r.changePct >= 0 ? "+" : ""}{r.changePct.toFixed(2)}%
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>{th ? "รอราคา" : "pending"}</span>
                      )}
                    </td>
                    <td className="num" style={{ fontWeight: 500 }}>{LUMEN_FMT.money(r.value, ccy, { compact: true })}</td>
                    <td className="num">
                      {r.hasLivePrice ? (
                        <div>
                          <div style={{ color: r.pl >= 0 ? "var(--gain)" : "var(--loss)", fontWeight: 500 }}>
                            {r.pl >= 0 ? "+" : ""}{LUMEN_FMT.money(r.pl, ccy, { compact: true })}
                          </div>
                          <div style={{ fontSize: 11, color: r.plPct >= 0 ? "var(--gain)" : "var(--loss)" }}>
                            {r.plPct >= 0 ? "+" : ""}{r.plPct.toFixed(2)}%
                          </div>
                        </div>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="num">
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <div className="bar" style={{ width: 40 }}>
                          <span style={{ width: Math.min(100, r.weight * 3) + "%", background: classFg(r.cls) }} />
                        </div>
                        <span style={{ minWidth: 36 }}>{r.weight.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td>
                      <button
                        onClick={() => handleDelete(r.id)}
                        disabled={deleting === r.id}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-4)", padding: "4px 6px", borderRadius: 6 }}
                        title={th ? "ลบ" : "Delete"}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
                <tr style={{ background: "var(--bg)", fontWeight: 600 }}>
                  <td colSpan={4}><span className="label-up">{t.portfolio.total}</span></td>
                  <td className="num">{LUMEN_FMT.money(totalValue, ccy, { compact: true })}</td>
                  <td className="num" style={{ color: totalPL >= 0 ? "var(--gain)" : "var(--loss)" }}>
                    {totalPL >= 0 ? "+" : ""}{LUMEN_FMT.money(totalPL, ccy, { compact: true })}
                  </td>
                  <td className="num">100.0%</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </section>

          <div style={{ marginTop: 12, color: "var(--ink-4)", fontSize: 12 }}>
            {hasLivePrices
              ? (th ? "ราคาตลาดจาก Yahoo Finance · อัปเดตทุก 15 นาที" : "Market prices from Yahoo Finance · updates every 15 min")
              : (th ? "กำลังโหลดราคาตลาด…" : "Fetching live market prices…")}
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
    </div>
  )
}

// ─── Add Holding Modal ───────────────────────────────────────────────────────
function AddHoldingModal({ lang, portfolioId, onClose, onSaved }) {
  const th = lang === "th"
  const [form, setForm] = useState({
    ticker: '', name: '', asset_class: 'Equity', region: 'TH',
    shares: '', cost_price: '', currency: 'THB', div_yield: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!portfolioId) {
      setError(th ? 'ยังไม่ได้โหลด portfolio — ลองรีเฟรชหน้า' : 'Portfolio not loaded yet — please refresh the page')
      return
    }
    setSaving(true)
    setError(null)
    const { error } = await addHolding(portfolioId, {
      ticker: form.ticker.toUpperCase(),
      name: form.name,
      asset_class: form.asset_class,
      region: form.region,
      shares: parseFloat(form.shares),
      cost_price: parseFloat(form.cost_price),
      currency: form.currency,
      div_yield: form.div_yield ? parseFloat(form.div_yield) : 0,
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    onSaved()
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg)", borderRadius: "20px 20px 0 0", padding: "32px 28px 40px",
        width: "100%", maxWidth: 540, boxShadow: "0 -8px 40px rgba(0,0,0,0.12)",
        animation: "slideUp 0.2s ease",
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

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <Field label={th ? "ติ๊กเกอร์" : "Ticker"}>
              <input required value={form.ticker} onChange={e => set('ticker', e.target.value)}
                     placeholder="e.g. PTT" style={inputStyle} />
            </Field>
            <Field label={th ? "ชื่อ" : "Name"}>
              <input required value={form.name} onChange={e => set('name', e.target.value)}
                     placeholder={th ? "ชื่อเต็ม" : "Full name"} style={inputStyle} />
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label={th ? "ประเภท" : "Asset Class"}>
              <select value={form.asset_class} onChange={e => set('asset_class', e.target.value)} style={inputStyle}>
                <option value="Equity">{th ? "หุ้น" : "Equity"}</option>
                <option value="ETF">ETF</option>
                <option value="Bond">{th ? "พันธบัตร" : "Bond"}</option>
                <option value="Crypto">{th ? "คริปโต" : "Crypto"}</option>
                <option value="Commodity">{th ? "สินค้าโภคภัณฑ์" : "Commodity"}</option>
              </select>
            </Field>
            <Field label={th ? "ตลาด" : "Region"}>
              <select value={form.region} onChange={e => set('region', e.target.value)} style={inputStyle}>
                <option value="TH">{th ? "ไทย" : "Thailand"}</option>
                <option value="US">{th ? "สหรัฐ" : "US"}</option>
                <option value="Other">{th ? "อื่นๆ" : "Other"}</option>
              </select>
            </Field>
          </div>

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
            <Field label={th ? "สกุล" : "Currency"}>
              <select value={form.currency} onChange={e => set('currency', e.target.value)} style={inputStyle}>
                <option value="THB">THB</option>
                <option value="USD">USD</option>
              </select>
            </Field>
          </div>

          <Field label={th ? "อัตราปันผล % (ไม่บังคับ)" : "Dividend yield % (optional)"}>
            <input type="number" step="any" min="0" max="100" value={form.div_yield}
                   onChange={e => set('div_yield', e.target.value)}
                   placeholder="0.00" style={{ ...inputStyle, maxWidth: 160 }} />
          </Field>

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
