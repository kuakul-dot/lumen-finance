import { vi, describe, test, expect, beforeEach } from 'vitest'

// Mock localStorage before module import
const _ls = {}
global.localStorage = {
  getItem:    (k) => _ls[k] ?? null,
  setItem:    (k, v) => { _ls[k] = v },
  removeItem: (k) => { delete _ls[k] },
}

global.fetch = vi.fn()

import { fetchPrices, clearPriceCache, toYahooSymbol, getPriceStatus } from '../prices.js'

beforeEach(() => {
  clearPriceCache()
  vi.clearAllMocks()
})

describe('toYahooSymbol', () => {
  test('TH equity → appends .BK', () => {
    expect(toYahooSymbol('KBANK', 'TH', 'Equity')).toBe('KBANK.BK')
  })
  test('US equity → plain ticker', () => {
    expect(toYahooSymbol('VOO', 'US', 'Equity')).toBe('VOO')
  })
  test('Crypto without dash → appends -USD', () => {
    expect(toYahooSymbol('BTC', 'US', 'Crypto')).toBe('BTC-USD')
  })
  test('Crypto with dash → unchanged', () => {
    expect(toYahooSymbol('BTC-USD', 'US', 'Crypto')).toBe('BTC-USD')
  })
  test('GoldTH → GC=F', () => {
    expect(toYahooSymbol('GOLD', 'TH', 'GoldTH')).toBe('GC=F')
  })
  test('XAU ticker → GC=F regardless of asset class', () => {
    expect(toYahooSymbol('XAU', 'US', 'Equity')).toBe('GC=F')
  })
  test('MutualFund → appends .BK', () => {
    expect(toYahooSymbol('KFSMART', 'TH', 'MutualFund')).toBe('KFSMART.BK')
  })
})

describe('fetchPrices cache', () => {
  const KBANK_HOLDINGS = [{ ticker: 'KBANK', region: 'TH', asset_class: 'Equity' }]
  const PTT_HOLDINGS   = [{ ticker: 'PTT',   region: 'TH', asset_class: 'Equity' }]

  test('fetches from API on first call', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ 'KBANK.BK': { price: 150 } }) })
    const result = await fetchPrices(KBANK_HOLDINGS)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result['KBANK.BK'].price).toBe(150)
  })

  test('cache hit: no second fetch within TTL', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ 'KBANK.BK': { price: 150 } }) })
    await fetchPrices(KBANK_HOLDINGS)
    await fetchPrices(KBANK_HOLDINGS)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('clearPriceCache forces a fresh fetch', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ 'KBANK.BK': { price: 150 } }) })
    await fetchPrices(KBANK_HOLDINGS)
    clearPriceCache()
    await fetchPrices(KBANK_HOLDINGS)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('different symbol set → different cache key → new fetch', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    await fetchPrices(KBANK_HOLDINGS)
    await fetchPrices(PTT_HOLDINGS)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('throws on non-ok status with no stale cache', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 503 })
    await expect(fetchPrices(KBANK_HOLDINGS)).rejects.toThrow('Price API 503')
  })

  test('429 with no cache → throws', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 429 })
    await expect(fetchPrices(KBANK_HOLDINGS)).rejects.toThrow('429')
  })

  test('429 with stale cache → returns stale data with _stale flag', async () => {
    // Populate cache first
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ 'KBANK.BK': { price: 150 } }) })
    await fetchPrices(KBANK_HOLDINGS)

    // Force cache to appear expired by backdating ts
    const { _cache_for_test } = await import('../prices.js').catch(() => ({}))
    // Backdating not directly accessible — instead: use vi.setSystemTime to advance clock
    vi.useFakeTimers()
    vi.advanceTimersByTime(6 * 60 * 1000)  // 6 min → past 5 min TTL

    fetch.mockResolvedValueOnce({ ok: false, status: 429 })
    const result = await fetchPrices(KBANK_HOLDINGS)

    expect(result['KBANK.BK'].price).toBe(150)
    expect(result._stale).toBe(true)
    expect(typeof result._staleMinutes).toBe('number')

    vi.useRealTimers()
  })

  test('non-ok error with stale cache → returns stale data', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ 'KBANK.BK': { price: 150 } }) })
    await fetchPrices(KBANK_HOLDINGS)

    vi.useFakeTimers()
    vi.advanceTimersByTime(6 * 60 * 1000)

    fetch.mockResolvedValueOnce({ ok: false, status: 503 })
    const result = await fetchPrices(KBANK_HOLDINGS)

    expect(result['KBANK.BK'].price).toBe(150)
    expect(result._stale).toBe(true)

    vi.useRealTimers()
  })
})

describe('getPriceStatus', () => {
  const KBANK_HOLDINGS = [{ ticker: 'KBANK', region: 'TH', asset_class: 'Equity' }]

  test('no data → hasData false', () => {
    const s = getPriceStatus()
    expect(s.hasData).toBe(false)
  })

  test('fresh cache → stale false', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ 'KBANK.BK': { price: 150 } }) })
    await fetchPrices(KBANK_HOLDINGS)
    const s = getPriceStatus()
    expect(s.hasData).toBe(true)
    expect(s.stale).toBe(false)
    expect(s.ageMinutes).toBe(0)
  })

  test('expired cache → stale true', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ 'KBANK.BK': { price: 150 } }) })
    await fetchPrices(KBANK_HOLDINGS)

    vi.useFakeTimers()
    vi.advanceTimersByTime(6 * 60 * 1000)
    const s = getPriceStatus()
    expect(s.stale).toBe(true)
    expect(s.ageMinutes).toBeGreaterThanOrEqual(6)
    vi.useRealTimers()
  })
})
