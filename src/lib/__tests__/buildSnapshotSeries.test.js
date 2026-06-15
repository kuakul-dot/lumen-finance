import { vi, describe, test, expect, beforeEach } from 'vitest'

vi.mock('../supabase', () => ({ supabase: { from: vi.fn() } }))

import { buildSnapshotSeries } from '../db.js'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('buildSnapshotSeries', () => {
  test('returns empty array for no transactions', () => {
    expect(buildSnapshotSeries([], {}, {})).toEqual([])
    expect(buildSnapshotSeries(null, {}, {})).toEqual([])
  })

  test('basic THB holding — value follows price, cost stays fixed', () => {
    const txs = [{ transacted_at: '2024-01-01T00:00:00Z', ticker: 'KBANK', type: 'Buy', shares: 100, price: 130, fee: 0, tax: 0, currency: 'THB' }]
    const series = { KBANK: [{ d: '2024-01-01', c: 130 }, { d: '2024-01-02', c: 140 }] }
    const result = buildSnapshotSeries(txs, series, { KBANK: 'THB' }, 36)
    const d1 = result.find(r => r.date === '2024-01-01')
    const d2 = result.find(r => r.date === '2024-01-02')
    expect(d1.total_value).toBeCloseTo(13000, 1)
    expect(d1.total_cost).toBeCloseTo(13000, 1)
    expect(d2.total_value).toBeCloseTo(14000, 1)
    expect(d2.total_cost).toBeCloseTo(13000, 1) // cost unchanged
  })

  test('USD holding: price and cost both multiplied by fxRate', () => {
    const txs = [{ transacted_at: '2024-01-01T00:00:00Z', ticker: 'VOO', type: 'Buy', shares: 1, price: 400, fee: 0, tax: 0, currency: 'USD' }]
    const series = { VOO: [{ d: '2024-01-01', c: 400 }, { d: '2024-01-02', c: 450 }] }
    const costCcy = { VOO: 'USD' }
    const priceCcy = { VOO: 'USD' }
    const result = buildSnapshotSeries(txs, series, costCcy, 36, {}, priceCcy)
    const d1 = result.find(r => r.date === '2024-01-01')
    const d2 = result.find(r => r.date === '2024-01-02')
    expect(d1.total_value).toBeCloseTo(400 * 36, 1)  // 14400
    expect(d1.total_cost).toBeCloseTo(400 * 36, 1)   // 14400
    expect(d2.total_value).toBeCloseTo(450 * 36, 1)  // 16200
    expect(d2.total_cost).toBeCloseTo(400 * 36, 1)   // cost fixed
  })

  test('GoldTH: troy-oz price converted to Thai baht-weight via weight factor', () => {
    const txs = [{ transacted_at: '2024-01-01T00:00:00Z', ticker: 'GOLD', type: 'Buy', shares: 1, price: 30000, fee: 0, tax: 0, currency: 'THB' }]
    const series = { GOLD: [{ d: '2024-01-01', c: 2000 }] }
    const costCcy  = { GOLD: 'THB' }
    const priceCcy = { GOLD: 'USD' }
    const clsByTk  = { GOLD: 'GoldTH' }
    const result = buildSnapshotSeries(txs, series, costCcy, 36, {}, priceCcy, clsByTk)
    // 1 บาท ทอง = 15.244g = 15.244/31.1035 troy oz
    const wf = 15.244 / 31.1035
    const row = result.find(r => r.date === '2024-01-01')
    expect(row.total_value).toBeCloseTo(1 * wf * 2000 * 36, 0) // ≈ 35,298
    expect(row.total_cost).toBeCloseTo(30000, 0)                // THB cost, no FX
  })

  test('buy + sell: shares and cost reduce proportionally', () => {
    const txs = [
      { transacted_at: '2024-01-01T00:00:00Z', ticker: 'KBANK', type: 'Buy',  shares: 100, price: 130, fee: 0, tax: 0, currency: 'THB' },
      { transacted_at: '2024-01-02T00:00:00Z', ticker: 'KBANK', type: 'Sell', shares: 30,  price: 140, fee: 0, tax: 0, currency: 'THB' },
    ]
    const series = { KBANK: [{ d: '2024-01-01', c: 130 }, { d: '2024-01-02', c: 140 }, { d: '2024-01-03', c: 150 }] }
    const result = buildSnapshotSeries(txs, series, { KBANK: 'THB' }, 36)
    const d3 = result.find(r => r.date === '2024-01-03')
    // remaining 70 shares; cost = 13000 - 30*(13000/100) = 9100
    expect(d3.total_value).toBeCloseTo(70 * 150, 1) // 10500
    expect(d3.total_cost).toBeCloseTo(9100, 1)
  })

  test('spike filter: isolated bad price replaced with previous', () => {
    const txs = [{ transacted_at: '2024-01-01T00:00:00Z', ticker: 'KBANK', type: 'Buy', shares: 100, price: 130, fee: 0, tax: 0, currency: 'THB' }]
    const series = {
      KBANK: [
        { d: '2024-01-01', c: 130 },
        { d: '2024-01-02', c: 200 }, // >30% spike, reverts next day
        { d: '2024-01-03', c: 133 }, // <15% from original 130
      ]
    }
    const result = buildSnapshotSeries(txs, series, { KBANK: 'THB' }, 36)
    const d2 = result.find(r => r.date === '2024-01-02')
    // Bad price (200) replaced with prev (130) → value = 100 * 130 = 13000
    expect(d2.total_value).toBeCloseTo(13000, 1)
  })

  test('fxByDate overrides fallback fxRate for date-accurate FX', () => {
    const txs = [{ transacted_at: '2024-01-01T00:00:00Z', ticker: 'VOO', type: 'Buy', shares: 1, price: 400, fee: 0, tax: 0, currency: 'USD' }]
    const series = { VOO: [{ d: '2024-01-01', c: 400 }] }
    const result = buildSnapshotSeries(txs, series, { VOO: 'USD' }, 36, { '2024-01-01': 35 }, { VOO: 'USD' })
    const row = result.find(r => r.date === '2024-01-01')
    expect(row.total_value).toBeCloseTo(400 * 35, 1) // uses historic FX 35, not fallback 36
  })
})
