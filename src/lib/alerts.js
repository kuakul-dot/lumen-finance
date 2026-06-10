// Price Alert engine — localStorage cache + optional Supabase sync
// When a user is logged in, alerts are persisted to Supabase so they
// survive across devices. localStorage acts as a fast local cache.

import { supabase } from './supabase'

const KEY = 'lumen_alerts_v1'

// Current logged-in user ID (set by App.jsx on session change)
let _userId = null
export function setAlertsUserId(id) { _userId = id }
export function clearAlertsUserId() { _userId = null }

// ── Local cache (localStorage) ────────────────────────────────────────────────
export function loadAlerts() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {}
  window.dispatchEvent(new CustomEvent('lumen-alerts-changed'))
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export function addAlert(data) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  const alert = {
    id, ...data,
    active: true, triggered: false,
    createdAt: new Date().toISOString(),
    triggeredAt: null,
  }
  save([alert, ...loadAlerts()])
  // Fire-and-forget sync to Supabase
  if (_userId) _syncAdd(_userId, alert)
  return alert
}

export function removeAlert(id) {
  save(loadAlerts().filter(a => a.id !== id))
  if (_userId) _syncRemove(_userId, id)
}

export function clearTriggered() {
  const toRemove = loadAlerts().filter(a => a.triggered).map(a => a.id)
  save(loadAlerts().filter(a => !a.triggered))
  if (_userId) toRemove.forEach(id => _syncRemove(_userId, id))
}

export function getActiveCount() {
  return loadAlerts().filter(a => a.active && !a.triggered).length
}

// ── Supabase bootstrap ─────────────────────────────────────────────────────────
// Call once on login. Loads all alerts from Supabase → merges into localStorage.
// Any local-only alerts (not yet synced) are pushed up to Supabase as well.
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

    // Supabase rows → local alert shape
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
    }))

    // Read localStorage NOW (after async fetch) — user may have added/deleted while waiting
    const local     = loadAlerts()
    const localMap  = new Map(local.map(a => [a.id, a]))
    const remoteIds = new Set(remote.map(a => a.id))

    // Push local-only alerts to Supabase
    const localOnly = local.filter(a => !remoteIds.has(a.id))
    for (const a of localOnly) await _syncAdd(userId, a)

    // Merge strategy:
    //   • Remote alerts PRESENT in local → use remote (has authoritative triggered/active state)
    //   • Remote alerts NOT in local → add them (new from another device) UNLESS local was
    //     more recently active (i.e. user just deleted it this session — treat missing as deleted)
    //   • Local-only alerts → keep as-is (already pushed to Supabase above)
    //
    // Key fix: read localMap AFTER the async fetch so any delete that happened during the
    // fetch is already reflected — those IDs won't be in localMap, so they won't be restored.
    const remoteKept = remote.filter(a => localMap.has(a.id))
    const remoteNew  = remote.filter(a => !localMap.has(a.id))

    const merged = [
      ...remoteNew,                               // genuinely new alerts from other devices
      ...remoteKept.map(r => {                    // sync triggered/active state from Supabase
        const l = localMap.get(r.id)
        if (r.triggered && !l.triggered) return { ...l, triggered: true, active: false, triggeredAt: r.triggeredAt }
        return l
      }),
      ...localOnly,                               // local-only (just pushed above)
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
// Call this every time prices update.
// Returns the number of newly triggered alerts.
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
      // Sync triggered state to Supabase
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
