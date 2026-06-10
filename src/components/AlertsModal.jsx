// AlertsModal.jsx — Manage price alerts (view, add, delete)
//
// Exports:
//   AlertsContent  — shared state + UI (used by both wrappers below)
//   AlertsModal    — overlay modal, used by Portfolio page (pre-filled add)
//   AlertsPage     — full page, used by Nav bell (no backdrop → no ghost-click dismiss)

import { useState, useEffect, Component } from 'react'
import { TickerLogo } from './Nav'
import { loadAlerts, addAlert, removeAlert, clearTriggered, requestNotifPermission } from '../lib/alerts'

// ── Error boundary — prevents blank screen if AlertsContent crashes ────────────
class AlertsBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { console.error('[Alerts]', err, info?.componentStack) }
  render() {
    if (this.state.err) {
      const th = this.props.lang === 'th'
      const msg = this.state.err?.message || String(this.state.err)
      return (
        <div style={{ padding: '32px 20px', color: 'var(--ink-3)' }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
            <div style={{ fontSize: 14 }}>
              {th ? 'เกิดข้อผิดพลาด' : 'Something went wrong'}
            </div>
          </div>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', padding: '10px 14px',
                        borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)',
                        wordBreak: 'break-all', marginBottom: 16, color: 'var(--loss)' }}>
            {msg}
          </div>
          <div style={{ textAlign: 'center' }}>
            <button onClick={() => this.setState({ err: null })}
              style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--line)',
                       background: 'var(--accent)', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
              {th ? 'ลองใหม่' : 'Retry'}
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function fmtP(p, ccy) {
  if (p == null || isNaN(p)) return '—'
  const prefix = ccy === 'THB' ? '฿' : '$'
  const dp = p < 1 ? 4 : p < 100 ? 2 : 0
  return prefix + p.toLocaleString('en', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

function distPct(target, current) {
  if (!current || !target) return ''
  const d = ((target - current) / current) * 100
  return (d > 0 ? '+' : '') + d.toFixed(1) + '%'
}

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Shared alerts UI ─────────────────────────────────────────────────────────
// Props:
//   lang    — 'th' | 'en'
//   onDone  — called when user taps × (modal) or ← Back (page)
//   prefill — optional { ticker, name, region, cls, yahooSym, livePrice, currency }
//   isPage  — false → shows × close button  |  true → shows ← Back button
function AlertsContent({ lang, onDone, prefill, isPage = false }) {
  const th = lang === 'th'
  const [alerts, setAlerts]     = useState([])
  const [tab, setTab]           = useState(prefill ? 'add' : 'list')
  const [notifOk, setNotifOk]   = useState(window.Notification?.permission === 'granted')
  const [saved, setSaved]       = useState(false)

  const [fTicker,    setFTicker]    = useState(prefill?.ticker    || '')
  const [fName,      setFName]      = useState(prefill?.name      || '')
  const [fYahooSym,  setFYahooSym]  = useState(prefill?.yahooSym  || '')
  const [fRegion,    setFRegion]    = useState(prefill?.region    || 'TH')
  const [fCls,       setFCls]       = useState(prefill?.cls       || 'Equity')
  const [fPrice,     setFPrice]     = useState(prefill?.livePrice ? String(prefill.livePrice) : '')
  const [fDirection, setFDirection] = useState('below')
  const [fLabel,     setFLabel]     = useState('Custom')
  const [fCurrency,  setFCurrency]  = useState(prefill?.currency  || 'THB')

  const reload = () => setAlerts(loadAlerts())
  useEffect(() => { reload() }, [])
  useEffect(() => {
    const h = () => reload()
    window.addEventListener('lumen-alerts-changed', h)
    return () => window.removeEventListener('lumen-alerts-changed', h)
  }, [])

  const handleAdd = async (e) => {
    e.preventDefault()
    const targetPrice = parseFloat(fPrice)
    if (!fTicker || !fYahooSym || !targetPrice || !Number.isFinite(targetPrice)) return
    if (!notifOk) {
      const ok = await requestNotifPermission()
      setNotifOk(ok)
    }
    addAlert({
      ticker: fTicker.toUpperCase(),
      name: fName || fTicker,
      region: fRegion, cls: fCls,
      yahooSym: fYahooSym, targetPrice,
      direction: fDirection, label: fLabel || 'Custom', currency: fCurrency,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
    reload()
    setTab('list')
  }

  const active    = alerts.filter(a => a.active && !a.triggered)
  const triggered = alerts.filter(a => a.triggered).slice(0, 10)

  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--line)', background: 'var(--bg-2)', color: 'var(--ink)',
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  }

  return (
    <>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--font-display)' }}>
          🔔 {th ? 'การแจ้งเตือนราคา' : 'Price Alerts'}
        </h3>
        {isPage ? (
          <button onClick={onDone} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-2)',
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 14, fontWeight: 500,
            padding: '6px 0', touchAction: 'manipulation',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>
            </svg>
            {th ? 'กลับ' : 'Back'}
          </button>
        ) : (
          <button onClick={onDone} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)',
            lineHeight: 1, padding: '8px 10px', fontSize: 24, touchAction: 'manipulation',
          }}>×</button>
        )}
      </div>

      {/* Notification permission banner */}
      {!notifOk && 'Notification' in window && window.Notification?.permission !== 'denied' && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, fontSize: 12,
          background: 'oklch(0.96 0.06 75)', color: 'oklch(0.40 0.12 75)',
          border: '1px solid oklch(0.85 0.10 75)', display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <span style={{ fontSize: 16 }}>🔕</span>
          <span style={{ flex: 1 }}>
            {th ? 'อนุญาต browser notification เพื่อรับแจ้งเตือน' : 'Enable browser notifications to receive alerts'}
          </span>
          <button onClick={async () => setNotifOk(await requestNotifPermission())}
            style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: '1px solid currentColor', background: 'transparent', cursor: 'pointer', color: 'oklch(0.40 0.12 75)', whiteSpace: 'nowrap' }}>
            {th ? 'อนุญาต' : 'Allow'}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
        {[
          { id: 'list', label: th ? `แจ้งเตือน (${active.length})` : `Alerts (${active.length})` },
          { id: 'add',  label: th ? '+ ตั้งแจ้งเตือน' : '+ New Alert' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            border: 'none',
            background: tab === t.id ? 'var(--accent)' : 'transparent',
            color: tab === t.id ? '#fff' : 'var(--ink-3)',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── LIST tab ─────────────────────────────────────────────────────── */}
      {tab === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {active.length === 0 && triggered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-3)', fontSize: 13 }}>
              {th ? 'ยังไม่มีการแจ้งเตือน — กด "+ ตั้งแจ้งเตือน"' : 'No alerts yet — click "+ New Alert"'}
            </div>
          )}

          {active.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>
                {th ? 'กำลังติดตาม' : 'Active'}
              </div>
              {active.map(a => (
                <div key={a.id} style={{
                  display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 10, alignItems: 'center',
                  padding: '10px 12px', borderRadius: 10, background: 'var(--bg-2)',
                  border: '1px solid var(--line)',
                }}>
                  <TickerLogo ticker={a.ticker} region={a.region} cls={a.cls} size={28} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {a.ticker} — {a.label}
                      <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 4,
                        background: a.direction === 'above' ? 'var(--loss-soft)' : 'var(--gain-soft)',
                        color: a.direction === 'above' ? 'var(--loss)' : 'var(--gain)',
                      }}>
                        {a.direction === 'above' ? '▲ above' : '▼ below'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      {fmtP(a.targetPrice, a.currency)}
                      {a.livePrice && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.6 }}>{distPct(a.targetPrice, a.livePrice)}</span>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 1 }}>{timeAgo(a.createdAt)}</div>
                  </div>
                  <button onClick={() => removeAlert(a.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: 4, fontSize: 16, lineHeight: 1 }}
                    title={th ? 'ลบ' : 'Delete'}>×</button>
                </div>
              ))}
            </>
          )}

          {triggered.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>
                  {th ? 'ถูกกระตุ้นแล้ว' : 'Triggered'}
                </div>
                <button onClick={clearTriggered}
                  style={{ fontSize: 10, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  {th ? 'ล้างทั้งหมด' : 'Clear all'}
                </button>
              </div>
              {triggered.map(a => (
                <div key={a.id} style={{
                  display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 10, alignItems: 'center',
                  padding: '8px 12px', borderRadius: 10, opacity: 0.5,
                  border: '1px dashed var(--line)',
                }}>
                  <TickerLogo ticker={a.ticker} region={a.region} cls={a.cls} size={24} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      ✅ {a.ticker} — {a.label} @ {fmtP(a.targetPrice, a.currency)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{timeAgo(a.triggeredAt)}</div>
                  </div>
                  <button onClick={() => removeAlert(a.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: 4, fontSize: 16, lineHeight: 1 }}>×</button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── ADD tab ──────────────────────────────────────────────────────── */}
      {tab === 'add' && (
        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {saved && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--gain-soft)', color: 'var(--gain)', fontSize: 13, fontWeight: 500 }}>
              ✅ {th ? 'ตั้งแจ้งเตือนสำเร็จ' : 'Alert saved!'}
            </div>
          )}

          {/* Ticker row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-3)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>Ticker</label>
              <input required value={fTicker} onChange={e => setFTicker(e.target.value.toUpperCase())}
                placeholder="e.g. AOT" style={inputStyle}
                readOnly={!!prefill?.ticker}
              />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-3)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
                Yahoo Symbol
              </label>
              <input required value={fYahooSym} onChange={e => setFYahooSym(e.target.value)}
                placeholder="e.g. AOT.BK" style={inputStyle}
                readOnly={!!prefill?.yahooSym}
              />
            </div>
          </div>

          {/* Target price */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-3)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
              {th ? 'ราคาเป้าหมาย' : 'Target Price'}
              {prefill?.livePrice && (
                <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 8, color: 'var(--ink-3)', textTransform: 'none' }}>
                  ({th ? 'ปัจจุบัน:' : 'now:'} {fmtP(prefill.livePrice, fCurrency)})
                </span>
              )}
            </label>
            <input required type="number" step="any" value={fPrice} onChange={e => setFPrice(e.target.value)}
              placeholder="0.00" style={inputStyle} />
          </div>

          {/* Direction + Label */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-3)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
                {th ? 'เงื่อนไข' : 'Condition'}
              </label>
              <select value={fDirection} onChange={e => setFDirection(e.target.value)} style={inputStyle}>
                <option value="below">▼ {th ? 'ราคาลงถึง (แนวรับ)' : 'Price drops to'}</option>
                <option value="above">▲ {th ? 'ราคาขึ้นถึง (แนวต้าน)' : 'Price rises to'}</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-3)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
                {th ? 'ป้ายชื่อ' : 'Label'}
              </label>
              <input value={fLabel} onChange={e => setFLabel(e.target.value)}
                placeholder="e.g. S1, R1, Custom" style={inputStyle} />
            </div>
          </div>

          {/* Region + Class (hidden if prefilled) */}
          {!prefill && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-3)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>Region</label>
                <select value={fRegion} onChange={e => setFRegion(e.target.value)} style={inputStyle}>
                  <option value="TH">TH</option>
                  <option value="US">US</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-3)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>Class</label>
                <select value={fCls} onChange={e => setFCls(e.target.value)} style={inputStyle}>
                  <option value="Equity">Equity</option>
                  <option value="ETF">ETF</option>
                  <option value="Crypto">Crypto</option>
                  <option value="Bond">Bond</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-3)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>CCY</label>
                <select value={fCurrency} onChange={e => setFCurrency(e.target.value)} style={inputStyle}>
                  <option value="THB">THB</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>
          )}

          {/* Name (hidden if prefilled) */}
          {!prefill && (
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-3)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
                {th ? 'ชื่อหลักทรัพย์' : 'Name'}
              </label>
              <input value={fName} onChange={e => setFName(e.target.value)}
                placeholder={th ? 'ชื่อบริษัท (ไม่บังคับ)' : 'Company name (optional)'} style={inputStyle} />
            </div>
          )}

          <button type="submit" className="btn" style={{ marginTop: 4 }}>
            🔔 {th ? 'ตั้งแจ้งเตือน' : 'Set Alert'}
          </button>
        </form>
      )}
    </>
  )
}

// ── AlertsModal ───────────────────────────────────────────────────────────────
// Overlay modal used by Portfolio page (pre-filled from a stock row bell icon).
// No backdrop-click-to-close: only × button dismisses.
export function AlertsModal({ lang, onClose, prefill }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200,
      padding: '72px 16px 16px',
    }}>
      <div style={{
        background: 'var(--bg)', borderRadius: 20, padding: '28px 24px',
        width: '100%', maxWidth: 480, maxHeight: 'calc(100vh - 88px)', overflowY: 'auto',
        boxShadow: '0 8px 48px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <AlertsContent lang={lang} onDone={onClose} prefill={prefill} />
      </div>
    </div>
  )
}

// ── AlertsPage ────────────────────────────────────────────────────────────────
// Full-page alerts view — used by the Nav bell button.
// Renders as normal page content: no overlay, no backdrop, no ghost-click risk.
// User closes by tapping ← Back or any nav link.
// NOTE: intentionally no fade-in class — animation-fill-mode:both starts at
//       opacity:0 and iOS Safari can leave it stuck there (blank white screen).
export function AlertsPage({ lang, onBack }) {
  return (
    <AlertsBoundary lang={lang}>
      <div className="shell" style={{ maxWidth: 680 }}>
        <div style={{
          background: 'var(--bg)', borderRadius: 20, padding: '28px 24px',
          display: 'flex', flexDirection: 'column', gap: 16,
          boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
        }}>
          <AlertsContent lang={lang} onDone={onBack} isPage />
        </div>
      </div>
    </AlertsBoundary>
  )
}
