/* ─── השער: כניסה + מכסות ───
   כל פונקציית שרת שעולה כסף (Claude, תמלול) עוברת דרך כאן.
   1. כניסה: הבקשה חייבת לשאת Authorization: Bearer <טוקן Supabase של המשתמש>.
      הטוקן מאומת מול Supabase Auth — בלי משתמש מחובר אין שירות.
   2. מכסה: לכל משתמש מכסה יומית (יום ישראלי). השימוש נרשם בטבלה usage_log
      ב-Supabase דרך הטוקן של המשתמש עצמו (RLS: כל אחד רואה וכותב רק את שלו,
      ואינו יכול למחוק). לא נדרש מפתח שרת נוסף.
   3. מנהלים (ADMIN_EMAILS בנטליפיי, מופרדים בפסיק) — בלי מכסה.

   מכסות ברירת מחדל (ניתנות לשינוי במשתני סביבה בנטליפיי):
     DAILY_LIMIT_CLAUDE     = 60   קריאות ביום (סיכום, מבחן, כרטיסיות, OCR...)
     DAILY_LIMIT_TRANSCRIBE = 120  נתחי תמלול ביום (נתח ≈ 110 שניות → ~3.5 שעות)
     DAILY_LIMIT_VOICE      = 12   חתיכות קול של "שיקוף" ביום (חתיכה ≈ 3.5 דקות → ~40 דקות)
   הטבלה נמצאת ב-supabase/usage_log.sql. */

const SUPA_URL = process.env.SUPABASE_URL || "https://hghlesijwzpfdhmlvgiv.supabase.co";
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_JsWZApJRwuzZId7iUPwUkA_EGlZfNNe";

const LIMITS = {
  claude: parseInt(process.env.DAILY_LIMIT_CLAUDE, 10) || 60,
  transcribe: parseInt(process.env.DAILY_LIMIT_TRANSCRIBE, 10) || 120,
  voice: parseInt(process.env.DAILY_LIMIT_VOICE, 10) || 12, // חתיכות "שיקוף" ביום (חתיכה ≈ 3.5 דקות שמע)
};

const ADMINS = (process.env.ADMIN_EMAILS || "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

/* תחילת היום הנוכחי בישראל, כ-ISO ב-UTC (בשביל created_at >= ...) */
function israelDayStart() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).reduce((o, p) => (o[p.type] = p.value, o), {});
  // חצות בישראל = 21:00 UTC (קיץ) או 22:00 UTC (חורף). מחשבים דרך ההפרש בפועל.
  const localMidnight = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00`);
  const offsetMin = tzOffsetMinutes("Asia/Jerusalem", now);
  return new Date(localMidnight.getTime() - offsetMin * 60000).toISOString();
}
function tzOffsetMinutes(tz, date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date).reduce((o, p) => (o[p.type] = p.value, o), {});
  const asUTC = Date.UTC(f.year, f.month - 1, f.day, f.hour % 24, f.minute, f.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

async function supaFetch(path, token, opts = {}) {
  return fetch(SUPA_URL + path, {
    ...opts,
    headers: {
      apikey: SUPA_KEY,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
}

/* מאמת את הטוקן ומחזיר { id, email } או null */
async function verifyUser(token) {
  try {
    const r = await supaFetch("/auth/v1/user", token);
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? { id: u.id, email: (u.email || "").toLowerCase() } : null;
  } catch {
    return null;
  }
}

/* כמה יחידות ניצל המשתמש היום בפונקציה הזאת */
async function usedToday(token, userId, fn) {
  const since = encodeURIComponent(israelDayStart());
  const r = await supaFetch(
    `/rest/v1/usage_log?select=units&user_id=eq.${userId}&fn=eq.${fn}&created_at=gte.${since}`,
    token,
  );
  if (!r.ok) throw new Error("usage_log read failed (" + r.status + ")");
  const rows = await r.json();
  return rows.reduce((s, x) => s + (Number(x.units) || 0), 0);
}

async function logUsage(token, userId, fn, units) {
  const r = await supaFetch("/rest/v1/usage_log", token, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: userId, fn, units }),
  });
  if (!r.ok) throw new Error("usage_log write failed (" + r.status + ")");
}

/* השער עצמו. מחזיר { user } אם מותר להמשיך, או { reject } — תשובת HTTP לשלוח כפי שהיא.
   fn: "claude" | "transcribe" · units: כמה יחידות הבקשה הזאת שווה (ברירת מחדל 1) */
async function gate(event, fn, units = 1) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return { reject: json(401, { code: "login", error: { message: "כדי להשתמש בערוצי הלימוד יש להיכנס לחשבון — לחץ על ☁ למעלה" } }) };
  }
  const user = await verifyUser(token);
  if (!user) {
    return { reject: json(401, { code: "login", error: { message: "החיבור לחשבון פג — היכנס שוב דרך ☁" } }) };
  }
  if (ADMINS.includes(user.email)) return { user, admin: true };

  const limit = LIMITS[fn] || 60;
  try {
    const used = await usedToday(token, user.id, fn);
    if (used + units > limit) {
      return {
        reject: json(429, {
          code: "quota",
          used, limit,
          error: { message: `המכסה היומית נגמרה (${used} מתוך ${limit}). היא מתחדשת בחצות.` },
        }),
      };
    }
    await logUsage(token, user.id, fn, units);
  } catch (e) {
    /* טבלת השימוש לא זמינה (עדיין לא נוצרה?) — לא חוסמים משתמש מחובר,
       אבל רושמים ביומן כדי שזה ייראה ב-Netlify Functions log. */
    console.warn("[gate] quota skipped:", e.message);
  }
  return { user };
}

module.exports = { gate, json };
