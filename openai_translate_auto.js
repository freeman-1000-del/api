// api/openai_translate_auto.js

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 허용됩니다." });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY 환경변수가 없습니다." });
  }

  const DEFAULT_COUNTRIES = [
    ["ko", "South Korea"],
    ["en-US", "United States"],
    ["en-GB", "United Kingdom"],
    ["es", "Spain"],
    ["fr", "France"],
    ["de", "Germany"],
    ["pt", "Portugal"],
    ["it", "Italy"],
    ["ja", "Japan"],
    ["zh-CN", "China (Simplified)"],
    ["zh-TW", "China (Traditional)"],
    ["ar", "Saudi Arabia"],
    ["hi", "India"],
    ["ru", "Russia"],
    ["nl", "Netherlands"],
    ["pl", "Poland"],
    ["tr", "Turkey"],
    ["sv", "Sweden"],
    ["da", "Denmark"],
    ["fi", "Finland"],
    ["cs", "Czech Republic"],
    ["ro", "Romania"],
    ["hu", "Hungary"],
    ["el", "Greece"],
    ["th", "Thailand"],
    ["id", "Indonesia"],
    ["ms", "Malaysia"],
    ["vi", "Vietnam"],
    ["uk", "Ukraine"],
    ["fa", "Iran"],
    ["af", "South Africa"],
    ["sq", "Albania"],
    ["am", "Ethiopia"],
    ["hy", "Armenia"],
    ["az", "Azerbaijan"],
    ["be", "Belarus"],
    ["bn", "Bangladesh"],
    ["bs", "Bosnia and Herzegovina"],
    ["bg", "Bulgaria"],
    ["hr", "Croatia"],
    ["et", "Estonia"],
    ["ka", "Georgia"],
    ["ht", "Haiti"],
    ["is", "Iceland"],
    ["ga", "Ireland"],
    ["kn", "India (Kannada)"],
    ["kk", "Kazakhstan"],
    ["km", "Cambodia"],
    ["rw", "Rwanda"],
    ["lv", "Latvia"],
    ["lt", "Lithuania"],
    ["mk", "North Macedonia"],
    ["ml", "India (Malayalam)"],
    ["mt", "Malta"],
    ["mr", "India (Marathi)"],
    ["mn", "Mongolia"],
    ["my", "Myanmar"],
    ["ne", "Nepal"],
    ["pa", "India (Punjabi)"],
    ["sr", "Serbia"],
    ["sk", "Slovakia"],
    ["sw", "Kenya"],
    ["tl", "Philippines"],
    ["ta", "India (Tamil)"],
    ["te", "India (Telugu)"],
    ["yo", "Nigeria"],
    ["zu", "South Africa (Zulu)"],
    ["ca", "Catalonia"],
    ["gl", "Galicia"]
  ];

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    const title = String(
      body.title ||
      body.sourceTitle ||
      body.originalTitle ||
      ""
    ).trim();

    const description = String(
      body.description ||
      body.desc ||
      body.sourceDescription ||
      body.originalDescription ||
      ""
    ).trim();

    const count = Number(body.count || body.activeCount || 70) || 70;

    // countries는 여러 형태를 허용
    let countries = [];

    if (Array.isArray(body.countries)) {
      countries = body.countries.map(normalizeCountryItem).filter(Boolean);
    } else if (Array.isArray(body.targets)) {
      countries = body.targets.map(normalizeCountryItem).filter(Boolean);
    } else if (Array.isArray(body.countryGuideList)) {
      countries = body.countryGuideList.map(normalizeCountryItem).filter(Boolean);
    }

    if (!countries.length) {
      countries = DEFAULT_COUNTRIES.slice(0, count).map(([code, country]) => ({
        code,
        country
      }));
    }

    if (!title) {
      return res.status(400).json({ error: "title 값이 없습니다." });
    }

    if (!description) {
      return res.status(400).json({ error: "description 값이 없습니다." });
    }

    if (!countries.length) {
      return res.status(400).json({ error: "countries 값이 없습니다." });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const developerPrompt = [
      "You are a professional YouTube localization assistant.",
      "Translate the given source title and description into each requested locale.",
      "Return valid JSON only.",
      "Keep the exact order of the requested targets.",
      "Preserve paragraph breaks in the description.",
      "Do not add notes, markdown, HTML, code fences, numbering, explanations, hashtags, or extra keywords.",
      "Each output item must keep the exact requested code and country.",
      "Stay faithful to the source meaning while making the language natural."
    ].join(" ");

    const payload = {
      source: {
        title,
        description
      },
      targets: countries
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "developer", content: developerPrompt },
          { role: "user", content: JSON.stringify(payload) }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "translation_payload",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      code: { type: "string" },
                      country: { type: "string" },
                      title: { type: "string" },
                      description: { type: "string" }
                    },
                    required: ["code", "country", "title", "description"]
                  }
                }
              },
              required: ["items"]
            }
          }
        }
      })
    });

    const raw = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          raw?.error?.message ||
          raw?.message ||
          `OpenAI 호출 실패 (${response.status})`
      });
    }

    const content = raw?.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(500).json({ error: "OpenAI 응답 content가 비어 있습니다." });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return res.status(500).json({
        error: "OpenAI 응답 JSON 파싱 실패",
        rawContent: content
      });
    }

    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    if (!items.length) {
      return res.status(500).json({ error: "번역 결과 items가 없습니다." });
    }

    const mapByCode = new Map();
    for (const item of items) {
      const code = String(item.code || "").trim();
      if (!code) continue;

      mapByCode.set(code.toLowerCase(), {
        code,
        country: String(item.country || "").trim(),
        title: String(item.title || "").trim(),
        description: String(item.description || "").replace(/\r/g, "").trim()
      });
    }

    const normalized = countries.map((target) => {
      const hit = mapByCode.get(target.code.toLowerCase()) || {};
      return {
        code: target.code,
        country: target.country,
        title: String(hit.title || "").trim(),
        description: String(hit.description || "").replace(/\r/g, "").trim()
      };
    });

    const finalText = normalized.map((item) => {
      return [
        `Country Code: ${item.code}`,
        `Country Name: ${item.country}`,
        `Title: ${item.title}`,
        `Description:`,
        item.description
      ].join("\n");
    }).join("\n\n");

    return res.status(200).json({
      ok: true,
      model,
      count: normalized.length,
      items: normalized,
      finalText
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "서버 함수 처리 중 오류가 발생했습니다."
    });
  }

  function normalizeCountryItem(item) {
    if (!item) return null;

    if (Array.isArray(item)) {
      const code = String(item[0] || "").trim();
      const country = String(item[1] || "").trim();
      if (!code) return null;
      return { code, country };
    }

    if (typeof item === "object") {
      const code = String(item.code || item.countryCode || "").trim();
      const country = String(item.country || item.countryName || item.name || "").trim();
      if (!code) return null;
      return { code, country };
    }

    return null;
  }
};