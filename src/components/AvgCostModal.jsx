// Average-cost calculator — what-if for buying more (new average) or selling
// (realized P/L). Opened from a holdings row, prefilled with the position.
// "Commit" hands the numbers to the real Buy (add lot) / Sell flows.
import { useState } from 'react'
import { TickerLogo } from './Nav'

function fmtP(n, ccy) {
  if (n == null || isNaN(n)) return '—'
  const prefix = ccy === 'USD' ? '$' : '฿'
  return prefix + n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const box = {
  background: 'var(--bg-2)', borderRadius: 10, padding: '10px 14px',
}
const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 14,
  border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)',
  outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-mono)',
}

export function AvgCostModal({ lang, holding, onClose, onCommit }) {
  const th   = lang === 'th'
  const ccy  = holding.nativeCcy || holding.currency || (holding.region === 'US' ? 'USD' : 'THB')
  const S0   = Number(holding.shares) || 0
  const A0   = Number(holding.costNative) || 0
  const live = Number.isFinite(Number(holding.priceNative)) && holding.priceNative > 0 ? Number(holding.priceNative) : null
  const isNew = !(S0 > 0)   // not held yet — planning a first buy; selling is meaningless

  const [mode,   setMode]   = useState('buy')
  const [qty,    setQty]    = useState('')
  const [budget, setBudget] = useState('')
  const [price,  setPrice]  = useState(live ? String(+live.toFixed(2)) : '')
  const [fee,    setFee]    = useState(holding.region === 'TH' ? '0.157' : '0')

  const q = parseFloat(qty)   || 0
  const p = parseFloat(price) || 0
  const f = (parseFloat(fee)  || 0) / 100

  // Two-way qty ⇄ budget. Unit cost includes fee: buy pays it, sell nets it.
  const unitOf = (pp, ff, m) => pp * (m === 'buy' ? 1 + ff : 1 - ff)
  const deriveBudget = (qv, pp = p, ff = f, m = mode) => {
    const u = unitOf(pp, ff, m), n = parseFloat(qv)
    setBudget(n > 0 && u > 0 ? String(+(n * u).toFixed(2)) : '')
  }
  const onQty    = v => { setQty(v); deriveBudget(v) }
  const onBudget = v => {
    setBudget(v)
    const u = unitOf(p, f, mode), n = parseFloat(v)
    setQty(n > 0 && u > 0 ? String(+(n / u).toFixed(4)) : '')
  }
  const onPrice  = v => { setPrice(v); deriveBudget(qty, parseFloat(v) || 0, f, mode) }
  const onFee    = v => { setFee(v); deriveBudget(qty, p, (parseFloat(v) || 0) / 100, mode) }
  const onMode   = m => { setMode(m); deriveBudget(qty, p, f, m) }

  // Buy: weighted average including fee
  const buyCost  = q * p * (1 + f)
  const newAvg   = (S0 + q) > 0 ? (S0 * A0 + buyCost) / (S0 + q) : 0
  const avgDelta = A0 > 0 && q > 0 ? (newAvg / A0 - 1) * 100 : 0
  const newPL    = live && newAvg > 0 ? (live / newAvg - 1) * 100 : null

  // Sell: realized vs average cost, net of fee. Average cost of the rest is unchanged.
  const sellQty     = Math.min(q, S0)
  const overSell    = q > S0
  const proceeds    = sellQty * p * (1 - f)
  const realized    = proceeds - sellQty * A0
  const realizedPct = sellQty * A0 > 0 ? (realized / (sellQty * A0)) * 100 : 0

  const valid = q > 0 && p > 0 && (mode === 'buy' || !overSell)

  const gainColor = (v) => v >= 0 ? 'var(--gain)' : 'var(--loss)'

  const Metric = ({ label, value, color }) => (
    <div style={box}>
      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-mono)', marginTop: 2, color: color || 'var(--ink)' }}>{value}</div>
    </div>
  )

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)',
               display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '72px 16px 16px' }}>
      <div style={{ background: 'var(--bg)', borderRadius: 18, padding: '24px 26px', width: '100%', maxWidth: 460,
                    maxHeight: 'calc(100vh - 100px)', overflowY: 'auto',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TickerLogo ticker={holding.ticker} logoUrl={holding.logo_url} region={holding.region} cls={holding.cls} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>🧮 {holding.ticker}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {isNew
                ? (th ? 'ยังไม่ได้ถือ — วางแผนซื้อครั้งแรก' : 'Not held yet — planning a first buy')
                : <>{th ? 'ถือ' : 'Holding'} {S0.toLocaleString(undefined, { maximumFractionDigits: 4 })} · {th ? 'ทุนเฉลี่ย' : 'avg cost'} {fmtP(A0, ccy)}</>}
              {live != null && <> · {th ? 'ราคา' : 'last'} {fmtP(live, ccy)}</>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 22, lineHeight: 1, padding: '4px 8px' }}>×</button>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[['buy', isNew ? (th ? 'ซื้อครั้งแรก' : 'First buy') : (th ? 'ซื้อเพิ่ม' : 'Buy more')], ['sell', th ? 'ขาย' : 'Sell']].map(([m, lbl]) => {
            const disabled = m === 'sell' && isNew
            return (
              <button key={m} onClick={() => !disabled && onMode(m)} disabled={disabled}
                title={disabled ? (th ? 'ยังไม่มีหุ้นให้ขาย' : 'Nothing to sell yet') : undefined}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
                  border: '1.5px solid var(--line)',
                  background: mode === m ? (m === 'buy' ? 'var(--accent)' : 'var(--loss)') : 'var(--bg-2)',
                  color: mode === m ? '#fff' : 'var(--ink-2)',
                }}>{lbl}</button>
            )
          })}
        </div>

        {/* Inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>{th ? 'จำนวนหุ้น' : 'Shares'}</div>
            <input type="number" inputMode="decimal" min="0" value={qty} autoFocus
              onChange={e => onQty(e.target.value)} placeholder="0" style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>
              {mode === 'buy' ? (th ? 'ราคาซื้อ' : 'Buy price') : (th ? 'ราคาขาย' : 'Sell price')} ({ccy === 'USD' ? '$' : '฿'})
            </div>
            <input type="number" inputMode="decimal" min="0" value={price}
              onChange={e => onPrice(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>
              {mode === 'buy'
                ? (th ? 'หรือใส่งบเงิน → คำนวณหุ้นให้' : 'Or enter a budget → shares')
                : (th ? 'หรือเงินที่อยากได้ → คำนวณหุ้นให้' : 'Or target proceeds → shares')} ({ccy === 'USD' ? '$' : '฿'})
            </div>
            <input type="number" inputMode="decimal" min="0" value={budget}
              onChange={e => onBudget(e.target.value)} placeholder="0.00" style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>{th ? 'ค่าธรรมเนียม % (รวม VAT)' : 'Fee % (incl. VAT)'}</div>
            <input type="number" inputMode="decimal" min="0" step="0.001" value={fee}
              onChange={e => onFee(e.target.value)} style={inputStyle} />
          </div>
        </div>

        {mode === 'sell' && overSell && (
          <div style={{ fontSize: 12, color: 'var(--loss)' }}>
            {th ? `ถืออยู่แค่ ${S0.toLocaleString()} หุ้น — ใช้จำนวนนั้นในการคำนวณ` : `You only hold ${S0.toLocaleString()} shares — using that amount`}
          </div>
        )}

        {/* ── Buy results ── */}
        {mode === 'buy' && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                {isNew
                  ? (th ? 'ทุนเฉลี่ยเริ่มต้น' : 'Starting avg cost')
                  : <>{th ? 'ทุนเฉลี่ย' : 'Avg cost'} {fmtP(A0, ccy)} →</>}
              </span>
              <span style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{q > 0 ? fmtP(newAvg, ccy) : '—'}</span>
              {q > 0 && !isNew && (
                <span style={{ fontSize: 13, fontWeight: 600, color: avgDelta >= 0 ? 'var(--loss)' : 'var(--gain)' }}>
                  {avgDelta >= 0 ? '+' : ''}{avgDelta.toFixed(1)}%
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <Metric label={th ? 'หุ้นรวม' : 'Total shares'} value={(S0 + q).toLocaleString(undefined, { maximumFractionDigits: 4 })} />
              <Metric label={th ? 'ใช้เงินเพิ่ม' : 'Cash needed'} value={q > 0 ? fmtP(buyCost, ccy) : '—'} />
              <Metric label={th ? `P/L ใหม่${live ? '' : ' (ไม่มีราคา)'}` : 'New P/L'}
                value={newPL != null && q > 0 ? (newPL >= 0 ? '+' : '') + newPL.toFixed(1) + '%' : '—'}
                color={newPL != null && q > 0 ? gainColor(newPL) : undefined} />
            </div>
            {q > 0 && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                {isNew
                  ? (th
                    ? <>จุดคุ้มทุนอยู่ที่ {fmtP(newAvg, ccy)} (รวมค่าธรรมเนียมแล้ว){newPL != null && <> — ราคาปัจจุบัน{newPL >= 0 ? 'สูงกว่า' : 'ต่ำกว่า'}ทุน {Math.abs(newPL).toFixed(1)}%</>}</>
                    : <>Break-even is {fmtP(newAvg, ccy)} (fees included){newPL != null && <> — current price is {Math.abs(newPL).toFixed(1)}% {newPL >= 0 ? 'above' : 'below'} it</>}</>)
                  : (th
                    ? <>จุดคุ้มทุนขยับจาก {fmtP(A0, ccy)} ไปที่ {fmtP(newAvg, ccy)}{newPL != null && <> — ราคาปัจจุบัน{newPL >= 0 ? 'สูงกว่า' : 'ต่ำกว่า'}ทุนใหม่ {Math.abs(newPL).toFixed(1)}%</>}</>
                    : <>Break-even moves from {fmtP(A0, ccy)} to {fmtP(newAvg, ccy)}{newPL != null && <> — current price is {Math.abs(newPL).toFixed(1)}% {newPL >= 0 ? 'above' : 'below'} the new cost</>}</>)}
              </div>
            )}
          </>
        )}

        {/* ── Sell results ── */}
        {mode === 'sell' && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{th ? 'กำไร/ขาดทุนรับรู้' : 'Realized P/L'}</span>
              <span style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: gainColor(realized) }}>
                {q > 0 ? (realized >= 0 ? '+' : '−') + fmtP(Math.abs(realized), ccy) : '—'}
              </span>
              {q > 0 && (
                <span style={{ fontSize: 13, fontWeight: 600, color: gainColor(realized) }}>
                  {realizedPct >= 0 ? '+' : ''}{realizedPct.toFixed(1)}%
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <Metric label={th ? 'หุ้นคงเหลือ' : 'Shares left'} value={(S0 - sellQty).toLocaleString(undefined, { maximumFractionDigits: 4 })} />
              <Metric label={th ? 'เงินที่ได้รับ' : 'Proceeds'} value={q > 0 ? fmtP(proceeds, ccy) : '—'} />
              <Metric label={th ? 'ทุนเฉลี่ยคงเหลือ' : 'Avg cost left'} value={fmtP(A0, ccy)} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {th ? 'วิธีทุนถัวเฉลี่ย: การขายไม่เปลี่ยนทุนเฉลี่ยของหุ้นที่เหลือ' : 'Average-cost method: selling does not change the remaining average cost'}
            </div>
          </>
        )}

        {/* Footer — commit only where the page can open the real trade flows */}
        <div style={{ display: 'flex', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>{th ? 'ปิด' : 'Close'}</button>
          {onCommit && (
            <button className="btn" style={{ flex: 1.4 }} disabled={!valid}
              onClick={() => onCommit(mode, { qty: mode === 'sell' ? sellQty : q, price: p })}>
              {th ? 'บันทึกเป็นธุรกรรมจริง' : 'Record as a real trade'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
