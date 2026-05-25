import { useState, useMemo, useEffect } from 'react'
import { PageHead, Delta, Icon } from './Nav'
import { Sparkline, LineChart, Donut } from './Charts'
import {
  LUMEN_FMT, LUMEN_DERIVE, LUMEN_HISTORY, LUMEN_GOALS,
  LUMEN_ACTIVITY, LUMEN_UPCOMING, LUMEN_INSIGHTS, LUMEN_FX,
} from '../data'
import { deriveHoldings, upsertCashAccount, deleteCashAccount, getGoals, getTransactions } from '../lib/db'

export function DashboardPage({ t, lang, ccy, setRoute, dataState, liveHoldings = [], prices = {}, cashAccounts = [], portfolio, refreshCashAccounts }) {
  if (dataState === "empty") return <DashboardEmpty t={t} lang={lang} setRoute={setRoute} />
  if (dataState === "live") return (
    <LiveDashboardPage
      t={t} lang={lang} ccy={ccy} setRoute={setRoute}
      liveHoldings={liveHoldings} prices={prices}
      cashAccounts={cashAccounts} portfolio={portfolio}
      refreshCashAccounts={refreshCashAccounts}
    />
  )

  const derived = useMemo(() => LUMEN_DERIVE(), [])
  const { rows, value, cost, pl, plPct, cash, liab, net } = derived

  const allocClass = useMemo(() => {
    const map = {}
    rows.forEach(r => {
      const key = r.cls === "Equity" ? (r.region === "TH" ? "TH Equity" : "US Equity") : r.cls
      map[key] = (map[key] || 0) + r.value
    })
    map["Cash"] = cash
    return Object.entries(map).map(([k, v], i) => ({
      name: k, value: v,
      color: ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"][i % 7],
    }))
  }, [rows, cash])

  const movers = useMemo(() => {
    return [...rows].map(r => ({
      ...r,
      day: ((Math.sin(r.ticker.length * 7.3) * 2 + Math.cos(r.ticker.length * 5.1)) * 0.8 + r.plPct * 0.02),
    })).sort((a, b) => Math.abs(b.day) - Math.abs(a.day)).slice(0, 5)
  }, [rows])

  const monthLabels = ["Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May"]
  const histSeries = [{
    name: t.dashboard.netWorth,
    color: "var(--ink)",
    fill: true,
    data: LUMEN_HISTORY.map((p, i) => ({ x: i, y: p.v * 1000, label: monthLabels[i % 12] + " '" + (24 + Math.floor(i / 12)) })),
  }]

  const todayPct = 0.62
  const todayAbs = value * todayPct / 100
  const activity = LUMEN_ACTIVITY.slice(0, 5)
  const insights = LUMEN_INSIGHTS[lang] || LUMEN_INSIGHTS.en

  return (
    <div className="shell fade-in" data-screen-label="Dashboard">
      <PageHead
        kicker={lang === "th"
          ? "หน้าหลัก · " + new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" })
          : "Dashboard · " + new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })}
        title={t.dashboard.heading}
        sub={t.dashboard.sub}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-outline btn-sm"><Icon name="filter" size={14} />{lang === "th" ? "พฤษภาคม 2026" : "May 2026"}<Icon name="down" size={14} /></button>
            <button className="btn btn-sm"><Icon name="plus" size={14} />{t.common.addInvestment}</button>
          </div>
        }
      />

      {/* HERO */}
      <section className="card" style={{ padding: 36, marginBottom: 16, position: "relative", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 56, alignItems: "center" }}>
          <div>
            <div className="label-up" style={{ marginBottom: 12 }}>{t.dashboard.netWorth} · {ccy}</div>
            <div className="display" style={{ fontSize: 72, lineHeight: 1, letterSpacing: "-0.035em" }}>
              {LUMEN_FMT.money(net, ccy)}
            </div>
            <div style={{ marginTop: 18, display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className={"delta " + (todayPct > 0 ? "gain" : "loss")} style={{ fontSize: 15 }}>
                  <svg width="11" height="11" viewBox="0 0 10 10"><path d="M5 1 L9 7 H1 Z" fill="currentColor" /></svg>
                  {LUMEN_FMT.money(todayAbs, ccy)} · +{todayPct.toFixed(2)}%
                </span>
                <span className="muted" style={{ fontSize: 13 }}>{t.dashboard.changeToday}</span>
              </div>
              <span style={{ color: "var(--ink-4)" }}>·</span>
              <div className="muted" style={{ fontSize: 13 }}>
                <span className="mono" style={{ color: "var(--gain)" }}>+{plPct.toFixed(1)}%</span>{" "}
                {lang === "th" ? "ตั้งแต่เริ่มลงทุน" : "since inception"}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, marginTop: 36, paddingTop: 28, borderTop: "1px solid var(--line)" }}>
              <Metric label={t.dashboard.invested} value={LUMEN_FMT.money(value, ccy, { compact: true })} sub={LUMEN_FMT.money(cost, ccy, { compact: true }) + " " + (lang === "th" ? "ต้นทุน" : "cost")} accent="gain" />
              <Metric label={t.dashboard.cash} value={LUMEN_FMT.money(cash, ccy, { compact: true })} sub={lang === "th" ? "HYSA + กระแสรายวัน" : "HYSA + Checking"} />
              <Metric label={t.dashboard.liabilities} value={LUMEN_FMT.money(liab, ccy, { compact: true })} sub={lang === "th" ? "บ้าน · 4.2%" : "Mortgage · 4.2%"} accent="loss" />
            </div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div className="label-up">{lang === "th" ? "พอร์ตการลงทุน · 3 ปี" : "Portfolio · 3 yrs"}</div>
              <div className="segmented" style={{ gap: 0 }}>
                {["1Y", "3Y", "5Y"].map(p => (
                  <button key={p} className={p === "3Y" ? "on" : ""} style={{ fontSize: 12, padding: "4px 10px" }}>{p}</button>
                ))}
              </div>
            </div>
            <LineChart series={histSeries} height={220} fmt={v => "฿" + (v / 1_000_000).toFixed(2) + "M"} />
          </div>
        </div>
      </section>

      {/* Row 2 — allocation + movers */}
      <section className="grid grid-12" style={{ marginBottom: 16 }}>
        <div className="card col-span-5">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h3 className="section-title">{t.dashboard.allocation}</h3>
            <button className="btn-ghost btn btn-sm" onClick={() => setRoute("analytics")}>
              {t.dashboard.seeDetails} <Icon name="chevron" size={12} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <Donut data={allocClass} size={180} thickness={26}
                   centerLabel={t.common.total} centerValue={LUMEN_FMT.money(value + cash, ccy, { compact: true })} />
            <div style={{ flex: 1, display: "grid", gap: 10 }}>
              {allocClass.map((s, i) => {
                const pct = (s.value / (value + cash)) * 100
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", fontSize: 13 }}>
                    <span className="dot" style={{ background: s.color }} />
                    <span>{s.name}</span>
                    <span className="mono">{pct.toFixed(1)}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="card col-span-7">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h3 className="section-title">{t.dashboard.topMovers}</h3>
            <div className="segmented">
              <button className="on">{t.common.today}</button>
              <button>{t.common.thisMonth}</button>
            </div>
          </div>
          <table className="table" style={{ marginTop: -8 }}>
            <thead><tr>
              <th>{t.portfolio.holding}</th>
              <th></th>
              <th className="num">{lang === "th" ? "ราคา" : "Last"}</th>
              <th className="num">{t.portfolio.day}</th>
              <th></th>
            </tr></thead>
            <tbody>
              {movers.map(m => {
                const sparkData = Array.from({ length: 20 }, (_, i) =>
                  Math.sin(i / 3 + m.ticker.length) + Math.cos(i / 2 + m.ticker.length * 2) + (i / 20) * (m.day > 0 ? 0.6 : -0.6))
                return (
                  <tr key={m.ticker}>
                    <td>
                      <div className="ticker">
                        <div className="ticker-mark">{m.ticker.slice(0, 2)}</div>
                        <div>
                          <div style={{ fontWeight: 500 }}>{m.ticker}</div>
                          <div className="muted" style={{ fontSize: 11 }}>{m.name}</div>
                        </div>
                      </div>
                    </td>
                    <td><Sparkline data={sparkData} stroke={m.day > 0 ? "var(--gain)" : "var(--loss)"} fill={m.day > 0 ? "var(--gain)" : "var(--loss)"} /></td>
                    <td className="num">{m.ccy === "USD" ? "$" : "฿"}{m.price.toFixed(2)}</td>
                    <td className="num"><Delta value={m.day} /></td>
                    <td style={{ width: 24, color: "var(--ink-4)" }}><Icon name="chevron" size={14} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Row 3 — Goals + Insights */}
      <section className="grid grid-12" style={{ marginBottom: 16 }}>
        <div className="card col-span-7">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <div>
              <h3 className="section-title">{t.dashboard.goals}</h3>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t.dashboard.goalsSub}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setRoute("planning")}>
              {lang === "th" ? "ดูทั้งหมด" : "All goals"} <Icon name="chevron" size={12} />
            </button>
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            {LUMEN_GOALS.map(g => {
              const pct = Math.min(100, (g.current / g.target) * 100)
              return (
                <div key={g.id} style={{ padding: 18, borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <GoalRing pct={pct} color={g.color} size={60} stroke={6} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{t.planning[g.nameKey]}</div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {LUMEN_FMT.money(g.current, ccy, { compact: true })} / {LUMEN_FMT.money(g.target, ccy, { compact: true })}
                      </div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {g.eta === "Complete"
                          ? <span className="gain">✓ {t.planning.complete}</span>
                          : `${t.planning.eta} ${g.eta}`}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="col-span-5" style={{ display: "grid", gap: 16 }}>
          <div className="card">
            <h3 className="section-title" style={{ marginBottom: 16 }}>{t.dashboard.insights}</h3>
            <div style={{ display: "grid", gap: 14 }}>
              {insights.map((it, i) => {
                const dotColor = it.tone === "good" ? "var(--gain)" : it.tone === "warn" ? "var(--loss)" : "var(--ink-3)"
                return (
                  <div key={i} style={{ display: "flex", gap: 12, paddingBottom: 14, borderBottom: i < insights.length - 1 ? "1px solid var(--line)" : "" }}>
                    <span className="dot" style={{ background: dotColor, marginTop: 6, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{it.title}</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{it.body}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Row 4 — Activity + Upcoming */}
      <section className="grid grid-12">
        <div className="card col-span-7">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 className="section-title">{t.dashboard.activity}</h3>
            <button className="btn btn-ghost btn-sm">{t.common.seeAll}</button>
          </div>
          {activity.map((a, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "24px 64px 1fr auto",
              gap: 14, alignItems: "center", padding: "14px 0",
              borderTop: i === 0 ? "" : "1px solid var(--line)",
            }}>
              <ActivityIcon type={a.type} />
              <div className="muted mono" style={{ fontSize: 12 }}>{a.date}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {actionLabel(a.type, lang)}{a.ticker ? " · " + a.ticker : ""}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>
                  {a.shares != null && a.price != null
                    ? `${a.shares} ${lang === "th" ? "หุ้น" : "shares"} @ ${a.ccy === "USD" ? "$" : "฿"}${a.price.toFixed(2)}`
                    : a.amount != null ? `${a.amount.toLocaleString()} ${a.ccy}` : ""}
                </div>
              </div>
              <div className="mono" style={{ fontSize: 13, textAlign: "right" }}>
                {a.amount != null
                  ? LUMEN_FMT.money(a.amount * (a.ccy === "USD" ? LUMEN_FX.THB_per_USD : 1), ccy)
                  : a.shares != null && a.price != null
                  ? LUMEN_FMT.money(a.shares * a.price * (a.ccy === "USD" ? LUMEN_FX.THB_per_USD : 1), ccy)
                  : ""}
              </div>
            </div>
          ))}
        </div>

        <div className="card col-span-5">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 className="section-title">{t.dashboard.upcoming}</h3>
            <span className="chip chip-soft mono">
              ~{LUMEN_FMT.money(LUMEN_UPCOMING.reduce((a, b) => a + b.amount * (b.ccy === "USD" ? LUMEN_FX.THB_per_USD : 1), 0), ccy)}
            </span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {LUMEN_UPCOMING.map((u, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "44px 1fr auto", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, background: "var(--bg)" }}>
                <div style={{ textAlign: "center", padding: "4px 0", background: "var(--card)", borderRadius: 6, border: "1px solid var(--line)" }}>
                  <div style={{ fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                    {u.date.split(" ")[0]}
                  </div>
                  <div className="display" style={{ fontSize: 16, lineHeight: 1 }}>{u.date.split(" ")[1]}</div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{u.ticker}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{lang === "th" ? "ปันผล" : "Dividend"}</div>
                </div>
                <div className="mono" style={{ fontSize: 13 }}>
                  {LUMEN_FMT.money(u.amount * (u.ccy === "USD" ? LUMEN_FX.THB_per_USD : 1), ccy)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function Metric({ label, value, sub, accent }) {
  return (
    <div>
      <div className="label-up" style={{ marginBottom: 6 }}>{label}</div>
      <div className="display" style={{ fontSize: 24, lineHeight: 1 }}>{value}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{sub}</div>
    </div>
  )
}

export function GoalRing({ pct, color = "var(--ink)", size = 60, stroke = 6 }) {
  const r = (size - stroke) / 2
  const c = size / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ
  return (
    <div className="goal-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} className="ring-bg" fill="none" strokeWidth={stroke} />
        <circle cx={c} cy={c} r={r} fill="none" strokeWidth={stroke}
                stroke={color} strokeLinecap="round"
                strokeDasharray={circ} strokeDashoffset={offset} />
      </svg>
      <div className="ring-pct" style={{ fontSize: size > 70 ? 16 : 13 }}>{Math.round(pct)}%</div>
    </div>
  )
}

export function ActivityIcon({ type }) {
  const map = {
    Buy:      { icon: "buy",      bg: "var(--gain-soft)",   fg: "var(--gain)" },
    Sell:     { icon: "sell",     bg: "var(--loss-soft)",   fg: "var(--loss)" },
    Dividend: { icon: "dividend", bg: "var(--accent-soft)", fg: "var(--accent-ink)" },
    Deposit:  { icon: "deposit",  bg: "var(--bg-2)",        fg: "var(--ink-2)" },
  }
  const m = map[type] || map.Buy
  return (
    <div style={{ width: 24, height: 24, borderRadius: 6, background: m.bg, color: m.fg, display: "grid", placeItems: "center" }}>
      <Icon name={m.icon} size={13} />
    </div>
  )
}

function actionLabel(type, lang) {
  const map = {
    en: { Buy: "Bought", Sell: "Sold", Dividend: "Dividend", Deposit: "Deposit" },
    th: { Buy: "ซื้อ",   Sell: "ขาย",  Dividend: "ปันผล",     Deposit: "ฝากเงิน" },
  }
  return (map[lang] || map.en)[type] || type
}

// ─── Live Dashboard — matches demo layout with real data ─────────────────────
function LiveDashboardPage({ t, lang, ccy, setRoute, liveHoldings, prices = {}, cashAccounts = [], portfolio, refreshCashAccounts }) {
  const th = lang === "th"
  const [showCashModal, setShowCashModal] = useState(null)
  const [goals, setGoals] = useState([])
  const [recentTx, setRecentTx] = useState([])
  const [chartPeriod, setChartPeriod] = useState("1Y")

  useEffect(() => {
    if (!portfolio) return
    if (portfolio.user_id) {
      getGoals(portfolio.user_id).then(setGoals).catch(() => {})
    }
    getTransactions(portfolio.id).then(d => setRecentTx((d || []).slice(0, 5))).catch(() => {})
  }, [portfolio?.id, portfolio?.user_id])

  const rows          = useMemo(() => deriveHoldings(liveHoldings, ccy, prices), [liveHoldings, ccy, prices])
  const totalValue    = rows.reduce((s, r) => s + r.value, 0)
  const totalPL       = rows.reduce((s, r) => s + r.pl, 0)
  const totalCostBasis = totalValue - totalPL
  const totalPlPct    = totalCostBasis > 0 ? (totalPL / totalCostBasis) * 100 : 0
  const hasLivePrices = rows.some(r => r.hasLivePrice)
  const annualDiv     = rows.reduce((s, r) => s + r.value * (r.divYield || 0) / 100, 0)

  const todayChangePct = hasLivePrices && totalValue > 0
    ? rows.filter(r => r.hasLivePrice).reduce((s, r) => s + r.changePct * (r.value / totalValue), 0)
    : 0
  const todayChangeAbs = totalValue * todayChangePct / 100

  const cashTotal = useMemo(() => cashAccounts.reduce((s, a) => {
    const b = a.balance || 0, c = a.currency || 'THB'
    if (c === ccy) return s + b
    if (c === 'USD' && ccy === 'THB') return s + b * LUMEN_FX.THB_per_USD
    if (c === 'THB' && ccy === 'USD') return s + b / LUMEN_FX.THB_per_USD
    return s + b
  }, 0), [cashAccounts, ccy])
  const netWorth = totalValue + cashTotal
  const hasCash  = cashAccounts.length > 0

  const allocClass = useMemo(() => {
    if (rows.length === 0) return []
    const map = {}
    rows.forEach(r => {
      const key = r.cls === "Equity"
        ? (r.region === "TH" ? (th ? "หุ้นไทย" : "TH Equity") : (th ? "หุ้น US" : "US Equity"))
        : r.cls
      map[key] = (map[key] || 0) + r.value
    })
    const colors = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"]
    return Object.entries(map).map(([k, v], i) => ({ name: k, value: v, color: colors[i % 7] }))
  }, [rows, th])

  // Top movers — sorted by |changePct| when live prices available
  const movers = useMemo(() => {
    const live = rows.filter(r => r.hasLivePrice)
    const list = live.length >= 3
      ? [...live].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      : [...rows].sort((a, b) => b.value - a.value)
    return list.slice(0, 5)
  }, [rows])

  // Simulated growth chart — adjustable period 1Y / 3Y / 5Y
  const histSeries = useMemo(() => {
    if (totalCostBasis <= 0 || totalValue <= 0) return []
    const cfg = { "1Y": { pts: 12, stepM: 1 }, "3Y": { pts: 18, stepM: 2 }, "5Y": { pts: 20, stepM: 3 } }
    const { pts, stepM } = cfg[chartPeriod] || cfg["1Y"]
    const totalMonths = pts * stepM
    const now = new Date()
    return [{
      name: th ? "มูลค่าพอร์ต" : "Portfolio value",
      color: "var(--ink)", fill: true,
      data: Array.from({ length: pts }, (_, i) => {
        const p = i / (pts - 1)
        const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p
        const noise = (Math.sin(i * 2.3) * 0.012 + Math.cos(i * 4.1) * 0.008) * totalCostBasis
        const d = new Date(now.getFullYear(), now.getMonth() - (totalMonths - 1 - i * stepM), 1)
        const lbl = d.toLocaleString(th ? "th-TH" : "en-US", { month: "short" }) + " '" + String(d.getFullYear()).slice(2)
        return { x: i, y: totalCostBasis + (totalValue - totalCostBasis) * ease + noise, label: lbl }
      })
    }]
  }, [totalCostBasis, totalValue, th, chartPeriod])

  // Auto insights from live data
  const insights = useMemo(() => {
    const out = []
    if (totalPL !== 0) {
      const up = totalPL > 0
      out.push({
        title: up ? (th ? `กำไรสะสม +${totalPlPct.toFixed(1)}%` : `+${totalPlPct.toFixed(1)}% overall gain`)
                  : (th ? `ขาดทุนสะสม ${totalPlPct.toFixed(1)}%` : `${totalPlPct.toFixed(1)}% overall loss`),
        body:  th ? `${up ? "เพิ่ม" : "ลด"} ${LUMEN_FMT.money(Math.abs(totalPL), ccy, { compact: true })} จากต้นทุน`
                  : `${up ? "Up" : "Down"} ${LUMEN_FMT.money(Math.abs(totalPL), ccy, { compact: true })} from cost basis`,
        tone: up ? "good" : "warn"
      })
    }
    if (rows.length > 0) {
      const top = [...rows].sort((a, b) => b.weight - a.weight)[0]
      if (top?.weight > 35) {
        out.push({
          title: th ? `${top.ticker} ครอง ${top.weight.toFixed(1)}% ของพอร์ต` : `${top.ticker} is ${top.weight.toFixed(1)}% of portfolio`,
          body:  th ? "ความเสี่ยงกระจุกตัวสูง — ควรพิจารณา rebalance" : "High concentration risk — consider rebalancing",
          tone: top.weight > 50 ? "warn" : "neutral"
        })
      }
    }
    if (annualDiv > 0) {
      out.push({
        title: th ? `ปันผล ~${LUMEN_FMT.money(annualDiv, ccy, { compact: true })}/ปี` : `~${LUMEN_FMT.money(annualDiv, ccy, { compact: true })} est. annual dividends`,
        body:  th ? `เฉลี่ย ${LUMEN_FMT.money(annualDiv / 12, ccy, { compact: true })}/เดือน` : `~${LUMEN_FMT.money(annualDiv / 12, ccy, { compact: true })} per month`,
        tone: "good"
      })
    }
    if (!rows.some(r => r.cls === "Bond") && rows.length >= 3) {
      out.push({
        title: th ? "ไม่มีพันธบัตรในพอร์ต" : "No bonds in your portfolio",
        body:  th ? "พันธบัตรช่วยลดความผันผวนในช่วงตลาดขาลง" : "Bonds reduce volatility during market downturns",
        tone: "neutral"
      })
    }
    return out.slice(0, 3)
  }, [rows, totalPL, totalPlPct, annualDiv, ccy, th])

  // Upcoming — estimated quarterly dividends
  const upcoming = useMemo(() => {
    const now = new Date()
    return rows
      .filter(r => (r.divYield || 0) > 0)
      .sort((a, b) => b.value * b.divYield - a.value * a.divYield)
      .slice(0, 4)
      .map((r, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() + 1 + i, 15)
        return {
          ticker: r.ticker,
          amount: r.value * r.divYield / 100 / 4,
          date: d.toLocaleString(th ? "th-TH" : "en-US", { month: "short" }) + " " + d.getDate(),
        }
      })
  }, [rows, th])

  const today = new Date().toLocaleDateString(th ? "th-TH" : "en-US", { weekday: "long", day: "numeric", month: "long" })

  if (rows.length === 0) {
    return (
      <div className="shell fade-in">
        <PageHead kicker={(th ? "หน้าหลัก · " : "Dashboard · ") + today} title={t.dashboard.heading} sub={t.dashboard.sub} />
        <div className="card" style={{ padding: 80, textAlign: "center" }}>
          <svg width="64" height="64" viewBox="0 0 64 64" style={{ margin: "0 auto 24px", display: "block" }}>
            <rect x="8" y="14" width="48" height="40" rx="6" fill="none" stroke="var(--line-2)" strokeWidth="1.5" strokeDasharray="4 4" />
            <path d="M14 44 L24 32 L32 38 L44 22 L54 32" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="display" style={{ fontSize: 32, margin: "0 0 8px" }}>{th ? "ยังไม่มีหลักทรัพย์" : "No holdings yet"}</h2>
          <p className="muted" style={{ fontSize: 14, maxWidth: 380, margin: "0 auto 28px" }}>
            {th ? "ไปที่ Portfolio แล้วกด + เพิ่มหลักทรัพย์แรกของคุณ" : "Go to Portfolio and press + to add your first holding."}
          </p>
          <button className="btn" onClick={() => setRoute("portfolio")}><Icon name="plus" size={14} /> {t.common.addInvestment}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="shell fade-in" data-screen-label="Dashboard">
      <PageHead
        kicker={(th ? "หน้าหลัก · " : "Dashboard · ") + today}
        title={t.dashboard.heading}
        sub={t.dashboard.sub}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setShowCashModal('add')}>
              <Icon name="deposit" size={14} /> {th ? "เพิ่มบัญชีเงินสด" : "Add cash account"}
            </button>
            <button className="btn btn-sm" onClick={() => setRoute("portfolio")}>
              <Icon name="plus" size={14} /> {t.common.addInvestment}
            </button>
          </div>
        }
      />

      {/* ── HERO ── */}
      <section className="card" style={{ padding: 36, marginBottom: 16, position: "relative", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 56, alignItems: "center" }}>
          <div>
            <div className="label-up" style={{ marginBottom: 12 }}>
              {hasCash ? (th ? "มูลค่าสุทธิ (Net Worth)" : "Net Worth") : (th ? "มูลค่าพอร์ต" : "Portfolio value")} · {ccy}
              {hasLivePrices && <span style={{ marginLeft: 8, color: "var(--gain)", fontWeight: 600 }}>● LIVE</span>}
            </div>
            <div className="display" style={{ fontSize: 72, lineHeight: 1, letterSpacing: "-0.035em" }}>
              {LUMEN_FMT.money(hasCash ? netWorth : totalValue, ccy)}
            </div>
            <div style={{ marginTop: 18, display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
              {hasLivePrices ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={"delta " + (todayChangePct >= 0 ? "gain" : "loss")} style={{ fontSize: 15 }}>
                    <svg width="11" height="11" viewBox="0 0 10 10">
                      <path d={todayChangePct >= 0 ? "M5 1 L9 7 H1 Z" : "M5 9 L1 3 H9 Z"} fill="currentColor" />
                    </svg>
                    {todayChangePct >= 0 ? "+" : ""}{LUMEN_FMT.money(Math.abs(todayChangeAbs), ccy, { compact: true })} · {todayChangePct >= 0 ? "+" : ""}{todayChangePct.toFixed(2)}%
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>{t.dashboard.changeToday}</span>
                </div>
              ) : (
                <span className="muted" style={{ fontSize: 13 }}>{th ? "กำลังโหลดราคา…" : "Fetching live prices…"}</span>
              )}
              <span style={{ color: "var(--ink-4)" }}>·</span>
              <div className="muted" style={{ fontSize: 13 }}>
                <span className="mono" style={{ color: totalPL >= 0 ? "var(--gain)" : "var(--loss)" }}>
                  {totalPL >= 0 ? "+" : ""}{totalPlPct.toFixed(1)}%
                </span>{" "}{th ? "ตั้งแต่เริ่มลงทุน" : "since inception"}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, marginTop: 36, paddingTop: 28, borderTop: "1px solid var(--line)" }}>
              <Metric label={t.dashboard.invested}
                value={LUMEN_FMT.money(totalValue, ccy, { compact: true })}
                sub={LUMEN_FMT.money(totalCostBasis, ccy, { compact: true }) + " " + (th ? "ต้นทุน" : "cost")}
                accent="gain" />
              <Metric label={t.dashboard.cash}
                value={LUMEN_FMT.money(cashTotal, ccy, { compact: true })}
                sub={hasCash ? `${cashAccounts.length} ${th ? "บัญชี" : "accounts"}` : (th ? "ไม่มีบัญชีเงินสด" : "No cash accounts")} />
              <Metric label={th ? "ปันผล/ปี" : "Annual div."}
                value={annualDiv > 0 ? LUMEN_FMT.money(annualDiv, ccy, { compact: true }) : "—"}
                sub={annualDiv > 0 ? LUMEN_FMT.money(annualDiv / 12, ccy, { compact: true }) + (th ? "/เดือน" : "/mo") : (th ? "ยังไม่มีปันผล" : "No dividends")} />
            </div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div className="label-up">{th ? "มูลค่าพอร์ต" : "Portfolio"} · {chartPeriod}</div>
              <div className="segmented" style={{ gap: 0 }}>
                {["1Y", "3Y", "5Y"].map(p => (
                  <button key={p} className={chartPeriod === p ? "on" : ""} onClick={() => setChartPeriod(p)}
                    style={{ fontSize: 12, padding: "4px 10px" }}>{p}</button>
                ))}
              </div>
            </div>
            {histSeries.length > 0
              ? <LineChart series={histSeries} height={220} fmt={v => LUMEN_FMT.money(v, ccy, { compact: true })} />
              : <div className="muted" style={{ paddingTop: 80, textAlign: "center", fontSize: 13 }}>{th ? "กำลังโหลด…" : "Loading…"}</div>
            }
          </div>
        </div>
      </section>

      {/* ── ROW 2: Allocation + Top Movers ── */}
      <section className="grid grid-12" style={{ marginBottom: 16 }}>
        <div className="card col-span-5">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h3 className="section-title">{t.dashboard.allocation}</h3>
            <button className="btn-ghost btn btn-sm" onClick={() => setRoute("analytics")}>
              {t.dashboard.seeDetails} <Icon name="chevron" size={12} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <Donut data={allocClass} size={180} thickness={26}
                   centerLabel={t.common.total}
                   centerValue={LUMEN_FMT.money(totalValue, ccy, { compact: true })} />
            <div style={{ flex: 1, display: "grid", gap: 10 }}>
              {allocClass.map((s, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", fontSize: 13 }}>
                  <span className="dot" style={{ background: s.color }} />
                  <span>{s.name}</span>
                  <span className="mono">{(s.value / totalValue * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card col-span-7">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h3 className="section-title">{t.dashboard.topMovers}</h3>
            <button className="btn-ghost btn btn-sm" onClick={() => setRoute("portfolio")}>
              {t.common.seeAll} <Icon name="chevron" size={12} />
            </button>
          </div>
          <table className="table" style={{ marginTop: -8 }}>
            <thead><tr>
              <th>{t.portfolio.holding}</th>
              <th></th>
              <th className="num">{th ? "ราคา" : "Last"}</th>
              <th className="num">{th ? "วันนี้" : "Today"}</th>
              <th className="num">{t.portfolio.pl}</th>
            </tr></thead>
            <tbody>
              {movers.map(r => {
                const sparkData = Array.from({ length: 20 }, (_, i) =>
                  Math.sin(i / 3 + r.ticker.length) + Math.cos(i / 2 + r.ticker.length * 2) + (i / 20) * ((r.changePct || r.plPct / 10) > 0 ? 0.6 : -0.6))
                return (
                  <tr key={r.id || r.ticker}>
                    <td>
                      <div className="ticker">
                        <div className="ticker-mark">{r.ticker.slice(0, 2)}</div>
                        <div>
                          <div style={{ fontWeight: 500 }}>{r.ticker}</div>
                          <div className="muted" style={{ fontSize: 11 }}>{r.name}</div>
                        </div>
                      </div>
                    </td>
                    <td><Sparkline data={sparkData} stroke={r.changePct >= 0 ? "var(--gain)" : "var(--loss)"} fill={r.changePct >= 0 ? "var(--gain)" : "var(--loss)"} /></td>
                    <td className="num">{LUMEN_FMT.moneyNative(r.priceNative, r.nativeCcy)}</td>
                    <td className="num">
                      {r.hasLivePrice ? <Delta value={r.changePct} /> : <span className="muted" style={{ fontSize: 12 }}>—</span>}
                    </td>
                    <td className="num">
                      {r.hasLivePrice
                        ? <span style={{ color: r.pl >= 0 ? "var(--gain)" : "var(--loss)", fontSize: 12 }}>
                            {r.pl >= 0 ? "+" : ""}{r.plPct.toFixed(1)}%
                          </span>
                        : <span className="muted" style={{ fontSize: 12 }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── ROW 3: Goals + Insights ── */}
      <section className="grid grid-12" style={{ marginBottom: 16 }}>
        <div className="card col-span-7">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <div>
              <h3 className="section-title">{t.dashboard.goals}</h3>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t.dashboard.goalsSub}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setRoute("planning")}>
              {th ? "ดูทั้งหมด" : "All goals"} <Icon name="chevron" size={12} />
            </button>
          </div>
          {goals.length === 0 ? (
            <div style={{ padding: "20px 0", textAlign: "center" }}>
              <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>{th ? "ยังไม่ได้ตั้งเป้าหมาย" : "No goals set yet"}</p>
              <button className="btn btn-outline btn-sm" onClick={() => setRoute("planning")}>
                <Icon name="plus" size={13} /> {th ? "สร้างเป้าหมายแรก" : "Create first goal"}
              </button>
            </div>
          ) : (
            <div className="grid grid-2" style={{ gap: 12 }}>
              {goals.slice(0, 4).map(g => {
                const pct = Math.min(100, g.target > 0 ? ((g.current || 0) / g.target) * 100 : 0)
                return (
                  <div key={g.id} style={{ padding: 18, borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <GoalRing pct={pct} color={g.color || "var(--ink)"} size={60} stroke={6} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {LUMEN_FMT.money(g.current || 0, ccy, { compact: true })} / {LUMEN_FMT.money(g.target || 0, ccy, { compact: true })}
                        </div>
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {pct >= 100
                            ? <span className="gain">✓ {th ? "สำเร็จ" : "Complete"}</span>
                            : g.eta_year ? `${th ? "เป้า " : "ETA "}${g.eta_year}` : ""}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="col-span-5" style={{ display: "grid", gap: 16 }}>
          <div className="card">
            <h3 className="section-title" style={{ marginBottom: 16 }}>{t.dashboard.insights}</h3>
            {insights.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>{th ? "เพิ่มข้อมูลพอร์ตเพื่อดู insights" : "Add portfolio data to see insights"}</p>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                {insights.map((it, i) => {
                  const dotColor = it.tone === "good" ? "var(--gain)" : it.tone === "warn" ? "var(--loss)" : "var(--ink-3)"
                  return (
                    <div key={i} style={{ display: "flex", gap: 12, paddingBottom: 14, borderBottom: i < insights.length - 1 ? "1px solid var(--line)" : "" }}>
                      <span className="dot" style={{ background: dotColor, marginTop: 6, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{it.title}</div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{it.body}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── ROW 4: Activity + Upcoming dividends ── */}
      <section className="grid grid-12" style={{ marginBottom: 16 }}>
        <div className="card col-span-7">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 className="section-title">{t.dashboard.activity}</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setRoute("portfolio")}>{t.common.seeAll}</button>
          </div>
          {recentTx.length === 0 ? (
            <div style={{ padding: "20px 0" }}>
              <p className="muted" style={{ fontSize: 13 }}>
                {th ? "ยังไม่มีธุรกรรม — เพิ่มหลักทรัพย์เพื่อเริ่มบันทึก" : "No transactions yet — add holdings to start logging"}
              </p>
            </div>
          ) : recentTx.map((a, i) => {
            const type = a.type || "Buy"
            const date = a.transacted_at
              ? new Date(a.transacted_at).toLocaleDateString(th ? "th-TH" : "en-US", { day: "numeric", month: "short" })
              : "—"
            const priceCcy = a.currency || 'THB'
            const dispAmt = (() => {
              const amt = a.amount || (a.shares != null && a.price != null ? a.shares * a.price : 0)
              if (priceCcy === ccy) return amt
              if (priceCcy === 'USD' && ccy === 'THB') return amt * LUMEN_FX.THB_per_USD
              return amt / LUMEN_FX.THB_per_USD
            })()
            return (
              <div key={a.id || i} style={{
                display: "grid", gridTemplateColumns: "24px 64px 1fr auto",
                gap: 14, alignItems: "center", padding: "14px 0",
                borderTop: i === 0 ? "" : "1px solid var(--line)",
              }}>
                <ActivityIcon type={type} />
                <div className="muted mono" style={{ fontSize: 12 }}>{date}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {actionLabel(type, lang)}{a.ticker ? " · " + a.ticker : ""}
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>
                    {a.shares != null && a.price != null
                      ? `${a.shares} ${th ? "หุ้น" : "shares"} @ ${priceCcy === "USD" ? "$" : "฿"}${Number(a.price).toFixed(2)}`
                      : a.note || ""}
                  </div>
                </div>
                <div className="mono" style={{ fontSize: 13, textAlign: "right" }}>
                  {dispAmt > 0 ? LUMEN_FMT.money(dispAmt, ccy, { compact: true }) : ""}
                </div>
              </div>
            )
          })}
        </div>

        <div className="card col-span-5">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 className="section-title">{t.dashboard.upcoming}</h3>
            {upcoming.length > 0 && (
              <span className="chip chip-soft mono">
                ~{LUMEN_FMT.money(upcoming.reduce((s, u) => s + u.amount, 0), ccy, { compact: true })}
              </span>
            )}
          </div>
          {upcoming.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, padding: "12px 0" }}>
              {th ? "เพิ่ม Dividend yield ในหลักทรัพย์เพื่อดูประมาณการปันผล" : "Add dividend yield to holdings to see estimates here"}
            </p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {upcoming.map((u, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "44px 1fr auto", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, background: "var(--bg)" }}>
                  <div style={{ textAlign: "center", padding: "4px 0", background: "var(--card)", borderRadius: 6, border: "1px solid var(--line)" }}>
                    <div style={{ fontSize: 9, color: "var(--ink-3)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                      {u.date.split(" ")[0]}
                    </div>
                    <div className="display" style={{ fontSize: 16, lineHeight: 1 }}>{u.date.split(" ")[1]}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{u.ticker}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{th ? "ปันผล (ประมาณรายไตรมาส)" : "Dividend (est. quarterly)"}</div>
                  </div>
                  <div className="mono" style={{ fontSize: 13 }}>{LUMEN_FMT.money(u.amount, ccy, { compact: true })}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Cash accounts (compact strip) ── */}
      {hasCash && (
        <section className="card" style={{ padding: "16px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 className="section-title" style={{ margin: 0 }}>{th ? "บัญชีเงินสด & เงินฝาก" : "Cash & Savings Accounts"}</h3>
            <button className="btn btn-outline btn-sm" onClick={() => setShowCashModal('add')}>
              <Icon name="plus" size={13} /> {th ? "เพิ่ม" : "Add"}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {cashAccounts.map(a => {
              const b = a.balance || 0, c = a.currency || 'THB'
              const dispBal = c === ccy ? b : c === 'USD' ? b * LUMEN_FX.THB_per_USD : b / LUMEN_FX.THB_per_USD
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent-ink)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Icon name="deposit" size={14} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</div>
                    <div style={{ fontSize: 13, fontFamily: "var(--font-display)" }}>{LUMEN_FMT.money(dispBal, ccy, { compact: true })}</div>
                  </div>
                  <button onClick={() => setShowCashModal(a)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", padding: "3px 6px", borderRadius: 5, fontSize: 14 }}>✎</button>
                  <button onClick={async () => { if (!window.confirm(th ? "ลบบัญชีนี้?" : "Delete this account?")) return; await deleteCashAccount(a.id); refreshCashAccounts() }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-4)", padding: "3px 5px", borderRadius: 5, fontSize: 16 }}>×</button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {showCashModal && (
        <CashAccountModal
          lang={lang} ccy={ccy}
          portfolioId={portfolio?.id}
          account={showCashModal === 'add' ? null : showCashModal}
          onClose={() => setShowCashModal(null)}
          onSaved={async () => { setShowCashModal(null); await refreshCashAccounts() }}
        />
      )}
    </div>
  )
}

// ─── Cash Account Modal ───────────────────────────────────────────────────────
function CashAccountModal({ lang, ccy, portfolioId, account, onClose, onSaved }) {
  const th = lang === "th"
  const isEdit = account != null
  const [form, setForm] = useState({
    label:    account?.label    ?? '',
    balance:  account?.balance != null ? String(account.balance) : '',
    currency: account?.currency ?? 'THB',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!portfolioId) { setError("Portfolio not loaded"); return }
    setSaving(true); setError(null)
    const payload = {
      ...(isEdit ? { id: account.id } : {}),
      label:    form.label.trim(),
      balance:  parseFloat(form.balance) || 0,
      currency: form.currency,
    }
    const { error } = await upsertCashAccount(portfolioId, payload)
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
        width: "100%", maxWidth: 480, boxShadow: "0 -8px 40px rgba(0,0,0,0.12)",
        animation: "slideUp 0.2s ease",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontFamily: "var(--font-display)" }}>
            {isEdit ? (th ? `แก้ไข ${account.label}` : `Edit ${account.label}`) : (th ? "เพิ่มบัญชีเงินสด" : "Add Cash Account")}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, color: "var(--ink-3)" }}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "oklch(0.96 0.05 25)", color: "oklch(0.40 0.12 25)", fontSize: 13 }}>{error}</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {th ? "ชื่อบัญชี" : "Account label"}
            </label>
            <input required value={form.label} onChange={e => set('label', e.target.value)}
              placeholder={th ? "เช่น กระแสรายวัน SCB, HYSA" : "e.g. SCB Savings, Emergency Fund"}
              style={{ padding: "10px 12px", borderRadius: 8, fontSize: 14, border: "1.5px solid var(--line)", background: "var(--bg)", color: "var(--ink)", outline: "none" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {th ? "ยอดคงเหลือ" : "Balance"}
              </label>
              <input required type="number" step="any" min="0" value={form.balance} onChange={e => set('balance', e.target.value)} placeholder="0.00"
                style={{ padding: "10px 12px", borderRadius: 8, fontSize: 14, border: "1.5px solid var(--line)", background: "var(--bg)", color: "var(--ink)", outline: "none" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {th ? "สกุล" : "Currency"}
              </label>
              <select value={form.currency} onChange={e => set('currency', e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 8, fontSize: 14, border: "1.5px solid var(--line)", background: "var(--bg)", color: "var(--ink)", outline: "none" }}>
                <option value="THB">THB</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
              {th ? "ยกเลิก" : "Cancel"}
            </button>
            <button type="submit" className="btn" style={{ flex: 2 }} disabled={saving}>
              {saving ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "บันทึก" : "Save account")}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DashboardEmpty({ t, lang, setRoute }) {
  return (
    <div className="shell fade-in">
      <PageHead kicker={lang === "th" ? "หน้าหลัก" : "Dashboard"} title={t.dashboard.heading} sub={t.dashboard.sub} />
      <div className="card" style={{ padding: 80, textAlign: "center" }}>
        <svg width="64" height="64" viewBox="0 0 64 64" style={{ margin: "0 auto 24px", display: "block" }}>
          <rect x="8" y="14" width="48" height="40" rx="6" fill="none" stroke="var(--line-2)" strokeWidth="1.5" strokeDasharray="4 4" />
          <path d="M14 44 L24 32 L32 38 L44 22 L54 32" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 className="display" style={{ fontSize: 32, margin: "0 0 8px" }}>
          {lang === "th" ? "ยังไม่มีการลงทุน" : "No investments yet"}
        </h2>
        <p className="muted" style={{ fontSize: 14, maxWidth: 380, margin: "0 auto 28px" }}>
          {lang === "th" ? "เพิ่มการลงทุนแรกของคุณ แล้วทุก ๆ ตัวเลขที่นี่จะมีชีวิตขึ้นมา" : "Add your first investment and every number on this page comes to life."}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button className="btn" onClick={() => setRoute("onboarding")}>{t.common.addInvestment}</button>
          <button className="btn btn-outline" onClick={() => setRoute("onboarding")}>{t.onboarding.demo}</button>
        </div>
      </div>
    </div>
  )
}
