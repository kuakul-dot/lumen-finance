// Node.js runtime — higher body limit for PDF/image uploads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(200).end()
  }
  if (req.method !== 'POST') return res.status(405).end()

  const { data, mimeType, lang, ticker, name } = req.body || {}
  if (!data || !mimeType) return res.status(400).json({ error: 'missing_file' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'no_key' })

  const th = lang === 'th'
  const label = name && name !== ticker ? `${name} (${ticker})` : ticker

  const prompt = th
    ? `วิเคราะห์งบการเงินของ ${label} จากเอกสารนี้ แบ่งเป็น 3 หัวข้อ:

## รายได้และกำไร
รายได้รวม กำไรขั้นต้น (ถ้ามี) กำไรจากการดำเนินงาน กำไรสุทธิ EPS พร้อม trend หลายปีและ % growth

## สถานะทางการเงิน
สินทรัพย์รวม หนี้สิน ส่วนของผู้ถือหุ้น D/E ratio และสภาพคล่อง

## กระแสเงินสด
กระแสเงินสดจากการดำเนินงาน การลงทุน การจัดหาเงิน และ Free Cash Flow

ใช้ตัวเลขจากเอกสารจริงทุกตัว ระบุสกุลเงินและปีที่รายงาน วิเคราะห์กระชับ ไม่เกิน 450 คำ`
    : `Analyze the financial statements of ${label} from this document. Write 3 sections:

## Revenue & Profitability
Revenue, gross profit (if applicable), operating income, net income, EPS — multi-year figures with % growth trends

## Financial Position
Total assets, liabilities, equity, D/E ratio, liquidity position

## Cash Flow
Operating CF, investing, financing activities, and free cash flow

Use exact figures from the document. State the currency and fiscal years shown. Keep it concise, max 450 words.`

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'no-store')

  try {
    const isPdf = mimeType === 'application/pdf'
    const contentBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image',    source: { type: 'base64', media_type: mimeType, data } }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1400,
        stream: true,
        messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }],
      }),
    })

    if (!r.ok) {
      const errText = await r.text()
      return res.status(500).end(errText)
    }

    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') continue
        try {
          const ev = JSON.parse(payload)
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            res.write(ev.delta.text)
          }
        } catch {}
      }
    }

    res.end()
  } catch (e) {
    if (!res.headersSent) res.status(500).end(e.message)
    else res.end()
  }
}
