 /* פונקציית שרת: מתווכת בין האפליקציה ל-Anthropic API.
   המפתח נלקח ממשתנה הסביבה ANTHROPIC_API_KEY ולא מגיע לדפדפן. */

const SYSTEM_PROMPT =
  "אתה מנוע למידה. החזר אך ורק אובייקט JSON תקין ומלא. בלי טקסט מקדים, בלי הסברים, בלי backticks. הקפד לסגור את כל הסוגריים. אם הטקסט ארוך, קצר את התוכן כדי שהתשובה תסתיים בתוך מגבלת האורך.";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: { message: "Method not allowed" } }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: "ANTHROPIC_API_KEY לא מוגדר בהגדרות האתר ב-Netlify" } }),
    };
  }

  let prompt, maxTokens, img, imgType;
  try {
    const parsed = JSON.parse(event.body || "{}");
    prompt = parsed.prompt;
    maxTokens = parsed.maxTokens;
    img = parsed.img;         // שער התמונה: צילום דף כ-base64 (בלי קידומת data:)
    imgType = parsed.imgType; // image/jpeg | image/png | image/webp
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: { message: "Bad request body" } }) };
  }
  if (!prompt || typeof prompt !== "string" || prompt.length > 30000) {
    return { statusCode: 400, body: JSON.stringify({ error: { message: "Missing or invalid prompt" } }) };
  }
  if (img && (typeof img !== "string" || img.length > 5500000)) {
    return { statusCode: 400, body: JSON.stringify({ error: { message: "תמונה גדולה מדי — יש להקטין לפני שליחה" } }) };
  }
  const mt = Math.min(4000, Math.max(500, parseInt(maxTokens, 10) || 2000));
  // מודל מהיר (Haiku) להפקות מובנות — פי 3-4 מהיר, נגד timeout
  let fast;
  try { fast = JSON.parse(event.body || "{}").fast; } catch { fast = false; }
  const model = fast ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6";

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: mt,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: img
              ? [
                  { type: "image", source: { type: "base64", media_type: imgType || "image/jpeg", data: img } },
                  { type: "text", text: prompt },
                ]
              : prompt,
          },
        ],
      }),
    });
    const body = await res.text();
    return {
      statusCode: res.status,
      headers: { "Content-Type": "application/json" },
      body,
    };
  } catch (e) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: { message: "השרת לא הצליח לפנות ל-API: " + e.message } }),
    };
  }
};
