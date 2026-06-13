import { supabase } from './supabase'
import { toYahooSymbol } from './prices'

// A position with fewer shares than this is treated as closed. Buy/sell
// quantities entered with different decimal rounding (e.g. bought 0.4442,
// sold 0.4441925) can leave a sub-microshare residue; anything below this is
// negligible (worth a fraction of a cent) and should not linger as a holding.
const SHARE_EPS = 1e-4

export async function getOrCreatePortfolio(userId, currency = 'THB') {
  const { data, error } = await supabase
    .from('portfolios')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`portfolios select: ${error.message}`)
  if (data) return data
  const { data: created, error: insertError } = await supabase
    .from('portfolios')
    .insert({ user_id: userId, name: 'Main', currency })
    .select()
    .single()
  if (insertError) throw new Error(`portfolios insert: ${insertError.message}`)
  return created
}

// ── Multiple portfolios per user ────────────────────────────────────────────
export async function getPortfolios(userId) {
  const { data } = await supabase
    .from('portfolios').select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  return data || []
}

export async function addPortfolio(userId, name, currency = 'THB') {
  const { data, error } = await supabase
    .from('portfolios')
    .insert({ user_id: userId, name: (name || 'New portfolio').trim() || 'New portfolio', currency })
    .select().single()
  return { data, error }
}

export async function updatePortfolio(id, patch) {
  const { data, error } = await supabase
    .from('portfolios')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  return { data, error }
}

export async function deletePortfolioCascade(id) {
  // FKs are ON DELETE CASCADE, so holdings/transactions/cash/goals/snapshots
  // all disappear with the portfolio row.
  return supabase.from('portfolios').delete().eq('id', id)
}

export async function getHoldingsSafe(portfolioId) {
  const { data, error } = await supabase
    .from('holdings')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`holdings select: ${error.message}`)
  return data || []
}

export async function getHoldings(portfolioId) {
  const { data } = await supabase
    .from('holdings')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .order('created_at', { ascending: true })
  return data || []
}

export async function addHolding(portfolioId, h) {
  const { data, error } = await supabase
    .from('holdings')
    .insert({ portfolio_id: portfolioId, ...h })
    .select()
    .single()
  return { data, error }
}

export async function updateHolding(id, h) {
  const { data, error } = await supabase
    .from('holdings')
    .update({ ...h, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  return { data, error }
}

export async function deleteHolding(id) {
  return supabase.from('holdings').delete().eq('id', id)
}

// Lightweight recent-transactions fetch (latest 50). Use getAllTransactions()
// when the full history is required (analytics, dividend sync, holdings rebuild).
export async function getTransactions(portfolioId) {
  const { data } = await supabase
    .from('transactions')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .order('transacted_at', { ascending: false })
    .limit(50)
  return data || []
}

export async function addTransaction(portfolioId, tx) {
  const { data, error } = await supabase
    .from('transactions')
    .insert({ portfolio_id: portfolioId, ...tx })
    .select()
    .single()
  return { data, error }
}

// Roll a batch of transactions into the holdings table so the Holdings tab
// reflects imported trades.  Buys add shares and update the weighted-average
// cost; sells reduce shares.  Dividend / Deposit / Withdraw rows are ignored
// (they don't change a position).  Returns { errors: string[] }.
export async function syncHoldingsFromTransactions(portfolioId, txs) {
  const existing = await getHoldings(portfolioId)
  const byTicker = new Map()
  for (const h of existing) {
    if (h.ticker) byTicker.set(h.ticker.toUpperCase(), { ...h })
  }

  for (const tx of txs) {
    if (!tx.ticker) continue
    const key    = tx.ticker.toUpperCase()
    const shares = Number(tx.shares) || 0
    const price  = Number(tx.price)  || 0
    if (!shares) continue

    const h = byTicker.get(key)

    // Backfill region/currency on an existing holding that lacks it, so US
    // tickers stop being treated as Thai (.BK) — derived from the tx currency.
    if (h && !h.region && tx.currency) {
      const isUSD = tx.currency === 'USD'
      h.region        = isUSD ? 'US' : 'TH'
      h.currency      = h.currency || tx.currency
      h.div_frequency = h.div_frequency || (isUSD ? 4 : 2)
      h._dirty        = true
    }

    if (tx.type === 'Buy') {
      // Cost basis includes buy-side fee + tax (accounting standard)
      const buyCost = shares * price + (Number(tx.fee) || 0) + (Number(tx.tax) || 0)
      if (h) {
        const prevShares = Number(h.shares) || 0
        const prevCost   = Number(h.cost_price) || 0
        const newShares  = prevShares + shares
        h.cost_price = newShares > 0
          ? (prevShares * prevCost + buyCost) / newShares
          : price
        h.shares  = newShares
        h._dirty  = true
      } else {
        const isUSD = (tx.currency || 'THB') === 'USD'
        byTicker.set(key, {
          _new: true, _dirty: true,
          ticker: key, name: tx.note || key, shares,
          cost_price: shares > 0 ? buyCost / shares : price,
          currency: tx.currency || 'THB',
          region: isUSD ? 'US' : 'TH',   // drives Yahoo symbol (.BK) + price currency
          asset_class: 'Equity',
          div_frequency: isUSD ? 4 : 2,
        })
      }
    } else if (tx.type === 'Sell' && h) {
      h.shares = Math.max(0, (Number(h.shares) || 0) - shares)
      h._dirty = true
    }
  }

  const errors = []
  for (const h of byTicker.values()) {
    if (!h._dirty) continue
    const flat = (Number(h.shares) || 0) <= SHARE_EPS   // position sold to zero
    if (h._new) {
      if (flat) continue                           // never create an empty position
      const { _new, _dirty, ...payload } = h
      const { error } = await addHolding(portfolioId, payload)
      if (error) errors.push(`${h.ticker}: ${error.message}`)
    } else if (flat) {
      const { error } = await deleteHolding(h.id)  // fully sold → drop the row
      if (error) errors.push(`${h.ticker}: ${error.message}`)
    } else {
      const patch = { shares: h.shares, cost_price: h.cost_price }
      if (h.region)        patch.region        = h.region
      if (h.currency)      patch.currency      = h.currency
      if (h.div_frequency) patch.div_frequency = h.div_frequency
      const { error } = await updateHolding(h.id, patch)
      if (error) errors.push(`${h.ticker}: ${error.message}`)
    }
  }
  return { errors }
}

// Recompute a single ticker's holding from ALL its remaining transactions.
// Call after deleting/editing a transaction so the position stays in sync.
// Buys add shares + cost; sells remove shares + proportional cost.  If the
// net position is zero, the holding row is removed.
export async function rebuildHolding(portfolioId, ticker) {
  if (!portfolioId || !ticker) return { error: null }
  const key = ticker.toUpperCase()

  const { data: txs } = await supabase
    .from('transactions')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .ilike('ticker', key)

  let shares = 0, costTotal = 0, currency = null
  for (const tx of (txs || [])) {
    const s = Number(tx.shares) || 0
    const p = Number(tx.price)  || 0
    if (!currency && tx.currency) currency = tx.currency
    if (tx.type === 'Buy') {
      // Cost basis includes buy-side fee + tax (accounting standard)
      shares += s; costTotal += s * p + (Number(tx.fee) || 0) + (Number(tx.tax) || 0)
    } else if (tx.type === 'Sell') {
      const avg = shares > 0 ? costTotal / shares : 0
      shares    = Math.max(0, shares - s)
      costTotal = Math.max(0, costTotal - s * avg)
    }
  }

  const existing = await getHoldings(portfolioId)
  const h = existing.find(x => x.ticker?.toUpperCase() === key)

  if (shares <= SHARE_EPS) {
    if (h) await deleteHolding(h.id)
    return { error: null }
  }

  const cost_price = costTotal / shares
  if (h) {
    return updateHolding(h.id, { shares, cost_price })
  }
  const isUSD = (currency || 'THB') === 'USD'
  const name  = (txs || []).find(t => t.note)?.note || key
  return addHolding(portfolioId, {
    ticker: key, name, shares, cost_price,
    currency: currency || 'THB',
    region: isUSD ? 'US' : 'TH',
    asset_class: 'Equity',
    div_frequency: isUSD ? 4 : 2,
  })
}

// Apply a stock split to a ticker: every Buy/Sell dated BEFORE the split is
// restated into post-split terms (shares × ratio, price ÷ ratio). Cost basis
// is preserved (shares × price unchanged); fees/taxes are flat cash, untouched.
// Then the holding is rebuilt so its share count matches Yahoo's adjusted price.
export async function applySplit(portfolioId, ticker, ratio, beforeDateISO) {
  if (!portfolioId || !ticker || !(ratio > 0) || ratio === 1) return { adjusted: 0, error: null }
  const key = ticker.toUpperCase()
  const { data: txs, error } = await supabase
    .from('transactions').select('*').eq('portfolio_id', portfolioId)
  if (error) return { adjusted: 0, error: error.message }
  const before = new Date(beforeDateISO).getTime()
  let adjusted = 0
  for (const tx of (txs || [])) {
    if ((tx.ticker || '').toUpperCase() !== key) continue
    if (tx.type !== 'Buy' && tx.type !== 'Sell') continue
    if (!tx.transacted_at || new Date(tx.transacted_at).getTime() >= before) continue
    const { error: e } = await updateTransaction(tx.id, {
      shares: +((Number(tx.shares) || 0) * ratio).toFixed(8),
      price:  +((Number(tx.price)  || 0) / ratio).toFixed(6),
    })
    if (!e) adjusted++
  }
  await rebuildHolding(portfolioId, key)
  return { adjusted, error: null }
}

// Apply classification metadata (name/region/sector/asset_class/currency/...)
// to a holding identified by ticker.  Used when editing a transaction so the
// position is filed and priced correctly.  Only non-empty fields are written.
export async function updateHoldingMeta(portfolioId, ticker, meta = {}) {
  if (!portfolioId || !ticker) return { error: null }
  const key = ticker.toUpperCase()
  const existing = await getHoldings(portfolioId)
  const h = existing.find(x => x.ticker?.toUpperCase() === key)
  if (!h) return { error: null }

  const patch = {}
  for (const k of ['name', 'region', 'asset_class', 'sector', 'currency', 'div_frequency', 'div_yield']) {
    if (meta[k] !== undefined && meta[k] !== null && meta[k] !== '') patch[k] = meta[k]
  }
  if (Object.keys(patch).length === 0) return { error: null }
  return updateHolding(h.id, patch)
}

export async function updateTransaction(id, updates) {
  const { data, error } = await supabase
    .from('transactions')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  return { data, error }
}

export async function deleteTransaction(id) {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id)
  return { error }
}

export async function deleteTransactionsByTicker(portfolioId, ticker) {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('portfolio_id', portfolioId)
    .eq('ticker', ticker)
  return { error }
}

// ── Portfolio snapshots (daily value series for TWR / Sharpe / drawdown) ──────
// Upserts one row per (portfolio, day); calling again the same day overwrites
// with the latest value.  Requires the portfolio_snapshots table (schema.sql).
export async function recordSnapshot(portfolioId, { total_value, total_cost }) {
  if (!portfolioId) return { error: null }
  const date = new Date().toISOString().split('T')[0]
  const { error } = await supabase
    .from('portfolio_snapshots')
    .upsert({ portfolio_id: portfolioId, date, total_value, total_cost },
            { onConflict: 'portfolio_id,date' })
  if (error) console.warn('[Lumen] recordSnapshot:', error.message)
  return { error }
}

// Insert/update many snapshots at once (used by the history backfill).
export async function upsertSnapshots(portfolioId, rows) {
  if (!portfolioId || !rows?.length) return { error: null, count: 0 }
  const payload = rows.map(r => ({ portfolio_id: portfolioId, ...r }))
  const { error } = await supabase
    .from('portfolio_snapshots')
    .upsert(payload, { onConflict: 'portfolio_id,date' })
  if (error) console.warn('[Lumen] upsertSnapshots:', error.message)
  return { error, count: error ? 0 : rows.length }
}

// Reconstruct a daily {date,total_value,total_cost} series from transactions +
// historical price series.  Lets TWR / Sharpe / drawdown work without waiting
// days for live snapshots to accumulate.
//   transactions:   all txs, ascending by transacted_at
//   seriesByTicker: { TICKER: [{ d:'YYYY-MM-DD', c:close(native ccy) }] } asc
//   ccyByTicker:    { TICKER: 'USD' | 'THB' }
//   fxRate:         USD→THB fallback (used when fxByDate has no entry for a date)
//   fxByDate:       optional { 'YYYY-MM-DD': rate } for historically-accurate FX conversion
export function buildSnapshotSeries(transactions, seriesByTicker, ccyByTicker, fxRate = 36, fxByDate = {}) {
  if (!transactions?.length) return []
  const dayOf = (v) => String(v).split('T')[0]
  const firstDate = dayOf(transactions[0].transacted_at)
  const today = new Date().toISOString().split('T')[0]

  const dateSet = new Set()
  for (const tk in seriesByTicker)
    for (const p of seriesByTicker[tk])
      if (p.d >= firstDate && p.d <= today) dateSet.add(p.d)
  for (const t of transactions) dateSet.add(dayOf(t.transacted_at))
  const dates = [...dateSet].sort()

  const priceOnOrBefore = (tk, date) => {
    const s = seriesByTicker[tk]; if (!s) return null
    let best = null
    for (const p of s) { if (p.d <= date) best = p.c; else break }
    return best
  }

  const rows = []
  for (const date of dates) {
    const pos = {}   // ticker → { shares, cost (native ccy) }
    for (const t of transactions) {
      if (dayOf(t.transacted_at) > date) break   // sorted asc
      const tk = (t.ticker || '').toUpperCase(); if (!tk) continue
      const s = Number(t.shares) || 0, pr = Number(t.price) || 0
      if (!pos[tk]) pos[tk] = { shares: 0, cost: 0 }
      if (t.type === 'Buy') {
        pos[tk].shares += s
        pos[tk].cost   += s * pr + (Number(t.fee) || 0) + (Number(t.tax) || 0)
      } else if (t.type === 'Sell') {
        const avg = pos[tk].shares > 0 ? pos[tk].cost / pos[tk].shares : 0
        pos[tk].shares = Math.max(0, pos[tk].shares - s)
        pos[tk].cost   = Math.max(0, pos[tk].cost - s * avg)
      }
    }
    let total_value = 0, total_cost = 0
    for (const tk in pos) {
      if (pos[tk].shares <= 0) continue
      const fx = (ccyByTicker[tk] === 'USD') ? (fxByDate[date] ?? fxRate) : 1
      const px = priceOnOrBefore(tk, date)
      if (px != null) total_value += pos[tk].shares * px * fx
      total_cost += pos[tk].cost * fx
    }
    if (total_cost > 0 && total_value > 0)
      rows.push({ date, total_value: +total_value.toFixed(2), total_cost: +total_cost.toFixed(2) })
  }
  return rows
}

// Realized P/L from all transactions, returned in THB (USD converted at the
// given fxRate).  Each ticker is processed chronologically with a running
// weighted-average cost; every Sell books (net proceeds − avg cost of the
// shares sold).  Buys include fee+tax in cost basis (matches our convention).
export function computeRealized(transactions, fxRate = 36) {
  const sorted = [...(transactions || [])].sort((a, b) =>
    String(a.transacted_at).localeCompare(String(b.transacted_at)))
  const pos = {}                 // ticker → { shares, cost (native ccy) }
  const byTicker = {}
  const byYear = {}
  const sales = []
  let total = 0

  for (const t of sorted) {
    const tk = (t.ticker || '').toUpperCase(); if (!tk) continue
    const s   = Number(t.shares) || 0
    const pr  = Number(t.price)  || 0
    const fee = Number(t.fee)    || 0
    const tax = Number(t.tax)    || 0
    const fx  = (t.currency === 'USD') ? fxRate : 1
    if (!pos[tk]) pos[tk] = { shares: 0, cost: 0 }

    if (t.type === 'Buy') {
      pos[tk].shares += s
      pos[tk].cost   += s * pr + fee + tax
    } else if (t.type === 'Sell' && s > 0) {
      if (pos[tk].shares <= 0) continue   // no shares to sell — skip to avoid phantom gain
      const avg      = pos[tk].cost / pos[tk].shares
      const sold     = Math.min(s, pos[tk].shares)
      const proceeds = s * pr - fee - tax    // net proceeds (native ccy)
      const costBasis= avg * sold            // native ccy
      const gainTHB  = (proceeds - costBasis) * fx
      total += gainTHB
      byTicker[tk] = (byTicker[tk] || 0) + gainTHB
      const year = String(t.transacted_at || '').slice(0, 4) || '—'
      byYear[year] = (byYear[year] || 0) + gainTHB
      sales.push({
        date: (t.transacted_at || '').split('T')[0],
        ticker: tk,
        currency: t.currency || 'THB',   // drives the TH/US filter on the summary card
        shares: s,
        price: pr,
        proceedsTHB: proceeds * fx,
        costTHB: costBasis * fx,
        gainTHB,
        gainPct: costBasis > 0 ? ((proceeds - costBasis) / costBasis) * 100 : 0,
      })
      pos[tk].shares = Math.max(0, pos[tk].shares - s)
      pos[tk].cost   = Math.max(0, pos[tk].cost - costBasis)
    }
  }
  sales.reverse()   // newest first
  return { total, byTicker, byYear, sales }
}

export async function getAllTransactions(portfolioId) {
  if (!portfolioId) return []
  const { data } = await supabase
    .from('transactions')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .order('transacted_at', { ascending: true })
  return data || []
}

// Reconcile: rebuild EVERY holding from the full transaction history so the
// holdings table and the ledger agree (transactions = source of truth).
// Buys add shares + cost (incl fee+tax); sells reduce both; net-zero positions
// are deleted; tickers in the ledger but missing a holding are created.
// Existing holdings whose ticker has NO transactions are left untouched and
// reported as `orphans` (likely added manually) — caller decides what to do.
export async function rebuildAllHoldings(portfolioId) {
  if (!portfolioId) return { error: null, updated: 0, created: 0, removed: 0, orphans: [] }
  const txs = await getAllTransactions(portfolioId)

  const pos = {}   // ticker → { shares, cost, currency, name }
  for (const t of txs) {
    const tk = (t.ticker || '').toUpperCase(); if (!tk) continue
    const s = Number(t.shares) || 0, p = Number(t.price) || 0
    if (!pos[tk]) pos[tk] = { shares: 0, cost: 0, currency: t.currency || 'THB', name: t.note || tk }
    if (t.currency) pos[tk].currency = t.currency
    if (t.note && (!pos[tk].name || pos[tk].name === tk)) pos[tk].name = t.note
    if (t.type === 'Buy') {
      pos[tk].shares += s
      pos[tk].cost   += s * p + (Number(t.fee) || 0) + (Number(t.tax) || 0)
    } else if (t.type === 'Sell') {
      const avg = pos[tk].shares > 0 ? pos[tk].cost / pos[tk].shares : 0
      pos[tk].shares = Math.max(0, pos[tk].shares - s)
      pos[tk].cost   = Math.max(0, pos[tk].cost - avg * s)
    }
    // Dividend / Deposit / Withdraw don't change a stock position
  }

  const existing = await getHoldings(portfolioId)
  const byTicker = new Map(existing.map(h => [h.ticker?.toUpperCase(), h]))
  let updated = 0, created = 0, removed = 0
  const errors = []

  for (const [tk, P] of Object.entries(pos)) {
    const h = byTicker.get(tk)
    if (P.shares > SHARE_EPS) {
      const cost_price = P.cost / P.shares
      if (h) {
        const { error } = await updateHolding(h.id, { shares: P.shares, cost_price })
        if (error) errors.push(`${tk}: ${error.message}`); else updated++
      } else {
        const isUSD = P.currency === 'USD'
        const { error } = await addHolding(portfolioId, {
          ticker: tk, name: P.name || tk, shares: P.shares, cost_price,
          currency: P.currency || 'THB',
          region: isUSD ? 'US' : 'TH', asset_class: 'Equity',
          div_frequency: isUSD ? 4 : 2,
        })
        if (error) errors.push(`${tk}: ${error.message}`); else created++
      }
    } else if (h) {
      await deleteHolding(h.id); removed++
    }
  }

  const orphans = existing.filter(h => !(h.ticker?.toUpperCase() in pos)).map(h => h.ticker)
  return { error: errors.length ? errors.join('; ') : null, updated, created, removed, orphans }
}

export async function getSnapshots(portfolioId, days = 1000) {
  if (!portfolioId) return []
  // Fetch the most recent `days` rows, then return ascending for time-series math
  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('date,total_value,total_cost')
    .eq('portfolio_id', portfolioId)
    .order('date', { ascending: false })
    .limit(days)
  if (error) { console.warn('[Lumen] getSnapshots:', error.message); return [] }
  return (data || []).reverse()
}

export async function getGoals(userId) {
  const { data } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  return data || []
}

export async function upsertGoal(userId, goal) {
  const { data, error } = await supabase
    .from('goals')
    .upsert({ user_id: userId, ...goal })
    .select()
    .single()
  return { data, error }
}

export async function deleteGoal(id) {
  return supabase.from('goals').delete().eq('id', id)
}

// ── Cash accounts ─────────────────────────────────────────────────────────────
export async function getCashAccounts(portfolioId) {
  // Note: cash_accounts has no created_at — order by updated_at instead
  const { data, error } = await supabase
    .from('cash_accounts')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .order('updated_at', { ascending: true })
  if (error) console.warn('[Lumen] getCashAccounts error:', error.message)
  return data || []
}

// Gather everything for a full backup (holdings, transactions, cash, goals).
export async function exportData(portfolioId, userId) {
  if (!portfolioId) return null
  const [holdings, transactions, cash_accounts] = await Promise.all([
    getHoldings(portfolioId),
    getAllTransactions(portfolioId),
    getCashAccounts(portfolioId),
  ])
  let goals = []
  if (userId) { try { goals = await getGoals(userId) } catch {} }
  return {
    app: 'Lumen',
    exported_at: new Date().toISOString(),
    portfolio_id: portfolioId,
    holdings, transactions, cash_accounts, goals,
  }
}

export async function upsertCashAccount(portfolioId, acct) {
  const { data, error } = await supabase
    .from('cash_accounts')
    .upsert({ portfolio_id: portfolioId, ...acct, updated_at: new Date().toISOString() })
    .select()
    .single()
  return { data, error }
}

export async function deleteCashAccount(id) {
  return supabase.from('cash_accounts').delete().eq('id', id)
}

// Derive display rows from raw Supabase holdings.
// `prices` is the object from fetchPrices() — optional, falls back to cost price.
// `fxRate` is live USD→THB rate (e.g. 36.5) — defaults to 36 if not provided.
//
// IMPORTANT: All monetary values (value, pl, cost, price) are returned in THB regardless
// of the `currency` parameter. Display-layer formatting (LUMEN_FMT.money) handles the
// THB→USD conversion at render time using the live rate. This prevents double-conversion.
export function deriveHoldings(holdings, currency = 'THB', prices = {}, fxRate = 36) {
  // Convert any amount to THB
  const toTHB = (amount, fromCcy) => {
    if (fromCcy === 'THB') return amount
    if (fromCcy === 'USD') return amount * fxRate
    return amount
  }

  const rows = holdings.map(h => {
    const holdingCcy = h.currency || 'THB'

    // Cost-basis in THB
    const costPriceInTHB = toTHB(h.cost_price, holdingCcy)
    const costValue = h.shares * costPriceInTHB   // THB

    // Live price from Yahoo Finance
    const sym = toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity')
    const priceData = prices[sym]

    // GoldTH: shares stored in Thai baht weight (บาท ทอง), needs troy-oz → baht conversion
    // XAU/GOLD with other asset classes are stored in troy ounces — use plain USD→THB
    const isGoldTH = h.asset_class === 'GoldTH'

    let currentPriceInTHB = costPriceInTHB
    let currentValue = costValue
    let pl = 0, plPct = 0, hasLivePrice = false, changePct = 0

    if (priceData?.price != null) {
      if (isGoldTH) {
        // GC=F = USD/troy oz → THB per Thai บาท ทอง
        // purity stored in logo_url (new) or sector (legacy — migrated on next edit)
        const purity = parseFloat(h.logo_url) || parseFloat(h.sector) || 96.5
        currentPriceInTHB = priceData.price * (15.244 * (purity / 100) / 31.1035) * fxRate
      } else {
        // .BK stocks → THB, US stocks & crypto → USD
        const priceCcy = h.region === 'TH' ? 'THB' : 'USD'
        currentPriceInTHB = toTHB(priceData.price, priceCcy)
      }
      currentValue = h.shares * currentPriceInTHB
      pl = currentValue - costValue
      plPct = costValue > 0 ? (pl / costValue) * 100 : 0
      hasLivePrice = true
      changePct = priceData.changePct ?? 0
    }

    // Native (untransformed) price & cost — for per-share display columns
    // nativeCcy: currency the LIVE PRICE is quoted in (USD for US stocks/crypto, THB for SET)
    const nativeCcy   = isGoldTH ? 'THB' : (priceData?.currency || (h.region === 'TH' ? 'THB' : 'USD'))
    const priceNative = isGoldTH ? currentPriceInTHB : (priceData?.price ?? h.cost_price)
    // costNative: h.cost_price is stored in h.currency — use holdingCcy for display, not nativeCcy
    // (e.g. user may have recorded BTC cost in THB even though BTC live price is in USD)
    const costNative    = isGoldTH ? costPriceInTHB : h.cost_price
    const costNativeCcy = isGoldTH ? 'THB' : holdingCcy  // correct currency for costNative display

    return {
      id: h.id,
      ticker: h.ticker,
      name: h.name,
      sector: h.sector || '—',
      region: h.region || 'TH',
      cls: h.asset_class || 'Equity',
      shares: h.shares,
      cost: costPriceInTHB,     // per-share cost in THB (used for groupByTicker avg)
      price: currentPriceInTHB, // per-share price in THB
      priceNative,      // per-share price in native currency (USD for VOO, THB for .BK)
      costNative,       // per-share cost in holdingCcy (NOT necessarily nativeCcy!)
      costNativeCcy,    // currency symbol for costNative display
      nativeCcy,        // currency for priceNative display
      value: currentValue,  // total current value in THB
      pl, plPct,            // P&L in THB
      weight: 0, // filled below
      divYield: priceData?.divYield ?? h.div_yield ?? 0,
      divFrequency: h.div_frequency || (h.region === 'TH' ? 2 : 4),
      currency: holdingCcy,
      logo_url: h.logo_url || null,
      hasLivePrice,
      changePct,
      spark: [],
    }
  })

  const totalValue = rows.reduce((s, r) => s + r.value, 0)
  return rows.map(r => ({ ...r, weight: totalValue > 0 ? (r.value / totalValue) * 100 : 0 }))
}
