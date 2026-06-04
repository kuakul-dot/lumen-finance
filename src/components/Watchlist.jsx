import { useState, useEffect, useCallback } from 'react'
import { PageHead, Icon, TickerLogo } from './Nav'
import { TradingViewChart } from './TradingViewChart'
import { fetchHistory, fetchPrices, toYahooSymbol } from '../lib/prices'

const WATCHLIST_KEY = 'lumen_watchlist_v1'

function loadList() {
  try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]') } catch { return [] }
}
function saveList(items) {
  try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items)) } catch {}
}

// ── S/R computation ───────────────────────────────────────────────────────────
// Uses pivot-point detection (local maxima/minima ± WIN bars) + 2% clustering.
// Falls back to rolling 30d / all-time min-max when pivots are scarce.
function computeSR(closes, current) {
  if (!closes || closes.length < 12 || !current || current <= 0) return null

  const WIN = 3
  const pivotHighs = [], pivotLows = []
  for (let i = WIN; i < closes.length - WIN; i++) {
    let isHigh = true, isLow = true
    for (let d = 1; d <= WIN; d++) {
      if (closes[i - d] >= closes[i] || closes[i + d] >= closes[i]) isHigh = false
      if (closes[i - d] <= closes[i] || closes[i + d] <= closes[i]) isLow = false
    }
    if (isHigh) pivotHighs.push(closes[i])
    if (isLow)  pivotLows.push(closes[i])
  }

  // Cluster values within 2% of each other → pick most-tested level
  const cluster = (vals, tol = 0.02) => {
    const sorted = [...vals].sort((a, b) => a - b)
    const groups = []
    for (const v of sorted) {
      const g = groups.find(g => Math.abs(g.c - v) / g.c < tol)
      if (g) { g.pts.push(v); g.c = g.pts.reduce((s, x) => s + x, 0) / g.pts.length }
      else groups.push({ c: v, pts: [v] })
    }
    return groups.sort((a, b) => b.pts.length - a.pts.length)
  }

  const resClusters = cluster(pivotHighs.filter(v => v > current * 1.001))
  const supClusters = cluster(pivotLows.filter(v => v < current * 0.999))

  const toLevel = (g) => ({ price: +g.c.toFixed(4), strength: g.pts.length })

  // R1 = closest resistance, R2 = next; S1 = closest support, S2 = next
  let resistances = resClusters.slice(0, 3).map(toLevel).sort((a, b) => a.price - b.price).slice(0, 2)
  let supports    = supClusters.slice(0, 3).map(toLevel).sort((a, b) => b.price - a.price).slice(0, 2)

  // Fallbacks from rolling extremes when clusters are insufficient
  const w30 = closes.slice(-30), wAll = closes
  const fallbackR = [Math.max(...w30), Math.max(...wAll)].filter(v => v > current * 1.005)
  const fallbackS = [Math.min(...w30), Math.min(...wAll)].filter(v => v < current * 0.995)

  for (const v of fallbackR) {
    if (resistances.length >= 2) break
    if (!resistances.some(r => Math.abs(r.price - v) / v < 0.02))
      resistances.push({ price: +v.toFixed(4), strength: 0 })
  }
  for (const v of fallbackS) {
    if (supports.length >= 2) break
    if (!supports.some(s => Math.abs(s.price - v) / v < 0.02))
      supports.push({ price: +v.toFixed(4), strength: 0 })
  }

  resistances.sort((a, b) => a.price - b.price)
  supports.sort((a, b) => b.price - a.price)

  return { resistances, supports }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtPrice(price, currency) {
  if (price == null || isNaN(price)) return '—'
  const prefix = currency === 'THB' ? '฿' : '$'
  const dp = price < 1 ? 6 : price < 10 ? 4 : price < 1000 ? 2 : 0
  return prefix + price.toLocaleString('en', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

function distPct(level, current) {
  if (!current) return ''
  const d = ((level - current) / current) * 100
  return (d > 0 ? '+' : '') + d.toFixed(1) + '%'
}

// ── Strength dots (max 5) ─────────────────────────────────────────────────────
function StrengthDots({ count, color }) {
  const filled = Math.min(count, 5)
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{
          width: 5, height: 5, borderRadius: '50%',
          background: i < filled ? color : 'var(--line)',
          flexShrink: 0,
        }} />
      ))}
    </span>
  )
}

// ── S/R Ladder display ────────────────────────────────────────────────────────
function SRLadder({ sr, livePrice, currency }) {
  if (!sr) return null

  const rowStyle = (isRes) => ({
    display: 'grid',
    gridTemplateColumns: '32px 60px 1fr auto',
    alignItems: 'center',
    gap: 8,
    padding: '5px 0',
    color: isRes ? 'var(--loss)' : 'var(--gain)',
    fontSize: 12,
  })

  // Render resistances from highest (R2) to lowest (R1) so R1 is closest to NOW line
  const rLevels = [...sr.resistances].reverse()
  const sLevels = sr.supports   // already sorted: S1 closest, S2 furthest

  return (
    <div style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', padding: '8px 0', margin: '12px 0' }}>
      {rLevels.map((lvl, i) => {
        const label = `R${rLevels.length - i}`
        return (
          <div key={label} style={rowStyle(true)}>
            <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.04em' }}>{label}</span>
            <StrengthDots count={lvl.strength} color="var(--loss)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtPrice(lvl.price, currency)}</span>
            <span style={{ fontSize: 10, opacity: 0.65, fontFamily: 'var(--font-mono)' }}>{distPct(lvl.price, livePrice)}</span>
          </div>
        )
      })}

      {/* Current price */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 0',
        borderTop: '1px dashed var(--line)', borderBottom: '1px dashed var(--line)',
        margin: '3px 0',
      }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.04em', minWidth: 32 }}>NOW</span>
        <span style={{ flex: 1, height: 1, background: 'var(--accent)', opacity: 0.35 }} />
        <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>
          {fmtPrice(livePrice, currency)}
        </span>
      </div>

      {sLevels.map((lvl, i) => (
        <div key={`S${i + 1}`} style={rowStyle(false)}>
          <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.04em' }}>S{i + 1}</span>
          <StrengthDots count={lvl.strength} color="var(--gain)" />
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{fmtPrice(lvl.price, currency)}</span>
          <span style={{ fontSize: 10, opacity: 0.65, fontFamily: 'var(--font-mono)' }}>{distPct(lvl.price, livePrice)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Watchlist card ────────────────────────────────────────────────────────────
function WatchlistCard({ item, priceData, sr, onRemove, onNoteChange, showChart, onToggleChart, lang }) {
  const th = lang === 'th'
  const livePrice = priceData?.price ?? null
  const changePct = priceData?.changePct ?? 0
  const currency  = priceData?.currency ?? (item.region === 'TH' ? 'THB' : 'USD')
  const gain = changePct > 0, loss = changePct < 0

  // Clean ticker for TradingView: BTC-USD → BTC (TradingView resolves to BINANCE:BTCUSD)
  const tvTicker = item.cls === 'Crypto'
    ? item.symbol.replace(/[-/](USD|USDT|USDC|BTC|ETH)$/i, '')
    : item.symbol

  return (
    <div style={{
      background: 'var(--bg)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* ── Card body ─────────────────────────────────────── */}
      <div style={{ padding: 'var(--pad-card)', flex: 1 }}>

        {/* Header row: logo + ticker + name + remove */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <TickerLogo ticker={item.symbol} region={item.region} cls={item.cls} size={38} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>{item.symbol}</span>
              <span style={{
                fontSize: 9, padding: '2px 6px', borderRadius: 99, fontWeight: 700, letterSpacing: '0.04em',
                background: item.region === 'TH' ? 'oklch(0.94 0.04 200)'
                           : item.cls === 'Crypto' ? 'oklch(0.94 0.06 65)'
                           : 'oklch(0.94 0.04 250)',
                color: 'var(--ink-2)',
              }}>
                {item.region === 'TH' ? 'TH' : item.cls === 'Crypto' ? 'CRYPTO' : 'US'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.name}
            </div>
          </div>
          <button onClick={onRemove}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 4, borderRadius: 6, flexShrink: 0, lineHeight: 0 }}
            title={th ? 'นำออก' : 'Remove'}>
            <Icon name="trash" size={14} />
          </button>
        </div>

        {/* Live price */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          {livePrice != null ? (
            <>
              <span style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
                {fmtPrice(livePrice, currency)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: gain ? 'var(--gain)' : loss ? 'var(--loss)' : 'var(--ink-3)' }}>
                {gain ? '+' : ''}{changePct.toFixed(2)}%
              </span>
            </>
          ) : (
            <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>
              {th ? 'กำลังโหลด…' : 'Loading…'}
            </span>
          )}
        </div>

        {/* S/R Ladder */}
        {livePrice != null && (
          sr
            ? <SRLadder sr={sr} livePrice={livePrice} currency={currency} />
            : (
              <div style={{ fontSize: 11, color: 'var(--ink-3)', padding: '8px 0', borderTop: '1px solid var(--line)', marginBottom: 10 }}>
                {th ? '⏳ คำนวณแนวรับ-แนวต้าน…' : '⏳ Computing S/R levels…'}
              </div>
            )
        )}

        {/* Note input */}
        <input
          value={item.note || ''}
          onChange={e => onNoteChange(e.target.value)}
          placeholder={th ? '📝 บันทึก (เช่น รอ Pullback ที่ S1)' : '📝 Note (e.g. wait for S1 pullback)'}
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 12,
            border: '1px solid var(--line)', background: 'var(--bg-2)', color: 'var(--ink)',
            outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* ── Chart toggle button ───────────────────────────── */}
      <div style={{ borderTop: '1px solid var(--line)', padding: '10px var(--pad-card)' }}>
        <button onClick={onToggleChart}
          style={{
            width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            border: '1.5px solid var(--line)',
            background: showChart ? 'var(--ink)' : 'var(--bg-2)',
            color: showChart ? 'var(--bg)' : 'var(--ink)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
          <Icon name="chart" size={13} />
          {th
            ? (showChart ? 'ปิดกราฟ' : 'ดูกราฟ TradingView')
            : (showChart ? 'Close chart' : 'View TradingView chart')}
        </button>
      </div>

      {/* ── Embedded TradingView chart ────────────────────── */}
      {showChart && (
        <div style={{ padding: '0 var(--pad-card) var(--pad-card)' }}>
          <TradingViewChart ticker={tvTicker} region={item.region} height={440} />
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--ink-3)', textAlign: 'center' }}>
            {th
              ? 'กราฟจาก TradingView — ใช้เครื่องมือวิเคราะห์บนกราฟได้เลย'
              : 'Powered by TradingView — use the toolbar to draw S/R lines and indicators'}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Add-symbol modal ──────────────────────────────────────────────────────────
function AddModal({ th, onClose, onAdd }) {
  const [symbol, setSymbol] = useState('')
  const [name,   setName]   = useState('')
  const [region, setRegion] = useState('US')
  const [cls,    setCls]    = useState('Equity')
  const [note,   setNote]   = useState('')

  // Auto-detect region/class from symbol input
  useEffect(() => {
    const sym = symbol.trim().toUpperCase()
    if (sym.endsWith('.BK'))            { setRegion('TH'); setCls('Equity') }
    else if (/-(USD|USDT|USDC)$/i.test(sym)) { setRegion('US'); setCls('Crypto') }
  }, [symbol])

  const handleAdd = () => {
    // Strip .BK suffix — toYahooSymbol re-adds it for TH region
    const sym = symbol.trim().toUpperCase().replace(/\.BK$/i, '')
    if (!sym) return
    onAdd({
      symbol: sym,
      name: name.trim() || sym,
      region,
      cls,
      note: note.trim(),
      addedAt: new Date().toISOString(),
    })
    onClose()
  }

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
      <div style={{
        background: 'var(--bg)', borderRadius: 18, padding: 28,
        width: '100%', maxWidth: 400,
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>
          {th ? 'เพิ่มหุ้นใน Watchlist' : 'Add to watchlist'}
        </h3>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--ink-3)' }}>
          {th
            ? 'ใส่ Ticker เช่น AAPL, PTT, BTC-USD'
            : 'Enter a ticker e.g. AAPL, PTT, BTC-USD'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Ticker */}
          <input
            autoFocus
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && symbol.trim() && handleAdd()}
            placeholder="AAPL / PTT / VOO / BTC-USD"
            style={{ padding: '10px 12px', borderRadius: 8, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none', fontFamily: 'var(--font-mono)' }}
          />

          {/* Company name */}
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={th ? 'ชื่อบริษัท (ไม่บังคับ)' : 'Company name (optional)'}
            style={{ padding: '9px 12px', borderRadius: 8, fontSize: 13, border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none' }}
          />

          {/* Region + Class */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>
                {th ? 'ตลาด' : 'Region'}
              </div>
              <div className="pill-toggle" style={{ width: '100%' }}>
                <button className={region === 'US' ? 'on' : ''} onClick={() => setRegion('US')}>🇺🇸 US</button>
                <button className={region === 'TH' ? 'on' : ''} onClick={() => setRegion('TH')}>🇹🇭 TH</button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>
                {th ? 'ประเภท' : 'Type'}
              </div>
              <select
                value={cls}
                onChange={e => setCls(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13, border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none' }}>
                <option value="Equity">Equity</option>
                <option value="ETF">ETF</option>
                <option value="Crypto">Crypto</option>
                <option value="Commodity">Commodity</option>
              </select>
            </div>
          </div>

          {/* Note */}
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={th ? '📝 บันทึก (ไม่บังคับ)' : '📝 Note (optional)'}
            style={{ padding: '9px 12px', borderRadius: 8, fontSize: 13, border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', outline: 'none' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>
            {th ? 'ยกเลิก' : 'Cancel'}
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={handleAdd} disabled={!symbol.trim()}>
            {th ? '+ เพิ่ม' : '+ Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ th, onAdd }) {
  return (
    <div style={{ textAlign: 'center', padding: '72px 24px' }}>
      <div style={{ fontSize: 48, marginBottom: 16, lineHeight: 1 }}>👁</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
        {th ? 'ยังไม่มีหุ้นใน Watchlist' : 'Your watchlist is empty'}
      </div>
      <p style={{ margin: '0 auto 28px', fontSize: 13, color: 'var(--ink-3)', maxWidth: 360, lineHeight: 1.6 }}>
        {th
          ? 'เพิ่มหุ้นที่สนใจเพื่อติดตามราคา คำนวณแนวรับ-แนวต้าน และดูกราฟ TradingView'
          : 'Add stocks to track live prices, auto-compute support & resistance levels, and view TradingView charts'}
      </p>
      <button className="btn" onClick={onAdd} style={{ padding: '10px 24px', fontSize: 14 }}>
        <Icon name="plus" size={14} />
        {th ? 'เพิ่มหุ้นแรก' : 'Add your first stock'}
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function WatchlistPage({ lang, ccy, fxRate = 36 }) {
  const th = lang === 'th'

  const [items,        setItems]        = useState(loadList)
  const [prices,       setPrices]       = useState({})
  const [histories,    setHistories]    = useState({})   // yahooSymbol → closes[]
  const [expandedKey,  setExpandedKey]  = useState(null) // `${symbol}:${region}` of open chart
  const [showAdd,      setShowAdd]      = useState(false)
  const [loadingPrices, setLoadingPrices] = useState(false)

  // Persist list to localStorage whenever it changes
  useEffect(() => { saveList(items) }, [items])

  // ── Fetch live prices for all watchlist items ───────────────────────────────
  const refreshPrices = useCallback(async () => {
    if (items.length === 0) { setPrices({}); return }
    setLoadingPrices(true)
    try {
      const holdingLike = items.map(item => ({
        ticker: item.symbol,
        region: item.region || 'US',
        asset_class: item.cls || 'Equity',
      }))
      const px = await fetchPrices(holdingLike)
      setPrices(px)
    } catch (err) {
      console.warn('[Watchlist] price fetch error:', err)
    } finally {
      setLoadingPrices(false)
    }
  }, [items])

  // ── Fetch 3-month history for S/R computation ───────────────────────────────
  const refreshHistories = useCallback(async () => {
    for (const item of items) {
      const sym = toYahooSymbol(item.symbol, item.region || 'US', item.cls || 'Equity')
      try {
        const { series } = await fetchHistory(sym, '3mo')
        const closes = series
          .map(p => p.c)
          .filter(v => v != null && Number.isFinite(v) && v > 0)
        if (closes.length >= 12) {
          setHistories(prev => ({ ...prev, [sym]: closes }))
        }
      } catch (err) {
        console.warn('[Watchlist] history error for', sym, err)
      }
    }
  }, [items])

  // Refresh prices + histories whenever the list changes
  useEffect(() => {
    refreshPrices()
    refreshHistories()
  }, [refreshPrices, refreshHistories])

  // ── Item management ─────────────────────────────────────────────────────────
  const addItem = useCallback((newItem) => {
    const dup = items.some(
      i => i.symbol.toUpperCase() === newItem.symbol.toUpperCase() && i.region === newItem.region
    )
    if (dup) {
      alert(th
        ? `${newItem.symbol} (${newItem.region}) อยู่ใน Watchlist แล้ว`
        : `${newItem.symbol} (${newItem.region}) is already in your watchlist`)
      return
    }
    setItems(prev => [...prev, newItem])
  }, [items, th])

  const removeItem = useCallback((idx) => {
    const item = items[idx]
    setItems(prev => prev.filter((_, i) => i !== idx))
    if (item) {
      const key = `${item.symbol}:${item.region}`
      setExpandedKey(prev => prev === key ? null : prev)
    }
  }, [items])

  const updateNote = useCallback((idx, note) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, note } : item))
  }, [])

  return (
    <div className="page">
      <div className="page-inner">
        <PageHead
          kicker={th ? 'WATCHLIST' : 'WATCHLIST'}
          title={th ? 'รายการติดตาม' : 'Watchlist'}
          sub={th
            ? 'ติดตามหุ้นที่น่าสนใจ พร้อมแนวรับ-แนวต้านอัตโนมัติ'
            : 'Track stocks with auto-computed support & resistance levels'}
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {loadingPrices && (
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {th ? 'กำลังดึงราคา…' : 'Fetching prices…'}
                </span>
              )}
              <button className="btn" onClick={() => setShowAdd(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="plus" size={14} />
                {th ? 'เพิ่มหุ้น' : 'Add stock'}
              </button>
            </div>
          }
        />

        {items.length === 0 ? (
          <EmptyState th={th} onAdd={() => setShowAdd(true)} />
        ) : (
          <>
            {/* Legend */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <StrengthDots count={3} color="var(--loss)" />
                {th ? 'แนวต้าน (Resistance)' : 'Resistance'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <StrengthDots count={3} color="var(--gain)" />
                {th ? 'แนวรับ (Support)' : 'Support'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                {th ? '● = จำนวนครั้งที่ราคาเคยทดสอบ (pivot touch)' : '● = number of historical price touches (pivot)'}
              </span>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 'var(--gap)',
            }}>
              {items.map((item, idx) => {
                const yahooSym   = toYahooSymbol(item.symbol, item.region || 'US', item.cls || 'Equity')
                const priceData  = prices[yahooSym]
                const closes     = histories[yahooSym]
                const livePrice  = priceData?.price ?? null
                const sr         = (closes && livePrice) ? computeSR(closes, livePrice) : null
                const chartKey   = `${item.symbol}:${item.region}`
                return (
                  <WatchlistCard
                    key={chartKey}
                    item={item}
                    priceData={priceData}
                    sr={sr}
                    onRemove={() => removeItem(idx)}
                    onNoteChange={(note) => updateNote(idx, note)}
                    showChart={expandedKey === chartKey}
                    onToggleChart={() => setExpandedKey(prev => prev === chartKey ? null : chartKey)}
                    lang={lang}
                  />
                )
              })}
            </div>

            {/* Refresh hint */}
            <p style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'center', marginTop: 24 }}>
              {th
                ? 'แนวรับ-แนวต้านคำนวณจาก pivot point ของ 3 เดือนย้อนหลัง · ราคาจาก Yahoo Finance'
                : 'S/R levels computed from 3-month pivot points · Prices via Yahoo Finance'}
            </p>
          </>
        )}
      </div>

      {showAdd && <AddModal th={th} onClose={() => setShowAdd(false)} onAdd={addItem} />}
    </div>
  )
}
