import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { toYahooSymbol } from '../lib/prices'
import { timeAgo } from '../lib/news'
import { TickerLogo } from './Nav'
import { StockFinancials } from './StockFinancials'

const PALETTE = [
  { bg: 'rgba(56,138,230,0.13)',  border: 'rgba(56,138,230,0.32)',  color: '#2d7ac9' },
  { bg: 'rgba(124,95,240,0.13)', border: 'rgba(124,95,240,0.32)', color: '#7048e8' },
  { bg: 'rgba(22,163,117,0.13)', border: 'rgba(22,163,117,0.32)', color: '#14977a' },
  { bg: 'rgba(211,122,15,0.13)', border: 'rgba(211,122,15,0.32)', color: '#c07010' },
  { bg: 'rgba(220,80,40,0.13)',  border: 'rgba(220,80,40,0.32)',  color: '#c04820' },
  { bg: 'rgba(100,160,35,0.13)', border: 'rgba(100,160,35,0.32)', color: '#4d8a1a' },
]

const fmtB = (n, ccy = 'THB') => {
  if (n == null) return '—'
  const s = ccy === 'USD' ? '$' : '฿'
  const abs = Math.abs(n)
  if (abs >= 1e12) return s + (n / 1e12).toFixed(2) + 'T'
  if (abs >= 1e9)  return s + (n / 1e9).toFixed(1) + 'B'
  if (abs >= 1e6)  return s + (n / 1e6).toFixed(1) + 'M'
  if (abs >= 1e3)  return s + (n / 1e3).toFixed(0) + 'K'
  return s + (+n.toFixed(2))
}

const fmtNum = (n, d = 2) => n == null ? '—' : (+n).toFixed(d)

const SEC = {
  fontSize: 10, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase',
  color: 'var(--ink-3)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5,
}
const ROW = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '5px 0', borderBottom: '0.5px solid var(--line)',
}
const CARD = { padding: '14px 16px', background: 'var(--bg-1)', border: '0.5px solid var(--line)', borderRadius: 'var(--radius)' }

function Shimmer({ h = 16, w = '100%', r = 6 }) {
  return <div className="shimmer" style={{ height: h, width: w, borderRadius: r, background: 'var(--bg-2)' }} />
}

function SourceBadge({ src }) {
  if (!src || src === 'Yahoo') return null
  return (
    <span style={{ fontSize: 9, fontWeight: 500, background: 'var(--bg-2)', border: '0.5px solid var(--line)', borderRadius: 4, padding: '1px 5px', color: 'var(--ink-3)', textTransform: 'none', letterSpacing: 0, marginLeft: 4 }}>
      {src}
    </span>
  )
}

function ConsensusCard({ data, currentPrice, ccy, th, src, region }) {
  const { consensus: c, target: t } = data
  const total = c?.total || 0
  const hasTarget = t?.mean != null

  const hdr = th ? 'ความเห็นนักวิเคราะห์' : 'Analyst Consensus'
  const srcLabel = src && src !== 'Yahoo' ? src : null
  const ana = th ? 'นักวิเคราะห์' : 'analysts'

  if (!total && !hasTarget && !c?.key) return (
    <div style={CARD}>
      <div style={SEC}>{hdr}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '24px 0', textAlign: 'center' }}>
        {th ? 'ไม่มีข้อมูลนักวิเคราะห์' : 'No analyst data'}
      </div>
    </div>
  )

  const pct = n => total > 0 ? (n / total * 100).toFixed(1) + '%' : '0%'
  const ccyS = ccy === 'USD' ? '$' : '฿'

  const keyLabel = k => {
    if (th) return { strongBuy: 'ซื้อเพิ่มทันที', buy: 'ซื้อ', hold: 'ถือ', sell: 'ขาย', strongSell: 'ขายทันที' }[k] || k
    return { strongBuy: 'Strong Buy', buy: 'Buy', hold: 'Hold', sell: 'Sell', strongSell: 'Strong Sell' }[k] || k
  }
  const keyStyle = k => {
    if (k === 'strongBuy' || k === 'buy') return { bg: '#E1F5EE', bdr: '#5DCAA5', clr: '#085041' }
    if (k === 'hold') return { bg: '#FEF5E4', bdr: '#EF9F27', clr: '#854F0B' }
    return { bg: '#FAECE7', bdr: '#E17560', clr: '#993C1D' }
  }
  const ks = keyStyle(c?.key)
  const upside = t?.mean && currentPrice ? ((t.mean - currentPrice) / currentPrice * 100) : null

  return (
    <div style={CARD}>
      <div style={SEC}>{hdr}<SourceBadge src={src} /></div>

      {total > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {c.strongBuy > 0  && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}><span style={{ color: '#085041' }}>■</span> {th ? 'ซ.ซื้อ' : 'S.Buy'} {c.strongBuy}</span>}
          {c.buy > 0        && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}><span style={{ color: '#1D9E75' }}>■</span> {th ? 'ซื้อ' : 'Buy'} {c.buy}</span>}
          {c.hold > 0       && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}><span style={{ color: '#EF9F27' }}>■</span> {th ? 'ถือ' : 'Hold'} {c.hold}</span>}
          {c.sell > 0       && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}><span style={{ color: '#E05030' }}>■</span> {th ? 'ขาย' : 'Sell'} {c.sell}</span>}
          {c.strongSell > 0 && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}><span style={{ color: '#993C1D' }}>■</span> {th ? 'ซ.ขาย' : 'S.Sell'} {c.strongSell}</span>}
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{total} {ana}</span>
        </div>
      )}

      {/* No consensus breakdown — show reason for Thai stocks */}
      {total === 0 && region === 'TH' && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '10px 12px', background: 'var(--bg-2)', borderRadius: 8, marginBottom: 12, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>ℹ️</span>
          <span>{th ? 'ข้อมูล consensus จากสำนักวิจัยไทย (บล.) ไม่มีในแหล่งข้อมูลฟรี' : 'Thai broker consensus is not available in free data sources'}</span>
        </div>
      )}

      {c?.key && c.key !== 'none' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ background: ks.bg, border: `0.5px solid ${ks.bdr}`, color: ks.clr, fontSize: 12, fontWeight: 500, padding: '4px 14px', borderRadius: 20 }}>
            {keyLabel(c.key)}
          </div>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            {total > 0 ? (th ? 'ความเห็นส่วนใหญ่' : 'consensus') : t?.analysts ? `${t.analysts} ${ana}` : (th ? 'ความเห็นส่วนใหญ่' : 'consensus')}
          </span>
        </div>
      )}

      {t?.mean && (
        <div style={{ background: 'var(--bg-2)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 2 }}>
            {th ? 'ราคาเป้าหมายเฉลี่ย' : 'Mean price target'}
            {t.analysts ? ` · ${t.analysts} ${ana}` : ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '3px 0' }}>
            <div style={{ fontSize: 20, fontWeight: 500 }}>{ccyS}{t.mean}</div>
            {upside != null && (
              <div style={{ fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 5, background: upside >= 0 ? '#E1F5EE' : '#FAECE7', color: upside >= 0 ? '#085041' : '#993C1D' }}>
                {upside >= 0 ? '+' : ''}{upside.toFixed(1)}% {th ? 'upside' : 'upside'}
              </div>
            )}
          </div>
          {t.low != null && t.high != null && currentPrice != null && (
            <>
              <div style={{ position: 'relative', height: 5, background: 'var(--line)', borderRadius: 3, margin: '8px 0 4px' }}>
                {(() => {
                  const range = t.high - t.low
                  if (range <= 0) return null
                  const meanPct = Math.min(100, Math.max(0, (t.mean - t.low) / range * 100)).toFixed(1) + '%'
                  const nowPct  = Math.min(100, Math.max(0, (currentPrice - t.low) / range * 100)).toFixed(1) + '%'
                  return (
                    <>
                      <div style={{ position: 'absolute', left: 0, width: meanPct, height: '100%', background: '#5DCAA5', borderRadius: 3 }} />
                      <div style={{ position: 'absolute', left: nowPct, top: -3, width: 2, height: 11, background: '#085041', borderRadius: 1 }} />
                    </>
                  )
                })()}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{th ? 'ต่ำ' : 'Low'} {ccyS}{t.low}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{th ? 'ปัจจุบัน' : 'Now'} {ccyS}{currentPrice}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{th ? 'สูง' : 'High'} {ccyS}{t.high}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function EstimatesCard({ data, th, src }) {
  const { estimates, beats } = data
  const ccy = data.currency || 'THB'
  const ccyS = ccy === 'USD' ? '$' : '฿'

  if (!estimates?.length) return (
    <div style={CARD}>
      <div style={SEC}>{th ? 'คาดการณ์ล่วงหน้า' : 'Forward Estimates'}<SourceBadge src={src} /></div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '24px 0', textAlign: 'center' }}>
        {th ? 'ไม่มีข้อมูลประมาณการ' : 'No estimate data'}
      </div>
    </div>
  )

  const isYear = e => e.period === '0y' || e.period === '+1y'

  return (
    <div style={CARD}>
      <div style={SEC}>{th ? 'คาดการณ์ล่วงหน้า' : 'Forward Estimates'}<SourceBadge src={src} /></div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', fontWeight: 500, color: 'var(--ink-3)', fontSize: 11, paddingBottom: 7 }}>{th ? 'งวด' : 'Period'}</th>
            <th style={{ textAlign: 'right', fontWeight: 500, color: 'var(--ink-3)', fontSize: 11, paddingBottom: 7 }}>EPS</th>
            <th style={{ textAlign: 'right', fontWeight: 500, color: 'var(--ink-3)', fontSize: 11, paddingBottom: 7 }}>{th ? 'รายได้' : 'Revenue'}</th>
            <th style={{ textAlign: 'right', fontWeight: 500, color: 'var(--ink-3)', fontSize: 11, paddingBottom: 7 }}>YoY</th>
          </tr>
        </thead>
        <tbody>
          {estimates.map((e, i) => (
            <tr key={e.period} style={{ background: isYear(e) ? 'var(--bg-2)' : 'transparent' }}>
              <td style={{ padding: '5px 0', borderTop: '0.5px solid var(--line)', fontWeight: isYear(e) ? 500 : 400 }}>{e.label}</td>
              <td style={{ padding: '5px 0', borderTop: '0.5px solid var(--line)', textAlign: 'right', fontWeight: isYear(e) ? 500 : 400 }}>{e.epsEst ?? '—'}</td>
              <td style={{ padding: '5px 0', borderTop: '0.5px solid var(--line)', textAlign: 'right', fontWeight: isYear(e) ? 500 : 400 }}>{fmtB(e.revEst, ccy)}</td>
              <td style={{ padding: '5px 0', borderTop: '0.5px solid var(--line)', textAlign: 'right', color: e.growth > 0 ? '#085041' : e.growth < 0 ? '#993C1D' : 'var(--ink-2)' }}>
                {e.growth != null ? (e.growth > 0 ? '+' : '') + e.growth + '%' : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

    </div>
  )
}

function QuarterlyCard({ data, aiSummary, aiLoading, accentColor, th, src }) {
  const { quarterly } = data
  const ccy = data.currency || 'THB'

  if (!quarterly?.length) return (
    <div style={CARD}>
      <div style={SEC}>{th ? 'งบการเงินรายไตรมาส' : 'Quarterly Financials'}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '24px 0', textAlign: 'center' }}>
        {th ? 'ไม่มีข้อมูลงบการเงิน' : 'No quarterly data'}
      </div>
    </div>
  )

  const maxRev = Math.max(...quarterly.map(q => q.revenue || 0))
  const maxNI  = Math.max(...quarterly.map(q => q.netIncome || 0))
  const barH   = (v, max) => max > 0 && v != null ? Math.max(6, Math.round(8 + (v / max) * 36)) : 6

  const cols = `90px ${quarterly.map(() => '1fr').join(' ')}`
  const rowStyle = { display: 'contents' }
  const labelCell = { fontSize: 11, fontWeight: 500, color: 'var(--ink-3)', padding: '5px 0', borderBottom: '0.5px solid var(--line)', display: 'flex', alignItems: 'center' }
  const dataCell  = (bold) => ({ fontSize: 12, padding: '5px 0 5px 8px', borderBottom: '0.5px solid var(--line)', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontWeight: bold ? 500 : 400 })

  return (
    <div style={CARD}>
      <div style={{ ...SEC, marginBottom: 12 }}>
        {th ? 'งบการเงินรายไตรมาส' : 'Quarterly Financials'}
        <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 400, textTransform: 'none', color: 'var(--ink-3)' }}>
          {th ? `ย้อนหลัง ${quarterly.length} ไตรมาส` : `last ${quarterly.length}Q`}
        </span>
        <SourceBadge src={src} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 0 }}>

        {/* Header row */}
        <div style={{ height: 46, display: 'flex', alignItems: 'flex-end', paddingBottom: 6, borderBottom: '0.5px solid var(--line)' }} />
        {quarterly.map((q, i) => (
          <div key={q.date} style={{ height: 46, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', paddingLeft: 8, paddingBottom: 6, borderBottom: '0.5px solid var(--line)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 6px', background: i === 0 ? accentColor.bg : 'var(--bg-2)', color: i === 0 ? accentColor.color : 'var(--ink-3)' }}>
              {q.label}{i === 0 ? (th ? ' ▲ล่าสุด' : ' ▲Latest') : ''}
            </div>
          </div>
        ))}

        {/* Mini bar chart */}
        <div style={{ height: 56, display: 'flex', alignItems: 'flex-end', paddingBottom: 4, borderBottom: '0.5px solid var(--line)', gap: 6 }}>
          <div style={{ fontSize: 9, color: 'var(--ink-3)', lineHeight: 1.8 }}>
            <span style={{ color: '#1D9E75' }}>■</span> {th ? 'รายได้' : 'Rev'}<br />
            <span style={{ color: '#AFA9EC' }}>■</span> {th ? 'กำไร' : 'NI'}
          </div>
        </div>
        {quarterly.map((q, i) => (
          <div key={q.date} style={{ height: 56, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', paddingLeft: 8, paddingBottom: 4, gap: 3, borderBottom: '0.5px solid var(--line)' }}>
            <div style={{ width: 10, height: barH(q.revenue, maxRev), background: i === 0 ? '#1D9E75' : '#9FE1CB', borderRadius: '3px 3px 0 0' }} />
            <div style={{ width: 10, height: barH(q.netIncome, maxNI), background: i === 0 ? '#AFA9EC' : '#CECBF6', borderRadius: '3px 3px 0 0' }} />
          </div>
        ))}

        {/* Revenue row */}
        <div style={labelCell}>{th ? 'รายได้รวม' : 'Revenue'}</div>
        {quarterly.map((q, i) => <div key={q.date} style={dataCell(i === 0)}>{fmtB(q.revenue, ccy)}</div>)}

        {/* Gross profit row */}
        {quarterly.some(q => q.grossProfit != null) && <>
          <div style={labelCell}>{th ? 'กำไรขั้นต้น' : 'Gross Profit'}</div>
          {quarterly.map((q, i) => (
            <div key={q.date} style={dataCell(i === 0)}>
              {q.grossProfit != null ? (
                <span>{fmtB(q.grossProfit, ccy)}{q.grossMargin != null && <span style={{ fontSize: 10, color: 'var(--ink-3)', marginLeft: 3 }}>{q.grossMargin}%</span>}</span>
              ) : '—'}
            </div>
          ))}
        </>}

        {/* Net income row */}
        <div style={labelCell}>{th ? 'กำไรสุทธิ' : 'Net Income'}</div>
        {quarterly.map((q, i) => <div key={q.date} style={dataCell(i === 0)}>{fmtB(q.netIncome, ccy)}</div>)}

        {/* EPS row */}
        <div style={labelCell}>EPS</div>
        {quarterly.map((q, i) => <div key={q.date} style={dataCell(i === 0)}>{q.eps ?? '—'}</div>)}

        {/* QoQ row */}
        <div style={{ ...labelCell, borderBottom: 'none' }}>{th ? 'กำไร QoQ' : 'NI QoQ'}</div>
        {quarterly.map((q, i) => (
          <div key={q.date} style={{ ...dataCell(false), borderBottom: 'none', color: q.qoq > 0 ? '#085041' : q.qoq < 0 ? '#993C1D' : 'var(--ink-3)' }}>
            {q.qoq != null ? (q.qoq > 0 ? '▲' : '▼') + Math.abs(q.qoq).toFixed(1) + '%' : '—'}
          </div>
        ))}
      </div>

      {/* AI summary */}
      {(aiLoading || aiSummary) && (
        <div style={{ marginTop: 12, padding: '11px 13px', background: accentColor.bg, border: `0.5px solid ${accentColor.border}`, borderRadius: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: accentColor.color, letterSpacing: '.05em', marginBottom: 5 }}>
            ✦ AI {th ? 'สรุปงบ' : 'Summary'}
          </div>
          {aiLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <Shimmer h={12} w="90%" />
              <Shimmer h={12} w="75%" />
            </div>
          ) : (
            <div style={{ fontSize: 12.5, lineHeight: 1.7, color: accentColor.color }}>{aiSummary}</div>
          )}
        </div>
      )}
    </div>
  )
}

function getSentiment(title) {
  const t = (title || '').toLowerCase()
  const b = ['profit', 'growth', 'beat', 'surge', 'record', 'strong', 'buy', 'upgrade', 'raise', 'outperform', 'rally', 'soar', 'jump', 'positive', 'deal', 'launch', 'tops', 'exceeds', 'rises', 'gains', 'bullish'].filter(w => t.includes(w)).length
  const e = ['loss', 'decline', 'fall', 'miss', 'weak', 'sell', 'downgrade', 'cut', 'lower', 'crash', 'drop', 'tumble', 'slump', 'risk', 'warning', 'concern', 'lawsuit', 'fine', 'warn', 'fails', 'disappoints', 'bearish'].filter(w => t.includes(w)).length
  return b > e ? 'bull' : e > b ? 'bear' : 'neutral'
}

function NewsSection({ newsItems, newsBrief, newsBriefLoading, loading, lang, accentColor }) {
  const th = lang === 'th'
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)

  if (loading) return (
    <div style={CARD}>
      <div style={SEC}>{th ? 'ข่าวล่าสุด' : 'Recent News'}</div>
      {[0,1,2].map(i => (
        <div key={i} style={{ padding: '9px 0', borderBottom: i < 2 ? '0.5px solid var(--line)' : 'none' }}>
          <Shimmer h={13} w="85%" r={4} /><div style={{ marginTop: 5 }}><Shimmer h={10} w="40%" r={4} /></div>
        </div>
      ))}
    </div>
  )

  if (!newsItems?.length) return (
    <div style={CARD}>
      <div style={SEC}>{th ? 'ข่าวล่าสุด' : 'Recent News'}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '16px 0', textAlign: 'center' }}>
        {th ? 'ยังไม่มีข่าวในขณะนี้' : 'No recent news'}
      </div>
    </div>
  )

  const withSent = newsItems.map(item => ({ ...item, sentiment: getSentiment(item.title) }))
  const counts = { bull: 0, bear: 0, neutral: 0 }
  withSent.forEach(i => counts[i.sentiment]++)
  const filtered = filter === 'all' ? withSent : withSent.filter(i => i.sentiment === filter)

  const now = Date.now()
  const ONE_DAY = 86400000
  const getGroup = pub => {
    if (!pub) return th ? 'เก่ากว่า' : 'Older'
    const diff = now - new Date(pub).getTime()
    if (diff < ONE_DAY)     return th ? 'วันนี้' : 'Today'
    if (diff < 2 * ONE_DAY) return th ? 'เมื่อวาน' : 'Yesterday'
    if (diff < 7 * ONE_DAY) return th ? 'สัปดาห์นี้' : 'This week'
    return th ? 'เก่ากว่า' : 'Older'
  }
  const ORDER = th ? ['วันนี้', 'เมื่อวาน', 'สัปดาห์นี้', 'เก่ากว่า'] : ['Today', 'Yesterday', 'This week', 'Older']
  const groups = {}
  for (const item of filtered) {
    const g = getGroup(item.pubDate)
    if (!groups[g]) groups[g] = []
    groups[g].push(item)
  }

  const sentStyle = s => s === 'bull'
    ? { bg: 'rgba(29,158,117,0.1)', color: '#085041', label: th ? 'เชิงบวก' : 'Bullish' }
    : s === 'bear'
    ? { bg: 'rgba(220,80,40,0.1)', color: '#993C1D', label: th ? 'เชิงลบ' : 'Bearish' }
    : { bg: 'var(--bg-2)', color: 'var(--ink-3)', label: th ? 'กลาง' : 'Neutral' }

  const FILTERS = [
    { key: 'all',     label: th ? `ทั้งหมด (${newsItems.length})` : `All (${newsItems.length})` },
    { key: 'bull',    label: `${th ? 'เชิงบวก' : 'Bullish'} (${counts.bull})` },
    { key: 'bear',    label: `${th ? 'เชิงลบ' : 'Bearish'} (${counts.bear})` },
    { key: 'neutral', label: `${th ? 'กลาง' : 'Neutral'} (${counts.neutral})` },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* AI News Brief */}
      {(newsBriefLoading || newsBrief) && (
        <div style={{ ...CARD, background: accentColor.bg, border: `0.5px solid ${accentColor.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: accentColor.color, letterSpacing: '.05em', marginBottom: 6 }}>
            ✦ AI {th ? 'สรุปข่าว' : 'News Brief'}
          </div>
          {newsBriefLoading
            ? <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><Shimmer h={12} w="90%" /><Shimmer h={12} w="70%" /></div>
            : <div style={{ fontSize: 12.5, lineHeight: 1.7, color: accentColor.color }}>{newsBrief}</div>
          }
        </div>
      )}

      {/* Main news card */}
      <div style={CARD}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ ...SEC, marginBottom: 0 }}>{th ? 'ข่าวล่าสุด' : 'Recent News'}</div>
          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{newsItems.length} {th ? 'บทความ' : 'articles'}</span>
        </div>

        {/* Sentiment filter chips */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
          {FILTERS.map(f => {
            const active = filter === f.key
            return (
              <button key={f.key} onClick={() => { setFilter(f.key); setExpanded(null) }}
                style={{
                  fontSize: 11, fontWeight: 500, padding: '3px 11px', borderRadius: 20, cursor: 'pointer',
                  border: active
                    ? `0.5px solid ${f.key === 'bull' ? 'rgba(29,158,117,0.4)' : f.key === 'bear' ? 'rgba(220,80,40,0.4)' : 'rgba(112,72,232,0.4)'}`
                    : '0.5px solid var(--line)',
                  background: active
                    ? f.key === 'bull' ? 'rgba(29,158,117,0.1)' : f.key === 'bear' ? 'rgba(220,80,40,0.1)' : 'rgba(112,72,232,0.1)'
                    : 'var(--bg-2)',
                  color: active
                    ? f.key === 'bull' ? '#085041' : f.key === 'bear' ? '#993C1D' : '#7048e8'
                    : 'var(--ink-3)',
                }}>
                {f.label}
              </button>
            )
          })}
        </div>

        {/* Grouped items */}
        {filtered.length === 0
          ? <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '12px 0', textAlign: 'center' }}>{th ? 'ไม่มีข่าวในหมวดนี้' : 'No news in this filter'}</div>
          : ORDER.map(grp => {
            const grpItems = groups[grp]
            if (!grpItems?.length) return null
            return (
              <div key={grp}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 6px' }}>
                  <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--ink-3)', letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{grp}</span>
                  <div style={{ flex: 1, height: '0.5px', background: 'var(--line)' }} />
                </div>
                {grpItems.map((item, idx) => {
                  const key = `${grp}-${idx}`
                  const isExp = expanded === key
                  const ss = sentStyle(item.sentiment)
                  const fresh = item.pubDate && (now - new Date(item.pubDate).getTime()) < 7200000
                  const href = item.link || item.url || '#'
                  const hasDesc = !!item.description
                  const isLast = idx === grpItems.length - 1
                  return (
                    <div key={key}
                      style={{ padding: '8px 0', borderBottom: isLast ? 'none' : '0.5px solid var(--line)', cursor: hasDesc ? 'pointer' : 'default' }}
                      onClick={() => {
                        if (hasDesc) setExpanded(isExp ? null : key)
                        else window.open(href, '_blank', 'noopener,noreferrer')
                      }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        {(item.thumbnail || item.image) && (
                          <img src={item.thumbnail || item.image} alt=""
                            style={{ width: 60, height: 45, borderRadius: 6, objectFit: 'cover', flexShrink: 0, background: 'var(--bg-2)' }}
                            onError={e => { e.target.style.display = 'none' }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.45, marginBottom: 4,
                            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {item.title}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                              {item.source}{item.pubDate ? ` · ${timeAgo(item.pubDate, lang)}` : ''}
                            </span>
                            <span style={{ fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 10, background: ss.bg, color: ss.color }}>
                              {ss.label}
                            </span>
                            {fresh && (
                              <span style={{ fontSize: 9, fontWeight: 500, background: 'rgba(56,138,230,0.12)', color: '#2d7ac9', borderRadius: 4, padding: '1px 5px' }}>NEW</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {isExp && hasDesc && (
                        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.65, color: 'var(--ink-2)',
                          borderLeft: `2px solid ${accentColor.border}`, paddingLeft: 10 }}>
                          {item.description}
                          <a href={href} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            style={{ display: 'inline-block', marginTop: 5, fontSize: 11, color: accentColor.color, textDecoration: 'none', fontWeight: 500 }}>
                            {th ? 'อ่านเพิ่มเติม →' : 'Read more →'}
                          </a>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })
        }
      </div>
    </div>
  )
}

export function StockDigest({ items, prices, lang, liveHoldings = [] }) {
  const th = lang === 'th'

  const yahooItems = useMemo(() => {
    // Convert portfolio holdings to same shape as watchlist items
    const holdingItems = liveHoldings.map(h => ({
      symbol: h.ticker,
      region: h.region || 'US',
      cls: h.asset_class || 'Equity',
      name: h.name || h.ticker,
    }))
    // Merge watchlist first, then portfolio — dedup by Yahoo symbol
    const all = [...items, ...holdingItems]
    const seen = new Set()
    const deduped = []
    for (const item of all) {
      const sym = toYahooSymbol(item.symbol, item.region || 'US', item.cls || 'Equity')
      if (!seen.has(sym)) { seen.add(sym); deduped.push(item) }
    }
    return deduped.map((item, i) => ({
      ...item,
      yahooSym: toYahooSymbol(item.symbol, item.region || 'US', item.cls || 'Equity'),
      paletteColor: PALETTE[i % PALETTE.length],
    }))
  }, [items, liveHoldings])

  const [activeSym,  setActiveSym]  = useState(() => yahooItems[0]?.yahooSym || null)
  const [digestTab,  setDigestTab]  = useState('analyst') // 'analyst' | 'financials'
  const [analystData, setAnalystData] = useState(null)
  const [newsItems,        setNewsItems]        = useState([])
  const [loading,          setLoading]          = useState(false)
  const [newsLoading,      setNewsLoading]      = useState(false)
  const [aiSummary,        setAiSummary]        = useState(null)
  const [aiLoading,        setAiLoading]        = useState(false)
  const [newsBrief,        setNewsBrief]        = useState(null)
  const [newsBriefLoading, setNewsBriefLoading] = useState(false)
  const cacheRef = useRef({})

  // Keep activeSym valid when items change
  useEffect(() => {
    if (yahooItems.length === 0) { setActiveSym(null); return }
    if (!activeSym || !yahooItems.find(x => x.yahooSym === activeSym)) {
      setActiveSym(yahooItems[0].yahooSym)
    }
  }, [yahooItems])

  const loadData = useCallback(async (sym) => {
    if (!sym) return
    if (cacheRef.current[sym]) {
      const c = cacheRef.current[sym]
      setAnalystData(c.analyst)
      setNewsItems(c.news)
      setAiSummary(c.ai)
      setNewsBrief(c.newsBrief ?? null)
      return
    }

    setLoading(true)
    setNewsLoading(true)
    setAnalystData(null)
    setNewsItems([])
    setAiSummary(null)
    setAiLoading(false)
    setNewsBrief(null)
    setNewsBriefLoading(false)

    const [ar, nr] = await Promise.allSettled([
      fetch(`/api/analyst?symbol=${encodeURIComponent(sym)}`).then(r => r.json()),
      fetch(`/api/news?symbols=${encodeURIComponent(sym)}&count=10`).then(r => r.json()),
    ])

    const analyst = ar.status === 'fulfilled' ? ar.value : {}
    const news = nr.status === 'fulfilled'
      ? (Array.isArray(nr.value) ? nr.value : nr.value?.items || [])
      : []

    setAnalystData(analyst)
    setNewsItems(news)
    setLoading(false)
    setNewsLoading(false)

    // Run both AI summaries in parallel
    let aiResult = null
    let newsBriefResult = null
    const aiTasks = []

    if (analyst?.quarterly?.length) {
      const ccy = analyst.currency || 'THB'
      const activeItm = yahooItems.find(x => x.yahooSym === sym)
      const ticker = activeItm?.symbol || sym
      const text = `${ticker} งบการเงินรายไตรมาส: ${analyst.quarterly.map(q =>
        `${q.label} รายได้ ${fmtB(q.revenue, ccy)} กำไรสุทธิ ${fmtB(q.netIncome, ccy)} EPS ${q.eps ?? '-'}`
      ).join('; ')}`
      setAiLoading(true)
      aiTasks.push(
        fetch(`/api/summarize?title=${encodeURIComponent(text)}`)
          .then(r => r.json())
          .then(d => { aiResult = d.summary || null; setAiSummary(aiResult) })
          .catch(() => {})
          .finally(() => setAiLoading(false))
      )
    }

    if (news.length > 0) {
      const titles = news.slice(0, 8).map(n => n.title).join('\n')
      setNewsBriefLoading(true)
      aiTasks.push(
        fetch(`/api/summarize?title=${encodeURIComponent(titles)}`)
          .then(r => r.json())
          .then(d => { newsBriefResult = d.summary || null; setNewsBrief(newsBriefResult) })
          .catch(() => {})
          .finally(() => setNewsBriefLoading(false))
      )
    }

    Promise.allSettled(aiTasks).then(() => {
      cacheRef.current[sym] = { analyst, news, ai: aiResult, newsBrief: newsBriefResult }
    })
    if (aiTasks.length === 0) {
      cacheRef.current[sym] = { analyst, news, ai: null, newsBrief: null }
    }
  }, [yahooItems])

  useEffect(() => { loadData(activeSym) }, [activeSym, loadData])

  if (items.length === 0) return (
    <div style={{ textAlign: 'center', padding: '72px 24px', color: 'var(--ink-3)', fontSize: 14 }}>
      {th ? 'ยังไม่มีหุ้นใน Watchlist' : 'No stocks in watchlist yet'}
    </div>
  )

  const activeItem = yahooItems.find(x => x.yahooSym === activeSym) || yahooItems[0]
  const priceData  = activeItem ? prices[activeItem.yahooSym] : null
  const accent     = activeItem?.paletteColor || PALETTE[0]
  const ccy        = analystData?.currency || 'THB'
  const ccyS       = ccy === 'USD' ? '$' : '฿'
  const currentPrice = priceData?.price ?? analystData?.currentPrice ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Ticker chips */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {yahooItems.map(item => {
          const active = item.yahooSym === activeSym
          const c = item.paletteColor
          return (
            <button key={item.yahooSym} onClick={() => setActiveSym(item.yahooSym)}
              style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 14px', borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 500, border: `0.5px solid ${active ? c.border : 'var(--line)'}`, background: active ? c.bg : 'var(--bg-2)', color: active ? c.color : 'var(--ink-3)' }}>
              {item.symbol}
            </button>
          )
        })}
      </div>

      {/* View toggle — วิเคราะห์ / งบการเงิน */}
      <div style={{ display: 'flex', background: 'var(--bg-2)', borderRadius: 10, padding: 3, gap: 3, width: 'fit-content' }}>
        {[['analyst', th ? 'วิเคราะห์' : 'Analysis'], ['financials', th ? 'งบการเงิน' : 'Financials']].map(([key, lbl]) => (
          <button key={key} onClick={() => setDigestTab(key)} style={{
            padding: '5px 14px', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
            background: digestTab === key ? 'var(--bg-1)' : 'transparent',
            color: digestTab === key ? 'var(--ink-1)' : 'var(--ink-3)',
            fontWeight: digestTab === key ? 500 : 400,
            boxShadow: digestTab === key ? '0 0 0 0.5px var(--line)' : 'none',
          }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* Header card */}
      <div style={{ ...CARD, padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TickerLogo ticker={activeItem?.symbol} region={activeItem?.region} cls={activeItem?.cls} size={38} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 500 }}>
                {loading ? <Shimmer h={15} w={160} /> : (analystData?.name || activeItem?.name || activeItem?.symbol || '')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {activeItem?.symbol} · {activeItem?.region || 'US'}{activeItem?.cls === 'Crypto' ? ' · Crypto' : ''}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {priceData ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 500 }}>{ccyS}{priceData.price?.toLocaleString()}</div>
                <div style={{ fontSize: 12, fontWeight: 500, color: priceData.changePct >= 0 ? '#085041' : '#993C1D' }}>
                  {priceData.changePct >= 0 ? '▲' : '▼'} {Math.abs(priceData.changePct ?? 0).toFixed(2)}%
                  {priceData.change != null ? ` ${priceData.change >= 0 ? '+' : ''}${priceData.change.toFixed(2)}` : ''}
                </div>
              </>
            ) : (
              loading ? <Shimmer h={20} w={80} /> : <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>—</div>
            )}
          </div>
        </div>

        {/* Key metrics row */}
        <div style={{ display: 'flex', gap: 18, marginTop: 10, paddingTop: 10, borderTop: '0.5px solid var(--line)', flexWrap: 'wrap' }}>
          {[
            [th ? 'มูลค่าตลาด' : 'Mkt cap', fmtB(analystData?.marketCap, ccy)],
            ['P/E', analystData?.trailingPE != null ? analystData.trailingPE + 'x' : '—'],
            ['P/BV', analystData?.priceToBook != null ? analystData.priceToBook + 'x' : '—'],
            [th ? 'ปันผล' : 'Div yield', analystData?.dividendYield != null ? analystData.dividendYield + '%' : '—'],
            ['52W', analystData?.w52low != null && analystData?.w52high != null
              ? `${ccyS}${analystData.w52low} – ${ccyS}${analystData.w52high}` : '—'],
          ].map(([lbl, val]) => (
            <div key={lbl}>
              <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>{lbl}</div>
              <div style={{ fontSize: 12, fontWeight: 500 }}>{loading ? <Shimmer h={12} w={40} /> : val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Financials tab */}
      {digestTab === 'financials' && (
        <StockFinancials symbol={activeSym} lang={lang} accentColor={accent} />
      )}

      {/* Analyst tab content */}
      {digestTab === 'analyst' && (
        <>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={CARD}><div style={SEC}>{th ? 'ความเห็นนักวิเคราะห์' : 'Analyst Consensus'}</div><Shimmer h={8} /><div style={{ marginTop: 10 }}><Shimmer h={60} /></div></div>
              <div style={CARD}><div style={SEC}>{th ? 'คาดการณ์ล่วงหน้า' : 'Forward Estimates'}</div><Shimmer h={100} /></div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ConsensusCard data={analystData || {}} currentPrice={currentPrice} ccy={ccy} th={th} src={analystData?.sources?.consensus} region={activeItem?.region} />
              <EstimatesCard data={analystData || {}} th={th} src={analystData?.sources?.estimates} />
            </div>
          )}

          <NewsSection newsItems={newsItems} newsBrief={newsBrief} newsBriefLoading={newsBriefLoading} loading={newsLoading} lang={lang} accentColor={accent} />
        </>
      )}

    </div>
  )
}
