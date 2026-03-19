export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
const { title, description, keywords, languages } = body;
      if (!title || !languages || !languages.length) {
    return res.status(400).json({ error: 'title과 languages는 필수입니다.' });
  }

  const langList = languages.map(l => `${l.code}:${l.name}`).join(', ');

  const prompt = `You are a professional multilingual translator for YouTube content.
Translate the following content into these languages: ${langList}

Title: ${title}
${description ? `Description: ${description}` : ''}
${keywords ? `Keywords: ${keywords}` : ''}

Return ONLY valid JSON in this exact format, no explanation:
{
  "LANG_CODE": {
    "title": "translated title",
    "description": "translated description",
    "keywords": "translated keywords"
  }
}
Replace LANG_CODE with each language code. Include all ${languages.length} languages.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: 'anthropic_error', detail: err });
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || '';

    // JSON 파싱
    let parsed = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch(e) {
      return res.status(500).json({ error: 'json_parse_failed', raw });
    }

    // 성공/실패 분류
    const translations = {};
    const failed = [];
    for (const lang of languages) {
      if (parsed[lang.code]) {
        translations[lang.code] = parsed[lang.code];
      } else {
        failed.push(lang);
      }
    }

    return res.status(200).json({ translations, failed });

  } catch(e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      return res.status(408).json({ error: 'timeout', retryable: true });
    }
    return res.status(500).json({ error: e.message });
  }
}
