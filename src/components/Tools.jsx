import { useState, useMemo, useEffect, useRef } from 'react'
import { PageHead, Icon, TickerLogo } from './Nav'
import { AiAnalysisModal } from './AiModal'
import { CalcInput } from './CalcInput'
import { useAiAnalysis } from '../lib/useAiAnalysis'
import { LUMEN_FMT, LUMEN_DERIVE, LUMEN_TARGETS, LUMEN_FX } from '../data'
import { deriveHoldings, updatePortfolio } from '../lib/db'

// ── Starter instrument recommendations per asset class ────────────────────────
// Shown when a class has a target allocation but no holdings yet.
// TH = SET-listed, US = NYSE/NASDAQ
const STARTER_INSTRUMENTS = {
  "TH Equity": [
    { ticker: "TDEX",    name: "iShares SET50 ETF",    region: "TH", cls: "ETF" },
    { ticker: "THAITDR", name: "Thai Market DR",        region: "TH", cls: "ETF" },
    { ticker: "KTSET50", name: "KT SET50 Index ETF",   region: "TH", cls: "ETF" },
  ],
  "Bonds": [
    { ticker: "AGG",   name: "iShares Core US Agg Bond", region: "US", cls: "ETF" },
    { ticker: "BND",   name: "Vanguard Total Bond",       region: "US", cls: "ETF" },
    { ticker: "TLT",   name: "iShares 20+ Yr Treasury",  region: "US", cls: "ETF" },
  ],
  "Gold": [
    { ticker: "GLD",  name: "SPDR Gold Trust",     region: "US", cls: "Commodity" },
    { ticker: "IAU",  name: "iShares Gold Trust",  region: "US", cls: "Commodity" },
    { ticker: "GOLD", name: "Gold ETF (SET)",       region: "TH", cls: "Commodity" },
  ],
  "Crypto": [
    { ticker: "BTC-USD", name: "Bitcoin",   region: "US", cls: "Crypto" },
    { ticker: "ETH-USD", name: "Ethereum",  region: "US", cls: "Crypto" },
  ],
  "US Equity": [
    { ticker: "VOO", name: "Vanguard S&P 500 ETF",  region: "US", cls: "ETF" },
    { ticker: "QQQ", name: "Invesco Nasdaq 100 ETF", region: "US", cls: "ETF" },
    { ticker: "SPY", name: "SPDR S&P 500 ETF",       region: "US", cls: "ETF" },
  ],
}

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
const BAND_MODE_STORAGE_KEY = "lumen_rebalance_band_mode"
function loadBandMode() {
  try { const v = localStorage.getItem(BAND_MODE_STORAGE_KEY); if (v === "5/25" || v === "flat") return v } catch {}
  return "flat"
}

const LAST_REBALANCE_KEY = "lumen_last_rebalance_date"
function loadLastRebalance() {
  try { const v = localStorage.getItem(LAST_REBALANCE_KEY); return v ? new Date(v) : null } catch {}
  return null
}

function saveLastRebalance(date = new Date()) {
  try { localStorage.setItem(LAST_REBALANCE_KEY, date.toISOString()) } catch {}
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function buildCurrentByClass(rows, cash) {
  const map = { "TH Equity": 0, "US Equity": 0, "Bonds": 0, "Gold": 0, "Crypto": 0, "Cash": cash }
  rows.forEach(r => {
    const k = (r.cls === "Equity" || r.cls === "ETF") ? (r.region === "TH" ? "TH Equity" : "US Equity")
            : r.cls === "Bond"       ? "Bonds"
            : r.cls === "MutualFund" ? "Bonds"
            : r.cls === "Commodity"  ? "Gold"
            : r.cls === "GoldTH"     ? "Gold"
            : r.cls === "Crypto"     ? "Crypto" : "Cash"
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
  : r.cls === "Bond"       ? "Bonds"
  : r.cls === "MutualFund" ? "Bonds"
  : r.cls === "Commodity"  ? "Gold"
  : r.cls === "GoldTH"     ? "Gold"
  : r.cls === "Crypto"     ? "Crypto" : "Cash"

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
  const [rulesOpen,  setRulesOpen]  = useState(false)
  // Cash account selector for deposit — set of account IDs the user wants to draw from
  const [selectedAccountIds, setSelectedAccountIds] = useState(new Set())
  const [editTargets, setEditTargets] = useState(false)
  const [targets,    setTargets]    = useState(loadTargets)
  const [band,       setBand]       = useState(loadBand)   // tolerance (percentage points, flat mode)
  const [bandMode,   setBandMode]   = useState(loadBandMode)  // "flat" | "5/25"
  const [copied,     setCopied]     = useState(false)
  const [openRow,        setOpenRow]        = useState(null)   // which drift row is expanded to show ฿ amounts
  const [expandedClasses, setExpandedClasses] = useState(new Set())   // per-class accordion in drift table
  const [lastRebalance,  setLastRebalance]  = useState(loadLastRebalance)
  // ── AI rebalance explainer (optional — hides when /api/analyze 503s) ──
  const ai = useAiAnalysis()
  const [aiAvailable, setAiAvailable] = useState(false)
  useEffect(() => {
    fetch('/api/analyze').then(r => r.json()).then(j => setAiAvailable(!!j?.available)).catch(() => setAiAvailable(false))
  }, [])
  const [targetMode, setTargetMode] = useState(() => {
    try { const m = localStorage.getItem("lumen_rebalance_mode"); return m === "hybrid" ? "hybrid" : "class" } catch { return "class" }
  })
  const [tickerWeights, setTickerWeights] = useState(() => { try { return JSON.parse(localStorage.getItem("lumen_rebalance_ticker_weights") || "{}") } catch { return {} } })

  const toggleClassExpand = (name) => setExpandedClasses(prev => {
    const next = new Set(prev)
    next.has(name) ? next.delete(name) : next.add(name)
    return next
  })

  // Reset amount when display currency switches (avoid showing ฿50,000 as "$50,000")
  const prevCcy = useRef(ccy)
  useEffect(() => {
    if (prevCcy.current === ccy) return
    const oldCcy = prevCcy.current
    prevCcy.current = ccy
    const cur = parseFloat(amount) || 0
    // Convert existing amount from old ccy to new ccy
    const inTHB  = oldCcy === 'USD' ? cur * fxRate : cur
    const newAmt = ccy  === 'USD' ? Math.round(inTHB / fxRate) : Math.round(inTHB)
    setAmount(String(newAmt || (ccy === 'USD' ? Math.round(50000 / fxRate) : 50000)))
    setShowResult(false)
  }, [ccy])

  // Persist to localStorage (immediate)
  useEffect(() => { saveTargets(targets) }, [targets])
  useEffect(() => { try { localStorage.setItem(BAND_STORAGE_KEY, String(band)) } catch {} }, [band])
  useEffect(() => { try { localStorage.setItem(BAND_MODE_STORAGE_KEY, bandMode) } catch {} }, [bandMode])
  useEffect(() => { try { localStorage.setItem("lumen_rebalance_mode", targetMode) } catch {} }, [targetMode])
  useEffect(() => { try { localStorage.setItem("lumen_rebalance_ticker_weights", JSON.stringify(tickerWeights)) } catch {} }, [tickerWeights])

  // Persist to Supabase (debounced 1.5 s) — syncs targets across all devices
  const _rebalSaveTimer = useRef(null)
  useEffect(() => {
    if (!portfolio?.id) return
    clearTimeout(_rebalSaveTimer.current)
    _rebalSaveTimer.current = setTimeout(() => {
      updatePortfolio(portfolio.id, {
        rebalance_config: {
          targets, band, bandMode, mode: targetMode, tickerW: tickerWeights,
        }
      }).catch(() => {})   // fire-and-forget; localStorage is the primary store
    }, 1500)
    return () => clearTimeout(_rebalSaveTimer.current)
  }, [targets, band, bandMode, targetMode, tickerWeights, portfolio?.id])

  // ── Derive rows ──────────────────────────────────────────────────────────────
  const isLive = dataState === "live"

  const { rows, total, cash, investableCash } = useMemo(() => {
    if (isLive) {
      const derived = deriveHoldings(liveHoldings, ccy, prices, fxRate)
      // cashTotal always in THB (deriveHoldings also returns THB values)
      const cashTotal = cashAccounts.reduce((s, a) => {
        const b = a.balance || 0, c = a.currency || 'THB'
        return s + (c === 'USD' ? b * fxRate : b)
      }, 0)
      // investableCash = total cash minus emergency fund amounts
      const investable = cashAccounts.reduce((s, a) => {
        const balance = a.currency === 'USD' ? (a.balance || 0) * fxRate : (a.balance || 0)
        const target = a.target_balance || 0
        const emergency = Math.min(balance, target)
        return s + (balance - emergency)
      }, 0)
      const investTotal = derived.reduce((s, r) => s + r.value, 0)
      return { rows: derived, total: investTotal + cashTotal, cash: cashTotal, investableCash: investable }
    }
    if (dataState === "empty") return { rows: [], total: 0, cash: 0, investableCash: 0 }
    const demo = LUMEN_DERIVE()
    return { rows: demo.rows, total: demo.value + demo.cash, cash: demo.cash, investableCash: demo.cash }
  }, [isLive, liveHoldings, ccy, prices, fxRate, cashAccounts, dataState])

  const currentByClass = useMemo(() => buildCurrentByClass(rows, investableCash), [rows, investableCash])

  // investableTotal = sum of all class values (stocks + investable cash, EXCLUDES emergency fund)
  // This is the correct denominator for allocation %; using `total` (which includes emergency)
  // would make the class % sum to < 100%.
  const investableTotal = useMemo(() =>
    Object.values(currentByClass).reduce((s, v) => s + v, 0)
  , [currentByClass])

  // Per-account investable amounts (emergency accounts only expose excess above target)
  const accountOptions = useMemo(() => cashAccounts.map(a => {
    const balTHB = a.currency === 'USD' ? (a.balance || 0) * fxRate : (a.balance || 0)
    const isEmergency = a.icon === 'shield' && a.target_balance > 0
    const targetTHB = isEmergency ? (a.currency === 'USD' ? a.target_balance * fxRate : a.target_balance) : 0
    const available = isEmergency ? Math.max(0, balTHB - targetTHB) : balTHB
    return { ...a, balTHB, targetTHB, available, isEmergency, locked: isEmergency && available <= 0 }
  }), [cashAccounts, fxRate])

  const selectedAvailableTHB = useMemo(() =>
    accountOptions.filter(a => selectedAccountIds.has(a.id)).reduce((s, a) => s + a.available, 0)
  , [accountOptions, selectedAccountIds])

  const toggleAccount = (id) => setSelectedAccountIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // ── 5/25 rule: effectiveBand per class ───────────────────────────────────────
  // flat mode  → always returns `band` (the user-set %)
  // 5/25 mode  → min(5, tgtPct × 25%) — smaller threshold for small allocations
  //              e.g. Bonds 5%: min(5, 1.25) = 1.25pp  |  TH Equity 25%: min(5, 6.25) = 5pp
  const effectiveBand = (tgtPct) => {
    if (bandMode === "5/25") return Math.min(5, tgtPct * 0.25)
    return band
  }

  // User types amount in display currency; convert to THB for internal calculations
  // (total, all values from deriveHoldings, are in THB)
  const dep = parseFloat(amount) || 0
  const depInTHB = ccy === 'USD' ? dep * fxRate : dep
  // newTotal is based on INVESTABLE total (excludes emergency fund), not full net worth
  const newTotal = mode === "deposit" ? investableTotal + depInTHB : Math.max(0, investableTotal - depInTHB)

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
      "Bonds":     rows.filter(r => r.cls === "Bond" || r.cls === "MutualFund"),
      "Gold":      rows.filter(r => r.cls === "Commodity" || r.cls === "GoldTH"),
      "Crypto":    rows.filter(r => r.cls === "Crypto"),
      "Cash":      [],
    }
    return Object.entries(targets).map(([k, tgt]) => ({ key: k, current: currentByClass[k] || 0, candidates: sample[k] || [], tgt }))
  }, [targetMode, tickerRows, effHybrid, targets, currentByClass, rows])

  // ── Suggestions ─────────────────────────────────────────────────────────────
  const suggestions = useMemo(() => units.map(u => {
    const targetValue = newTotal * u.tgt
    const delta = targetValue - u.current
    // curPct uses investableTotal so class % sums to 100% (emergency fund excluded)
    return { name: u.key, current: u.current, target: targetValue, delta, curPct: investableTotal > 0 ? (u.current / investableTotal) * 100 : 0, tgtPct: u.tgt * 100, candidates: u.candidates }
  }), [units, newTotal, investableTotal])

  // ── Per-holding drift within each class (for Class+Holding view) ────────────
  const holdingDriftByClass = useMemo(() => {
    const out = {}
    suggestions.forEach(s => {
      if (!s.candidates || s.candidates.length === 0) return
      // Merge multiple lots of the same ticker into one grouped row
      const grouped = {}
      s.candidates.forEach(c => {
        if (!grouped[c.ticker]) {
          grouped[c.ticker] = { ...c, value: 0, shares: 0 }
        }
        grouped[c.ticker].value  += c.value
        grouped[c.ticker].shares += (c.shares || 0)
      })
      const tickers = Object.values(grouped)
      const classTotal = tickers.reduce((sum, c) => sum + c.value, 0)
      out[s.name] = tickers.map(c => {
        // Within-class target: use per-ticker hybrid weight if set; else proportional
        const tgtWithin = hybridWeightPct(c)  // % within class (0-100)
        const curWithin = classTotal > 0 ? (c.value / classTotal) * 100 : 0
        const drift = curWithin - tgtWithin
        // Use investableTotal (excludes emergency fund) to match class-level curPct denominator
        const curPct = investableTotal > 0 ? (c.value / investableTotal) * 100 : 0
        const tgtPct = s.tgtPct * (tgtWithin / 100)
        return { ...c, curWithin, tgtWithin, drift, curPct, tgtPct }
      }).sort((a, b) => b.value - a.value)   // sort by value desc
    })
    return out
  }, [suggestions, hybridWeightPct, investableTotal])

  // ── Rebalance recommendation logic ────────────────────────────────────────────
  const maxDrift = useMemo(() => {
    return suggestions.reduce((max, s) => Math.max(max, Math.abs(s.curPct - s.tgtPct)), 0)
  }, [suggestions])

  const daysSinceRebalance = lastRebalance ? Math.floor((Date.now() - lastRebalance.getTime()) / (1000 * 60 * 60 * 24)) : null
  const isOverdue = daysSinceRebalance !== null && daysSinceRebalance >= 365
  // isDriftHigh uses per-class effectiveBand so 5/25 triggers correctly for small allocations
  const isDriftHigh = suggestions.some(s => Math.abs(s.curPct - s.tgtPct) > effectiveBand(s.tgtPct))
  const needsRebalance = isOverdue || isDriftHigh

  // ── Suggested trades ─────────────────────────────────────────────────────────
  // Share sizing: US holdings & GoldTH support fractional shares → keep 4
  // decimals; Thai SET stocks trade whole shares → floor to integer.
  // GoldTH is fractional because gold shops sell ½ บาท, สลึง (¼ บาท), etc.
  const sizeShares = (cash, priceTHB, region, cls) => {
    if (priceTHB <= 0) return 0
    const raw = cash / priceTHB
    return (region === "US" || cls === "GoldTH") ? Math.floor(raw * 1e4) / 1e4 : Math.floor(raw)
  }

  const trades = useMemo(() => {
    if (!showResult) return []
    const out = []

    // Helper: enrich candidates with within-class context
    const enrichCandidates = (candidates, s) => {
      const classTotal = candidates.reduce((sum, c) => sum + c.value, 0)
      return candidates.map(c => {
        const currentWt = classTotal > 0 ? c.value / classTotal : 0
        const hybridTarget = effHybrid[c.ticker]
        const classTarget = s.tgt > 0 ? (hybridTarget != null ? hybridTarget / s.tgt : 1 / candidates.length) : 1 / candidates.length
        return { ...c, withinClassPct: currentWt * 100, withinClassTarget: classTarget * 100, drift: currentWt - classTarget }
      })
    }

    // ── PASS 1: compute sells (unlimited by budget) ───────────────────────────
    const sellSuggestions = suggestions.filter(s => s.name !== "Cash" && s.delta < 0 && Math.abs(s.curPct - s.tgtPct) >= effectiveBand(s.tgtPct) && allowSales)
    sellSuggestions.forEach(s => {
      const rich = enrichCandidates(s.candidates || [], s).sort((a, b) => b.drift - a.drift)
      let remaining = Math.abs(s.delta)
      for (const c of rich) {
        if (remaining <= 0) break
        const wanted = sizeShares(remaining, c.price, c.region, c.cls)
        const held   = Math.max(0, Number(c.shares) || 0)
        const shares = Math.min(wanted, held)
        if (shares <= 0) continue
        const amount = shares * c.price
        out.push({
          action: "Sell", ticker: c.ticker, name: c.name,
          shares, priceNative: c.priceNative, nativeCcy: c.nativeCcy,
          amount, cls: s.name, region: c.region, logoUrl: c.logo_url, assetClass: c.cls,
          withinClassPct: +c.withinClassPct.toFixed(1), withinClassTarget: +c.withinClassTarget.toFixed(1),
          plPct: c.plPct != null ? +c.plPct.toFixed(1) : null,
          peers: rich.filter(x => x.ticker !== c.ticker).map(x => ({ ticker: x.ticker, withinClassPct: +x.withinClassPct.toFixed(1) })),
        })
        remaining -= amount
      }
    })

    // ── PASS 2: buys capped to available budget ───────────────────────────────
    const sellProceeds = out.reduce((s, t) => s + t.amount, 0)
    const depositAmt = mode === "withdraw" ? 0 : depInTHB  // withdrawals don't add new cash for buys
    let buyBudget = depositAmt + sellProceeds

    if (buyBudget <= 0) return out

    // Sort underweight classes by drift (most underweight first = highest priority)
    const buySuggestions = suggestions
      .filter(s => s.name !== "Cash" && s.delta > 0 && Math.abs(s.curPct - s.tgtPct) >= effectiveBand(s.tgtPct) && (s.candidates || []).length > 0)
      .sort((a, b) => (a.curPct - a.tgtPct) - (b.curPct - b.tgtPct))  // most negative = most underweight first

    for (const s of buySuggestions) {
      if (buyBudget <= 10) break
      // Cap this class's buy to remaining budget AND the class delta
      const classAlloc = Math.min(s.delta, buyBudget)
      const rich = enrichCandidates(s.candidates || [], s)
        // Skip holdings the user has explicitly set to 0% target (waiting to sell / excluded)
        // Check tickerWeights directly so the exclusion works in both Class and Hybrid mode
        .filter(c => !(tickerWeights[c.ticker] != null && Number(tickerWeights[c.ticker]) === 0))
        .sort((a, b) => a.drift - b.drift)

      let remaining = classAlloc
      for (const c of rich.slice(0, Math.min(3, rich.length))) {
        if (remaining <= 10) break
        const share = rich.length === 1 ? 1 : Math.max(0.2, (-c.drift + 0.01) / rich.slice(0, Math.min(3, rich.length)).reduce((acc, x) => acc + Math.max(0.01, -x.drift + 0.01), 0))
        const amt = Math.min(remaining, classAlloc * share)
        const effPrice = c.price * (1 + FEE_RATE(c.region))
        const sharesNeeded = sizeShares(amt, effPrice, c.region, c.cls)
        if (sharesNeeded <= 0) continue
        const actualAmt = sharesNeeded * c.price
        out.push({
          action: "Buy", ticker: c.ticker, name: c.name,
          shares: sharesNeeded, priceNative: c.priceNative, nativeCcy: c.nativeCcy,
          amount: actualAmt, cls: s.name, region: c.region, logoUrl: c.logo_url, assetClass: c.cls,
          withinClassPct: +c.withinClassPct.toFixed(1), withinClassTarget: +c.withinClassTarget.toFixed(1),
          plPct: c.plPct != null ? +c.plPct.toFixed(1) : null,
          peers: rich.filter(x => x.ticker !== c.ticker).map(x => ({ ticker: x.ticker, withinClassPct: +x.withinClassPct.toFixed(1) })),
        })
        remaining -= actualAmt
        buyBudget -= actualAmt
      }
    }

    return out
  }, [suggestions, allowSales, rows, total, showResult, band, bandMode, effHybrid, tickerWeights, depInTHB, mode])

  // cashRemaining in THB (depInTHB minus buy/sell amounts which are also THB)
  const cashRemaining = Math.max(0, depInTHB - trades.filter(tr => tr.action === "Buy").reduce((a, b) => a + b.amount, 0)
                                             + trades.filter(tr => tr.action === "Sell").reduce((a, b) => a + b.amount, 0))

  // Actual post-trade delta per suggestion name — used to compute realistic AFTER %.
  // In hybrid mode trades are keyed by ticker (= suggestion name); in class mode by cls.
  const tradeDeltas = useMemo(() => {
    const d = {}
    trades.forEach(t => {
      const key = targetMode === "hybrid" ? t.ticker : t.cls
      if (!key) return
      d[key] = (d[key] || 0) + (t.action === "Sell" ? -1 : 1) * t.amount
    })
    return d
  }, [trades, targetMode])

  // Target classes you allocate to but hold nothing in — can't be rebalanced into
  const missingClasses = useMemo(() => {
    const has = {
      "TH Equity": rows.some(r => r.region === "TH" && (r.cls === "Equity" || r.cls === "ETF")),
      "US Equity": rows.some(r => r.region === "US" && (r.cls === "Equity" || r.cls === "ETF")),
      "Bonds":     rows.some(r => r.cls === "Bond" || r.cls === "MutualFund"),
      "Gold":      rows.some(r => r.cls === "Commodity" || r.cls === "GoldTH"),
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

  // Send the current rebalance state to AI for a plain-Thai explanation.
  // Builds the same portfolio payload shape as the Dashboard so AI responses
  // stay consistent across pages (same net worth, same cash split, same %).
  const explainRebalance = () => {
    if (!trades.length) return
    const stocksTotal = Math.round(total - cash)
    const groupedStocks = rows.map(r => ({
      ticker: r.ticker, region: r.region, cls: r.cls,
      valueTHB: Math.round(r.value),
      pctOfNetWorth: total      > 0 ? +((r.value / total)      * 100).toFixed(1) : 0,
      pctOfStocks:   stocksTotal > 0 ? +((r.value / stocksTotal) * 100).toFixed(1) : 0,
    }))
    const cashList = cashAccounts.map(a => ({
      currency: a.currency || 'THB',
      balanceTHB: Math.round((a.currency === 'USD' ? (Number(a.balance) || 0) * fxRate : (Number(a.balance) || 0))),
    }))
    const driftPayload = suggestions.map(s => ({
      name: s.name,
      targetPct: +s.tgtPct.toFixed(1),
      nowPct: +s.curPct.toFixed(1),
      afterPct: newTotal > 0 ? +((s.current + (tradeDeltas[s.name] || 0)) / newTotal * 100).toFixed(1) : 0,
      diffPct: +(s.curPct - s.tgtPct).toFixed(1),
    }))
    const tradesPayload = trades.map(t => ({
      action: t.action,
      ticker: t.ticker,
      name: t.name,
      shares: t.shares,
      priceNative: t.priceNative,
      nativeCcy: t.nativeCcy,
      amount: Math.round(t.amount),
      cls: t.cls,
      withinClassPct: t.withinClassPct,    // current weight within class (%)
      withinClassTarget: t.withinClassTarget, // target weight within class (%)
      plPct: t.plPct,                      // unrealized P/L %
      peers: t.peers,                      // other holdings in same class
    }))
    ai.run({
      lang,
      kind: 'rebalance',
      portfolio: {
        counts: {
          stocksTotal: groupedStocks.length,
          stocksTH: groupedStocks.filter(s => s.region === 'TH').length,
          stocksUS: groupedStocks.filter(s => s.region !== 'TH').length,
          cashAccounts: cashList.length,
        },
        totals: {
          netWorthTHB: Math.round(total),
          stocksTHB: stocksTotal,
          cashTHB: Math.round(cash),
        },
        stocks: groupedStocks,
        cash: cashList,
      },
      rebalance: {
        mode,                       // 'deposit' | 'withdraw'
        amount: Number(amount) || 0,
        allowSales,
        band,
        drift: driftPayload,
        trades: tradesPayload,
        cashRemaining: Math.round(cashRemaining),
      },
    })
  }

  // Review portfolio and ask AI if rebalancing is needed
  const reviewForRebalance = () => {
    const stocksTotal = Math.round(total - cash)
    const groupedStocks = rows.map(r => ({
      ticker: r.ticker, region: r.region, cls: r.cls,
      valueTHB: Math.round(r.value),
      pctOfNetWorth: total > 0 ? +((r.value / total) * 100).toFixed(1) : 0,
      pctOfStocks: stocksTotal > 0 ? +((r.value / stocksTotal) * 100).toFixed(1) : 0,
    }))
    const cashList = cashAccounts.map(a => ({
      currency: a.currency || 'THB',
      balanceTHB: Math.round((a.currency === 'USD' ? (Number(a.balance) || 0) * fxRate : (Number(a.balance) || 0))),
    }))
    const driftPayload = suggestions.map(s => ({
      name: s.name,
      targetPct: +s.tgtPct.toFixed(1),
      nowPct: +s.curPct.toFixed(1),
      diffPct: +(s.curPct - s.tgtPct).toFixed(1),
    }))
    ai.run({
      lang,
      kind: 'portfolioReview',
      portfolio: {
        counts: {
          stocksTotal: groupedStocks.length,
          stocksTH: groupedStocks.filter(s => s.region === 'TH').length,
          stocksUS: groupedStocks.filter(s => s.region !== 'TH').length,
          cashAccounts: cashList.length,
        },
        totals: {
          netWorthTHB: Math.round(total),
          stocksTHB: stocksTotal,
          cashTHB: Math.round(cash),
        },
        stocks: groupedStocks,
        cash: cashList,
      },
      rebalanceHealth: {
        maxDrift: +maxDrift.toFixed(1),
        lastRebalanceDate: lastRebalance ? lastRebalance.toLocaleDateString(th ? 'th-TH' : 'en-US') : (th ? "ไม่เคยปรับ" : "Never"),
        daysSinceRebalance,
        isOverdue,
        isDriftHigh,
        recommendations: {
          calendarRule: isOverdue ? (th ? "ครบ 1 ปีแล้ว ควรปรับ" : "1+ year since last rebalance - time to adjust") : (th ? "ยังไม่ถึง 1 ปี" : "Less than 1 year"),
          driftRule: isDriftHigh ? (th ? `เบี่ยงมากกว่า 5% (สูงสุด ${maxDrift.toFixed(1)}%)` : `Drifted >5% from target (max ${maxDrift.toFixed(1)}%)`) : (th ? "เบี่ยงน้อยกว่า 5% (ยังปลอดภัย)" : "Within 5% tolerance"),
        },
      },
    })
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

      {/* Rebalancing Rules Guide — collapsible */}
      <div className="card" style={{ marginBottom: 24 }}>
        <button
          onClick={() => setRulesOpen(v => !v)}
          style={{ width: "100%", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 0, color: "var(--fg)" }}
        >
          <h4 style={{ fontSize: 14, fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>📋</span>
            {th ? "กฎการปรับสมดุล (เมื่อควรปรับ?)" : "Rebalancing Rules (When to rebalance?)"}
          </h4>
          <span style={{ fontSize: 12, color: "var(--muted)", transition: "transform 0.2s", display: "inline-block", transform: rulesOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
        </button>
        {rulesOpen && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, fontSize: 12 }}>
              <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--line)" }}>
                <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                  📅 {th ? "กฎปฏิทิน" : "Calendar"}
                </div>
                <div className="muted" style={{ lineHeight: 1.6 }}>
                  {th ? "ปรับอย่างน้อย 1 ครั้ง/ปี แม้ว่าสัดส่วนยังใกล้เป้า เพื่อ reset ฐาน" : "Rebalance at least once per year even if drift is small, to reset your baseline"}
                </div>
              </div>
              <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--line)" }}>
                <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                  📊 {th ? "กฎเบี่ยง ±5%" : "Drift ±5%"}
                </div>
                <div className="muted" style={{ lineHeight: 1.6 }}>
                  {th ? "ปรับทันทีเมื่อกลุ่มสินทรัพย์ใดเบี่ยงไป >5% จากเป้าหมาย (วัดที่ระดับ Class ไม่ใช่รายหุ้น)" : "Act immediately if any asset class drifts >5% from target — measured at class level, not per holding"}
                </div>
              </div>
              <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--line)" }}>
                <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                  💰 {th ? "เติมเงิน (Cash-flow)" : "Cash-flow"}
                </div>
                <div className="muted" style={{ lineHeight: 1.6 }}>
                  {th ? "ใช้เงินฝากใหม่ซื้อกลุ่มที่ขาด แทนการขาย ช่วยลดภาษีและค่าธรรมเนียม" : "Use new deposits to buy underweight classes instead of selling — reduces tax and fees"}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--line)", fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 16, flexWrap: "wrap" }}>
              <span>⚠️ {th ? "Tolerance band คือ threshold ที่ระดับ Class (TH Equity, US Equity, Bonds...)" : "Tolerance band filters at Class level, not individual holdings"}</span>
              <span>🚫 {th ? "ถ้ากลุ่มสมดุล → ไม่แนะนำแม้รายหุ้นเบี่ยง" : "If class is balanced, no trades suggested even if individual holdings drift"}</span>
            </div>
          </div>
        )}
      </div>

      {/* Tool cards */}
      <div className="grid grid-3" style={{ marginBottom: 24, gap: 12 }}>
        <ToolCard active title={t.tools.rebalance} sub={t.tools.rebalanceSub} icon="filter" />
        <ToolCard locked title={th ? "เครื่องคำนวณเกษียณ" : "Retirement projector"} sub={th ? "ดูว่าเงินจะถึงเมื่อไหร่ ถ้ายังออมเท่านี้" : "Project when you'll reach your retirement number"} icon="leaf" />
        <ToolCard locked title="Tax-loss harvesting" sub={th ? "หาคู่ wash-sale-safe จากตำแหน่งที่ขาดทุน" : "Find wash-sale-safe pairs in your losers"} icon="info" />
      </div>

      <div className="grid grid-12" style={{ alignItems: "start" }}>
        {/* Input panel */}
        <div className="card col-span-5" style={{ height: "fit-content" }}>
          <h3 className="section-title" style={{ marginBottom: 4 }}>{t.tools.rebalance}</h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 22 }}>
            {th ? "ใส่จำนวนเงินที่จะฝาก/ถอน เราจะแนะนำการซื้อขายที่สะอาดที่สุด" : "Enter how much you'll deposit or withdraw. We'll suggest the cleanest trades."}
          </p>

          {/* Portfolio summary */}
          <div style={{ display: "flex", gap: 24, marginBottom: 20, padding: "14px 16px", borderRadius: 10, background: "var(--bg-2)", flexWrap: "wrap" }}>
            <div>
              <div className="label-up" style={{ marginBottom: 3 }}>{th ? "พอร์ตลงทุน" : "Investable portfolio"}</div>
              <div style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-display)" }}>{FMT.money(investableTotal, ccy, { compact: true })}</div>
            </div>
            {isLive && (
              <div>
                <div className="label-up" style={{ marginBottom: 3 }}>{th ? "ตำแหน่ง" : "Positions"}</div>
                <div style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-display)" }}>{rows.length}</div>
              </div>
            )}
            <div>
              <div className="label-up" style={{ marginBottom: 3 }}>{th ? "ปรับล่าสุด" : "Last rebalanced"}</div>
              <div style={{ fontSize: 14, fontWeight: 500, fontFamily: "var(--font-display)", color: isOverdue ? "var(--loss)" : "var(--fg)" }}>
                {lastRebalance
                  ? `${daysSinceRebalance}${th ? " วันที่แล้ว" : "d ago"}${isOverdue ? " ⚠" : ""}`
                  : <span className="muted">{th ? "ยังไม่เคย" : "Never"}</span>}
              </div>
            </div>
          </div>

          <div className="segmented" style={{ width: "100%", padding: 4 }}>
            <button className={mode === "deposit" ? "on" : ""} style={{ flex: 1, padding: "8px 16px" }} onClick={() => setMode("deposit")}>
              {t.tools.deposit}
            </button>
            <button className={mode === "withdraw" ? "on" : ""} style={{ flex: 1, padding: "8px 16px" }} onClick={() => setMode("withdraw")}>
              {t.tools.withdraw}
            </button>
          </div>

          {/* ── Cash account selector (deposit mode only, live data only) ── */}
          {mode === "deposit" && isLive && accountOptions.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="label-up" style={{ marginBottom: 8 }}>{th ? "ใช้เงินจากบัญชี (เลือกได้หลายบัญชี)" : "Draw funds from accounts (multi-select)"}</div>
              <div style={{ display: "grid", gap: 6 }}>
                {accountOptions.map(a => {
                  const checked = selectedAccountIds.has(a.id)
                  // Always pass THB amounts to FMT.money — it handles ccy conversion internally
                  return (
                    <div
                      key={a.id}
                      onClick={() => !a.locked && toggleAccount(a.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 12px", borderRadius: 10,
                        border: `1.5px solid ${a.locked ? "var(--line)" : checked ? "var(--accent)" : "var(--line)"}`,
                        background: a.locked ? "var(--bg-2)" : checked ? "var(--accent-soft)" : "var(--bg)",
                        cursor: a.locked ? "not-allowed" : "pointer",
                        opacity: a.locked ? 0.55 : 1,
                        transition: "all 0.15s",
                      }}
                    >
                      {/* Checkbox */}
                      <div style={{
                        width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${a.locked ? "var(--line)" : checked ? "var(--accent)" : "var(--ink-3)"}`,
                        background: checked ? "var(--accent)" : "transparent",
                        display: "grid", placeItems: "center", flexShrink: 0,
                      }}>
                        {checked && <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="2 5 4.5 7.5 8 2.5" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      {/* Icon */}
                      <div style={{ fontSize: 16, flexShrink: 0 }}>{a.isEmergency ? "🛡" : "💵"}</div>
                      {/* Name + info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.label || a.name || (th ? "บัญชีเงินสด" : "Cash account")}
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 1 }}>
                          {a.isEmergency
                            ? a.locked
                              ? (th ? `ยอดฉุกเฉิน ${FMT.money(a.balTHB, ccy, { compact: true })} · ยังไม่เกินเป้า` : `Emergency ${FMT.money(a.balTHB, ccy, { compact: true })} · at/below target`)
                              : (th ? `ส่วนเกินเป้า ${FMT.money(a.targetTHB, ccy, { compact: true })} = ${FMT.money(a.available, ccy, { compact: true })}` : `Excess above target ${FMT.money(a.targetTHB, ccy, { compact: true })}`)
                            : (th ? `ยอด ${FMT.money(a.balTHB, ccy, { compact: true })} · ลงทุนได้ทั้งหมด` : `Balance ${FMT.money(a.balTHB, ccy, { compact: true })} · fully investable`)
                          }
                        </div>
                      </div>
                      {/* Available badge */}
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        {a.locked
                          ? <span style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--font-mono)" }}>—</span>
                          : <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-display)", color: checked ? "var(--accent-ink)" : "var(--ink)" }}>
                              {FMT.money(a.available, ccy, { compact: true })}
                            </span>
                        }
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Total + use-amount button */}
              {selectedAccountIds.size > 0 && selectedAvailableTHB > 0 && (
                <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "oklch(0.96 0.04 200)", border: "1px solid oklch(0.82 0.08 200)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "oklch(0.45 0.10 200)" }}>{th ? "รวมที่เลือก" : "Total selected"}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--font-display)", color: "oklch(0.35 0.12 200)" }}>
                      {FMT.money(selectedAvailableTHB, ccy, { compact: true })}
                    </div>
                  </div>
                  <button className="btn btn-sm" style={{ background: "oklch(0.35 0.12 200)", color: "white", border: "none" }}
                    onClick={() => {
                      const val = ccy === 'USD' ? selectedAvailableTHB / fxRate : selectedAvailableTHB
                      setAmount(String(Math.floor(val)))
                      setShowResult(false)
                    }}>
                    {th ? "ใช้จำนวนนี้" : "Use this amount"}
                  </button>
                </div>
              )}
            </div>
          )}

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
              {[10000, 25000, 50000, 100000].map(qTHB => {
                // Amount field is in display ccy; convert THB preset to ccy for setAmount
                const qAmt = ccy === 'USD' ? Math.round(qTHB / fxRate) : qTHB
                return (
                  <button key={qTHB} className="chip" style={{ cursor: "pointer" }} onClick={() => { setAmount(String(qAmt)); setShowResult(false) }}>
                    {FMT.money(qTHB, ccy, { compact: true })}
                  </button>
                )
              })}
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
          <div style={{ marginTop: 20 }}>
            {targetMode === "hybrid" && (
              <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "var(--gain-soft)", fontSize: 11.5, color: "var(--gain)", lineHeight: 1.5 }}>
                💡 {th ? "Hybrid mode: Tolerance band ใช้กับแต่ละหุ้น (ไม่ใช่แค่ Class ระดับ)" : "Hybrid mode: Tolerance band applies per-ticker, not just at class level"}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{th ? "Tolerance Band" : "Tolerance Band"}</div>
              <div className="segmented" style={{ flexShrink: 0 }}>
                <button className={bandMode === "flat" ? "on" : ""} style={{ fontSize: 11, padding: "4px 10px" }}
                  onClick={() => { setBandMode("flat"); setShowResult(false) }}>
                  {th ? "กำหนดเอง" : "Flat %"}
                </button>
                <button className={bandMode === "5/25" ? "on" : ""} style={{ fontSize: 11, padding: "4px 10px" }}
                  onClick={() => { setBandMode("5/25"); setShowResult(false) }}>
                  5/25 Rule
                </button>
              </div>
            </div>

            {bandMode === "flat" ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CalcInput value={band}
                    onChange={e => { setBand(Math.max(0, Math.min(50, parseFloat(e.target.value) || 0))); setShowResult(false) }}
                    style={{ width: 56, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 14, textAlign: "right" }} />
                  <span className="muted" style={{ fontSize: 13 }}>%</span>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {band === 0
                      ? (th ? "ปรับทุกกลุ่มที่เบี่ยงแม้เล็กน้อย" : "all drifts trigger")
                      : (th ? `เบี่ยง < ${band}% ข้าม · ≥ ${band}% ปรับ` : `skip < ${band}%, trade ≥ ${band}%`)}
                  </span>
                </div>
                {band > 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--ink-3)" }}>
                    💡 {th ? "ไม่มีคำสั่ง? ลด 0% เพื่อดูทั้งหมด" : "No trades? Set 0% to see all suggestions"}
                  </div>
                )}
              </>
            ) : (
              <div style={{ background: "var(--bg-2)", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 11.5, marginBottom: 8, lineHeight: 1.6 }} className="muted">
                  {th
                    ? <>กฎ 5/25: trigger เมื่อ <strong>min(5%, เป้า × 25%)</strong> — กลุ่มเล็กปรับง่ายกว่า</>
                    : <>5/25 rule: triggers at <strong>min(5%, target × 25%)</strong> — smaller allocations get tighter bands</>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 12px" }}>
                  {Object.entries(targets).map(([k, v]) => {
                    const tgt = v * 100
                    const eb = Math.min(5, tgt * 0.25)
                    return (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                        <span style={{ color: "var(--ink-2)" }}>{k}</span>
                        <span style={{ color: eb < 5 ? "var(--accent-ink)" : "var(--ink-3)" }}>
                          {tgt.toFixed(0)}% → ±{eb.toFixed(2)}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
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
          {/* Rebalance recommendation banner */}
          {needsRebalance && (
            <div className="card" style={{
              padding: 16,
              background: isDriftHigh ? "oklch(0.96 0.08 50)" : "oklch(0.95 0.06 200)",
              border: `1.5px solid ${isDriftHigh ? "oklch(0.65 0.20 50)" : "oklch(0.60 0.15 200)"}`,
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ fontSize: 20, flexShrink: 0 }}>⚠️</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: isDriftHigh ? "oklch(0.42 0.15 50)" : "oklch(0.35 0.12 200)" }}>
                    {th ? "ควรปรับพอร์ต" : "Time to rebalance"}
                  </div>
                  <div style={{ fontSize: 12.5, color: isDriftHigh ? "oklch(0.45 0.12 50)" : "oklch(0.40 0.10 200)", lineHeight: 1.6, marginBottom: 12 }}>
                    {isOverdue ? (
                      <>
                        {th ? `ปรับครั้งล่าสุด: ${daysSinceRebalance} วันที่แล้ว` : `Last rebalanced: ${daysSinceRebalance} days ago`}
                        <br />
                      </>
                    ) : null}
                    {isDriftHigh ? (
                      <>
                        {th ? `สัดส่วนเบี่ยงไป ${maxDrift.toFixed(1)}% จากเป้า` : `Portfolio drifted ${maxDrift.toFixed(1)}% from target`}
                      </>
                    ) : null}
                  </div>
                  <button className="btn btn-sm" onClick={reviewForRebalance} disabled={ai.loading}>
                    <Icon name="spark" size={13} /> {ai.loading ? (th ? "กำลังวิเคราะห์…" : "Analyzing…") : (th ? "วิเคราะห์ด้วย AI" : "Review with AI")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Target editor */}
          {editTargets && (
            <div className="card" style={{ border: "1.5px solid var(--accent)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div className="segmented" style={{ flexWrap: "wrap" }}>
                    <button className={targetMode === "class" ? "on" : ""} onClick={() => setTargetMode("class")} style={{ fontSize: 12 }}>
                      {th ? "ตามกลุ่ม" : "By class"}
                    </button>
                    <button className={targetMode === "hybrid" ? "on" : ""} onClick={() => setTargetMode("hybrid")} style={{ fontSize: 12 }}>
                      {th ? "กลุ่ม+รายตัว" : "Class + holding"}
                    </button>
                  </div>
                  {targetMode === "hybrid" && (
                    <span style={{ fontSize: 11, color: "var(--gain)", fontWeight: 500, padding: "4px 8px", borderRadius: 6, background: "var(--gain-soft)" }}>
                      {th ? "ดูละเอียดต่อหุ้น ✓" : "Per-ticker analysis ✓"}
                    </span>
                  )}
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
                          <CalcInput value={(v * 100).toFixed(0)}
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
                              <CalcInput value={w.toFixed(0)}
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
                      <CalcInput value={(v * 100).toFixed(0)}
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8, flexWrap: "wrap" }}>
              <h3 className="section-title" style={{ margin: 0 }}>{th ? "เป้าหมาย vs. หลังปรับ" : "Target vs. after rebalance"}</h3>
              {targetMode === "hybrid" && (
                <span style={{ fontSize: 10.5, color: "var(--gain)", fontWeight: 500 }}>💚 Hybrid mode</span>
              )}
            </div>
            <p className="muted" style={{ fontSize: 11.5, margin: "0 0 14px", lineHeight: 1.5 }}>
              {th
                ? "ส่วนต่าง = น้ำหนักปัจจุบัน − เป้า · 🔴 + = เกินเป้า · 🟢 − = ต่ำกว่าเป้า · กดที่กลุ่มเพื่อดูรายหุ้น"
                : "Diff = current − target · 🔴 + = overweight · 🟢 − = underweight · click a class to see holdings"}
            </p>
            {/* Column headers */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(96px,150px) 42px 1fr 56px 60px 50px", alignItems: "center", gap: 10, paddingBottom: 5 }}>
              <div className="label-up">{th ? "หลักทรัพย์" : "Holding"}</div>
              <div className="label-up" style={{ fontSize: 9 }}>{th ? "เป้า" : "Target"}</div>
              <div />
              <div className="label-up" style={{ textAlign: "right", fontSize: 9 }}>{th ? "ปัจจุบัน" : "Now"}</div>
              <div className="label-up" style={{ textAlign: "right", fontSize: 9 }}>{th ? "หลังปรับ" : "After"}</div>
              <div className="label-up" style={{ textAlign: "right", fontSize: 9 }}>{th ? "ส่วนต่าง" : "Diff"}</div>
            </div>
            <div style={{ overflowX: "auto" }}>
              {targetMode === "hybrid" ? (
                // ── HYBRID MODE: group by class → expandable per-ticker ──────────────
                Object.entries(tickersByClass).filter(([cls]) => (targets[cls] || 0) > 0).map(([cls, tickers]) => {
                  const clsSuggs    = tickers.map(tr => suggestions.find(s => s.name === tr.ticker)).filter(Boolean)
                  const clsCurPct   = clsSuggs.reduce((a, s) => a + s.curPct, 0)
                  const clsTgtPct   = (targets[cls] || 0) * 100
                  const clsAfterPct = clsSuggs.reduce((a, s) => {
                    const td = tradeDeltas[s.name] || 0
                    return a + (newTotal > 0 ? (s.current + td) / newTotal * 100 : 0)
                  }, 0)
                  const clsDrift   = clsCurPct - clsTgtPct
                  const isExpanded = expandedClasses.has(cls)
                  return (
                    <div key={cls}>
                      {/* ── Class header row ─────────────────────────────────── */}
                      <div onClick={() => toggleClassExpand(cls)}
                        style={{ display: "grid", gridTemplateColumns: "minmax(96px,150px) 42px 1fr 56px 60px 50px", alignItems: "center", gap: 10, padding: "5px 0", borderTop: "1px solid var(--line)", cursor: "pointer" }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                          <ClassBadge name={cls} />
                          <span style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 2, flexShrink: 0, transition: "transform 0.15s", display: "inline-block", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
                        </div>
                        <div className="mono muted" style={{ fontSize: 10.5 }}>→{clsTgtPct.toFixed(0)}%</div>
                        <div style={{ position: "relative", height: 10 }}>
                          <div style={{ position: "absolute", inset: 0, background: "var(--bg-2)", borderRadius: 999 }} />
                          <div style={{ position: "absolute", height: "100%", background: "var(--ink-4)", width: Math.min(100, clsCurPct) + "%", opacity: 0.5, borderRadius: 999 }} />
                          <div style={{ position: "absolute", height: "100%", background: "var(--accent)", width: Math.min(100, clsAfterPct) + "%", borderRadius: 999 }} />
                          <div style={{ position: "absolute", top: -2, height: 14, width: 2, background: "var(--ink-2)", left: "calc(" + Math.min(100, clsTgtPct) + "% - 1px)" }} />
                        </div>
                        <div className="mono muted" style={{ fontSize: 10.5, textAlign: "right" }}>{clsCurPct.toFixed(1)}%</div>
                        <div className="mono" style={{ fontSize: 10.5, textAlign: "right", fontWeight: 500 }}>{clsAfterPct.toFixed(1)}%</div>
                        <div style={{ textAlign: "right" }}>
                          {Math.abs(clsDrift) >= effectiveBand(clsTgtPct) ? (
                            <span className={"chip " + (clsDrift > 0 ? "chip-loss" : "chip-gain")} style={{ fontSize: 9.5 }}>{clsDrift > 0 ? "+" : ""}{clsDrift.toFixed(1)}%</span>
                          ) : Math.abs(clsDrift) > 0.5 ? (
                            <span className="muted" style={{ fontSize: 9.5 }}>{clsDrift > 0 ? "+" : ""}{clsDrift.toFixed(1)}%</span>
                          ) : null}
                        </div>
                      </div>
                      {/* ── Per-ticker sub-rows (expand) ──────────────────────── */}
                      {isExpanded && clsSuggs.map((s, si) => {
                        const td   = tradeDeltas[s.name] || 0
                        const aft  = newTotal > 0 ? (s.current + td) / newTotal * 100 : 0
                        const drft = s.curPct - s.tgtPct
                        const tr   = tickers.find(t => t.ticker === s.name)
                        return (
                          <div key={s.name} onClick={() => setOpenRow(s)} style={{ display: "grid", gridTemplateColumns: "minmax(96px,150px) 42px 1fr 56px 60px 50px", alignItems: "center", gap: 10, padding: "4px 0 4px 12px", background: "var(--bg-2)", borderTop: si === 0 ? "none" : "1px solid var(--line)", cursor: "pointer" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                              <div style={{ width: 3, height: 28, background: "var(--line)", borderRadius: 2, flexShrink: 0 }} />
                              <TickerLogo ticker={s.name} logoUrl={tr?.logo_url} region={tr?.region} cls={tr?.cls} size={20} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 11.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                                <div className="mono muted" style={{ fontSize: 9.5 }}>{FMT.money(s.current, ccy, { compact: true })}</div>
                              </div>
                            </div>
                            <div className="mono muted" style={{ fontSize: 10 }}>→{s.tgtPct.toFixed(1)}%</div>
                            <div style={{ position: "relative", height: 7 }}>
                              <div style={{ position: "absolute", inset: 0, background: "var(--bg)", borderRadius: 999 }} />
                              <div style={{ position: "absolute", height: "100%", background: drft > 0 ? "var(--loss)" : "var(--gain)", opacity: 0.6, width: Math.min(100, clsTgtPct > 0 ? s.curPct / clsTgtPct * 100 : 0) + "%", borderRadius: 999 }} />
                              <div style={{ position: "absolute", top: -1, height: 9, width: 2, background: "var(--ink-3)", left: "calc(" + Math.min(100, clsTgtPct > 0 ? s.tgtPct / clsTgtPct * 100 : 0) + "% - 1px)" }} />
                            </div>
                            <div className="mono muted" style={{ fontSize: 10, textAlign: "right" }}>{s.curPct.toFixed(1)}%</div>
                            <div className="mono muted" style={{ fontSize: 10, textAlign: "right" }}>{aft.toFixed(1)}%</div>
                            <div style={{ textAlign: "right" }}>
                              {Math.abs(drft) >= effectiveBand(s.tgtPct) ? (
                                <span className={"chip " + (drft > 0 ? "chip-loss" : "chip-gain")} style={{ fontSize: 9 }}>{drft > 0 ? "+" : ""}{drft.toFixed(1)}%</span>
                              ) : (
                                <span style={{ fontSize: 9, color: "var(--ink-4)" }}>✓</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              ) : (
                // ── CLASS MODE: existing rendering ───────────────────────────────────
                suggestions.map(s => {
                  const tradeDelta = tradeDeltas[s.name] || 0
                  const after = newTotal > 0 ? (s.current + tradeDelta) / newTotal * 100 : 0
                  const before = s.curPct
                  const drift = before - s.tgtPct
                  const allHoldingRows = holdingDriftByClass[s.name] || []
                  const isExpanded = expandedClasses.has(s.name)
                  const holdingRows = isExpanded ? allHoldingRows : []
                  const hasHoldings = allHoldingRows.length > 0
                  return (
                    <div key={s.name}>
                      {/* Class row — click left side to open ฿ detail popup, click chevron to expand holdings */}
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(96px,150px) 42px 1fr 56px 60px 50px", alignItems: "center", gap: 10, padding: "5px 0", borderTop: "1px solid var(--line)" }}>
                        <div
                          onClick={() => hasHoldings ? toggleClassExpand(s.name) : setOpenRow(s)}
                          style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                          <ClassBadge name={s.name} />
                          {hasHoldings && (
                            <span style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 2, flexShrink: 0, transition: "transform 0.15s", display: "inline-block", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}>▾</span>
                          )}
                        </div>
                        {/* remaining cells click → open ฿ popup */}
                        <div className="mono muted" style={{ fontSize: 10.5, cursor: "pointer" }} onClick={() => setOpenRow(s)}>→{s.tgtPct.toFixed(0)}%</div>
                        <div style={{ position: "relative", height: 10, cursor: "pointer" }} onClick={() => setOpenRow(s)}>
                          <div style={{ position: "absolute", inset: 0, background: "var(--bg-2)", borderRadius: 999 }} />
                          <div style={{ position: "absolute", height: "100%", background: "var(--ink-4)", width: Math.min(100, before) + "%", opacity: 0.5, borderRadius: 999 }} />
                          <div style={{ position: "absolute", height: "100%", background: "var(--accent)", width: Math.min(100, after) + "%", borderRadius: 999 }} />
                          <div style={{ position: "absolute", top: -2, height: 14, width: 2, background: "var(--ink-2)", left: "calc(" + Math.min(100, s.tgtPct) + "% - 1px)" }} />
                        </div>
                        <div className="mono muted" style={{ fontSize: 10.5, textAlign: "right", cursor: "pointer" }} onClick={() => setOpenRow(s)}>{before.toFixed(1)}%</div>
                        <div className="mono" style={{ fontSize: 10.5, textAlign: "right", fontWeight: 500, cursor: "pointer" }} onClick={() => setOpenRow(s)}>{after.toFixed(1)}%</div>
                        <div style={{ textAlign: "right", cursor: "pointer" }} onClick={() => setOpenRow(s)}>
                          {Math.abs(drift) >= effectiveBand(s.tgtPct) ? (
                            <span className={"chip " + (drift > 0 ? "chip-loss" : "chip-gain")} style={{ fontSize: 9.5 }}>
                              {drift > 0 ? "+" : ""}{drift.toFixed(1)}%
                            </span>
                          ) : Math.abs(drift) > 0.5 ? (
                            <span className="muted" style={{ fontSize: 9.5 }}>{drift > 0 ? "+" : ""}{drift.toFixed(1)}%</span>
                          ) : null}
                        </div>
                      </div>
                      {/* Holding sub-rows (accordion — visible when class is expanded) */}
                      {holdingRows.map((h, hi) => {
                        const hDrift = h.drift  // within-class drift
                        const exceedsBand = Math.abs(hDrift) >= effectiveBand(h.tgtWithin)
                        return (
                          <div key={h.ticker}
                            style={{ display: "grid", gridTemplateColumns: "minmax(96px,150px) 42px 1fr 56px 60px 50px", alignItems: "center", gap: 10, padding: "4px 0 4px 12px", background: "var(--bg-2)", borderTop: hi === 0 ? "none" : "1px solid var(--line)" }}>
                            {/* Ticker name + logo + value */}
                            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                              <div style={{ width: 3, height: 28, background: "var(--line)", borderRadius: 2, flexShrink: 0 }} />
                              <TickerLogo ticker={h.ticker} logoUrl={h.logo_url} region={h.region} cls={h.cls} size={20} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 11.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.ticker}</div>
                                <div className="mono muted" style={{ fontSize: 9.5 }}>{FMT.money(h.value, ccy, { compact: true })}</div>
                              </div>
                            </div>
                            {/* Within-class target — use 1 decimal to avoid rounding small holdings to 0% */}
                            <div className="mono muted" style={{ fontSize: 10 }}>→{h.tgtWithin.toFixed(1)}%*</div>
                            {/* Mini bar — within-class % */}
                            <div style={{ position: "relative", height: 7 }}>
                              <div style={{ position: "absolute", inset: 0, background: "var(--bg)", borderRadius: 999 }} />
                              <div style={{ position: "absolute", height: "100%", background: hDrift > 0 ? "var(--loss)" : "var(--gain)", opacity: 0.6, width: Math.min(100, h.curWithin) + "%", borderRadius: 999 }} />
                              <div style={{ position: "absolute", top: -1, height: 9, width: 2, background: "var(--ink-3)", left: "calc(" + Math.min(100, h.tgtWithin) + "% - 1px)" }} />
                            </div>
                            {/* Current within-class % */}
                            <div className="mono muted" style={{ fontSize: 10, textAlign: "right" }}>{h.curWithin.toFixed(1)}%</div>
                            {/* Portfolio % */}
                            <div className="mono muted" style={{ fontSize: 10, textAlign: "right" }}>{h.curPct.toFixed(1)}%</div>
                            {/* Drift badge — only if exceeds tolerance band */}
                            <div style={{ textAlign: "right" }}>
                              {exceedsBand ? (
                                <span className={"chip " + (hDrift > 0 ? "chip-loss" : "chip-gain")} style={{ fontSize: 9 }}>
                                  {hDrift > 0 ? "+" : ""}{hDrift.toFixed(1)}%
                                </span>
                              ) : (
                                <span style={{ fontSize: 9, color: "var(--ink-4)" }}>✓</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              )}
              {/* Totals row — sums of target/now/after across all classes */}
              {(() => {
                const sumTgt = suggestions.reduce((s, x) => s + x.tgtPct, 0)
                const sumNow = suggestions.reduce((s, x) => s + x.curPct, 0)
                const sumAfter = suggestions.reduce((s, x) => s + (newTotal > 0 ? (x.current + (tradeDeltas[x.name] || 0)) / newTotal * 100 : 0), 0)
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(96px,150px) 42px 1fr 56px 60px 50px", alignItems: "center", gap: 10, padding: "8px 0 2px", borderTop: "2px solid var(--line)", marginTop: 2 }}>
                    <div className="label-up" style={{ fontSize: 9 }}>{th ? "รวม" : "Total"}</div>
                    <div className="mono muted" style={{ fontSize: 10.5 }}>{sumTgt.toFixed(0)}%</div>
                    <div />
                    <div className="mono muted" style={{ fontSize: 10.5, textAlign: "right" }}>{sumNow.toFixed(1)}%</div>
                    <div className="mono" style={{ fontSize: 10.5, textAlign: "right", fontWeight: 600 }}>{sumAfter.toFixed(1)}%</div>
                    <div />
                  </div>
                )
              })()}
              {/* Footnote */}
              <div style={{ marginTop: 8, fontSize: 10.5, color: "var(--ink-4)", lineHeight: 1.6 }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>→X%*</span> {th ? "= สัดส่วนภายในกลุ่ม · ส่วนต่างแสดงเมื่อเบี่ยง ≥ tolerance band" : "= proportion within class · drift shown only when ≥ tolerance band"}
                {targetMode !== "hybrid" && (
                  <> · {th ? "⚠ ใช้ Hybrid mode (ปรับเป้าหมาย) เพื่อกำหนดเป้าแต่ละหุ้นแยกกัน" : "⚠ Use Hybrid mode (Edit targets) to set per-ticker targets"}</>
                )}
              </div>
            </div>
          </div>

          {/* Missing-class starter suggestions */}
          {targetMode === "class" && missingClasses.length > 0 && (
            <div className="card" style={{ padding: "16px 18px", background: "oklch(0.97 0.04 220)", border: "1px solid oklch(0.85 0.08 220)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 16 }}>💡</span>
                <div style={{ fontWeight: 600, fontSize: 13, color: "oklch(0.35 0.12 220)" }}>
                  {th ? "เพิ่มหลักทรัพย์เข้าพอร์ตก่อนเพื่อรับคำแนะนำซื้อ" : "Add holdings to unlock buy suggestions for these classes"}
                </div>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {missingClasses.map(cls => {
                  const s = suggestions.find(x => x.name === cls)
                  const targetAmt = s ? s.delta : 0
                  const starters = STARTER_INSTRUMENTS[cls] || []
                  return (
                    <div key={cls} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 12px", borderRadius: 10, background: "white", border: "1px solid oklch(0.88 0.05 220)" }}>
                      <div style={{ flexShrink: 0 }}>
                        <ClassBadge name={cls} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: starters.length ? 6 : 0, flexWrap: "wrap" }}>
                          {targetAmt > 0 && showResult && (
                            <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 600, color: "oklch(0.35 0.12 220)" }}>
                              {FMT.money(targetAmt, ccy, { compact: true })}
                            </span>
                          )}
                          {targetAmt > 0 && showResult && (
                            <span className="chip chip-gain" style={{ fontSize: 10 }}>
                              {th ? "จัดสรรได้" : "to allocate"}
                            </span>
                          )}
                        </div>
                        {starters.length > 0 && (
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                            {starters.map(inst => (
                              <div key={inst.ticker} style={{
                                display: "inline-flex", alignItems: "center", gap: 5,
                                padding: "3px 8px 3px 5px", borderRadius: 6,
                                background: "var(--bg-2)", border: "1px solid var(--line)",
                                fontSize: 11, cursor: "default",
                              }}>
                                <TickerLogo ticker={inst.ticker} region={inst.region} cls={inst.cls} size={16} />
                                <span style={{ fontWeight: 600 }}>{inst.ticker}</span>
                                <span className="muted" style={{ fontSize: 10 }}>{inst.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div style={{ fontSize: 10.5, color: "oklch(0.50 0.08 220)", marginTop: 10 }}>
                {th ? "เพิ่ม 1 หลักทรัพย์จากรายการข้างต้นในหน้า Portfolio แล้ว Calculate ใหม่" : "Add one of the above to your Portfolio, then Calculate again to get exact buy amounts."}
              </div>
            </div>
          )}

          {/* Suggested trades */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 8 }}>
              <h3 className="section-title">{t.tools.suggestion}</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {showResult && <span className="chip">{trades.length} {th ? "รายการ" : "trades"}</span>}
                {aiAvailable && showResult && trades.length > 0 && (
                  <button className="btn btn-outline btn-sm" onClick={explainRebalance} disabled={ai.loading}
                    title={th ? "ให้ AI อธิบายแผน rebalance นี้" : "Have AI explain this rebalance plan"}>
                    <Icon name="spark" size={13} /> {ai.loading ? (th ? "กำลังคิด…" : "Thinking…") : (th ? "อธิบายด้วย AI" : "Explain with AI")}
                  </button>
                )}
              </div>
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
              <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.tools.action}</th>
                    <th>{t.portfolio.holding}</th>
                    <th className="num">{t.portfolio.shares}</th>
                    <th className="num">{th ? "ราคา" : "Price"}</th>
                    <th className="num">{th ? "จำนวนเงิน" : "Amount"}</th>
                    <th className="num" title={th ? "กำไร/ขาดทุนที่ยังไม่รับรู้" : "Unrealized P/L"}>P/L%</th>
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
                      <td className="num" style={{ fontSize: 11, color: tr.plPct == null ? "var(--muted)" : tr.plPct >= 0 ? "var(--gain)" : "var(--loss)", fontWeight: tr.plPct != null ? 500 : 400 }}>
                        {tr.plPct != null
                          ? <>{tr.plPct >= 0 ? "+" : ""}{tr.plPct}%{tr.action === "Sell" && tr.plPct < 0 ? <span title={th ? "ขายขาดทุน = ลด tax" : "Selling at a loss = tax benefit"} style={{ marginLeft: 3 }}>💸</span> : null}</>
                          : "—"}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: "var(--bg)", fontWeight: 500 }}>
                    <td colSpan="5"><span className="label-up">{th ? "เงินสดคงเหลือ" : "Cash remaining"}</span></td>
                    <td className="num">{FMT.money(cashRemaining, ccy, { compact: true })}</td>
                  </tr>
                </tbody>
              </table>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "space-between", flexWrap: "wrap" }}>
              <button className="btn btn-outline btn-sm" onClick={() => { saveLastRebalance(); setLastRebalance(new Date()); setShowResult(false) }} disabled={!showResult || trades.length === 0}>
                <Icon name="check" size={13} /> {th ? "บันทึกปรับแล้ว" : "Mark as done"}
              </button>
              <div style={{ display: "flex", gap: 8 }}>
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
      {openRow && (() => {
        const s = openRow
        const currentVal = Number(s.current) || 0
        const targetVal  = Number(s.target)  || 0           // ฿ target after rebalance
        const targetNowVal = total > 0 ? total * s.tgtPct / 100 : 0   // ฿ what the target % is at today's total
        const diffVal    = currentVal - targetNowVal        // current minus today's-total target
        const moveVal    = targetVal - currentVal           // signed: + = buy, − = sell
        return (
          <div onClick={e => e.target === e.currentTarget && setOpenRow(null)}
            style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: "var(--bg)", borderRadius: 18, padding: 24, width: "100%", maxWidth: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}><ClassBadge name={s.name} /></h3>
                <button onClick={() => setOpenRow(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--ink-3)", lineHeight: 1, padding: 4 }}>✕</button>
              </div>
              <p className="muted" style={{ fontSize: 11, margin: "0 0 16px" }}>
                {th ? `เป้า ${s.tgtPct.toFixed(0)}% · ปัจจุบัน ${s.curPct.toFixed(1)}%` : `Target ${s.tgtPct.toFixed(0)}% · Now ${s.curPct.toFixed(1)}%`}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ padding: 12, borderRadius: 10, background: "var(--bg-2)" }}>
                  <div className="label-up" style={{ fontSize: 9 }}>{th ? "ปัจจุบัน" : "Now"}</div>
                  <div className="mono" style={{ fontSize: 15, fontFamily: "var(--font-display)", marginTop: 4 }}>{FMT.money(currentVal, ccy)}</div>
                </div>
                <div style={{ padding: 12, borderRadius: 10, background: "var(--bg-2)" }}>
                  <div className="label-up" style={{ fontSize: 9 }}>{th ? "เป้าหลังปรับ" : "Target (after)"}</div>
                  <div className="mono" style={{ fontSize: 15, fontFamily: "var(--font-display)", marginTop: 4 }}>{FMT.money(targetVal, ccy)}</div>
                </div>
                <div style={{ padding: 12, borderRadius: 10, background: "var(--bg-2)" }}>
                  <div className="label-up" style={{ fontSize: 9 }}>{th ? "ส่วนต่างจากเป้า" : "Off target"}</div>
                  <div className="mono" style={{ fontSize: 15, fontFamily: "var(--font-display)", marginTop: 4, color: Math.abs(diffVal) < 1 ? "var(--ink)" : diffVal > 0 ? "var(--loss)" : "var(--gain)" }}>
                    {diffVal >= 0 ? "+" : "−"}{FMT.money(Math.abs(diffVal), ccy, { compact: true })}
                  </div>
                </div>
                <div style={{ padding: 12, borderRadius: 10, background: Math.abs(moveVal) < 1 ? "var(--bg-2)" : moveVal > 0 ? "var(--gain-soft)" : "var(--loss-soft)" }}>
                  <div className="label-up" style={{ fontSize: 9 }}>{th ? "ต้องดำเนินการ" : "Action"}</div>
                  <div className="mono" style={{ fontSize: 15, fontFamily: "var(--font-display)", marginTop: 4, fontWeight: 600, color: Math.abs(moveVal) < 1 ? "var(--ink-3)" : moveVal > 0 ? "var(--gain)" : "var(--loss)" }}>
                    {Math.abs(moveVal) < 1
                      ? (th ? "ไม่ต้องทำอะไร" : "No action")
                      : (moveVal > 0 ? (th ? "ซื้อ " : "Buy ") : (th ? "ขาย " : "Sell ")) + FMT.money(Math.abs(moveVal), ccy)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
      {ai.open && (
        <AiAnalysisModal th={th}
          title={th ? "อธิบายแผน Rebalance ด้วย AI" : "AI rebalance explainer"}
          loading={ai.loading} error={ai.error} provider={ai.provider}
          history={ai.history} chatInput={ai.chatInput} chatLoading={ai.chatLoading}
          onChatInput={ai.setChatInput} onSend={ai.ask} canChat={ai.canChat}
          onClose={ai.close} onRetry={explainRebalance} />
      )}
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
