// AlertsModal.jsx — Manage price alerts (view, add, delete)
// Opens from: Nav bell icon (manage mode) OR Portfolio row bell (pre-filled add)

import { useState, useEffect, useRef } from 'react'
import { Icon, TickerLogo } from './Nav'
import { loadAlerts, addAlert, removeAlert, clearTriggered, requestNotifPermission } from '../lib/alerts'

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

// ── AlertsModal ───────────────────────────────────────────────────────────────
// Props:
//   lang           — 'th' | 'en'
//   onClose        — close callback
//   prefill        — optional { ticker, name, region, cls, yahooSym, livePrice, currency }
//                    if provided, opens in "add" tab pre-filled
export function AlertsModal({ lang, onClose, prefill }) {
  const th = lang === 'th'
  const [alerts, setAlerts]     = useState([])
  const [tab, setTab]           = useState(prefill ? 'add' : 'list')
  const [notifOk, setNotifOk]   = useState(Notification?.permission === 'granted')
  const [saved, setSaved]       = useState(false)  // brief "saved" flash

  // Form state
  const [fTicker,    setFTicker]    = useState(prefill?.ticker    || '')
  const [fName,      setFName]      = useState(prefill?.name      || '')
  const [fYahooSym,  setFYahooSym]  = useState(prefill?.yahooSym  || '')
  const [fRegion,    setFRegion]    = useState(prefill?.region    || 'TH')
  const [fCls,       setFCls]       = useState(prefill?.cls       || 'Equity')
  const [fPrice,     setFPrice]     = useState(prefill?.livePrice ? String(prefill.livePrice) : '')
  const [fDirection, setFDirection] = useState('below')  // default: alert when price drops to target
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

    // Request notification permission on first add
    if (!notifOk) {
      const ok = await requestNotifPermission()
      setNotifOk(ok)
    }

    addAlert({
      ticker: fTicker.toUpperCase(),
      name: fName || fTicker,
      region: fRegion,
      cls: fCls,
      yahooSym: fYahooSym,
      targetPrice,
      direction: fDirection,
      label: fLabel || 'Custom',
      currency: fCurrency,
    })

    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
    reload()
    setTab('list')
  }

  // iOS Safari ghost-click guard: record mount time so the backdrop onClick
  // cannot fire within 300 ms of opening (prevents immediate auto-dismiss on tap).
  const mountedAt = useRef(Date.now())

  const active    = alerts.filter(a => a.active && !a.triggered)
  const triggered = alerts.filter(a => a.triggered).slice(0, 10)

  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--line)', background: 'var(--bg-2)', color: 'var(--ink)',
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  }

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
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--font-display)' }}>
            🔔 {th ? 'การแจ้งเตือนราคา' : 'Price Alerts'}
          </h3>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)',
            lineHeight: 1, padding: '8px 10px', fontSize: 24, touchAction: 'manipulation',
          }}>×</button>
        </div>

        {/* Notification permission banner */}
        {!notifOk && 'Notification' in window && Notification.permission !== 'denied' && (
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

            {/* Active alerts */}
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
                      <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 1 }}>
                        {timeAgo(a.createdAt)}
                      </div>
                    </div>
                    <button onClick={() => removeAlert(a.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', padding: 4, fontSize: 16, lineHeight: 1 }}
                      title={th ? 'ลบ' : 'Delete'}>×</button>
                  </div>
                ))}
              </>
            )}

            {/* Triggered alerts */}
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
                  {th ? 'Yahoo Symbol' : 'Yahoo Symbol'}
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

            <button type="submit" className="btn" style={{ marginTop: 4 }}>
              🔔 {th ? 'ตั้งแจ้งเตือน' : 'Set Alert'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
