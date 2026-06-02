// CalcInput — drop-in replacement for <input type="number">
// Lets the user type math expressions like "30000*3" or "523.5+12" and
// evaluates them on Enter / Tab / blur.  A live preview appears below while
// the expression is being typed.
//
// API matches a plain <input> so it's a one-line swap:
//   onChange fires with a synthetic { target: { value: string } }.
//   All other props (placeholder, required, disabled, style, className…) pass through.

import { useState, useEffect, useRef } from 'react'

// Whitelist-only evaluator — digits + four operators + parens + dots only.
// Returns a number when valid, null otherwise.
function safeEval(expr) {
  const clean = String(expr).replace(/\s/g, '').replace(/,/g, '')
  if (!clean) return null
  if (!/[+\-*/()]/.test(clean)) return null          // plain number → no eval needed
  if (!/^[\d+\-*/.()]+$/.test(clean)) return null   // reject unknown chars
  if (/\*\*/.test(clean)) return null                // reject exponentiation
  try {
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${clean})`)()
    if (typeof result !== 'number' || !isFinite(result)) return null
    return result
  } catch { return null }
}

function fmtPreview(n) {
  if (n == null) return ''
  const sign = n < 0 ? '−' : ''
  const abs  = Math.abs(n)
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(2) + 'M'
  if (abs >= 1_000)     return sign + abs.toLocaleString('th-TH', { maximumFractionDigits: 2 })
  return sign + abs.toFixed(4).replace(/\.?0+$/, '')
}

export function CalcInput({ value, onChange, style, className, onKeyDown, onBlur, ...rest }) {
  const [raw,     setRaw]     = useState(value != null ? String(value) : '')
  const [preview, setPreview] = useState(null)
  const lastExt = useRef(value)

  // Sync when the parent resets or changes value externally
  useEffect(() => {
    if (value !== lastExt.current) {
      lastExt.current = value
      if (preview === null) setRaw(value != null ? String(value) : '')
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e) => {
    const val = e.target.value
    setRaw(val)
    const result = safeEval(val)
    setPreview(result)
    // Plain numbers propagate instantly; expressions wait for commit
    if (result === null) onChange?.({ ...e, target: { ...e.target, value: val } })
  }

  const commit = () => {
    if (preview !== null) {
      const rounded = Math.round(preview * 1e8) / 1e8   // kill floating-point noise
      const str = String(rounded)
      setRaw(str)
      setPreview(null)
      lastExt.current = str
      onChange?.({ target: { value: str } })
    } else {
      setPreview(null)
    }
  }

  const handleKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === 'Tab') && preview !== null) {
      e.preventDefault()
      commit()
    }
    onKeyDown?.(e)
  }

  const handleBlur = (e) => { commit(); onBlur?.(e) }

  // Tint the text while composing an expression
  const inputStyle = preview !== null
    ? { ...style, color: 'var(--accent-ink)', fontFamily: 'var(--font-mono, monospace)' }
    : style

  return (
    // position:relative so the preview pill can anchor below the input
    <div style={{ position: 'relative', display: 'block' }}>
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        value={raw}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={inputStyle}
        className={className}
      />
      {preview !== null && (
        <div style={{
          position:      'absolute',
          top:           'calc(100% - 2px)',
          left:          0,
          zIndex:        30,
          padding:       '2px 10px 5px',
          fontSize:      11,
          fontFamily:    'var(--font-mono, monospace)',
          color:         'var(--accent-ink)',
          background:    'var(--accent-soft)',
          borderRadius:  '0 0 7px 7px',
          pointerEvents: 'none',
          whiteSpace:    'nowrap',
          lineHeight:    1.4,
        }}>
          = {fmtPreview(preview)}
        </div>
      )}
    </div>
  )
}
