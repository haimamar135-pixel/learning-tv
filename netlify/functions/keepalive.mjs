/* ─── keepalive — ש-Supabase לא יירדם ───
   פרויקט Supabase חינמי מושהה אחרי כשבוע בלי בקשות. זה מה שקרה ב-30.9:
   "Load failed" בכניסה לאתר, וצריך היה Resume project ידני.

   הפונקציה הזאת פונה ל-Supabase פעם ביום מנטליפיי — ולכן הפרויקט תמיד "בשימוש".
   נטליפיי מגיעה ל-Supabase (בניגוד לרשת של Claude), ולכן זה עובד מכאן.

   ── פונקציה מתוזמנת (Scheduled Function) ──
   נטליפיי מריצה אותה לפי config.schedule שבתחתית הקובץ, לא דרך HTTP.
   אין לה כתובת ציבורית ואי אפשר להפעיל אותה מהדפדפן — זה בכוונה.
   לאימות: נטליפיי ← Cloud compute ← Functions ← keepalive ← Function log.
   שורת לוג אחת ביום, בצורה: [keepalive] <תאריך> · auth-health=200 (120ms) · ...

   ── בלי מפתחות חדשים ──
   המפתח כאן הוא המפתח הציבורי (publishable) — אותו אחד שכבר נמצא
   ב-netlify/functions/lib/gate.cjs. אין צורך להוסיף שום משתנה סביבה.
   אם בעתיד יוגדרו SUPABASE_URL / SUPABASE_ANON_KEY בנטליפיי, הם יקבלו עדיפות. */

const SUPA_URL = process.env.SUPABASE_URL || "https://hghlesijwzpfdhmlvgiv.supabase.co";
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_JsWZApJRwuzZId7iUPwUkA_EGlZfNNe";

/* פונה לכתובת אחת ומחזיר שורת סיכום קצרה ללוג. גם 401 נחשב "שימוש" בפרויקט. */
const ping = async (name, url, headers) => {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    return `${name}=${res.status} (${Date.now() - t0}ms)`;
  } catch (e) {
    return `${name}=שגיאה: ${e.message}`;
  }
};

export default async () => {
  const results = [
    /* בדיקת בריאות — תמיד 200 כשהפרויקט ער, נכשל כשהוא מושהה */
    await ping("auth-health", `${SUPA_URL}/auth/v1/health`, { apikey: SUPA_KEY }),
    /* בקשת REST אמיתית — זו הפעילות שמונעת השהיה */
    await ping("rest-usage_log", `${SUPA_URL}/rest/v1/usage_log?select=id&limit=1`, {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
    }),
  ];
  console.log(`[keepalive] ${new Date().toISOString()} · ${results.join(" · ")}`);
  return new Response(null, { status: 204 });
};

export const config = { schedule: "@daily" };
