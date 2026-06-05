/**
 * LWChart.jsx — TradingView Lightweight Charts v5 wrappers
 *
 * Exports:
 *  · LWChart      — OHLC area + volume + EMA curves + S/R price lines (Watchlist)
 *  · LWLineChart  — Multi-series area/line chart with tooltip (Analytics, Dashboard, DCA, Planning)
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
// Handles var(), oklch(), hex, rgb — canvas-safe on modern browsers.
// oklch is passed through directly (Chrome/FF/Safari 2023+ support it in canvas).
// CSS variables are read via getComputedStyle so theme changes work correctly.
function resolveColor(c) {
  if (!c) return '#94a3b8'
  if (c.startsWith('#') || c.startsWith('rgb') || c.startsWith('hsl')) return c
  if (c.startsWith('oklch')) return c   // modern browsers handle oklch in canvas
  if (c.startsWith('var(')) {
    const name = c.slice(4, -1).trim()
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      if (v) return v   // return computed value (may be oklch — that's fine)
    } catch {}
    // Hardcoded fallbacks for common tokens
    const fb = {
      '--loss':   '#f87171', '--gain':   '#4ade80',
      '--accent': '#2dd4bf', '--ink':    '#0f172a',
      '--ink-2':  '#475569', '--ink-3':  '#94a3b8', '--ink-4': '#cbd5e1',
    }
    return fb[name] || '#94a3b8'
  }
  return '#94a3b8'
}

// Hex color → rgba string with given alpha (for area fill top color)
function withAlpha(hex, a) {
  const m = hex.match(/^#([0-9a-f]{6})$/i)
  if (m) {
    const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16))
    return `rgba(${r},${g},${b},${a})`
  }
  return `rgba(100,100,100,${a})`  // fallback for oklch/rgb values
}

// Abbreviate large numbers for y-axis labels
function abbrev(v) {
  const a = Math.abs(v)
  if (a >= 1e9)  return (v / 1e9).toFixed(1)  + 'B'
  if (a >= 1e6)  return (v / 1e6).toFixed(1)  + 'M'
  if (a >= 1e3)  return (v / 1e3).toFixed(1)  + 'K'
  if (a >= 100)  return v.toFixed(0)
  if (a >= 1)    return v.toFixed(2)
  return v.toFixed(4)
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

// ── LWLineChart ───────────────────────────────────────────────────────────────
// Drop-in replacement for <LineChart> — same prop interface:
//   series  = [{name, data:[{x:unixSec, y:number, label:string}], color, fill, dashed}]
//   height  = number
//   fmt     = (value: number) => string   (for tooltip values)
//   labelFmt= (point) => string           (for tooltip date label — defaults to d.label)
export function LWLineChart({ series = [], height = 280, fmt, labelFmt }) {
  const containerRef = useRef(null)
  const tooltipRef   = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || !series[0]?.data?.length) return

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    const C = {
      bg:      'transparent',
      text:    isDark ? '#94a3b8' : '#64748b',
      grid:    isDark ? '#1e293b' : '#f1f5f9',
      border:  isDark ? '#334155' : '#e2e8f0',
      xhair:   isDark ? '#475569' : '#cbd5e1',
      xhBg:    isDark ? '#1e293b' : '#0f172a',
    }

    const chart = createChart(el, {
      width:  el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: C.bg },
        textColor: C.text, fontSize: 10,
      },
      grid:   { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: {
        vertLine: { color: C.xhair, labelBackgroundColor: C.xhBg },
        horzLine: { color: C.xhair, labelBackgroundColor: C.xhBg },
      },
      rightPriceScale: {
        borderColor: C.border,
        scaleMargins: { top: 0.08, bottom: 0.04 },
      },
      timeScale: {
        borderColor: C.border, timeVisible: false, fixRightEdge: true,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale:  { mouseWheel: true, pinch: true },
    })

    // y-axis: use abbreviated formatter so large numbers stay readable
    const priceFmt = { type: 'custom', formatter: abbrev, minMove: 0.01 }

    // Add each series
    const refs = series.map(s => {
      const color = resolveColor(s.color)
      const style = s.dashed ? LineStyle.Dashed : LineStyle.Solid
      let cs
      if (s.fill) {
        const top = color.startsWith('#') ? withAlpha(color, 0.14) : 'rgba(100,180,200,0.12)'
        cs = chart.addSeries(AreaSeries, {
          lineColor: color, topColor: top, bottomColor: 'rgba(0,0,0,0)',
          lineWidth: 2, lineStyle: style,
          priceFormat: priceFmt,
          lastValueVisible: false, priceLineVisible: false,
        })
      } else {
        cs = chart.addSeries(LineSeries, {
          color, lineWidth: 1.5, lineStyle: style,
          priceFormat: priceFmt,
          lastValueVisible: false, priceLineVisible: false,
        })
      }
      const valid = s.data.filter(d => Number.isFinite(d.y) && d.x > 0)
      cs.setData(valid.map(d => ({ time: d.x, value: d.y })))
      return cs
    })

    // ── Custom tooltip ──────────────────────────────────────────────────────
    const tip = tooltipRef.current
    chart.subscribeCrosshairMove(param => {
      if (!tip) return
      if (!param?.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        tip.style.display = 'none'; return
      }
      // Get date label from first series data
      const pt0 = series[0]?.data?.find(d => d.x === param.time)
      const label = labelFmt ? labelFmt(pt0 || {}) : (pt0?.label || '')

      const rows = series.map((s, i) => {
        const val = param.seriesData.get(refs[i])?.value
        if (val == null) return ''
        const color = resolveColor(s.color)
        const valStr = fmt ? fmt(val) : abbrev(val)
        return `<div style="display:flex;align-items:center;gap:6px;margin-top:4px">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
          <span>${s.name}</span>
          <span style="margin-left:auto;font-weight:700;padding-left:12px">${valStr}</span>
        </div>`
      }).join('')

      tip.innerHTML = `<div style="font-size:10px;opacity:0.65;margin-bottom:2px">${label}</div>${rows}`

      const w = el.clientWidth
      const lft = param.point.x > w * 0.6
        ? param.point.x - tip.offsetWidth - 14
        : param.point.x + 14
      tip.style.left = `${Math.max(4, lft)}px`
      tip.style.top  = `${Math.max(4, param.point.y - 44)}px`
      tip.style.display = 'block'
    })

    chart.timeScale().fitContent()

    const ro = new ResizeObserver(([e]) => {
      if (e.contentRect.width > 0) chart.applyOptions({ width: e.contentRect.width })
    })
    ro.observe(el)

    return () => { ro.disconnect(); chart.remove() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, height])

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', borderRadius: 8, overflow: 'hidden' }} />
      <div ref={tooltipRef} style={{
        display:        'none',
        position:       'absolute',
        pointerEvents:  'none',
        background:     'var(--ink)',
        color:          'var(--bg)',
        padding:        '8px 12px',
        borderRadius:   8,
        fontSize:       12,
        fontFamily:     'var(--font-mono)',
        whiteSpace:     'nowrap',
        boxShadow:      '0 4px 16px rgba(0,0,0,0.22)',
        zIndex:         10,
      }} />
    </div>
  )
}
