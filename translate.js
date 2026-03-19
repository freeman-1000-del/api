const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const LANGUAGES_70 = [
  {code:'af',name:'Afrikaans'},{code:'sq',name:'Albanian'},{code:'ar',name:'Arabic'},
  {code:'hy',name:'Armenian'},{code:'az',name:'Azerbaijani'},{code:'bn',name:'Bengali'},
  {code:'bs',name:'Bosnian'},{code:'bg',name:'Bulgarian'},{code:'ca',name:'Catalan'},
  {code:'zh-Hans',name:'Chinese (Simplified)'},{code:'zh-Hant',name:'Chinese (Traditional)'},
  {code:'hr',name:'Croatian'},{code:'cs',name:'Czech'},{code:'da',name:'Danish'},
  {code:'nl',name:'Dutch'},{code:'et',name:'Estonian'},{code:'fi',name:'Finnish'},
  {code:'fr',name:'French'},{code:'ka',name:'Georgian'},{code:'de',name:'German'},
  {code:'el',name:'Greek'},{code:'gu',name:'Gujarati'},{code:'he',name:'Hebrew'},
  {code:'hi',name:'Hindi'},{code:'hu',name:'Hungarian'},{code:'is',name:'Icelandic'},
  {code:'id',name:'Indonesian'},{code:'it',name:'Italian'},{code:'ja',name:'Japanese'},
  {code:'kn',name:'Kannada'},{code:'kk',name:'Kazakh'},{code:'km',name:'Khmer'},
  {code:'lo',name:'Lao'},{code:'lv',name:'Latvian'},{code:'lt',name:'Lithuanian'},
  {code:'mk',name:'Macedonian'},{code:'ms',name:'Malay'},{code:'ml',name:'Malayalam'},
  {code:'mt',name:'Maltese'},{code:'mr',name:'Marathi'},{code:'mn',name:'Mongolian'},
  {code:'ne',name:'Nepali'},{code:'nb',name:'Norwegian'},{code:'fa',name:'Persian'},
  {code:'pl',name:'Polish'},{code:'pt',name:'Portuguese'},{code:'pa',name:'Punjabi'},
  {code:'ro',name:'Romanian'},{code:'ru',name:'Russian'},{code:'sr',name:'Serbian'},
  {code:'si',name:'Sinhala'},{code:'sk',name:'Slovak'},{code:'sl',name:'Slovenian'},
  {code:'es',name:'Spanish'},{code:'sw',name:'Swahili'},{code:'sv',name:'Swedish'},
  {code:'tl',name:'Tagalog'},{code:'ta',name:'Tamil'},{code:'te',name:'Telugu'},
  {code:'th',name:'Thai'},{code:'tr',name:'Turkish'},{code:'uk',name:'Ukrainian'},
  {code:'ur',name:'Urdu'},{code:'vi',name:'Vietnamese'},
];

const LANGUAGES_40 = LANGUAGES_70.slice(0, 40);
const LANGUAGES_5 = [
  {code:'ko',name:'Korean'},{code:'ja',name:'Japanese'},
  {code:'zh-Hans',name:'Chinese (Simplified)'},{code:'fr',name:'French'},{code:'de',name:'German'},
];

function hasKorean(text) {
  if (!text) return false;
  return /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/.test(text);
}

function isValidTranslation(t) {
  if (!t || !t.title) return false;
  if (hasKorean(t.title)) return false;
  if (hasKorean(t.description)) return false;
  if (hasKorean(t.keywords)) return false;
  return true;
}

function safeParseJSON(text) {
  const clean = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  return JSON.parse(clean);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { email, title, description, keywords } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  let langSet = LANGUAGES_5;
  let planName = 'free';

  if (email) {
    const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    if (user?.active) {
      if (user.plan === 'pro_monthly' || user.lifetime) { langSet = LANGUAGES_70; planName = 'pro'; }
      else if (user.plan === 'basic_monthly') { langSet = LANGUAGES_40; planName = 'basic'; }
    }
  }

  const startTime = Date.now();

  try {
    const chunkSize = 23;
    const chunks = [];
    for (let i = 0; i < langSet.length; i += chunkSize) {
      chunks.push(langSet.slice(i, i + chunkSize));
    }

    const results = {};
    const skipped = [];

    await Promise.all(chunks.map(async (chunk) => {
      const langList = chunk.map(l => `${l.name} (${l.code})`).join(', ');

      const prompt = `You are a professional YouTube content localizer. Translate the following YouTube video metadata into these languages: ${langList}

Source content:
TITLE: ${title}
DESCRIPTION: ${description || ''}
KEYWORDS: ${keywords || ''}

Rules:
- Preserve the meaning and emotional tone, not literal word-for-word translation
- Adapt to local culture and search behavior for each country
- Keep titles under 100 characters
- Make keywords match local search patterns
- For descriptions, maintain the same structure but localize naturally
- IMPORTANT: Return the translation fully in the target language. Never return Korean characters in any translation.

Return ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "translations": [
    {
      "code": "language_code",
      "title": "translated title",
      "description": "translated description",
      "keywords": "translated keywords"
    }
  ]
}`;

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = response.content[0].text.trim();
      const parsed = safeParseJSON(text);

      parsed.translations.forEach(t => {
        if (isValidTranslation(t)) {
          results[t.code] = t;
        } else {
          skipped.push({ code: t.code, reason: hasKorean(t.title || t.description || '') ? 'korean_detected' : 'empty_result' });
        }
      });
    }));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (email) {
      await supabase.from('usage_logs').insert({
        email,
        action: 'translate',
        languages_count: Object.keys(results).length,
        elapsed_seconds: parseFloat(elapsed)
      });
    }

    res.json({
      success: true,
      plan: planName,
      languages_count: Object.keys(results).length,
      elapsed_seconds: elapsed,
      translations: results,
      skipped_languages: skipped
    });

  } catch (err) {
    console.error('Translation error:', err);
    res.status(500).json({ error: err.message });
  }
};
