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

  let prompt;
  try {
    prompt = JSON.parse(event.body || "{}").prompt;
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: { message: "Bad request body" } }) };
  }
  if (!prompt || typeof prompt !== "string" || prompt.length > 30000) {
    return { statusCode: 400, body: JSON.stringify({ error: { message: "Missing or invalid prompt" } }) };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
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
