/**
 * LWChart — TradingView Lightweight Charts v5 wrapper
 *
 * Features:
 *  · Area series (price) with crosshair
 *  · Horizontal price lines for S/R, Fibonacci, Volume Profile
 *  · EMA full-curve line series (proper overlay, not just horizontal line)
 *  · Volume histogram (optional, bottom pane)
 *  · Responsive via ResizeObserver
 *  · Theme-aware (reads data-theme attribute)
 */
import { useEffect, useRef } from 'react'
import {
  createChart,
  ColorType,
  LineStyle,
  AreaSeries,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts'

// ── Color resolver ────────────────────────────────────────────────────────────
// Converts CSS color values (var(), oklch()) that canvas can't parse
// into safe hex values.
function resolveColor(c) {
  if (!c) return '#94a3b8'
  // CSS variables
  if (c === 'var(--loss)')  return '#f87171'  // red-400
  if (c === 'var(--gain)')  return '#4ade80'  // green-400
  if (c === 'var(--ink-3)') return '#94a3b8'
  if (c === 'var(--accent)')return '#2dd4bf'
  // Already a safe color
  if (c.startsWith('#') || c.startsWith('rgb')) return c
  // oklch → approximate by hue
  const m = c.match(/oklch\([\d.]+ [\d.]+ ([\d.]+)\)/)
  if (m) {
    const h = parseFloat(m[1])
    if (h <  40)  return '#f87171'   // red
    if (h <  80)  return '#fbbf24'   // amber  (Fibonacci)
    if (h < 160)  return '#4ade80'   // green  (Volume Profile)
    if (h < 220)  return '#38bdf8'   // sky
    if (h < 270)  return '#818cf8'   // indigo (EMA long)
    if (h < 330)  return '#c084fc'   // purple (EMA short)
    return '#f87171'
  }
  return '#94a3b8'
}

// EMA curve colors (short → medium → long)
const EMA_CURVE_COLORS = [
  '#c084fc',  // violet  — short EMA (e.g. EMA5 / EMA10 / EMA20)
  '#60a5fa',  // blue    — medium EMA
  '#34d399',  // emerald — long EMA
]

// ── Main component ────────────────────────────────────────────────────────────
export function LWChart({
  bars,                 // [{t, o, h, l, c, v}]  (t = unix seconds)
  hLines  = [],         // [{y, color, label}]   S/R, Fib, Vol price lines
  emaLines = [],        // [{data:[{time,value}]}] EMA full-curve overlays
  height  = 280,
  showVolume = true,    // show volume histogram below price
}) {
  const containerRef = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || !bars?.length) return

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'

    // ── Theme palette ────────────────────────────────────────────────────────
    const C = {
      bg:       'transparent',
      text:     isDark ? '#94a3b8' : '#64748b',
      grid:     isDark ? '#1e293b' : '#f1f5f9',
      border:   isDark ? '#334155' : '#e2e8f0',
      line:     isDark ? '#2dd4bf' : '#0d9488',   // teal
      lineTop:  isDark ? 'rgba(45,212,191,0.16)'  : 'rgba(13,148,136,0.10)',
      lineBot:  'rgba(0,0,0,0)',
      xhair:    isDark ? '#475569' : '#cbd5e1',
      xhairLbl: isDark ? '#1e293b' : '#0f172a',
      volUp:    isDark ? '#064e3b' : '#bbf7d0',
      volDown:  isDark ? '#450a0a' : '#fecdd3',
    }

    // ── Chart ────────────────────────────────────────────────────────────────
    const chart = createChart(el, {
      width:  el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: C.bg },
        textColor:  C.text,
        fontSize:   10,
      },
      grid: {
        vertLines: { color: C.grid },
        horzLines: { color: C.grid },
      },
      crosshair: {
        vertLine: { color: C.xhair, style: LineStyle.Dashed, labelBackgroundColor: C.xhairLbl },
        horzLine: { color: C.xhair, style: LineStyle.Dashed, labelBackgroundColor: C.xhairLbl },
      },
      rightPriceScale: {
        borderColor: C.border,
        // Leave bottom margin when volume is shown
        scaleMargins: showVolume ? { top: 0.08, bottom: 0.22 } : { top: 0.08, bottom: 0.04 },
      },
      timeScale: {
        borderColor:  C.border,
        timeVisible:  false,
        fixRightEdge: true,
        barSpacing:   6,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale:  { mouseWheel: true, pinch: true },
    })

    // ── Price format (auto-detect precision) ─────────────────────────────────
    const sample   = bars.find(b => b.c > 0)?.c ?? 1
    const precision = sample < 1 ? 6 : sample < 10 ? 4 : sample < 1000 ? 2 : 0
    const minMove   = +Math.pow(10, -precision).toFixed(precision + 2) || 0.01

    // ── Area series (price) ──────────────────────────────────────────────────
    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor:        C.line,
      topColor:         C.lineTop,
      bottomColor:      C.lineBot,
      lineWidth:        2,
      priceFormat:      { type: 'price', precision, minMove },
      lastValueVisible: true,
      priceLineVisible: false,
    })
    areaSeries.setData(bars.map(b => ({ time: b.t, value: b.c })))

    // ── Horizontal price lines (S/R, Fibonacci, Volume Profile) ─────────────
    for (const hl of hLines) {
      if (!Number.isFinite(hl.y)) continue
      areaSeries.createPriceLine({
        price:              hl.y,
        color:              resolveColor(hl.color),
        lineWidth:          1,
        lineStyle:          LineStyle.Dashed,
        title:              hl.label || '',
        axisLabelVisible:   false,
      })
    }

    // ── EMA full-curve line series ───────────────────────────────────────────
    for (let i = 0; i < emaLines.length; i++) {
      const e = emaLines[i]
      if (!e?.data?.length) continue
      const color = EMA_CURVE_COLORS[i] || '#94a3b8'
      const ls = chart.addSeries(LineSeries, {
        color,
        lineWidth:              1,
        lineStyle:              LineStyle.Solid,
        priceLineVisible:       false,
        lastValueVisible:       true,   // show current value box on right axis
        crosshairMarkerVisible: false,
        title:                  e.label || '',  // e.g. "EMA20", "EMA50"
        priceFormat:            { type: 'price', precision, minMove },
      })
      ls.setData(e.data)
    }

    // ── Volume histogram ─────────────────────────────────────────────────────
    if (showVolume) {
      const volBars = bars.filter(b => b.v > 0 && Number.isFinite(b.v))
      if (volBars.length > 0) {
        const volSeries = chart.addSeries(HistogramSeries, {
          priceFormat:  { type: 'volume' },
          priceScaleId: 'vol',
        })
        chart.priceScale('vol').applyOptions({
          scaleMargins: { top: 0.82, bottom: 0 },
        })
        volSeries.setData(volBars.map(b => ({
          time:  b.t,
          value: b.v,
          color: (b.c >= (b.o ?? b.c)) ? C.volUp : C.volDown,
        })))
      }
    }

    chart.timeScale().fitContent()

    // ── Responsive ───────────────────────────────────────────────────────────
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) chart.applyOptions({ width: w })
    })
    ro.observe(el)

    return () => { ro.disconnect(); chart.remove() }
  }, [bars, hLines, emaLines, height, showVolume])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', borderRadius: 8, overflow: 'hidden' }}
    />
  )
}
