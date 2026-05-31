// Embed a TradingView Advanced Chart for a given holding. Free widget — no
// API key needed, just an iframe pointed at TradingView's widgetembed.
// Used by Portfolio's "📊 Chart" button.
import { useMemo } from 'react'

export function TradingViewChart({ ticker, region, height = 480 }) {
  // Resolve our internal ticker into the exchange-prefixed symbol TV expects.
  // Thai listings live on SET; for US we don't prefix and let TV's search
  // figure out NASDAQ vs NYSE vs ARCA from the ticker alone.
  const tvSymbol = useMemo(() => {
    if (!ticker) return ''
    const clean = String(ticker).toUpperCase().replace(/\.BK$/, '')
    return region === 'TH' ? `SET:${clean}` : clean
  }, [ticker, region])

  const isDark = typeof document !== 'undefined' &&
    document.documentElement.dataset.theme === 'dark'

  const src = useMemo(() => {
    const params = new URLSearchParams({
      symbol: tvSymbol,
      interval: 'D',
      theme: isDark ? 'dark' : 'light',
      style: '1',
      locale: 'en',
      timezone: 'Asia/Bangkok',
      toolbarbg: isDark ? '141414' : 'f1f3f6',
      withdateranges: '1',
      hideideas: '1',
      allow_symbol_change: '1',
      details: '0',
      hotlist: '0',
      calendar: '0',
      studies: '[]',
    })
    return `https://s.tradingview.com/widgetembed/?${params.toString()}`
  }, [tvSymbol, isDark])

  if (!tvSymbol) return null
  return (
    <div style={{ width: '100%', height, position: 'relative', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }}>
      <iframe
        key={src}                          // re-mount when symbol/theme changes
        src={src}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title={`TradingView chart for ${tvSymbol}`}
        allowFullScreen
      />
    </div>
  )
}
