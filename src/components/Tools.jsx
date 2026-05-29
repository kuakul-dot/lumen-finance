import { useState, useMemo, useEffect } from 'react'
import { PageHead, Icon, TickerLogo } from './Nav'
import { LUMEN_FMT, LUMEN_DERIVE, LUMEN_TARGETS, LUMEN_FX } from '../data'
import { deriveHoldings } from '../lib/db'

// ── Default target allocations (sum = 1.0) ───────────────────────────────────
const DEFAULT_TARGETS = {
  "TH Equity": 0.35,
  "US Equity": 0.25,
  "Bonds":     0.20,
  "Gold":      0.10,
  "Crypto":    0.05,
  "Cash":      0.05,
}
const TARGET_STORAGE_KEY = "lumen_rebalance_targets"

function loadTargets() {
  try {
    const raw = localStorage.getItem(TARGET_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return DEFAULT_TARGETS
}

function saveTargets(t) {
  try { localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(t)) } catch {}
}

const BAND_STORAGE_KEY = "lumen_rebalance_band"
function loadBand() {
  try { const v = parseFloat(localStorage.getItem(BAND_STORAGE_KEY)); if (!isNaN(v)) return v } catch {}
  return 5   // default ±5 percentage-point tolerance
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildCurrentByClass(rows, cash) {
  const map = { "TH Equity": 0, "US Equity": 0, "Bonds": 0, "Gold": 0, "Crypto": 0, "Cash": cash }
  rows.forEach(r => {
    const k = (r.cls === "Equity" || r.cls === "ETF") ? (r.region === "TH" ? "TH Equity" : "US Equity")
            : r.cls === "Bond"      ? "Bonds"
            : r.cls === "Commodity" ? "Gold"
            : r.cls === "Crypto"    ? "Crypto" : "Cash"
    map[k] = (map[k] || 0) + r.value
  })
  return map
}

// Estimated round-trip-ish fee rate by region (TH brokers ~0.157% + VAT;
// many US brokers are commission-free).  Used to reserve cash for fees so a
// suggested buy's total outlay fits the budget.
const FEE_RATE = (region) => region === "TH" ? 0.0017 : 0

// Map a holding to its asset-class bucket
const CLASS_OF = (r) => (r.cls === "Equity" || r.cls === "ETF") ? (r.region === "TH" ? "TH Equity" : "US Equity")
  : r.cls === "Bond" ? "Bonds" : r.cls === "Commodity" ? "Gold" : r.cls === "Crypto" ? "Crypto" : "Cash"

// Icon + colour per asset class (for the rebalance editor)
const CLASS_META = {
  "TH Equity": { icon: "🇹🇭", c: "oklch(0.94 0.04 200)" },
  "US Equity": { icon: "🇺🇸", c: "oklch(0.94 0.04 250)" },
  "Bonds":     { icon: "📜", c: "oklch(0.94 0.04 280)" },
  "Gold":      { icon: "🥇", c: "oklch(0.94 0.06 90)" },
  "Crypto":    { icon: "🪙", c: "oklch(0.94 0.06 65)" },
  "Cash":      { icon: "💵", c: "oklch(0.94 0.04 150)" },
}
function ClassBadge({ name }) {
  const m = CLASS_META[name]
  if (!m) return name
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 22, height: 22, borderRadius: 6, background: m.c, display: "grid", placeItems: "center", fontSize: 12, flexShrink: 0 }}>{m.icon}</span>
      {name}
    </span>
  )
}

export function ToolsPage({ t, lang, ccy, dataState, liveHoldings = [], prices = {}, portfolio, cashAccounts = [], fxRate = 36 }) {
  const FMT = LUMEN_FMT
  const th = lang === "th"

  const [mode,       setMode]       = useState("deposit")
  const [amount,     setAmount]     = useState("50000")
  const [allowSales, setAllowSales] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const [editTargets, setEditTargets] = useState(false)
  const [targets,    setTargets]    = useState(loadTargets)
  const [band,       setBand]       = useState(loadBand)   // tolerance (percentage points)
  const [copied,     setCopied]     = useState(false)
  const [targetMode, setTargetMode] = useState(() => {
    try { const m = localStorage.getItem("lumen_rebalance_mode"); return m === "hybrid" ? "hybrid" : "class" } catch { return "class" }
  })
  const [tickerWeights, setTickerWeights] = useState(() => { try { return JSON.parse(localStorage.getItem("lumen_rebalance_ticker_weights") || "{}") } catch { return {} } })

  // Persist to localStorage
  useEffect(() => { saveTargets(targets) }, [targets])
  useEffect(() => { try { localStorage.setItem(BAND_STORAGE_KEY, String(band)) } catch {} }, [band])
  useEffect(() => { try { localStorage.setItem("lumen_rebalance_mode", targetMode) } catch {} }, [targetMode])
  useEffect(() => { try { localStorage.setItem("lumen_rebalance_ticker_weights", JSON.stringify(tickerWeights)) } catch {} }, [tickerWeights])

  // ── Derive rows ──────────────────────────────────────────────────────────────
  const isLive = dataState === "live"

  const { rows, total, cash } = useMemo(() => {
    if (isLive) {
      const derived = deriveHoldings(liveHoldings, ccy, prices, fxRate)
      // cashTotal always in THB (deriveHoldings also returns THB values)
      const cashTotal = cashAccounts.reduce((s, a) => {
        const b = a.balance || 0, c = a.currency || 'THB'
        return s + (c === 'USD' ? b * fxRate : b)
      }, 0)
      const investTotal = derived.reduce((s, r) => s + r.value, 0)
      return { rows: derived, total: investTotal + cashTotal, cash: cashTotal }
    }
    if (dataState === "empty") return { rows: [], total: 0, cash: 0 }
    const demo = LUMEN_DERIVE()
    return { rows: demo.rows, total: demo.value + demo.cash, cash: demo.cash }
  }, [isLive, liveHoldings, ccy, prices, fxRate, cashAccounts, dataState])

  const currentByClass = useMemo(() => buildCurrentByClass(rows, cash), [rows, cash])

  // User types amount in display currency; convert to THB for internal calculations
  // (total, all values from deriveHoldings, are in THB)
  const dep = parseFloat(amount) || 0
  const depInTHB = ccy === 'USD' ? dep * fxRate : dep
  const newTotal = mode === "deposit" ? total + depInTHB : Math.max(0, total - depInTHB)

  // ── Target editing helpers ───────────────────────────────────────────────────
  // Per-ticker positions (value aggregated across lots)
  const tickerRows = useMemo(() => {
    const m = {}
    rows.forEach(r => { if (!m[r.ticker]) m[r.ticker] = { ...r, value: 0 }; m[r.ticker].value += r.value })
    return Object.values(m).sort((a, b) => b.value - a.value)
  }, [rows])

  // Tickers grouped by class (for hybrid mode)
  const tickersByClass = useMemo(() => {
    const g = {}
    tickerRows.forEach(tr => { const c = CLASS_OF(tr); (g[c] ||= []).push(tr) })
    return g
  }, [tickerRows])

  // Hybrid: within-class weight % per ticker (unset → current share of class)
  const hybridWeightPct = (tr) => {
    if (tickerWeights[tr.ticker] != null) return tickerWeights[tr.ticker]
    const list = tickersByClass[CLASS_OF(tr)] || []
    const classVal = list.reduce((s, x) => s + x.value, 0)
    return classVal > 0 ? (tr.value / classVal) * 100 : 0
  }

  // Hybrid effective target fraction of total = classTarget × (weight ÷ classWeightSum)
  const effHybrid = useMemo(() => {
    const out = {}
    Object.entries(tickersByClass).forEach(([cls, list]) => {
      const ws = list.map(tr => ({ tr, w: hybridWeightPct(tr) }))
      const sum = ws.reduce((s, x) => s + x.w, 0)
      ws.forEach(({ tr, w }) => { out[tr.ticker] = (targets[cls] || 0) * (sum > 0 ? w / sum : 0) })
    })
    return out
  }, [tickersByClass, tickerWeights, targets])

  // Class slider edits (class + hybrid modes both edit class targets)
  const setTargetPct = (key, pctStr) =>
    setTargets(prev => ({ ...prev, [key]: Math.max(0, Math.min(100, parseFloat(pctStr) || 0)) / 100 }))
  const setTickerWeight = (tk, pctStr) =>
    setTickerWeights(prev => ({ ...prev, [tk]: Math.max(0, Math.min(100, parseFloat(pctStr) || 0)) }))

  // Class targets must sum to 100% (within-class weights auto-normalize)
  const activeSum = Object.values(targets).reduce((s, v) => s + v, 0)
  const targetError = Math.abs(activeSum - 1) > 0.001

  const normalizeTargets = () => {
    const sum = Object.values(targets).reduce((s, v) => s + v, 0); if (!sum) return
    setTargets(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v / sum])))
  }

  // ── Rebalance units (class buckets, or per-ticker in hybrid mode) ───────────
  const units = useMemo(() => {
    if (targetMode === "hybrid") {
      return tickerRows.map(tr => ({ key: tr.ticker, current: tr.value, candidates: [tr], tgt: effHybrid[tr.ticker] ?? 0 }))
    }
    const sample = {
      "TH Equity": rows.filter(r => r.region === "TH" && (r.cls === "Equity" || r.cls === "ETF")),
      "US Equity": rows.filter(r => r.region === "US" && (r.cls === "Equity" || r.cls === "ETF")),
      "Bonds":     rows.filter(r => r.cls === "Bond"),
      "Gold":      rows.filter(r => r.cls === "Commodity"),
      "Crypto":    rows.filter(r => r.cls === "Crypto"),
      "Cash":      [],
    }
    return Object.entries(targets).map(([k, tgt]) => ({ key: k, current: currentByClass[k] || 0, candidates: sample[k] || [], tgt }))
  }, [targetMode, tickerRows, effHybrid, targets, currentByClass, rows])

  // ── Suggestions ─────────────────────────────────────────────────────────────
  const suggestions = useMemo(() => units.map(u => {
    const targetValue = newTotal * u.tgt
    const delta = targetValue - u.current
    return { name: u.key, current: u.current, target: targetValue, delta, curPct: total > 0 ? (u.current / total) * 100 : 0, tgtPct: u.tgt * 100, candidates: u.candidates }
  }), [units, newTotal, total])

  // ── Suggested trades ─────────────────────────────────────────────────────────
  // Share sizing: US holdings (e.g. Dime) support fractional shares → keep 4
  // decimals; Thai/other markets trade whole shares → floor to an integer.
  const sizeShares = (cash, priceTHB, region) => {
    if (priceTHB <= 0) return 0
    const raw = cash / priceTHB
    return region === "US" ? Math.floor(raw * 1e4) / 1e4 : Math.floor(raw)
  }

  const trades = useMemo(() => {
    if (!showResult) return []
    const out = []
    suggestions.forEach(s => {
      if (s.name === "Cash") return
      const candidates = s.candidates || []
      if (candidates.length === 0) return
      // Tolerance band: skip classes whose current weight is within `band`
      // percentage points of target (avoids churn on already-balanced classes)
      const driftPP = s.curPct - s.tgtPct
      if (Math.abs(driftPP) < band) return

      if (s.delta > 0) {
        // Underweight → buy (reserve est. fees so the total outlay fits budget)
        const sorted = [...candidates].sort((a, b) => a.value - b.value)
        const split = Math.min(2, sorted.length)
        sorted.slice(0, split).forEach(c => {
          const amt = s.delta / split
          const effPrice = c.price * (1 + FEE_RATE(c.region))   // price incl. fee reserve (THB)
          const sharesNeeded = sizeShares(amt, effPrice, c.region)
          if (sharesNeeded > 0) {
            out.push({ action: "Buy", ticker: c.ticker, name: c.name, shares: sharesNeeded, priceNative: c.priceNative, nativeCcy: c.nativeCcy, amount: sharesNeeded * c.price, cls: s.name, region: c.region, logoUrl: c.logo_url, assetClass: c.cls })
          }
        })
      } else if (allowSales) {
        // Overweight → sell the largest lot
        const sorted = [...candidates].sort((a, b) => b.value - a.value)
        const c = sorted[0]
        if (c) {
          const sharesNeeded = sizeShares(Math.abs(s.delta), c.price, c.region)
          if (sharesNeeded > 0) {
            out.push({ action: "Sell", ticker: c.ticker, name: c.name, shares: sharesNeeded, priceNative: c.priceNative, nativeCcy: c.nativeCcy, amount: sharesNeeded * c.price, cls: s.name, region: c.region, logoUrl: c.logo_url, assetClass: c.cls })
          }
        }
      }
    })
    return out
  }, [suggestions, allowSales, rows, total, showResult, band])

  // cashRemaining in THB (depInTHB minus buy/sell amounts which are also THB)
  const cashRemaining = Math.max(0, depInTHB - trades.filter(tr => tr.action === "Buy").reduce((a, b) => a + b.amount, 0)
                                             + trades.filter(tr => tr.action === "Sell").reduce((a, b) => a + b.amount, 0))

  // Target classes you allocate to but hold nothing in — can't be rebalanced into
  const missingClasses = useMemo(() => {
    const has = {
      "TH Equity": rows.some(r => r.region === "TH" && (r.cls === "Equity" || r.cls === "ETF")),
      "US Equity": rows.some(r => r.region === "US" && (r.cls === "Equity" || r.cls === "ETF")),
      "Bonds":     rows.some(r => r.cls === "Bond"),
      "Gold":      rows.some(r => r.cls === "Commodity"),
      "Crypto":    rows.some(r => r.cls === "Crypto"),
    }
    return Object.entries(targets)
      .filter(([k, v]) => k !== "Cash" && v > 0 && !has[k])
      .map(([k]) => k)
  }, [targets, rows])

  // Export the suggested trades as a .csv download
  const downloadCSV = () => {
    if (!trades.length) return
    const esc = s => `"${String(s ?? "").replace(/"/g, '""')}"`
    const header = ["Action", "Ticker", "Name", "Class", "Shares", "Price", "PriceCcy", `Amount(${ccy})`]
    const body = trades.map(tr => [
      tr.action, tr.ticker, esc(tr.name), tr.cls, tr.shares,
      (tr.priceNative ?? 0).toFixed(2), tr.nativeCcy,
      (ccy === "USD" ? tr.amount / fxRate : tr.amount).toFixed(2),
    ].join(","))
    const csv = [header.join(","), ...body].join("\n")
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `rebalance-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Copy the suggested trades as readable text
  const copyTrades = async () => {
    if (!trades.length) return
    const text = trades.map(tr =>
      `${tr.action === "Buy" ? (th ? "ซื้อ" : "Buy") : (th ? "ขาย" : "Sell")} ${tr.shares} ${tr.ticker} @ ${FMT.moneyNative(tr.priceNative, tr.nativeCcy)} = ${FMT.money(tr.amount, ccy)}`
    ).join("\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  if (dataState === "empty") {
    return (
      <div className="shell fade-in">
        <PageHead title={t.tools.heading} sub={t.tools.sub} />
        <div className="card empty">
          <h2 className="display" style={{ fontSize: 28 }}>{th ? "ตั้งค่าหมวดและเป้าหมายก่อน" : "Set up categories first"}</h2>
          <p>{th ? "เครื่องมือ rebalance ทำงานบนเป้าสัดส่วนที่คุณตั้งไว้" : "The rebalancing tool uses your target allocations"}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="shell fade-in" data-screen-label="Tools">
      <PageHead
        kicker={th ? "เครื่องมือ" : "Tools"}
        title={t.tools.heading}
        sub={t.tools.sub}
        right={
          <button className="btn btn-outline btn-sm" onClick={() => setEditTargets(v => !v)}>
            <Icon name="filter" size={14} />
            {th ? (editTargets ? "ปิดแก้ไข" : "ปรับเป้าหมาย") : (editTargets ? "Done editing" : "Edit targets")}
          </button>
        }
      />

      {/* Tool cards */}
      <div className="grid grid-3" style={{ marginBottom: 24, gap: 12 }}>
        <ToolCard active title={t.tools.rebalance} sub={t.tools.rebalanceSub} icon="filter" />
        <ToolCard locked title={th ? "เครื่องคำนวณเกษียณ" : "Retirement projector"} sub={th ? "ดูว่าเงินจะถึงเมื่อไหร่ ถ้ายังออมเท่านี้" : "Project when you'll reach your retirement number"} icon="leaf" />
        <ToolCard locked title="Tax-loss harvesting" sub={th ? "หาคู่ wash-sale-safe จากตำแหน่งที่ขาดทุน" : "Find wash-sale-safe pairs in your losers"} icon="info" />
      </div>

      <div className="grid grid-12">
        {/* Input panel */}
        <div className="card col-span-5" style={{ height: "fit-content" }}>
          <h3 className="section-title" style={{ marginBottom: 4 }}>{t.tools.rebalance}</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 22 }}>
            {th ? "ใส่จำนวนเงินที่จะฝาก/ถอน เราจะแนะนำการซื้อขายที่สะอาดที่สุด" : "Enter how much you'll deposit or withdraw. We'll suggest the cleanest trades."}
          </p>

          {/* Portfolio summary */}
          <div style={{ display: "flex", gap: 24, marginBottom: 20, padding: "14px 16px", borderRadius: 10, background: "var(--bg-2)" }}>
            <div>
              <div className="label-up" style={{ marginBottom: 3 }}>{th ? "พอร์ตปัจจุบัน" : "Current portfolio"}</div>
              <div style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-display)" }}>{FMT.money(total, ccy, { compact: true })}</div>
            </div>
            {isLive && (
              <div>
                <div className="label-up" style={{ marginBottom: 3 }}>{th ? "ตำแหน่ง" : "Positions"}</div>
                <div style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-display)" }}>{rows.length}</div>
              </div>
            )}
          </div>

          <div className="segmented" style={{ width: "100%", padding: 4 }}>
            <button className={mode === "deposit" ? "on" : ""} style={{ flex: 1, padding: "8px 16px" }} onClick={() => setMode("deposit")}>
              {t.tools.deposit}
            </button>
            <button className={mode === "withdraw" ? "on" : ""} style={{ flex: 1, padding: "8px 16px" }} onClick={() => setMode("withdraw")}>
              {t.tools.withdraw}
            </button>
          </div>

          <label style={{ display: "block", marginTop: 22 }}>
            <div className="label-up" style={{ marginBottom: 8 }}>{t.tools.amount} ({ccy})</div>
            <div style={{ position: "relative" }}>
              <input
                type="number" value={amount} onChange={e => { setAmount(e.target.value); setShowResult(false) }}
                style={{
                  width: "100%", padding: "16px 18px", fontSize: 28,
                  fontFamily: "var(--font-display)", letterSpacing: "-0.02em",
                  background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 12,
                }}
              />
              <div style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", fontSize: 13 }}>{ccy}</div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              {[10000, 25000, 50000, 100000].map(q => (
                <button key={q} className="chip" style={{ cursor: "pointer" }} onClick={() => { setAmount(String(q)); setShowResult(false) }}>
                  {FMT.money(q, ccy, { compact: true })}
                </button>
              ))}
            </div>
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 22, cursor: "pointer" }}>
            <Switch on={allowSales} onChange={v => { setAllowSales(v); setShowResult(false) }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{t.tools.allowSales}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {th ? "อนุญาตให้ขายตำแหน่งที่เกินเป้า" : "Allow selling overweight positions to rebalance"}
              </div>
            </div>
          </label>

          {/* Tolerance band */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 20 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{th ? "ช่วงคลาดเคลื่อนที่ยอมรับ" : "Tolerance band"}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {th ? "ไม่ปรับถ้าเบี่ยงจากเป้าน้อยกว่านี้ (0 = ปรับทุกครั้ง)" : "Skip classes within this drift from target (0 = always)"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <input type="number" min="0" max="50" step="1" value={band}
                onChange={e => { setBand(Math.max(0, Math.min(50, parseFloat(e.target.value) || 0))); setShowResult(false) }}
                style={{ width: 56, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 14, textAlign: "right" }} />
              <span className="muted" style={{ fontSize: 13 }}>%</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            <button className="btn" onClick={() => setShowResult(true)} style={{ flex: 1, padding: "12px 20px" }}>
              <Icon name="play" size={14} /> {t.tools.run}
            </button>
            <button className="btn btn-outline" onClick={() => { setShowResult(false) }}>{th ? "รีเซ็ต" : "Reset"}</button>
          </div>
        </div>

        {/* Results panel */}
        <div className="col-span-7" style={{ display: "grid", gap: 16 }}>
          {/* Target editor */}
          {editTargets && (
            <div className="card" style={{ border: "1.5px solid var(--accent)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
                <div className="segmented" style={{ flexWrap: "wrap" }}>
                  <button className={targetMode === "class" ? "on" : ""} onClick={() => setTargetMode("class")} style={{ fontSize: 12 }}>
                    {th ? "ตามกลุ่ม" : "By class"}
                  </button>
                  <button className={targetMode === "hybrid" ? "on" : ""} onClick={() => setTargetMode("hybrid")} style={{ fontSize: 12 }}>
                    {th ? "กลุ่ม+รายตัว" : "Class + holding"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className={"chip " + (targetError ? "chip-loss" : "chip-gain")} style={{ fontSize: 11 }}>
                    {th ? "รวม " : "Sum "}{(activeSum * 100).toFixed(1)}%
                  </span>
                  <button className="btn btn-outline btn-sm" onClick={normalizeTargets}>
                    {th ? "ปรับให้รวม 100%" : "Normalize"}
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => {
                    if (targetMode === "hybrid") setTickerWeights({})
                    setTargets(DEFAULT_TARGETS); saveTargets(DEFAULT_TARGETS)
                  }}>
                    {th ? "รีเซ็ต" : "Reset"}
                  </button>
                </div>
              </div>
              {targetMode === "hybrid" ? (
                <div style={{ display: "grid", gap: 16, maxHeight: 380, overflowY: "auto" }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div className="label-up">{th ? "สัดส่วนกลุ่ม" : "Class weights"}</div>
                    {Object.entries(targets).map(([k, v]) => (
                      <div key={k} style={{ display: "grid", gridTemplateColumns: "150px 1fr 80px", gap: 12, alignItems: "center" }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}><ClassBadge name={k} /></div>
                        <input type="range" min="0" max="100" step="1" value={(v * 100).toFixed(0)}
                          onChange={e => setTargetPct(k, e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }} />
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input type="number" min="0" max="100" step="1" value={(v * 100).toFixed(0)}
                            onChange={e => setTargetPct(k, e.target.value)}
                            style={{ width: 50, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13, textAlign: "right" }} />
                          <span className="muted" style={{ fontSize: 12 }}>%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {Object.entries(tickersByClass).filter(([cls]) => cls !== "Cash").map(([cls, list]) => (
                    <div key={cls} style={{ display: "grid", gap: 6 }}>
                      <div className="label-up" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 14 }}>{CLASS_META[cls]?.icon}</span>
                        {cls} · {th ? "สัดส่วนในกลุ่ม" : "within class"} ({((targets[cls] || 0) * 100).toFixed(0)}%)
                      </div>
                      {list.map(tr => {
                        const w = hybridWeightPct(tr)
                        const eff = (effHybrid[tr.ticker] || 0) * 100
                        return (
                          <div key={tr.ticker} style={{ display: "grid", gridTemplateColumns: "28px 90px 1fr 70px 60px", gap: 10, alignItems: "center" }}>
                            <TickerLogo ticker={tr.ticker} logoUrl={tr.logo_url} region={tr.region} cls={tr.cls} size={26} />
                            <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tr.ticker}</div>
                            <input type="range" min="0" max="100" step="1" value={w.toFixed(0)}
                              onChange={e => setTickerWeight(tr.ticker, e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }} />
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <input type="number" min="0" max="100" step="1" value={w.toFixed(0)}
                                onChange={e => setTickerWeight(tr.ticker, e.target.value)}
                                style={{ width: 46, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13, textAlign: "right" }} />
                              <span className="muted" style={{ fontSize: 12 }}>%</span>
                            </div>
                            <div className="mono muted" style={{ fontSize: 11, textAlign: "right" }} title={th ? "% ของพอร์ตรวม" : "% of total"}>={eff.toFixed(1)}%</div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {Object.entries(targets).map(([k, v]) => (
                  <div key={k} style={{ display: "grid", gridTemplateColumns: "150px 1fr 80px", gap: 12, alignItems: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><ClassBadge name={k} /></div>
                    <input type="range" min="0" max="100" step="1" value={(v * 100).toFixed(0)}
                      onChange={e => setTargetPct(k, e.target.value)}
                      style={{ width: "100%", accentColor: "var(--accent)" }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="number" min="0" max="100" step="1" value={(v * 100).toFixed(0)}
                        onChange={e => setTargetPct(k, e.target.value)}
                        style={{ width: 50, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 13, textAlign: "right" }}
                      />
                      <span className="muted" style={{ fontSize: 12 }}>%</span>
                    </div>
                  </div>
                ))}
              </div>
              )}
              {targetError && (() => {
                const diffPct = (activeSum - 1) * 100
                const over = diffPct > 0
                return (
                  <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8,
                    background: over ? "oklch(0.96 0.05 25)" : "oklch(0.97 0.03 60)",
                    fontSize: 12, color: over ? "oklch(0.45 0.12 25)" : "oklch(0.45 0.10 60)" }}>
                    ⚠ {th
                      ? `${over ? "เกิน" : "ขาด"} ${Math.abs(diffPct).toFixed(1)}% (รวม ${(activeSum * 100).toFixed(1)}%) — กด Normalize เพื่อปรับเป็น 100%`
                      : `${over ? "Over" : "Under"} by ${Math.abs(diffPct).toFixed(1)}% (sum ${(activeSum * 100).toFixed(1)}%) — click Normalize to fix`}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Drift table */}
          <div className="card">
            <h3 className="section-title" style={{ marginBottom: 4 }}>{th ? "เป้าหมาย vs. หลังปรับ" : "Target vs. after rebalance"}</h3>
            <p className="muted" style={{ fontSize: 11.5, margin: "0 0 14px", lineHeight: 1.5 }}>
              {th
                ? "ส่วนต่าง = น้ำหนักปัจจุบัน − เป้า · 🔴 + = เกินเป้า (ควรขาย/ลด) · 🟢 − = ต่ำกว่าเป้า (ควรซื้อเพิ่ม)"
                : "Diff = current − target · 🔴 + = overweight (sell) · 🟢 − = underweight (buy)"}
            </p>
            {/* Legend: now → after / target */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 14, paddingBottom: 8, fontSize: 9 }}>
              <span className="label-up" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--ink-4)", opacity: 0.5 }} />{th ? "ปัจจุบัน" : "Now"}
              </span>
              <span className="label-up" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--accent)" }} />{th ? "หลังปรับ" : "After"}
              </span>
              <span className="label-up" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 2, height: 10, background: "var(--ink-2)" }} />{th ? "เป้า" : "Target"}
              </span>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {suggestions.map(s => {
                const after = newTotal > 0 ? (s.target / newTotal) * 100 : 0
                const before = s.curPct
                const drift = before - s.tgtPct
                return (
                  <div key={s.name} style={{ display: "grid", gap: 6, padding: "9px 0", borderTop: "1px solid var(--line)" }}>
                    {/* Line 1: name · now → after / target · diff */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}><ClassBadge name={s.name} /></div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <span className="mono" style={{ fontSize: 11.5 }}>
                          <span className="muted">{before.toFixed(1)}%</span>
                          <span className="muted" style={{ margin: "0 3px" }}>→</span>
                          {after.toFixed(1)}%
                        </span>
                        <span className="mono muted" style={{ fontSize: 10 }}>/ {s.tgtPct.toFixed(0)}%</span>
                        {Math.abs(drift) > 1 && (
                          <span className={"chip " + (drift > 0 ? "chip-loss" : "chip-gain")} style={{ fontSize: 10, minWidth: 46, justifyContent: "center" }}>
                            {drift > 0 ? "+" : ""}{drift.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Line 2: slim bar (now underlay, after fill, target marker) */}
                    <div style={{ position: "relative", height: 8 }}>
                      <div style={{ position: "absolute", inset: 0, background: "var(--bg-2)", borderRadius: 999 }} />
                      <div style={{ position: "absolute", height: "100%", background: "var(--ink-4)", width: Math.min(100, before) + "%", opacity: 0.5, borderRadius: 999 }} />
                      <div style={{ position: "absolute", height: "100%", background: "var(--accent)", width: Math.min(100, after) + "%", borderRadius: 999 }} />
                      <div style={{ position: "absolute", top: -2, height: 12, width: 2, background: "var(--ink-2)", left: "calc(" + Math.min(100, s.tgtPct) + "% - 1px)" }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Missing-class warning */}
          {targetMode === "class" && missingClasses.length > 0 && (
            <div className="card" style={{ padding: "12px 16px", background: "oklch(0.97 0.03 60)", border: "1px solid oklch(0.85 0.08 60)" }}>
              <div style={{ fontSize: 12.5, color: "oklch(0.42 0.10 60)", lineHeight: 1.5 }}>
                ⚠ {th
                  ? `คุณตั้งเป้าไว้ที่ ${missingClasses.join(", ")} แต่ยังไม่มีสินทรัพย์ในกลุ่มนี้ — ระบบจะแนะนำซื้อให้ไม่ได้ ต้องเพิ่มหลักทรัพย์ในกลุ่มดังกล่าวก่อน`
                  : `You allocate to ${missingClasses.join(", ")} but hold nothing there yet — no buys can be suggested until you add holdings in those classes.`}
              </div>
            </div>
          )}

          {/* Suggested trades */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 className="section-title">{t.tools.suggestion}</h3>
              {showResult && <span className="chip">{trades.length} {th ? "รายการ" : "trades"}</span>}
            </div>
            {!showResult ? (
              <div className="empty" style={{ padding: "40px 16px" }}>
                <p className="muted">{th ? "ใส่จำนวนเงินและกด Calculate" : "Enter an amount and click Calculate"}</p>
              </div>
            ) : trades.length === 0 ? (
              <div className="empty" style={{ padding: "40px 16px" }}>
                <p style={{ color: "var(--gain)", fontWeight: 500 }}>
                  {th ? "พอร์ตของคุณสมดุลแล้ว ✓" : "Your portfolio is already balanced ✓"}
                </p>
                <p className="muted" style={{ fontSize: 12 }}>
                  {th ? "ไม่มีการซื้อขายที่แนะนำ" : "No trades suggested with current settings"}
                </p>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.tools.action}</th>
                    <th>{t.portfolio.holding}</th>
                    <th className="num">{t.portfolio.shares}</th>
                    <th className="num">{th ? "ราคา" : "Price"}</th>
                    <th className="num">{th ? "จำนวนเงิน" : "Amount"}</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((tr, i) => (
                    <tr key={i}>
                      <td>
                        <span className={"chip " + (tr.action === "Buy" ? "chip-gain" : "chip-loss")} style={{ fontWeight: 500, fontSize: 11 }}>
                          {tr.action === "Buy" ? <Icon name="buy" size={11} /> : <Icon name="sell" size={11} />}
                          {tr.action === "Buy" ? (th ? "ซื้อ" : "Buy") : (th ? "ขาย" : "Sell")}
                        </span>
                      </td>
                      <td>
                        <div className="ticker">
                          <TickerLogo ticker={tr.ticker} region={tr.region} logoUrl={tr.logoUrl} cls={tr.assetClass} size={30} />
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 13 }}>{tr.ticker}</div>
                            <div className="muted" style={{ fontSize: 11 }}>{tr.cls}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num">{Number(tr.shares).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td className="num">{FMT.moneyNative(tr.priceNative, tr.nativeCcy)}</td>
                      <td className="num" style={{ fontWeight: 500 }}>{FMT.money(tr.amount, ccy, { compact: true })}</td>
                    </tr>
                  ))}
                  <tr style={{ background: "var(--bg)", fontWeight: 500 }}>
                    <td colSpan="4"><span className="label-up">{th ? "เงินสดคงเหลือ" : "Cash remaining"}</span></td>
                    <td className="num">{FMT.money(cashRemaining, ccy, { compact: true })}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn btn-outline btn-sm" onClick={downloadCSV} disabled={!showResult || trades.length === 0}>
                {th ? "ส่งออก CSV" : "Export CSV"}
              </button>
              <button className="btn btn-sm" onClick={copyTrades} disabled={!showResult || trades.length === 0}>
                {copied ? (th ? "คัดลอกแล้ว ✓" : "Copied ✓") : (th ? "คัดลอกรายการ" : "Copy trades")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolCard({ active, locked, title, sub, icon }) {
  return (
    <div className="card" style={{
      padding: 22,
      border: active ? "1.5px solid var(--ink)" : "1px solid var(--line)",
      background: active ? "var(--card)" : "var(--bg)",
      opacity: locked ? 0.55 : 1,
      position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: active ? "var(--ink)" : "var(--bg-2)",
          color: active ? "var(--bg)" : "var(--ink-2)",
          display: "grid", placeItems: "center",
        }}>
          <Icon name={icon} size={16} />
        </div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
        {locked && <span className="chip" style={{ marginLeft: "auto", fontSize: 10 }}>Coming soon</span>}
        {active && <span className="chip chip-soft" style={{ marginLeft: "auto", fontSize: 10 }}>Active</span>}
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>{sub}</p>
    </div>
  )
}

function Switch({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      width: 34, height: 20, borderRadius: 999,
      background: on ? "var(--ink)" : "var(--bg-3)",
      position: "relative", transition: "background 0.15s",
      border: "none", cursor: "pointer", flexShrink: 0,
    }}>
      <span style={{
        position: "absolute", top: 2, left: on ? 16 : 2,
        width: 16, height: 16, borderRadius: 50, background: "white",
        transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        display: "block",
      }} />
    </button>
  )
}
