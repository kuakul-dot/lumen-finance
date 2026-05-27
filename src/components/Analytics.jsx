import { useState, useMemo, useEffect } from 'react'
import { PageHead, Delta, Icon } from './Nav'
import { LineChart, Donut, BarChart } from './Charts'
import { LUMEN_FMT, LUMEN_DERIVE, LUMEN_HISTORY, LUMEN_BENCH } from '../data'
import { deriveHoldings } from '../lib/db'
import { fetchHistory } from '../lib/prices'

export function AnalyticsPage({ t, lang, ccy, dataState, liveHoldings = [], prices = {}, fxRate = 36 }) {
  const [tab, setTab] = useState("common")

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

  // Earliest holding date — caps chart start so it doesn't show pre-investment history
  const earliestHoldingDate = useMemo(() => {
    if (dataState !== "live" || !liveHoldings.length) return null
    const dates = liveHoldings
      .map(h => h.purchased_at || h.created_at)
      .filter(Boolean)
      .map(d => new Date(d))
      .filter(d => !isNaN(d.getTime()))
    return dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null
  }, [liveHoldings, dataState])

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
            </span>
          </button>
        ))}
      </div>

      {tab === "common"          && <AnalyticsCommon t={t} lang={lang} ccy={ccy} rows={rows} totalValue={totalValue} totalPL={totalPL} totalPlPct={totalPlPct} totalCost={totalCost} hasLivePrices={hasLivePrices} demoData={demoData} dataState={dataState} earliestHoldingDate={earliestHoldingDate} />}
      {tab === "diversification" && <AnalyticsDiv t={t} lang={lang} ccy={ccy} rows={rows} totalValue={totalValue} demoData={demoData} dataState={dataState} />}
      {tab === "dividends"       && <AnalyticsDiv2 t={t} lang={lang} ccy={ccy} rows={rows} totalValue={totalValue} dataState={dataState} />}
      {tab === "growth"          && <AnalyticsGrowth t={t} lang={lang} ccy={ccy} totalValue={totalValue} totalCost={totalCost} totalPL={totalPL} totalPlPct={totalPlPct} dataState={dataState} earliestHoldingDate={earliestHoldingDate} />}
      {tab === "metrics"         && <AnalyticsMetrics t={t} lang={lang} ccy={ccy} rows={rows} totalValue={totalValue} totalPL={totalPL} totalPlPct={totalPlPct} dataState={dataState} />}
    </div>
  )
}

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
function AnalyticsCommon({ t, lang, ccy, rows, totalValue, totalPL, totalPlPct, totalCost, hasLivePrices, demoData, dataState, earliestHoldingDate }) {
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

  // Which buttons are usable in live mode? (need enough history)
  const periodDaysMap = useMemo(() => {
    const startOfYear = new Date(new Date().getFullYear(), 0, 1)
    const ytdDays = Math.max(1, Math.round((Date.now() - startOfYear.getTime()) / 86400000))
    return { "1m": 30, "3m": 90, "6m": 180, "ytd": ytdDays, "1y": 365, "5y": 365 * 5, "all": daysSinceFirst }
  }, [daysSinceFirst])
  const isPeriodEnabled = (k) => dataState !== "live" || periodDaysMap[k] <= daysSinceFirst + 7  // small tolerance

  // Real S&P 500 historical close prices (USD) — fetched once, sliced per-period client-side.
  // Request a range that covers the maximum enabled button so we don't refetch on click.
  const [spxData, setSpxData] = useState(null)  // { series, currency }
  useEffect(() => {
    if (dataState !== "live") return
    const range = daysSinceFirst >= 365 * 2 ? "5y"
                : daysSinceFirst >= 365     ? "2y"
                : daysSinceFirst >= 180     ? "1y"
                : daysSinceFirst >= 90      ? "6mo" : "3mo"
    let cancelled = false
    fetchHistory("^GSPC", range).then(d => { if (!cancelled) setSpxData(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [dataState, daysSinceFirst])
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

    const range = totalValue - totalCost
    const noiseScale = Math.max(Math.abs(range) * 0.1, totalCost * 0.015)
    const easeAt = p => p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p
    const noiseAt = (i, seed) => (
      Math.sin(i * 0.61 + seed) * 0.55 +
      Math.sin(i * 1.43 + seed * 1.7) * 0.30 +
      Math.sin(i * 2.91 + seed * 2.3) * 0.18 +
      Math.cos(i * 4.27 + seed * 3.1) * 0.10
    )
    const mkLabel = d => d.toLocaleString(th ? "th-TH" : "en-US", { month: "short" }) + " '" + String(d.getFullYear()).slice(2)

    // Slice real S&P 500 series to the chosen window
    const spxAll = spxData?.series || []
    const cutoffSec = (now.getTime() - totalDays * 86400000) / 1000
    const spxSlice = spxAll.filter(p => p.t >= cutoffSec)
    const hasSpx = spxSlice.length >= 2

    if (!hasSpx) {
      // S&P 500 not loaded yet → portfolio-only line with synthetic timeline
      const portPts = Math.max(8, Math.min(60, Math.round(totalDays / 7)))
      const portStepD = totalDays / (portPts - 1)
      return [{
        name: th ? "พอร์ตของคุณ" : "Your portfolio",
        color: "var(--ink)", fill: true,
        data: Array.from({ length: portPts }, (_, i) => {
          const p = i / (portPts - 1)
          const fade = Math.sin(Math.PI * p)
          const y = totalCost + range * easeAt(p) + noiseAt(i, 1.7) * noiseScale * fade
          const d = new Date(now); d.setDate(d.getDate() - (portPts - 1 - i) * portStepD)
          return { x: i, y, label: mkLabel(d) }
        })
      }]
    }

    // Downsample S&P to ~weekly resolution; both series will share the same N
    const targetPts = Math.max(8, Math.min(60, Math.round(totalDays / 7)))
    const stride = Math.max(1, Math.floor(spxSlice.length / targetPts))
    let sampled = spxSlice.filter((_, i) => i % stride === 0)
    // Always include the latest close so the chart ends today
    if (sampled.length === 0 || sampled[sampled.length - 1] !== spxSlice[spxSlice.length - 1]) {
      sampled = [...sampled, spxSlice[spxSlice.length - 1]]
    }
    const N = sampled.length
    const baseClose = sampled[0].c

    // Portfolio matched to S&P's exact timestamps (same N points, same x = 0..N-1)
    const portfolioSeries = {
      name: th ? "พอร์ตของคุณ" : "Your portfolio",
      color: "var(--ink)", fill: true,
      data: sampled.map((p, i) => {
        const prog = i / (N - 1)
        const fade = Math.sin(Math.PI * prog)
        const y = totalCost + range * easeAt(prog) + noiseAt(i, 1.7) * noiseScale * fade
        return { x: i, y, label: mkLabel(new Date(p.t * 1000)) }
      })
    }

    const sp500Series = {
      name: "S&P 500",
      color: "var(--accent)",
      data: sampled.map((p, i) => ({
        x: i,
        y: totalCost * (p.c / baseClose),
        label: mkLabel(new Date(p.t * 1000)),
      }))
    }

    return [portfolioSeries, sp500Series]
  }, [dataState, totalCost, totalValue, th, chartPeriod, periodDaysMap, daysSinceFirst, spxData])

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
            label={t.analytics.twr}
            value={(totalPlPct >= 0 ? "+" : "") + totalPlPct.toFixed(1) + "%"}
            sub={th ? "จากต้นทุน · " + rows.length + " ตำแหน่ง" : "vs. cost · " + rows.length + " positions"}
            tone={totalPlPct >= 0 ? "gain" : "loss"} />
        ) : (
          <BigKpi className="col-span-3" label={t.analytics.twr} value="+18.3%" sub={th ? "12 เดือนล่าสุด" : "trailing 12-mo"} tone="gain" />
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
              <h3 className="section-title">{th ? "มูลค่าพอร์ต vs. S&P 500" : "Portfolio value vs. S&P 500"}</h3>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                <span className="dot" style={{ background: "var(--ink)" }} /> {th ? "พอร์ตของคุณ" : "Your portfolio"}
                {dataState === "live" && (
                  <span style={{ fontSize: 11, color: "var(--ink-4)", marginLeft: 4 }}>
                    {th ? "(จำลองช่วงที่ลงทุน)" : "(simulated within investment window)"}
                  </span>
                )}
                <span style={{ marginLeft: 12 }}><span className="dot" style={{ background: "var(--accent)" }} /> S&P 500</span>
                {dataState === "live" && spxData?.series?.length > 0 && (
                  <span style={{ fontSize: 11, color: "var(--ink-4)", marginLeft: 4 }}>
                    {th ? "(ราคาจริงจาก Yahoo Finance)" : "(real prices · Yahoo Finance)"}
                  </span>
                )}
              </div>
            </div>
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
          <LineChart series={dataState === "live" ? liveSeries : series} height={340} fmt={v => FMT.money(v, ccy, { compact: true })} />
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
      <div className="ticker-mark">{r.ticker.slice(0, 2)}</div>
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

/* ─── Dividends tab ──────────────────────────────────────────────────────────── */
function AnalyticsDiv2({ t, lang, ccy, rows, totalValue, dataState }) {
  const FMT = LUMEN_FMT
  const th = lang === "th"
  const annual      = rows.reduce((a, r) => a + r.value * (r.divYield || 0) / 100, 0)
  const yieldOnPort = totalValue > 0 ? (annual / totalValue) * 100 : 0
  const payers      = rows.filter(r => r.divYield > 0).map(r => ({ ...r, annual: r.value * r.divYield / 100 })).sort((a, b) => b.annual - a.annual)

  // Live: cluster dividends in typical quarterly months (Mar/Jun/Sep/Dec heavy)
  // Demo: smooth sine pattern
  const months = ["Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May"]
  const quarterlyWeights = [0.6, 0.4, 0.3, 1.6, 0.5, 0.4, 1.7, 0.4, 0.3, 1.6, 0.5, 1.7]  // sums to 10
  const monthlyData = months.map((m, i) => ({
    label: m,
    value: dataState === "live"
      ? (annual / 10) * quarterlyWeights[i]   // realistic quarterly pattern
      : (annual / 12) * (1 + Math.sin(i) * 0.3 + Math.cos(i * 1.7) * 0.18),
  }))

  return (
    <div className="fade-in grid grid-12">
      <BigKpi className="col-span-3" label={t.analytics.yield}
        value={FMT.pct(yieldOnPort, 2)} sub={th ? "บนมูลค่าตลาด" : "on market value"} />
      <BigKpi className="col-span-3" label={t.analytics.payout}
        value={annual > 0 ? FMT.money(annual, ccy, { compact: true }) : "—"}
        sub={annual > 0 ? FMT.money(annual / 12, ccy, { compact: true }) + " " + (th ? "ต่อเดือน" : "/mo") : (th ? "ยังไม่มีปันผล" : "no payers yet")}
        tone={annual > 0 ? "gain" : undefined} />
      <BigKpi className="col-span-3" label={th ? "เติบโต 5 ปี" : "5y div growth"}
        value={th ? "ต้องการประวัติ" : "Needs history"} sub={th ? "ยังไม่มีข้อมูล" : "no data"} />
      <BigKpi className="col-span-3" label={th ? "หลักทรัพย์จ่ายปันผล" : "Payers"}
        value={payers.length + "/" + rows.length} sub={th ? "หลักทรัพย์จ่ายปันผล" : "income-producing"} />

      <div className="card col-span-7">
        <h3 className="section-title" style={{ marginBottom: 16 }}>
          {th ? "ปันผลรายเดือน (ประมาณ 12 เดือนถัดไป)" : "Estimated monthly payouts (next 12 months)"}
        </h3>
        {annual > 0 ? (
          <BarChart data={monthlyData} height={220} color="var(--accent-ink)" fmt={v => FMT.money(v, ccy, { compact: true })} />
        ) : (
          <div style={{ padding: "48px 0", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
            {th ? "ยังไม่มีหลักทรัพย์ที่จ่ายปันผล เพิ่ม div yield % ตอนเพิ่มหลักทรัพย์" : "No dividend-paying holdings yet. Add a div yield % when adding a holding."}
          </div>
        )}
      </div>

      <div className="card col-span-5">
        <h3 className="section-title" style={{ marginBottom: 16 }}>
          {th ? "ผู้จ่ายปันผลสูงสุด" : "Top dividend payers"}
        </h3>
        {payers.length === 0 ? (
          <div style={{ padding: "20px 0", color: "var(--ink-3)", fontSize: 13 }}>
            {th ? "ยังไม่มีข้อมูลปันผล" : "No dividend data yet"}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {payers.slice(0, 6).map(p => (
              <div key={p.ticker} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                <div className="ticker-mark">{p.ticker.slice(0, 2)}</div>
                <div>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{p.ticker}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{FMT.pct(p.divYield, 1)} yield</div>
                </div>
                <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>{FMT.money(p.value, ccy, { compact: true })}</div>
                <div className="mono" style={{ fontSize: 13, color: "var(--accent-ink)" }}>+{FMT.money(p.annual, ccy, { compact: true })}/y</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Growth tab ─────────────────────────────────────────────────────────────── */
function AnalyticsGrowth({ t, lang, ccy, totalValue, totalCost, totalPL, totalPlPct, dataState, earliestHoldingDate }) {
  const FMT = LUMEN_FMT
  const th = lang === "th"

  const daysSinceFirst = useMemo(() => {
    if (dataState !== "live" || !earliestHoldingDate) return 365 * 5
    return Math.max(1, Math.round((Date.now() - earliestHoldingDate.getTime()) / 86400000))
  }, [dataState, earliestHoldingDate])

  const defaultGrowthPeriod = useMemo(() => {
    if (dataState !== "live") return "1Y"
    if (daysSinceFirst >= 365) return "1Y"
    return "1Y" // 1Y always exists; we'll cap to available days
  }, [dataState, daysSinceFirst])
  const [chartPeriod, setChartPeriod] = useState(defaultGrowthPeriod)
  useEffect(() => { setChartPeriod(defaultGrowthPeriod) }, [defaultGrowthPeriod])

  const growthPeriodDaysMap = { "1Y": 365, "3Y": 365 * 3, "5Y": 365 * 5 }
  const isGrowthEnabled = (k) => dataState !== "live" || growthPeriodDaysMap[k] <= daysSinceFirst + 7
  const monthLabels = ["Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May"]
  const port = LUMEN_HISTORY, bench = LUMEN_BENCH
  const v0 = port[0].v, b0 = bench[0].v
  const series = [
    {
      name: th ? "พอร์ตของคุณ" : "Your portfolio",
      color: "var(--ink)", fill: true,
      data: port.map((p, i) => ({ x: i, y: (p.v / v0 - 1) * 100, label: monthLabels[i % 12] + " '" + (24 + Math.floor(i / 12)) })),
    },
    {
      name: "S&P 500",
      color: "var(--accent)", dashed: true,
      data: bench.map((p, i) => ({ x: i, y: (p.v / b0 - 1) * 100, label: monthLabels[i % 12] + " '" + (24 + Math.floor(i / 12)) })),
    },
  ]

  // Live mode: cumulative return % within the actual investment window
  const liveSeries = useMemo(() => {
    if (dataState !== "live" || totalCost <= 0 || totalValue <= 0) return null
    const now = new Date()
    const requestedDays = growthPeriodDaysMap[chartPeriod] || 365
    const totalDays = Math.max(7, Math.min(requestedDays, daysSinceFirst))
    const pts = Math.max(8, Math.min(60, Math.round(totalDays / 7)))
    const stepD = totalDays / (pts - 1)
    const finalPct = totalPlPct
    const noiseScale = Math.max(Math.abs(finalPct) * 0.12, 1.0)
    const easeAt = p => p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p
    const noiseAt = (i, seed) => (
      Math.sin(i * 0.61 + seed) * 0.55 +
      Math.sin(i * 1.43 + seed * 1.7) * 0.30 +
      Math.sin(i * 2.91 + seed * 2.3) * 0.18 +
      Math.cos(i * 4.27 + seed * 3.1) * 0.10
    )
    return [{
      name: th ? "พอร์ตของคุณ" : "Your portfolio",
      color: "var(--ink)", fill: true,
      data: Array.from({ length: pts }, (_, i) => {
        const p = i / (pts - 1)
        const fade = Math.sin(Math.PI * p)
        const y = finalPct * easeAt(p) + noiseAt(i, 1.7) * noiseScale * fade
        const d = new Date(now); d.setDate(d.getDate() - (pts - 1 - i) * stepD)
        const lbl = d.toLocaleString(th ? "th-TH" : "en-US", { month: "short" }) + " '" + String(d.getFullYear()).slice(2)
        return { x: i, y, label: lbl }
      })
    }]
  }, [dataState, totalCost, totalValue, totalPlPct, th, chartPeriod, daysSinceFirst])

  // Approximate CAGR assuming the simulated curve spans ~1 year baseline
  const approxYrs = chartPeriod === "1Y" ? 1 : chartPeriod === "3Y" ? 3 : 5
  const cagr = dataState === "live" && totalCost > 0 && totalValue > 0
    ? (Math.pow(totalValue / totalCost, 1 / approxYrs) - 1) * 100
    : null

  // Simulated max drawdown from synthetic curve (rough indicator)
  const drawdown = useMemo(() => {
    if (!liveSeries?.[0]?.data?.length) return null
    let peak = -Infinity, maxDd = 0
    liveSeries[0].data.forEach(p => {
      if (p.y > peak) peak = p.y
      const dd = p.y - peak
      if (dd < maxDd) maxDd = dd
    })
    return maxDd
  }, [liveSeries])

  const yrs = [
    { label: "2023", port: 12.4, bench: 24.2 },
    { label: "2024", port: 18.9, bench: 23.3 },
    { label: "2025", port: 22.1, bench: 14.0 },
    { label: "2026 YTD", port: 8.4, bench: 5.1 },
  ]

  return (
    <div className="fade-in">
      <div className="grid grid-12" style={{ marginBottom: 16 }}>
        {dataState === "live" ? (
          <>
            <BigKpi className="col-span-3"
              label={th ? "ผลตอบแทนรวม (จากต้นทุน)" : "Total return (vs. cost)"}
              value={(totalPlPct >= 0 ? "+" : "") + totalPlPct.toFixed(1) + "%"}
              sub={(totalPL >= 0 ? "+" : "") + FMT.money(totalPL, ccy, { compact: true })}
              tone={totalPlPct >= 0 ? "gain" : "loss"} />
            <BigKpi className="col-span-3"
              label={"CAGR (" + chartPeriod + " approx)"}
              value={cagr != null ? (cagr >= 0 ? "+" : "") + cagr.toFixed(1) + "%" : "—"}
              sub={th ? "ประมาณการจากจำนวนปี" : "estimated annualized"}
              tone={cagr != null ? (cagr >= 0 ? "gain" : "loss") : undefined} />
            <BigKpi className="col-span-3"
              label={t.analytics.vsBench}
              value={th ? "ต้องการประวัติจริง" : "Needs real history"}
              sub={th ? "เทียบ S&P 500 ยังไม่พร้อม" : "S&P 500 baseline unavailable"} />
            <BigKpi className="col-span-3"
              label={t.analytics.drawdown + (th ? " (จำลอง)" : " (sim)")}
              value={drawdown != null ? drawdown.toFixed(1) + "%" : "—"}
              sub={th ? "จากเส้นโค้งจำลอง" : "from simulated curve"}
              tone={drawdown != null && drawdown < -5 ? "loss" : undefined} />
          </>
        ) : (
          <>
            <BigKpi className="col-span-3" label={th ? "ผลตอบแทนรวม" : "Total return"} value="+58.7%" sub={th ? "ตั้งแต่เริ่ม" : "since inception"} tone="gain" />
            <BigKpi className="col-span-3" label="CAGR" value="+16.6%" sub={th ? "3 ปีถ่วงเวลา" : "3-yr annualized"} tone="gain" />
            <BigKpi className="col-span-3" label={t.analytics.vsBench} value="+4.2pp" sub={th ? "ดีกว่า S&P 500" : "outperforming"} tone="gain" />
            <BigKpi className="col-span-3" label={t.analytics.drawdown} value="-9.8%" sub={th ? "ก.ค. 2024" : "Jul 2024"} tone="loss" />
          </>
        )}
      </div>

      {dataState === "live" ? (
        liveSeries ? (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
              <div>
                <h3 className="section-title">{th ? "ผลตอบแทนสะสม (จำลอง)" : "Cumulative return (simulated)"}</h3>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {th
                    ? "% เปลี่ยนแปลงจากต้นทุน · เส้นโค้งจำลอง"
                    : "% change from cost basis · simulated curve"}
                </div>
              </div>
              <div className="segmented">
                {["1Y","3Y","5Y"].map(k => {
                  const enabled = isGrowthEnabled(k)
                  return (
                    <button key={k}
                            className={chartPeriod === k ? "on" : ""}
                            disabled={!enabled}
                            title={!enabled ? (th ? "ข้อมูลย้อนหลังไม่พอ" : "Not enough history yet") : undefined}
                            style={{ opacity: enabled ? 1 : 0.35, cursor: enabled ? "pointer" : "not-allowed" }}
                            onClick={() => enabled && setChartPeriod(k)}>
                      {k}
                    </button>
                  )
                })}
              </div>
            </div>
            <LineChart series={liveSeries} height={320} fmt={v => v.toFixed(0) + "%"} />
          </div>
        ) : (
          <div className="card" style={{ marginBottom: 16, padding: "36px 48px", display: "flex", alignItems: "center", gap: 24 }}>
            <svg width="48" height="48" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
              <rect x="4" y="8" width="40" height="32" rx="4" fill="none" stroke="var(--line-2)" strokeWidth="1.5" strokeDasharray="4 4" />
              <path d="M8 28 L18 18 L26 22 L36 12 L44 16" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
        )
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
              <h3 className="section-title">{th ? "ผลตอบแทนสะสม (เริ่มที่ 0%)" : "Cumulative return (rebased to 0%)"}</h3>
              <div className="segmented">
                {["3m","6m","ytd","1y","3y","all"].map(k => (
                  <button key={k} className={k === "all" ? "on" : ""}>{t.analytics.timeRange[k] || k.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <LineChart series={series} height={320} fmt={v => v.toFixed(0) + "%"} />
          </div>
          <div className="card">
            <h3 className="section-title" style={{ marginBottom: 16 }}>{th ? "ผลตอบแทนรายปี" : "Annual returns"}</h3>
            <div className="grid grid-4" style={{ gap: 14 }}>
              {yrs.map(y => (
                <div key={y.label} style={{ padding: 16, border: "1px solid var(--line)", borderRadius: 12 }}>
                  <div className="label-up" style={{ marginBottom: 8 }}>{y.label}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 }}>
                    <div className="display" style={{ fontSize: 24, color: y.port > y.bench ? "var(--gain)" : "var(--loss)" }}>+{y.port}%</div>
                    <div className="mono muted" style={{ fontSize: 12 }}>S&P {y.bench >= 0 ? "+" : ""}{y.bench}%</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div className="bar" style={{ flex: 1, height: 4 }}><span style={{ width: Math.min(100, y.port / 30 * 100) + "%", background: "var(--ink)" }} /></div>
                    <div className="bar" style={{ flex: 1, height: 4 }}><span style={{ width: Math.min(100, y.bench / 30 * 100) + "%", background: "var(--accent)" }} /></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ─── Metrics tab — live-aware ──────────────────────────────────────────────── */
function AnalyticsMetrics({ t, lang, ccy, rows = [], totalValue = 0, totalPL = 0, totalPlPct = 0, dataState }) {
  const th = lang === "th"
  const isLive = dataState === "live"

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
        body: th ? "0 = กระจายมาก · 100 = หุ้นเดียว — ต่ำ = ดี" : "0 = highly diversified · 100 = single holding — lower is safer" },
      { key: "top3", value: top3.toFixed(0) + "%", scale: top3 / 100,
        min: "0%", max: "100%", inverse: top3 > 60,
        sub: th ? "น้ำหนัก 3 อันดับแรก" : "Top-3 weight",
        body: th ? "% ของพอร์ตในตำแหน่ง 3 อันดับแรก (มาก = กระจุก)" : "% in top 3 positions (high = concentrated)" },
      { key: "largest", value: topOne.toFixed(1) + "%", scale: Math.min(1, topOne / 50),
        min: "0%", max: "50%+", inverse: topOne > 30,
        sub: th ? "ตำแหน่งใหญ่สุด" : "Largest position",
        body: th ? "หุ้นใหญ่สุด — เกิน 30% ถือว่าเสี่ยงกระจุก" : "Largest single holding — >30% is concentration risk" },
      { key: "classes", value: uniqueClasses.toString(), scale: Math.min(1, uniqueClasses / 6),
        min: "1", max: "6+",
        sub: th ? "ประเภทสินทรัพย์" : "Asset classes",
        body: th ? "ความหลากหลายของประเภทสินทรัพย์ในพอร์ต" : "Number of distinct asset classes held" },
      { key: "yield", value: wYield.toFixed(2) + "%", scale: Math.min(1, wYield / 6),
        min: "0%", max: "6%+",
        sub: th ? "อัตราปันผลถ่วงน้ำหนัก" : "Weighted div yield",
        body: th ? "อัตราปันผลเฉลี่ยตามน้ำหนักของแต่ละหลักทรัพย์" : "Dividend yield weighted by each holding's portfolio weight" },
      { key: "geo", value: thWeight.toFixed(0) + "% / " + usWeight.toFixed(0) + "%", scale: Math.abs(thWeight - usWeight) / 100,
        min: "TH", max: "US", inverse: Math.abs(thWeight - usWeight) > 70,
        sub: th ? "สัดส่วนภูมิภาค (TH / US)" : "Region split (TH / US)",
        body: th ? "ยิ่งเอียงสุดทาง ความเสี่ยงตลาดเดียวยิ่งสูง" : "Lopsided splits expose you to single-market risk" },
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
    twr:      th ? "วัดผลพอร์ตจริงโดยตัดผลของกระแสเงินสด"          : "Measures portfolio's true performance excluding cash flows",
    pe:       th ? "ค่าเฉลี่ยถ่วงน้ำหนักของ P/E ตามน้ำหนักในพอร์ต" : "Weighted average P/E across all individual stocks",
    beta:     th ? "ความผันผวนเทียบกับตลาด (S&P 500)"                : "Volatility relative to the market (S&P 500)",
    sharpe:   th ? "วัดผลตอบแทนต่อความเสี่ยงรวม"                     : "How well profitability compensates for total risk",
    sortino:  th ? "วัดผลตอบแทนต่อความเสี่ยงขาลงเท่านั้น"           : "How well profitability compensates for downside risk",
    drawdown: th ? "การลดลงสูงสุดจากจุดสูงสุดในประวัติ"              : "Largest peak-to-trough decline observed",
  }

  const metricsList = isLive && liveMetrics ? liveMetrics : demoMetrics
  const bodyMap = isLive ? null : demoBody

  return (
    <div className="fade-in">
      <div className="card" style={{ padding: "12px 20px", marginBottom: 16, background: "var(--bg-2)", display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name="info" size={14} />
        <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
          {isLive
            ? (th
              ? "ตัวชี้วัดด้านล่างคำนวณจากพอร์ตจริง · ตัวที่ต้องการประวัติย้อนหลัง (TWR/Beta/Sharpe) ยังไม่พร้อม"
              : "Metrics below are computed from your live portfolio · history-dependent ones (TWR/Beta/Sharpe) require daily snapshots")
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
        {metricsList.map(m => (
          <div key={m.key} className="card" style={{ padding: 28 }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
              {m.sub} <Icon name="info" size={13} />
            </h4>
            <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 22 }}>
              {isLive ? m.body : bodyMap[m.key]}
            </p>
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
        ))}
      </div>

      {isLive && (
        <div className="card" style={{ marginTop: 16, padding: "20px 24px", background: "var(--bg-2)" }}>
          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            {th ? "ตัวชี้วัดที่ต้องการประวัติย้อนหลัง" : "Metrics that need historical data"}
          </h4>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            {th
              ? "TWR · CAGR (จริง) · Beta · Sharpe · Sortino · Max Drawdown — ตัวเหล่านี้ต้องการ snapshots ราคาพอร์ตรายวันต่อเนื่อง อยู่ระหว่างพัฒนา"
              : "TWR · CAGR (true) · Beta · Sharpe · Sortino · Max Drawdown — these need continuous daily portfolio snapshots. In development."}
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
