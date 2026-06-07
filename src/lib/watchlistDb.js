// Supabase CRUD for the watchlist table.
// Falls back gracefully if Supabase is unavailable (table not yet created, etc.)

import { supabase } from './supabase'

// Convert a Supabase row → the shape WatchlistPage uses
function normalizeItem(r) {
  return {
    id:      r.id,           // Supabase UUID — used for delete / update
    symbol:  r.symbol,
    region:  r.region  || 'US',
    cls:     r.cls     || 'Equity',
    name:    r.name    || r.symbol,
    note:    r.note    || '',
    addedAt: r.added_at,
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────
export async function getWatchlist(userId) {
  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map(normalizeItem)
}

// ── Create ────────────────────────────────────────────────────────────────────
export async function addWatchlistItem(userId, item) {
  const { data, error } = await supabase
    .from('watchlist')
    .insert({
      user_id: userId,
      symbol:  item.symbol,
      region:  item.region || 'US',
      cls:     item.cls    || 'Equity',
      name:    item.name   || item.symbol,
      note:    item.note   || '',
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return normalizeItem(data)
}

// ── Update ────────────────────────────────────────────────────────────────────
export async function updateWatchlistNote(id, note) {
  const { error } = await supabase
    .from('watchlist')
    .update({ note })
    .eq('id', id)
  if (error) console.warn('[WatchlistDB] update note:', error.message)
}

// ── Delete ────────────────────────────────────────────────────────────────────
export async function removeWatchlistItem(id) {
  const { error } = await supabase
    .from('watchlist')
    .delete()
    .eq('id', id)
  if (error) console.warn('[WatchlistDB] delete:', error.message)
}

// ── One-time migration ────────────────────────────────────────────────────────
// Import localStorage items into Supabase. Idempotent — errors (e.g. duplicates)
// are silently ignored so re-running is safe.
export async function migrateLocalWatchlist(userId, localItems) {
  if (!localItems?.length) return 0
  let count = 0
  for (const item of localItems) {
    try {
      await addWatchlistItem(userId, item)
      count++
    } catch { /* duplicate or error — skip */ }
  }
  return count
}
