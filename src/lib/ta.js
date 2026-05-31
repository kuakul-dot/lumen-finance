// Quick technical indicators computed from a daily-close price series.
// Pure JS, no external libs — the AI gets pre-computed numbers so it doesn't
// have to invent levels from text or fabricate support/resistance.

export function computeTA(series) {
  if (!Array.isArray(series) || series.length === 0) return null
  const closes = series.map(p => p.c).filter(c => Number.isFinite(c))
  if (closes.length < 10) return null

  const last = closes[closes.length - 1]
  const ma = (n) => {
    if (closes.length < n) return null
    const slice = closes.slice(-n)
    return slice.reduce((s, c) => s + c, 0) / slice.length
  }

  // 52-week (approximate as 252 trading days)
  const yearSlice = closes.slice(-252)
  const high52 = Math.max(...yearSlice)
  const low52  = Math.min(...yearSlice)

  // Recent swing high/low — useful as immediate support/resistance
  const recentSlice = closes.slice(-60)        // ~3 months
  const recentHigh = Math.max(...recentSlice)
  const recentLow  = Math.min(...recentSlice)

  // Distance from 52w range as 0..1
  const range52pct = (high52 > low52) ? ((last - low52) / (high52 - low52)) * 100 : null

  return {
    price: round(last),
    ma20:  round(ma(20)),
    ma50:  round(ma(50)),
    ma200: round(ma(200)),
    rsi14: round(rsi(closes, 14), 1),
    high52: round(high52),
    low52:  round(low52),
    range52pct: round(range52pct, 1),       // 0% = at low, 100% = at high
    recentHigh: round(recentHigh),
    recentLow:  round(recentLow),
    bollinger:  bollinger(closes, 20, 2),
    momentum: {
      d20: pctChange(closes, 20),
      d50: pctChange(closes, 50),
      d200: pctChange(closes, 200),
    },
  }
}

function round(x, d = 2) {
  return x == null || !Number.isFinite(x) ? null : +x.toFixed(d)
}

function pctChange(closes, n) {
  if (closes.length <= n) return null
  const past = closes[closes.length - 1 - n]
  if (!past) return null
  return round(((closes[closes.length - 1] / past) - 1) * 100, 1)
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    if (change > 0) gains += change
    else losses -= change
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - (100 / (1 + rs))
}

function bollinger(closes, n = 20, k = 2) {
  if (closes.length < n) return null
  const slice = closes.slice(-n)
  const mean = slice.reduce((s, c) => s + c, 0) / n
  const variance = slice.reduce((s, c) => s + (c - mean) ** 2, 0) / n
  const sd = Math.sqrt(variance)
  return {
    mid:   round(mean),
    upper: round(mean + k * sd),
    lower: round(mean - k * sd),
  }
}
