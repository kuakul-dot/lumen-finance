import { useState, useMemo, useEffect } from 'react'
import { PageHead, Icon } from './Nav'
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

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildCurrentByClass(rows, cash) {
  const map = { "TH Equity": 0, "US Equity": 0, "Bonds": 0, "Gold": 0, "Crypto": 0, "Cash": cash }
  rows.forEach(r => {
    const k = r.cls === "Equity"    ? (r.region === "TH" ? "TH Equity" : "US Equity")
            : r.cls === "Bond"      ? "Bonds"
            : r.cls === "Commodity" ? "Gold"
            : r.cls === "Crypto"    ? "Crypto" : "Cash"
    map[k] = (map[k] || 0) + r.value
  })
  return map
}

export function ToolsPage({ t, lang, ccy, dataState, liveHoldings = [], prices = {}, portfolio, cashAccounts = [] }) {
  const FMT = LUMEN_FMT
  const th = lang === "th"

  const [mode,       setMode]       = useState("deposit")
  const [amount,     setAmount]     = useState("50000")
  const [allowSales, setAllowSales] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const [editTargets, setEditTargets] = useState(false)
  const [targets,    setTargets]    = useState(loadTargets)

  // Persist targets to localStorage
  useEffect(() => { saveTargets(targets) }, [targets])

  // ── Derive rows ──────────────────────────────────────────────────────────────
  const isLive = dataState === "live"

  const { rows, total, cash } = useMemo(() => {
    if (isLive) {
      const derived = deriveHoldings(liveHoldings, ccy, prices)
      const cashTotal = cashAccounts.reduce((s, a) => {
        const b = a.balance || 0, c = a.currency || 'THB'
        if (c === ccy) return s + b
        if (c === 'USD' && ccy === 'THB') return s + b * LUMEN_FX.THB_per_USD
        if (c === 'THB' && ccy === 'USD') return s + b / LUMEN_FX.THB_per_USD
        return s + b
      }, 0)
      const investTotal = derived.reduce((s, r) => s + r.value, 0)
      return { rows: derived, total: investTotal + cashTotal, cash: cashTotal }
    }
    if (dataState === "empty") return { rows: [], total: 0, cash: 0 }
    const demo = LUMEN_DERIVE()
    return { rows: demo.rows, total: demo.value + demo.cash, cash: demo.cash }
  }, [isLive, liveHoldings, ccy, prices, cashAccounts, dataState])

  const currentByClass = useMemo(() => buildCurrentByClass(rows, cash), [rows, cash])

  const dep = parseFloat(amount) || 0
  const newTotal = mode === "deposit" ? total + dep : Math.max(0, total - dep)

  // ── Target editing helpers ───────────────────────────────────────────────────
  const totalTargetPct = Object.values(targets).reduce((s, v) => s + v, 0)
  const targetError = Math.abs(totalTargetPct - 1) > 0.001

  const setTargetPct = (key, pctStr) => {
    const v = Math.max(0, Math.min(100, parseFloat(pctStr) || 0)) / 100
    setTargets(prev => ({ ...prev, [key]: v }))
  }

  const normalizeTargets = () => {
    const sum = Object.values(targets).reduce((s, v) => s + v, 0)
    if (sum === 0) return
    setTargets(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v / sum])))
  }

  // ── Suggestions ─────────────────────────────────────────────────────────────
  const suggestions = useMemo(() => {
    return Object.entries(targets).map(([k, tgt]) => {
      const cur = currentByClass[k] || 0
      const targetValue = newTotal * tgt
      const delta = targetValue - cur
      return { name: k, current: cur, target: targetValue, delta, curPct: total > 0 ? (cur / total) * 100 : 0, tgtPct: tgt * 100 }
    })
  }, [currentByClass, newTotal, total, targets])

  // ── Suggested trades ─────────────────────────────────────────────────────────
  const trades = useMemo(() => {
    if (!showResult) return []
    const out = []
    const sample = {
      "TH Equity": rows.filter(r => r.region === "TH" && (r.cls === "Equity" || r.cls === "ETF")),
      "US Equity": rows.filter(r => r.region === "US" && (r.cls === "Equity" || r.cls === "ETF")),
      "Bonds":     rows.filter(r => r.cls === "Bond"),
      "Gold":      rows.filter(r => r.cls === "Commodity"),
      "Crypto":    rows.filter(r => r.cls === "Crypto"),
    }
    suggestions.forEach(s => {
      if (s.name === "Cash") return
      const candidates = sample[s.name] || []
      if (candidates.length === 0) return
      if (s.delta > 500) {
        const sorted = [...candidates].sort((a, b) => a.value - b.value)
        const split = Math.min(2, sorted.length)
        sorted.slice(0, split).forEach(c => {
          const amt = s.delta / split
          const priceInDisplay = c.price  // already in display ccy from deriveHoldings
          const sharesNeeded = priceInDisplay > 0 ? Math.floor(amt / priceInDisplay) : 0
          if (sharesNeeded > 0) {
            out.push({ action: "Buy", ticker: c.ticker, name: c.name, shares: sharesNeeded, priceNative: c.priceNative, nativeCcy: c.nativeCcy, amount: sharesNeeded * priceInDisplay, cls: s.name })
          }
        })
      } else if (allowSales && s.delta < -total * 0.005) {
        const sorted = [...candidates].sort((a, b) => b.value - a.value)
        const c = sorted[0]
        if (c) {
          const priceInDisplay = c.price
          const sharesNeeded = priceInDisplay > 0 ? Math.floor(Math.abs(s.delta) / priceInDisplay) : 0
          if (sharesNeeded > 0) {
            out.push({ action: "Sell", ticker: c.ticker, name: c.name, shares: sharesNeeded, priceNative: c.priceNative, nativeCcy: c.nativeCcy, amount: sharesNeeded * priceInDisplay, cls: s.name })
          }
        }
      }
    })
    return out
  }, [suggestions, allowSales, rows, total, showResult])

  const cashRemaining = Math.max(0, dep - trades.filter(tr => tr.action === "Buy").reduce((a, b) => a + b.amount, 0)
                                     + trades.filter(tr => tr.action === "Sell").reduce((a, b) => a + b.amount, 0))

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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 className="section-title">{th ? "ปรับเป้าหมาย" : "Edit target allocations"}</h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className={"chip " + (targetError ? "chip-loss" : "chip-gain")} style={{ fontSize: 11 }}>
                    {th ? "รวม " : "Sum "}{(totalTargetPct * 100).toFixed(1)}%
                  </span>
                  <button className="btn btn-outline btn-sm" onClick={normalizeTargets}>
                    {th ? "ปรับให้รวม 100%" : "Normalize to 100%"}
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => { setTargets(DEFAULT_TARGETS); saveTargets(DEFAULT_TARGETS) }}>
                    {th ? "รีเซ็ต" : "Reset"}
                  </button>
                </div>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {Object.entries(targets).map(([k, v]) => (
                  <div key={k} style={{ display: "grid", gridTemplateColumns: "120px 1fr 80px", gap: 12, alignItems: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{k}</div>
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
              {targetError && (
                <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: "oklch(0.97 0.03 60)", fontSize: 12, color: "oklch(0.45 0.10 60)" }}>
                  {th ? "⚠ เป้าหมายรวมไม่ครบ 100% — กด Normalize เพื่อปรับอัตโนมัติ" : "⚠ Targets don't sum to 100% — click Normalize to fix automatically"}
                </div>
              )}
            </div>
          )}

          {/* Drift table */}
          <div className="card">
            <h3 className="section-title" style={{ marginBottom: 16 }}>{th ? "เป้าหมาย vs. หลังปรับ" : "Target vs. after rebalance"}</h3>
            <div style={{ display: "grid", gap: 10 }}>
              {suggestions.map(s => {
                const after = newTotal > 0 ? (s.target / newTotal) * 100 : 0
                const before = s.curPct
                const drift = before - s.tgtPct
                return (
                  <div key={s.name} style={{ display: "grid", gridTemplateColumns: "120px 50px 1fr 70px 70px 60px", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                    <div className="mono muted" style={{ fontSize: 11 }}>→{s.tgtPct.toFixed(0)}%</div>
                    <div style={{ position: "relative", height: 16 }}>
                      <div style={{ position: "absolute", inset: 0, background: "var(--bg-2)", borderRadius: 999 }} />
                      <div style={{ position: "absolute", height: "100%", background: "var(--ink-4)", width: Math.min(100, before) + "%", opacity: 0.5, borderRadius: 999 }} />
                      <div style={{ position: "absolute", height: "100%", background: "var(--accent)", width: Math.min(100, after) + "%", borderRadius: 999 }} />
                    </div>
                    <div className="mono muted" style={{ fontSize: 11, textAlign: "right" }}>{before.toFixed(1)}%</div>
                    <div className="mono" style={{ fontSize: 11, textAlign: "right" }}>→ {after.toFixed(1)}%</div>
                    <div style={{ textAlign: "right" }}>
                      {Math.abs(drift) > 1 && (
                        <span className={"chip " + (drift > 0 ? "chip-loss" : "chip-gain")} style={{ fontSize: 10 }}>
                          {drift > 0 ? "+" : ""}{drift.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

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
                          <div className="ticker-mark">{tr.ticker.slice(0, 2)}</div>
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 13 }}>{tr.ticker}</div>
                            <div className="muted" style={{ fontSize: 11 }}>{tr.cls}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num">{tr.shares}</td>
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
              <button className="btn btn-outline btn-sm">{th ? "ส่งออก CSV" : "Export CSV"}</button>
              <button className="btn btn-sm">{th ? "บันทึกเป็นแผน" : "Save as plan"}</button>
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
