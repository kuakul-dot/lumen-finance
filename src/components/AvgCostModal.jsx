// Average-cost calculator — what-if for buying more (new average), selling
// (realized P/L), or reaching a Target weight / value.
// Opened from a holdings row, prefilled with the position.
// "Commit" hands the numbers to the real Buy (add lot) / Sell flows.
import { useState, useMemo } from 'react'
import { TickerLogo } from './Nav'

// Map holding cls+region → rebalance target key (same logic as Tools.jsx CLASS_OF)
function classKey(cls, region) {
  if (cls === 'Equity' || cls === 'ETF') return region === 'TH' ? 'TH Equity' : 'US Equity'
  if (cls === 'Bond' || cls === 'MutualFund') return 'Bonds'
  if (cls === 'Commodity' || cls === 'GoldTH') return 'Gold'
  if (cls === 'Crypto') return 'Crypto'
  return 'Cash'
}

function loadRebalTarget(cls, region) {
  try {
    const targets = JSON.parse(localStorage.getItem('lumen_rebalance_targets') || '{}')
    const key = classKey(cls, region)
    const v = targets[key]
    return v != null ? +(v * 100).toFixed(1) : null
  } catch { return null }
}

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

export function AvgCostModal({ lang, holding, onClose, onCommit, totalPortfolio = 0, fxRate = 36 }) {
  const th   = lang === 'th'
  const ccy  = holding.nativeCcy || holding.currency || (holding.region === 'US' ? 'USD' : 'THB')
  const S0   = Number(holding.shares) || 0
  const A0   = Number(holding.costNative) || 0
  const live = Number.isFinite(Number(holding.priceNative)) && holding.priceNative > 0 ? Number(holding.priceNative) : null
  const isNew = !(S0 > 0)

  const [mode,     setMode]     = useState('buy')
  const [qty,      setQty]      = useState('')
  const [budget,   setBudget]   = useState('')
  const [price,    setPrice]    = useState(live ? String(+live.toFixed(2)) : '')
  const [fee,      setFee]      = useState(holding.region === 'TH' ? '0.157' : '0')
  // target mode — pre-fill % from saved rebalance targets
  const rebalPct = useMemo(() => loadRebalTarget(holding.cls, holding.region), [holding.cls, holding.region])
  const [tgtType,  setTgtType]  = useState('%')
  const [tgtInput, setTgtInput] = useState(() => rebalPct != null ? String(rebalPct) : '')

  const q = parseFloat(qty)   || 0
  const p = parseFloat(price) || 0
  const f = (parseFloat(fee)  || 0) / 100

  // Two-way qty ⇄ budget
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

  // Buy / sell calculations
  const buyCost  = q * p * (1 + f)
  const newAvg   = (S0 + q) > 0 ? (S0 * A0 + buyCost) / (S0 + q) : 0
  const avgDelta = A0 > 0 && q > 0 ? (newAvg / A0 - 1) * 100 : 0
  const newPL    = live && newAvg > 0 ? (live / newAvg - 1) * 100 : null

  const sellQty     = Math.min(q, S0)
  const overSell    = q > S0
  const proceeds    = sellQty * p * (1 - f)
  const realized    = proceeds - sellQty * A0
  const realizedPct = sellQty * A0 > 0 ? (realized / (sellQty * A0)) * 100 : 0

  // ── Target mode calculations ────────────────────────────────────────────────
  // totalPortfolio is in THB (portfolio display currency); convert to native for TH/US holdings.
  const totalInNative = totalPortfolio > 0
    ? (ccy === 'USD' ? totalPortfolio / fxRate : totalPortfolio)
    : 0
  const priceForCalc  = live || p || A0  // best price we have
  const curValueNative = S0 * priceForCalc

  const tgtNum = parseFloat(tgtInput) || 0
  let tgtDelta = null          // + = buy, − = sell (in shares)
  let tgtCash  = null          // absolute cash needed / received
  let tgtResultWt = null       // resulting weight (%)

  if (priceForCalc > 0 && tgtNum > 0) {
    if (tgtType === '%' && totalInNative > 0) {
      const T = tgtNum / 100
      if (T > 0 && T < 1) {
        tgtDelta    = (T * totalInNative - curValueNative) / (priceForCalc * (1 - T))
        tgtResultWt = tgtNum  // algebraically exact
      }
    } else if (tgtType === '฿') {
      tgtDelta = (tgtNum - curValueNative) / priceForCalc
      // resulting weight (portfolio changes by the traded amount)
      if (totalInNative > 0) {
        const addedNative = tgtDelta * priceForCalc
        const newTotalNative = totalInNative + (addedNative > 0 ? addedNative : 0)
        tgtResultWt = newTotalNative > 0 ? (tgtNum / newTotalNative) * 100 : null
      }
    }
    if (tgtDelta !== null) {
      tgtCash = Math.abs(tgtDelta) * priceForCalc * (tgtDelta >= 0 ? 1 + f : 1 - f)
    }
  }

  const tgtAction = tgtDelta !== null ? (tgtDelta >= 0 ? 'buy' : 'sell') : null
  const tgtSharesToShow = tgtDelta !== null ? Math.abs(tgtDelta) : null

  const noPortfolio = totalPortfolio === 0 && tgtType === '%'

  const valid = q > 0 && p > 0 && (mode !== 'sell' || !overSell)
  const tgtValid = tgtDelta !== null && priceForCalc > 0

  const gainColor = (v) => v >= 0 ? 'var(--gain)' : 'var(--loss)'

  const Metric = ({ label, value, color, sub }) => (
    <div style={box}>
      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, fontFamily: 'var(--font-mono)', marginTop: 2, color: color || 'var(--ink)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</div>}
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
          {[
            ['buy',    isNew ? (th ? 'ซื้อครั้งแรก' : 'First buy') : (th ? 'ซื้อเพิ่ม' : 'Buy more')],
            ['sell',   th ? 'ขาย' : 'Sell'],
            ['target', th ? '🎯 Target' : '🎯 Target'],
          ].map(([m, lbl]) => {
            const disabled = m === 'sell' && isNew
            const active = mode === m
            return (
              <button key={m} onClick={() => !disabled && onMode(m)} disabled={disabled}
                title={disabled ? (th ? 'ยังไม่มีหุ้นให้ขาย' : 'Nothing to sell yet') : undefined}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
                  border: '1.5px solid var(--line)',
                  background: active
                    ? m === 'buy' ? 'var(--accent)' : m === 'sell' ? 'var(--loss)' : 'oklch(0.55 0.18 290)'
                    : 'var(--bg-2)',
                  color: active ? '#fff' : 'var(--ink-2)',
                }}>{lbl}</button>
            )
          })}
        </div>

        {/* ── Buy / Sell shared inputs ── */}
        {mode !== 'target' && (
          <>
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
          </>
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

        {/* ── Target mode ── */}
        {mode === 'target' && (
          <>
            {/* Sub-mode toggle: % weight vs ฿ value */}
            <div style={{ display: 'flex', gap: 6 }}>
              {[['%', th ? '% สัดส่วนพอร์ต' : '% Portfolio weight'], ['฿', th ? `${ccy === 'USD' ? '$' : '฿'} มูลค่าเป้าหมาย` : `${ccy === 'USD' ? '$' : '฿'} Target value`]].map(([k, lbl]) => (
                <button key={k} onClick={() => setTgtType(k)}
                  style={{ flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                            border: '1.5px solid var(--line)', cursor: 'pointer',
                            background: tgtType === k ? 'oklch(0.55 0.18 290)' : 'var(--bg-2)',
                            color: tgtType === k ? '#fff' : 'var(--ink-2)' }}>{lbl}</button>
              ))}
            </div>

            {/* Warning if no portfolio total passed */}
            {noPortfolio && (
              <div style={{ fontSize: 12, color: 'oklch(0.65 0.15 60)', padding: '8px 12px',
                             background: 'oklch(0.95 0.04 60)', borderRadius: 8 }}>
                {th
                  ? 'เปิดจากหน้า Portfolio เพื่อดึงมูลค่าพอร์ตรวมอัตโนมัติ'
                  : 'Open from Portfolio page to auto-fill total portfolio value'}
              </div>
            )}

            {/* Inputs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {tgtType === '%'
                    ? (th ? 'Target สัดส่วน (%)' : 'Target weight (%)')
                    : (th ? `Target มูลค่า (${ccy === 'USD' ? '$' : '฿'})` : `Target value (${ccy === 'USD' ? '$' : '฿'})`)}
                  {tgtType === '%' && rebalPct != null && (
                    <span style={{ fontSize: 10, background: 'oklch(0.55 0.18 290)', color: '#fff',
                                   padding: '1px 5px', borderRadius: 4, fontWeight: 600 }}>
                      {th ? 'จาก Tool' : 'from Tool'}
                    </span>
                  )}
                </div>
                <input type="number" inputMode="decimal" min="0" autoFocus
                  value={tgtInput} onChange={e => setTgtInput(e.target.value)}
                  placeholder={tgtType === '%' ? '10' : ccy === 'USD' ? '5000' : '100000'}
                  style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>
                  {th ? 'ราคาต่อหุ้น' : 'Price per share'} ({ccy === 'USD' ? '$' : '฿'})
                </div>
                <input type="number" inputMode="decimal" min="0" value={price}
                  onChange={e => setPrice(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>{th ? 'ค่าธรรมเนียม % (รวม VAT)' : 'Fee % (incl. VAT)'}</div>
                <input type="number" inputMode="decimal" min="0" step="0.001" value={fee}
                  onChange={e => onFee(e.target.value)} style={inputStyle} />
              </div>
              {/* Current position context */}
              <div style={{ ...box, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{th ? 'ถือปัจจุบัน' : 'Current holding'}</div>
                <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {fmtP(curValueNative, ccy)}
                </div>
                {totalInNative > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>
                    {((curValueNative / totalInNative) * 100).toFixed(1)}% {th ? 'ของพอร์ต' : 'of portfolio'}
                  </div>
                )}
              </div>
            </div>

            {/* Result */}
            {tgtValid && (
              <>
                {/* Hero number */}
                <div style={{ padding: '16px', borderRadius: 12,
                               background: tgtAction === 'buy' ? 'oklch(0.97 0.04 145)' : 'oklch(0.97 0.04 20)',
                               border: `1.5px solid ${tgtAction === 'buy' ? 'oklch(0.75 0.15 145)' : 'oklch(0.75 0.15 20)'}` }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>
                    {tgtAction === 'buy'
                      ? (th ? 'ต้องซื้อเพิ่ม' : 'Shares to buy')
                      : (th ? 'ถือเกิน Target — ต้องขายออก' : 'Over target — shares to sell')}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 32, fontWeight: 800, fontFamily: 'var(--font-mono)',
                                    color: tgtAction === 'buy' ? 'var(--gain)' : 'var(--loss)' }}>
                      {tgtSharesToShow < 10
                        ? tgtSharesToShow.toFixed(4)
                        : Math.round(tgtSharesToShow).toLocaleString()}
                    </span>
                    <span style={{ fontSize: 16, color: 'var(--ink-3)' }}>{th ? 'หุ้น' : 'shares'}</span>
                  </div>
                </div>

                {/* Detail metrics */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <Metric
                    label={tgtAction === 'buy' ? (th ? 'ใช้เงิน (รวมค่าธรรมเนียม)' : 'Cash needed (w/ fee)') : (th ? 'เงินที่ได้รับ' : 'Proceeds')}
                    value={fmtP(tgtCash, ccy)}
                  />
                  <Metric
                    label={th ? 'หุ้นหลังดำเนินการ' : 'Shares after'}
                    value={(tgtAction === 'buy' ? S0 + tgtSharesToShow : S0 - tgtSharesToShow)
                      .toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  />
                  <Metric
                    label={th ? 'สัดส่วนที่ได้' : 'Resulting weight'}
                    value={tgtResultWt != null ? tgtResultWt.toFixed(1) + '%' : '—'}
                    color={tgtType === '%' ? 'var(--gain)' : undefined}
                    sub={tgtType === '%' && tgtResultWt != null ? (th ? 'ตรงตาม target' : 'exact target') : undefined}
                  />
                </div>

                <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                  {tgtType === '%' ? (
                    th
                      ? <>สูตร: <code style={{ background: 'var(--bg-2)', padding: '1px 5px', borderRadius: 4 }}>(T×พอร์ต − มูลค่าปัจจุบัน) ÷ (ราคา × (1−T))</code></>
                      : <>Formula: <code style={{ background: 'var(--bg-2)', padding: '1px 5px', borderRadius: 4 }}>(T×portfolio − current) ÷ (price × (1−T))</code></>
                  ) : (
                    th
                      ? <>ซื้อ/ขายจนมูลค่าถึง {fmtP(tgtNum, ccy)} — รวมผลตาม {ccy === 'USD' ? '$' : '฿'} native</>
                      : <>Buy/sell until holding value reaches {fmtP(tgtNum, ccy)}</>
                  )}
                </div>
              </>
            )}

            {/* No result state */}
            {!tgtValid && tgtInput !== '' && (
              <div style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center', padding: '12px 0' }}>
                {tgtType === '%' && tgtNum >= 100 ? (th ? 'Target ต้องน้อยกว่า 100%' : 'Target must be < 100%') :
                 priceForCalc <= 0 ? (th ? 'ใส่ราคาต่อหุ้นก่อน' : 'Enter a price per share') :
                 (th ? 'ใส่ค่า Target ที่ต้องการ' : 'Enter a target value above')}
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>{th ? 'ปิด' : 'Close'}</button>
          {onCommit && mode !== 'target' && (
            <button className="btn" style={{ flex: 1.4 }} disabled={!valid}
              onClick={() => onCommit(mode, { qty: mode === 'sell' ? sellQty : q, price: p })}>
              {th ? 'บันทึกเป็นธุรกรรมจริง' : 'Record as a real trade'}
            </button>
          )}
          {onCommit && mode === 'target' && tgtValid && (
            <button className="btn" style={{ flex: 1.4,
                background: tgtAction === 'buy' ? 'var(--accent)' : 'var(--loss)' }}
              onClick={() => onCommit(
                tgtAction,
                { qty: tgtSharesToShow < 10 ? tgtSharesToShow : Math.round(tgtSharesToShow), price: priceForCalc }
              )}>
              {th
                ? (tgtAction === 'buy' ? `บันทึก ซื้อ ${Math.round(tgtSharesToShow).toLocaleString()} หุ้น` : `บันทึก ขาย ${Math.round(tgtSharesToShow).toLocaleString()} หุ้น`)
                : (tgtAction === 'buy' ? `Record buy ${Math.round(tgtSharesToShow).toLocaleString()} shares` : `Record sell ${Math.round(tgtSharesToShow).toLocaleString()} shares`)}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
