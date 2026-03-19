export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const { title, description, keywords, languages } = req.body;

    const translateOne = async (lang) => {
      const prompt = `Translate the following YouTube video title, description, and keywords into ${lang.name} (language code: ${lang.code}).

CRITICAL RULES:
1. Output MUST be entirely in ${lang.name}. Do NOT include any Korean characters whatsoever.
2. Return ONLY valid JSON: {"title": "...", "description": "...", "keywords": "..."}
3. Keep # symbol before each keyword.
4. No markdown, no code blocks, no explanation.

Title: ${title}
Description: ${description}
Keywords: ${keywords || ''}`;

      const call = async () => {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            messages: [{ role: 'user', content: prompt }]
          })
        });
        const data = await response.json();
        const text = data.content?.[0]?.text || '';
        const hasKorean = /[\uAC00-\uD7AF]/.test(text);
        if (hasKorean) return null;
        const clean = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        if (parsed.title && parsed.description) return parsed;
        return null;
      };

      // 1차 시도
      try {
        const result = await call();
        if (result) return { lang, result };
      } catch(e) {}

      // 1초 대기 후 재시도
      await new Promise(r => setTimeout(r, 1000));

      try {
        const result = await call();
        if (result) return { lang, result };
      } catch(e) {}

      return { lang, result: null };
    };

    // 70개 동시 병렬
    const responses = await Promise.all(languages.map(lang => translateOne(lang)));

    const results = {};
    const failed = [];
    responses.forEach(({ lang, result }) => {
      if (result) results[lang.code] = result;
      else failed.push({ code: lang.code, name: lang.name });
    });

    res.status(200).json({
      translations: results,
      failed,
      summary: {
        total: languages.length,
        success: Object.keys(results).length,
        failed: failed.length
      }
    });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
