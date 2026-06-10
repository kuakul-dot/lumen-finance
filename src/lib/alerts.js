// Price Alert engine — localStorage cache + Supabase sync
//
// Sync design:
//   _synced flag  — set true once _syncAdd confirms the alert is in Supabase
//   tombstone     — IDs deleted on THIS device; prevents Supabase from restoring them
//
// initAlertsFromSupabase merge rules:
//   local + NOT in remote + _synced=false  → never reached Supabase → push up
//   local + NOT in remote + _synced=true   → deleted on another device → drop from local
//   local + in tombstone                   → deleted here; retry Supabase delete
//   remote + NOT in local + NOT tombstoned → new from another device → add to local
//   remote + NOT in local + tombstoned     → deleted here (sync may have been slow) → skip

import { supabase } from './supabase'

const KEY       = 'lumen_alerts_v1'
const TOMB_KEY  = 'lumen_alerts_deleted_v1'

// ── Current logged-in user ID ─────────────────────────────────────────────────
let _userId = null
export function setAlertsUserId(id) { _userId = id }
export function clearAlertsUserId() { _userId = null }

// ── Tombstone helpers ─────────────────────────────────────────────────────────
function loadTombstones() {
  try { return new Set(JSON.parse(localStorage.getItem(TOMB_KEY) || '[]')) } catch { return new Set() }
}
function addTombstone(id) {
  const ids = [...loadTombstones(), id].slice(-300)   // cap at 300 to prevent unbounded growth
  try { localStorage.setItem(TOMB_KEY, JSON.stringify(ids)) } catch {}
}

// ── Local cache (localStorage) ────────────────────────────────────────────────
export function loadAlerts() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {}
  window.dispatchEvent(new CustomEvent('lumen-alerts-changed'))
}

// Silently update _synced flag without triggering a UI re-render
function markSynced(id) {
  try {
    const list = loadAlerts().map(a => a.id === id ? { ...a, _synced: true } : a)
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {}
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export function addAlert(data) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  const alert = {
    id, ...data,
    active: true, triggered: false,
    createdAt: new Date().toISOString(),
    triggeredAt: null,
    _synced: false,
  }
  save([alert, ...loadAlerts()])
  if (_userId) _syncAdd(_userId, alert).then(() => markSynced(id)).catch(() => {})
  return alert
}

export function removeAlert(id) {
  addTombstone(id)
  save(loadAlerts().filter(a => a.id !== id))
  if (_userId) _syncRemove(_userId, id)
}

export function clearTriggered() {
  const toRemove = loadAlerts().filter(a => a.triggered).map(a => a.id)
  toRemove.forEach(id => addTombstone(id))
  save(loadAlerts().filter(a => !a.triggered))
  if (_userId) toRemove.forEach(id => _syncRemove(_userId, id))
}

export function getActiveCount() {
  return loadAlerts().filter(a => a.active && !a.triggered).length
}

// ── Supabase bootstrap ─────────────────────────────────────────────────────────
// Call once on login. Full bidirectional sync:
//   - New remote alerts (from other devices) → added to local
//   - Deleted remote alerts (by other devices) → removed from local
//   - Local-only never-synced alerts → pushed to Supabase
//   - Locally-deleted alerts (tombstoned) → Supabase delete retried if still there
export async function initAlertsFromSupabase(userId) {
  if (!userId) return
  setAlertsUserId(userId)
  try {
    const { data, error } = await supabase
      .from('price_alerts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) { console.warn('[Alerts] init fetch:', error.message); return }

    // Map Supabase rows → local alert shape
    const remote = (data || []).map(r => ({
      id:          r.local_id || r.id,
      ticker:      r.ticker,
      yahooSym:    r.yahoo_sym,
      region:      r.region,
      cls:         r.cls,
      name:        r.name,
      targetPrice: Number(r.target_price),
      direction:   r.direction,
      label:       r.label || '',
      currency:    r.currency || 'THB',
      livePrice:   r.live_price ? Number(r.live_price) : null,
      active:      r.active,
      triggered:   r.triggered,
      createdAt:   r.created_at,
      triggeredAt: r.triggered_at,
      _synced:     true,
    }))

    // Read localStorage AFTER the async fetch (captures any user actions during the fetch)
    const local      = loadAlerts()
    const localMap   = new Map(local.map(a => [a.id, a]))
    const remoteIds  = new Set(remote.map(a => a.id))
    const tombstones = loadTombstones()

    // ── Local alerts not in Supabase ──────────────────────────────────────────
    const localNotInRemote = local.filter(a => !remoteIds.has(a.id))

    for (const a of localNotInRemote) {
      if (tombstones.has(a.id)) {
        // Tombstoned + not in remote → already deleted from Supabase (or never got there). No-op.
        continue
      }
      if (!a._synced) {
        // Never made it to Supabase (e.g. was offline when added) → push up now
        await _syncAdd(userId, a)
      }
      // If _synced=true but NOT in remote → deleted on another device → will be excluded from merged
    }

    // Retry Supabase delete for tombstoned IDs that are STILL in Supabase
    for (const r of remote) {
      if (tombstones.has(r.id)) await _syncRemove(userId, r.id)
    }

    // ── Build merged list ─────────────────────────────────────────────────────
    const merged = [
      // Remote alerts not tombstoned: source of truth for cross-device state
      ...remote
        .filter(a => !tombstones.has(a.id))
        .map(r => {
          const l = localMap.get(r.id)
          if (!l) return r   // New from another device
          // Sync triggered/active state if Supabase is ahead
          if (r.triggered && !l.triggered) return { ...l, triggered: true, active: false, triggeredAt: r.triggeredAt, _synced: true }
          return { ...l, _synced: true }
        }),

      // Local-only alerts that were never synced (just pushed above)
      ...localNotInRemote.filter(a => !a._synced && !tombstones.has(a.id)),
    ]

    save(merged)
  } catch (err) {
    console.warn('[Alerts] initFromSupabase:', err.message)
  }
}

// ── Notification permission ───────────────────────────────────────────────────
export async function requestNotifPermission() {
  if (!('Notification' in window)) return false
  if (window.Notification.permission === 'granted') return true
  if (window.Notification.permission === 'denied') return false
  return (await window.Notification.requestPermission()) === 'granted'
}

// ── Format price for notifications ───────────────────────────────────────────
function fmtP(p, ccy) {
  const prefix = ccy === 'THB' ? '฿' : '$'
  const dp = !p ? 2 : p < 1 ? 4 : p < 100 ? 2 : 0
  return prefix + (p || 0).toLocaleString('en', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

// ── Fire browser notification ─────────────────────────────────────────────────
function fireNotif(alert, currentPrice) {
  if (!('Notification' in window) || window.Notification.permission !== 'granted') return
  const arrow = alert.direction === 'above' ? '▲' : '▼'
  new window.Notification(`🔔 ${alert.ticker} — ${alert.label} ${arrow}`, {
    body: `ราคา ${fmtP(currentPrice, alert.currency)} แตะเป้า ${fmtP(alert.targetPrice, alert.currency)}`,
    icon: '/favicon.ico',
    tag: `lumen-alert-${alert.id}`,
  })
}

// ── Check all active alerts against a live prices map ────────────────────────
export function checkAndFireAlerts(prices) {
  if (!prices || typeof prices !== 'object') return 0
  const alerts = loadAlerts()
  const active = alerts.filter(a => a.active && !a.triggered)
  if (!active.length) return 0

  let count = 0
  const updated = alerts.map(a => {
    if (!a.active || a.triggered) return a
    const px = prices[a.yahooSym]?.price
    if (!px || !Number.isFinite(px)) return a
    const hit = a.direction === 'above' ? px >= a.targetPrice : px <= a.targetPrice
    if (hit) {
      count++
      fireNotif(a, px)
      const triggered = { ...a, triggered: true, active: false, triggeredAt: new Date().toISOString() }
      if (_userId) _syncTrigger(_userId, triggered)
      return triggered
    }
    return a
  })

  if (count > 0) save(updated)
  return count
}

// ── Supabase sync helpers (fire-and-forget) ───────────────────────────────────
async function _syncAdd(userId, alert) {
  try {
    await supabase.from('price_alerts').upsert({
      user_id:      userId,
      local_id:     alert.id,
      ticker:       alert.ticker      || '',
      yahoo_sym:    alert.yahooSym    || alert.ticker,
      region:       alert.region      || null,
      cls:          alert.cls         || null,
      name:         alert.name        || null,
      target_price: alert.targetPrice,
      direction:    alert.direction,
      label:        alert.label       || '',
      currency:     alert.currency    || 'THB',
      live_price:   alert.livePrice   || null,
      active:       alert.active,
      triggered:    alert.triggered,
      triggered_at: alert.triggeredAt || null,
    }, { onConflict: 'user_id,local_id' })
  } catch (err) {
    console.warn('[Alerts] syncAdd:', err.message)
  }
}

async function _syncRemove(userId, localId) {
  try {
    await supabase.from('price_alerts')
      .delete()
      .eq('user_id', userId)
      .eq('local_id', localId)
  } catch {}
}

async function _syncTrigger(userId, alert) {
  try {
    await supabase.from('price_alerts')
      .update({ active: false, triggered: true, triggered_at: alert.triggeredAt })
      .eq('user_id', userId)
      .eq('local_id', alert.id)
  } catch {}
}
