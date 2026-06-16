// Client-side Excel export using the xlsx library (SheetJS)
// 4 sheets: Holdings · Transactions · Realized P&L · Dividends
// xlsx is loaded lazily via dynamic import — only on first Export click.

import { getAllTransactions, computeRealized } from './db'

function n(v, dec = 2) {
  return (v != null && Number.isFinite(+v)) ? +Number(v).toFixed(dec) : null
}

function d(iso) {
  return iso ? String(iso).split('T')[0] : ''
}

function autoWidth(XLSX, ws) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
  const cols = []
  for (let C = range.s.c; C <= range.e.c; C++) {
    let max = 8
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
      if (cell?.v != null) max = Math.max(max, String(cell.v).length + 2)
    }
    cols.push({ wch: Math.min(max, 40) })
  }
  ws['!cols'] = cols
}

export async function exportPortfolioExcel({ rows = [], portfolioId, fxRate = 36, lang = 'en', portfolioName = 'Portfolio' }) {
  // Dynamic import — keeps xlsx out of the main bundle and avoids
  // module-init errors when the Portfolio page first renders.
  const XLSX = await import('xlsx')
  const TH = lang === 'th'

  // Fetch full transaction history
  const txs = await getAllTransactions(portfolioId)
  const realized = computeRealized(txs, fxRate)

  // ── Sheet 1: Holdings ────────────────────────────────────────────────────
  const h = (en, th) => TH ? th : en
  const holdingsRows = rows.map(r => ({
    [h('Ticker',           'ติ๊กเกอร์')]:          r.ticker,
    [h('Name',             'ชื่อ')]:                r.name || r.ticker,
    [h('Asset Class',      'ประเภท')]:              r.cls,
    [h('Region',           'ภูมิภาค')]:             r.region,
    [h('Shares',           'จำนวน')]:               n(r.shares, 6),
    [h('Cost/Share (THB)', 'ราคาทุน/หุ้น (฿)')]:   n(r.cost, 2),
    [h('Price/Share (THB)','ราคาตลาด/หุ้น (฿)')]:  n(r.price, 2),
    [h('Market Value (THB)','มูลค่าตลาด (฿)')]:    n(r.value, 2),
    [h('Cost Basis (THB)', 'ต้นทุนรวม (฿)')]:      n(r.value - (r.pl || 0), 2),
    [h('P&L (THB)',        'กำไร/ขาดทุน (฿)')]:    n(r.pl, 2),
    [h('P&L %',            'กำไร/ขาดทุน %')]:      n(r.plPct, 2),
    [h('Weight %',         'สัดส่วน %')]:           n(r.weight, 2),
    [h('Div Yield %',      'ปันผล %')]:             n(r.divYield, 2),
  }))

  // ── Sheet 2: Transactions ────────────────────────────────────────────────
  const txRows = [...txs].reverse().map(tx => ({
    [h('Date',     'วันที่')]:        d(tx.transacted_at),
    [h('Ticker',   'ติ๊กเกอร์')]:    tx.ticker || '',
    [h('Type',     'ประเภท')]:        tx.type || '',
    [h('Shares',   'จำนวน')]:        n(tx.shares, 6),
    [h('Price',    'ราคา')]:          n(tx.price, 4),
    [h('Fee',      'ค่าธรรมเนียม')]: n(tx.fee, 2),
    [h('Tax',      'ภาษี')]:          n(tx.tax, 2),
    [h('Currency', 'สกุลเงิน')]:     tx.currency || 'THB',
    [h('Notes',    'หมายเหตุ')]:     tx.notes || '',
  }))

  // ── Sheet 3: Realized P&L ────────────────────────────────────────────────
  const realizedRows = (realized.sales || []).map(s => ({
    [h('Sale Date',        'วันที่ขาย')]:           s.date,
    [h('Ticker',           'ติ๊กเกอร์')]:           s.ticker,
    [h('Shares Sold',      'จำนวนที่ขาย')]:         n(s.shares, 6),
    [h('Sale Price',       'ราคาขาย')]:             n(s.price, 4),
    [h('Currency',         'สกุลเงิน')]:            s.currency || 'THB',
    [h('Proceeds (THB)',   'รายรับ (฿)')]:          n(s.proceedsTHB, 2),
    [h('Cost Basis (THB)', 'ต้นทุน (฿)')]:          n(s.costTHB, 2),
    [h('Gain/Loss (THB)',  'กำไร/ขาดทุน (฿)')]:    n(s.gainTHB, 2),
    [h('Gain/Loss %',      'กำไร/ขาดทุน %')]:      n(s.gainPct, 2),
  }))

  // ── Sheet 4: Dividends ───────────────────────────────────────────────────
  const divRows = txs
    .filter(tx => tx.type === 'Dividend')
    .reverse()
    .map(tx => {
      const gross = n((tx.shares || 0) * (tx.price || 0), 2)
      const fee   = n(tx.fee, 2) || 0
      const tax   = n(tx.tax, 2) || 0
      return {
        [h('Date',    'วันที่')]:                  d(tx.transacted_at),
        [h('Ticker',  'ติ๊กเกอร์')]:               tx.ticker || '',
        [h('DPS',     'ปันผล/หุ้น')]:              n(tx.price, 4),
        [h('Shares',  'จำนวนหุ้น')]:               n(tx.shares, 6),
        [h('Gross',   'รวมก่อนหัก')]:              gross,
        [h('Fee',     'ค่าธรรมเนียม')]:             fee || null,
        [h('Tax',     'ภาษีหัก ณ ที่จ่าย')]:       tax || null,
        [h('Net',     'สุทธิ')]:                    gross != null ? +(gross - fee - tax).toFixed(2) : null,
        [h('Currency','สกุลเงิน')]:                tx.currency || 'THB',
        [h('Notes',   'หมายเหตุ')]:                tx.notes || '',
      }
    })

  // ── Build workbook ───────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()
  const addSheet = (data, name) => {
    const empty = [{ [TH ? 'ไม่มีข้อมูล' : 'No data']: '' }]
    const ws = XLSX.utils.json_to_sheet(data.length ? data : empty)
    autoWidth(XLSX, ws)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  addSheet(holdingsRows,  TH ? 'หลักทรัพย์'       : 'Holdings')
  addSheet(txRows,        TH ? 'ธุรกรรม'           : 'Transactions')
  addSheet(realizedRows,  TH ? 'กำไรขาดทุนที่ปิด'  : 'Realized PnL')
  addSheet(divRows,       TH ? 'ปันผล'             : 'Dividends')

  const today = new Date().toISOString().split('T')[0]
  XLSX.writeFile(wb, `${portfolioName.replace(/[/\\?%*:|"<>]/g, '-')}-${today}.xlsx`)
}
