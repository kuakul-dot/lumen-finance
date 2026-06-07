// SRPanel.jsx — Self-contained S/R chart panel
// Used by Portfolio (holding modal) — mirrors the chart section of WatchlistCard.
// All computation functions are duplicated here to keep the module self-contained
// and avoid circular imports with Watchlist.jsx.

import { useState, useEffect, useMemo } from 'react'
import { LWChart } from './LWChart'
import { fetchHistory, toYahooSymbol } from '../lib/prices'
import { addAlert, requestNotifPermission } from '../lib/alerts'

// ── S/R computation ───────────────────────────────────────────────────────────
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
    .slice(0, 8).map(toLevel).sort((a, b) => a.price - b.price).slice(0, 4)
  let supports = cluster(pivotLows.filter(v => v < current * 0.999))
    .slice(0, 8).map(toLevel).sort((a, b) => b.price - a.price).slice(0, 4)

  const allH = bars.map(b => b.h ?? b.c).filter(Number.isFinite)
  const allL = bars.map(b => b.l ?? b.c).filter(Number.isFinite)
  const fbR = [...new Set([
    Math.max(...allH.slice(-30)),
    Math.max(...allH.slice(-60)),
    Math.max(...allH.slice(-90)),
    Math.max(...allH),
  ])].filter(v => v > current * 1.005).sort((a, b) => a - b)
  const fbS = [...new Set([
    Math.min(...allL.slice(-30)),
    Math.min(...allL.slice(-60)),
    Math.min(...allL.slice(-90)),
    Math.min(...allL),
  ])].filter(v => v < current * 0.995).sort((a, b) => b - a)

  for (const v of fbR) {
    if (resistances.length >= 4) break
    if (!resistances.some(r => Math.abs(r.price - v) / v < 0.02))
      resistances.push({ price: +v.toFixed(4), strength: 0 })
  }
  for (const v of fbS) {
    if (supports.length >= 4) break
    if (!supports.some(s => Math.abs(s.price - v) / v < 0.02))
      supports.push({ price: +v.toFixed(4), strength: 0 })
  }

  resistances.sort((a, b) => a.price - b.price)
  supports.sort((a, b) => b.price - a.price)
  return { resistances, supports }
}

// ── Fibonacci Retracement ─────────────────────────────────────────────────────
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

// ── EMA ───────────────────────────────────────────────────────────────────────
const EMA_PERIODS = {
  '1mo':  [5,  10,  20],
  '3mo':  [10, 20,  50],
  '6mo':  [20, 50, 200],
  '1y':   [20, 50, 200],
}

function calcEMAFull(bars, period) {
  const valid = bars.filter(b => b.c != null && Number.isFinite(b.c) && b.c > 0)
  if (valid.length < period) return { current: null, series: [] }
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
    ma20: e1.current, series20: e1.series,
    ma50: e2.current, series50: e2.series,
    ma200: e3.current, series200: e3.series,
    p1, p2, p3,
  }
}

// ── Previous Week / Month High & Low ─────────────────────────────────────────
function computePrevHL(bars) {
  if (!bars || bars.length < 10) return null
  const now = new Date()
  const dow = now.getDay() || 7
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

// ── VWAP ──────────────────────────────────────────────────────────────────────
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

// ── Volume Profile ────────────────────────────────────────────────────────────
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

  const totalVol = vol.reduce((s, v) => s + v, 0)
  const target   = totalVol * 0.70
  let loI = pocIdx, hiI = pocIdx, covered = vol[pocIdx]
  while (covered < target && (loI > 0 || hiI < BUCKETS - 1)) {
    const addL = loI > 0           ? vol[loI - 1] : 0
    const addH = hiI < BUCKETS - 1 ? vol[hiI + 1] : 0
    if (addH >= addL && hiI < BUCKETS - 1) { hiI++; covered += addH }
    else if (loI > 0)                       { loI--; covered += addL }
    else break
  }
  return {
    poc,
    vah: +(lo + (hiI + 1) * bSz).toFixed(4),
    val: +(lo + loI * bSz).toFixed(4),
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

// ── S/R Ladder ────────────────────────────────────────────────────────────────
function SRLadder({ sr, livePrice, currency, onSetAlert }) {
  if (!sr) return null

  const rowStyle = (isRes) => ({
    display: 'grid',
    gridTemplateColumns: '32px 60px 1fr auto auto',
    alignItems: 'center',
    gap: 8,
    padding: '5px 0',
    color: isRes ? 'var(--loss)' : 'var(--gain)',
    fontSize: 12,
  })

  const rLevels = [...sr.resistances].reverse()
  const sLevels = sr.supports

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
            {onSetAlert && (
              <button onClick={() => onSetAlert(lvl.price, label, 'above')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '0 2px', opacity: 0.5, lineHeight: 1 }}
                title={`Set alert at ${label}`}>🔔</button>
            )}
          </div>
        )
      })}

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
          {onSetAlert && (
            <button onClick={() => onSetAlert(lvl.price, `S${i + 1}`, 'below')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: '0 2px', opacity: 0.5, lineHeight: 1 }}
              title={`Set alert at S${i + 1}`}>🔔</button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Constants ─────────────────────────────────────────────────────────────────
const CHART_RANGES = ['1mo', '3mo', '6mo', '1y']
const RANGE_LABEL  = { '1mo': '1M', '3mo': '3M', '6mo': '6M', '1y': '1Y' }

// ── SRPanel — main exported component ─────────────────────────────────────────
// Props:
//   ticker     — raw ticker (e.g. "AOT", "BTC", "GoldTH")
//   region     — "TH" | "US"
//   cls        — asset_class string (e.g. "Equity", "Crypto", "GoldTH")
//   livePrice  — current price in the Yahoo symbol's native currency
//   currency   — "THB" | "USD" (native currency of the Yahoo symbol)
//   lang       — "th" | "en"
//   chartHeight — height in px for LWChart (default 280)
export function SRPanel({ ticker, region, cls, livePrice, currency, lang = 'en', chartHeight = 280, name = '' }) {
  const th = lang === 'th'

  const [chartRange,   setChartRange]   = useState('6mo')
  const [chartBars,    setChartBars]    = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [overlays, setOverlays] = useState({
    fib: false, ma: false, vp: false, prevhl: false, round: false, vwap: false, bb: false,
  })
  const toggleOverlay = (key) => setOverlays(prev => ({ ...prev, [key]: !prev[key] }))
  const [alertToast, setAlertToast] = useState(null)  // brief "Alert set" flash

  const yahooSym = toYahooSymbol(ticker || '', region || 'TH', cls || 'Equity')

  // One-click alert from S/R level
  const handleSetAlert = async (targetPrice, label, direction) => {
    await requestNotifPermission()
    addAlert({
      ticker: ticker || '',
      name: name || ticker || '',
      region: region || 'TH',
      cls: cls || 'Equity',
      yahooSym,
      targetPrice,
      direction,
      label,
      currency: currency || 'THB',
      livePrice: livePrice || null,
    })
    setAlertToast(th ? `✅ ตั้งแจ้งเตือน ${label} ที่ ${targetPrice}` : `✅ Alert set at ${label} (${targetPrice})`)
    setTimeout(() => setAlertToast(null), 2500)
  }

  // Fetch OHLC history whenever symbol or range changes
  useEffect(() => {
    if (!yahooSym) return
    let cancelled = false
    setLoading(true)
    setChartBars(null)
    fetchHistory(yahooSym, chartRange)
      .then(({ series }) => {
        if (cancelled) return
        const bars = series.filter(p => p.c != null && Number.isFinite(p.c) && p.c > 0)
        setChartBars(bars.length >= 5 ? bars : null)
      })
      .catch(() => { if (!cancelled) setChartBars(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [yahooSym, chartRange])

  // Computed overlays
  const sr       = useMemo(() => chartBars && livePrice ? computeSR(chartBars, livePrice) : null, [chartBars, livePrice])
  const fib      = useMemo(() => overlays.fib    && chartBars ? computeFib(chartBars) : null, [chartBars, overlays.fib])
  const mas      = useMemo(() => overlays.ma     && chartBars ? computeMAs(chartBars, chartRange) : null, [chartBars, overlays.ma, chartRange])
  const vp       = useMemo(() => overlays.vp     && chartBars ? computeVolProfile(chartBars) : null, [chartBars, overlays.vp])
  const prevHL   = useMemo(() => overlays.prevhl && chartBars ? computePrevHL(chartBars) : null, [chartBars, overlays.prevhl])
  const roundLvl = useMemo(() => overlays.round  && livePrice ? computeRoundLevels(livePrice) : [], [livePrice, overlays.round])
  const vwap     = useMemo(() => overlays.vwap   && chartBars ? computeVWAP(chartBars) : null, [chartBars, overlays.vwap])
  const bb       = useMemo(() => overlays.bb     && chartBars ? computeBB(chartBars) : null, [chartBars, overlays.bb])

  const emaLines = (overlays.ma && mas) ? [
    mas.series20?.length  ? { data: mas.series20,  label: `EMA${mas.p1}` } : null,
    mas.series50?.length  ? { data: mas.series50,  label: `EMA${mas.p2}` } : null,
    mas.series200?.length ? { data: mas.series200, label: `EMA${mas.p3}` } : null,
  ].filter(Boolean) : []

  const hLines = [
    ...(sr ? [
      ...sr.resistances.map((lvl, i) => ({ y: lvl.price, color: 'var(--loss)',  label: `R${i + 1}` })),
      ...sr.supports.map(   (lvl, i) => ({ y: lvl.price, color: 'var(--gain)', label: `S${i + 1}` })),
    ] : []),
    ...(fib  ? fib.map(lvl => ({ y: lvl.price, color: 'oklch(0.65 0.14 55)',  label: `Fib ${lvl.label}` })) : []),
    ...(vp   ? [
      { y: vp.poc, color: 'oklch(0.65 0.16 90)', label: 'POC' },
      { y: vp.vah, color: 'oklch(0.65 0.10 90)', label: 'VAH' },
      { y: vp.val, color: 'oklch(0.65 0.10 90)', label: 'VAL' },
    ] : []),
    ...(prevHL ? [
      prevHL.pwh && { y: prevHL.pwh, color: 'oklch(0.68 0.14 55)', label: 'PWH' },
      prevHL.pwl && { y: prevHL.pwl, color: 'oklch(0.68 0.14 55)', label: 'PWL' },
      prevHL.pmh && { y: prevHL.pmh, color: 'oklch(0.58 0.16 55)', label: 'PMH' },
      prevHL.pml && { y: prevHL.pml, color: 'oklch(0.58 0.16 55)', label: 'PML' },
    ].filter(Boolean) : []),
    ...roundLvl.map(v => ({ y: v, color: 'oklch(0.60 0.04 0)', label: String(v) })),
    ...(vwap != null ? [{ y: vwap, color: 'oklch(0.62 0.14 195)', label: 'VWAP' }] : []),
    ...(bb ? [
      { y: bb.upper, color: 'oklch(0.58 0.12 290)', label: 'BB+' },
      { y: bb.lower, color: 'oklch(0.58 0.12 290)', label: 'BB−' },
    ] : []),
  ]

  return (
    <div>
      {/* Alert toast */}
      {alertToast && (
        <div style={{
          padding: '8px 14px', borderRadius: 8, marginBottom: 8, fontSize: 12, fontWeight: 500,
          background: 'var(--gain-soft)', color: 'var(--gain)', border: '1px solid var(--gain)',
          animation: 'fadeIn 0.15s ease',
        }}>{alertToast}</div>
      )}

      {/* S/R Ladder */}
      {livePrice != null ? (
        sr
          ? <SRLadder sr={sr} livePrice={livePrice} currency={currency} onSetAlert={handleSetAlert} />
          : (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '10px 0', textAlign: 'center', minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {loading
                ? (th ? '⏳ กำลังคำนวณแนวรับ-แนวต้าน…' : '⏳ Computing S/R levels…')
                : (th ? 'ข้อมูลไม่เพียงพอสำหรับการวิเคราะห์ S/R' : 'Insufficient data for S/R analysis')}
            </div>
          )
      ) : (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '10px 0', textAlign: 'center' }}>
          {th ? 'ไม่มีราคาปัจจุบัน' : 'No live price available'}
        </div>
      )}

      {/* Range picker */}
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
        {loading && <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 2 }}>…</span>}
      </div>

      {/* Overlay toggles */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--ink-3)', marginRight: 2, flexShrink: 0 }}>Overlay:</span>
        {[
          { key: 'fib',    label: 'Fibonacci',   color: 'oklch(0.65 0.14 55)'  },
          { key: 'ma',     label: 'EMA',          color: 'oklch(0.50 0.12 250)' },
          { key: 'vp',     label: 'Vol Profile',  color: 'oklch(0.60 0.14 90)'  },
          { key: 'prevhl', label: 'Prev H/L',     color: 'oklch(0.65 0.14 55)'  },
          { key: 'round',  label: 'Round $',      color: 'oklch(0.55 0.04 0)'   },
          { key: 'vwap',   label: 'VWAP',         color: 'oklch(0.62 0.14 195)' },
          { key: 'bb',     label: 'BB ±2σ',       color: 'oklch(0.58 0.12 290)' },
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
            height={chartHeight}
            showVolume={true}
          />
        </div>
      ) : loading ? (
        <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
          {th ? 'กำลังโหลดกราฟ…' : 'Loading chart…'}
        </div>
      ) : (
        <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
          {th ? 'ไม่มีข้อมูลราคาย้อนหลัง' : 'No historical price data available'}
        </div>
      )}

      <p style={{ margin: '8px 0 0', fontSize: 10, color: 'var(--ink-4)', textAlign: 'center' }}>
        {th
          ? 'แนวรับ/ต้าน คำนวณจาก Pivot High/Low · เพื่อการศึกษาเท่านั้น'
          : 'S/R levels from pivot high/low clustering · for education only'}
      </p>
    </div>
  )
}
