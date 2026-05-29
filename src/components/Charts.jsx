import { useState, useRef, useEffect } from 'react'

export function Sparkline({ data, width = 80, height = 24, stroke = "var(--ink)", fill = null }) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const stepX = width / (data.length - 1)
  const points = data.map((v, i) => [i * stepX, height - ((v - min) / range) * (height - 4) - 2])
  const d = points.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1)).join(" ")
  const area = d + ` L ${width} ${height} L 0 ${height} Z`
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {fill ? <path d={area} fill={fill} opacity="0.2" /> : null}
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function LineChart({ series, height = 280, fmt, labelFmt }) {
  const wrapRef = useRef(null)
  const [w, setW] = useState(720)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(es => setW(Math.max(320, es[0].contentRect.width)))
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const padL = 8, padR = 8, padT = 12, padB = 28
  const innerW = w - padL - padR
  const innerH = height - padT - padB
  const allY = series.flatMap(s => s.data.map(d => d.y))
  const yMin = Math.min(...allY)
  const yMax = Math.max(...allY)
  const yRange = (yMax - yMin) || 1
  const yLo = yMin - yRange * 0.08
  const yHi = yMax + yRange * 0.08
  const ySpan = yHi - yLo
  const xs = series[0].data.map(d => d.x)
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const xSpan = (xMax - xMin) || 1

  const xPos = x => padL + ((x - xMin) / xSpan) * innerW
  const yPos = y => padT + (1 - (y - yLo) / ySpan) * innerH

  const yTicks = 4
  const gridYs = Array.from({ length: yTicks + 1 }, (_, i) => yLo + (ySpan * i) / yTicks)
  const labelEvery = Math.max(1, Math.floor(series[0].data.length / 6))
  const xLabels = series[0].data.map((d, i) => ({ ...d, i })).filter((d, i) => i % labelEvery === 0 || i === series[0].data.length - 1)

  const handleMove = e => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const idx = Math.max(0, Math.min(series[0].data.length - 1, Math.round(((x - padL) / innerW) * (series[0].data.length - 1))))
    setHover(idx)
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`}
           onMouseMove={handleMove} onMouseLeave={() => setHover(null)}
           style={{ cursor: "crosshair", display: "block" }}>
        {gridYs.map((yv, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={yPos(yv)} y2={yPos(yv)}
                  stroke="var(--line)" strokeDasharray={i === 0 ? "" : "2 4"} />
            <text x={w - padR} y={yPos(yv) - 4} textAnchor="end" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">
              {fmt ? fmt(yv) : yv.toFixed(0)}
            </text>
          </g>
        ))}
        {series.map((s, si) => {
          const pts = s.data.map(d => [xPos(d.x), yPos(d.y)])
          const d = pts.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1)).join(" ")
          const area = d + ` L ${pts[pts.length - 1][0]} ${padT + innerH} L ${pts[0][0]} ${padT + innerH} Z`
          return (
            <g key={si}>
              {s.fill ? <path d={area} fill={s.color} opacity="0.08" /> : null}
              <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                    strokeDasharray={s.dashed ? "4 4" : ""} />
            </g>
          )
        })}
        {xLabels.map((d, i) => (
          <text key={i} x={xPos(d.x)} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--ink-3)">{d.label}</text>
        ))}
        {hover != null && (
          <g>
            <line x1={xPos(series[0].data[hover].x)} x2={xPos(series[0].data[hover].x)}
                  y1={padT} y2={padT + innerH} stroke="var(--ink)" strokeDasharray="2 3" opacity="0.4" />
            {series.map((s, si) => (
              <circle key={si} cx={xPos(s.data[hover].x)} cy={yPos(s.data[hover].y)}
                      r="4" fill="var(--bg)" stroke={s.color} strokeWidth="2" />
            ))}
          </g>
        )}
      </svg>
      {hover != null && (
        <div style={{
          position: "absolute", left: xPos(series[0].data[hover].x), top: 0,
          transform: "translate(-50%, -8px)",
          background: "var(--ink)", color: "var(--bg)",
          padding: "8px 12px", borderRadius: 8, fontSize: 12, fontFamily: "var(--font-mono)",
          whiteSpace: "nowrap", pointerEvents: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
        }}>
          <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 2 }}>
            {labelFmt ? labelFmt(series[0].data[hover]) : series[0].data[hover].label}
          </div>
          {series.map((s, si) => (
            <div key={si} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="dot" style={{ background: s.color }} />
              <span>{s.name}</span>
              <span style={{ marginLeft: "auto" }}>{fmt ? fmt(s.data[hover].y) : s.data[hover].y}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Donut({ data, size = 220, thickness = 28, centerLabel, centerValue }) {
  const total = data.reduce((a, b) => a + b.value, 0) || 1
  const r = (size - thickness) / 2
  const c = size / 2
  const circ = 2 * Math.PI * r
  let offset = 0
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-2)" strokeWidth={thickness} />
        {data.map((s, i) => {
          const len = (s.value / total) * circ
          const dasharray = `${len} ${circ - len}`
          const dashoffset = -offset
          offset += len
          return (
            <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
                    strokeDasharray={dasharray} strokeDashoffset={dashoffset}
                    transform={`rotate(-90 ${c} ${c})`} />
          )
        })}
      </svg>
      {centerValue && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", textAlign: "center" }}>
          <div className="label-up" style={{ fontSize: 10 }}>{centerLabel}</div>
          <div className="display" style={{ fontSize: 22, marginTop: 4 }}>{centerValue}</div>
        </div>
      )}
    </div>
  )
}

export function StackBar({ data, height = 12 }) {
  const total = data.reduce((a, b) => a + b.value, 0) || 1
  return (
    <div className="stackbar" style={{ height }}>
      {data.map((s, i) => (
        <span key={i} title={`${s.name} ${((s.value / total) * 100).toFixed(1)}%`}
              style={{ background: s.color, width: ((s.value / total) * 100) + "%" }} />
      ))}
    </div>
  )
}

export function BarChart({ data, height = 180, color = "var(--ink)", fmt, labelFmt }) {
  const wrapRef = useRef(null)
  const [w, setW] = useState(540)
  const [pinned, setPinned] = useState(null)   // bar tapped/clicked (sticky)
  const [hover, setHover] = useState(null)      // bar hovered
  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(es => setW(Math.max(240, es[0].contentRect.width)))
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])
  const active = hover ?? pinned
  const valueFmt = labelFmt || fmt || (v => String(v))
  const max = Math.max(...data.map(d => d.value)) || 1
  // Y-axis tick labels — measure them so wide amounts (e.g. "฿2,786.32") aren't
  // clipped on the left edge, which used to drop the ฿ and leading digits.
  const axisLabels = [0, 0.5, 1].map(p => (fmt ? fmt(max * p) : (max * p).toFixed(0)))
  const maxLabelLen = Math.max(...axisLabels.map(s => s.length))
  const padL = Math.max(36, Math.round(maxLabelLen * 6.5) + 10)
  const padR = 8, padT = 8, padB = 24
  const innerW = w - padL - padR
  const innerH = height - padT - padB
  // Cap slot width so few bars don't stretch across the whole chart
  const slotW = Math.min(innerW / data.length, 72)
  const groupW = slotW * data.length
  const xBase = padL + (innerW - groupW) / 2  // center bars in available space
  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} style={{ display: "block" }}>
        {[0, 0.5, 1].map((p, i) => {
          const y = padT + innerH - p * innerH
          const yv = max * p
          return (
            <g key={i}>
              <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="var(--line)" strokeDasharray={p === 0 ? "" : "2 4"} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">
                {fmt ? fmt(yv) : yv.toFixed(0)}
              </text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const bh = (d.value / max) * innerH
          const x = xBase + i * slotW + slotW * 0.15
          const y = padT + innerH - bh
          const bw = slotW * 0.70
          const cx = xBase + i * slotW + slotW / 2
          const isActive = active === i
          return (
            <g key={i}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setPinned(p => (p === i ? null : i))}>
              {/* full-height hit area so taps land even on tiny bars */}
              <rect x={xBase + i * slotW} y={padT} width={slotW} height={innerH} fill="transparent" />
              <rect x={x} y={y} width={bw} height={bh} fill={color} rx="3" opacity={active != null && !isActive ? 0.45 : 1} />
              <text x={cx} y={height - 6} textAnchor="middle" fontSize="10" fill={isActive ? "var(--ink)" : "var(--ink-3)"}>
                {d.label}
              </text>
              {isActive && (
                <text x={cx} y={Math.max(y - 6, 11)} textAnchor="middle" fontSize="11" fontWeight="600"
                  fill="var(--ink)" fontFamily="var(--font-mono)">
                  {valueFmt(d.value)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
