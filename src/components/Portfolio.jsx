import { useState, useMemo } from 'react'
import { PageHead, Delta, Icon } from './Nav'
import { Sparkline } from './Charts'
import { LUMEN_FMT, LUMEN_DERIVE } from '../data'

export function PortfolioPage({ t, lang, ccy, setRoute, dataState }) {
  if (dataState === "empty") {
    return (
      <div className="shell fade-in">
        <PageHead title={t.portfolio.heading} sub={t.portfolio.sub} />
        <div className="card empty">
          <h2 className="display" style={{ fontSize: 28, margin: 0 }}>
            {lang === "th" ? "ยังไม่มีหลักทรัพย์" : "Looks like it's empty"}
          </h2>
          <p style={{ marginTop: 8 }}>{lang === "th" ? "เพิ่มหลักทรัพย์เพื่อเริ่มต้น" : "Add a holding to get started"}</p>
          <button className="btn" style={{ marginTop: 20 }} onClick={() => setRoute("onboarding")}>
            <Icon name="plus" size={14} /> {t.common.addInvestment}
          </button>
        </div>
      </div>
    )
  }

  const derived = useMemo(() => LUMEN_DERIVE(), [])
  const { rows, value, pl, plPct, cash } = derived
  const [sortKey, setSortKey] = useState("value")
  const [sortDir, setSortDir] = useState("desc")
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState("all")

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
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc")
    else { setSortKey(k); setSortDir("desc") }
  }

  const filters = [
    { id: "all",       label: lang === "th" ? "ทั้งหมด"  : "All",       count: rows.length },
    { id: "TH",        label: lang === "th" ? "หุ้นไทย"  : "TH stocks", count: rows.filter(r => r.region === "TH").length },
    { id: "US",        label: lang === "th" ? "หุ้น US"  : "US stocks", count: rows.filter(r => r.region === "US").length },
    { id: "Bonds",     label: lang === "th" ? "พันธบัตร" : "Bonds",     count: rows.filter(r => r.cls === "Bond").length },
    { id: "Commodity", label: lang === "th" ? "ทองคำ"    : "Gold",      count: rows.filter(r => r.cls === "Commodity").length },
    { id: "Crypto",    label: lang === "th" ? "คริปโต"   : "Crypto",    count: rows.filter(r => r.cls === "Crypto").length },
  ]

  return (
    <div className="shell fade-in" data-screen-label="Portfolio">
      <PageHead
        title={t.portfolio.heading}
        sub={t.portfolio.sub}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-outline btn-sm"><Icon name="upload" size={14} /> {lang === "th" ? "นำเข้า" : "Import"}</button>
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
              {rows.length} {lang === "th" ? "ตำแหน่ง · " : "positions · "}{lang === "th" ? "หลายหมวด" : "asset classes"}
            </div>
          </div>
          <PortMetric label={lang === "th" ? "กำไร/ขาดทุน รวม" : "Unrealized P/L"}
                  value={(pl >= 0 ? "+" : "") + LUMEN_FMT.money(pl, ccy, { compact: true })} sub={<Delta value={plPct} />} />
          <PortMetric label={lang === "th" ? "ปันผล/ปี (ประมาณ)" : "Est. annual dividends"}
                  value={LUMEN_FMT.money(rows.reduce((a, b) => a + b.value * b.divYield / 100, 0), ccy, { compact: true })}
                  sub={<span className="mono">{(rows.reduce((a, b) => a + b.value * b.divYield / 100, 0) / value * 100).toFixed(2)}% yield</span>} />
          <PortMetric label={lang === "th" ? "ใหญ่สุด" : "Largest position"}
                  value={[...rows].sort((a, b) => b.value - a.value)[0].ticker}
                  sub={<span className="mono">{[...rows].sort((a, b) => b.value - a.value)[0].weight.toFixed(1)}%</span>} />
          <PortMetric label={lang === "th" ? "สัดส่วนเงินสด" : "Cash weight"}
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
              <th className="num">{lang === "th" ? "30 วัน" : "30d"}</th>
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
        <span>{lang === "th" ? `แสดง ${sorted.length} จาก ${rows.length} ตำแหน่ง` : `Showing ${sorted.length} of ${rows.length} positions`}</span>
        <span>{lang === "th" ? "ราคาดีเลย์ 15 นาที" : "Prices delayed 15 min"}</span>
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
  return { Equity: "var(--bg-2)", Bond: "oklch(0.94 0.04 280)", Crypto: "oklch(0.94 0.05 65)", Commodity: "oklch(0.94 0.04 90)" }[cls] || "var(--bg-2)"
}
function classFg(cls) {
  return { Equity: "var(--ink-2)", Bond: "var(--c4)", Crypto: "var(--c2)", Commodity: "var(--c7)" }[cls] || "var(--ink-2)"
}
