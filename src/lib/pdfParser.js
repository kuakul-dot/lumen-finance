// PDF text extraction + transaction detection using pdfjs-dist
// Supports column-header detection (Thai & English) + heuristic fallback

import * as pdfjs from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

// ─── Text extraction ──────────────────────────────────────────────────────────

const Y_SNAP = 3  // group text items within 3px vertically (same row)

export async function extractPDFRows(file, password = '') {
  const buf  = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: buf, ...(password ? { password } : {}) })
  const doc  = await loadingTask.promise
  const numPages = doc.numPages

  const allRows = []

  for (let p = 1; p <= numPages; p++) {
    const page    = await doc.getPage(p)
    const content = await page.getTextContent()

    // Group items by snapped y-coordinate
    const byY = new Map()
    for (const item of content.items) {
      if (typeof item.str !== 'string' || !item.str.trim()) continue
      const y = Math.round(item.transform[5] / Y_SNAP) * Y_SNAP
      if (!byY.has(y)) byY.set(y, [])
      byY.get(y).push({ x: item.transform[4], text: item.str.trim() })
    }

    // Sort rows top-to-bottom, cells left-to-right
    const rows = [...byY.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.text))

    allRows.push(...rows)
  }

  return { rows: allRows, numPages }
}

// ─── Header detection ─────────────────────────────────────────────────────────

const HEADER_PATS = {
  transacted_at: [/วันที่/i, /^date$/i, /trade.?date/i, /^day$/i],
  type:          [/ประเภท/i, /^type$/i, /^action$/i, /^side$/i],
  ticker:        [/หลักทรัพย์/i, /^symbol$/i, /^ticker$/i, /^code$/i, /scrip/i],
  shares:        [/จำนวน/, /^shares?$/i, /^vol/i, /^qty$/i, /^quantity/i],
  price:         [/ราคา/, /^price$/i, /avg.?price/i, /trade.?price/i],
  amount:        [/มูลค่า/, /^amount$/i, /^total$/i, /^value$/i, /^net$/i],
  fee:           [/ค่านายหน้า/, /ค่าธรรมเนียม/, /^fee$/i, /commission/i],
  tax:           [/ภาษี/, /อากร/, /^tax$/i, /^vat$/i, /^stamp/i],
}

function findHeader(rows) {
  let best = null, bestScore = 0
  for (let ri = 0; ri < Math.min(rows.length, 80); ri++) {
    const row = rows[ri]
    const colMap = {}; let score = 0
    row.forEach((cell, ci) => {
      for (const [field, pats] of Object.entries(HEADER_PATS)) {
        if (!colMap[field] && pats.some(p => p.test(cell))) {
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

const SKIP_TICKER = new Set(['SET','THB','USD','VAT','TAX','FEE','BKK','PST','AMP','GET','PUT','NET','ALL'])

function pickTicker(cells) {
  return cells.find(c =>
    /^[A-Z][A-Z0-9\-]{1,7}(\.BK)?$/.test(c) &&
    !SKIP_TICKER.has(c) &&
    !/^\d/.test(c)
  ) ?? null
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

      const ticker = (g('ticker') || pickTicker(row) || '').replace(/\.BK$/i, '').toUpperCase() || null

      results.push({
        transacted_at: date,
        type:   mapType(g('type')),
        ticker,
        shares: snum(g('shares')),
        price:  snum(g('price')),
        amount: snum(g('amount')),
        fee:    snum(g('fee'))  || 0,
        tax:    snum(g('tax'))  || 0,
        currency: 'THB',
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
    const ticker     = pickTicker(row)?.replace(/\.BK$/i, '') || null

    // Collect all numbers, excluding date components
    const dateParts  = new Set((dateMatch[0].match(/\d+/g) || []).map(Number))
    const nums = (line.match(/[\d,]+(?:\.\d+)?/g) || [])
      .map(n => parseFloat(n.replace(/,/g, '')))
      .filter(n => n > 0 && !dateParts.has(n))

    if (nums.length < 1) continue

    const large = Math.max(...nums)
    let shares = null, price = null, amount = large, fee = 0, tax = 0

    if (nums.length >= 3) {
      // Try to find a (shares, price) pair whose product ≈ largest number
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

    results.push({
      transacted_at: date,
      type:   typeMatch ? mapType(typeMatch[0]) : 'Buy',
      ticker,
      shares,
      price,
      amount,
      fee,
      tax,
      currency: 'THB',
      note: null,
    })
  }

  return results
}
