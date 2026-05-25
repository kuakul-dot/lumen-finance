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

// Approximate FX rate THB/USD — used for cross-currency conversions
const USD_THB = 36

// Convert a price in `fromCcy` to display currency
function fxConvert(amount, fromCcy, displayCcy) {
  if (fromCcy === displayCcy) return amount
  if (fromCcy === 'USD' && displayCcy === 'THB') return amount * USD_THB
  if (fromCcy === 'THB' && displayCcy === 'USD') return amount / USD_THB
  return amount
}

// Derive display rows from raw Supabase holdings.
// `prices` is the object from fetchPrices() — optional, falls back to cost price.
export function deriveHoldings(holdings, currency = 'THB', prices = {}) {
  const rows = holdings.map(h => {
    const displayCcy = currency
    const holdingCcy = h.currency || 'THB'

    // Cost-basis value in display currency
    const costPriceInDisplay = fxConvert(h.cost_price, holdingCcy, displayCcy)
    const costValue = h.shares * costPriceInDisplay

    // Live price from Yahoo Finance
    const sym = toYahooSymbol(h.ticker, h.region || 'TH', h.asset_class || 'Equity')
    const priceData = prices[sym]

    let currentPriceInDisplay = costPriceInDisplay
    let currentValue = costValue
    let pl = 0, plPct = 0, hasLivePrice = false, changePct = 0

    if (priceData?.price != null) {
      // Yahoo Finance returns price in the asset's native currency
      // .BK stocks → THB, US stocks & crypto → USD
      const priceCcy = h.region === 'TH' ? 'THB' : 'USD'
      currentPriceInDisplay = fxConvert(priceData.price, priceCcy, displayCcy)
      currentValue = h.shares * currentPriceInDisplay
      pl = currentValue - costValue
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
      cost: costPriceInDisplay,
      price: currentPriceInDisplay,
      priceNative,   // per-share price in native currency (USD for VOO, THB for .BK)
      costNative,    // per-share cost  in native currency
      nativeCcy,     // currency for priceNative / costNative display
      value: currentValue,
      pl, plPct,
      weight: 0, // filled below
      divYield: h.div_yield || 0,
      currency: holdingCcy,
      hasLivePrice,
      changePct,
      spark: [],
    }
  })

  const totalValue = rows.reduce((s, r) => s + r.value, 0)
  return rows.map(r => ({ ...r, weight: totalValue > 0 ? (r.value / totalValue) * 100 : 0 }))
}
