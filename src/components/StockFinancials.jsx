import { useState, useRef, useCallback } from 'react'

const LINE = 'var(--line)'

function AnalysisText({ text, loading, accent }) {
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.8, color: 'var(--ink-2)' }}>
      {text.split('\n').map((line, i) => {
        const clean = line.replace(/\*\*(.*?)\*\*/g, '$1')
        if (line.startsWith('## ')) return (
          <div key={i} style={{
            fontWeight: 600, fontSize: 11, color: accent.color,
            textTransform: 'uppercase', letterSpacing: '0.08em',
            marginTop: i === 0 ? 0 : 14, marginBottom: 5,
          }}>
            {line.slice(3)}
          </div>
        )
        if (line.startsWith('- ') || line.startsWith('• ')) return (
          <div key={i} style={{ paddingLeft: 10 }}>· {clean.slice(2)}</div>
        )
        if (!line.trim()) return <div key={i} style={{ height: 4 }} />
        return <div key={i}>{clean}</div>
      })}
      {loading && <span style={{ opacity: 0.35 }}>▌</span>}
    </div>
  )
}

export function StockFinancials({ symbol, lang, accentColor }) {
  const th     = lang === 'th'
  const isThai = symbol?.endsWith('.BK')
  const accent = accentColor || { color: '#1D9E75', border: '#1D9E75' }

  const [analysis,  setAnalysis]  = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [fileName,  setFileName]  = useState(null)
  const [error,     setError]     = useState(null)
  const [dragging,  setDragging]  = useState(false)
  const inputRef = useRef(null)

  const processFile = useCallback(async (file) => {
    if (!file) return

    const validType = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'].includes(file.type)
      || file.name.toLowerCase().match(/\.(pdf|png|jpg|jpeg)$/)
    if (!validType) {
      setError(th ? 'รองรับเฉพาะ PDF, PNG, JPG' : 'Supports PDF, PNG, JPG only')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(th ? 'ไฟล์ใหญ่เกินไป (สูงสุด 10 MB)' : 'File too large (max 10 MB)')
      return
    }

    setError(null)
    setFileName(file.name)
    setLoading(true)
    setAnalysis(null)

    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64   = e.target.result.split(',')[1]
      const mimeType = file.type || 'application/pdf'
      try {
        const res = await fetch('/api/analyze-doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: base64, mimeType, lang, ticker: symbol, name: symbol }),
        })
        if (!res.ok) throw new Error('api_error')

        const r = res.body.getReader()
        const dec = new TextDecoder()
        let text = ''
        while (true) {
          const { done, value } = await r.read()
          if (done) break
          text += dec.decode(value, { stream: true })
          setAnalysis(text)
        }
      } catch {
        setError(th ? 'เกิดข้อผิดพลาด กรุณาลองใหม่' : 'Error occurred, please try again')
        setAnalysis(null)
      } finally {
        setLoading(false)
      }
    }
    reader.readAsDataURL(file)
  }, [lang, symbol, th])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const reset = () => { setAnalysis(null); setFileName(null); setError(null); setLoading(false) }

  // ── Upload state ──────────────────────────────────────────────────────────
  if (!analysis && !loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        style={{
          border: `1.5px dashed ${dragging ? accent.border : LINE}`,
          borderRadius: 12,
          padding: '36px 20px',
          textAlign: 'center',
          cursor: 'pointer',
          background: dragging ? `${accent.color}0d` : 'transparent',
          transition: 'border-color 0.15s, background 0.15s',
          userSelect: 'none',
        }}
      >
        <div style={{ fontSize: 30, marginBottom: 10 }}>📄</div>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-1)', marginBottom: 5 }}>
          {th ? 'อัปโหลดงบการเงิน' : 'Upload Financial Statement'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>
          {th ? 'ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือก' : 'Drag & drop or click to select'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', background: 'var(--bg-2)', display: 'inline-block', padding: '3px 10px', borderRadius: 20 }}>
          PDF · PNG · JPG
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        style={{ display: 'none' }}
        onChange={e => { processFile(e.target.files[0]); e.target.value = '' }}
      />

      {/* Where to find */}
      <div style={{ border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '12px 14px', fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.9 }}>
        <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          {th ? 'หาไฟล์ได้จาก' : 'Where to find'}
        </div>
        {isThai ? (
          <>
            <div>🇹🇭 <span style={{ fontWeight: 500 }}>set.or.th</span> → ค้นหาหุ้น → งบการเงิน</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', paddingLeft: 22 }}>
              ดาวน์โหลด PDF งบรายปี (56-1) หรืองบรายไตรมาส
            </div>
          </>
        ) : (
          <>
            <div>🇺🇸 <span style={{ fontWeight: 500 }}>sec.gov</span> → EDGAR → {symbol} → 10-K / 10-Q</div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', paddingLeft: 22 }}>
              Or from the company's Investor Relations page
            </div>
          </>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#D85A30', background: '#FFF0EC', border: '0.5px solid #D85A30', borderRadius: 6, padding: '8px 12px' }}>
          ⚠ {error}
        </div>
      )}
    </div>
  )

  // ── Loading / Analysis state ──────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* File bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span>📄</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</span>
        </div>
        {!loading && (
          <button onClick={reset} style={{
            flexShrink: 0, fontSize: 11, padding: '3px 10px',
            border: `0.5px solid ${LINE}`, borderRadius: 5,
            background: 'transparent', cursor: 'pointer',
            color: 'var(--ink-2)', fontFamily: 'inherit',
          }}>
            {th ? 'เปลี่ยนไฟล์' : 'Change file'}
          </button>
        )}
      </div>

      {/* Analysis card */}
      <div style={{
        border: `0.5px solid ${LINE}`,
        borderLeft: `2.5px solid ${accent.border}`,
        borderRadius: 8,
        padding: '14px 16px',
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: accent.color, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
          ✦ AI {th ? 'วิเคราะห์งบการเงิน' : 'Financial Analysis'}
        </div>

        {loading && !analysis && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {[95, 80, 65, 88, 72, 50].map((w, i) => (
              <div key={i} className="shimmer" style={{ height: 11, borderRadius: 4, background: 'var(--bg-2)', width: `${w}%` }} />
            ))}
          </div>
        )}

        {analysis && <AnalysisText text={analysis} loading={loading} accent={accent} />}
      </div>
    </div>
  )
}
