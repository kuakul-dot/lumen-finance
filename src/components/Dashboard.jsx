import { useState, useMemo } from 'react'
import { PageHead, Delta, Icon } from './Nav'
import { Sparkline, LineChart, Donut } from './Charts'
import {
  LUMEN_FMT, LUMEN_DERIVE, LUMEN_HISTORY, LUMEN_GOALS,
  LUMEN_ACTIVITY, LUMEN_UPCOMING, LUMEN_INSIGHTS, LUMEN_FX,
} from '../data'

export function DashboardPage({ t, lang, ccy, setRoute, dataState }) {
  if (dataState === "empty") return <DashboardEmpty t={t} lang={lang} setRoute={setRoute} />

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
