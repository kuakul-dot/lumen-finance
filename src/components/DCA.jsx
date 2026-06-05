import { useState, useEffect, useCallback, useRef } from 'react'
import { PageHead, Icon } from './Nav'
import { LWLineChart } from './LWChart'
import { fetchHistory } from '../lib/prices'

// ── Constants ────────────────────────────────────────────────────────────────
const FREQ_OPTIONS = [
  { value: 'weekly',    th: 'ทุกสัปดาห์',    en: 'Weekly'    },
  { value: 'biweekly',  th: 'ทุก 2 สัปดาห์', en: 'Bi-Weekly' },
  { value: 'monthly',   th: 'ทุกเดือน',        en: 'Monthly'   },
  { value: 'quarterly', th: 'ทุกไตรมาส',      en: 'Quarterly' },
]

const TODAY = new Date().toISOString().split('T')[0]
const DEFAULT_START = (() => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 2)
  return d.toISOString().split('T')[0]
})()

// ── Date helpers ─────────────────────────────────────────────────────────────
function advanceDate(d, freq) {
  const nd = new Date(d)
  if (freq === 'weekly')         nd.setUTCDate(nd.getUTCDate() + 7)
  else if (freq === 'biweekly')  nd.setUTCDate(nd.getUTCDate() + 14)
  else if (freq === 'monthly')   nd.setUTCMonth(nd.getUTCMonth() + 1)
  else if (freq === 'quarterly') nd.setUTCMonth(nd.getUTCMonth() + 3)
  return nd
}

function fmtDate(d) {
  return d instanceof Date
    ? d.toISOString().split('T')[0]
    : String(d).slice(0, 10)
}

// ── Core DCA algorithm ────────────────────────────────────────────────────────
// Given sorted price bars, find bar whose timestamp is closest to targetTs.
// Returns null if nearest bar is more than maxSec away (weekend/holiday gap).
function findNearestBar(sorted, targetTs, maxSec = 5 * 86_400) {
  if (!sorted.length) return null
  // Edge cases
  if (targetTs <= sorted[0].t) {
    return Math.abs(sorted[0].t - targetTs) <= maxSec ? sorted[0] : null
  }
  const last = sorted[sorted.length - 1]
  if (targetTs >= last.t) {
    return Math.abs(last.t - targetTs) <= maxSec ? last : null
  }
  // Binary search for the two surrounding bars
  let lo = 0, hi = sorted.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    sorted[mid].t <= targetTs ? (lo = mid) : (hi = mid)
  }
  const da = Math.abs(sorted[lo].t - targetTs)
  const db = Math.abs(sorted[hi].t - targetTs)
  const best = da <= db ? sorted[lo] : sorted[hi]
  return Math.min(da, db) <= maxSec ? best : null
}

// Build a list of purchases: one per DCA interval between startDate and endDate.
// Skips weekends/holidays by snapping to the nearest trading day.
// Deduplicates so the same bar can't be used twice.
function computeDCA(bars, startDate, endDate, amount, frequency) {
  const endTs  = new Date(endDate + 'T23:59:59Z').getTime() / 1000
  const sorted = bars.filter(b => b.c > 0 && Number.isFinite(b.c)).sort((a, b) => a.t - b.t)
  const used   = new Set()
  const list   = []

  let cur = new Date(startDate + 'T00:00:00Z')

  while (cur.getTime() / 1000 <= endTs) {
    const bar = findNearestBar(sorted, cur.getTime() / 1000)
    if (bar && !used.has(bar.t)) {
      used.add(bar.t)
      list.push({
        date:   new Date(bar.t * 1000),
        price:  bar.c,
        shares: amount / bar.c,
        amount,
      })
    }
    cur = advanceDate(cur, frequency)
  }

  return list
}

// Compute aggregate summary + lump-sum comparison
function computeSummary(purchases, currentPrice) {
  const totalShares   = purchases.reduce((s, p) => s + p.shares, 0)
  const totalInvested = purchases.reduce((s, p) => s + p.amount, 0)
  const avgCost       = totalInvested / totalShares
  const currentValue  = totalShares * currentPrice
  const totalPL       = currentValue - totalInvested
  const totalPLPct    = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0

  // Lump Sum: invest the same total amount at the very first purchase price
  const firstPrice = purchases[0].price
  const lsShares   = totalInvested / firstPrice
  const lsValue    = lsShares * currentPrice
  const lsPL       = lsValue - totalInvested
  const lsPLPct    = totalInvested > 0 ? (lsPL / totalInvested) * 100 : 0

  return {
    totalShares, totalInvested, avgCost,
    currentValue, totalPL, totalPLPct,
    lsValue, lsPL, lsPLPct,
    firstPrice,
    nBuys: purchases.length,
  }
}

// ── Number formatters ────────────────────────────────────────────────────────
function fmtNum(v, dec = 0) {
  if (!Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(v)
}

function fmtMoney(v, curr) {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  const dec = abs >= 1000 ? 0 : abs >= 10 ? 2 : 4
  if (curr === 'THB') return `${sign}฿${fmtNum(abs, dec)}`
  if (curr === 'USD') return `${sign}$${fmtNum(abs, dec)}`
  return `${sign}${fmtNum(abs, dec)} ${curr || ''}`
}

function fmtPct(v, showSign = true) {
  if (!Number.isFinite(v)) return '—'
  return `${showSign && v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, subColor, accent }) {
  return (
    <div style={{
      flex: '1 1 150px', minWidth: 140,
      padding: '18px 20px',
      background: accent ? 'var(--accent-soft)' : 'var(--bg-2)',
      borderRadius: 14,
      border: accent ? '1px solid var(--accent)' : '1px solid transparent',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 21, fontWeight: 700, fontFamily: 'var(--font-mono)', lineHeight: 1.1, color: accent ? 'var(--accent-ink)' : 'var(--ink)' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, marginTop: 5, color: subColor || 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function DCAPage({ lang }) {
  const th = lang === 'th'

  // ── Form ───────────────────────────────────────────────────────────────────
  const [symRaw,    setSymRaw]    = useState('')     // Yahoo symbol, e.g. "AAPL" or "SCB.BK"
  const [symLabel,  setSymLabel]  = useState('')     // human label from search
  const [amount,    setAmount]    = useState(5000)
  const [frequency, setFrequency] = useState('monthly')
  const [startDate, setStartDate] = useState(DEFAULT_START)
  const [endDate,   setEndDate]   = useState(TODAY)

  // ── Search autocomplete ────────────────────────────────────────────────────
  const [searchQ,       setSearchQ]       = useState('')
  const [searchRes,     setSearchRes]     = useState([])
  const [searchBusy,    setSearchBusy]    = useState(false)
  const [showDrop,      setShowDrop]      = useState(false)
  const searchWrap = useRef(null)
  const debounceId = useRef(null)

  const doSearch = useCallback(async (q) => {
    if (!q) { setSearchRes([]); return }
    setSearchBusy(true)
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      const j = await r.json()
      setSearchRes(Array.isArray(j) ? j.slice(0, 10) : (j.results || []).slice(0, 10))
    } catch { setSearchRes([]) }
    finally { setSearchBusy(false) }
  }, [])

  useEffect(() => {
    clearTimeout(debounceId.current)
    debounceId.current = setTimeout(() => doSearch(searchQ), 350)
    return () => clearTimeout(debounceId.current)
  }, [searchQ, doSearch])

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e) => {
      if (searchWrap.current && !searchWrap.current.contains(e.target)) setShowDrop(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const pickSymbol = (item) => {
    setSymRaw(item.symbol)
    setSymLabel(`${item.symbol}  ${item.name}`)
    setSearchQ(item.symbol)
    setShowDrop(false)
  }

  const clearSymbol = () => {
    setSymRaw(''); setSymLabel(''); setSearchQ(''); setSearchRes([])
    setResult(null); setError(null)
  }

  // ── Calculation ────────────────────────────────────────────────────────────
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [result,    setResult]    = useState(null)
  const [showTable, setShowTable] = useState(false)

  const canCalc = symRaw && Number(amount) > 0 && startDate && endDate && startDate < endDate

  const calculate = async () => {
    if (!canCalc) return
    setLoading(true)
    setError(null)
    setResult(null)
    setShowTable(false)
    try {
      const diffYears = (new Date(endDate) - new Date(startDate)) / (365.25 * 86_400_000)
      const range = diffYears <= 1 ? '1y' : diffYears <= 2 ? '2y' : diffYears <= 5 ? '5y' : 'max'

      const { series, currency } = await fetchHistory(symRaw, range)
      if (!series?.length) throw new Error(th ? 'ไม่มีข้อมูลราคา' : 'No price data available')

      const purchases = computeDCA(series, startDate, endDate, Number(amount), frequency)
      if (!purchases.length) throw new Error(th ? 'ไม่มีวันซื้อขายในช่วงที่เลือก' : 'No trading days found in the selected range')

      const currentPrice = series[series.length - 1].c
      const summary      = computeSummary(purchases, currentPrice)

      setResult({ purchases, summary, currency: currency || 'USD', currentPrice })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Chart series ───────────────────────────────────────────────────────────
  const chartSeries = result ? (() => {
    let cumShares = 0, cumInvested = 0
    const invested = [], value = []
    result.purchases.forEach((p, i) => {
      cumShares   += p.shares
      cumInvested += p.amount
      const price = i === result.purchases.length - 1 ? result.currentPrice : p.price
      const label = fmtDate(p.date)
      invested.push({ x: p.date.getTime() / 1000, y: cumInvested, label })
      value.push({    x: p.date.getTime() / 1000, y: cumShares * price, label })
    })
    return [
      { name: th ? 'เงินลงทุนสะสม' : 'Total Invested', data: invested, color: 'var(--ink-3)', fill: false, dashed: true },
      { name: th ? 'มูลค่าพอร์ต'   : 'Portfolio Value', data: value,    color: 'var(--accent)', fill: true  },
    ]
  })() : null

  const { summary, currency } = result || {}
  const fmt = (v) => fmtMoney(v, currency)

  const freqLabel = FREQ_OPTIONS.find(f => f.value === frequency)?.[th ? 'th' : 'en'] || frequency

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="shell-narrow fade-in">
      <PageHead
        kicker={th ? 'เครื่องมือ' : 'Tools'}
        title="DCA Calculator"
        sub={th
          ? 'จำลองการลงทุนแบบ Dollar Cost Averaging และเปรียบเทียบกับซื้อครั้งเดียว'
          : 'Simulate Dollar Cost Averaging and compare against lump-sum investing'}
      />

      {/* ── Form card ──────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>

          {/* Symbol search */}
          <div ref={searchWrap} style={{ position: 'relative', flex: '2 1 200px', minWidth: 180 }}>
            <label className="field-label">
              {th ? 'หุ้น / ETF / คริปโต' : 'Stock / ETF / Crypto'}
            </label>
            <div style={{ position: 'relative' }}>
              <Icon name="search" size={14} style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--ink-3)', pointerEvents: 'none',
              }} />
              <input
                value={searchQ}
                onChange={e => {
                  setSearchQ(e.target.value)
                  setShowDrop(true)
                  if (!e.target.value) clearSymbol()
                }}
                onFocus={() => { if (searchQ) setShowDrop(true) }}
                placeholder={symLabel || (th ? 'ค้นหา เช่น AAPL, SCB' : 'Search e.g. AAPL, SCB.BK')}
                style={{
                  width: '100%', padding: '9px 32px 9px 32px', borderRadius: 9, fontSize: 13,
                  border: `1.5px solid ${symRaw ? 'var(--accent)' : 'var(--line)'}`,
                  background: 'var(--bg)', color: 'var(--ink)', outline: 'none',
                  boxSizing: 'border-box', fontFamily: 'var(--font-mono)',
                }}
              />
              {(searchBusy) && (
                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--ink-3)' }}>…</span>
              )}
              {symRaw && !searchBusy && (
                <button onClick={clearSymbol} style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--ink-3)', fontSize: 16, lineHeight: 1, padding: '0 2px',
                }}>×</button>
              )}
            </div>
            {symRaw && (
              <div style={{ fontSize: 11, color: 'var(--accent-ink)', marginTop: 4, fontWeight: 500 }}>
                ✓ {symLabel}
              </div>
            )}
            {/* Dropdown */}
            {showDrop && searchRes.length > 0 && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 300,
                background: 'var(--bg)', border: '1px solid var(--line)',
                borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.14)',
                maxHeight: 300, overflowY: 'auto', marginTop: 2,
              }}>
                {searchRes.map((r, i) => (
                  <button
                    key={i}
                    onMouseDown={e => { e.preventDefault(); pickSymbol(r) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 14px',
                      background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                      borderBottom: i < searchRes.length - 1 ? '1px solid var(--line)' : 'none',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, minWidth: 64, color: 'var(--ink)' }}>
                      {r.symbol}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {r.name}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--ink-3)', flexShrink: 0 }}>{r.exchange}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Amount */}
          <div style={{ flex: '1 1 120px', minWidth: 110 }}>
            <label className="field-label">
              {th ? 'ลงทุน / ครั้ง' : 'Amount / buy'}
            </label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              min="1"
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 13,
                border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)',
                outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-mono)',
              }}
            />
          </div>

          {/* Frequency */}
          <div style={{ flex: '1 1 140px', minWidth: 130 }}>
            <label className="field-label">{th ? 'ความถี่' : 'Frequency'}</label>
            <select
              value={frequency}
              onChange={e => setFrequency(e.target.value)}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 13,
                border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)',
                outline: 'none', boxSizing: 'border-box', cursor: 'pointer',
                appearance: 'none',
              }}
            >
              {FREQ_OPTIONS.map(f => (
                <option key={f.value} value={f.value}>{th ? f.th : f.en}</option>
              ))}
            </select>
          </div>

          {/* Start date */}
          <div style={{ flex: '1 1 130px', minWidth: 120 }}>
            <label className="field-label">{th ? 'วันเริ่มต้น' : 'Start date'}</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              max={endDate || TODAY}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 13,
                border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* End date */}
          <div style={{ flex: '1 1 130px', minWidth: 120 }}>
            <label className="field-label">{th ? 'วันสิ้นสุด' : 'End date'}</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              max={TODAY}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 9, fontSize: 13,
                border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Calculate button */}
          <div style={{ flex: '0 0 auto', paddingTop: 20 }}>
            <button
              className="btn"
              onClick={calculate}
              disabled={loading || !canCalc}
              style={{ padding: '9px 28px', fontSize: 13, borderRadius: 9, minWidth: 100 }}
            >
              {loading
                ? (th ? 'กำลังคำนวณ…' : 'Calculating…')
                : (th ? 'คำนวณ' : 'Calculate')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13,
          background: 'var(--loss-soft)', color: 'var(--loss)',
          border: '1px solid var(--loss)',
        }}>
          {error}
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────────────── */}
      {result && summary && (
        <>
          {/* ── Stat cards ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <StatCard
              label={th ? 'เงินลงทุนทั้งหมด' : 'Total Invested'}
              value={fmt(summary.totalInvested)}
              sub={`${summary.nBuys} ${th ? 'ครั้ง · ' : 'buys · '}${freqLabel}`}
            />
            <StatCard
              label={th ? 'ต้นทุนเฉลี่ย / หน่วย' : 'Avg Cost / Share'}
              value={fmt(summary.avgCost)}
              sub={`${fmtNum(summary.totalShares, 4)} ${th ? 'หน่วย' : 'shares total'}`}
            />
            <StatCard
              label={th ? 'มูลค่าปัจจุบัน' : 'Current Value'}
              value={fmt(summary.currentValue)}
              sub={`${th ? 'ราคาล่าสุด' : 'last price'} ${fmt(result.currentPrice)}`}
            />
            <StatCard
              label={th ? 'กำไร / ขาดทุน รวม' : 'Total P&L'}
              value={`${summary.totalPL >= 0 ? '+' : ''}${fmt(summary.totalPL)}`}
              sub={fmtPct(summary.totalPLPct)}
              subColor={summary.totalPLPct > 0 ? 'var(--gain)' : summary.totalPLPct < 0 ? 'var(--loss)' : 'var(--ink-3)'}
              accent={true}
            />
          </div>

          {/* ── Chart ──────────────────────────────────────────────────── */}
          {chartSeries && (
            <div className="card" style={{ padding: '20px 20px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {th ? 'เงินลงทุนสะสม vs มูลค่าพอร์ต' : 'Cumulative Invested vs Portfolio Value'}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
                  {chartSeries.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink-2)' }}>
                      <svg width={18} height={6}>
                        <line x1={0} y1={3} x2={18} y2={3}
                          stroke={s.color} strokeWidth={2}
                          strokeDasharray={s.dashed ? '4 3' : 'none'} />
                      </svg>
                      {s.name}
                    </div>
                  ))}
                </div>
              </div>
              <LWLineChart
                series={chartSeries}
                height={220}
                fmt={(v) => fmt(v)}
                labelFmt={(d) => d.label}
              />
            </div>
          )}

          {/* ── DCA vs Lump Sum ─────────────────────────────────────────── */}
          <div className="card" style={{ padding: '20px', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
              {th ? 'DCA vs ซื้อครั้งเดียว (Lump Sum)' : 'DCA vs Lump Sum'}
            </div>

            {[
              {
                label: th
                  ? `DCA ${freqLabel} (×${summary.nBuys} ครั้ง)`
                  : `DCA ${freqLabel} (×${summary.nBuys} buys)`,
                detail: th
                  ? `ต้นทุนเฉลี่ย ${fmt(summary.avgCost)}`
                  : `Avg cost ${fmt(summary.avgCost)}`,
                value:  summary.currentValue,
                pl:     summary.totalPL,
                pct:    summary.totalPLPct,
                color:  'var(--accent)',
              },
              {
                label: th
                  ? `Lump Sum (ซื้อทั้งหมดครั้งเดียว @ ${fmt(summary.firstPrice)})`
                  : `Lump Sum (all-in @ ${fmt(summary.firstPrice)})`,
                detail: th
                  ? `${fmtNum(summary.lsValue / summary.firstPrice, 2)} หน่วย`
                  : `${fmtNum(summary.totalInvested / summary.firstPrice, 2)} shares`,
                value: summary.lsValue,
                pl:    summary.lsPL,
                pct:   summary.lsPLPct,
                color: 'var(--ink-2)',
              },
            ].map((row, i) => {
              const maxV   = Math.max(summary.currentValue, summary.lsValue)
              const barPct = maxV > 0 ? Math.max(4, (row.value / maxV) * 100) : 4
              const gain   = row.pct > 0, loss = row.pct < 0
              return (
                <div key={i} style={{ marginBottom: i === 0 ? 20 : 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: row.color }}>{row.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 8 }}>{row.detail}</span>
                    </div>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, flexShrink: 0,
                      color: gain ? 'var(--gain)' : loss ? 'var(--loss)' : 'var(--ink)',
                    }}>
                      {fmtPct(row.pct)}
                    </span>
                  </div>
                  <div style={{ height: 10, background: 'var(--bg-2)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${barPct}%`, borderRadius: 5,
                      background: row.color, transition: 'width 0.5s ease',
                      opacity: gain ? 1 : loss ? 0.6 : 0.4,
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}>
                    <span>{fmt(row.value)}</span>
                    <span style={{ color: gain ? 'var(--gain)' : loss ? 'var(--loss)' : 'var(--ink-3)' }}>
                      {row.pl >= 0 ? '+' : ''}{fmt(row.pl)}
                    </span>
                  </div>
                </div>
              )
            })}

            {/* Winner badge */}
            <div style={{
              marginTop: 18, padding: '10px 14px', borderRadius: 10,
              background: 'var(--bg-2)', fontSize: 12, color: 'var(--ink-2)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 16 }}>
                {summary.totalPLPct >= summary.lsPLPct ? '🏆' : '📉'}
              </span>
              {summary.totalPLPct >= summary.lsPLPct
                ? (th
                  ? `DCA ทำผลตอบแทนได้ดีกว่า Lump Sum ${fmtPct(summary.totalPLPct - summary.lsPLPct, true)} ในช่วงนี้`
                  : `DCA outperformed Lump Sum by ${fmtPct(summary.totalPLPct - summary.lsPLPct)} in this period`)
                : (th
                  ? `Lump Sum ทำผลตอบแทนได้ดีกว่า DCA ${fmtPct(summary.lsPLPct - summary.totalPLPct, true)} ในช่วงนี้`
                  : `Lump Sum outperformed DCA by ${fmtPct(summary.lsPLPct - summary.totalPLPct)} in this period`)
              }
            </div>
          </div>

          {/* ── Purchase history (collapsible) ─────────────────────────── */}
          <div className="card" style={{ overflow: 'hidden', marginBottom: 24 }}>
            <button
              onClick={() => setShowTable(s => !s)}
              style={{
                width: '100%', padding: '14px 20px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: 'var(--ink)',
              }}
            >
              <span>
                {th ? `ประวัติการซื้อทั้งหมด (${summary.nBuys} ครั้ง)` : `All Purchases (${summary.nBuys} buys)`}
              </span>
              <Icon name="down" size={15} style={{ transform: showTable ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }} />
            </button>

            {showTable && (
              <div style={{ overflowX: 'auto', borderTop: '1px solid var(--line)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-2)' }}>
                      {['#',
                        th ? 'วันที่' : 'Date',
                        th ? 'ราคา'   : 'Price',
                        th ? 'หน่วย'  : 'Shares',
                        th ? 'ลงทุน'  : 'Invested',
                        th ? 'หน่วยสะสม' : 'Cum. Shares',
                        th ? 'ต้นทุนสะสม' : 'Cum. Cost',
                        th ? 'มูลค่าสะสม' : 'Cum. Value',
                        'P&L %',
                      ].map((h, ci) => (
                        <th key={ci} style={{
                          padding: '9px 12px',
                          textAlign: ci <= 1 ? 'left' : 'right',
                          fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                          letterSpacing: '0.06em', color: 'var(--ink-3)',
                          whiteSpace: 'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let cumShares = 0, cumCost = 0
                      return result.purchases.map((p, i) => {
                        cumShares += p.shares
                        cumCost   += p.amount
                        const price    = i === result.purchases.length - 1 ? result.currentPrice : p.price
                        const cumValue = cumShares * price
                        const pl       = cumValue - cumCost
                        const plPct    = cumCost > 0 ? (pl / cumCost) * 100 : 0
                        const gain = pl > 0, loss = pl < 0
                        return (
                          <tr
                            key={i}
                            style={{ borderTop: '1px solid var(--line)', transition: 'background 0.1s' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <td style={{ padding: '8px 12px', color: 'var(--ink-3)', fontSize: 11 }}>{i + 1}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>{fmtDate(p.date)}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmt(p.price)}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmtNum(p.shares, 4)}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmt(p.amount)}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--ink-2)' }}>{fmtNum(cumShares, 4)}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--ink-2)' }}>{fmt(cumCost)}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmt(cumValue)}</td>
                            <td style={{
                              padding: '8px 12px', fontFamily: 'var(--font-mono)', textAlign: 'right',
                              fontWeight: 600,
                              color: gain ? 'var(--gain)' : loss ? 'var(--loss)' : 'var(--ink)',
                            }}>
                              {fmtPct(plPct)}
                            </td>
                          </tr>
                        )
                      })
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Empty / hero state ──────────────────────────────────────────────── */}
      {!result && !loading && !error && (
        <div style={{
          textAlign: 'center', padding: '64px 24px',
          color: 'var(--ink-3)',
        }}>
          <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
            <rect x="5" y="2" width="14" height="20" rx="2"/>
            <path d="M9 7h6"/>
            <circle cx="9"  cy="12" r="0.8" fill="currentColor" stroke="none"/>
            <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none"/>
            <circle cx="15" cy="12" r="0.8" fill="currentColor" stroke="none"/>
            <circle cx="9"  cy="17" r="0.8" fill="currentColor" stroke="none"/>
            <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none"/>
            <circle cx="15" cy="17" r="0.8" fill="currentColor" stroke="none"/>
          </svg>
          <div style={{ marginTop: 20, fontSize: 16, fontWeight: 600, color: 'var(--ink-2)' }}>
            {th ? 'เลือกหุ้นและกรอกข้อมูลด้านบน' : 'Select a symbol and fill in the form above'}
          </div>
          <div style={{ marginTop: 6, fontSize: 13 }}>
            {th
              ? 'กด "คำนวณ" เพื่อดูผลการลงทุนแบบ DCA เทียบกับการซื้อครั้งเดียว'
              : 'Click "Calculate" to see how DCA compares to a lump-sum investment'}
          </div>

          {/* Quick-tip pills */}
          <div style={{ marginTop: 28, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { sym: 'AAPL',   label: 'Apple' },
              { sym: 'SCB.BK', label: 'SCB' },
              { sym: 'BTC-USD',label: 'Bitcoin' },
              { sym: 'SPY',    label: 'S&P 500 ETF' },
            ].map(({ sym, label }) => (
              <button
                key={sym}
                onClick={() => {
                  setSymRaw(sym)
                  setSymLabel(`${sym}  ${label}`)
                  setSearchQ(sym)
                }}
                style={{
                  padding: '6px 14px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                  border: '1px solid var(--line)', background: 'var(--bg-2)', color: 'var(--ink-2)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}
