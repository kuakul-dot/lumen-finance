import { supabase } from './supabase'
import { toYahooSymbol } from './prices'

export async function getOrCreatePortfolio(userId, currency = 'THB') {
  const { data, error } = await supabase
    .from('portfolios')
    .select('*')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`portfolios select: ${error.message}`)
  if (data) return data
  const { data: created, error: insertError } = await supabase
    .from('portfolios')
    .insert({ user_id: userId, currency })
    .select()
    .single()
  if (insertError) throw new Error(`portfolios insert: ${insertError.message}`)
  return created
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
      if (h) {
        const prevShares = Number(h.shares) || 0
        const prevCost   = Number(h.cost_price) || 0
        const newShares  = prevShares + shares
        h.cost_price = newShares > 0
          ? (prevShares * prevCost + shares * price) / newShares
          : price
        h.shares  = newShares
        h._dirty  = true
      } else {
        const isUSD = (tx.currency || 'THB') === 'USD'
        byTicker.set(key, {
          _new: true, _dirty: true,
          ticker: key, name: tx.note || key, shares, cost_price: price,
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
    if (h._new) {
      const { _new, _dirty, ...payload } = h
      const { error } = await addHolding(portfolioId, payload)
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
      shares += s; costTotal += s * p
    } else if (tx.type === 'Sell') {
      const avg = shares > 0 ? costTotal / shares : 0
      shares    = Math.max(0, shares - s)
      costTotal = Math.max(0, costTotal - s * avg)
    }
  }

  const existing = await getHoldings(portfolioId)
  const h = existing.find(x => x.ticker?.toUpperCase() === key)

  if (shares <= 0) {
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

    let currentPriceInTHB = costPriceInTHB
    let currentValue = costValue
    let pl = 0, plPct = 0, hasLivePrice = false, changePct = 0

    if (priceData?.price != null) {
      // Yahoo Finance returns price in the asset's native currency
      // .BK stocks → THB, US stocks & crypto → USD
      const priceCcy = h.region === 'TH' ? 'THB' : 'USD'
      currentPriceInTHB = toTHB(priceData.price, priceCcy)
      currentValue = h.shares * currentPriceInTHB  // THB
      pl = currentValue - costValue                 // THB
      plPct = costValue > 0 ? (pl / costValue) * 100 : 0
      hasLivePrice = true
      changePct = priceData.changePct ?? 0
    }

    // Native (untransformed) price & cost — for per-share display columns
    const nativeCcy = priceData?.currency || (h.region === 'TH' ? 'THB' : 'USD')
    const priceNative = priceData?.price ?? h.cost_price  // in native currency
    const costNative  = h.cost_price                      // in native currency

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
      priceNative,   // per-share price in native currency (USD for VOO, THB for .BK)
      costNative,    // per-share cost  in native currency
      nativeCcy,     // currency for priceNative / costNative display
      value: currentValue,  // total current value in THB
      pl, plPct,            // P&L in THB
      weight: 0, // filled below
      divYield: priceData?.divYield ?? h.div_yield ?? 0,
      divFrequency: h.div_frequency || (h.region === 'TH' ? 2 : 4),
      currency: holdingCcy,
      hasLivePrice,
      changePct,
      spark: [],
    }
  })

  const totalValue = rows.reduce((s, r) => s + r.value, 0)
  return rows.map(r => ({ ...r, weight: totalValue > 0 ? (r.value / totalValue) * 100 : 0 }))
}
