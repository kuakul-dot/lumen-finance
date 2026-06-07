import { useState, useMemo, useEffect, useRef } from 'react'
import { PageHead, Delta, Icon, TickerLogo, AllocCategoryIcon } from './Nav'
import { CalcInput } from './CalcInput'
import { Sparkline, LineChart, Donut } from './Charts'
import { AiAnalysisModal } from './AiModal'
import { useAiAnalysis } from '../lib/useAiAnalysis'
import {
  LUMEN_FMT, LUMEN_DERIVE, LUMEN_HISTORY, LUMEN_GOALS,
  LUMEN_ACTIVITY, LUMEN_UPCOMING, LUMEN_INSIGHTS, LUMEN_FX,
} from '../data'
import { deriveHoldings, upsertCashAccount, deleteCashAccount, getGoals, getAllTransactions } from '../lib/db'
import { fetchHistory, toYahooSymbol, clearPriceCache } from '../lib/prices'

function makeGreeting(name, lang) {
  const h = new Date().getHours()
  const slot = h < 5 ? 3 : h < 12 ? 0 : h < 17 ? 1 : h < 21 ? 2 : 3
  const grEn = ["Good morning", "Good afternoon", "Good evening", "Good night"]
  const grTh = ["สวัสดีตอนเช้า", "สวัสดีตอนบ่าย", "สวัสดีตอนเย็น", "สวัสดีตอนดึก"]
  if (!name) return lang === "th" ? grTh[slot] : grEn[slot]
  return lang === "th" ? `${grTh[slot]} ${name}` : `${grEn[slot]}, ${name}`
}

function makeGreetingSub(lang) {
  const h = new Date().getHours()
  const slot = h < 5 ? 3 : h < 12 ? 0 : h < 17 ? 1 : h < 21 ? 2 : 3
  const subEn = [
    "Here's your morning financial overview.",
    "Here's where your money stands this afternoon.",
    "Here's where your money stands tonight.",
    "Here's where your money stands tonight.",
  ]
  const subTh = [
    "นี่คือภาพรวมการเงินเช้านี้",
    "นี่คือภาพรวมการเงินบ่ายนี้",
    "นี่คือภาพรวมการเงินคืนนี้",
    "นี่คือภาพรวมการเงินคืนนี้",
  ]
  return lang === "th" ? subTh[slot] : subEn[slot]
}

export function DashboardPage({ t, lang, ccy, setRoute, dataState, liveHoldings = [], prices = {}, cashAccounts = [], portfolio, refreshHoldings, refreshCashAccounts, displayName = '', fxRate = 36, lastPriceUpdate = null }) {
  if (dataState === "empty") return <DashboardEmpty t={t} lang={lang} setRoute={setRoute} />
  if (dataState === "live") return (
    <LiveDashboardPage
      t={t} lang={lang} ccy={ccy} setRoute={setRoute}
      liveHoldings={liveHoldings} prices={prices}
      cashAccounts={cashAccounts} portfolio={portfolio}
      refreshHoldings={refreshHoldings}
      refreshCashAccounts={refreshCashAccounts}
      displayName={displayName}
      fxRate={fxRate}
      lastPriceUpdate={lastPriceUpdate}
    />
  )

  return <DemoDashboardPage t={t} lang={lang} ccy={ccy} setRoute={setRoute} />
}

// ─── Demo Dashboard ─────────────────────────────────────────────────────────
function DemoDashboardPage({ t, lang, ccy, setRoute }) {
  const [chartPeriod, setChartPeriod] = useState("3Y")

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

  const histSeries = useMemo(() => {
    const cfg = { "1Y": { pts: 12, stepM: 1 }, "3Y": { pts: 18, stepM: 2 }, "5Y": { pts: 20, stepM: 3 } }
    const { pts, stepM } = cfg[chartPeriod] || cfg["3Y"]
    const now = new Date()
    return [{
      name: t.dashboard.netWorth,
      color: "var(--ink)", fill: true,
      data: Array.from({ length: pts }, (_, i) => {
        const p = i / (pts - 1)
        const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p
        const noise = (Math.sin(i * 2.3) * 0.012 + Math.cos(i * 4.1) * 0.008) * cost
        const d = new Date(now.getFullYear(), now.getMonth() - (pts - 1 - i) * stepM, 1)
        const lbl = d.toLocaleString(lang === "th" ? "th-TH" : "en-US", { month: "short" }) + " '" + String(d.getFullYear()).slice(2)
        return { x: i, y: cost + (value - cost) * ease + noise, label: lbl }
      }),
    }]
  }, [chartPeriod, value, cost, lang, t.dashboard.netWorth])

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
              <div className="label-up">{lang === "th" ? "พอร์ตการลงทุน" : "Portfolio"} · {chartPeriod}</div>
              <div className="segmented" style={{ gap: 0 }}>
                {["1Y", "3Y", "5Y"].map(p => (
                  <button key={p} className={chartPeriod === p ? "on" : ""} onClick={() => setChartPeriod(p)}
                    style={{ fontSize: 12, padding: "4px 10px" }}>{p}</button>
                ))}
              </div>
            </div>
            <LineChart series={histSeries} height={220} fmt={v => LUMEN_FMT.money(v, ccy, { compact: true })} />
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
                        <TickerLogo ticker={m.ticker} logoUrl={m.logo_url} region={m.region} cls={m.cls} size={30} />
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

// Groups same-ticker derived rows for display — preserves raw DB lots, aggregates for UI
function groupRowsByTicker(rows) {
  const map = new Map()
  rows.forEach(r => {
    if (!map.has(r.ticker)) {
      map.set(r.ticker, { ...r })
    } else {
      const g = map.get(r.ticker)
      const totalValue  = g.value + r.value
      const totalPL     = g.pl + r.pl
      const totalShares = (g.shares || 0) + (r.shares || 0)
      const costBasis   = totalValue - totalPL
      map.set(r.ticker, {
        ...g,
        value:     totalValue,
        pl:        totalPL,
        plPct:     costBasis > 0 ? (totalPL / costBasis) * 100 : 0,
        shares:    totalShares,
        changePct: totalValue > 0
          ? ((g.changePct || 0) * g.value + (r.changePct || 0) * r.value) / totalValue
          : (g.changePct || 0),
        hasLivePrice: g.hasLivePrice || r.hasLivePrice,
      })
    }
  })
  const result = [...map.values()]
  const total  = result.reduce((s, r) => s + r.value, 0)
  return result.map(r => ({ ...r, weight: total > 0 ? (r.value / total) * 100 : 0 }))
}

// ─── Live Dashboard — matches demo layout with real data ─────────────────────
function LiveDashboardPage({ t, lang, ccy, setRoute, liveHoldings, prices = {}, cashAccounts = [], portfolio, refreshHoldings, refreshCashAccounts, displayName = '', fxRate = 36, lastPriceUpdate = null }) {
  const th = lang === "th"
  const [showCashModal, setShowCashModal] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [manualRefreshedAt, setManualRefreshedAt] = useState(null)
  const [refreshCooldown, setRefreshCooldown] = useState(false)

  // Show the most recent update: manual click takes priority, otherwise auto-refresh
  const lastRefreshedAt = manualRefreshedAt ?? lastPriceUpdate

  const handleRefresh = async () => {
    if (refreshing || refreshCooldown || !refreshHoldings) return
    setRefreshing(true)
    clearPriceCache()
    try {
      await refreshHoldings()
      setManualRefreshedAt(new Date())
    } finally {
      setRefreshing(false)
      setRefreshCooldown(true)
      setTimeout(() => setRefreshCooldown(false), 30_000)
    }
  }
  // ── AI analysis (optional feature — auto-hides when /api/analyze 503s) ──
  const [aiAvailable, setAiAvailable] = useState(false)
  const ai = useAiAnalysis()
  useEffect(() => {
    fetch('/api/analyze').then(r => r.json()).then(j => {
      setAiAvailable(!!j?.available)
    }).catch(() => setAiAvailable(false))
  }, [])
  const [goals, setGoals] = useState([])
  const [allTx, setAllTx] = useState([])
  const recentTx = useMemo(
    () => [...allTx].sort((a, b) => new Date(b.transacted_at) - new Date(a.transacted_at)).slice(0, 5),
    [allTx]
  )

  useEffect(() => {
    if (!portfolio) return
    if (portfolio.user_id) {
      getGoals(portfolio.user_id).then(setGoals).catch(() => {})
    }
    getAllTransactions(portfolio.id).then(d => setAllTx(d || [])).catch(() => {})
  }, [portfolio?.id, portfolio?.user_id])

  const rows          = useMemo(() => deriveHoldings(liveHoldings, ccy, prices, fxRate), [liveHoldings, ccy, prices, fxRate])

  // Earliest *real* investment date — prefer Buy transactions' transacted_at
  // (user-entered), fall back to holdings.purchased_at / created_at.
  const earliestHoldingDate = useMemo(() => {
    const candidates = []
    allTx.filter(tx => (tx.type || 'Buy') === 'Buy')
         .forEach(tx => { if (tx.transacted_at) candidates.push(new Date(tx.transacted_at)) })
    liveHoldings.forEach(h => {
      if (h.purchased_at) candidates.push(new Date(h.purchased_at))
      else if (h.created_at) candidates.push(new Date(h.created_at))
    })
    const valid = candidates.filter(d => !isNaN(d.getTime()))
    return valid.length ? new Date(Math.min(...valid.map(d => d.getTime()))) : null
  }, [allTx, liveHoldings])

  const daysSinceFirst = useMemo(() => {
    if (!earliestHoldingDate) return 365 * 5
    return Math.max(1, Math.round((Date.now() - earliestHoldingDate.getTime()) / 86400000))
  }, [earliestHoldingDate])

  // Auto-pick default period to fit available history
  const defaultPeriod = useMemo(() => {
    if (daysSinceFirst >= 365 * 3) return "3Y"
    if (daysSinceFirst >= 365)     return "1Y"
    return "1Y"
  }, [daysSinceFirst])
  const [chartPeriod, setChartPeriod] = useState(defaultPeriod)
  useEffect(() => { setChartPeriod(defaultPeriod) }, [defaultPeriod])
  const periodDaysMap = { "1Y": 365, "3Y": 365 * 3, "5Y": 365 * 5, "All": daysSinceFirst }
  const isPeriodEnabled = (k) => k === "All" || periodDaysMap[k] <= daysSinceFirst + 7

  // ── Earliest Buy timestamp per ticker (from recorded transactions) ──────────
  const purchaseSecByTicker = useMemo(() => {
    const map = {}
    allTx.filter(tx => tx.type === 'Buy' && tx.transacted_at && tx.ticker).forEach(tx => {
      const sec = new Date(tx.transacted_at).getTime() / 1000
      if (!(tx.ticker in map) || sec < map[tx.ticker]) map[tx.ticker] = sec
    })
    return map
  }, [allTx])

  // ── Fetch historical prices for each holding (real portfolio chart) ────────
  const [holdingHistories, setHoldingHistories] = useState({})
  useEffect(() => {
    if (liveHoldings.length === 0) return
    let cancelled = false
    const range = daysSinceFirst > 365 * 2 ? '5y' : daysSinceFirst > 365 ? '2y' : '1y'
    const symbols = [...new Set(
      liveHoldings.map(h => toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity'))
    )]
    Promise.all(
      symbols.map(sym => fetchHistory(sym, range).then(d => [sym, d]).catch(() => [sym, { series: [] }]))
    ).then(results => {
      if (!cancelled) {
        const map = {}
        results.forEach(([sym, d]) => { map[sym] = d })
        setHoldingHistories(map)
      }
    })
    return () => { cancelled = true }
  }, [liveHoldings, daysSinceFirst])

  // True when at least one holding has real price history loaded
  const hasRealHistory = useMemo(() =>
    liveHoldings.some(h => {
      const sym = toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity')
      return (holdingHistories[sym]?.series?.length || 0) >= 5
    })
  , [liveHoldings, holdingHistories])

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

  // cashTotal is always in THB; LUMEN_FMT.money handles display conversion
  const cashTotal = useMemo(() => cashAccounts.reduce((s, a) => {
    const b = a.balance || 0, c = a.currency || 'THB'
    return s + (c === 'USD' ? b * fxRate : b)
  }, 0), [cashAccounts, fxRate])
  const netWorth = totalValue + cashTotal
  const hasCash  = cashAccounts.length > 0

  // Emergency-protected cash: portion of shield accounts up to their target.
  // Only the EXCESS above target is investable; the rest is locked as buffer.
  const { emergencyProtected, investableCash } = useMemo(() => {
    let protected_ = 0, investable = 0
    cashAccounts.forEach(a => {
      const bal = (a.currency === 'USD' ? (a.balance || 0) * fxRate : (a.balance || 0))
      const target = a.icon === 'shield' && a.target_balance
        ? (a.currency === 'USD' ? a.target_balance * fxRate : a.target_balance)
        : 0
      const locked = Math.min(bal, target)
      protected_ += locked
      investable += bal - locked
    })
    return { emergencyProtected: protected_, investableCash: investable }
  }, [cashAccounts, fxRate])

  // Allocation breakdown — selectable dimension
  const [allocMode, setAllocMode] = useState("regionclass")
  const ALLOC_MODES = [
    { k: "regionclass", label: th ? "ภูมิภาค + ประเภท" : "Region + class" },
    { k: "class",       label: th ? "ประเภทสินทรัพย์" : "Asset class" },
    { k: "region",      label: th ? "ภูมิภาค" : "Region" },
    { k: "holding",     label: th ? "รายหลักทรัพย์" : "By holding" },
  ]
  const allocClass = useMemo(() => {
    if (rows.length === 0 && cashTotal <= 0) return []
    const keyOf = r => {
      if (allocMode === "class")   return r.cls || "Equity"
      if (allocMode === "region")  return r.region === "TH" ? (th ? "ไทย" : "Thailand") : (th ? "สหรัฐฯ" : "United States")
      if (allocMode === "holding") return r.ticker
      return r.cls === "Equity"    // regionclass (default)
        ? (r.region === "TH" ? (th ? "หุ้นไทย" : "TH Equity") : (th ? "หุ้น US" : "US Equity"))
        : r.cls
    }
    const map = {}
    rows.forEach(r => { const k = keyOf(r); map[k] = (map[k] || 0) + r.value })
    const colors = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"]
    let arr = Object.entries(map).map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value)
    // By-holding can be long — keep the top slices, fold the rest into "Others"
    if (allocMode === "holding" && arr.length > 8) {
      const rest = arr.slice(7).reduce((s, x) => s + x.value, 0)
      arr = [...arr.slice(0, 7), { name: th ? "อื่นๆ" : "Others", value: rest, _other: true }]
    }
    // Only investable cash counts in allocation — Emergency Fund is excluded
    if (investableCash > 0) arr.push({ name: th ? "เงินสด" : "Cash", value: investableCash, _cash: true })
    return arr.map((x, i) => ({
      ...x,
      color: x._cash  ? "oklch(0.82 0.04 230)"
           : x._other ? "var(--ink-4)"
           : colors[i % colors.length],
    }))
  }, [rows, th, allocMode, investableCash])

  // Allocation table — same grouping as donut but enriched with cost basis + P/L
  const [expandedCats, setExpandedCats] = useState(new Set())
  const [allocSortKey, setAllocSortKey] = useState("allocPct")
  const [allocSortDir, setAllocSortDir] = useState("desc")

  const toggleCat = name => setExpandedCats(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  const allocTable = useMemo(() => {
    if (rows.length === 0 && cashTotal <= 0) return []
    const keyOf = r => {
      if (allocMode === "class")   return r.cls || "Equity"
      if (allocMode === "region")  return r.region === "TH" ? (th ? "ไทย" : "Thailand") : (th ? "สหรัฐฯ" : "United States")
      if (allocMode === "holding") return r.ticker
      return r.cls === "Equity"
        ? (r.region === "TH" ? (th ? "หุ้นไทย" : "TH Equity") : (th ? "หุ้น US" : "US Equity"))
        : r.cls
    }
    const map = {}
    rows.forEach(r => {
      const k = keyOf(r)
      if (!map[k]) map[k] = { name: k, value: 0, costBasis: 0, pl: 0, holdings: [] }
      map[k].value    += r.value
      map[k].costBasis += r.shares * r.cost  // per-share cost × shares = total cost basis
      map[k].pl       += r.pl
      map[k].holdings.push(r)
    })
    if (investableCash > 0) {
      const cashKey = th ? "เงินสด" : "Cash"
      map[cashKey] = { name: cashKey, value: investableCash, costBasis: investableCash, pl: 0, holdings: [], _cash: true }
    }
    // Emergency Fund is intentionally excluded from the allocation view
    // (it's protected capital, not an investable allocation)
    const investableTotal = totalValue + investableCash   // denominator = investable only
    const denom = investableTotal > 0 ? investableTotal : totalValue
    return Object.values(map).map(g => ({
      ...g,
      plPct:    g.costBasis > 0 ? (g.pl / g.costBasis) * 100 : 0,
      allocPct: denom > 0 ? (g.value / denom) * 100 : 0,
      count:    new Set(g.holdings.map(r => r.ticker)).size,
      color:    allocClass.find(a => a.name === g.name)?.color || (g._cash ? "oklch(0.82 0.04 230)" : "var(--ink-4)"),
    }))
  }, [rows, allocMode, th, investableCash, hasCash, totalValue, allocClass])

  const sortedAllocTable = useMemo(() => {
    return [...allocTable].sort((a, b) => {
      const av = a[allocSortKey], bv = b[allocSortKey]
      const cmp = typeof av === "string" ? av.localeCompare(bv) : (av ?? 0) - (bv ?? 0)
      return allocSortDir === "asc" ? cmp : -cmp
    })
  }, [allocTable, allocSortKey, allocSortDir])

  const setAllocSort = key => {
    if (allocSortKey === key) setAllocSortDir(d => d === "asc" ? "desc" : "asc")
    else { setAllocSortKey(key); setAllocSortDir("desc") }
  }

  // Top movers — group same-ticker lots first, then sort by |changePct|
  const movers = useMemo(() => {
    const grouped = groupRowsByTicker(rows)
    const live = grouped.filter(r => r.hasLivePrice)
    const list = live.length >= 3
      ? [...live].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      : [...grouped].sort((a, b) => b.value - a.value)
    return list.slice(0, 5)
  }, [rows])

  // ── Portfolio value chart ──────────────────────────────────────────────────
  // Priority: real historical prices from Yahoo Finance (per holding × shares)
  // Fallback: simulated cost→current path when history not yet loaded
  const histSeries = useMemo(() => {
    if (totalCostBasis <= 0 || totalValue <= 0) return []
    const now = new Date()
    const requestedDays = periodDaysMap[chartPeriod] || 365
    const totalDays = Math.max(7, Math.min(requestedDays, daysSinceFirst))
    const cutoffSec = (now.getTime() - totalDays * 86400000) / 1000

    const locale = th ? "th-TH" : "en-US"
    const mkLabel = d => {
      if (totalDays < 60) return d.toLocaleString(locale, { month: "short", day: "numeric" })
      return d.toLocaleString(locale, { month: "short" }) + " '" + String(d.getFullYear()).slice(2)
    }

    // ── Real data path ────────────────────────────────────────────────────────
    const holdingData = liveHoldings.map(h => {
      const sym = toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity')
      const series = (holdingHistories[sym]?.series || []).filter(p => p.t >= cutoffSec)
      const purchaseSec = purchaseSecByTicker[h.ticker] || 0
      const priceCcy = (h.region || 'TH') === 'TH' ? 'THB' : 'USD'
      return { ...h, sym, series, purchaseSec, priceCcy }
    })

    const hasReal = holdingData.some(h => h.series.length >= 5)

    if (hasReal) {
      // Collect all timestamps from all holdings within window
      const allTs = new Set()
      holdingData.forEach(h => h.series.forEach(p => allTs.add(p.t)))
      const sortedTs = [...allTs].sort((a, b) => a - b)

      if (sortedTs.length >= 2) {
        // Downsample to ~60 points
        const targetPts = Math.max(8, Math.min(60, Math.round(totalDays / 7)))
        const stride = Math.max(1, Math.floor(sortedTs.length / targetPts))
        let sampled = sortedTs.filter((_, i) => i % stride === 0)
        if (sampled[sampled.length - 1] !== sortedTs[sortedTs.length - 1]) {
          sampled = [...sampled, sortedTs[sortedTs.length - 1]]
        }

        // Pre-sort each holding's series for fast forward-fill lookups
        const lookups = holdingData.map(h => ({
          ...h, sorted: [...h.series].sort((a, b) => a.t - b.t)
        }))

        // Forward-fill: return last known price at or before `ts`
        const getPriceAt = (sorted, ts) => {
          let price = null
          for (const p of sorted) {
            if (p.t <= ts) price = p.c
            else break
          }
          return price
        }

        const seriesData = sampled.map((ts, idx) => {
          let val = 0
          lookups.forEach(h => {
            // Skip holding not yet purchased at this date (1-day buffer)
            if (h.purchaseSec > 0 && ts < h.purchaseSec - 86400) return
            const price = getPriceAt(h.sorted, ts)
            if (!price || price <= 0) return
            const priceTHB = h.priceCcy === 'USD' ? price * fxRate : price
            val += h.shares * priceTHB
          })
          return { x: idx, y: val, label: mkLabel(new Date(ts * 1000)) }
        }).filter(p => p.y > 50)   // drop near-zero points before first purchase

        // Anchor last point to live INVESTED value so chart tip = INVESTED display
        // (history API returns yesterday's close; live quote may differ intraday)
        if (seriesData.length > 0 && totalValue > 0) {
          seriesData[seriesData.length - 1].y = totalValue
        }

        if (seriesData.length >= 2) {
          return [{ name: th ? "มูลค่าพอร์ต" : "Portfolio value", color: "var(--ink)", fill: true, data: seriesData }]
        }
      }
    }

    // ── Simulated fallback (while history loads) ──────────────────────────────
    const diff = totalValue - totalCostBasis
    const noiseScale = Math.max(Math.abs(diff) * 0.1, totalCostBasis * 0.015)
    const ease  = p => p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p
    const noise = (i, s) => (
      Math.sin(i * 0.61 + s) * 0.55 + Math.sin(i * 1.43 + s * 1.7) * 0.30 +
      Math.sin(i * 2.91 + s * 2.3) * 0.18 + Math.cos(i * 4.27 + s * 3.1) * 0.10
    )
    const pts = Math.max(8, Math.min(60, Math.round(totalDays / 7)))
    const stepD = totalDays / (pts - 1)
    return [{
      name: th ? "มูลค่าพอร์ต" : "Portfolio value",
      color: "var(--ink)", fill: true,
      data: Array.from({ length: pts }, (_, i) => {
        const p = i / (pts - 1)
        const d = new Date(now); d.setDate(d.getDate() - (pts - 1 - i) * stepD)
        return { x: i, y: totalCostBasis + diff * ease(p) + noise(i, 1.7) * noiseScale * Math.sin(Math.PI * p), label: mkLabel(d) }
      })
    }]
  }, [liveHoldings, holdingHistories, purchaseSecByTicker, totalCostBasis, totalValue, th, chartPeriod, daysSinceFirst, fxRate])

  const chartLabel = chartPeriod

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
    // Region skew — heavily weighted to one market
    if (rows.length >= 2) {
      const byRegion = {}
      rows.forEach(r => { const k = r.region === "TH" ? "TH" : "US"; byRegion[k] = (byRegion[k] || 0) + r.value })
      const tot = (byRegion.TH || 0) + (byRegion.US || 0)
      if (tot > 0) {
        const usPct = (byRegion.US || 0) / tot * 100
        const heavyPct = Math.max(usPct, 100 - usPct)
        if (heavyPct >= 80) {
          const heavy = usPct >= 50 ? (th ? "หุ้น US" : "US equities") : (th ? "หุ้นไทย" : "Thai equities")
          out.push({
            title: th ? `เอียงไป${heavy} ${heavyPct.toFixed(0)}%` : `${heavyPct.toFixed(0)}% in ${heavy}`,
            body:  th ? "กระจายข้ามภูมิภาคช่วยลดความเสี่ยงตลาดเดียว" : "Diversifying across regions reduces single-market risk",
            tone: heavyPct >= 90 ? "warn" : "neutral"
          })
        }
      }
    }
    // Idle cash — only count investable portion (excludes emergency fund up to target)
    if (netWorth > 0 && investableCash > 0) {
      const cashPct = investableCash / netWorth * 100
      if (cashPct >= 15) {
        out.push({
          title: th ? `เงินสดพร้อมลงทุน ${cashPct.toFixed(0)}% ของพอร์ตรวม` : `Investable cash is ${cashPct.toFixed(0)}% of net worth`,
          body:  th ? `~${LUMEN_FMT.money(investableCash, ccy, { compact: true })} ยังไม่ลงทุน — พิจารณานำไปลงทุน` : `~${LUMEN_FMT.money(investableCash, ccy, { compact: true })} idle — consider deploying it`,
          tone: cashPct >= 30 ? "warn" : "neutral"
        })
      }
    }
    // Standout performer — the holding with the largest move (best or worst)
    const livePerf = groupRowsByTicker(rows).filter(r => r.hasLivePrice && Number.isFinite(r.plPct))
    if (livePerf.length >= 2) {
      const standout = [...livePerf].sort((a, b) => Math.abs(b.plPct) - Math.abs(a.plPct))[0]
      if (standout && Math.abs(standout.plPct) >= 10) {
        const up = standout.plPct >= 0
        out.push({
          title: th ? `${standout.ticker} ${up ? "กำไร +" : "ขาดทุน "}${standout.plPct.toFixed(1)}%` : `${standout.ticker} ${up ? "up +" : "down "}${standout.plPct.toFixed(1)}%`,
          body:  up ? (th ? "ตัวที่ทำกำไรดีสุดในพอร์ต" : "Your strongest performer")
                    : (th ? "ตัวที่อ่อนแรงสุด — ทบทวนสมมุติฐานการถือ" : "Your weakest holding — review your thesis"),
          tone: up ? "good" : "warn"
        })
      }
    }
    if (rows.length > 0) {
      // Group lots by ticker before finding the top holding (avoids showing per-lot weight)
      const tickerWeights = {}
      rows.forEach(r => { tickerWeights[r.ticker] = (tickerWeights[r.ticker] || 0) + r.weight })
      const topEntry = Object.entries(tickerWeights).sort((a, b) => b[1] - a[1])[0]
      if (topEntry && topEntry[1] > 35) {
        out.push({
          title: th ? `${topEntry[0]} ครอง ${topEntry[1].toFixed(1)}% ของพอร์ต` : `${topEntry[0]} is ${topEntry[1].toFixed(1)}% of portfolio`,
          body:  th ? "ความเสี่ยงกระจุกตัวสูง — ควรพิจารณา rebalance" : "High concentration risk — consider rebalancing",
          tone: topEntry[1] > 50 ? "warn" : "neutral"
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
    return out.slice(0, 5)
  }, [rows, totalPL, totalPlPct, annualDiv, ccy, th, cashTotal, netWorth])

  // Upcoming — estimated quarterly dividends (aggregated by ticker to avoid per-lot duplicates)
  const upcoming = useMemo(() => {
    const now = new Date()
    // Aggregate multiple lots of same ticker
    const tickerMap = {}
    rows.filter(r => (r.divYield || 0) > 0).forEach(r => {
      if (!tickerMap[r.ticker]) tickerMap[r.ticker] = { ...r, value: 0 }
      tickerMap[r.ticker].value += r.value
    })
    return Object.values(tickerMap)
      .map(r => ({ ...r, annual: r.value * r.divYield / 100 }))
      .sort((a, b) => b.annual - a.annual)
      .slice(0, 4)
      .map((r, i) => {
        const freq = r.divFrequency || 4
        const monthsInterval = Math.round(12 / freq)
        const d = new Date(now.getFullYear(), now.getMonth() + monthsInterval * (i + 1), 15)
        const freqLabel = th
          ? (freq === 1 ? "รายปี" : freq === 2 ? "ราย 6 เดือน" : freq === 4 ? "รายไตรมาส" : "รายเดือน")
          : (freq === 1 ? "Annual" : freq === 2 ? "Semi-annual" : freq === 4 ? "Quarterly" : "Monthly")
        return {
          ticker: r.ticker,
          amount: r.value * r.divYield / 100 / freq,
          date: d.toLocaleString(th ? "th-TH" : "en-US", { month: "short" }) + " " + d.getDate(),
          freqLabel,
        }
      })
  }, [rows, th])

  const today = new Date().toLocaleDateString(th ? "th-TH" : "en-US", { weekday: "long", day: "numeric", month: "long" })

  // Run an AI portfolio analysis with a privacy-conscious payload
  // (no names / labels / account IDs — just structured ticker/weight/return).
  const runAi = () => {
    const groupedStocks = groupRowsByTicker(rows).map(r => ({
      ticker:   r.ticker,
      region:   r.region,
      cls:      r.cls,
      valueTHB: Math.round(r.value),
      pctOfNetWorth: netWorth > 0 ? +((r.value / netWorth) * 100).toFixed(1) : 0,
      pctOfStocks:   totalValue > 0 ? +((r.value / totalValue) * 100).toFixed(1) : 0,
      plPct:    Number.isFinite(r.plPct) ? +r.plPct.toFixed(1) : null,
      divYield: +Number(r.divYield || 0).toFixed(2),
    }))
    const cashList = cashAccounts.map(a => ({
      currency: a.currency || 'THB',
      balanceTHB: Math.round((a.currency === 'USD' ? (Number(a.balance) || 0) * fxRate : (Number(a.balance) || 0))),
    }))
    const payload = {
      lang,
      portfolio: {
        // Explicit counts so the AI doesn't have to count the stocks/cash
        // arrays itself (it occasionally off-by-ones long lists).
        counts: {
          stocksTotal: groupedStocks.length,
          stocksTH:    groupedStocks.filter(s => s.region === 'TH').length,
          stocksUS:    groupedStocks.filter(s => s.region !== 'TH').length,
          cashAccounts: cashList.length,
        },
        totals: {
          netWorthTHB:  Math.round(netWorth),
          stocksTHB:    Math.round(totalValue),
          cashTHB:      Math.round(cashTotal),
          annualDivTHB: Math.round(annualDiv),
        },
        stocks: groupedStocks,
        cash: cashList,
      },
    }
    ai.run(payload)
  }

  if (rows.length === 0) {
    return (
      <div className="shell fade-in">
        <PageHead kicker={(th ? "หน้าหลัก · " : "Dashboard · ") + today} title={makeGreeting(displayName, lang)} sub={makeGreetingSub(lang)} />
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
  <>
    <div className="shell fade-in" data-screen-label="Dashboard">
      <PageHead
        kicker={(th ? "หน้าหลัก · " : "Dashboard · ") + today}
        title={makeGreeting(displayName, lang)}
        sub={makeGreetingSub(lang)}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {aiAvailable && (
              <button className="btn btn-outline btn-sm" onClick={runAi} disabled={ai.loading}
                title={th ? "วิเคราะห์พอร์ตด้วย AI" : "Analyse portfolio with AI"}>
                <Icon name="spark" size={14} /> {ai.loading ? (th ? "กำลังวิเคราะห์…" : "Analysing…") : (th ? "วิเคราะห์ด้วย AI" : "AI analysis")}
              </button>
            )}
            {/* Price refresh */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {lastRefreshedAt && !refreshing && (
                <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
                  {lastPriceUpdate && !manualRefreshedAt
                    ? (th ? "Auto " : "Auto ")
                    : (th ? "อัปเดต " : "Updated ")}
                  {lastRefreshedAt.toLocaleTimeString(th ? "th-TH" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              )}
              <button
                className="btn btn-outline btn-sm"
                onClick={handleRefresh}
                disabled={refreshing || refreshCooldown}
                title={
                  refreshCooldown ? (th ? "รอสักครู่…" : "Please wait…")
                  : (th ? "รีเฟรชราคา" : "Refresh prices")
                }
                style={{ padding: "6px 10px", opacity: refreshCooldown ? 0.45 : 1 }}
              >
                <span className={refreshing ? "spin" : ""} style={{ display: "inline-flex" }}>
                  <Icon name="refresh" size={14} />
                </span>
              </button>
            </div>
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
              <span style={{ marginLeft: 10, color: "var(--ink-3)", fontWeight: 400 }}>
                1 USD = {fxRate.toFixed(2)} THB
              </span>
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
                sub={
                  hasCash
                    ? emergencyProtected > 0
                      ? `${LUMEN_FMT.money(investableCash, ccy, { compact: true })} ${th ? "ลงทุนได้" : "investable"} · ${LUMEN_FMT.money(emergencyProtected, ccy, { compact: true })} ${th ? "ฉุกเฉิน" : "emergency"}`
                      : `${cashAccounts.length} ${th ? "บัญชี" : "accounts"}`
                    : (th ? "ไม่มีบัญชีเงินสด" : "No cash accounts")
                } />
              <Metric label={th ? "ปันผล/ปี" : "Annual div."}
                value={annualDiv > 0 ? LUMEN_FMT.money(annualDiv, ccy, { compact: true }) : "—"}
                sub={annualDiv > 0 ? LUMEN_FMT.money(annualDiv / 12, ccy, { compact: true }) + (th ? "/เดือน" : "/mo") : (th ? "ยังไม่มีปันผล" : "No dividends")} />
            </div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <div className="label-up">{th ? "มูลค่าพอร์ต" : "Portfolio value"} · {chartLabel}</div>
                {earliestHoldingDate && (
                  <div style={{ fontSize: 10, color: hasRealHistory ? "var(--gain)" : "var(--ink-4)", marginTop: 2 }}>
                    {hasRealHistory
                      ? (th ? `ราคาจริงจาก Yahoo Finance · ${daysSinceFirst} วัน` : `Real prices · Yahoo Finance · ${daysSinceFirst} days`)
                      : (th ? `กำลังโหลดราคาจริง…` : `Loading real prices…`)}
                  </div>
                )}
              </div>
              <div className="segmented" style={{ gap: 0 }}>
                {["1Y", "3Y", "5Y", "All"].map(p => {
                  const enabled = isPeriodEnabled(p)
                  return (
                    <button key={p} className={chartPeriod === p ? "on" : ""}
                      disabled={!enabled}
                      title={!enabled ? (th ? "ข้อมูลย้อนหลังไม่พอ" : "Not enough history") : undefined}
                      onClick={() => enabled && setChartPeriod(p)}
                      style={{ fontSize: 12, padding: "4px 10px", opacity: enabled ? 1 : 0.35, cursor: enabled ? "pointer" : "not-allowed" }}>{p}</button>
                  )
                })}
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 8 }}>
            <h3 className="section-title">{t.dashboard.allocation}</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select value={allocMode} onChange={e => setAllocMode(e.target.value)}
                style={{ padding: "5px 24px 5px 10px", borderRadius: 8, fontSize: 12, border: "1.5px solid var(--line)", background: "var(--bg)", color: "var(--ink)", outline: "none", fontFamily: "var(--font-mono)", fontWeight: 400, cursor: "pointer" }}>
                {ALLOC_MODES.map(m => <option key={m.k} value={m.k}>{m.label}</option>)}
              </select>
              <button className="btn-ghost btn btn-sm" onClick={() => setRoute("analytics")}>
                {t.dashboard.seeDetails} <Icon name="chevron" size={12} />
              </button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            {(() => {
              const investableTotal = totalValue + investableCash
              const allocDenom = investableTotal > 0 ? investableTotal : totalValue
              return (
                <>
                  <Donut data={allocClass} size={180} thickness={26}
                         centerLabel={th ? "พอร์ตลงทุน" : "Investable"}
                         centerValue={LUMEN_FMT.money(allocDenom, ccy, { compact: true })}
                         valueFmt={v => LUMEN_FMT.money(v, ccy, { compact: true })} />
                  <div style={{ flex: 1, display: "grid", gap: 10 }}>
                    {allocClass.map((s, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", fontSize: 13 }}>
                        <span className="dot" style={{ background: s.color }} />
                        <span>{s.name}</span>
                        <span className="mono">{(s.value / allocDenom * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                    {emergencyProtected > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", fontSize: 11, opacity: 0.55, marginTop: 2 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "oklch(0.78 0.10 70)", display: "inline-block" }} />
                        <span>🛡 {th ? "กองฉุกเฉิน (ไม่นับรวม)" : "Emergency (excluded)"}</span>
                        <span className="mono">{LUMEN_FMT.money(emergencyProtected, ccy, { compact: true })}</span>
                      </div>
                    )}
                  </div>
                </>
              )
            })()}
          </div>
          {/* ── Footer stats: positions · largest slice · currency exposure ── */}
          {(() => {
            const denom = (totalValue + investableCash) > 0 ? (totalValue + investableCash) : totalValue
            if (denom <= 0) return null
            const positionCount = new Set(rows.map(r => r.ticker)).size
            const largest = allocClass[0]
            const usdValue =
              rows.filter(r => r.currency === 'USD').reduce((s, r) => s + r.value, 0) +
              cashAccounts.filter(a => a.currency === 'USD').reduce((s, a) => s + (Number(a.balance) || 0) * fxRate, 0)
            const usdPct = (usdValue / denom) * 100
            const thbPct = Math.max(0, 100 - usdPct)
            const tileStyle = { padding: "14px 16px", borderRadius: 12, background: "var(--bg-2)", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }
            return (
              <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {/* Positions */}
                <div style={tileStyle}>
                  <span className="label-up" style={{ fontSize: 9 }}>{th ? "หลักทรัพย์" : "Positions"}</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 22, fontWeight: 600, fontFamily: "var(--font-display)", lineHeight: 1 }}>{positionCount}</span>
                    {investableCash > 0 && <span className="muted" style={{ fontSize: 10.5, fontFamily: "var(--font-mono)" }}>+{cashAccounts.filter(a => !(a.icon === 'shield' && a.target_balance)).length || cashAccounts.length} {th ? "เงินสด" : "cash"}</span>}
                  </div>
                </div>
                {/* Largest slice */}
                <div style={tileStyle}>
                  <span className="label-up" style={{ fontSize: 9 }}>{th ? "ใหญ่สุด" : "Largest"}</span>
                  {largest ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: largest.color, flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{largest.name}</div>
                        <div className="muted" style={{ fontSize: 10.5, fontFamily: "var(--font-mono)" }}>{(largest.value / denom * 100).toFixed(1)}%</div>
                      </div>
                    </div>
                  ) : <span className="muted" style={{ fontSize: 13 }}>—</span>}
                </div>
                {/* Currency exposure with a mini stack bar */}
                <div style={tileStyle}>
                  <span className="label-up" style={{ fontSize: 9 }}>{th ? "สกุลเงิน" : "Currency"}</span>
                  <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: "var(--bg)" }}>
                    <div style={{ width: thbPct + "%", background: "var(--c1)" }} title={`THB ${thbPct.toFixed(0)}%`} />
                    <div style={{ width: usdPct + "%", background: "var(--c2)" }} title={`USD ${usdPct.toFixed(0)}%`} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--ink-3)" }}>
                    <span><span style={{ color: "var(--c1)" }}>●</span> THB {thbPct.toFixed(0)}%</span>
                    <span><span style={{ color: "var(--c2)" }}>●</span> USD {usdPct.toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        {/* Category breakdown table — col-7 right */}
        {allocTable.length > 0 && (
          <div className="card col-span-7" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <th style={{ padding: "12px 20px", textAlign: "left", fontWeight: 600, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)", width: "40%" }}>
                    {th ? "กลุ่ม" : "Category"}
                  </th>
                  <th onClick={() => setAllocSort("value")} style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: allocSortKey === "value" ? "var(--accent-ink)" : "var(--ink-3)", cursor: "pointer", userSelect: "none", width: "25%" }}>
                    {th ? "มูลค่า / ต้นทุน" : "Value / Invested"} {allocSortKey === "value" ? (allocSortDir === "desc" ? "↓" : "↑") : ""}
                  </th>
                  <th onClick={() => setAllocSort("pl")} style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: allocSortKey === "pl" ? "var(--accent-ink)" : "var(--ink-3)", cursor: "pointer", userSelect: "none", width: "20%" }}>
                    {th ? "กำไร/ขาดทุน" : "Gain"} {allocSortKey === "pl" ? (allocSortDir === "desc" ? "↓" : "↑") : ""}
                  </th>
                  <th onClick={() => setAllocSort("allocPct")} style={{ padding: "12px 20px", textAlign: "right", fontWeight: 600, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: allocSortKey === "allocPct" ? "var(--accent-ink)" : "var(--ink-3)", cursor: "pointer", userSelect: "none", width: "15%" }}>
                    {th ? "สัดส่วน" : "Allocation"} {allocSortKey === "allocPct" ? (allocSortDir === "desc" ? "↓" : "↑") : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedAllocTable.map((g, gi) => {
                  const expanded = expandedCats.has(g.name)
                  const isLast = gi === sortedAllocTable.length - 1
                  return (
                    <>
                      {/* Category row */}
                      <tr key={g.name}
                        onClick={() => !g._cash && g.holdings.length > 0 && toggleCat(g.name)}
                        style={{ borderBottom: (expanded || isLast) ? "none" : "1px solid var(--line)", cursor: g._cash || g.holdings.length === 0 ? "default" : "pointer", transition: "background 0.1s" }}
                        onMouseEnter={e => { if (!g._cash) e.currentTarget.style.background = "var(--bg-2)" }}
                        onMouseLeave={e => { e.currentTarget.style.background = "" }}>
                        {/* Name */}
                        <td style={{ padding: "14px 20px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            {/* Color bar */}
                            <div style={{ width: 4, height: 36, borderRadius: 2, background: g.color, flexShrink: 0 }} />
                            <div style={{ width: 36, height: 36, borderRadius: 10, background: g.color + "22", display: "grid", placeItems: "center", flexShrink: 0, overflow: "hidden" }}>
                              <AllocCategoryIcon name={g.name} color={g.color} isCash={g._cash && !g._emergency} isEmergency={!!g._emergency} />
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{g.name}</div>
                              {g._emergency
                                ? <div style={{ fontSize: 10, color: "oklch(0.55 0.10 70)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                                    {th ? "🛡 สำรองฉุกเฉิน" : "🛡 Protected buffer"}
                                  </div>
                                : !g._cash && <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>{g.count} {th ? "รายการ" : g.count === 1 ? "item" : "items"}</div>
                              }
                            </div>
                            {!g._cash && g.holdings.length > 0 && (
                              <span style={{ marginLeft: "auto", color: "var(--ink-4)", fontSize: 11, transition: "transform 0.2s", transform: expanded ? "rotate(90deg)" : "none", display: "inline-block" }}>›</span>
                            )}
                          </div>
                        </td>
                        {/* Value / Invested */}
                        <td style={{ padding: "14px 16px", textAlign: "right" }}>
                          <div style={{ fontWeight: 500, fontFamily: "var(--font-display)", fontSize: 14 }}>
                            {LUMEN_FMT.money(g.value, ccy, { compact: true })}
                          </div>
                          {!g._cash && g.costBasis > 0 && (
                            <div className="muted" style={{ fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 2 }}>
                              {LUMEN_FMT.money(g.costBasis, ccy, { compact: true })}
                            </div>
                          )}
                        </td>
                        {/* Gain */}
                        <td style={{ padding: "14px 16px", textAlign: "right" }}>
                          {g._cash || g.costBasis === 0 ? (
                            <span className="muted" style={{ fontSize: 12 }}>—</span>
                          ) : (
                            <>
                              <div style={{ fontWeight: 500, color: g.pl >= 0 ? "var(--gain)" : "var(--loss)", fontSize: 13 }}>
                                {g.pl >= 0 ? "+" : ""}{LUMEN_FMT.money(g.pl, ccy, { compact: true })}
                              </div>
                              <div style={{ fontSize: 11, color: g.pl >= 0 ? "var(--gain)" : "var(--loss)", fontFamily: "var(--font-mono)", marginTop: 2, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
                                <span style={{ fontSize: 8 }}>{g.pl >= 0 ? "▲" : "▼"}</span>
                                {Math.abs(g.plPct).toFixed(2)}%
                              </div>
                            </>
                          )}
                        </td>
                        {/* Allocation % */}
                        <td style={{ padding: "14px 20px", textAlign: "right" }}>
                          <div style={{ fontWeight: 600, fontSize: 14, fontFamily: "var(--font-display)" }}>
                            {g.allocPct.toFixed(2)}%
                          </div>
                          {/* Mini bar */}
                          <div style={{ height: 3, borderRadius: 99, background: "var(--line)", marginTop: 4, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${g.allocPct}%`, background: g.color, borderRadius: 99 }} />
                          </div>
                        </td>
                      </tr>
                      {/* Expanded holdings rows — grouped by ticker so lots are merged */}
                      {expanded && groupRowsByTicker(g.holdings).map((h, hi, arr) => (
                        <tr key={h.ticker}
                          style={{ background: "var(--bg-2)", borderBottom: hi === arr.length - 1 ? "1px solid var(--line)" : "none" }}>
                          <td style={{ padding: "10px 20px 10px 72px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <TickerLogo ticker={h.ticker} logoUrl={h.logo_url} region={h.region} cls={h.cls} size={26} />
                              <div>
                                <div style={{ fontWeight: 500, fontSize: 12 }}>{h.ticker}</div>
                                <div className="muted" style={{ fontSize: 10 }}>{h.name}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: "10px 16px", textAlign: "right" }}>
                            <div style={{ fontSize: 12, fontFamily: "var(--font-display)" }}>{LUMEN_FMT.money(h.value, ccy, { compact: true })}</div>
                            <div className="muted" style={{ fontSize: 10, fontFamily: "var(--font-mono)", marginTop: 1 }}>{LUMEN_FMT.money(h.shares * h.cost, ccy, { compact: true })}</div>
                          </td>
                          <td style={{ padding: "10px 16px", textAlign: "right" }}>
                            {h.pl != null && h.costBasis !== 0 ? (
                              <>
                                <div style={{ fontSize: 12, color: h.pl >= 0 ? "var(--gain)" : "var(--loss)" }}>{h.pl >= 0 ? "+" : ""}{LUMEN_FMT.money(h.pl, ccy, { compact: true })}</div>
                                <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: h.pl >= 0 ? "var(--gain)" : "var(--loss)", marginTop: 1 }}>{h.plPct >= 0 ? "+" : ""}{h.plPct?.toFixed(1)}%</div>
                              </>
                            ) : <span className="muted" style={{ fontSize: 11 }}>—</span>}
                          </td>
                          <td style={{ padding: "10px 20px", textAlign: "right" }}>
                            <div className="muted" style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>
                              {(hasCash ? netWorth : totalValue) > 0 ? (h.value / (hasCash ? netWorth : totalValue) * 100).toFixed(1) : "0.0"}%
                            </div>
                          </td>
                        </tr>
                      ))}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── ROW 2.5: Today's movers (full width) ── */}
      <section style={{ marginBottom: 16 }}>
        <div className="card">
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
                const sym = toYahooSymbol(r.ticker, r.region || 'TH', r.cls || 'Equity')
                const cutoff = Date.now() / 1000 - 30 * 86400
                const closes = (holdingHistories[sym]?.series || []).filter(p => p.t >= cutoff).map(p => p.c).filter(Number.isFinite)
                const sp = closes.length >= 2 ? closes : null
                const spColor = (sp ? (closes[closes.length - 1] / closes[0] - 1) : r.changePct) >= 0 ? "var(--gain)" : "var(--loss)"
                return (
                  <tr key={r.ticker}>
                    <td>
                      <div className="ticker">
                        <TickerLogo ticker={r.ticker} logoUrl={r.logo_url} region={r.region} cls={r.cls} size={30} />
                        <div>
                          <div style={{ fontWeight: 500 }}>{r.ticker}</div>
                          <div className="muted" style={{ fontSize: 11 }}>{r.name}</div>
                        </div>
                      </div>
                    </td>
                    <td>{sp ? <Sparkline data={sp} stroke={spColor} fill={spColor} /> : <span className="muted" style={{ fontSize: 12 }}>—</span>}</td>
                    <td className="num">{LUMEN_FMT.moneyNative(r.priceNative, r.nativeCcy)}</td>
                    <td className="num">{r.hasLivePrice ? <Delta value={r.changePct} /> : <span className="muted" style={{ fontSize: 12 }}>—</span>}</td>
                    <td className="num">
                      {r.hasLivePrice
                        ? <span style={{ color: r.pl >= 0 ? "var(--gain)" : "var(--loss)", fontSize: 12 }}>{r.pl >= 0 ? "+" : ""}{r.plPct.toFixed(1)}%</span>
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
            // dispAmt always in THB so LUMEN_FMT.money can handle display conversion
            const dispAmt = (() => {
              const amt = a.amount || (a.shares != null && a.price != null ? a.shares * a.price : 0)
              return priceCcy === 'USD' ? amt * fxRate : amt
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
                    <div className="muted" style={{ fontSize: 11 }}>{th ? `ปันผล (${u.freqLabel})` : `Dividend (est. ${u.freqLabel})`}</div>
                  </div>
                  <div className="mono" style={{ fontSize: 13 }}>{LUMEN_FMT.money(u.amount, ccy, { compact: true })}</div>
                </div>
              ))}
              <p style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 4, lineHeight: 1.5 }}>
                {th
                  ? "📅 วันที่เป็นการประมาณการเท่านั้น — คำนวณจากรอบถัดไปทุกๆ 3 เดือน ยังไม่ใช่วันจ่ายจริงจากบริษัท"
                  : "📅 Dates are estimates only — projected as quarterly intervals, not actual company payment dates."}
              </p>
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
              const dispBal = c === 'USD' ? b * fxRate : b
              const isEmergency = a.icon === 'shield' && a.target_balance > 0
              const targetBal = isEmergency ? (c === 'USD' ? a.target_balance * fxRate : a.target_balance) : 0
              const pct = isEmergency ? Math.min(100, (dispBal / targetBal) * 100) : 0
              const full = isEmergency && dispBal >= targetBal
              const excess = isEmergency ? Math.max(0, dispBal - targetBal) : 0
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, border: `1px solid ${isEmergency ? (full ? "oklch(0.85 0.08 150)" : "oklch(0.85 0.08 60)") : "var(--line)"}`, background: "var(--bg)" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: isEmergency ? (full ? "oklch(0.94 0.06 150)" : "oklch(0.96 0.06 60)") : "var(--accent-soft)", color: isEmergency ? (full ? "oklch(0.40 0.12 150)" : "oklch(0.50 0.12 60)") : "var(--accent-ink)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Icon name={a.icon || "deposit"} size={14} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</div>
                    <div style={{ fontSize: 13, fontFamily: "var(--font-display)" }}>{LUMEN_FMT.money(dispBal, ccy, { compact: true })}</div>
                    {isEmergency && (
                      <div style={{ marginTop: 5 }}>
                        {/* Progress bar */}
                        <div style={{ height: 4, borderRadius: 2, background: "var(--line)", overflow: "hidden", marginBottom: 3 }}>
                          <div style={{ height: "100%", width: `${pct}%`, borderRadius: 2, background: full ? "oklch(0.55 0.15 150)" : "oklch(0.65 0.15 60)", transition: "width 0.4s ease" }} />
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                          {full
                            ? <>✓ {th ? "เต็มเป้า" : "Target met"} · {excess > 0 && <span style={{ color: "oklch(0.40 0.12 150)", fontWeight: 600 }}>{th ? `เกิน ${LUMEN_FMT.money(excess, ccy, { compact: true })} — พร้อมลงทุน` : `+${LUMEN_FMT.money(excess, ccy, { compact: true })} investable`}</span>}</>
                            : <>{th ? `${pct.toFixed(0)}% ของเป้า ${LUMEN_FMT.money(targetBal, ccy, { compact: true })}` : `${pct.toFixed(0)}% of ${LUMEN_FMT.money(targetBal, ccy, { compact: true })} target`}</>
                          }
                        </div>
                      </div>
                    )}
                  </div>
                  <button onClick={() => setShowCashModal(a)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", padding: "3px 6px", borderRadius: 5, fontSize: 14 }}>✎</button>
                  <button onClick={async () => { if (!window.confirm(th ? "ลบบัญชีนี้?" : "Delete this account?")) return; await deleteCashAccount(a.id); refreshCashAccounts() }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-4)", padding: "3px 5px", borderRadius: 5, fontSize: 16 }}>×</button>
                </div>
              )
            })}
          </div>
        </section>
      )}

    </div>

    {/* Modal rendered outside .shell to avoid transform stacking-context issues */}
    {showCashModal && (
      <CashAccountModal
        lang={lang} ccy={ccy}
        portfolioId={portfolio?.id}
        account={showCashModal === 'add' ? null : showCashModal}
        onClose={() => setShowCashModal(null)}
        onSaved={async () => { setShowCashModal(null); await refreshCashAccounts() }}
      />
    )}
    {ai.open && (
      <AiAnalysisModal th={th}
        title={th ? "วิเคราะห์พอร์ตด้วย AI" : "AI portfolio analysis"}
        loading={ai.loading} error={ai.error} provider={ai.provider}
        history={ai.history} chatInput={ai.chatInput} chatLoading={ai.chatLoading}
        onChatInput={ai.setChatInput} onSend={ai.ask}
        canChat={ai.canChat}
        onClose={ai.close} onRetry={runAi} />
    )}
  </>
  )
}

// AiAnalysisModal / Markdownish / consumeStream now live in ./AiModal.jsx

// ─── Cash Account Modal ───────────────────────────────────────────────────────
function CashAccountModal({ lang, ccy, portfolioId, account, onClose, onSaved }) {
  const th = lang === "th"
  const isEdit = account != null
  const [form, setForm] = useState({
    label:          account?.label    ?? '',
    balance:        account?.balance != null ? String(account.balance) : '',
    currency:       account?.currency ?? 'THB',
    icon:           account?.icon     ?? 'deposit',
    target_balance: account?.target_balance != null ? String(account.target_balance) : '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const ICON_PRESETS = [
    { k: 'deposit',  label: th ? 'ทั่วไป'    : 'General' },
    { k: 'shield',   label: th ? 'สำรอง'      : 'Emergency' },
    { k: 'dividend', label: th ? 'ปันผล'      : 'Dividend' },
    { k: 'home',     label: th ? 'บ้าน'       : 'Home' },
    { k: 'leaf',     label: th ? 'ระยะยาว'    : 'Long-term' },
    { k: 'currency', label: th ? 'ต่างประเทศ' : 'Foreign' },
  ]

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!portfolioId) { setError("Portfolio not loaded"); return }
    setSaving(true); setError(null)
    const payload = {
      ...(isEdit ? { id: account.id } : {}),
      label:          form.label.trim(),
      balance:        parseFloat(form.balance) || 0,
      currency:       form.currency,
      icon:           form.icon,
      target_balance: (form.icon === 'shield' && form.target_balance)
        ? (parseFloat(form.target_balance) || null)
        : null,
    }
    const { error } = await upsertCashAccount(portfolioId, payload)
    setSaving(false)
    if (error) { setError(error.message); return }
    onSaved()
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--bg)", borderRadius: 18, padding: 28,
        width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
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
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {th ? "ไอคอน" : "Icon"}
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
              {ICON_PRESETS.map(opt => {
                const on = form.icon === opt.k
                return (
                  <button key={opt.k} type="button" onClick={() => set('icon', opt.k)} title={opt.label}
                    style={{
                      display: "grid", placeItems: "center", aspectRatio: "1", borderRadius: 10, cursor: "pointer",
                      border: on ? "1.5px solid var(--accent)" : "1.5px solid var(--line)",
                      background: on ? "var(--accent-soft)" : "var(--bg-2)",
                      color: on ? "var(--accent-ink)" : "var(--ink-2)",
                    }}>
                    <Icon name={opt.k} size={16} />
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {th ? "ยอดคงเหลือ" : "Balance"}
              </label>
              <CalcInput required value={form.balance} onChange={e => set('balance', e.target.value)} placeholder="0.00"
                style={{ padding: "10px 12px", borderRadius: 8, fontSize: 14, border: "1.5px solid var(--line)", background: "var(--bg)", color: "var(--ink)", outline: "none", width: "100%", boxSizing: "border-box" }} />
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
          {/* Emergency target — only shown for shield (Emergency) icon accounts */}
          {form.icon === 'shield' && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "12px 14px", borderRadius: 10, background: "oklch(0.97 0.03 60)", border: "1px solid oklch(0.88 0.06 60)" }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "oklch(0.50 0.12 60)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                🛡 {th ? "งบฉุกเฉินที่ตั้งไว้ (เป้าหมาย)" : "Emergency fund target"}
              </label>
              <CalcInput value={form.target_balance} onChange={e => set('target_balance', e.target.value)}
                placeholder={th ? "เช่น 90000 (3-6 เดือนค่าใช้จ่าย)" : "e.g. 90000 (3-6 months expenses)"}
                style={{ padding: "10px 12px", borderRadius: 8, fontSize: 14, border: "1.5px solid oklch(0.82 0.08 60)", background: "var(--bg)", color: "var(--ink)", outline: "none", width: "100%", boxSizing: "border-box" }} />
              <div style={{ fontSize: 11, color: "oklch(0.55 0.10 60)" }}>
                {th
                  ? "ยอดไม่เกินเป้าจะไม่ถูกนับเป็นเงินพร้อมลงทุน — เกินเป้าจะแนะนำให้ไปลงทุน"
                  : "Balance up to target is protected and excluded from investable cash — excess above target will be flagged for deployment"}
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
              {th ? "ยกเลิก" : "Cancel"}
            </button>
            <button type="submit" className="btn" style={{ flex: 1 }} disabled={saving}>
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
