import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { PageHead, Icon, TickerLogo } from './Nav'
import { TradingViewChart } from './TradingViewChart'
import { LWChart } from './LWChart'
import { fetchHistory, fetchPrices, toYahooSymbol } from '../lib/prices'

const WATCHLIST_KEY = 'lumen_watchlist_v1'

function loadList() {
  try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]') } catch { return [] }
}
function saveList(items) {
  try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items)) } catch {}
}

// ── S/R computation ───────────────────────────────────────────────────────────
// Uses real High/Low from OHLC bars for pivot detection (falls back to close
// when h/l are null for close-only feeds like benchmark indices).
// Cluster tolerance: 2%. Falls back to rolling 30d/all-time extremes.
function computeSR(bars, current) {
  if (!bars || bars.length < 12 || !current || current <= 0) return null

  const WIN = 3
  const pivotHighs = [], pivotLows = []

  for (let i = WIN; i < bars.length - WIN; i++) {
    const hi = bars[i].h ?? bars[i].c
    const lo = bars[i].l ?? bars[i].c
    let isHigh = true, isLow = true
    for (let d = 1; d <= WIN; d++) {
      const pH = bars[i - d].h ?? bars[i - d].c
      const nH = bars[i + d].h ?? bars[i + d].c
      const pL = bars[i - d].l ?? bars[i - d].c
      const nL = bars[i + d].l ?? bars[i + d].c
      if (pH >= hi || nH >= hi) isHigh = false
      if (pL <= lo || nL <= lo) isLow  = false
    }
    if (isHigh) pivotHighs.push(hi)
    if (isLow)  pivotLows.push(lo)
  }

  const cluster = (vals, tol = 0.02) => {
    const sorted = [...vals].sort((a, b) => a - b)
    const groups = []
    for (const v of sorted) {
      const g = groups.find(g => Math.abs(g.c - v) / g.c < tol)
      if (g) { g.pts.push(v); g.c = g.pts.reduce((s, x) => s + x, 0) / g.pts.length }
      else groups.push({ c: v, pts: [v] })
    }
    return groups.sort((a, b) => b.pts.length - a.pts.length)
  }

  const toLevel = (g) => ({ price: +g.c.toFixed(4), strength: g.pts.length })

  let resistances = cluster(pivotHighs.filter(v => v > current * 1.001))
    .slice(0, 3).map(toLevel).sort((a, b) => a.price - b.price).slice(0, 2)
  let supports = cluster(pivotLows.filter(v => v < current * 0.999))
    .slice(0, 3).map(toLevel).sort((a, b) => b.price - a.price).slice(0, 2)

  // Rolling fallbacks when pivot data is insufficient
  const allH = bars.map(b => b.h ?? b.c).filter(Number.isFinite)
  const allL = bars.map(b => b.l ?? b.c).filter(Number.isFinite)
  const w30H = allH.slice(-30), w30L = allL.slice(-30)
  const fbR = [Math.max(...w30H), Math.max(...allH)].filter(v => v > current * 1.005)
  const fbS = [Math.min(...w30L), Math.min(...allL)].filter(v => v < current * 0.995)

  for (const v of fbR) {
    if (resistances.length >= 2) break
    if (!resistances.some(r => Math.abs(r.price - v) / v < 0.02))
      resistances.push({ price: +v.toFixed(4), strength: 0 })
  }
  for (const v of fbS) {
    if (supports.length >= 2) break
    if (!supports.some(s => Math.abs(s.price - v) / v < 0.02))
      supports.push({ price: +v.toFixed(4), strength: 0 })
  }

  resistances.sort((a, b) => a.price - b.price)
  supports.sort((a, b) => b.price - a.price)
  return { resistances, supports }
}

// ── Fibonacci Retracement ─────────────────────────────────────────────────────
// Uses the swing high and swing low of the entire bar series.
// Key levels: 23.6%, 38.2%, 50%, 61.8%, 78.6%
function computeFib(bars) {
  if (!bars || bars.length < 5) return null
  const highs  = bars.map(b => b.h ?? b.c).filter(Number.isFinite)
  const lows   = bars.map(b => b.l ?? b.c).filter(Number.isFinite)
  const sHigh  = Math.max(...highs)
  const sLow   = Math.min(...lows)
  const range  = sHigh - sLow
  if (range <= 0) return null
  return [0.236, 0.382, 0.5, 0.618, 0.786].map(r => ({
    ratio: r,
    price: +(sHigh - r * range).toFixed(4),
    label: `${(r * 100).toFixed(1)}%`,
  }))
}

// ── EMA (Exponential Moving Average) — adaptive periods per time frame ────────
// EMA gives more weight to recent bars → reacts faster to price changes.
// Periods scale down for shorter ranges so lines stay meaningful.
const EMA_PERIODS = {
  '1mo':  [5,  10,  20],   // ~1w / ~2w / ~1mo
  '3mo':  [10, 20,  50],   // ~2w / ~1mo / ~2.5mo
  '6mo':  [20, 50, 200],   // standard — ~1mo / ~2.5mo / ~10mo
  '1y':   [20, 50, 200],   // same as 6mo — plenty of bars for EMA200
}

// Returns both the current EMA value AND the full series [{time, value}]
// so LWChart can render proper EMA curves (not just horizontal lines).
function calcEMAFull(bars, period) {
  const valid = bars.filter(b => b.c != null && Number.isFinite(b.c) && b.c > 0)
  if (valid.length < period) return { current: null, series: [] }
  // Seed = SMA of first `period` bars
  let ema = valid.slice(0, period).reduce((s, b) => s + b.c, 0) / period
  const k = 2 / (period + 1)
  const series = [{ time: valid[period - 1].t, value: +ema.toFixed(6) }]
  for (let i = period; i < valid.length; i++) {
    ema = valid[i].c * k + ema * (1 - k)
    series.push({ time: valid[i].t, value: +ema.toFixed(6) })
  }
  return { current: +ema.toFixed(4), series }
}

function computeMAs(bars, range = '6mo') {
  const [p1, p2, p3] = EMA_PERIODS[range] || EMA_PERIODS['6mo']
  const e1 = calcEMAFull(bars, p1)
  const e2 = calcEMAFull(bars, p2)
  const e3 = calcEMAFull(bars, p3)
  return {
    ma20:  e1.current, series20:  e1.series,
    ma50:  e2.current, series50:  e2.series,
    ma200: e3.current, series200: e3.series,
    p1, p2, p3,
  }
}

// ── Previous Week / Month High & Low ─────────────────────────────────────────
function computePrevHL(bars) {
  if (!bars || bars.length < 10) return null
  const now = new Date()
  const dow = now.getDay() || 7  // 1=Mon … 7=Sun
  const lastMon = new Date(now); lastMon.setDate(now.getDate() - dow - 6); lastMon.setHours(0, 0, 0, 0)
  const lastSun = new Date(lastMon); lastSun.setDate(lastMon.getDate() + 6); lastSun.setHours(23, 59, 59, 0)
  const pmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const pmEnd   = new Date(now.getFullYear(), now.getMonth(), 0); pmEnd.setHours(23, 59, 59, 0)

  const wk = bars.filter(b => { const t = b.t * 1000; return t >= lastMon && t <= lastSun })
  const mo = bars.filter(b => { const t = b.t * 1000; return t >= pmStart && t <= pmEnd })

  const r = {}
  if (wk.length >= 2) {
    r.pwh = Math.max(...wk.map(b => b.h ?? b.c))
    r.pwl = Math.min(...wk.map(b => b.l ?? b.c))
  }
  if (mo.length >= 5) {
    r.pmh = Math.max(...mo.map(b => b.h ?? b.c))
    r.pml = Math.min(...mo.map(b => b.l ?? b.c))
  }
  return Object.keys(r).length ? r : null
}

// ── Round / Psychological Levels ──────────────────────────────────────────────
function computeRoundLevels(price, n = 3) {
  if (!price || price <= 0) return []
  const inc = price >= 5000 ? 500 : price >= 1000 ? 100 : price >= 500 ? 50
    : price >= 100 ? 10 : price >= 50 ? 5 : price >= 10 ? 1 : price >= 1 ? 0.5 : 0.1
  const base = Math.round(price / inc) * inc
  const lvls = []
  for (let i = -n; i <= n; i++) {
    const v = +(base + i * inc).toFixed(8)
    if (v > 0 && Math.abs(v - price) / price > 0.005) lvls.push(v)
  }
  return lvls.sort((a, b) => a - b)
}

// ── VWAP (Volume-Weighted Average Price) ──────────────────────────────────────
function computeVWAP(bars) {
  const valid = (bars || []).filter(b => b.v > 0 && Number.isFinite(b.v) && Number.isFinite(b.c))
  if (valid.length < 2) return null
  let sumTPV = 0, sumV = 0
  for (const b of valid) {
    sumTPV += ((b.h ?? b.c) + (b.l ?? b.c) + b.c) / 3 * b.v
    sumV   += b.v
  }
  return sumV > 0 ? +(sumTPV / sumV).toFixed(4) : null
}

// ── Bollinger Bands (SMA20 ± 2σ) ─────────────────────────────────────────────
function computeBB(bars) {
  const closes = (bars || []).map(b => b.c).filter(v => Number.isFinite(v) && v > 0)
  if (closes.length < 20) return null
  const recent = closes.slice(-20)
  const mean = recent.reduce((s, c) => s + c, 0) / 20
  const sd = Math.sqrt(recent.reduce((s, c) => s + (c - mean) ** 2, 0) / 20)
  return { upper: +(mean + 2 * sd).toFixed(4), lower: +(mean - 2 * sd).toFixed(4) }
}

// ── Volume Profile — Point of Control (POC) ───────────────────────────────────
// Divides the price range into BUCKETS equal-width buckets, distributes each
// bar's volume proportionally across the buckets it spans (by wick), then finds
// the POC (bucket with the highest traded volume).
function computeVolProfile(bars, BUCKETS = 24) {
  const valid = bars.filter(b => b.h && b.l && b.v != null && b.v > 0 &&
                                  Number.isFinite(b.h) && Number.isFinite(b.l))
  if (valid.length < 5) return null
  const lo   = Math.min(...valid.map(b => b.l))
  const hi   = Math.max(...valid.map(b => b.h))
  const span = hi - lo
  if (span <= 0) return null

  const bSz = span / BUCKETS
  const vol = Array(BUCKETS).fill(0)

  for (const bar of valid) {
    const barSpan = bar.h - bar.l || 0.001
    for (let i = 0; i < BUCKETS; i++) {
      const bLo = lo + i * bSz, bHi = bLo + bSz
      const overlap = Math.max(0, Math.min(bar.h, bHi) - Math.max(bar.l, bLo))
      vol[i] += bar.v * (overlap / barSpan)
    }
  }

  const pocIdx = vol.indexOf(Math.max(...vol))
  const poc    = +(lo + (pocIdx + 0.5) * bSz).toFixed(4)

  // Value Area High / Low: expand from POC until 70% of total volume is covered
  const totalVol = vol.reduce((s, v) => s + v, 0)
  const target   = totalVol * 0.70
  let loI = pocIdx, hiI = pocIdx, covered = vol[pocIdx]
  while (covered < target && (loI > 0 || hiI < BUCKETS - 1)) {
    const addL = loI > 0          ? vol[loI - 1] : 0
    const addH = hiI < BUCKETS - 1 ? vol[hiI + 1] : 0
    if (addH >= addL && hiI < BUCKETS - 1) { hiI++; covered += addH }
    else if (loI > 0)                       { loI--; covered += addL }
    else break
  }
  return {
    poc,
    vah: +(lo + (hiI + 1) * bSz).toFixed(4),  // Value Area High
    val: +(lo + loI * bSz).toFixed(4),         // Value Area Low
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtPrice(price, currency) {
  if (price == null || isNaN(price)) return '—'
  const prefix = currency === 'THB' ? '฿' : '$'
  const dp = price < 1 ? 6 : price < 10 ? 4 : price < 1000 ? 2 : 0
  return prefix + price.toLocaleString('en', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

function distPct(level, current) {
  if (!current) return ''
  const d = ((level - current) / current) * 100
  return (d > 0 ? '+' : '') + d.toFixed(1) + '%'
}

// ── Strength dots (max 5) ─────────────────────────────────────────────────────
function StrengthDots({ count, color }) {
  const filled = Math.min(count, 5)
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%',
          background: i < filled ? color : 'var(--line)',
          flexShrink: 0,
        }} />
      ))}
    </span>
  )
}

// ── S/R Ladder display ────────────────────────────────────────────────────────
function SRLadder({ sr, livePrice, currency }) {
  if (!sr) return null

  const rowStyle = (isRes) => ({
    display: 'grid',
    gridTemplateColumns: '32px 60px 1fr auto',
    alignItems: 'center',
    gap: 8,
    padding: '5px 0',
    color: isRes ? 'var(--loss)' : 'var(--gain)',
    fontSize: 12,
  })

  // Render resistances from highest (R2) to lowest (R1) so R1 is closest to NOW line
  const rLevels = [...sr.resistances].reverse()
  const sLevels = sr.supports   // already sorted: S1 closest, S2 furthest

  return (
    <div style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', padding: '8px 0', margin: '12px 0' }}>
      {rLevels.map((lvl, i) => {
        const label = `R${rLevels.length - i}`
        return (
          <div key={label} style={rowStyle(true)}>
            <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.04em' }}>{label}</span>
            <StrengthDots count={lvl.strength} color="var(--loss)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtPrice(lvl.price, currency)}</span>
            <span style={{ fontSize: 10, opacity: 0.65, fontFamily: 'var(--font-mono)' }}>{distPct(lvl.price, livePrice)}</span>
          </div>
        )
      })}

      {/* Current price */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 0',
        borderTop: '1px dashed var(--line)', borderBottom: '1px dashed var(--line)',
        margin: '3px 0',
      }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.04em', minWidth: 32 }}>NOW</span>
        <span style={{ flex: 1, height: 1, background: 'var(--accent)', opacity: 0.35 }} />
        <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>
          {fmtPrice(livePrice, currency)}
        </span>
      </div>

      {sLevels.map((lvl, i) => (
        <div key={`S${i + 1}`} style={rowStyle(false)}>
          <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.04em' }}>S{i + 1}</span>
          <StrengthDots count={lvl.strength} color="var(--gain)" />
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtPrice(lvl.price, currency)}</span>
          <span style={{ fontSize: 10, opacity: 0.65, fontFamily: 'var(--font-mono)' }}>{distPct(lvl.price, livePrice)}</span>
        </div>
      ))}
    </div>
  )
}

const CHART_RANGES = ['1mo', '3mo', '6mo', '1y']
const RANGE_LABEL  = { '1mo': '1M', '3mo': '3M', '6mo': '6M', '1y': '1Y' }

// ── Watchlist card ────────────────────────────────────────────────────────────
function WatchlistCard({ item, priceData, sr, onRemove, onNoteChange, showChart, onToggleChart, onExpand, lang }) {
  const th = lang === 'th'
  const livePrice = priceData?.price ?? null
  const changePct = priceData?.changePct ?? 0
  const currency  = priceData?.currency ?? (item.region === 'TH' ? 'THB' : 'USD')
  const gain = changePct > 0, loss = changePct < 0

  // ── Chart-specific state (self-contained in the card) ──────────────────────
  const [chartMode,    setChartMode]    = useState('sr')   // 'sr' | 'tv'
  const [chartRange,   setChartRange]   = useState('6mo')
  const [chartBars,    setChartBars]    = useState(null)   // [{t,o,h,l,c,v}]
  const [loadingChart, setLoadingChart] = useState(false)
  const [overlays, setOverlays] = useState({ fib: false, ma: false, vp: false, prevhl: false, round: false, vwap: false, bb: false })
  const toggleOverlay = (key) => setOverlays(prev => ({ ...prev, [key]: !prev[key] }))

  // Fetch OHLC history when chart opens or range changes
  useEffect(() => {
    if (!showChart || chartMode !== 'sr') return
    const sym = toYahooSymbol(item.symbol, item.region || 'US', item.cls || 'Equity')
    let cancelled = false
    setLoadingChart(true)
    fetchHistory(sym, chartRange)
      .then(({ series }) => {
        if (cancelled) return
        const bars = series.filter(p => p.c != null && Number.isFinite(p.c) && p.c > 0)
        setChartBars(bars.length >= 5 ? bars : null)
      })
      .catch(() => { if (!cancelled) setChartBars(null) })
      .finally(() => { if (!cancelled) setLoadingChart(false) })
    return () => { cancelled = true }
  }, [showChart, chartMode, chartRange, item.symbol, item.region, item.cls])

  // Reset state when card is collapsed
  useEffect(() => {
    if (!showChart) { setChartMode('sr'); setOverlays({ fib: false, ma: false, vp: false, prevhl: false, round: false, vwap: false, bb: false }) }
  }, [showChart])

  // ── Compute overlays from chartBars ────────────────────────────────────────
  const chartSR     = useMemo(() => chartBars && livePrice ? computeSR(chartBars, livePrice) : null, [chartBars, livePrice])
  const chartFib    = useMemo(() => overlays.fib    && chartBars ? computeFib(chartBars) : null, [chartBars, overlays.fib])
  const chartMAs    = useMemo(() => overlays.ma     && chartBars ? computeMAs(chartBars, chartRange) : null, [chartBars, overlays.ma, chartRange])
  const chartVP     = useMemo(() => overlays.vp     && chartBars ? computeVolProfile(chartBars) : null, [chartBars, overlays.vp])
  const chartPrevHL = useMemo(() => overlays.prevhl && chartBars ? computePrevHL(chartBars) : null, [chartBars, overlays.prevhl])
  const chartRound  = useMemo(() => overlays.round  && chartBars && livePrice ? computeRoundLevels(livePrice) : [], [livePrice, overlays.round])
  const chartVWAP   = useMemo(() => overlays.vwap   && chartBars ? computeVWAP(chartBars) : null, [chartBars, overlays.vwap])
  const chartBBands = useMemo(() => overlays.bb     && chartBars ? computeBB(chartBars) : null, [chartBars, overlays.bb])

  // Clean ticker for TradingView: BTC-USD → BTC
  const tvTicker = item.cls === 'Crypto'
    ? item.symbol.replace(/[-/](USD|USDT|USDC|BTC|ETH)$/i, '')
    : item.symbol

  // ── Build EMA overlay curves for LWChart ─────────────────────────────────
  const emaLines = (overlays.ma && chartMAs) ? [
    chartMAs.series20?.length  ? { data: chartMAs.series20,  label: `EMA${chartMAs.p1}` } : null,
    chartMAs.series50?.length  ? { data: chartMAs.series50,  label: `EMA${chartMAs.p2}` } : null,
    chartMAs.series200?.length ? { data: chartMAs.series200, label: `EMA${chartMAs.p3}` } : null,
  ].filter(Boolean) : []

  // ── Build combined hLines: S/R + optional Fib / Volume Profile ───────────
  // (EMA is rendered as full curves via emaLines — not horizontal price lines)
  const displaySR = chartSR ?? sr   // prefer OHLC-based SR from chart range; fall back to parent's
  const hLines = [
    // S/R pivot lines (always shown when available)
    ...(displaySR ? [
      ...displaySR.resistances.map((lvl, i) => ({
        y: lvl.price, color: 'var(--loss)',
        label: `R${i + 1}`,
      })),
      ...displaySR.supports.map((lvl, i) => ({
        y: lvl.price, color: 'var(--gain)',
        label: `S${i + 1}`,
      })),
    ] : []),

    // Fibonacci retracement levels
    ...(chartFib ? chartFib.map(lvl => ({
      y: lvl.price, color: 'oklch(0.65 0.14 55)',
      label: `Fib ${lvl.label}`,
    })) : []),

    // EMA is rendered as full curves via emaLines prop — not horizontal price lines

    // Volume Profile levels
    ...(chartVP ? [
      { y: chartVP.poc, color: 'oklch(0.65 0.16 90)', label: 'POC' },
      { y: chartVP.vah, color: 'oklch(0.65 0.10 90)', label: 'VAH' },
      { y: chartVP.val, color: 'oklch(0.65 0.10 90)', label: 'VAL' },
    ] : []),

    // Previous Week / Month High & Low
    ...(chartPrevHL ? [
      chartPrevHL.pwh && { y: chartPrevHL.pwh, color: 'oklch(0.68 0.14 55)', label: 'PWH' },
      chartPrevHL.pwl && { y: chartPrevHL.pwl, color: 'oklch(0.68 0.14 55)', label: 'PWL' },
      chartPrevHL.pmh && { y: chartPrevHL.pmh, color: 'oklch(0.58 0.16 55)', label: 'PMH' },
      chartPrevHL.pml && { y: chartPrevHL.pml, color: 'oklch(0.58 0.16 55)', label: 'PML' },
    ].filter(Boolean) : []),

    // Round / Psychological levels
    ...chartRound.map(v => ({ y: v, color: 'oklch(0.60 0.04 0)', label: String(v) })),

    // VWAP
    ...(chartVWAP != null ? [{ y: chartVWAP, color: 'oklch(0.62 0.14 195)', label: 'VWAP' }] : []),

    // Bollinger Bands ±2σ
    ...(chartBBands ? [
      { y: chartBBands.upper, color: 'oklch(0.58 0.12 290)', label: 'BB+' },
      { y: chartBBands.lower, color: 'oklch(0.58 0.12 290)', label: 'BB−' },
    ] : []),
  ]

  return (
    <div style={{
      background: 'var(--bg)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* ── Card body ─────────────────────────────────────── */}
      <div style={{ padding: 'var(--pad-card)', flex: 1 }}>

        {/* Header row: logo + ticker + name + remove */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <TickerLogo ticker={item.symbol} region={item.region} cls={item.cls} size={38} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>{item.symbol}</span>
              <span style={{
                fontSize: 9, padding: '2px 6px', borderRadius: 99, fontWeight: 700, letterSpacing: '0.04em',
                background: item.region === 'TH' ? 'oklch(0.94 0.04 200)'
                           : item.cls === 'Crypto' ? 'oklch(0.94 0.06 65)'
                           : 'oklch(0.94 0.04 250)',
                color: 'var(--ink-2)',
              }}>
                {item.region === 'TH' ? 'TH' : item.cls === 'Crypto' ? 'CRYPTO' : 'US'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.name}
            </div>
          </div>
          <button onClick={onRemove}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 4, borderRadius: 6, flexShrink: 0, lineHeight: 0 }}
            title={th ? 'นำออก' : 'Remove'}>
            <Icon name="trash" size={14} />
          </button>
        </div>

        {/* Live price */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          {livePrice != null ? (
            <>
              <span style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
                {fmtPrice(livePrice, currency)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: gain ? 'var(--gain)' : loss ? 'var(--loss)' : 'var(--ink-3)' }}>
                {gain ? '+' : ''}{changePct.toFixed(2)}%
              </span>
            </>
          ) : (
            <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>
              {th ? 'กำลังโหลด…' : 'Loading…'}
            </span>
          )}
        </div>

        {/* S/R Ladder */}
        {livePrice != null && (
          sr
            ? <SRLadder sr={sr} livePrice={livePrice} currency={currency} />
            : (
              <div style={{ fontSize: 11, color: 'var(--ink-3)', padding: '8px 0', borderTop: '1px solid var(--line)', marginBottom: 10 }}>
                {th ? '⏳ คำนวณแนวรับ-แนวต้าน…' : '⏳ Computing S/R levels…'}
              </div>
            )
        )}

        {/* Note input */}
        <input
          value={item.note || ''}
          onChange={e => onNoteChange(e.target.value)}
          placeholder={th ? '📝 บันทึก (เช่น รอ Pullback ที่ S1)' : '📝 Note (e.g. wait for S1 pullback)'}
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 12,
            border: '1px solid var(--line)', background: 'var(--bg-2)', color: 'var(--ink)',
            outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* ── Chart toggle button ───────────────────────────── */}
      <div style={{ borderTop: '1px solid var(--line)', padding: '10px var(--pad-card)' }}>
        <button onClick={onToggleChart}
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            border: '1.5px solid var(--line)',
            background: showChart ? 'var(--ink)' : 'var(--bg-2)',
            color: showChart ? 'var(--bg)' : 'var(--ink)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
          <Icon name="chart" size={13} />
          {th
            ? (showChart ? 'ปิดกราฟ' : 'ดูกราฟ + แนวรับ/ต้าน')
            : (showChart ? 'Close chart' : 'View chart with S/R')}
        </button>
      </div>

      {/* ── Expanded chart area ───────────────────────────── */}
      {showChart && (
        <div style={{ padding: '0 var(--pad-card) var(--pad-card)' }}>

          {/* Mode toggle: S/R Chart ↔ TradingView + Expand button */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center' }}>
            <button onClick={() => setChartMode('sr')} style={{
              flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: '1.5px solid var(--line)',
              background: chartMode === 'sr' ? 'var(--accent)' : 'var(--bg-2)',
              color: chartMode === 'sr' ? '#fff' : 'var(--ink)',
            }}>
              📈 {th ? 'กราฟ + แนวรับ/ต้าน' : 'S/R Chart'}
            </button>
            <button onClick={() => setChartMode('tv')} style={{
              flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: '1.5px solid var(--line)',
              background: chartMode === 'tv' ? 'var(--ink)' : 'var(--bg-2)',
              color: chartMode === 'tv' ? 'var(--bg)' : 'var(--ink)',
            }}>
              📊 TradingView
            </button>
            {/* Fullscreen / expand button */}
            <button onClick={() => onExpand && onExpand()} title={th ? 'เต็มหน้าจอ' : 'Full screen'}
              style={{ padding: '7px 9px', borderRadius: 8, border: '1.5px solid var(--line)', background: 'var(--bg-2)', color: 'var(--ink-2)', cursor: 'pointer', flexShrink: 0, lineHeight: 0 }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              </svg>
            </button>
          </div>

          {/* ── S/R Chart mode ─────────────────────────────── */}
          {chartMode === 'sr' && (
            <>
              {/* Range selector + overlay toggles */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {CHART_RANGES.map(r => (
                  <button key={r} onClick={() => setChartRange(r)} style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: '1px solid var(--line)',
                    background: chartRange === r ? 'var(--ink)' : 'transparent',
                    color: chartRange === r ? 'var(--bg)' : 'var(--ink-2)',
                  }}>
                    {RANGE_LABEL[r]}
                  </button>
                ))}
                {loadingChart && <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 2 }}>…</span>}
              </div>

              {/* Overlay toggles */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--ink-3)', marginRight: 2 }}>Overlay:</span>
                {[
                  { key: 'fib',    label: 'Fibonacci',  color: 'oklch(0.65 0.14 55)'  },
                  { key: 'ma',     label: 'EMA',         color: 'oklch(0.50 0.12 250)' },
                  { key: 'vp',     label: 'Vol Profile', color: 'oklch(0.60 0.14 90)'  },
                  { key: 'prevhl', label: 'Prev H/L',    color: 'oklch(0.65 0.14 55)'  },
                  { key: 'round',  label: 'Round $',     color: 'oklch(0.55 0.04 0)'   },
                  { key: 'vwap',   label: 'VWAP',        color: 'oklch(0.62 0.14 195)' },
                  { key: 'bb',     label: 'BB ±2σ',      color: 'oklch(0.58 0.12 290)' },
                ].map(o => (
                  <button key={o.key} onClick={() => toggleOverlay(o.key)} style={{
                    padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    border: `1.5px solid ${overlays[o.key] ? o.color : 'var(--line)'}`,
                    background: overlays[o.key] ? o.color + '22' : 'transparent',
                    color: overlays[o.key] ? o.color : 'var(--ink-3)',
                    transition: 'all 0.15s',
                  }}>
                    {o.label}
                  </button>
                ))}
              </div>

              {/* Chart */}
              {chartBars ? (
                <div style={{ background: 'var(--bg-2)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }}>
                  <LWChart
                    bars={chartBars}
                    hLines={hLines}
                    emaLines={emaLines}
                    height={240}
                    showVolume={true}
                  />
                </div>
              ) : loadingChart ? (
                <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
                  {th ? 'กำลังโหลดกราฟ…' : 'Loading chart…'}
                </div>
              ) : (
                <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
                  {th ? 'ไม่มีข้อมูลราคาย้อนหลัง' : 'No historical price data available'}
                </div>
              )}

              {/* Legend */}
              <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                {displaySR && <>
                  {displaySR.resistances.map((lvl, i) => (
                    <span key={`r${i}`} style={{ fontSize: 10, color: 'var(--loss)', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)' }}>
                      <span style={{ width: 12, borderTop: '2px dashed var(--loss)', display: 'inline-block' }} />
                      R{i + 1} {fmtPrice(lvl.price, currency)} <StrengthDots count={lvl.strength} color="var(--loss)" />
                    </span>
                  ))}
                  {displaySR.supports.map((lvl, i) => (
                    <span key={`s${i}`} style={{ fontSize: 10, color: 'var(--gain)', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)' }}>
                      <span style={{ width: 12, borderTop: '2px dashed var(--gain)', display: 'inline-block' }} />
                      S{i + 1} {fmtPrice(lvl.price, currency)} <StrengthDots count={lvl.strength} color="var(--gain)" />
                    </span>
                  ))}
                </>}
                {chartMAs && overlays.ma && [
                  chartMAs.ma20  && { label: `EMA${chartMAs.p1}`,  color: 'oklch(0.60 0.14 300)', val: chartMAs.ma20  },
                  chartMAs.ma50  && { label: `EMA${chartMAs.p2}`,  color: 'oklch(0.50 0.12 250)', val: chartMAs.ma50  },
                  chartMAs.ma200 && { label: `EMA${chartMAs.p3}`,  color: 'oklch(0.45 0.08 220)', val: chartMAs.ma200 },
                ].filter(Boolean).map(m => (
                  <span key={m.label} style={{ fontSize: 10, color: m.color, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)' }}>
                    <span style={{ width: 12, borderTop: `2px dashed ${m.color}`, display: 'inline-block' }} />
                    {m.label} {fmtPrice(m.val, currency)}
                  </span>
                ))}
                {chartVP && overlays.vp && (
                  <span style={{ fontSize: 10, color: 'oklch(0.65 0.16 90)', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)' }}>
                    <span style={{ width: 12, borderTop: '2px dashed oklch(0.65 0.16 90)', display: 'inline-block' }} />
                    POC {fmtPrice(chartVP.poc, currency)}
                  </span>
                )}
              </div>

              <p style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--ink-3)' }}>
                {th
                  ? '● = pivot touches (OHLC High/Low) · Fib = swing H→L retracement · POC = ราคาที่ trade มากที่สุด'
                  : '● = OHLC pivot touches · Fib = swing H→L retracement · POC = highest-volume price'}
              </p>
            </>
          )}

          {/* ── TradingView mode ───────────────────────────── */}
          {chartMode === 'tv' && (
            item.region === 'TH' ? (
              // SET stocks not supported in free TradingView embed — show link instead
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                  {th
                    ? 'TradingView embed ไม่รองรับหุ้น SET ในแผน free — เปิดดูบน TradingView ได้เลย'
                    : 'TradingView embed requires a paid plan for SET stocks — open the full chart in a new tab'}
                </div>
                <a href={`https://www.tradingview.com/chart/?symbol=SET%3A${encodeURIComponent(item.symbol)}`}
                  target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                  <button className="btn" style={{ fontSize: 12, padding: '8px 20px' }}>
                    {th ? 'เปิด TradingView ↗' : 'Open TradingView ↗'}
                  </button>
                </a>
              </div>
            ) : (
              <>
                <TradingViewChart ticker={tvTicker} region={item.region} height={420} />
                <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--ink-3)', textAlign: 'center' }}>
                  {th
                    ? 'TradingView — ใช้เครื่องมือวาดเส้น Fibonacci, แนวรับ/ต้าน, indicator ได้เลย'
                    : 'TradingView — draw Fibonacci, trendlines, and indicators directly on the chart'}
                </p>
              </>
            )
          )}
        </div>
      )}
    </div>
  )
}

// ── Fullscreen chart overlay ────────────────────────────────────────────────
// Rendered at WatchlistPage level (NOT inside card) to avoid createPortal issues.
// position:fixed sits over everything without needing a portal.
function WatchlistFullscreen({ item, priceData, sr, lang, onClose }) {
  const th = lang === 'th'
  const livePrice = priceData?.price ?? null
  const changePct = priceData?.changePct ?? 0
  const currency  = priceData?.currency ?? (item.region === 'TH' ? 'THB' : 'USD')
  const gain = changePct > 0, loss = changePct < 0

  const [chartMode,    setChartMode]    = useState('sr')
  const [chartRange,   setChartRange]   = useState('6mo')
  const [chartBars,    setChartBars]    = useState(null)
  const [loadingChart, setLoadingChart] = useState(false)
  const [overlays, setOverlays] = useState({ fib: false, ma: false, vp: false, prevhl: false, round: false, vwap: false, bb: false })
  const toggleOL = (key) => setOverlays(prev => ({ ...prev, [key]: !prev[key] }))

  // Escape to close
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  // Prevent background scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Fetch OHLC history
  useEffect(() => {
    if (chartMode !== 'sr') return
    const sym = toYahooSymbol(item.symbol, item.region || 'US', item.cls || 'Equity')
    let cancelled = false
    setLoadingChart(true)
    fetchHistory(sym, chartRange)
      .then(({ series }) => {
        if (cancelled) return
        const bars = series.filter(p => p.c != null && Number.isFinite(p.c) && p.c > 0)
        setChartBars(bars.length >= 5 ? bars : null)
      })
      .catch(() => { if (!cancelled) setChartBars(null) })
      .finally(() => { if (!cancelled) setLoadingChart(false) })
    return () => { cancelled = true }
  }, [chartMode, chartRange, item.symbol, item.region, item.cls])

  const chartSR     = useMemo(() => chartBars && livePrice ? computeSR(chartBars, livePrice) : null, [chartBars, livePrice])
  const chartFib    = useMemo(() => overlays.fib    && chartBars ? computeFib(chartBars) : null, [chartBars, overlays.fib])
  const chartMAs    = useMemo(() => overlays.ma     && chartBars ? computeMAs(chartBars, chartRange) : null, [chartBars, overlays.ma, chartRange])
  const chartVP     = useMemo(() => overlays.vp     && chartBars ? computeVolProfile(chartBars) : null, [chartBars, overlays.vp])
  const chartPrevHL = useMemo(() => overlays.prevhl && chartBars ? computePrevHL(chartBars) : null, [chartBars, overlays.prevhl])
  const chartRound  = useMemo(() => overlays.round  && chartBars && livePrice ? computeRoundLevels(livePrice) : [], [livePrice, overlays.round])
  const chartVWAP   = useMemo(() => overlays.vwap   && chartBars ? computeVWAP(chartBars) : null, [chartBars, overlays.vwap])
  const chartBBands = useMemo(() => overlays.bb     && chartBars ? computeBB(chartBars) : null, [chartBars, overlays.bb])

  const displaySR = chartSR ?? sr

  const emaLines = (overlays.ma && chartMAs) ? [
    chartMAs.series20?.length  ? { data: chartMAs.series20,  label: `EMA${chartMAs.p1}` } : null,
    chartMAs.series50?.length  ? { data: chartMAs.series50,  label: `EMA${chartMAs.p2}` } : null,
    chartMAs.series200?.length ? { data: chartMAs.series200, label: `EMA${chartMAs.p3}` } : null,
  ].filter(Boolean) : []

  const hLines = [
    ...(displaySR ? [
      ...displaySR.resistances.map((lvl, i) => ({ y: lvl.price, color: 'var(--loss)', label: `R${i+1}` })),
      ...displaySR.supports.map((lvl, i)    => ({ y: lvl.price, color: 'var(--gain)', label: `S${i+1}` })),
    ] : []),
    ...(chartFib ? chartFib.map(lvl => ({ y: lvl.price, color: 'oklch(0.65 0.14 55)', label: `Fib ${lvl.label}` })) : []),
    ...(chartVP ? [
      { y: chartVP.poc, color: 'oklch(0.65 0.16 90)', label: 'POC' },
      { y: chartVP.vah, color: 'oklch(0.65 0.10 90)', label: 'VAH' },
      { y: chartVP.val, color: 'oklch(0.65 0.10 90)', label: 'VAL' },
    ] : []),
    ...(chartPrevHL ? [
      chartPrevHL.pwh && { y: chartPrevHL.pwh, color: 'oklch(0.68 0.14 55)', label: 'PWH' },
      chartPrevHL.pwl && { y: chartPrevHL.pwl, color: 'oklch(0.68 0.14 55)', label: 'PWL' },
      chartPrevHL.pmh && { y: chartPrevHL.pmh, color: 'oklch(0.58 0.16 55)', label: 'PMH' },
      chartPrevHL.pml && { y: chartPrevHL.pml, color: 'oklch(0.58 0.16 55)', label: 'PML' },
    ].filter(Boolean) : []),
    ...chartRound.map(v => ({ y: v, color: 'oklch(0.60 0.04 0)', label: String(v) })),
    ...(chartVWAP != null ? [{ y: chartVWAP, color: 'oklch(0.62 0.14 195)', label: 'VWAP' }] : []),
    ...(chartBBands ? [
      { y: chartBBands.upper, color: 'oklch(0.58 0.12 290)', label: 'BB+' },
      { y: chartBBands.lower, color: 'oklch(0.58 0.12 290)', label: 'BB−' },
    ] : []),
  ]

  const tvTicker = item.cls === 'Crypto'
    ? item.symbol.replace(/[-/](USD|USDT|USDC|BTC|ETH)$/i, '')
    : item.symbol

  const fsH = typeof window !== 'undefined' ? Math.max(380, window.innerHeight - 280) : 480

  const OVERLAYS_DEF = [
    { key: 'fib',    label: 'Fibonacci',  color: 'oklch(0.65 0.14 55)'  },
    { key: 'ma',     label: 'EMA',        color: 'oklch(0.50 0.12 250)' },
    { key: 'vp',     label: 'Vol Profile',color: 'oklch(0.60 0.14 90)'  },
    { key: 'prevhl', label: 'Prev H/L',   color: 'oklch(0.65 0.14 55)'  },
    { key: 'round',  label: 'Round $',    color: 'oklch(0.55 0.04 0)'   },
    { key: 'vwap',   label: 'VWAP',       color: 'oklch(0.62 0.14 195)' },
    { key: 'bb',     label: 'BB ±2σ',     color: 'oklch(0.58 0.12 290)' },
  ]

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}>
      <div style={{
        background: 'var(--bg)', borderRadius: 18,
        width: '100%', maxWidth: 1120, maxHeight: '95vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
      }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <TickerLogo ticker={item.symbol} region={item.region} cls={item.cls} size={30} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{item.symbol}</span>
            <span style={{ marginLeft: 8, color: 'var(--ink-2)', fontSize: 12 }}>{item.name}</span>
          </div>
          {livePrice != null && (
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 17 }}>
              {fmtPrice(livePrice, currency)}{' '}
              <span style={{ fontSize: 12, color: gain ? 'var(--gain)' : loss ? 'var(--loss)' : 'var(--ink-3)' }}>
                {gain ? '+' : ''}{changePct.toFixed(2)}%
              </span>
            </span>
          )}
          <div style={{ display: 'flex', gap: 5 }}>
            {[['sr', '📈 S/R'], ['tv', '📊 TradingView']].map(([m, lbl]) => (
              <button key={m} onClick={() => setChartMode(m)} style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                border: '1.5px solid var(--line)',
                background: chartMode === m ? (m === 'sr' ? 'var(--accent)' : 'var(--ink)') : 'var(--bg-2)',
                color: chartMode === m ? (m === 'sr' ? '#fff' : 'var(--bg)') : 'var(--ink)',
              }}>{lbl}</button>
            ))}
          </div>
          <button onClick={onClose} style={{ padding: 8, borderRadius: 8, border: '1.5px solid var(--line)', background: 'var(--bg-2)', color: 'var(--ink)', cursor: 'pointer', lineHeight: 0, flexShrink: 0 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '14px 20px 20px' }}>

          {chartMode === 'sr' && (
            <>
              {/* Range + Overlays */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {CHART_RANGES.map(r => (
                  <button key={r} onClick={() => setChartRange(r)} style={{
                    padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: '1px solid var(--line)',
                    background: chartRange === r ? 'var(--ink)' : 'transparent',
                    color: chartRange === r ? 'var(--bg)' : 'var(--ink-2)',
                  }}>{RANGE_LABEL[r]}</button>
                ))}
                {loadingChart && <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 4 }}>…</span>}
                <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--ink-3)' }}>Overlay:</span>
                {OVERLAYS_DEF.map(o => (
                  <button key={o.key} onClick={() => toggleOL(o.key)} style={{
                    padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    border: `1.5px solid ${overlays[o.key] ? o.color : 'var(--line)'}`,
                    background: overlays[o.key] ? o.color + '22' : 'transparent',
                    color: overlays[o.key] ? o.color : 'var(--ink-3)',
                  }}>{o.label}</button>
                ))}
              </div>

              {chartBars ? (
                <div style={{ background: 'var(--bg-2)', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }}>
                  <LWChart
                    bars={chartBars}
                    hLines={hLines}
                    emaLines={emaLines}
                    height={fsH}
                    showVolume={true}
                  />
                </div>
              ) : loadingChart ? (
                <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}>
                  {th ? 'กำลังโหลดกราฟ…' : 'Loading chart…'}
                </div>
              ) : (
                <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)' }}>
                  {th ? 'ไม่มีข้อมูล' : 'No data available'}
                </div>
              )}

              {/* Legend */}
              <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                {displaySR && displaySR.resistances.map((lvl, i) => (
                  <span key={`r${i}`} style={{ fontSize: 11, color: 'var(--loss)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)' }}>
                    <span style={{ width: 14, borderTop: '2px dashed var(--loss)', display: 'inline-block' }} />
                    R{i+1} {fmtPrice(lvl.price, currency)} <StrengthDots count={lvl.strength} color="var(--loss)" />
                  </span>
                ))}
                {displaySR && displaySR.supports.map((lvl, i) => (
                  <span key={`s${i}`} style={{ fontSize: 11, color: 'var(--gain)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)' }}>
                    <span style={{ width: 14, borderTop: '2px dashed var(--gain)', display: 'inline-block' }} />
                    S{i+1} {fmtPrice(lvl.price, currency)} <StrengthDots count={lvl.strength} color="var(--gain)" />
                  </span>
                ))}
                {chartMAs && overlays.ma && chartMAs.ma20  != null && <span style={{ fontSize: 11, color: 'oklch(0.60 0.14 300)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)' }}><span style={{ width: 14, borderTop: '2px dashed oklch(0.60 0.14 300)', display: 'inline-block' }} />EMA{chartMAs.p1} {fmtPrice(chartMAs.ma20, currency)}</span>}
                {chartMAs && overlays.ma && chartMAs.ma50  != null && <span style={{ fontSize: 11, color: 'oklch(0.50 0.12 250)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)' }}><span style={{ width: 14, borderTop: '2px dashed oklch(0.50 0.12 250)', display: 'inline-block' }} />EMA{chartMAs.p2} {fmtPrice(chartMAs.ma50, currency)}</span>}
                {chartMAs && overlays.ma && chartMAs.ma200 != null && <span style={{ fontSize: 11, color: 'oklch(0.45 0.08 220)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)' }}><span style={{ width: 14, borderTop: '2px dashed oklch(0.45 0.08 220)', display: 'inline-block' }} />EMA{chartMAs.p3} {fmtPrice(chartMAs.ma200, currency)}</span>}
                {chartVP && overlays.vp && chartVP.poc != null && <span style={{ fontSize: 11, color: 'oklch(0.65 0.16 90)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)' }}><span style={{ width: 14, borderTop: '2px dashed oklch(0.65 0.16 90)', display: 'inline-block' }} />POC {fmtPrice(chartVP.poc, currency)}</span>}
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 10, color: 'var(--ink-3)' }}>
                {th ? '● = OHLC pivot · Fib = swing H→L · POC = ราคาที่ trade มากที่สุด' : '● = OHLC pivot · Fib = swing H→L retracement · POC = highest-volume price'}
              </p>
            </>
          )}

          {chartMode === 'tv' && (
            item.region === 'TH' ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 280, gap: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 36 }}>📊</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {th ? 'TradingView Embed ไม่รองรับหุ้น SET' : 'TradingView embed does not support SET stocks'}
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)', maxWidth: 340 }}>
                  {th ? 'เปิดดูบน TradingView โดยตรงได้เลย' : 'Open the full chart directly on TradingView.'}
                </p>
                <a href={`https://www.tradingview.com/chart/?symbol=SET%3A${encodeURIComponent(item.symbol)}`}
                  target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                  <button className="btn" style={{ padding: '10px 24px', fontSize: 14 }}>
                    {th ? 'เปิด TradingView ↗' : 'Open TradingView ↗'}
                  </button>
                </a>
              </div>
            ) : (
              <TradingViewChart ticker={tvTicker} region={item.region} height={fsH} />
            )
          )}

        </div>
      </div>
    </div>
  )
}

// ── Map Yahoo Finance quoteType → app cls ────────────────────────────────────
function mapQuoteType(type) {
  switch ((type || '').toUpperCase()) {
    case 'ETF':            return 'ETF'
    case 'CRYPTOCURRENCY': return 'Crypto'
    case 'FUTURE':         return 'Commodity'
    default:               return 'Equity'
  }
}
function mapExchange(exchange, symbol) {
  if (exchange === 'SET' || (symbol || '').endsWith('.BK')) return 'TH'
  return 'US'
}

// ── Add-symbol modal with live search autocomplete ────────────────────────────
function AddModal({ th, onClose, onAdd }) {
  const [query,    setQuery]    = useState('')        // raw text in the search box
  const [symbol,   setSymbol]   = useState('')        // confirmed ticker (after selection)
  const [name,     setName]     = useState('')
  const [region,   setRegion]   = useState('US')
  const [cls,      setCls]      = useState('Equity')
  const [note,     setNote]     = useState('')
  const [results,  setResults]  = useState([])        // dropdown items
  const [searching,setSearching]= useState(false)
  const [dropOpen, setDropOpen] = useState(false)
  const inputRef  = useRef(null)
  const dropRef   = useRef(null)

  // Debounced search while typing
  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) { setResults([]); setDropOpen(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        const items = Array.isArray(data) ? data.slice(0, 20) : []
        setResults(items)
        setDropOpen(items.length > 0)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setDropOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // User picks a result from the dropdown → fill in all fields
  const handleSelect = (r) => {
    const sym = r.symbol.replace(/\.BK$/i, '')   // strip .BK — toYahooSymbol re-adds it
    const reg = mapExchange(r.exchange, r.symbol)
    const type = mapQuoteType(r.type)
    setSymbol(sym)
    setQuery(sym)
    setName(r.name)
    setRegion(reg)
    setCls(type)
    setResults([])
    setDropOpen(false)
  }

  // Confirm and add — falls back to manual query if no dropdown selection made
  const handleAdd = () => {
    const sym = (symbol || query).trim().toUpperCase().replace(/\.BK$/i, '')
    if (!sym) return
    // Auto-detect region/cls from raw query when user didn't pick from dropdown
    let finalRegion = region
    let finalCls    = cls
    if (!symbol) {
      if (sym.endsWith('.BK') || region === 'TH') finalRegion = 'TH'
      if (/-(USD|USDT|USDC)$/i.test(sym)) { finalRegion = 'US'; finalCls = 'Crypto' }
    }
    onAdd({
      symbol: sym,
      name: name.trim() || sym,
      region: finalRegion,
      cls:    finalCls,
      note:   note.trim(),
      addedAt: new Date().toISOString(),
    })
    onClose()
  }

  const hasSelection = Boolean(symbol)   // true after picking from dropdown

  // Exchange label shown in each dropdown row
  const exchangeLabel = (r) => {
    const ex = r.exchange || ''
    if (ex === 'SET')  return { label: 'SET', bg: 'oklch(0.94 0.04 200)' }
    if (ex === 'NMS' || ex === 'NAS') return { label: 'NASDAQ', bg: 'oklch(0.94 0.04 250)' }
    if (ex === 'NYQ')  return { label: 'NYSE', bg: 'oklch(0.94 0.04 250)' }
    if (ex === 'CCC')  return { label: 'CRYPTO', bg: 'oklch(0.94 0.06 65)' }
    return { label: ex || 'US', bg: 'oklch(0.94 0.04 250)' }
  }

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
      <div style={{
        background: 'var(--bg)', borderRadius: 18, padding: 28,
        width: '100%', maxWidth: 420,
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>
          {th ? 'เพิ่มหุ้นใน Watchlist' : 'Add to watchlist'}
        </h3>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--ink-3)' }}>
          {th ? 'พิมพ์ชื่อหรือ Ticker เช่น AAPL, Apple, PTT, Bitcoin'
              : 'Search by ticker or name — e.g. AAPL, Apple, PTT, Bitcoin'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* ── Search input + dropdown ─────────────────────── */}
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Icon name="search" size={15}
                style={{ position: 'absolute', left: 12, color: 'var(--ink-3)', pointerEvents: 'none' }} />
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={e => { setQuery(e.target.value); setSymbol('') }}
                onFocus={() => results.length > 0 && setDropOpen(true)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { setDropOpen(false); handleAdd() }
                  if (e.key === 'Escape') onClose()
                }}
                placeholder={th ? 'ค้นหา ticker หรือชื่อหุ้น…' : 'Search ticker or company name…'}
                style={{
                  width: '100%', padding: '11px 12px 11px 36px',
                  borderRadius: 10, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em',
                  border: `1.5px solid ${hasSelection ? 'var(--accent)' : 'var(--line)'}`,
                  background: 'var(--bg)', color: 'var(--ink)', outline: 'none',
                  fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
              />
              {searching && (
                <span style={{ position: 'absolute', right: 12, fontSize: 11, color: 'var(--ink-3)' }}>…</span>
              )}
              {hasSelection && !searching && (
                <span style={{ position: 'absolute', right: 12, color: 'var(--accent)', lineHeight: 0 }}>
                  <Icon name="check" size={14} />
                </span>
              )}
            </div>

            {/* Dropdown */}
            {dropOpen && results.length > 0 && (
              <div ref={dropRef} style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 600,
                background: 'var(--bg)', border: '1.5px solid var(--line)',
                borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
                maxHeight: 340, overflowY: 'auto',
              }}>
                {results.map((r, i) => {
                  const { label, bg } = exchangeLabel(r)
                  const isTH = r.exchange === 'SET' || r.symbol.endsWith('.BK')
                  return (
                    <button
                      key={r.symbol + i}
                      onMouseDown={e => { e.preventDefault(); handleSelect(r) }}
                      style={{
                        width: '100%', padding: '10px 14px',
                        display: 'flex', alignItems: 'center', gap: 10,
                        border: 'none', background: 'transparent',
                        cursor: 'pointer', textAlign: 'left',
                        borderBottom: i < results.length - 1 ? '1px solid var(--line)' : 'none',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Flag */}
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{isTH ? '🇹🇭' : '🇺🇸'}</span>

                      {/* Symbol + Name */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                            {r.symbol.replace(/\.BK$/i, '')}
                          </span>
                          <span style={{
                            fontSize: 9, padding: '1px 5px', borderRadius: 99,
                            background: bg, color: 'var(--ink-2)', fontWeight: 700,
                            letterSpacing: '0.04em', flexShrink: 0,
                          }}>{label}</span>
                          <span style={{
                            fontSize: 9, padding: '1px 5px', borderRadius: 99,
                            background: 'var(--bg-2)', color: 'var(--ink-3)', fontWeight: 600, flexShrink: 0,
                          }}>{mapQuoteType(r.type)}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.name}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Resolved details (shown after selection) ──── */}
          {hasSelection && (
            <div style={{
              padding: '12px 14px', borderRadius: 10,
              background: 'var(--accent-soft)', border: '1px solid var(--line)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <TickerLogo ticker={symbol} region={region} cls={cls} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-mono)' }}>{symbol}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 99, background: region === 'TH' ? 'oklch(0.94 0.04 200)' : cls === 'Crypto' ? 'oklch(0.94 0.06 65)' : 'oklch(0.94 0.04 250)', fontWeight: 700, color: 'var(--ink-2)' }}>
                  {region}
                </span>
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 99, background: 'var(--bg-2)', fontWeight: 600, color: 'var(--ink-3)' }}>
                  {cls}
                </span>
              </div>
            </div>
          )}

          {/* ── Manual override: Region + Class (only shown when no selection yet) */}
          {!hasSelection && query.trim().length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>
                  {th ? 'ตลาด' : 'Region'}
                </div>
                <div className="pill-toggle" style={{ width: '100%' }}>
                  <button className={region === 'US' ? 'on' : ''} onClick={() => setRegion('US')}>🇺🇸 US</button>
                  <button className={region === 'TH' ? 'on' : ''} onClick={() => setRegion('TH')}>🇹🇭 TH</button>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>
                  {th ? 'ประเภท' : 'Type'}
                </div>
                <select value={cls} onChange={e => setCls(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13, border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none' }}>
                  <option value="Equity">Equity</option>
                  <option value="ETF">ETF</option>
                  <option value="Crypto">Crypto</option>
                  <option value="Commodity">Commodity</option>
                </select>
              </div>
            </div>
          )}

          {/* ── Note ─────────────────────────────────────────── */}
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={th ? '📝 บันทึก (เช่น รอ Pullback ที่ S1)' : '📝 Note (optional)'}
            style={{ padding: '9px 12px', borderRadius: 8, fontSize: 13, border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
            {th ? 'ยกเลิก' : 'Cancel'}
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={handleAdd} disabled={!query.trim()}>
            {th ? '+ เพิ่ม' : '+ Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ th, onAdd }) {
  return (
    <div style={{ textAlign: 'center', padding: '72px 24px' }}>
      <div style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }}>👁</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
        {th ? 'ยังไม่มีหุ้นใน Watchlist' : 'Your watchlist is empty'}
      </div>
      <p style={{ margin: '0 auto 28px', fontSize: 13, color: 'var(--ink-3)', maxWidth: 360, lineHeight: 1.6 }}>
        {th
          ? 'เพิ่มหุ้นที่สนใจเพื่อติดตามราคา คำนวณแนวรับ-แนวต้าน และดูกราฟ TradingView'
          : 'Add stocks to track live prices, auto-compute support & resistance levels, and view TradingView charts'}
      </p>
      <button className="btn" onClick={onAdd} style={{ padding: '10px 24px', fontSize: 14 }}>
        <Icon name="plus" size={14} />
        {th ? 'เพิ่มหุ้นแรก' : 'Add your first stock'}
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function WatchlistPage({ lang, ccy, fxRate = 36 }) {
  const th = lang === 'th'

  const [items,          setItems]          = useState(loadList)
  const [prices,         setPrices]         = useState({})
  const [histories,      setHistories]      = useState({})   // yahooSymbol → bars [{t,o,h,l,c,v}]
  const [expandedKey,    setExpandedKey]    = useState(null) // `${symbol}:${region}` of open chart
  const [showAdd,        setShowAdd]        = useState(false)
  const [loadingPrices,  setLoadingPrices]  = useState(false)
  // Fullscreen state — stored at page level so modal renders outside the grid
  const [fullscreenItem, setFullscreenItem] = useState(null) // null | { item, priceData, sr }

  // Persist list to localStorage whenever it changes
  useEffect(() => { saveList(items) }, [items])

  // ── Fetch live prices for all watchlist items ───────────────────────────────
  const refreshPrices = useCallback(async () => {
    if (items.length === 0) { setPrices({}); return }
    setLoadingPrices(true)
    try {
      const holdingLike = items.map(item => ({
        ticker: item.symbol,
        region: item.region || 'US',
        asset_class: item.cls || 'Equity',
      }))
      const px = await fetchPrices(holdingLike)
      setPrices(px)
    } catch (err) {
      console.warn('[Watchlist] price fetch error:', err)
    } finally {
      setLoadingPrices(false)
    }
  }, [items])

  // ── Fetch 3-month OHLC history for S/R computation ────────────────────────
  const refreshHistories = useCallback(async () => {
    for (const item of items) {
      const sym = toYahooSymbol(item.symbol, item.region || 'US', item.cls || 'Equity')
      try {
        const { series } = await fetchHistory(sym, '6mo')
        // Store full OHLC bars; filter only rows with a valid close
        const bars = series.filter(p => p.c != null && Number.isFinite(p.c) && p.c > 0)
        if (bars.length >= 12) {
          setHistories(prev => ({ ...prev, [sym]: bars }))
        }
      } catch (err) {
        console.warn('[Watchlist] history error for', sym, err)
      }
    }
  }, [items])

  // Refresh prices + histories whenever the list changes
  useEffect(() => {
    refreshPrices()
    refreshHistories()
  }, [refreshPrices, refreshHistories])

  // ── Item management ─────────────────────────────────────────────────────────
  const addItem = useCallback((newItem) => {
    const dup = items.some(
      i => i.symbol.toUpperCase() === newItem.symbol.toUpperCase() && i.region === newItem.region
    )
    if (dup) {
      alert(th
        ? `${newItem.symbol} (${newItem.region}) อยู่ใน Watchlist แล้ว`
        : `${newItem.symbol} (${newItem.region}) is already in your watchlist`)
      return
    }
    setItems(prev => [...prev, newItem])
  }, [items, th])

  const removeItem = useCallback((idx) => {
    const item = items[idx]
    setItems(prev => prev.filter((_, i) => i !== idx))
    if (item) {
      const key = `${item.symbol}:${item.region}`
      setExpandedKey(prev => prev === key ? null : prev)
    }
  }, [items])

  const updateNote = useCallback((idx, note) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, note } : item))
  }, [])

  return (
    <div className="shell fade-in" data-screen-label="Watchlist">
      <PageHead
        kicker={th ? 'WATCHLIST' : 'WATCHLIST'}
        title={th ? 'รายการติดตาม' : 'Watchlist'}
        sub={th
          ? 'ติดตามหุ้นที่น่าสนใจ พร้อมแนวรับ-แนวต้านอัตโนมัติ'
          : 'Track stocks with auto-computed support & resistance levels'}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {loadingPrices && (
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {th ? 'กำลังดึงราคา…' : 'Fetching prices…'}
              </span>
            )}
            <button className="btn" onClick={() => setShowAdd(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="plus" size={14} />
              {th ? 'เพิ่มหุ้น' : 'Add stock'}
            </button>
          </div>
        }
      />

      {items.length === 0 ? (
        <EmptyState th={th} onAdd={() => setShowAdd(true)} />
      ) : (
        <>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <StrengthDots count={3} color="var(--loss)" />
              {th ? 'แนวต้าน (Resistance)' : 'Resistance'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <StrengthDots count={3} color="var(--gain)" />
              {th ? 'แนวรับ (Support)' : 'Support'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {th ? '● = จำนวนครั้งที่ราคาเคยทดสอบ (pivot touch)' : '● = number of historical price touches (pivot)'}
            </span>
          </div>

          {/* Card grid — max 3 columns, min 320px each */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 'var(--gap)',
            maxWidth: 1200,
          }}>
            {items.map((item, idx) => {
              const yahooSym  = toYahooSymbol(item.symbol, item.region || 'US', item.cls || 'Equity')
              const priceData = prices[yahooSym]
              const bars      = histories[yahooSym]
              const livePrice = priceData?.price ?? null
              const sr        = (bars && livePrice) ? computeSR(bars, livePrice) : null
              const chartKey  = `${item.symbol}:${item.region}`
              return (
                <WatchlistCard
                  key={chartKey}
                  item={item}
                  priceData={priceData}
                  sr={sr}
                  onRemove={() => removeItem(idx)}
                  onNoteChange={(note) => updateNote(idx, note)}
                  showChart={expandedKey === chartKey}
                  onToggleChart={() => setExpandedKey(prev => prev === chartKey ? null : chartKey)}
                  onExpand={() => setFullscreenItem({ item, priceData, sr })}
                  lang={lang}
                />
              )
            })}
          </div>

          {/* Footer note */}
          <p style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 28, lineHeight: 1.6 }}>
            {th
              ? 'แนวรับ-แนวต้านคำนวณจาก pivot point ของ 6 เดือนย้อนหลัง · ราคาจาก Yahoo Finance'
              : 'S/R levels computed from 6-month OHLC pivot points · Prices via Yahoo Finance'}
          </p>
        </>
      )}

      {showAdd && <AddModal th={th} onClose={() => setShowAdd(false)} onAdd={addItem} />}

      {/* Fullscreen chart — rendered here (outside grid) to avoid createPortal crashes */}
      {fullscreenItem && (
        <WatchlistFullscreen
          item={fullscreenItem.item}
          priceData={fullscreenItem.priceData}
          sr={fullscreenItem.sr}
          lang={lang}
          onClose={() => setFullscreenItem(null)}
        />
      )}
    </div>
  )
}
