import { useState, useEffect, useRef } from 'react'

const CARD = { padding: '14px 16px', background: 'var(--bg-1)', border: '0.5px solid var(--line)', borderRadius: 'var(--radius)' }
const SEC  = { fontSize: 10, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 10 }

function Shimmer({ h = 14, w = '100%', r = 6 }) {
  return <div className="shimmer" style={{ height: h, width: w, borderRadius: r, background: 'var(--bg-2)' }} />
}

function fmtFin(v, isEPS = false) {
  if (v == null) return '—'
  if (isEPS) return typeof v === 'number' ? v.toFixed(2) : v
  const abs = Math.abs(v)
  const s   = v < 0 ? '-' : ''
  if (abs >= 1e12) return s + (abs / 1e12).toFixed(2) + 'T'
  if (abs >= 1e9)  return s + (abs / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6)  return s + (abs / 1e6).toFixed(1) + 'M'
  return s + abs.toLocaleString()
}

function fmtPct(v) {
  if (v == null) return null
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
}

function calcYoY(periods, field) {
  const a = periods[0]?.[field]
  const b = periods[1]?.[field]
  if (typeof a !== 'number' || typeof b !== 'number' || b === 0) return null
  return (a - b) / Math.abs(b) * 100
}

function Spark({ periods, field }) {
  const vals = [...periods].reverse().map(p => p[field])
  const nums = vals.filter(v => typeof v === 'number')
  if (nums.length < 2) return <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>—</span>

  const maxAbs = Math.max(...nums.map(Math.abs), 1)
  const bw = 9, gap = 3
  const svgW = vals.length * (bw + gap) - gap
  const bars = vals.map((v, i) => {
    const x = i * (bw + gap)
    if (typeof v !== 'number') {
      return `<rect x="${x}" y="8" width="${bw}" height="10" rx="1" fill="var(--bg-2)"/>`
    }
    const h    = Math.max(Math.round(Math.abs(v) / maxAbs * 20), 2)
    const y    = 22 - h
    const fill = v >= 0 ? '#14977a' : '#c04820'
    const op   = i === vals.length - 1 ? '1' : '0.45'
    return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="1" fill="${fill}" opacity="${op}"/>`
  }).join('')

  return (
    <svg width={svgW} height={26} viewBox={`0 0 ${svgW} 26`}
      dangerouslySetInnerHTML={{ __html: bars }} />
  )
}

function MetricCards({ periods, metrics }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
      {metrics.map(({ label, field, isEPS, pctField }) => {
        const v   = periods[0]?.[field]
        const yoy = calcYoY(periods, pctField || field)
        return (
          <div key={field} style={{ background: 'var(--bg-2)', borderRadius: 8, padding: '9px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>{fmtFin(v, isEPS)}</div>
            {yoy != null && (
              <div style={{ fontSize: 10, marginTop: 2, color: yoy >= 0 ? '#085041' : '#993C1D' }}>
                {yoy >= 0 ? '▲' : '▼'} {Math.abs(yoy).toFixed(1)}% YoY
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const rowStyle = {
  sec: {
    background: 'var(--bg-2)',
    fontWeight: 500,
    fontSize: 12,
    color: 'var(--ink-1)',
  },
  sub: {
    background: 'transparent',
    fontWeight: 400,
    fontSize: 11.5,
    color: 'var(--ink-3)',
  },
}

function FinTable({ periods, rows, th }) {
  if (!periods.length) return (
    <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
      {th ? 'ไม่มีข้อมูล' : 'No data available'}
    </div>
  )

  const labels  = [...periods].reverse().map(p => p.label)
  const colCnt  = labels.length

  return (
    <div style={{ overflowX: 'auto', borderRadius: 10, border: '0.5px solid var(--line)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '7px 10px 7px 12px', fontSize: 10, fontWeight: 500, color: 'var(--ink-3)', background: 'var(--bg-2)', borderBottom: '0.5px solid var(--line)', whiteSpace: 'nowrap', minWidth: 140 }}>
              {th ? 'รายการ' : 'Item'}
            </th>
            {labels.map((lbl, i) => (
              <th key={i} style={{ textAlign: 'right', padding: '7px 10px', fontSize: 10, fontWeight: 500, color: 'var(--ink-3)', background: 'var(--bg-2)', borderBottom: '0.5px solid var(--line)', whiteSpace: 'nowrap' }}>
                {lbl}
              </th>
            ))}
            <th style={{ textAlign: 'right', padding: '7px 8px', fontSize: 10, fontWeight: 400, color: 'var(--ink-3)', background: 'var(--bg-2)', borderBottom: '0.5px solid var(--line)', whiteSpace: 'nowrap', width: 52 }}>
              YoY
            </th>
            <th style={{ textAlign: 'center', padding: '7px 10px', fontSize: 10, fontWeight: 400, color: 'var(--ink-3)', background: 'var(--bg-2)', borderBottom: '0.5px solid var(--line)', width: colCnt * 12 + 20 }}>
              {th ? 'เทรนด์' : 'Trend'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const isSec   = row.type === 'sec'
            const rs      = isSec ? rowStyle.sec : rowStyle.sub
            const accentL = row.accent === 'green' ? '2.5px solid #1D9E75'
                          : row.accent === 'red'   ? '2.5px solid #c04820'
                          : '2.5px solid var(--line)'
            const yoy     = row.isEPS ? null : calcYoY(periods, row.field)

            return (
              <tr key={ri} style={{ background: rs.background }}>
                <td style={{
                  padding: isSec ? '7px 10px 7px 10px' : '6px 10px 6px 22px',
                  borderBottom: '0.5px solid var(--line)',
                  fontWeight: rs.fontWeight,
                  fontSize: rs.fontSize,
                  color: rs.color,
                  borderLeft: isSec ? accentL : 'none',
                  whiteSpace: 'nowrap',
                }}>
                  {row.label}
                  {row.pctField && periods[0]?.[row.pctField] != null && (
                    <span style={{ fontSize: 10, color: 'var(--ink-3)', marginLeft: 5, fontWeight: 400 }}>
                      {periods[0][row.pctField].toFixed(1)}%
                    </span>
                  )}
                </td>
                {[...periods].reverse().map((p, ci) => {
                  const v    = p[row.field]
                  const isNeg = typeof v === 'number' && v < 0
                  return (
                    <td key={ci} style={{
                      textAlign: 'right',
                      padding: '6px 10px',
                      borderBottom: '0.5px solid var(--line)',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 12,
                      color: v == null ? 'var(--ink-3)' : isNeg ? '#c04820' : 'var(--ink-1)',
                    }}>
                      {fmtFin(v, row.isEPS)}
                    </td>
                  )
                })}
                <td style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '0.5px solid var(--line)', fontSize: 11, whiteSpace: 'nowrap' }}>
                  {yoy != null ? (
                    <span style={{ color: yoy >= 0 ? '#085041' : '#993C1D' }}>
                      {yoy >= 0 ? '▲' : '▼'}{Math.abs(yoy).toFixed(1)}%
                    </span>
                  ) : (
                    <span style={{ color: 'var(--ink-3)' }}>—</span>
                  )}
                </td>
                <td style={{ textAlign: 'center', padding: '4px 8px', borderBottom: '0.5px solid var(--line)' }}>
                  <Spark periods={periods} field={row.field} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function StockFinancials({ symbol, lang, accentColor }) {
  const th = lang === 'th'
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [period,  setPeriod]  = useState('annual')    // 'annual' | 'quarterly'
  const [tab,     setTab]     = useState('income')    // 'income' | 'balance' | 'cashflow'
  const cacheRef = useRef({})

  useEffect(() => {
    if (!symbol) return
    if (cacheRef.current[symbol]) { setData(cacheRef.current[symbol]); return }
    setLoading(true)
    setData(null)
    fetch(`/api/financials?symbol=${encodeURIComponent(symbol)}`)
      .then(r => r.json())
      .then(d => { cacheRef.current[symbol] = d; setData(d) })
      .catch(() => setData({}))
      .finally(() => setLoading(false))
  }, [symbol])

  const periods = data
    ? (period === 'annual' ? data[tab === 'income' ? 'income' : tab === 'balance' ? 'balance' : 'cashflow']?.annual
                           : data[tab === 'income' ? 'income' : tab === 'balance' ? 'balance' : 'cashflow']?.quarterly)
    ?? []
    : []

  const INCOME_METRICS = [
    { label: th ? 'รายได้รวม'   : 'Total Revenue',  field: 'revenue' },
    { label: th ? 'กำไรขั้นต้น' : 'Gross Profit',   field: 'grossProfit' },
    { label: th ? 'กำไรสุทธิ'   : 'Net Income',     field: 'netIncome' },
    { label: 'EPS',                                   field: 'eps', isEPS: true },
  ]
  const BALANCE_METRICS = [
    { label: th ? 'สินทรัพย์รวม'   : 'Total Assets',      field: 'totalAssets' },
    { label: th ? 'หนี้สินรวม'      : 'Total Liabilities', field: 'totalLiabilities' },
    { label: th ? 'ส่วนผู้ถือหุ้น'  : 'Equity',            field: 'equity' },
    { label: th ? 'D/E Ratio'       : 'D/E Ratio',         field: 'debtToEquity', isEPS: true },
  ]
  const CF_METRICS = [
    { label: th ? 'กระแสเงินสดดำเนินงาน' : 'Operating CF',  field: 'operatingCashflow' },
    { label: 'CAPEX',                                          field: 'capex' },
    { label: 'Free Cash Flow',                                 field: 'freeCashflow' },
    { label: th ? 'กระแสเงินสดลงทุน'      : 'Investing CF',  field: 'investingCashflow' },
  ]

  const INCOME_ROWS = [
    { type: 'sec', accent: 'green', label: th ? 'รายได้รวม'             : 'Total Revenue',      field: 'revenue' },
    { type: 'sub',                  label: th ? 'ต้นทุนขาย'             : 'Cost of Revenue',    field: 'costOfRevenue' },
    { type: 'sec', accent: 'green', label: th ? 'กำไรขั้นต้น'           : 'Gross Profit',       field: 'grossProfit', pctField: 'grossMargin' },
    { type: 'sub',                  label: th ? 'กำไรจากการดำเนินงาน'   : 'Operating Income',   field: 'operatingIncome' },
    { type: 'sub',                  label: 'EBITDA',                                              field: 'ebitda' },
    { type: 'sec', accent: 'green', label: th ? 'กำไรสุทธิ'             : 'Net Income',         field: 'netIncome' },
    { type: 'sub',                  label: 'EPS',                                                 field: 'eps', isEPS: true },
  ]
  const BALANCE_ROWS = [
    { type: 'sec', accent: 'green', label: th ? 'สินทรัพย์หมุนเวียน'   : 'Current Assets',      field: 'currentAssets' },
    { type: 'sub',                  label: th ? 'เงินสด'                : 'Cash & Equiv.',       field: 'cash' },
    { type: 'sub',                  label: th ? 'ลูกหนี้การค้า'         : 'Receivables',         field: 'receivables' },
    { type: 'sub',                  label: th ? 'สินค้าคงคลัง'          : 'Inventory',           field: 'inventory' },
    { type: 'sec', accent: 'green', label: th ? 'สินทรัพย์รวม'          : 'Total Assets',        field: 'totalAssets' },
    { type: 'sec', accent: 'red',   label: th ? 'หนี้สินหมุนเวียน'      : 'Current Liabilities', field: 'currentLiabilities' },
    { type: 'sub',                  label: th ? 'หนี้สินระยะยาว'        : 'Long-term Debt',      field: 'longTermDebt' },
    { type: 'sec', accent: 'red',   label: th ? 'หนี้สินรวม'            : 'Total Liabilities',  field: 'totalLiabilities' },
    { type: 'sec', accent: 'green', label: th ? 'ส่วนของผู้ถือหุ้น'     : 'Equity',              field: 'equity' },
    { type: 'sub',                  label: 'D/E Ratio',                                           field: 'debtToEquity', isEPS: true },
  ]
  const CF_ROWS = [
    { type: 'sec', accent: 'green', label: th ? 'กระแสเงินสดดำเนินงาน (CFO)' : 'Operating CF (CFO)', field: 'operatingCashflow' },
    { type: 'sub',                  label: th ? 'ค่าเสื่อมราคา'               : 'D&A',                field: 'depreciation' },
    { type: 'sub',                  label: th ? 'เปลี่ยนแปลง Working Capital' : 'Working Cap Change', field: 'workingCapChange' },
    { type: 'sec', accent: 'red',   label: th ? 'กระแสเงินสดลงทุน (CFI)'     : 'Investing CF (CFI)', field: 'investingCashflow' },
    { type: 'sub',                  label: 'CAPEX',                                                   field: 'capex' },
    { type: 'sec', accent: '',      label: th ? 'กระแสเงินสดจัดหาเงิน (CFF)' : 'Financing CF (CFF)', field: 'financingCashflow' },
    { type: 'sub',                  label: th ? 'จ่ายเงินปันผล'               : 'Dividends Paid',     field: 'dividendsPaid' },
    { type: 'sub',                  label: th ? 'กู้ยืม / ชำระหนี้'           : 'Net Borrowings',    field: 'netBorrowings' },
    { type: 'sec', accent: 'green', label: 'Free Cash Flow',                                         field: 'freeCashflow' },
  ]

  const activeMetrics = tab === 'income' ? INCOME_METRICS : tab === 'balance' ? BALANCE_METRICS : CF_METRICS
  const activeRows    = tab === 'income' ? INCOME_ROWS    : tab === 'balance' ? BALANCE_ROWS    : CF_ROWS
  const tabLabel      = {
    income:   th ? 'งบกำไรขาดทุน' : 'Income Statement',
    balance:  th ? 'งบดุล'         : 'Balance Sheet',
    cashflow: th ? 'กระแสเงินสด'  : 'Cash Flow',
  }
  const src = data?.sources?.[tab] || ''

  const tabBtn = (key) => ({
    padding: '5px 12px',
    fontSize: 12,
    border: 'none',
    borderBottom: tab === key ? `2px solid ${accentColor?.color || 'var(--ink-1)'}` : '2px solid transparent',
    background: 'transparent',
    fontWeight: tab === key ? 500 : 400,
    color: tab === key ? 'var(--ink-1)' : 'var(--ink-3)',
    cursor: 'pointer',
    marginBottom: -0.5,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Period + Source row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', background: 'var(--bg-2)', borderRadius: 8, padding: 2, gap: 2 }}>
          {[['annual', th ? 'รายปี' : 'Annual'], ['quarterly', th ? 'รายไตรมาส' : 'Quarterly']].map(([key, lbl]) => (
            <button key={key} onClick={() => setPeriod(key)} style={{
              padding: '4px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
              fontSize: 11, fontFamily: 'inherit',
              background: period === key ? 'var(--bg-1)' : 'transparent',
              color: period === key ? 'var(--ink-1)' : 'var(--ink-3)',
              fontWeight: period === key ? 500 : 400,
              boxShadow: period === key ? '0 0 0 0.5px var(--line)' : 'none',
            }}>
              {lbl}
            </button>
          ))}
        </div>
        {src && src !== '—' && (
          <span style={{ fontSize: 10, color: 'var(--ink-3)', background: 'var(--bg-2)', border: '0.5px solid var(--line)', borderRadius: 4, padding: '2px 6px' }}>
            {src}
          </span>
        )}
      </div>

      {/* Statement tabs */}
      <div style={{ ...CARD, padding: '0 4px' }}>
        <div style={{ display: 'flex', borderBottom: '0.5px solid var(--line)' }}>
          {['income', 'balance', 'cashflow'].map(key => (
            <button key={key} onClick={() => setTab(key)} style={tabBtn(key)}>
              {tabLabel[key]}
            </button>
          ))}
        </div>

        <div style={{ padding: '12px 0 4px' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
                {[1,2,3,4].map(i => <Shimmer key={i} h={52} r={8} />)}
              </div>
              <Shimmer h={200} r={10} />
            </div>
          ) : !data || !periods.length ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-3)', fontSize: 13 }}>
              {period === 'quarterly' && tab !== 'income'
                ? (th ? 'ไม่มีข้อมูลรายไตรมาส — ลองดูรายปี' : 'No quarterly data — try Annual')
                : (th ? 'ไม่มีข้อมูล' : 'No data available')}
            </div>
          ) : (
            <>
              <MetricCards periods={periods} metrics={activeMetrics} />
              <FinTable periods={periods} rows={activeRows} th={th} />
            </>
          )}
        </div>
      </div>

      {/* SET link */}
      <div style={{ textAlign: 'right' }}>
        <a
          href={`https://www.set.or.th/th/market/product/stock/quote/${symbol.replace('.BK','')}/financial-statement/company-highlights`}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, color: 'var(--ink-3)', textDecoration: 'none' }}
        >
          {th ? 'ดูข้อมูลเต็มที่ SET.or.th ↗' : 'View full data at SET.or.th ↗'}
        </a>
      </div>
    </div>
  )
}
