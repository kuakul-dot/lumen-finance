// Price Alert engine — localStorage-backed, browser Notification API
// No backend needed. Alerts persist across sessions via localStorage.

const KEY = 'lumen_alerts_v1'

// ── CRUD ──────────────────────────────────────────────────────────────────────
export function loadAlerts() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch {}
  window.dispatchEvent(new CustomEvent('lumen-alerts-changed'))
}

export function addAlert(data) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  const alert = {
    id, ...data,
    active: true, triggered: false,
    createdAt: new Date().toISOString(),
    triggeredAt: null,
  }
  save([alert, ...loadAlerts()])
  return alert
}

export function removeAlert(id) {
  save(loadAlerts().filter(a => a.id !== id))
}

export function clearTriggered() {
  save(loadAlerts().filter(a => !a.triggered))
}

export function getActiveCount() {
  return loadAlerts().filter(a => a.active && !a.triggered).length
}

// ── Notification permission ───────────────────────────────────────────────────
export async function requestNotifPermission() {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  return (await Notification.requestPermission()) === 'granted'
}

// ── Format price for notifications ───────────────────────────────────────────
function fmtP(p, ccy) {
  const prefix = ccy === 'THB' ? '฿' : '$'
  const dp = !p ? 2 : p < 1 ? 4 : p < 100 ? 2 : 0
  return prefix + (p || 0).toLocaleString('en', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

// ── Fire browser notification ─────────────────────────────────────────────────
function fireNotif(alert, currentPrice) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const arrow = alert.direction === 'above' ? '▲' : '▼'
  new Notification(`🔔 ${alert.ticker} — ${alert.label} ${arrow}`, {
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
      return { ...a, triggered: true, active: false, triggeredAt: new Date().toISOString() }
    }
    return a
  })

  if (count > 0) save(updated)
  return count
}
