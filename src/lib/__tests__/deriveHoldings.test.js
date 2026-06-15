import { vi, describe, test, expect } from 'vitest'

vi.mock('../supabase', () => ({ supabase: {} }))

import { deriveHoldings } from '../db.js'

describe('deriveHoldings', () => {
  test('TH equity with live price: value, pl, plPct correct', () => {
    const h = [{ id: 1, ticker: 'KBANK', name: 'Kasikornbank', shares: 100, cost_price: 130, currency: 'THB', region: 'TH', asset_class: 'Equity' }]
    const prices = { 'KBANK.BK': { price: 150, changePct: 1.2, divYield: 3.5 } }
    const [row] = deriveHoldings(h, 'THB', prices, 36)
    expect(row.value).toBeCloseTo(15000, 1)
    expect(row.cost).toBeCloseTo(130, 2)      // per-share cost in THB
    expect(row.pl).toBeCloseTo(2000, 1)
    expect(row.plPct).toBeCloseTo(15.38, 1)
    expect(row.hasLivePrice).toBe(true)
  })

  test('US equity: cost and price converted USD→THB via fxRate', () => {
    const h = [{ id: 1, ticker: 'VOO', name: 'Vanguard S&P 500', shares: 1, cost_price: 400, currency: 'USD', region: 'US', asset_class: 'Equity' }]
    const prices = { 'VOO': { price: 450, changePct: 0.5, divYield: 1.3 } }
    const [row] = deriveHoldings(h, 'THB', prices, 36)
    expect(row.value).toBeCloseTo(450 * 36, 1)       // 16200
    expect(row.cost).toBeCloseTo(400 * 36, 1)         // 14400 per share in THB
    expect(row.pl).toBeCloseTo((450 - 400) * 36, 1)  // 1800
    expect(row.hasLivePrice).toBe(true)
  })

  test('GoldTH: GC=F troy-oz price × weight factor × FX', () => {
    const PURITY = 96.5
    const h = [{
      id: 1, ticker: 'GOLD', name: 'Thai Gold',
      shares: 1, cost_price: 28000, currency: 'THB',
      region: 'TH', asset_class: 'GoldTH',
      sector: String(PURITY), logo_url: null,
    }]
    const prices = { 'GC=F': { price: 2000, changePct: 0, divYield: 0 } }
    const [row] = deriveHoldings(h, 'THB', prices, 36)
    // formula: price * (15.244 * (purity/100) / 31.1035) * fxRate
    const expected = 2000 * (15.244 * (PURITY / 100) / 31.1035) * 36
    expect(row.value).toBeCloseTo(expected, 0)
    expect(row.cost).toBeCloseTo(28000, 0) // THB cost unchanged
    expect(row.hasLivePrice).toBe(true)
  })

  test('no live price: falls back to cost price, pl = 0', () => {
    const h = [{ id: 1, ticker: 'KBANK', name: 'K', shares: 100, cost_price: 130, currency: 'THB', region: 'TH', asset_class: 'Equity' }]
    const [row] = deriveHoldings(h, 'THB', {}, 36)
    expect(row.value).toBeCloseTo(13000, 1)
    expect(row.pl).toBe(0)
    expect(row.hasLivePrice).toBe(false)
  })

  test('weight is proportional to total portfolio value', () => {
    const h = [
      { id: 1, ticker: 'KBANK', name: 'K', shares: 100, cost_price: 100, currency: 'THB', region: 'TH', asset_class: 'Equity' },
      { id: 2, ticker: 'PTT',   name: 'P', shares: 100, cost_price: 100, currency: 'THB', region: 'TH', asset_class: 'Equity' },
    ]
    const prices = {
      'KBANK.BK': { price: 150, changePct: 0 },
      'PTT.BK':   { price: 50,  changePct: 0 },
    }
    const rows = deriveHoldings(h, 'THB', prices, 36)
    const kbank = rows.find(r => r.ticker === 'KBANK')
    const ptt   = rows.find(r => r.ticker === 'PTT')
    expect(kbank.weight).toBeCloseTo(75, 1) // 15000/20000
    expect(ptt.weight).toBeCloseTo(25, 1)   // 5000/20000
  })
})
