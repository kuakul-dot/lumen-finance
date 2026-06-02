// Shared hook that powers any AI-analysis modal in the app: initial call +
// multi-turn follow-ups + streaming + a per-day local sanity cap.
// Each consumer (Dashboard overview, Tools rebalance, etc.) just calls
// `run(payload)` with the right shape and renders <AiAnalysisModal> with the
// returned state.
import { useState } from 'react'

const DAILY_CAP = 20
const dayKey = () => `lumen.aiCount.${new Date().toISOString().slice(0, 10)}`

async function readStream(response, onChunk) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let acc = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    acc += chunk
    onChunk(chunk, acc)
  }
  return acc
}

export function useAiAnalysis() {
  const [open, setOpen]             = useState(false)
  const [provider, setProvider]     = useState(null)
  const [history, setHistory]       = useState([])      // [{role, content}]
  const [payload, setPayload]       = useState(null)    // remembered for follow-ups
  const [loading, setLoading]       = useState(false)
  const [chatLoading, setChatLoading] = useState(false)
  const [chatInput, setChatInput]   = useState('')
  const [error, setError]           = useState(null)

  const reset = () => {
    setHistory([]); setProvider(null); setPayload(null)
    setLoading(false); setChatLoading(false); setChatInput(''); setError(null)
  }

  const close = () => { setOpen(false); /* keep state so reopening shows last reply */ }

  // Pre-flight: cap by day to keep API spend bounded even with paid providers
  const overQuota = () => {
    const used = Number(localStorage.getItem(dayKey()) || 0)
    if (used >= DAILY_CAP) {
      setError(`Daily quota reached (${DAILY_CAP} / day) · try again tomorrow`)
      return true
    }
    return false
  }
  const bumpQuota = () => {
    const k = dayKey()
    localStorage.setItem(k, String(Number(localStorage.getItem(k) || 0) + 1))
  }

  // Run the initial analysis with a fresh payload. Resets prior conversation.
  const run = async (newPayload) => {
    reset()
    setOpen(true)
    setLoading(true)
    if (overQuota()) { setLoading(false); return }
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPayload),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const prov = r.headers.get('X-Provider')
      if (prov) setProvider(prov)
      setPayload(newPayload)
      setLoading(false)
      setHistory([{ role: 'assistant', content: '' }])
      await readStream(r, (_chunk, full) => {
        setHistory([{ role: 'assistant', content: full }])
      })
      bumpQuota()
    } catch (e) {
      setError(e?.message || 'failed')
      setLoading(false)
    }
  }

  // Ask a follow-up question that continues the conversation
  const ask = async () => {
    const question = chatInput.trim()
    if (!question || chatLoading || !payload) return
    setChatInput('')
    setError(null)
    const next = [...history, { role: 'user', content: question }]
    setHistory(next)
    setChatLoading(true)
    if (overQuota()) { setChatLoading(false); return }
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, history: next }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      const prov = r.headers.get('X-Provider')
      if (prov) setProvider(prov)
      setChatLoading(false)
      setHistory([...next, { role: 'assistant', content: '' }])
      await readStream(r, (_chunk, full) => {
        setHistory([...next, { role: 'assistant', content: full }])
      })
      bumpQuota()
    } catch (e) {
      setError(e?.message || 'failed')
      setHistory(h => h.filter(m => m !== next[next.length - 1]))   // drop optimistic user msg
      setChatLoading(false)
    }
  }

  // Retry the last analysis with the same payload (no re-fetch of fundamentals/TA)
  const retry = () => { if (payload) run(payload) }

  return {
    open, setOpen,
    provider, history, loading, chatLoading, chatInput, setChatInput, error,
    canChat: !!payload && !loading && history.length > 0,
    run, ask, close, reset, retry,
  }
}
