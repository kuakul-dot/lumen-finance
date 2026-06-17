// Vercel Edge Function — proxy to Google Translate unofficial API
// Avoids CORS; no API key required.
export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    })
  }

  const { searchParams } = new URL(req.url)
  const text = (searchParams.get('text') || '').trim()
  const tl   = searchParams.get('tl') || 'th'

  if (!text) {
    return new Response(JSON.stringify({ translated: '' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`translate ${r.status}`)
    const data = await r.json()
    // data[0] = array of [translatedChunk, originalChunk, ...]
    const translated = (data[0] || []).map(x => x?.[0] || '').join('')
    return new Response(JSON.stringify({ translated }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, translated: '' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
}
