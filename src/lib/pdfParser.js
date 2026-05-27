// PDF text extraction + transaction detection using pdfjs-dist
// Supports column-header detection (Thai & English) + heuristic fallback
//
// Confirmed working brokers:
//   ✅ Dime! (ไดม์)          — Confirmation Note / Tax Invoice (US stocks, USD)
//   ✅ Settrade / SET-linked  — รายงานการซื้อขาย, ใบยืนยัน (TH stocks, THB)
//   ✅ Bualuang Securities    — ใบยืนยันการซื้อขาย (THB)
//   ✅ KGI Securities         — Trade Confirmation (THB / USD)
//   ✅ Finansia Syrus         — ใบยืนยัน (THB)
//   🟡 KTBST / KS / ASL      — works if PDF is text-based (heuristic mode)
//   ❌ Scanned / image PDFs   — no OCR support

import * as pdfjs from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

// ─── Text extraction ──────────────────────────────────────────────────────────

const Y_SNAP = 3  // group text items within 3 px vertically

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
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.text))

    allRows.push(...rows)
  }

  return { rows: allRows, numPages }
}

// ─── Header detection ─────────────────────────────────────────────────────────
// Each field lists patterns in priority order (most specific → most generic).
// The loop assigns each header cell to the FIRST field whose pattern matches,
// so put generic patterns AFTER specific ones.

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
    /จำนวนเงิน(?!รวม)/i,      // "จำนวนเงิน" but NOT "จำนวนเงินรวม" (that's total)
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
    /^fee/i,                   // any header starting with "fee"
    /commission/i,
  ],
  tax: [
    /ภาษีหัก/i,               // Dime! Thai: ภาษีหัก ณ ที่จ่าย
    /ภาษี/i,
    /อากร/i,
    /withholding/i,            // Dime! English: Withholding Tax
    /^wht$/i,
    /^tax$/i,
    /^vat$/i,
    /^stamp/i,
  ],
  currency: [
    /สกุลเงิน/i,              // Dime! Thai: สกุลเงิน
    /^ccy$/i,                  // Dime! English: CCY
    /^currency$/i,
  ],
}

function findHeader(rows) {
  let best = null, bestScore = 0
  for (let ri = 0; ri < Math.min(rows.length, 80); ri++) {
    const row = rows[ri]
    const colMap = {}; let score = 0
    row.forEach((cell, ci) => {
      for (const [field, pats] of Object.entries(HEADER_PATS)) {
        if (colMap[field] === undefined && pats.some(p => p.test(cell))) {
          colMap[field] = ci; score++; break
        }
      }
    })
    if (score >= 3 && score > bestScore) {
      best = { headerRow: ri, colMap }; bestScore = score
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
  if (/^s(ell|old|ale)?$|^ขาย/.test(s) || s === 'short') return 'Sell'
  if (/^div|ปันผล/.test(s)) return 'Dividend'
  if (/deposit|ฝาก/.test(s)) return 'Deposit'
  if (/with|ถอน/.test(s)) return 'Withdraw'
  return 'Buy'
}

function snum(v) {
  const n = parseFloat(String(v || '').replace(/[,\s]/g, ''))
  return isNaN(n) ? null : n
}

// Words / exchange codes to exclude from auto-ticker detection
const SKIP_TICKER = new Set([
  'SET','THB','USD','VAT','TAX','FEE','BKK','AMP','GET','PUT','NET','ALL',
  'BUY','SELL','DIV','CCY','THB',
  // Exchange codes (Dime! shows these as [ARCX], [XNAS], etc.)
  'NYSE','ARCX','XNAS','XNYS','NMS','NGM','PCX','AMEX','ASE','BATS',
  'LSE','TYO','HKG','SGX','KRX','XTAI',
])

function pickTicker(cells) {
  return cells.find(c => {
    const clean = c.replace(/\[.*?\]/g, '').trim()
    return /^[A-Z][A-Z0-9\-]{1,7}$/.test(clean) && !SKIP_TICKER.has(clean)
  })?.replace(/\[.*?\]/g, '').trim() ?? null
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function detectTransactions(rows) {
  const header = findHeader(rows)

  // ── Mode A: header-guided ─────────────────────────────────────────────────
  if (header) {
    const { headerRow, colMap } = header
    const results = []

    for (let ri = headerRow + 1; ri < rows.length; ri++) {
      const row  = rows[ri]
      const line = row.join(' ')
      if (!DATE_RE.test(line)) continue

      const g = (f) => (colMap[f] !== undefined ? row[colMap[f]] : '') ?? ''

      const rawDate = g('transacted_at') || row.find(c => DATE_RE.test(c)) || ''
      const date    = parseDate(rawDate)
      if (!date) continue

      // Ticker: clean [EXCHANGE] suffix e.g. "VOO [ARCX]" → "VOO"
      const rawTicker = g('ticker') || ''
      const ticker    = (rawTicker.replace(/\[.*?\]/g, '').trim().toUpperCase()
                         || pickTicker(row)
                         || '').replace(/\.BK$/i, '') || null

      // Currency: USD or THB based on the CCY column
      const rawCcy  = g('currency').trim().toUpperCase()
      const currency = rawCcy === 'USD' ? 'USD' : 'THB'

      // Prefer gross amount; fall back to total if gross not mapped
      const amtRaw   = g('amount') || g('total')
      const feeRaw   = g('fee')
      const taxRaw   = g('tax')

      results.push({
        transacted_at: date,
        type:   mapType(g('type')),
        ticker,
        shares: snum(g('shares')),
        price:  snum(g('price')),
        amount: snum(amtRaw),
        fee:    snum(feeRaw)  || 0,
        tax:    snum(taxRaw)  || 0,
        currency,
        note: null,
      })
    }
    return results
  }

  // ── Mode B: heuristic (no header found) ───────────────────────────────────
  const results = []

  for (const row of rows) {
    const line = row.join(' ')
    if (!DATE_RE.test(line)) continue

    const dateMatch = line.match(DATE_RE)
    const date = parseDate(dateMatch?.[0])
    if (!date) continue

    const typeMatch  = line.match(/ซื้อ|Buy|ขาย|Sell|ปันผล|Dividend|ฝาก|Deposit|ถอน|Withdraw/i)
    const ticker     = pickTicker(row)

    const dateParts  = new Set((dateMatch[0].match(/\d+/g) || []).map(Number))
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

    // Detect currency from line content
    const currency = /\bUSD\b/.test(line) ? 'USD' : 'THB'

    results.push({
      transacted_at: date,
      type:   typeMatch ? mapType(typeMatch[0]) : 'Buy',
      ticker,
      shares,
      price,
      amount,
      fee,
      tax,
      currency,
      note: null,
    })
  }

  return results
}
