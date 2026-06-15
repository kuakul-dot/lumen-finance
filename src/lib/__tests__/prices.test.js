import { vi, describe, test, expect, beforeEach } from 'vitest'

global.fetch = vi.fn()

import { fetchPrices, clearPriceCache, toYahooSymbol } from '../prices.js'

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
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ 'KBANK.BK': { price: 150 } }) })
    const result = await fetchPrices(KBANK_HOLDINGS)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(result['KBANK.BK'].price).toBe(150)
  })

  test('cache hit: no second fetch within TTL', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ 'KBANK.BK': { price: 150 } }) })
    await fetchPrices(KBANK_HOLDINGS)
    await fetchPrices(KBANK_HOLDINGS) // same symbols → same cache key
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('clearPriceCache forces a fresh fetch', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ 'KBANK.BK': { price: 150 } }) })
    await fetchPrices(KBANK_HOLDINGS)
    clearPriceCache()
    await fetchPrices(KBANK_HOLDINGS)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('different symbol set → different cache key → new fetch', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    await fetchPrices(KBANK_HOLDINGS)
    await fetchPrices(PTT_HOLDINGS)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('throws when API returns non-ok status', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 503 })
    await expect(fetchPrices(KBANK_HOLDINGS)).rejects.toThrow('Price API 503')
  })
})
