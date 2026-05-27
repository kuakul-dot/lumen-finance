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
