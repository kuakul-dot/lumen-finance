import { useState, useEffect, useRef } from 'react'

const POS  = '#1D9E75'
const NEG  = '#D85A30'
const LINE = 'var(--line)'

function fmtFin(v, isRaw = false) {
  if (v == null) return '—'
  if (isRaw) return typeof v === 'number' ? v.toFixed(2) : String(v)
  const abs = Math.abs(v), s = v < 0 ? '-' : ''
  if (abs >= 1e12) return s + (abs / 1e12).toFixed(2) + 'T'
  if (abs >= 1e9)  return s + (abs / 1e9).toFixed(1) + 'B'
  if (abs >= 1e6)  return s + (abs / 1e6).toFixed(1) + 'M'
  return s + abs.toLocaleString()
}

function calcYoY(periods, field) {
  const a = periods[0]?.[field], b = periods[1]?.[field]
  if (typeof a !== 'number' || typeof b !== 'number' || b === 0) return null
  return (a - b) / Math.abs(b) * 100
}

function Spark({ periods, field }) {
  const vals = [...periods].reverse().map(p => p[field])
  const nums = vals.filter(v => typeof v === 'number')
  if (nums.length < 2) return (
    <svg width="70" height="26" viewBox="0 0 70 26">
      <text x="35" y="15" textAnchor="middle" fontSize="10" fill="var(--ink-3)">—</text>
    </svg>
  )
  const maxAbs = Math.max(...nums.map(Math.abs), 1)
  const bw = 12, gap = 4, n = vals.length
  const svgW = n * (bw + gap) - gap
  const bars = vals.map((v, i) => {
    const x = i * (bw + gap)
    if (typeof v !== 'number')
      return `<rect x="${x}" y="8" width="${bw}" height="10" rx="2" fill="var(--bg-2)" opacity="0.4"/>`
    const h = Math.max(Math.round(Math.abs(v) / maxAbs * 20), 2)
    const y = 22 - h
    const fill = v >= 0 ? POS : NEG
    const op = i === vals.length - 1 ? '1' : '0.55'
    return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="2" fill="${fill}" opacity="${op}"/>`
  }).join('')
  return <svg width={svgW} height={26} viewBox={`0 0 ${svgW} 26`} dangerouslySetInnerHTML={{ __html: bars }} />
}

function MetricStrip({ periods, metrics }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
      {metrics.map(({ label, field, isRaw, sub }) => {
        const v = periods[0]?.[field]
        const subText = sub ? sub(periods) : null
        const isPos = subText?.pos
        return (
          <div key={field} style={{ background: 'var(--bg-2)', borderRadius: 'var(--radius)', padding: '10px 12px', minWidth: 0, overflow: 'hidden' }}>
            <div style={{ fontSize: 10, color: 'var(--ink-3)', marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 500, whiteSpace: 'nowrap' }}>{fmtFin(v, isRaw)}</div>
            {subText && (
              <div style={{ fontSize: 10, marginTop: 2, whiteSpace: 'nowrap', color: isPos === true ? POS : isPos === false ? NEG : 'var(--ink-3)' }}>
                {subText.text}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FinTable({ periods, rows, th }) {
  if (!periods.length) return (
    <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
      {th ? 'ไม่มีข้อมูล' : 'No data available'}
    </div>
  )
  const labels = [...periods].reverse().map(p => p.label)

  return (
    <div style={{ border: `0.5px solid ${LINE}`, borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '7px 10px 7px 12px', fontSize: 10, fontWeight: 500, color: 'var(--ink-3)', background: 'var(--bg-2)', borderBottom: `0.5px solid ${LINE}`, whiteSpace: 'nowrap', width: 148 }}>
              {th ? 'รายการ' : 'Item'}
            </th>
            {labels.map((lbl, i) => (
              <th key={i} style={{ textAlign: 'right', padding: '7px 10px', fontSize: 10, fontWeight: 500, color: 'var(--ink-3)', background: 'var(--bg-2)', borderBottom: `0.5px solid ${LINE}`, whiteSpace: 'nowrap' }}>
                {lbl}
              </th>
            ))}
            <th style={{ textAlign: 'right', padding: '7px 8px', fontSize: 10, fontWeight: 500, color: 'var(--ink-3)', background: 'var(--bg-2)', borderBottom: `0.5px solid ${LINE}`, whiteSpace: 'nowrap', width: 54 }}>
              YoY
            </th>
            <th style={{ textAlign: 'center', padding: '7px 10px', fontSize: 10, fontWeight: 500, color: 'var(--ink-3)', background: 'var(--bg-2)', borderBottom: `0.5px solid ${LINE}`, width: 74 }}>
              {th ? 'เทรนด์' : 'Trend'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const isSec = row.type === 'sec'
            const accentColor = row.accent === 'green' ? POS : row.accent === 'red' ? NEG : LINE
            const yoy = row.isRaw ? null : calcYoY(periods, row.field)

            return (
              <tr key={ri} style={{ background: isSec ? 'var(--bg-2)' : 'transparent' }}>
                <td style={{
                  padding: isSec ? '6px 10px' : '5px 10px 5px 22px',
                  borderTop: isSec ? `0.5px solid ${LINE}` : 'none',
                  borderBottom: `0.5px solid ${LINE}`,
                  borderLeft: isSec ? `2.5px solid ${accentColor}` : 'none',
                  fontWeight: isSec ? 500 : 400,
                  fontSize: 11.5,
                  color: isSec ? 'var(--ink-1)' : 'var(--ink-3)',
                  whiteSpace: 'nowrap',
                  paddingLeft: isSec ? 10 : 22,
                }}>
                  {row.label}
                  {row.pctField && periods[0]?.[row.pctField] != null && (
                    <span style={{ fontSize: 10, color: 'var(--ink-3)', marginLeft: 5, fontWeight: 400 }}>
                      {periods[0][row.pctField].toFixed(1)}%
                    </span>
                  )}
                </td>
                {[...periods].reverse().map((p, ci) => {
                  const v = p[row.field]
                  const isNeg = typeof v === 'number' && v < 0
                  return (
                    <td key={ci} style={{
                      textAlign: 'right', padding: '5px 10px',
                      borderBottom: `0.5px solid ${LINE}`,
                      fontVariantNumeric: 'tabular-nums', fontSize: 12,
                      color: v == null ? 'var(--ink-3)' : isNeg ? NEG : 'var(--ink-1)',
                    }}>
                      {fmtFin(v, row.isRaw)}
                    </td>
                  )
                })}
                <td style={{ textAlign: 'right', padding: '5px 8px', borderBottom: `0.5px solid ${LINE}`, fontSize: 10.5, whiteSpace: 'nowrap' }}>
                  {yoy != null ? (
                    <span style={{ color: yoy >= 0 ? POS : NEG }}>
                      {yoy >= 0 ? '▲' : '▼'}{Math.abs(yoy).toFixed(1)}%
                    </span>
                  ) : (
                    <span style={{ color: 'var(--ink-3)', textAlign: 'center', display: 'block' }}>—</span>
                  )}
                </td>
                <td style={{ textAlign: 'center', padding: '3px 6px', borderBottom: `0.5px solid ${LINE}`, verticalAlign: 'middle' }}>
                  {row.isRaw ? null : <Spark periods={periods} field={row.field} />}
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
  const [period,  setPeriod]  = useState('annual')
  const [tab,     setTab]     = useState('income')
  const cacheRef = useRef({})

  useEffect(() => {
    if (!symbol) return
    if (cacheRef.current[symbol]) { setData(cacheRef.current[symbol]); return }
    setLoading(true); setData(null)
    fetch(`/api/financials?symbol=${encodeURIComponent(symbol)}`)
      .then(r => r.json())
      .then(d => { cacheRef.current[symbol] = d; setData(d) })
      .catch(() => setData({}))
      .finally(() => setLoading(false))
  }, [symbol])

  const stmtKey = tab === 'income' ? 'income' : tab === 'balance' ? 'balance' : 'cashflow'
  const periods = data ? (period === 'annual' ? data[stmtKey]?.annual : data[stmtKey]?.quarterly) ?? [] : []
  const isTH    = symbol?.endsWith('.BK') || data?.currency === 'THB'

  // Metric strip definitions
  const makeYoY = field => p => {
    const yoy = calcYoY(p, field)
    if (yoy == null) return null
    return { text: (yoy >= 0 ? '▲' : '▼') + Math.abs(yoy).toFixed(1) + '% YoY', pos: yoy >= 0 }
  }
  const INCOME_METRICS = [
    { label: th ? 'รายได้รวม'   : 'Total Revenue',  field: 'revenue',      sub: makeYoY('revenue') },
    { label: th ? 'กำไรขั้นต้น' : 'Gross Profit',   field: 'grossProfit',
      sub: p => { const m = p[0]?.grossMargin; return m != null ? { text: m.toFixed(1) + '% margin', pos: m >= 30 } : null } },
    { label: th ? 'กำไรสุทธิ'   : 'Net Income',     field: 'netIncome',    sub: makeYoY('netIncome') },
    { label: 'EPS',                                   field: 'eps', isRaw: true, sub: makeYoY('eps') },
  ]
  const BALANCE_METRICS = [
    { label: th ? 'สินทรัพย์รวม'  : 'Total Assets',      field: 'totalAssets' },
    { label: th ? 'หนี้สินรวม'     : 'Total Liabilities', field: 'totalLiabilities' },
    { label: th ? 'ส่วนผู้ถือหุ้น' : 'Equity',            field: 'equity',    sub: makeYoY('equity') },
    { label: 'D/E Ratio',                                  field: 'debtToEquity', isRaw: true,
      sub: p => { const v = p[0]?.debtToEquity; return v != null ? { text: v.toFixed(2) + 'x', pos: v < 1 } : null } },
  ]
  const CF_METRICS = [
    { label: th ? 'กระแสเงินสดดำเนินงาน' : 'Operating CF',  field: 'operatingCashflow', sub: makeYoY('operatingCashflow') },
    { label: 'CAPEX',                                          field: 'capex' },
    { label: 'Free Cash Flow',                                 field: 'freeCashflow',     sub: makeYoY('freeCashflow') },
    { label: th ? 'กระแสเงินสดลงทุน'     : 'Investing CF',   field: 'investingCashflow' },
  ]

  const INCOME_ROWS = [
    { type: 'sec', accent: 'green', label: th ? 'รายได้รวม'            : 'Total Revenue',      field: 'revenue' },
    { type: 'sub',                  label: th ? 'ต้นทุนขาย'            : 'Cost of Revenue',    field: 'costOfRevenue' },
    { type: 'sec', accent: 'green', label: th ? 'กำไรขั้นต้น'          : 'Gross Profit',       field: 'grossProfit', pctField: 'grossMargin' },
    { type: 'sub',                  label: th ? 'กำไรจากดำเนินงาน'     : 'Operating Income',   field: 'operatingIncome' },
    { type: 'sub',                  label: 'EBITDA',                                             field: 'ebitda' },
    { type: 'sec', accent: 'green', label: th ? 'กำไรสุทธิ'            : 'Net Income',         field: 'netIncome' },
    { type: 'sub',                  label: 'EPS',                                                field: 'eps', isRaw: true },
  ]
  const BALANCE_ROWS = [
    { type: 'sec', accent: 'green', label: th ? 'สินทรัพย์หมุนเวียน'  : 'Current Assets',      field: 'currentAssets' },
    { type: 'sub',                  label: th ? 'เงินสด'               : 'Cash & Equiv.',       field: 'cash' },
    { type: 'sub',                  label: th ? 'ลูกหนี้การค้า'        : 'Receivables',         field: 'receivables' },
    { type: 'sub',                  label: th ? 'สินค้าคงคลัง'         : 'Inventory',           field: 'inventory' },
    { type: 'sec', accent: 'green', label: th ? 'สินทรัพย์รวม'         : 'Total Assets',        field: 'totalAssets' },
    { type: 'sec', accent: 'red',   label: th ? 'หนี้สินหมุนเวียน'     : 'Current Liabilities', field: 'currentLiabilities' },
    { type: 'sub',                  label: th ? 'หนี้สินระยะยาว'       : 'Long-term Debt',      field: 'longTermDebt' },
    { type: 'sec', accent: 'red',   label: th ? 'หนี้สินรวม'           : 'Total Liabilities',  field: 'totalLiabilities' },
    { type: 'sec', accent: 'green', label: th ? 'ส่วนของผู้ถือหุ้น'    : 'Equity',              field: 'equity' },
    { type: 'sub',                  label: 'D/E Ratio',                                          field: 'debtToEquity', isRaw: true },
  ]
  const CF_ROWS = [
    { type: 'sec', accent: 'green', label: th ? 'กระแสเงินสดดำเนินงาน (CFO)' : 'Operating CF (CFO)', field: 'operatingCashflow' },
    { type: 'sub',                  label: th ? 'ค่าเสื่อมราคา'               : 'D&A',                field: 'depreciation' },
    { type: 'sub',                  label: th ? 'เปลี่ยนแปลง Working Capital' : 'Working Cap Change', field: 'workingCapChange' },
    { type: 'sec', accent: 'red',   label: th ? 'กระแสเงินสดลงทุน (CFI)'     : 'Investing CF (CFI)', field: 'investingCashflow' },
    { type: 'sub',                  label: 'CAPEX',                                                    field: 'capex' },
    { type: 'sec', accent: '',      label: th ? 'กระแสเงินสดจัดหาเงิน (CFF)' : 'Financing CF (CFF)', field: 'financingCashflow' },
    { type: 'sub',                  label: th ? 'จ่ายเงินปันผล'               : 'Dividends Paid',     field: 'dividendsPaid' },
    { type: 'sub',                  label: th ? 'กู้ยืม / ชำระหนี้'           : 'Net Borrowings',     field: 'netBorrowings' },
    { type: 'sec', accent: 'green', label: 'Free Cash Flow',                                          field: 'freeCashflow' },
  ]

  const activeMetrics = tab === 'income' ? INCOME_METRICS : tab === 'balance' ? BALANCE_METRICS : CF_METRICS
  const activeRows    = tab === 'income' ? INCOME_ROWS    : tab === 'balance' ? BALANCE_ROWS    : CF_ROWS
  const tabLabel = {
    income:   th ? 'งบกำไรขาดทุน' : 'Income Statement',
    balance:  th ? 'งบดุล'         : 'Balance Sheet',
    cashflow: th ? 'กระแสเงินสด'  : 'Cash Flow',
  }
  const sources = data?.sources || {}

  const noData = period === 'quarterly' && tab !== 'income'
    ? (th ? 'ไม่มีข้อมูลรายไตรมาส — ลองดูรายปี' : 'No quarterly data — try Annual')
    : (th ? 'ไม่มีข้อมูล' : 'No data available')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Period toggle + source */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', background: 'var(--bg-2)', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: 2, gap: 2 }}>
          {[['annual', th ? 'รายปี' : 'Annual'], ['quarterly', th ? 'รายไตรมาส' : 'Quarterly']].map(([key, lbl]) => (
            <button key={key} onClick={() => setPeriod(key)} style={{
              padding: '4px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
              fontSize: 11, fontFamily: 'inherit',
              background: period === key ? 'var(--bg-1)' : 'transparent',
              color: period === key ? 'var(--ink-1)' : 'var(--ink-3)',
              fontWeight: period === key ? 500 : 400,
              boxShadow: period === key ? `0 0 0 0.5px ${LINE}` : 'none',
            }}>
              {lbl}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['income', 'balance', 'cashflow'].map(k => sources[k] && sources[k] !== '—' && (
            <span key={k} style={{ fontSize: 10, background: 'var(--bg-2)', border: `0.5px solid ${LINE}`, borderRadius: 3, padding: '2px 6px', color: 'var(--ink-3)' }}>
              {sources[k]}
            </span>
          ))}
        </div>
      </div>

      {/* Statement tabs */}
      <div style={{ display: 'flex', borderBottom: `0.5px solid ${LINE}`, marginBottom: -1 }}>
        {['income', 'balance', 'cashflow'].map(key => (
          <button key={key} onClick={() => setTab(key)} style={{
            fontSize: 13, padding: '0 16px 8px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontFamily: 'inherit',
            color: tab === key ? 'var(--ink-1)' : 'var(--ink-3)',
            fontWeight: tab === key ? 500 : 400,
            borderBottom: tab === key ? '2px solid var(--ink-1)' : '2px solid transparent',
            marginBottom: -0.5,
          }}>
            {tabLabel[key]}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            {[1,2,3,4].map(i => <div key={i} className="shimmer" style={{ height: 52, borderRadius: 8, background: 'var(--bg-2)' }} />)}
          </div>
          <div className="shimmer" style={{ height: 200, borderRadius: 8, background: 'var(--bg-2)' }} />
        </div>
      ) : !data || !periods.length ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-3)', fontSize: 13 }}>{noData}</div>
      ) : (
        <>
          <MetricStrip periods={periods} metrics={activeMetrics} />
          <FinTable periods={periods} rows={activeRows} th={th} />
        </>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink-3)' }}>
          {th ? 'แหล่งข้อมูล' : 'Data source'}
          {['Yahoo Finance', 'FMP'].map(s => (
            <span key={s} style={{ background: 'var(--bg-2)', border: `0.5px solid ${LINE}`, borderRadius: 3, padding: '2px 6px', fontSize: 10 }}>{s}</span>
          ))}
        </div>
        {isTH && (
          <span style={{ fontSize: 11, color: '#854F0B', background: '#FAEEDA', border: '0.5px solid #EF9F27', borderRadius: 5, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
            ⚠ {th ? 'บางรายการอาจไม่ครบสำหรับหุ้นไทย' : 'Some fields may be incomplete for Thai stocks'}
          </span>
        )}
      </div>
    </div>
  )
}
