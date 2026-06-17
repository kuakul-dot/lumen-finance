// Vercel Edge Function — AI news summary via Claude (haiku model)
// Requires ANTHROPIC_API_KEY set in Vercel project environment variables.
export const config = { runtime: 'edge' }

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
    })
  }

  const { searchParams } = new URL(req.url)
  const title = (searchParams.get('title') || '').trim()
  const desc  = (searchParams.get('desc')  || '').trim()

  if (!title) {
    return new Response(JSON.stringify({ summary: '' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ summary: '', error: 'no_key' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  const content = desc ? `${title}\n\n${desc}` : title

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 220,
        messages: [{
          role: 'user',
          content: `สรุปข่าวการเงินต่อไปนี้เป็นภาษาไทย 2-3 ประโยค กระชับ ตรงประเด็น ไม่ต้องขึ้นต้นด้วย "สรุป" หรือ "ข่าว":\n\n${content}`,
        }],
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!r.ok) throw new Error(`anthropic ${r.status}`)
    const data = await r.json()
    const summary = data.content?.[0]?.text?.trim() || ''

    return new Response(JSON.stringify({ summary }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200',
      },
    })
  } catch (e) {
    return new Response(JSON.stringify({ summary: '', error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
}
