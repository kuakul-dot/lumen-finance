// PDF text extraction + transaction detection using pdfjs-dist
// Supports column-header detection (Thai & English) + heuristic fallback
//
// Column matching uses X-coordinate proximity (not array index) so it is robust
// against empty cells, wrapped header text, and bilingual two-row headers.
//
// Confirmed working (tested against real PDFs):
//   ✅ Dime! (ไดม์)          — Confirmation Note / Tax Invoice (US stocks, USD)
//   ✅ InnovestX (อินโนเวสท์) — Confirmation Note / Tax Invoice (TH stocks, THB)
//
// May work via the generic header/heuristic parsers (NOT yet verified):
//   🟡 Settrade / Bualuang / KGI / Finansia / other text-based broker PDFs
//   ❌ Scanned / image PDFs   — no OCR support

import * as pdfjs from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

// ─── Text extraction ──────────────────────────────────────────────────────────

const Y_SNAP = 3    // group text items within ±3 px vertically
const X_TOL  = 150  // max px off-centre to match a data cell to a header column

// Returns { rows, numPages }
// rows: Array<Array<{ x: number, text: string }>>  — sorted top→bottom, left→right
export async function extractPDFRows(file, password = '') {
  const buf  = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: buf, ...(password ? { password } : {}) })
  const doc  = await loadingTask.promise
  const numPages = doc.numPages

  const allRows = []

  for (let p = 1; p <= numPages; p++) {
    const page    = await doc.getPage(p)
    const content = await page.getTextContent()

    const byY = new Map()
    for (const item of content.items) {
      if (typeof item.str !== 'string' || !item.str.trim()) continue
      const y = Math.round(item.transform[5] / Y_SNAP) * Y_SNAP
      if (!byY.has(y)) byY.set(y, [])
      byY.get(y).push({ x: item.transform[4], text: item.str.trim() })
    }

    const rows = [...byY.entries()]
      .sort((a, b) => b[0] - a[0])                           // top → bottom
      .map(([, items]) => items.sort((a, b) => a.x - b.x))   // left → right

    allRows.push(...rows)
  }

  return { rows: allRows, numPages }
}

// ─── Header detection ─────────────────────────────────────────────────────────
// Each field lists patterns in priority order (most specific → most generic).
// findHeader maps field → X-coordinate of the matching header cell.

const HEADER_PATS = {
  transacted_at: [
    /วันที่ครบกำหนด/i,       // Dime!: วันที่ครบกำหนดชำระ
    /วันที่/i,                // generic Thai date
    /settlement.?date/i,      // Dime! English
    /effective.?date/i,
    /trade.?date/i,
    /^date$/i,
    /^day$/i,
  ],
  type: [
    /ประเภทรายการ/i,          // Dime! Thai
    /ประเภท/i,
    /transaction.?type/i,     // Dime! English
    /order.?type/i,
    /^type$/i,
    /^action$/i,
    /^side$/i,
  ],
  ticker: [
    /ชื่อหลักทรัพย์/i,        // Dime! Thai: ชื่อหลักทรัพย์ [ตลาด]
    /หลักทรัพย์/i,
    /securities/i,             // Dime! English: Securities [Exchange]
    /^symbol$/i,
    /^ticker$/i,
    /^code$/i,
    /scrip/i,
    /^stock/i,
  ],
  shares: [
    /จำนวนหน่วย/i,            // Dime! Thai: จำนวนหน่วย
    /^unit$/i,                 // Dime! English: Unit (exact)
    /^shares?$/i,
    /^vol(?:ume)?$/i,
    /^qty$/i,
    /^quantity$/i,
  ],
  price: [
    /ราคาต่อหน่วย/i,          // Dime! Thai: ราคาต่อหน่วย
    /unit.?price/i,            // Dime! English: Unit Price
    /avg.?price/i,
    /trade.?price/i,
    /^price$/i,
    /ราคา/i,
  ],
  amount: [
    /จำนวนเงิน(?!รวม)/i,      // "จำนวนเงิน" but NOT "จำนวนเงินรวม"
    /gross.?amount/i,          // Dime! English: Gross Amount
    /มูลค่า/i,
    /^amount$/i,
    /^gross$/i,
    /^value$/i,
    /net.?amount/i,
    /^net$/i,
  ],
  total: [
    /จำนวนเงินรวม/i,          // Dime! Thai: จำนวนเงินรวม
    /total.?amount/i,          // Dime! English: Total Amount
    /^total$/i,
    /รวมสุทธิ/i,
  ],
  fee: [
    /ค่าธรรมเนียมรวม/i,       // Dime! Thai: ค่าธรรมเนียมรวมภาษีมูลค่าเพิ่ม
    /ค่าธรรมเนียม/i,
    /ค่านายหน้า/i,
    /fee.?include/i,           // Dime! English: Fee Include Vat
    /^fee/i,
    /commission/i,
  ],
  tax: [
    /ภาษีหัก/i,               // Dime! Thai: ภาษีหัก ณ ที่จ่าย
    /ภาษี/i,
    /อากร/i,
    /withholding/i,            // Dime! English: Withholding Tax
    /^wht$/i,
    /^tax$/i,
    /^stamp/i,
  ],
  currency: [
    /สกุลเงิน/i,              // Dime! Thai: สกุลเงิน
    /^ccy$/i,                  // Dime! English: CCY
    /^currency$/i,
  ],
}

// A "pure" header row has no inline numeric values or dates (those are data).
// Rejects info/summary rows like "ราคา 679.27 USD ค่าธรรมเนียม 0.13" which
// mix labels with values and would otherwise hijack header detection.
function isPureHeaderRow(row) {
  for (const { text } of row) {
    const t = text.trim()
    if (/^[\d,]+(?:\.\d+)?$/.test(t)) return false   // pure number
    if (DATE_RE.test(t)) return false                // date
  }
  return true
}

// Returns { headerRow, colMap } where colMap maps field → X coordinate
// of the header cell.  Walks consecutive non-date rows to combine
// multi-line bilingual headers (e.g., Dime! prints Thai + English over 4 lines).
function findHeader(rows) {
  let best = null, bestScore = 0

  for (let ri = 0; ri < Math.min(rows.length, 80); ri++) {
    const row = rows[ri]
    if (!isPureHeaderRow(row)) continue   // skip info/summary/data rows

    const colMap = {}; let score = 0
    for (const { x, text } of row) {
      for (const [field, pats] of Object.entries(HEADER_PATS)) {
        if (colMap[field] === undefined && pats.some(p => p.test(text))) {
          colMap[field] = x; score++; break
        }
      }
    }
    if (score < 1) continue   // need at least one match to seed a header cluster

    // Walk forward up to 8 rows, absorbing pure-header rows.  Stops as soon as
    // we hit a row with values (date or number) — that is the first data row.
    let lastHeaderRow = ri
    for (let wi = ri + 1; wi <= Math.min(ri + 8, rows.length - 1); wi++) {
      if (!isPureHeaderRow(rows[wi])) break
      for (const { x, text } of rows[wi]) {
        for (const [field, pats] of Object.entries(HEADER_PATS)) {
          if (colMap[field] === undefined && pats.some(p => p.test(text))) {
            colMap[field] = x; score++; break
          }
        }
      }
      lastHeaderRow = wi
    }

    if (score >= 3 && score > bestScore) {
      best = { headerRow: lastHeaderRow, colMap }; bestScore = score
    }
  }
  return best
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

const DATE_RE = /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b|\b\d{4}[\/\-\.]\d{2}[\/\-\.]\d{2}\b/

function parseDate(v) {
  if (!v) return null
  const s = String(v).trim()
  const iso = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/)
  if (iso) {
    let y = parseInt(iso[1]); if (y > 2400) y -= 543
    return `${y}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`
  }
  const dmy = s.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})/)
  if (dmy) {
    let d = parseInt(dmy[1]), m = parseInt(dmy[2]), y = parseInt(dmy[3])
    if (y < 100) y = y >= 43 ? y + 1957 : y + 2000
    else if (y > 2400) y -= 543
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  }
  const dt = new Date(s); if (!isNaN(dt)) return dt.toISOString().split('T')[0]
  return null
}

function mapType(v) {
  const s = String(v || '').trim().toLowerCase()
  if (/^b(uy|ought)?$|^ซื้อ/.test(s) || s === 'long') return 'Buy'
  if (/^s(ell|el|old|ale)?$|^ขาย/.test(s) || s === 'short') return 'Sell'
  if (/^div|ปันผล/.test(s)) return 'Dividend'
  if (/deposit|ฝาก/.test(s)) return 'Deposit'
  if (/with|ถอน/.test(s)) return 'Withdraw'
  return 'Buy'
}

function snum(v) {
  const n = parseFloat(String(v || '').replace(/[,\s]/g, ''))
  return isNaN(n) ? null : n
}

const SKIP_TICKER = new Set([
  'SET','THB','USD','VAT','TAX','FEE','BKK','AMP','GET','PUT','NET','ALL',
  'BUY','SELL','DIV','CCY',
  // Exchange / market codes that appear in Dime! brackets e.g. "VOO [ARCX]"
  'NYSE','ARCX','XNAS','XNYS','NMS','NGM','PCX','AMEX','ASE','BATS',
  'LSE','TYO','HKG','SGX','KRX','XTAI',
])

function pickTicker(texts) {
  return texts.find(c => {
    const clean = c.replace(/\[.*?\]/g, '').trim()
    return /^[A-Z][A-Z0-9.\-]{1,7}$/.test(clean) && !SKIP_TICKER.has(clean)
  })?.replace(/\[.*?\]/g, '').trim() ?? null
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function detectTransactions(rows) {
  const header = findHeader(rows)

  // Try detectors in order of precision; use the first that yields results.
  let results = header ? parseWithHeader(rows, header) : []
  if (results.length === 0) results = parseAnchored(rows)            // Dime! multi-row layout
  if (results.length === 0) results = parseDocDated(rows, header)    // InnovestX (date in doc header)
  if (results.length === 0) results = parseHeuristic(rows)           // last-ditch

  // Self-diagnosing dump — only logs when nothing matched (no spam on success)
  if (results.length === 0) {
    console.log('[pdfParser] ⚠️ no transactions detected. header:', header
      ? `row ${header.headerRow} ` + JSON.stringify(Object.fromEntries(
          Object.entries(header.colMap).map(([k, v]) => [k, Math.round(v)])))
      : 'none')
    rows.slice(0, 80).forEach((r, i) => {
      const d = DATE_RE.test(r.map(c => c.text).join(' '))
      console.log(`  [${i}]${d ? '📅' : '  '}`, r.map(c => `"${c.text}"@${Math.round(c.x)}`).join(' | '))
    })
  }
  return results
}

// ── Mode A: header-guided, X-position column matching ─────────────────────────
// Best for brokers whose data sits in one clean row per transaction.
function parseWithHeader(rows, { headerRow, colMap }) {
  const results = []

  // g(field, row): text of the data cell whose X is closest to the header
  // field's X (within X_TOL); '' if nothing close enough.
  const g = (f, row) => {
    if (colMap[f] === undefined) return ''
    const tx = colMap[f]
    let best = null, minD = Infinity
    for (const { x, text } of row) {
      const d = Math.abs(x - tx)
      if (d < minD) { minD = d; best = text }
    }
    return minD <= X_TOL ? (best ?? '') : ''
  }

  for (let ri = headerRow + 1; ri < rows.length; ri++) {
    const row   = rows[ri]
    const texts = row.map(c => c.text)
    const line  = texts.join(' ')
    if (!DATE_RE.test(line)) continue

    const rawDate = g('transacted_at', row) || texts.find(t => DATE_RE.test(t)) || ''
    const date    = parseDate(rawDate)
    if (!date) continue

    const rawTicker = g('ticker', row)
    const ticker    = (rawTicker.replace(/\[.*?\]/g, '').trim().toUpperCase()
                       || pickTicker(texts)
                       || '').replace(/\.BK$/i, '') || null

    const rawCcy   = g('currency', row).trim().toUpperCase()
    const currency = rawCcy === 'USD' ? 'USD'
                   : rawCcy === 'THB' ? 'THB'
                   : /\bUSD\b/.test(line) ? 'USD' : 'THB'

    const amtRaw = g('amount', row) || g('total', row)

    results.push({
      transacted_at: date,
      type:   mapType(g('type', row)),
      ticker,
      shares: snum(g('shares', row)),
      price:  snum(g('price',  row)),
      amount: snum(amtRaw),
      fee:    snum(g('fee', row)) || 0,
      tax:    snum(g('tax', row)) || 0,
      currency,
      note:   null,
    })
  }
  return results
}

// ── Mode A2: anchor-based (Dime! offshore confirmation note) ──────────────────
// Each transaction is spread over several physical rows.  The "main" row holds
//   OrderID | SettlementDate | BUY/SELL | Units | UnitPrice | CCY
// while the ticker and the USD/THB money columns sit on adjacent rows.
const ISNUM_RE = /^-?[\d,]+\.?\d*$/
const toNum    = t => parseFloat(String(t).replace(/,/g, ''))

function parseAnchored(rows) {
  const results = []

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i]
    const texts = cells.map(c => c.text)
    const line  = texts.join(' ')

    // Anchor signature: a row carrying a date AND a buy/sell word. The trade
    // detail (units, unit price, currency) is normally in the same row, but
    // Dime! occasionally splits it onto the neighbouring row (a different PDF
    // text baseline), so fall back to the row above/below when the currency
    // code isn't on the anchor row itself.
    if (!DATE_RE.test(line)) continue
    const typeTok = line.match(/\bBUY\b|\bSELL?\b|ซื้อ|ขาย/i)   // SELL? also matches Dime!'s "SEL"
    if (!typeTok) continue

    const dateCell = cells.find(c => DATE_RE.test(c.text))
    const date     = parseDate(dateCell?.text)
    if (!date) continue

    // Pull [units, unit price, currency] from a row that has a USD/THB token.
    // On the anchor row, only count numbers to the right of the date (the
    // order id sits to the left); on a fallback row, count every number.
    const detailFrom = (arr, afterX = -Infinity) => {
      const ccy = arr.find(c => /^(USD|THB)$/i.test(c.text.trim()))
      if (!ccy) return null
      const ns = arr
        .filter(c => c.x > afterX && ISNUM_RE.test(c.text.trim()))
        .sort((a, b) => a.x - b.x)
        .map(c => toNum(c.text))
      return { shares: ns[0] ?? null, price: ns[1] ?? null, currency: /USD/i.test(ccy.text) ? 'USD' : 'THB' }
    }
    let detail = detailFrom(cells, dateCell.x)
    if (!detail && i - 1 >= 0)           detail = detailFrom(rows[i - 1])
    if (!detail && i + 1 < rows.length)  detail = detailFrom(rows[i + 1])
    if (!detail) continue
    const { shares, price, currency } = detail

    // Ticker association (Dime!): the symbol sits a row or two ABOVE the main
    // row, so scan UP first; also accept single-letter tickers (e.g. "U", "F")
    // which the shared pickTicker rejects.
    const okT = (txt) => {
      const c = txt.replace(/\[.*?\]/g, '').trim()
      return /^[A-Z][A-Z0-9.\-]{0,7}$/.test(c) && !SKIP_TICKER.has(c) && !/^(BUY|SEL|SELL)$/.test(c)
    }
    const tickerIn = (arr) => { const hit = arr.find(okT); return hit ? hit.replace(/\[.*?\]/g, '').trim() : null }
    let ticker = tickerIn(texts)
    for (let d = 1; d <= 4 && !ticker; d++) if (i - d >= 0) ticker = tickerIn(rows[i - d].map(c => c.text))
    for (let d = 1; d <= 2 && !ticker; d++) if (i + d < rows.length) ticker = tickerIn(rows[i + d].map(c => c.text))

    // Gross amount = Units × Unit Price (in the transaction currency)
    const amount = (shares != null && price != null)
      ? +(shares * price).toFixed(2)
      : (price ?? null)

    // Fee / tax: nearby money row whose first figure ≈ gross amount (same ccy)
    let fee = 0, tax = 0
    if (amount) {
      search:
      for (let d = 1; d <= 3; d++) {
        for (const j of [i - d, i + d]) {
          if (j < 0 || j >= rows.length) continue
          const ns = rows[j].map(c => c.text).filter(t => ISNUM_RE.test(t.trim())).map(toNum)
          if (ns.length >= 3 && Math.abs(ns[0] - amount) <= amount * 0.03) {
            fee = ns[1] || 0; tax = ns[2] || 0
            break search
          }
        }
      }
    }

    results.push({
      transacted_at: date,
      type: mapType(typeTok[0]),
      ticker, shares, price, amount, fee, tax, currency, note: null,
    })
  }
  // ── TEMP DEBUG (Dime! only): dump trade-shaped cells, PII redacted ──
  if (results.length) {
    const safe = (t) => {
      const s = String(t).trim()
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return s            // date
      if (/^-?[\d,]+\.\d+$/.test(s)) return s                        // decimal number
      if (/^\d{1,7}$/.test(s)) return s                              // short int (order id, not tax/acct)
      if (/^\[.*\]$/.test(s)) return s                               // [exchange]
      if (/^[A-Z]{1,6}$/.test(s)) return s                           // ticker / BUY / SEL / USD
      return null
    }
    console.log('[dime] results', results.map(r => `${r.type} ${r.ticker} ${r.shares}@${r.price}=${r.amount} fee${r.fee}`))
    rows.forEach((r, i) => {
      const cells = r.map(c => safe(c.text)).filter(Boolean)
      if (cells.length >= 2) console.log('[dime row]', i, cells.join(' | '))
    })
  }
  return results
}

// ── Mode A3: document-dated table (InnovestX confirmation note) ───────────────
// The trade date lives in the document header ("Trading Date 20/05/2026"), not
// in each data row, and the securities row carries no date at all.  We take the
// document date, then read Securities / Unit / Unit Price / Total Amount from
// the table columns by X position.

// Find the trade date: prefer the value tied to a "Trading Date" label,
// otherwise the earliest date in the document (trade date precedes settlement).
function findDocDate(rows) {
  let labelX = null, labelRow = null
  const dates = []
  const plausible = (d) => {
    const [y, m, day] = d.split('-').map(Number)
    return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && day >= 1 && day <= 31
  }
  rows.forEach((row, ri) => {
    for (const { x, text } of row) {
      if (/trading.?date|วันที่ซื้อขาย/i.test(text)) { labelX = x; labelRow = ri }
      const m = text.match(DATE_RE)
      if (m) { const d = parseDate(m[0]); if (d && plausible(d)) dates.push({ ri, x, date: d }) }
    }
  })
  if (dates.length === 0) return null
  if (labelX != null) {
    let best = null, bestScore = Infinity
    for (const d of dates) {
      const score = Math.abs(d.ri - labelRow) * 1000 + Math.abs(d.x - labelX)
      if (score < bestScore) { bestScore = score; best = d }
    }
    if (best) return best.date
  }
  return dates.map(d => d.date).sort()[0]   // earliest = trade date
}

function parseDocDated(rows, header) {
  if (!header) return []
  const { headerRow, colMap } = header
  // Must look like a securities table: a ticker column + price or total
  if (colMap.ticker === undefined) return []
  if (colMap.price === undefined && colMap.total === undefined) return []

  const date = findDocDate(rows)
  if (!date) return []

  // gCell: the data cell {x,text} closest to a header field's X (or null)
  const gCell = (f, row) => {
    if (colMap[f] === undefined) return null
    const tx = colMap[f]
    let best = null, minD = Infinity
    for (const c of row) {
      const d = Math.abs(c.x - tx)
      if (d < minD) { minD = d; best = c }
    }
    return minD <= X_TOL ? best : null
  }
  const g = (f, row) => gCell(f, row)?.text ?? ''

  const okTicker = t => /^[A-Z][A-Z0-9.\-]{0,6}$/.test(t) && !SKIP_TICKER.has(t)

  const results = []
  for (let ri = headerRow + 1; ri < rows.length; ri++) {
    const row   = rows[ri]
    const texts = row.map(c => c.text)
    const line  = texts.join(' ')
    if (DATE_RE.test(line)) continue   // a dated row here is a footer, not a trade

    let ticker = g('ticker', row).replace(/\[.*?\]/g, '').trim().toUpperCase()
    if (!okTicker(ticker)) ticker = (pickTicker(texts) || '')
    if (!okTicker(ticker)) continue

    const priceCell = gCell('price', row)
    const shares = snum(g('shares', row))
    const price  = snum(priceCell?.text)
    if (shares == null || price == null || shares <= 0 || price <= 0) continue  // real trades only

    const gross = +(shares * price).toFixed(2)

    // Numeric cells to the right of Unit Price, in order, are:
    //   [Net fee, VAT, …, Total Amount]   (contract/order nos. aren't numeric)
    // The Total Amount is the last (rightmost) figure; everything before it is
    // the fee block.  This avoids depending on a fragile 'total' header match
    // (InnovestX splits "Total Fee" so a bare "Total" can hijack that column).
    let fee = 0, tax = 0
    if (priceCell) {
      const rightNums = row
        .filter(c => c.x > priceCell.x + 5 && ISNUM_RE.test(c.text.trim()))
        .sort((a, b) => a.x - b.x)
        .map(c => toNum(c.text))
      const feeBlock = rightNums.slice(0, -1)   // drop the trailing Total Amount
      fee = feeBlock[0] || 0
      tax = feeBlock[1] || 0
    }

    // Buy/Sell from the contract-number prefix (BU-…/SE-…/SL-…), default Buy
    const ct   = texts.find(t => /^(BU|SE|SL)[-\s]?\d/i.test(t.trim()))
    const type = ct && /^(SE|SL)/i.test(ct.trim()) ? 'Sell' : 'Buy'

    const currency = /\bUSD\b/.test(line) ? 'USD' : 'THB'

    results.push({
      transacted_at: date,
      type, ticker, shares, price,
      amount: gross, fee, tax, currency, note: null,
    })
  }
  return results
}

// ── Mode B: pure heuristic (no header, no anchor) ─────────────────────────────
function parseHeuristic(rows) {
  const results = []

  for (const row of rows) {
    const texts = row.map(c => c.text)
    const line  = texts.join(' ')
    if (!DATE_RE.test(line)) continue

    const dateMatch = line.match(DATE_RE)
    const date = parseDate(dateMatch?.[0])
    if (!date) continue

    const typeMatch = line.match(/ซื้อ|Buy|ขาย|Sell|ปันผล|Dividend|ฝาก|Deposit|ถอน|Withdraw/i)
    const ticker    = pickTicker(texts)

    const dateParts = new Set((dateMatch[0].match(/\d+/g) || []).map(Number))
    const nums = (line.match(/[\d,]+(?:\.\d+)?/g) || [])
      .map(n => parseFloat(n.replace(/,/g, '')))
      .filter(n => n > 0 && !dateParts.has(n))

    if (nums.length < 1) continue

    const large = Math.max(...nums)
    let shares = null, price = null, amount = large, fee = 0, tax = 0

    if (nums.length >= 3) {
      let best = null, bestDiff = Infinity
      for (let i = 0; i < nums.length; i++) {
        for (let j = 0; j < nums.length; j++) {
          if (i === j) continue
          const diff = Math.abs(nums[i] * nums[j] - large) / (large || 1)
          if (diff < 0.1 && diff < bestDiff) { best = [i, j]; bestDiff = diff }
        }
      }
      if (best) {
        shares = nums[best[0]]; price = nums[best[1]]
        const rest = nums.filter((_, k) => k !== best[0] && k !== best[1] && nums[k] !== large)
        fee = rest[0] ?? 0; tax = rest[1] ?? 0
      } else {
        shares = nums[0]; price = nums[1]; amount = nums[nums.length - 1]
      }
    } else if (nums.length === 2) {
      shares = nums[0]; amount = nums[1]
    }

    const currency = /\bUSD\b/.test(line) ? 'USD' : 'THB'

    results.push({
      transacted_at: date,
      type:   typeMatch ? mapType(typeMatch[0]) : 'Buy',
      ticker, shares, price, amount, fee, tax, currency, note: null,
    })
  }
  return results
}
