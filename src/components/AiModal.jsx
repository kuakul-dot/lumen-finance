// Shared AI-analysis modal — used by Dashboard (portfolio overview) and Tools
// (rebalance explainer). Renders the streaming assistant reply as light
// markdown plus a chat input for follow-up questions. Pure presentation; the
// state + streaming logic live in useAiAnalysis().
import { useEffect, useRef } from 'react'
import { Icon } from './Nav'

const PROVIDER_LABELS = { gemini: 'Google Gemini', claude: 'Anthropic Claude', openai: 'OpenAI' }

export function AiAnalysisModal({
  th, title,
  loading, error, provider,
  history = [],
  chatInput, chatLoading, canChat,
  onChatInput, onSend, onClose, onRetry,
}) {
  const providerLabel = PROVIDER_LABELS[provider] || 'AI'
  const scrollRef = useRef(null)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [history.length, chatLoading, history[history.length - 1]?.content?.length])
  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend?.() }
  }
  const heading = title || (th ? 'วิเคราะห์ด้วย AI' : 'AI analysis')
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg)', borderRadius: 18, padding: 24, width: '100%', maxWidth: 580, maxHeight: '88vh', display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="spark" size={15} /> {heading}
            </h3>
            {provider && (
              <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                {th ? 'ขับเคลื่อนโดย' : 'Powered by'} <span style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{providerLabel}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ink-3)', padding: 4 }}>✕</button>
        </div>
        <div ref={scrollRef} style={{ overflow: 'auto', flex: 1, fontSize: 13, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading && (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              {th ? 'กำลังให้ AI วิเคราะห์… ใช้เวลาประมาณ 5-15 วินาที' : 'AI is analysing… (5-15 sec)'}
            </div>
          )}
          {history.map((m, i) => (
            m.role === 'assistant' ? (
              <div key={i}><Markdownish text={m.content} /></div>
            ) : (
              <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '85%', background: 'var(--accent-soft)', color: 'var(--accent-ink)', padding: '10px 14px', borderRadius: '14px 14px 4px 14px', fontSize: 13 }}>
                {m.content}
              </div>
            )
          ))}
          {chatLoading && (
            <div style={{ alignSelf: 'flex-start', color: 'var(--ink-3)', fontSize: 12, fontStyle: 'italic', padding: '4px 0' }}>
              {th ? 'AI กำลังคิด…' : 'AI is thinking…'}
            </div>
          )}
          {error && (() => {
            const rateLimited = /429|rate_limit/i.test(error)
            const timedOut    = /504|timeout|timed out/i.test(error)
            return (
              <div style={{ padding: 14, borderRadius: 10, background: 'var(--loss-soft)', color: 'var(--loss)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div>⚠ {error}</div>
                {timedOut && (
                  <div style={{ fontSize: 11, opacity: 0.85 }}>
                    💡 {th ? 'AI ตอบช้าเกินเวลา · ลองส่งคำถามที่สั้นลง หรือกดส่งใหม่อีกครั้ง' : 'AI took too long · try a shorter question or send again'}
                  </div>
                )}
                {rateLimited && !timedOut && (
                  <div style={{ fontSize: 11, opacity: 0.85 }}>
                    💡 {th ? 'ถ้าเป็น rate limit จริง รอ 30-60 วินาทีแล้วลองใหม่' : 'If it\'s a real rate limit, wait 30-60 seconds and retry'}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
        {canChat && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={chatInput}
              onChange={e => onChatInput?.(e.target.value)}
              onKeyDown={handleKey}
              placeholder={th ? "ถามต่อ เช่น 'ทำไม US ถึงเสี่ยง?', 'ถ้าซื้อ Bond เพิ่มดีไหม?'" : "Ask a follow-up, e.g. 'Why is US risky?', 'Should I add bonds?'"}
              rows={1}
              disabled={chatLoading}
              style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none', fontSize: 13, fontFamily: 'inherit', resize: 'none', maxHeight: 120, lineHeight: 1.4 }} />
            <button className="btn" disabled={chatLoading || !chatInput.trim()} onClick={onSend}
              style={{ padding: '10px 14px', flexShrink: 0 }}>
              {th ? 'ส่ง' : 'Send'}
            </button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          {error && <button className="btn btn-outline" style={{ flex: 1 }} onClick={onRetry}>{th ? 'ลองอีกครั้ง' : 'Retry'}</button>}
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>{th ? 'ปิด' : 'Close'}</button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 10, textAlign: 'center' }}>
          {th ? 'ข้อมูลพอร์ตถูกส่งไปยังผู้ให้บริการ AI · ไม่มีชื่อ/อีเมล/เลขบัญชี' : 'Portfolio data is sent to the AI provider · no names/emails/account IDs'}
        </p>
      </div>
    </div>
  )
}

// Minimal markdown renderer for ## headings, * / - bullets, **bold**
export function Markdownish({ text }) {
  const blocks = []
  let listBuf = null
  text.split('\n').forEach((raw) => {
    const line = raw.trimEnd()
    if (/^\s*$/.test(line)) { if (listBuf) { blocks.push({ t: 'list', items: listBuf }); listBuf = null } ; return }
    if (/^##\s+/.test(line)) {
      if (listBuf) { blocks.push({ t: 'list', items: listBuf }); listBuf = null }
      blocks.push({ t: 'h', text: line.replace(/^##\s+/, '') }); return
    }
    if (/^\s*[-*]\s+/.test(line)) { ;(listBuf = listBuf || []).push(line.replace(/^\s*[-*]\s+/, '')); return }
    if (listBuf) { blocks.push({ t: 'list', items: listBuf }); listBuf = null }
    blocks.push({ t: 'p', text: line })
  })
  if (listBuf) blocks.push({ t: 'list', items: listBuf })
  const inline = (s) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g)
    return parts.map((p, i) => p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {blocks.map((b, i) => {
        if (b.t === 'h') return <h4 key={i} style={{ margin: '8px 0 2px', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{inline(b.text)}</h4>
        if (b.t === 'list') return (
          <ul key={i} style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
          </ul>
        )
        return <p key={i} style={{ margin: 0 }}>{inline(b.text)}</p>
      })}
    </div>
  )
}
