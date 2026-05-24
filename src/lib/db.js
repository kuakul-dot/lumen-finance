import { supabase } from './supabase'

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

// Derive display rows from raw Supabase holdings (at cost price — no live prices yet)
export function deriveHoldings(holdings, currency = 'THB') {
  const FX = currency === 'USD' ? 0.028 : 1
  const totalValue = holdings.reduce((s, h) => s + h.shares * h.cost_price * (h.currency === 'USD' ? 36 : 1) * FX, 0)
  return holdings.map(h => {
    const fx = h.currency === 'USD' ? 36 * FX : FX
    const value = h.shares * h.cost_price * fx
    const weight = totalValue > 0 ? (value / totalValue) * 100 : 0
    return {
      id: h.id,
      ticker: h.ticker,
      name: h.name,
      sector: h.sector || '—',
      region: h.region || 'TH',
      cls: h.asset_class || 'Equity',
      shares: h.shares,
      cost: h.cost_price,
      value,
      pl: 0,
      plPct: 0,
      weight,
      divYield: h.div_yield || 0,
      currency: h.currency,
      spark: [],
    }
  })
}
