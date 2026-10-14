   import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { Room, RoomEvent, Track } from "livekit-client";
import { createClient } from "@supabase/supabase-js";
import { App as CapApp } from "@capacitor/app";
import { tx, getLang, setLang, langDir, LANGS } from "./i18n.js";
import { STARTER } from "./starter.js";
import { searchFeatures, buildIndex, searchContent, indexStats, snippet as searchSnippet } from "./search.js";

/* ─── ענן (Supabase) — שלב 1: חשבון משתמש ───
   המפתח הזה ציבורי בכוונה (publishable); ההגנה היא Row Level Security
   בצד השרת — כל משתמש רואה אך ורק את הנתונים שלו. */
const SUPA_URL = "https://hghlesijwzpfdhmlvgiv.supabase.co";
const SUPA_KEY = "sb_publishable_JsWZApJRwuzZId7iUPwUkA_EGlZfNNe";
const supa = createClient(SUPA_URL, SUPA_KEY);

/* ─── ארון הספרים — הספרייה הפרטית (70 ספרי מקור) ───
   אתר נפרד, לקריאה בלבד, לשימוש עצמי. noindex.
   נפתח בלשונית חדשה; לא נוגע בספרים של הלומד. */
const SHELF_URL = "https://aquamarine-muffin-1c019d.netlify.app";

/* ─── מובייל (Capacitor) ───
   באתר, הפונקציות וה-proxy של הארון נקראים בכתובת יחסית (אותו מקור).
   בתוך אפליקציית iOS/Android העמוד נטען מקבצים מקומיים (capacitor://localhost),
   ולכן הקריאות צריכות כתובת מלאה של האתר החי. */
const SITE_URL = "https://famous-rolypoly-1ab096.netlify.app";
const IS_NATIVE = (() => {
  try {
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === "function") return window.Capacitor.isNativePlatform();
    return location.protocol === "capacitor:" || location.protocol === "ionic:";
  } catch { return false; }
})();
const API_BASE = IS_NATIVE ? SITE_URL : "";

/* ─── ענף ───
   השורש (האפליקציה כפי שהיא בחנות) בלי ספרייה מובנית: הלומד מביא את הטקסט שלו.
   ענף הקבלה — ארון 70 הספרים ושער הזוהר מספריא — נפתח רק באתר, בקישור ?branch=kabbalah,
   ונשמר בדפדפן. ?branch=root (או כל ערך אחר) סוגר אותו. באפליקציה המקורית (iOS) אין ענף כלל:
   מה שאפל בודקת הוא מה שהמשתמש מקבל — בלי יכולות נסתרות. */
const BRANCH = (() => {
  if (IS_NATIVE) return "";
  try {
    const q = new URLSearchParams(location.search).get("branch");
    if (q !== null) { if (q === "kabbalah") localStorage.setItem("lomedtv-branch", "kabbalah"); else localStorage.removeItem("lomedtv-branch"); }
    return localStorage.getItem("lomedtv-branch") || "";
  } catch { return ""; }
})();
const KABBALAH = BRANCH === "kabbalah";

/* ─── הגשר: מהארון אל הלימוד ───
   הארון הוא אתר נפרד בלי כותרות CORS, לכן הנתונים נקראים דרך /shelf-data —
   proxy של נטליפיי (netlify.toml) שמגיש את data/ של הארון מאותו מקור.
   בפיתוח מקומי (vite) אין proxy — יש נפילה לכתובת הישירה. */
const SHELF_DATA = "/shelf-data";
/* גבול לייבוא אחד. הספרים נשמרים ב-IndexedDB (אין גבול 5MB), אבל ספר ענק
   (הזוהר, הסולם, אור החמה) עדיין נכנס שער/חלק — גם בשביל הסנכרון לענן
   וגם כי ספר של 2,000 פרקים אינו יחידת לימוד. */
const SHELF_IMPORT_MAX = 400000;

async function shelfFetch(path) {
  try {
    const r = await fetch(API_BASE + SHELF_DATA + path, { cache: "force-cache" });
    if (r.ok) return await r.json();
    throw new Error("proxy " + r.status);
  } catch (e1) {
    try {
      const r = await fetch(SHELF_URL + "/data" + path);
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } catch (e2) {
      console.error("shelfFetch failed", path, e1, e2);
      throw new Error("הארון לא זמין כרגע — בדוק את החיבור ונסה שוב");
    }
  }
}

/* מספר → אותיות עבריות (1→א, 15→טו, 30→ל) — לתוויות פרקים */
function hebNum(n) {
  n = Number(n);
  if (!Number.isInteger(n) || n < 1 || n > 999) return String(n);
  const ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const hund = ["", "ק", "ר", "ש", "ת"];
  let s = "", h = Math.floor(n / 100), r = n % 100;
  while (h > 4) { s += "ת"; h -= 4; }
  s += hund[h];
  if (r === 15) s += "טו"; else if (r === 16) s += "טז";
  else s += tens[Math.floor(r / 10)] + ones[r % 10];
  return s;
}
function shelfComps(ref) {
  return String(ref || "").split(":").map((c) => c.trim()).filter(Boolean);
}
/* מפתח פרק = ההפניה בלי הרכיב האחרון (Bereshit:12:3 → Bereshit:12) */
function shelfChapterKey(ref) {
  const c = shelfComps(ref);
  return c.length > 1 ? c.slice(0, -1).join(":") : c[0] || "";
}
/* שער = הרכיב הראשון שאינו ריק (Bereshit) */
function shelfSectionKey(ref) {
  return shelfComps(ref)[0] || "";
}
function shelfLabel(key) {
  const c = shelfComps(key);
  if (!c.length) return "";
  const parts = c.map((x) => (/^\d+$/.test(x) ? hebNum(x) : x));
  if (c.length === 1 && /^\d+$/.test(c[0])) return "פרק " + parts[0];
  return parts.join(" · ");
}
function fmtChars(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + " מיליון תווים";
  if (n >= 1e3) return Math.round(n / 1e3) + " אלף תווים";
  return n + " תווים";
}
/* שערים רצופים בספר: [{key,label,from,to,chars}] */
function shelfSections(segs) {
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const k = shelfSectionKey(segs[i].ref);
    const last = out[out.length - 1];
    if (last && last.key === k) { last.to = i + 1; last.chars += segs[i].t.length; }
    else out.push({ key: k, label: shelfLabel(k) || "ללא שם", from: i, to: i + 1, chars: segs[i].t.length });
  }
  return out;
}
/* שער גדול מהגבול → חלקים לפי גבולות פרקים */
function shelfSplitSection(segs, sec, max) {
  if (sec.chars <= max) return [{ ...sec, part: 0 }];
  /* קודם פרקים שלמים (קבוצות הפניה), ואז אריזה — חלק לא נחתך באמצע פרק */
  const groups = [];
  for (let i = sec.from; i < sec.to; i++) {
    const k = shelfChapterKey(segs[i].ref);
    const last = groups[groups.length - 1];
    if (last && last.key === k) { last.to = i + 1; last.chars += segs[i].t.length; }
    else groups.push({ key: k, from: i, to: i + 1, chars: segs[i].t.length });
  }
  const parts = [];
  let cur = null;
  for (const g of groups) {
    if (cur && cur.chars + g.chars > max) { parts.push(cur); cur = null; }
    if (!cur) cur = { from: g.from, to: g.to, chars: g.chars };
    else { cur.to = g.to; cur.chars += g.chars; }
  }
  if (cur) parts.push(cur);
  return parts.map((p, n) => {
    const a = shelfComps(segs[p.from].ref), b = shelfComps(segs[p.to - 1].ref);
    const ra = a.length > 1 ? a[1] : "", rb = b.length > 1 ? b[1] : "";
    const range = ra && rb ? ` (${/^\d+$/.test(ra) ? hebNum(ra) : ra}–${/^\d+$/.test(rb) ? hebNum(rb) : rb})` : "";
    return { key: sec.key, label: `${sec.label} · חלק ${n + 1}/${parts.length}${range}`, from: p.from, to: p.to, chars: p.chars, part: n + 1 };
  });
}
/* קטעים → פרקים למסך הלמידה. פרק = קבוצת הפניה; פרק ארוך מדי מתפצל לחלקים. */
function shelfToChapters(segs, from, to) {
  const groups = [];
  for (let i = from; i < to; i++) {
    const k = shelfChapterKey(segs[i].ref);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.segs.push(segs[i].t);
    else groups.push({ key: k, segs: [segs[i].t] });
  }
  const chapters = [];
  for (const g of groups) {
    const label = shelfLabel(g.key) || `פרק ${chapters.length + 1}`;
    const pieces = [];
    for (const t of g.segs) {
      if (t.length > CHUNK_TARGET * 1.3) pieces.push(...hardSplit(t)); else pieces.push(t);
    }
    const chunks = [];
    let cur = "";
    for (const p of pieces) {
      if (cur && cur.length + p.length > CHAPTER_LIMIT) { chunks.push(cur); cur = p; }
      else cur = cur ? cur + "\n\n" + p : p;
    }
    if (cur) chunks.push(cur);
    chunks.forEach((text, n) => {
      const title = chunks.length > 1 ? `${label} · חלק ${n + 1}` : label;
      chapters.push({ title, text: title + "\n" + text });
    });
  }
  return chapters;
}

/* ─── מסך הלמידה · גרסת הספרייה ───
   חדש בגרסה זו:
   · שמירה מתמשכת (window.storage) — ספרים, תוצרים והתקדמות נשמרים בין ישיבות
   · ספריית ספרים — כל ספר הוא "עונה", הפרקים הם פרקי הסדרה
   · לוח שידורים — מסך התקדמות לכל ספר: סטטוס וציון לכל פרק
   · "בפרקים הקודמים" — תקציר הפרק הקודם לפני שממשיכים */
 
const CHANNELS = [
  { id: "read", num: "00", label: "טקסט הפרק" },
  { id: "summary", num: "01", label: "סיכום" },
  { id: "concepts", num: "02", label: "מושגים וכללים" },
  { id: "mindmap", num: "03", label: "מפת חשיבה" },
  { id: "flow", num: "04", label: "תרשים זרימה" },
  { id: "quiz", num: "05", label: "מבחן" },
  { id: "cards", num: "06", label: "כרטיסיות" },
  { id: "tts", num: "07", label: "הקראה" },
  { id: "trans", num: "09", label: "תרגום" },
];
 
/* פעולות במצב הגמיש (מגילה) — מופקות על הקטע שסומן */
/* 🎨 רקעים מסביב לטלוויזיה: [מזהה, שם, דוגמית] — הצבעים עצמם ב-CSS לפי data-bg */
const BG_THEMES = [
  ["night", "לילה (כחול כהה)", "linear-gradient(135deg,#141a33,#0d1226)"],
  ["silver", "כסף בהיר", "linear-gradient(135deg,#f4f5f8,#cfd3dc)"],
  ["cream", "קרם", "linear-gradient(135deg,#f8f3e6,#e6dcc6)"],
  ["sky", "תכלת", "linear-gradient(135deg,#eaf2fb,#c9d9ee)"],
  ["sage", "ירוק מרווה", "linear-gradient(135deg,#eef3ec,#cbd8cc)"],
  ["graphite", "גרפיט", "linear-gradient(135deg,#4a4f5c,#2b2f3a)"],
];
const FLEX_ACTIONS = [
  { id: "summary", label: "סיכום" },
  { id: "concepts", label: "מושגים" },
  { id: "mindmap", label: "מפת חשיבה" },
  { id: "flow", label: "תרשים" },
  { id: "quiz", label: "מבחן" },
  { id: "cards", label: "כרטיסיות" },
];
 
/* ─── השאלה שהלומד נושא נכנסת ללימוד ───
   השאלה מהפנים (lomedtv-question) לא נשארת פתק בלבד: סיכום (01) עונה לה בפסקה משלו,
   המבחן (05) מקדיש לה שאלה אחת, וההקראה (07) פותחת בה. הטקסט נשאר במרכז — השאלה
   היא הזווית שממנה הלומד ניגש אליו. הצעד השני של "השאלות הפתוחות שלי" (תנאי מקדים ל"שיקוף"). */
const qNote = (q) => (q ? `הלומד נושא איתו שאלה אישית: «${q}». ` : "");

const PROMPTS = {
  summary: (t, q = "") =>
    `קרא את הטקסט הבא והחזר JSON בלבד במבנה: {"short":"סיכום קצר של 2-3 משפטים","long":"סיכום מפורט של 2-3 פסקאות"${q ? `,"forQuestion":"פסקה אחת: מה הטקסט הזה נותן לשאלה שהלומד נושא — במה הוא נוגע בה, מאיר אותה או משאיר אותה פתוחה. אם הטקסט לא נוגע בשאלה כלל, כתוב זאת בכנות במשפט אחד"` : ""}}. ${qNote(q)}הטקסט:\n${t}`,
  concepts: (t) =>
    `קרא את הטקסט הבא והחזר JSON בלבד במבנה: {"concepts":[{"term":"מושג","definition":"הגדרה קצרה"}],"rules":["כלל או עיקרון מהטקסט"]}. הפק עד 8 מושגים ועד 6 כללים. הטקסט:\n${t}`,
  mindmap: (t) =>
    `קרא את הטקסט הבא והחזר JSON בלבד של מפת חשיבה במבנה: {"topic":"הנושא המרכזי","children":[{"label":"ענף ראשי","children":[{"label":"תת-ענף"}]}]}. עד 5 ענפים ראשיים, עד 4 תתי-ענפים לכל אחד. הטקסט:\n${t}`,
  flow: (t) =>
    `קרא את הטקסט הבא והחזר JSON בלבד של תרשים זרימה לוגי (תהליך, רצף רעיונות או השתלשלות) במבנה: {"title":"כותרת התהליך","steps":["שלב 1","שלב 2"]}. בין 4 ל-8 שלבים. הטקסט:\n${t}`,
  quiz: (t, n = 5, angle = "", q = "") =>
    `קרא את הטקסט הבא וכתוב מבחן. החזר JSON בלבד במבנה: {"questions":[{"q":"שאלה","options":["א","ב","ג","ד"],"correct":0,"explanation":"הסבר קצר לתשובה הנכונה"}]}. בדיוק ${n} שאלות, correct הוא אינדקס התשובה הנכונה. ${angle}${q ? `${qNote(q)}שאלה אחת מתוך ה-${n} תבדוק מה הטקסט אומר ביחס לשאלה הזאת — התשובה הנכונה חייבת להישען על הטקסט עצמו. ` : ""}הטקסט:\n${t}`,
  cards: (t) =>
    `קרא את הטקסט הבא וצור כרטיסיות זיכרון. החזר JSON בלבד במבנה: {"cards":[{"front":"שאלה או מושג","back":"תשובה או הגדרה"}]}. בין 6 ל-10 כרטיסיות. הטקסט:\n${t}`,
};
/* שלב 2 (צ'אט 26): הכלים עונים בשפת הטקסט. הפרומפטים כתובים בעברית; כשהטקסט אינו עברי
   מוסיפים בראשם הוראה לכתוב את כל התוכן בשפת הטקסט, בלי לגעת במבנה ה-JSON. */
const TEXT_LANG_NAMES = { en: "English", ar: "Arabic", fr: "French", es: "Spanish", ru: "Russian", de: "German" };
function langNote(t) {
  const n = TEXT_LANG_NAMES[textLang(t)];
  return n ? `IMPORTANT: the text below is written in ${n}. Write ALL the content of your answer (summaries, concepts, definitions, rules, labels, questions, answer options, explanations, cards) in ${n} — not in Hebrew — even though these instructions are in Hebrew. Keep the JSON structure and the key names exactly as specified.\n\n` : "";
}
for (const k of Object.keys(PROMPTS)) { const f = PROMPTS[k]; PROMPTS[k] = (t, ...rest) => langNote(t) + f(t, ...rest); }
 
/* ─── השער: כל קריאה שעולה כסף נושאת את הטוקן של המשתמש המחובר ───
   הפונקציות בנטליפיי (claude, transcribe) דוחות בקשה בלי טוקן (401) ובקשה
   מעבר למכסה היומית (429). כאן מצרפים את הטוקן ומתרגמים את הדחייה להודעה. */
const loginMsg = () => tx("כדי להשתמש בערוצי הלימוד יש להיכנס לחשבון — לחץ על ☁ למעלה");
/* שגיאת שער (כניסה/מכסה) מסומנת ב-gate — כך מזהים אותה בכל שפה, ולא לפי מילים בעברית */
const gateErr = (m) => Object.assign(new Error(m), { gate: true });
/* הסכמה חד-פעמית לשליחת תוכן לספקי עיבוד חיצוניים, ובהם שירותי AI (דרישת אפל 5.1.2(i)).
   נשאלת לפני הקריאה הראשונה לכלי שרת, ונשמרת במכשיר. בלי הסכמה — הכלים לא רצים; הקריאה והסימון עובדים כרגיל. */
function processingConsent() {
  try { if (localStorage.getItem("lomedtv-ai-consent") === "1") return true; } catch {}
  const ok = window.confirm(tx("כדי להפעיל את הכלים (סיכום, מבחן, תרגום, פענוח צילום, תמלול, הקראה ווידאו משותף), האפליקציה שולחת את התוכן שאתה מעבד — טקסט, צילום דף או הקלטה — לספקי עיבוד חיצוניים, ובהם שירותי בינה מלאכותית: Anthropic (Claude), Groq ו-ElevenLabs.\nהתוכן משמש רק לביצוע הבקשה שלך. הפרטים במדיניות הפרטיות.\n\nלהסכים ולהמשיך?"));
  if (ok) { try { localStorage.setItem("lomedtv-ai-consent", "1"); } catch {} }
  return ok;
}
async function authHeaders() {
  let token = null;
  try { token = (await supa.auth.getSession()).data?.session?.access_token || null; } catch {}
  if (!token) throw gateErr(loginMsg());
  if (!processingConsent()) throw new Error(tx("הכלי לא הופעל: לא ניתנה הסכמה לשליחת התוכן לעיבוד."));
  return { "Content-Type": "application/json", Authorization: "Bearer " + token };
}
const isGateError = (e) => !!e?.gate || /להיכנס לחשבון|פג|המכסה/.test(e?.message || "");
function gateError(res, data) {
  /* השרת עונה בעברית; בשפה אחרת מציגים את הנוסח המתורגם לפי סוג הדחייה */
  const sm = data?.error?.message || "";
  if (res.status === 401 || data?.code === "login") return gateErr(/פג/.test(sm) ? tx("החיבור לחשבון פג — היכנס שוב דרך ☁") : /כאורח/.test(sm) ? tx("כאורח אפשר ללמוד יחד בדף ובווידאו. לערוצי הלימוד (סיכום, מבחן, קול…) — להיכנס לחשבון במייל דרך ☁ למעלה") : loginMsg());
  if (res.status === 429 || data?.code === "quota") return gateErr(getLang() === "he" && sm ? sm : tx("המכסה היומית נגמרה — מתחדשת בחצות"));
  return null;
}

/* ─── קריאה ל-Claude דרך Netlify Function ───
   המפתח נשמר בצד השרת (משתנה סביבה ANTHROPIC_API_KEY) ולא נחשף לדפדפן. */
async function askClaude(prompt, maxTokens, fast, img, imgType, rawMode) {
  const headers = await authHeaders();
  let res;
  try {
    res = await fetch(API_BASE + "/.netlify/functions/claude", {
      method: "POST",
      headers,
      body: JSON.stringify(img ? { prompt, maxTokens, fast, img, imgType, raw: rawMode } : { prompt, maxTokens, fast, raw: rawMode }),
    });
  } catch (e) {
    console.log("Network error:", e);
    throw new Error(tx("בעיית רשת — הבקשה לא הגיעה לשרת"));
  }
 
  const raw = await res.text();
  console.log("API status:", res.status, raw.slice(0, 300));
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(tx("השרת החזיר תשובה לא תקינה [{s}]: ", { s: res.status }) + raw.slice(0, 160));
  }
 
  const ge = gateError(res, data);
  if (ge) throw ge;
  if (data.type === "error" || data.error) {
    throw new Error(tx("שגיאת API [{s}]: ", { s: res.status }) + (data.error?.message || ""));
  }
  if (data.errorMessage) {
    throw new Error(tx("שגיאת שרת [{s}]: ", { s: res.status }) + data.errorMessage);
  }
 
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
 
  if (!text.trim()) throw new Error(tx("התקבלה תשובה ריקה [{s}]: ", { s: res.status }) + raw.slice(0, 160));

  if (rawMode) return text.trim(); // מצב טקסט גולמי — בלי חילוץ JSON

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(tx("התשובה לא הכילה JSON"));
  }
  const slice = text.slice(start, end + 1).replace(/```json|```/g, "");
  try {
    return JSON.parse(slice);
  } catch {
    console.log("Raw model output:", text.slice(0, 500));
    throw new Error(tx("ה-JSON מהמודל פגום — ייתכן שהתשובה נחתכה באמצע"));
  }
}
 
/* ─── ▶ שער יוטיוב (צ'אט 25) ───
   האפליקציה אינה מורידה סרטונים (תנאי יוטיוב, הנחיה 5.2.3 של אפל). המשתמש מדביק את הקישור
   ואת התמליל שהעתיק מיוטיוב ("הצג תמליל"); התמליל מנוקה מחותמות זמן והופך לספר, והסרטון
   מתנגן לצד הטקסט בנגן הרשמי של יוטיוב. הקישור נשמר ב-book.flex.yt. */
function ytId(url) {
  const m = String(url || "").match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
/* ביוטיוב של היום כל שורה מועתקת כך: "10:0210 דקות, 2 שניותהטקסט" — חותמת הזמן, מיד אחריה
   תווית נגישות ("10 דקות, 54 שניות", "10 דקות, שתי שניות", "דקה אחת") ומיד אחריה הטקסט, בלי רווח. מסירים חותמת+תווית יחד. */
const YT_UNIT = "(?:שעות|שעה|דקות|דקה|שניות|שנייה|שניה|hours?|minutes?|seconds?|Stunden?|Minuten?|Sekunden?|heures?|secondes?|horas?|minutos?|segundos?|час(?:ов|а)?|минут[аы]?|секунд[аыу]?)";
const YT_PART = "(?:(?:\\d+|שתי|שני)\\s*" + YT_UNIT + "|" + YT_UNIT + "\\s+אחת|שעתיים)";
const YT_LABEL = YT_PART + "(?:\\s*,?\\s*(?:ו-?\\s*)?" + YT_PART + "){0,2}";
const YT_TS = "\\(?\\d{1,2}:\\d{2}(?::\\d{2})?\\)?";
const YT_TS_LABEL = new RegExp(YT_TS + "\\s*" + YT_LABEL, "gi");
const YT_LABEL_LINE = new RegExp("^" + YT_LABEL + "$", "i");
function cleanTranscript(raw) {
  const lines = String(raw || "").replace(YT_TS_LABEL, "\n").split(/\r?\n/)
    .map((l) => l.replace(/^\s*\(?\d{1,2}:\d{2}(?::\d{2})?\)?\s*/, "").trim())
    .filter((l) => l && !YT_LABEL_LINE.test(l));
  /* תמליל של יוטיוב מגיע בשורות קצרות: מאחדים לפסקאות של כ-600 תווים, ושוברים בסוף משפט כשיש */
  const paras = []; let cur = "";
  for (const l of lines) {
    cur = cur ? cur + " " + l : l;
    if (cur.length >= 600 && /[.!?׃。]["'״׳)]*$/.test(l) || cur.length >= 900) { paras.push(cur); cur = ""; }
  }
  if (cur) paras.push(cur);
  return paras.join("\n\n");
}
function YouTubeBox({ yt }) {
  const [open, setOpen] = useState(false);
  if (!yt || !yt.id) return null;
  return (
    <div className="yt-box">
      <button className="mark-btn yt-toggle" onClick={() => setOpen((v) => !v)}>{open ? tx("▾ הסתר את הסרטון") : tx("▶ הצג את הסרטון")}</button>
      {open && <div className="yt-frame"><iframe src={"https://www.youtube-nocookie.com/embed/" + yt.id + "?playsinline=1&rel=0"} title="YouTube" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen /></div>}
    </div>
  );
}

/* ─── 🌐 ערוץ התרגום (09, צ'אט 25) — הדף הדו-לשוני ───
   הפרק מתורגם משפט מול משפט: משפט 7 במקור הוא משפט 7 בתרגום. זה הבסיס ללימוד משותף
   בין שתי שפות (מרקר על משפט עובר לפי המספר שלו). התוצר נשמר כמו כל ערוץ, במפתח
   "פרק:trans:שפה" — תרגום לכל שפת יעד בנפרד. המקור נשאר לצד התרגום: הוא הקובע. */
const PAY_MODES = ["host", "each", "guest"];
const savedPay = () => { try { const v = localStorage.getItem("lomedtv-share-pay"); return PAY_MODES.includes(v) ? v : "host"; } catch { return "host"; } };
const LANG_EN_NAME = { he: "Hebrew", en: "English", ar: "Arabic", fr: "French", es: "Spanish", ru: "Russian", de: "German" };
const LANG_SCRIPT = { he: "he", ar: "ar", ru: "cy" };
function scriptOf(t) {
  const s = (t || "").slice(0, 1500);
  const n = { he: (s.match(/[\u05d0-\u05ea]/g) || []).length, ar: (s.match(/[\u0620-\u064a]/g) || []).length, cy: (s.match(/[\u0400-\u04ff]/g) || []).length, lat: (s.match(/[A-Za-z]/g) || []).length };
  return Object.keys(n).sort((a, b) => n[b] - n[a])[0];
}
/* שפת הטקסט: לפי הכתב, ובאותיות לטיניות — לפי מילים שכיחות (אנגלית / צרפתית / ספרדית / גרמנית) */
const LATIN_WORDS = { en: ["the", "and", "of", "is", "to", "in", "that", "with"], fr: ["le", "la", "les", "des", "et", "est", "une", "dans"], es: ["el", "los", "las", "que", "es", "una", "del", "por"], de: ["der", "die", "das", "und", "ist", "nicht", "ein", "mit"] };
function textLang(text) {
  const sc = scriptOf(text);
  if (sc === "he" || sc === "ar") return sc;
  if (sc === "cy") return "ru";
  const words = ((text || "").toLowerCase().match(/[a-zà-ÿß]+/g) || []).slice(0, 500);
  let best = "en", top = -1;
  for (const l of Object.keys(LATIN_WORDS)) { const n = words.filter((w) => LATIN_WORDS[l].includes(w)).length; if (n > top) { top = n; best = l; } }
  return best;
}
/* שפת היעד כברירת מחדל: שפת הממשק — אלא אם הטקסט כבר כתוב בה; אז עברית↔אנגלית */
function defaultTransLang(text) {
  const tl = textLang(text), ui = getLang();
  if (ui !== tl) return ui;
  return tl === "he" ? "en" : "he";
}
/* אותה חלוקה למשפטים כמו bookSentences — לפרק אחד */
function chapterSentences(text) {
  const sentences = [], paras = [];
  for (const p of (text || "").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)) {
    const parts = p.match(/[^.!?׃]+[.!?׃]+["'״׳)\]]*\s*|[^.!?׃]+$/g) || [p];
    const start = sentences.length;
    for (const x of parts) { const t = x.trim(); if (t) sentences.push(t); }
    if (sentences.length > start) paras.push([start, sentences.length - start]);
  }
  return { sentences, paras };
}
async function translateSentences(list, lang) {
  const out = [];
  let i = 0;
  while (i < list.length) {
    let j = i, chars = 0;
    while (j < list.length && (j === i || chars + list[j].length <= 1800) && j - i < 30) { chars += list[j].length; j++; }
    const batch = list.slice(i, j);
    const prompt = `Translate each numbered sentence below into ${LANG_EN_NAME[lang] || lang}. Return JSON only, in the form {"t":["...","..."]} with exactly ${batch.length} strings, in the same order: one translation per numbered sentence. Never merge, split, skip or reorder sentences. Keep names, numbers and bibliographic references as they are. Translate faithfully, without adding explanations.\n\n` + batch.map((x, k) => `${k + 1}. ${x}`).join("\n");
    const r = await askClaude(prompt, 4000, false);
    if (!r || !Array.isArray(r.t) || r.t.length !== batch.length) throw new Error(tx("התרגום חזר לא שלם — נסה שוב."));
    out.push(...r.t.map((x) => String(x)));
    i = j;
  }
  return out;
}
function TransView({ text, data, lang, onLang }) {
  const { sentences, paras } = chapterSentences(text);
  const sc = scriptOf(text);
  const srcDir = sc === "he" || sc === "ar" ? "rtl" : "ltr";
  const dstDir = lang === "he" || lang === "ar" ? "rtl" : "ltr";
  const t = (data && data.t) || [];
  return (
    <div className="tl">
      <div className="tl-head">
        <span className="tl-to">{tx("תרגום ל:")}</span>
        {LANGS.map(([id, name]) => <button key={id} className={"mark-btn" + (id === lang ? " on" : "")} onClick={() => onLang(id)}>{name}</button>)}
      </div>
      {paras.map(([start, count]) => (
        <div className="tl-para" key={start}>
          {Array.from({ length: count }, (_, k) => start + k).map((i) => (
            <div className="tl-row" key={i} data-si={i}>
              <p className="tl-src" dir={srcDir}>{sentences[i]}</p>
              <p className="tl-dst" dir={dstDir} lang={lang}>{t[i] || "…"}</p>
            </div>
          ))}
        </div>
      ))}
      <p className="tl-foot">{tx("התרגום נוצר במכונה ונשמר עם הספר. המקור הוא הקובע.")}</p>
    </div>
  );
}

/* ─── חלוקה לפרקים ─── */
const CHAPTER_LIMIT = 4500;
const CHUNK_TARGET = 3500;
 
function hardSplit(text) {
  const out = [];
  let rest = text;
  while (rest.length > CHUNK_TARGET) {
    let cut = rest.lastIndexOf(".", CHUNK_TARGET);
    if (cut < CHUNK_TARGET * 0.4) cut = rest.lastIndexOf(" ", CHUNK_TARGET);
    if (cut < 1) cut = CHUNK_TARGET;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}
 
function splitToChapters(raw) {
  const clean = raw.trim();
  const explicit = clean
    .split(/\n\s*(?:={3,}|\*{3,}|_{3,})\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
 
  let chunks;
  if (explicit.length > 1) {
    chunks = explicit;
  } else if (clean.length <= CHAPTER_LIMIT || /^(הסולם|פירוש):/m.test(clean)) {
    chunks = [clean]; // מאמר זוהר עם סולם / דף מפורש נשאר שלם — לא נחתך לפי אורך
  } else {
    const paras = clean.split(/\n{2,}/);
    chunks = [];
    let cur = "";
    for (const p of paras) {
      const piece = p.trim();
      if (!piece) continue;
      if (piece.length > CHUNK_TARGET) {
        if (cur) { chunks.push(cur); cur = ""; }
        chunks.push(...hardSplit(piece));
      } else if (cur && cur.length + piece.length > CHUNK_TARGET) {
        chunks.push(cur);
        cur = piece;
      } else {
        cur = cur ? cur + "\n\n" + piece : piece;
      }
    }
    if (cur) chunks.push(cur);
  }
 
  return chunks.map((text, i) => {
    const firstLine = text.split("\n")[0].trim();
    const looksLikeHeading =
      firstLine.length >= 2 &&
      firstLine.length <= 40 &&
      !/[.:,]$/.test(firstLine) &&
      text.length > firstLine.length + 40;
    return { title: looksLikeHeading ? firstLine : `פרק ${i + 1}`, text };
  });
}
 
/* ─── אחסון מתמשך (IndexedDB) ───
   נשמר במכשיר/דפדפן הנוכחי. עד צ'אט 8 הספרים ישבו ב-localStorage (גבול ~5MB לכל
   הספרייה — שביר באייפון ובאפליקציה). עכשיו: IndexedDB, אחסון גדול ויציב.
   בהפעלה הראשונה הספרים הקיימים עוברים מ-localStorage אוטומטית (ולא נמחקים משם —
   ביטוח). לסנכרון בין מכשירים — Supabase. */
const IDB_NAME = "lomedtv";
const IDB_STORE = "kv";
let idbPromise = null;
function idbOpen() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
  return idbPromise;
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const rq = tx.objectStore(IDB_STORE).get(key);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbKeys() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const rq = tx.objectStore(IDB_STORE).getAllKeys();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => reject(rq.error);
  });
}
/* 📤 הקלטת השיעור עצמה (לא רק התמלול) — נשמרת במכשיר בלבד, לצד הספר שנוצר ממנה.
   "pending" = הקלטה שעוד לא הפכה לספר (נשמרת מיד בעצירה, כדי ששיעור לא יאבד אם התמלול נכשל). */
const REC_PREFIX = "ltv-rec-";
const REC_PENDING = "pending";
const recKey = (id) => REC_PREFIX + id;
const recExt = (mime) => { const m = String(mime || "").toLowerCase(); return /mp4|m4a|aac/.test(m) ? "m4a" : /mpeg|mp3/.test(m) ? "mp3" : /ogg/.test(m) ? "ogg" : /wav/.test(m) ? "wav" : "webm"; };
const recClock = (sec) => { const s = Math.max(0, Math.round(sec || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const recFileName = (title, mime) => (String(title || "").replace(/[\\/:*?"<>|\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "lesson") + "." + recExt(mime);
/* המלל של ספר כקובץ טקסט פשוט (UTF-8 עם BOM — כדי שהעברית תיפתח נכון בכל תוכנה) */
const bookAsText = (b) => {
  const chs = (b?.chapters || []).filter((c) => c && (c.text || "").trim());
  const many = chs.length > 1;
  return "\uFEFF" + (b?.title || "") + "\n\n" + chs.map((c) => (many && c.title ? c.title + "\n\n" : "") + String(c.text || "").trim()).join("\n\n\n") + "\n";
};
/* ZIP מינימלי בלי דחיסה (שמע כבר דחוס) — כדי שבמחשב ההקלטה והמלל ירדו כקובץ אחד */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const d = new Date(), dd = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(), dt = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  for (const f of files) {
    const data = new Uint8Array(await f.arrayBuffer()), name = enc.encode(f.name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(c.buffer, name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((n, p) => n + p.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: "application/zip" });
}
/* 📌 על המסך / בארכיון: ספר נשאר בספרייה אלא אם הוסר ממנה (book.flex.pin === false).
   הסימון נשמר ב-flex ולכן מסתנכרן לענן — אותו מסך במק ובטלפון. הארכיון הוא רק תצוגה; שום דבר לא נמחק. */
const isPinned = (b) => !(b && b.flex && b.flex.pin === false);
/* הגירה חד-פעמית מ-localStorage. רצה פעם אחת לפני הטעינה הראשונה. */
let migratedPromise = null;
function migrateFromLocalStorage() {
  if (migratedPromise) return migratedPromise;
  migratedPromise = (async () => {
    try {
      const idxRaw = localStorage.getItem("ltv-books-index");
      if (idxRaw) {
        const existing = await idbGet("ltv-books-index");
        /* רק אם ב-IndexedDB אין עדיין אינדקס בכלל (גם רשימה ריקה נחשבת "יש") */
        if (existing === undefined) {
          const idx = JSON.parse(idxRaw);
          for (const e of idx) {
            const raw = localStorage.getItem("ltv-book-" + e.id);
            if (raw) await idbSet("ltv-book-" + e.id, JSON.parse(raw));
          }
          await idbSet("ltv-books-index", idx);
          console.log("migrated", idx.length, "books to IndexedDB");
        }
      }
    } catch (e) {
      console.error("migration failed", e);
    }
  })();
  return migratedPromise;
}
async function loadIndex() {
  try {
    await migrateFromLocalStorage();
    const v = await idbGet("ltv-books-index");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    console.error("loadIndex failed", e);
    return [];
  }
}
async function saveIndex(idx) {
  try {
    await idbSet("ltv-books-index", idx);
  } catch (e) {
    console.error("saveIndex failed", e);
  }
}
async function loadBook(id) {
  try {
    await migrateFromLocalStorage();
    const v = await idbGet("ltv-book-" + id);
    return v || null;
  } catch (e) {
    console.error("loadBook failed", e);
    return null;
  }
}
async function saveBookToStorage(book) {
  try {
    await idbSet("ltv-book-" + book.id, book);
  } catch (e) {
    console.error("saveBook failed", e);
  }
}
/* ספר הפתיחה: נכנס לספרייה פעם אחת לכל שפה (עברית / אנגלית לשאר). מי שמחק אותו — לא יקבל אותו שוב.
   המזהה קבוע (starter-he / starter-en), כך שאותו משתמש בשני מכשירים לא מקבל שני עותקים בענן. */
const starterBook = (id) => { const s = Object.values(STARTER).find((x) => x.id === id); return s ? { id: s.id, title: s.title, chapters: s.chapters, results: {}, progress: {} } : null; };
async function seedStarter(idx) {
  const s = STARTER[getLang() === "he" ? "he" : "en"];
  const flag = "lomedtv-starter-" + s.id;
  try { if (localStorage.getItem(flag) === "removed") return idx; } catch {}
  /* ברשימה אבל חסר באחסון (שמירה שנכשלה) — משלימים בשקט */
  if (idx.some((b) => b.id === s.id)) { if (!(await loadBook(s.id))) await saveBookToStorage(starterBook(s.id)); return idx; }
  const nb = starterBook(s.id);
  await saveBookToStorage(nb);
  const next = [{ id: nb.id, title: nb.title, chapters: nb.chapters.length, done: 0, talk: 0, updatedAt: Date.now() }, ...idx];
  await saveIndex(next);
  return next;
}
async function deleteBookFromStorage(id) {
  try {
    await idbDel("ltv-book-" + id);
  } catch (e) {
    console.error("deleteBook failed", e);
  }
}

/* ─── שלב 3: חותמות סנכרון ───
   לכל ספר נשמרת החותמת (updated_at) של הפעם האחרונה שהמכשיר *הזה* כתב לענן.
   אם החותמת שבענן שונה ממנה — סימן שמכשיר אחר עדכן, ויש מה למשוך. */
function syncStamps() {
  try {
    return JSON.parse(localStorage.getItem("ltv-cloud-stamps") || "{}");
  } catch {
    return {};
  }
}
function setSyncStamp(bookId, iso) {
  try {
    const m = syncStamps();
    m[bookId] = iso;
    localStorage.setItem("ltv-cloud-stamps", JSON.stringify(m));
  } catch {}
}
function clearSyncStamp(bookId) {
  try {
    const m = syncStamps();
    delete m[bookId];
    localStorage.setItem("ltv-cloud-stamps", JSON.stringify(m));
  } catch {}
}

/* ─── גיבוי ושחזור (שלב 0 לפני Supabase) ───
   ⬇ מוריד קובץ JSON עם כל הספרים, ההערות, המרקרים והציונים.
   ⬆ משחזר מקובץ כזה. ביטוח לטביעת היד של הלומד. */
async function downloadBackup() {
  try {
    const data = {};
    /* הספרים — מ-IndexedDB (נשמרים כמחרוזות JSON, כמו בגיבויים הישנים — תאימות מלאה) */
    const idx = await loadIndex();
    data["ltv-books-index"] = JSON.stringify(idx);
    for (const e of idx) {
      const b = await loadBook(e.id);
      if (b) data["ltv-book-" + e.id] = JSON.stringify(b);
    }
    /* הגדרות קטנות שנשארו ב-localStorage */
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      /* חותמות הסנכרון שייכות למכשיר הזה בלבד — לא נכנסות לגיבוי,
         כדי ששחזור במכשיר אחר לא ישתיק שם הצעת הורדה לגיטימית מהענן. */
      if (k === "ltv-cloud-stamps") continue;
      if (k && k.startsWith("ltv-book")) continue;
      if (k && (k.startsWith("ltv-") || k.startsWith("lomedtv-"))) data[k] = localStorage.getItem(k);
    }
    const payload = { app: "LOMED-TV", version: 1, savedAt: new Date().toISOString(), data };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    a.href = url;
    a.download = `lomedtv-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch (e) {
    alert("הגיבוי נכשל: " + e.message);
  }
}
function restoreBackupFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const payload = JSON.parse(reader.result);
      if (!payload || payload.app !== "LOMED-TV" || !payload.data) {
        alert("זה לא קובץ גיבוי של מסך הלמידה.");
        return;
      }
      const keys = Object.keys(payload.data);
      const nBooks = keys.filter((k) => k.startsWith("ltv-book-")).length;
      const when = payload.savedAt ? new Date(payload.savedAt).toLocaleString(getLang()) : "";
      if (!window.confirm("לשחזר גיבוי מ-" + when + "?\nהקובץ מכיל " + nBooks + " ספרים.\nנתונים קיימים באותם שמות יוחלפו.")) return;
      const restoredIdx = [];
      for (const k of keys) {
        const v = payload.data[k];
        if (k === "ltv-books-index") { continue; }
        if (k.startsWith("ltv-book-")) {
          const b = typeof v === "string" ? JSON.parse(v) : v;
          await saveBookToStorage(b);
          restoredIdx.push({ id: b.id, title: b.title, chapters: (b.chapters || []).length, done: 0, updatedAt: Date.now() });
        } else {
          localStorage.setItem(k, v);
        }
      }
      /* האינדקס: מהגיבוי אם יש, אחרת נבנה מהספרים ששוחזרו; ספרים קיימים שלא בגיבוי נשארים */
      let idx = [];
      try { idx = payload.data["ltv-books-index"] ? JSON.parse(payload.data["ltv-books-index"]) : restoredIdx; } catch { idx = restoredIdx; }
      const cur = await loadIndex();
      const ids = new Set(idx.map((e) => e.id));
      await saveIndex([...idx, ...cur.filter((e) => !ids.has(e.id))]);
      alert("השחזור הושלם! המסך ייטען מחדש.");
      location.reload();
    } catch (e) {
      alert("השחזור נכשל: " + e.message);
    }
  };
  reader.readAsText(file);
}
function pickRestoreFile() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".json,application/json";
  inp.onchange = () => {
    if (inp.files && inp.files[0]) restoreBackupFile(inp.files[0]);
  };
  inp.click();
}
 
/* ─── קריאת קבצים: PDF ו-DOCX ───
   הכול רץ בדפדפן — הקובץ לא נשלח לשום שרת. */
 
// טעינת סקריפט חיצוני פעם אחת (pdf.js / mammoth מ-CDN)
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}
 
const PDFJS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAMMOTH_SRC = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
const TESS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.5/tesseract.min.js";
 
/* OCR עברית לצילומים — רץ במחשב של המשתמש, הצילומים לא נשלחים לשום מקום */
async function ocrImages(files, onProgress) {
  await loadScript(TESS_SRC);
  const T = window.Tesseract;
  if (!T) throw new Error("ספריית ה-OCR לא נטענה. ודא חיבור לאינטרנט ונסה שוב.");
  const worker = await T.createWorker("heb");
  let out = "";
  try {
    for (let i = 0; i < files.length; i++) {
      onProgress?.(i + 1, files.length);
      const { data } = await worker.recognize(files[i]);
      const t = (data?.text || "").trim();
      if (t) out += t + "\n\n";
    }
  } finally {
    await worker.terminate();
  }
  const clean = out.trim();
  if (clean.replace(/\s/g, "").length < 30) {
    throw new Error("לא זוהה טקסט קריא בצילומים. נסה צילום חד יותר, ישר ומואר.");
  }
  return clean;
}
 
/* ── צלם דף חכם: הצילום נשלח למנוע ה-AI שמבין את מבנה הדף ──
   הצילום מוקטן במחשב של המשתמש לפני השליחה (חיסכון + פרטיות יחסית). */
async function loadImageEl(file) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("לא ניתן לקרוא את הצילום (" + file.name + "). נסה JPG/PNG."));
      im.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
/* crop: [y0,y1] כשברי גובה (0–1) — לפיצול עמוד לחצאים נגד timeout */
function imgToJpegBase64(img, maxSide = 1400, crop) {
  const [y0, y1] = crop || [0, 1];
  const sy = Math.round(img.height * y0);
  const sh = Math.round(img.height * (y1 - y0));
  const scale = Math.min(1, maxSide / Math.max(img.width, sh));
  const w = Math.round(img.width * scale), h = Math.round(sh * scale);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  cv.getContext("2d").drawImage(img, 0, sy, img.width, sh, 0, 0, w, h);
  return cv.toDataURL("image/jpeg", 0.85).split(",")[1];
}

const SCAN_MODES = {
  asis: {
    label: "דף רגיל — טקסט רציף (מהיר)",
    prompt:
      "לפניך צילום עמוד מספר קודש. תמלל את העמוד בנאמנות מלאה, בסדר הקריאה הנכון (ימין לשמאל, טור אחר טור, מקור לפני פירוש). אל תשמיט דבר מלבד כותרות עמוד רצות ומספרי עמוד. תקן רק שברי מילים ברורים שנוצרו מהצילום.",
  },
  merged: {
    label: "משולב — מקור ומתחתיו פירושו",
    prompt:
      "לפניך צילום עמוד מספר קודש (זוהר / תיקונים / דף מפורש). בעמוד יש בדרך כלל שתי שכבות: גוף המקור בארמית (עם אותיות סימון כמו א) ב) או קפח)), ופירוש/תרגום עברי (כגון 'הסולם' או 'תרגום'). הרכב את העמוד מחדש כך: כל פסקת מקור ארמית — ומיד אחריה, בשורה שמתחילה ב'פירוש: ', הפירוש העברי המלא שלה מהעמוד, מילה במילה. חובה להעתיק את שתי השכבות במלואן — אל תדלג על טור הפירוש ואל תקצר אותו. שמור על סימוני הפסקאות. דלג רק על כותרות עמוד, מספרי עמוד ומראי-מקומות שוליים (מסורת הזוהר, חילופי גרסאות). העתק בנאמנות מוחלטת: אם מילה אינה קריאה בבירור — כתוב אותה כפי שהיא נראית, ואל תוסיף אף מילה שאינה כתובה בעמוד.",
  },
  layers: {
    label: "שכבות נפרדות — מקור / פירוש",
    prompt:
      "לפניך צילום עמוד מספר קודש. חלץ את העמוד בשכבות נפרדות, מופרדות בשורה של === בדיוק: שכבה ראשונה — גוף המקור (הארמית) ברצף, לפי סדר הפסקאות. === שכבה שנייה — הפירוש/התרגום העברי במלואו. אם יש שכבת הערות (מסורת הזוהר וכד') — === ואחריה ההערות. שמור על סימוני הפסקאות. תקן שברי מילים לפי ההקשר בלבד.",
  },
  /* צ'אט 27: מאמר זוהר מכמה צילומים — כל עמוד נקרא בשכבות מתויגות, והקוד (לא המנוע) מרכיב: אות ← ארמית ← הפירוש שלה */
  zohar: {
    label: "דף זוהר עם פירוש — מדויק ואיטי (כמה עמודים יחד)",
    assemble: true,
    strong: true, // המודל המהיר ניחש מילים בארמית מנוקדת ובאותיות הקטנות של הפירוש — כאן קורא המודל החזק, בקטעים קטנים
    prompt:
      "לפניך צילום של חלק מעמוד זוהר עם פירוש. מבנה העמוד: למעלה גוף הזוהר בארמית מנוקדת, באותיות גדולות, מחולק לאותיות מסומנות — א) ב) ג) וכן הלאה. מתחתיו לפעמים הערות קטנות ('מסורת הזהר', 'חלופי גרסאות'). למטה הפירוש העברי ('הסולם' או 'מעלות הסולם') בשני טורים: קוראים קודם את הטור הימני כולו, ואחריו את השמאלי. תמלל מילה במילה — בלי להוסיף, בלי לקצר ובלי לתקן — במבנה הזה בדיוק:\n[מקור]\nגוף הזוהר בארמית, עם הניקוד. כל אות (למשל 'ג)') פותחת שורה חדשה, והטקסט שלה נכתב ברצף בשורה אחת. טקסט ארמי שמופיע לפני סימון האות הראשון הוא המשך של אות קודמת — כתוב אותו בשורה הראשונה, בלי סימון.\n[פירוש ימין]\nהטור הימני של הפירוש, מלמעלה למטה. כל פסקה בשורה אחת רצופה, בלי שבירות שורה בתוכה. פסקה שנפתחת בסימון אות (למשל 'ג) וההוא טהירו וכו'':') — הסימון נשאר בראש השורה.\n[פירוש שמאל]\nהטור השמאלי של הפירוש, באותו אופן.\nשכבה שאינה נראית בתמונה — השמט את הכותרת שלה. אם הפירוש בטור אחד — כתוב אותו תחת [פירוש ימין]. דלג על: כותרת העמוד ומספר העמוד, שמות המאמרים שבאמצע השורה, 'מסורת הזהר', 'חלופי גרסאות', כותרת הפירוש, ההפניה הקטנה שבסוגריים בתחתית הטור (כגון דפו\"י), והמילה הבודדת שבתחתית העמוד (שומר הדף). התעלם מסימוני מרקר וכתב יד. חשוב מאוד: זהו תמלול ולא ניסוח — כתוב רק מה שרואים בתמונה, אות באות. אל תשלים מהזיכרון ואל תנחש: מילה שאינה קריאה סמן כך […]. את הארמית כתוב עם הניקוד שבדף; את הפירוש כתוב בלי ניקוד, כפי שהוא מודפס.",
  },
};

const isRetryableScanErr = (e) => /504|Timeout|timeout|פגום|נחתכה|ריקה/.test(String(e?.message || e));

async function scanPiece(spec, b64, note, mt) {
  const text = await askClaude(spec.prompt + (note || "") + "\n\nהחזר את הטקסט המפוענח בלבד.", mt, !spec.strong, b64, "image/jpeg", true);
  return String(text || "").trim();
}

/* ── הרכבת מאמר זוהר מקטעי סריקה (צ'אט 27) ── */
const ZS_TAGS = { "מקור": "src", "פירוש ימין": "right", "פירוש שמאל": "left", "פירוש": "right" };
function parseZoharPiece(t) {
  const out = { src: "", right: "", left: "" };
  let cur = null;
  for (const raw of String(t || "").split("\n")) {
    const line = raw.trim();
    const m = line.match(/^\[\s*(מקור|פירוש ימין|פירוש שמאל|פירוש)\s*\]\s*(.*)$/);
    if (m) { cur = ZS_TAGS[m[1]]; if (m[2]) out[cur] += m[2] + "\n"; continue; }
    if (!line) continue;
    if (cur === null) cur = "right";
    out[cur] += line + "\n";
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  /* גיבוי לתיוג: גוף הזוהר מנוקד והפירוש לא. אם בקטע יש שני הסוגים, שורה מנוקדת שתויגה כפירוש חוזרת למקור, ושורה לא מנוקדת שתויגה כמקור עוברת לפירוש. */
  const dens = (l) => { const letters = (l.match(/[\u05D0-\u05EA]/g) || []).length; return letters < 12 ? -1 : (l.match(/[\u05B0-\u05BC\u05C1\u05C2\u05C7]/g) || []).length / letters; };
  const all = [out.src, out.right, out.left].join("\n").split("\n").map(dens).filter((d) => d >= 0);
  if (all.some((d) => d > 0.55) && all.some((d) => d < 0.12)) {
    const src = [], right = [], left = [];
    for (const l of out.src.split("\n")) { if (!l) continue; (dens(l) >= 0 && dens(l) < 0.12 ? right : src).push(l); }
    const comSrc = [];
    for (const [k, dst] of [["right", right], ["left", left]]) for (const l of out[k].split("\n")) { if (!l) continue; (dens(l) > 0.55 ? comSrc : dst).push(l); }
    out.src = [...src, ...comSrc].join("\n"); out.right = right.join("\n"); out.left = left.join("\n");
  }
  return out;
}
const zsNorm = (w) => w.replace(/[\u0591-\u05C7]/g, "").replace(/[^\u05D0-\u05EA]/g, "");
const zsOtLine = (t) => /^[א-ת]{1,4}['׳]?\)/.test((t || "").trim());
/* שתי מילים "שוות" גם אם נקראו בהבדל של אות אחת (קטורי / קטזרי) */
function zsFuzzyEq(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}
/* חיבור שני קטעים חופפים: השורות שבחפיפה נקראו פעמיים, ולא תמיד באותה צורה (מילה חסרה, מילה שנקראה אחרת).
   מיישרים את סוף הקטע הראשון מול תחילת השני (יישור מקומי: התאמה +1, אי-התאמה או מילה חסרה −1.5) ומסירים מהשני את החלק שכבר נקרא. */
function joinOverlap(a, b) {
  a = (a || "").trim(); b = (b || "").trim();
  if (!a) return b;
  if (!b) return a;
  const aw = a.split(/\s+/), bw = b.split(/\s+/);
  const A = aw.slice(-140).map(zsNorm), B = bw.slice(0, 140).map(zsNorm);
  const N = A.length, M = B.length, PEN = 1.5;
  let prev = new Float32Array(M + 1), cur = new Float32Array(M + 1);
  for (let y = 0; y <= M; y++) prev[y] = -PEN * y;
  for (let x = 1; x <= N; x++) {
    cur[0] = 0; // ההתחלה בקטע הראשון חופשית
    for (let y = 1; y <= M; y++) {
      const eq = A[x - 1] && B[y - 1] && zsFuzzyEq(A[x - 1], B[y - 1]);
      cur[y] = Math.max(prev[y - 1] + (eq ? 1 : -PEN), prev[y] - PEN, cur[y - 1] - PEN);
    }
    [prev, cur] = [cur, prev];
  }
  let bestY = 0, best = 0;
  for (let y = 1; y <= M; y++) if (prev[y] > best) { best = prev[y]; bestY = y; }
  if (best < 3) return a + (zsOtLine(b) ? "\n" : " ") + b;
  /* לעולם לא מוחקים סימון אות שלא הופיע בסוף הקטע הראשון */
  const isOt = (w) => /^[א-ת]{1,4}['׳]?\)$/.test(w);
  const tailOts = new Set(aw.slice(-140).filter(isOt));
  for (let y = 0; y < bestY; y++) if (isOt(bw[y]) && !tailOts.has(bw[y])) { bestY = y; break; }
  if (bestY === 0) return a + (zsOtLine(b) ? "\n" : " ") + b;
  let idx = 0, c = 0, m; const re = /\S+/g;
  while (c < bestY && (m = re.exec(b))) { c++; idx = re.lastIndex; }
  return a + b.slice(idx);
}
const zsFlow = (a, b) => (!a ? b : !b ? a : a + (zsOtLine(b) ? "\n" : " ") + b);
/* allowed: קבוצת האותיות שמותר לפתוח בהן קטע (בפירוש — רק אותיות שיש להן ארמית בצילומים). בלי allowed: אות עולה, בקפיצה של עד 3. */
function zsSplitByOt(text, allowed) {
  const segs = [];
  let cur = { n: 0, label: "", body: [] }, last = 0;
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([א-ת]{1,4})['׳]?\)\s*(.*)$/);
    const g = m ? gematria(m[1]) : 0;
    if (m && g && g === last) { if (m[2]) cur.body.push(m[2]); continue; } // אותה אות פעמיים (חפיפה) — המשך
    const ok = m && g && (allowed && allowed.size ? allowed.has(g) && g > last : last === 0 || (g > last && g - last <= 3));
    if (ok) { segs.push(cur); cur = { n: g, label: m[1], body: m[2] ? [m[2]] : [] }; last = g; continue; }
    cur.body.push(line);
  }
  segs.push(cur);
  return segs.filter((x) => x.n || x.body.length);
}
/* המנוע לפעמים מחזיר הסבר במקום טקסט ("התמונה אינה מציגה טקסט…") — זה לא נכנס לספר */
const ZS_META = /התמונה אינה|אין בתמונה|בתמונה זו|אינה מכילה טקסט|לא נראה טקסט|^\s*\[?ריק\]?\s*$/;
const zsCleanPiece = (t) => String(t || "").split("\n").filter((l) => l.trim() && !ZS_META.test(l)).join("\n").trim();
/* srcAll: גוף הזוהר (ארמית) ברצף · comAll: הפירוש ברצף, לפי סדר הקריאה. מחזיר "אות) ארמית" ואחריה פסקאות "הסולם: …" */
function assembleZoharText(srcAll, comAll) {
  const src = String(srcAll || "").replace(/[•*]|\(\s*\)/g, "").replace(/[ \t]+/g, " ");
  const com = String(comAll || "").replace(/[֑-ׇ]/g, "").replace(/[ \t]+/g, " "); // הפירוש אינו מנוקד — גם אם המנוע ניקד
  const S = zsSplitByOt(src);
  const C = zsSplitByOt(com, new Set(S.map((x) => x.n).filter(Boolean)));
  const ns = [...new Set([...S, ...C].map((x) => x.n))].sort((x, y) => x - y);
  const out = [];
  for (const n of ns) {
    const sg = S.filter((x) => x.n === n), cg = C.filter((x) => x.n === n);
    const ar = sg.map((x) => x.body.join(" ")).join(" ").trim();
    const label = (sg[0] || cg[0])?.label || "";
    if (n === 0) { if (ar) out.push(ar); }
    else out.push(`${label}) ${ar}`.trim());
    for (const c of cg) for (const para of c.body) out.push("הסולם: " + para);
  }
  return out.join("\n\n");
}
/* מסלול הגיבוי (פסים מתויגים): pieces לכל עמוד, מלמעלה למטה */
function bandsToLayers(pieces) {
  const P = pieces.map(parseZoharPiece);
  const lay = (k) => P.reduce((acc, x) => joinOverlap(acc, x[k]), "");
  return { src: lay("src"), com: zsFlow(lay("right"), lay("left")) };
}

/* ── מבנה הדף (צ'אט 27, גרסה שלישית) ──
   חיתוך לפסים אופקיים נכשל בדף זוהר: המנוע קרא לרוחב שני הטורים, ניקד את הפירוש, וקרא שורות פעמיים.
   כאן: קריאה אחת מאתרת איפה הארמית ואיפה הפירוש; הקוד מדייק את הרווח שבין הטורים לפי הפיקסלים; וכל שכבה וכל טור נחתכים ונקראים לבדם, ברזולוציה מלאה. */
function cropToJpeg(img, x0, y0, x1, y1, maxSide = 1568) {
  const c = (v) => Math.min(1, Math.max(0, v));
  x0 = c(x0); y0 = c(y0); x1 = c(x1); y1 = c(y1);
  const sx = Math.round(img.width * x0), sy = Math.round(img.height * y0);
  const sw = Math.max(8, Math.round(img.width * (x1 - x0))), sh = Math.max(8, Math.round(img.height * (y1 - y0)));
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const cv = document.createElement("canvas");
  cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
  cv.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.88).split(",")[1];
}
/* מפת בהירות מוקטנת של העמוד — לאיתור הרווח בין הטורים */
function pageLuma(img, w = 800) {
  const h = Math.max(1, Math.round((img.height / img.width) * w));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const L = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) L[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  return { L, w, h };
}
/* ── איתור מבנה דף זוהר מתוך הפיקסלים ──
   lum = { L: Uint8Array, w, h } (מפת בהירות מוקטנת). מחזיר null אם לא נמצאו שני טורים. */
function zsInkMap(lum) {
  const { L, w, h } = lum;
  /* רקע מקומי: ממוצע בחלון גדול (integral image). דיו = כהה משמעותית מהרקע המקומי; רקע כהה = לא נייר. */
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += L[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  const R = Math.max(8, Math.round(w / 40));
  const ink = new Uint8Array(w * h), paper = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1);
      const m = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((y1 - y0) * (x1 - x0));
      const p = m > 95;
      paper[y * w + x] = p ? 1 : 0;
      ink[y * w + x] = p && L[y * w + x] < m * 0.72 ? 1 : 0;
    }
  }
  return { ink, paper, w, h };
}
function zsDetectLayout(lum) {
  const { ink, paper, w, h } = zsInkMap(lum);
  const BH = Math.max(6, Math.round(h * 0.022)); // גובה רצועה ≈ שתי שורות פירוש
  const nb = Math.floor(h / BH);
  const minGap = Math.max(3, Math.round(w * 0.008)), maxGap = Math.round(w * 0.06), side = Math.round(w * 0.16);
  /* לכל רצועה: פרופיל דיו לעמודות, והרווחים הלבנים שיש טקסט משני צדיהם */
  const bands = [];
  for (let b = 0; b < nb; b++) {
    const col = new Uint16Array(w), pap = new Uint16Array(w);
    for (let y = b * BH; y < (b + 1) * BH; y++) for (let x = 0; x < w; x++) { col[x] += ink[y * w + x]; pap[x] += paper[y * w + x]; }
    const pre = new Uint32Array(w + 1);
    for (let x = 0; x < w; x++) pre[x + 1] = pre[x] + col[x];
    const gaps = [];
    for (let x = 0; x < w; ) {
      if (col[x] > 0 || pap[x] < BH * 0.8) { x++; continue; }
      let e = x; while (e + 1 < w && col[e + 1] === 0 && pap[e + 1] >= BH * 0.8) e++;
      const len = e - x + 1;
      if (len >= minGap && len <= maxGap && x - side >= 0 && e + 1 + side <= w) {
        const dl = (pre[x] - pre[x - side]) / (side * BH), dr = (pre[e + 1 + side] - pre[e + 1]) / (side * BH);
        if (dl > 0.07 && dr > 0.07) gaps.push({ x0: x, x1: e, mid: (x + e) / 2, len });
      }
      x = e + 1;
    }
    bands.push({ col, pre, gaps });
  }
  /* שרשראות: רווח שנמשך מרצועה לרצועה בתזוזה קטנה. מותר לדלג על רצועה אחת (שורת סיום פסקה / כותרת טור). */
  const tol = Math.max(4, Math.round(w * 0.014));
  let chains = [];
  for (let b = 0; b < nb; b++) for (const g of bands[b].gaps) {
    let best = null;
    for (const c of chains) {
      const last = c.pts[c.pts.length - 1];
      if (last.b === b || b - last.b > 2) continue;
      const d = Math.abs(last.mid - g.mid);
      if (d <= tol * (b - last.b) && (!best || d < best.d)) best = { c, d };
    }
    if (best) best.c.pts.push({ b, ...g }); else chains.push({ pts: [{ b, ...g }] });
  }
  chains = chains.filter((c) => c.pts.length >= 3);
  if (!chains.length) return null;
  /* הפירוש הוא הבלוק הדו-טורי הארוך, והרווח שלו רחב מרווח בין מילים: הציון = סכום רוחבי הרווח לאורך השרשרת */
  const score = (c) => c.pts.reduce((a, p) => a + p.len, 0);
  chains.sort((p, q) => score(q) - score(p));
  const ch = chains[0];
  /* ראש השרשרת: רצועה בודדת שמנותקת מההמשך (הערות שוליים, כותרת) אינה חלק מהפירוש */
  while (ch.pts.length > 3 && ch.pts[1].b - ch.pts[0].b > 1) ch.pts.shift();
  const b0 = ch.pts[0].b;
  let b1 = ch.pts[ch.pts.length - 1].b;
  /* קצות הטורים: מהרווח החוצה, עד שוליים לבנים רחבים */
  const margin = Math.round(w * 0.035);
  const lefts = [], rights = [];
  for (const p of ch.pts) {
    const col = bands[p.b].col;
    let run = 0, L = p.x0 - 1; for (let x = p.x0 - 1; x >= 0; x--) { if (col[x] === 0) { if (++run >= margin) break; } else { run = 0; L = x; } }
    run = 0; let Rr = p.x1 + 1; for (let x = p.x1 + 1; x < w; x++) { if (col[x] === 0) { if (++run >= margin) break; } else { run = 0; Rr = x; } }
    lefts.push(L); rights.push(Rr);
  }
  const q = (a, f) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * f))];
  const left = q(lefts, 0.15), right = q(rights, 0.85);
  /* סוף הפירוש: ממשיכים למטה כל עוד יש טקסט בתחום הטורים (השורות האחרונות אינן תמיד משני צדי הרווח) */
  const dens = (b) => (bands[b].pre[Math.min(w, right + 1)] - bands[b].pre[Math.max(0, left)]) / ((right - left + 1) * BH);
  for (let b = b1 + 1, empty = 0; b < nb && empty < 2; b++) { if (dens(b) > 0.02) { b1 = b; empty = 0; } else empty++; }
  /* ראש גוף הזוהר: הרצועה הראשונה מלמעלה שיש בה טקסט בתחום הטורים */
  let a0 = b0;
  for (let b = 0; b < b0; b++) if (dens(b) > 0.03) { a0 = b; break; }
  /* מסלול הרווח: x לכל y (אינטרפולציה בין הרצועות) */
  const path = ch.pts.map((p) => [((p.b + 0.5) * BH) / h, p.mid / w]);
  return { srcTop: Math.max(0, ((a0 - 0.5) * BH) / h), top: (b0 * BH) / h, bottom: Math.min(1, ((b1 + 1) * BH) / h), left: left / w, right: right / w, ink, w, h, path, bands: ch.pts.length, gap: ch.pts.reduce((t, q2) => t + q2.len, 0) / ch.pts.length / w, BH: BH / h };
}
function zsGutterAt(lay, y) {
  const p = lay.path;
  if (y <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) if (y <= p[i][0]) { const t = (y - p[i - 1][0]) / (p[i][0] - p[i - 1][0]); return p[i - 1][1] + t * (p[i][1] - p[i - 1][1]); }
  return p[p.length - 1][1];
}

/* חיתוך תחום גובה לקטעים, כשהחתכים נופלים ברווח הלבן שבין שורות (ולא באמצע שורה).
   x0,x1,yTop,yBot — שברים. מחזיר [{ y0, y1, clean }] — clean: החתך העליון של הקטע עבר ברווח נקי (אין צורך בחפיפה ובתפירה). */
function zsCutRows(lay, x0, x1, yTop, yBot, maxH) {
  const { ink, w, h } = lay;
  const c0 = Math.max(0, Math.round(x0 * w)), c1 = Math.min(w, Math.round(x1 * w));
  const row = (r) => { let n = 0; for (let x = c0; x < c1; x++) n += ink[r * w + x]; return n; };
  const noise = Math.max(1, Math.round((c1 - c0) * 0.004));
  const out = [];
  let cur = yTop, clean = true;
  while (yBot - cur > maxH) {
    const r0 = Math.round((cur + maxH * 0.55) * h), r1 = Math.round((cur + maxH) * h);
    let best = r1, bestInk = Infinity;
    for (let r = r1; r >= r0; r--) { const v = row(r) + (r + 1 < h ? row(r + 1) : 0); if (v < bestInk) { bestInk = v; best = r; if (v === 0) break; } }
    const isClean = bestInk <= noise;
    const y = (best + 1) / h;
    if (isClean) { out.push({ y0: cur, y1: y, clean }); cur = y; clean = true; }
    else { const ov = 0.02; out.push({ y0: cur, y1: Math.min(yBot, (cur + maxH)) , clean }); cur = cur + maxH - 2 * ov; clean = false; }
  }
  out.push({ y0: cur, y1: yBot, clean });
  return out;
}
/* הרווח הלבן הנקי הקרוב ביותר מעל y (עד span למעלה) — לגבול שבין גוף הזוהר לפירוש */
function zsSnapUp(lay, x0, x1, y, span) {
  const { ink, w, h } = lay;
  const c0 = Math.max(0, Math.round(x0 * w)), c1 = Math.min(w, Math.round(x1 * w));
  let best = Math.round(y * h), bestInk = Infinity;
  for (let r = Math.round(y * h); r >= Math.max(0, Math.round((y - span) * h)); r--) { let n = 0; for (let x = c0; x < c1; x++) n += ink[r * w + x]; if (n < bestInk) { bestInk = n; best = r; if (n === 0) break; } }
  return best / h;
}

const ZS_SRC_PROMPT =
  "לפניך קטע מגוף ספר הזוהר: ארמית מנוקדת באותיות גדולות. תמלל אותו מילה במילה עם הניקוד, בדיוק כפי שהוא מודפס — בלי להשלים מהזיכרון ובלי לתקן. כל אות מסומנת (כמו א) ב) ג)) פותחת שורה חדשה, והטקסט שלה נכתב ברצף בשורה אחת. טקסט שלפני הסימון הראשון נכתב בשורה ראשונה בלי סימון. דלג על: כותרות ממורכזות (שם המאמר, שם הפרשה, כותרת העמוד), אותיות-הערה קטנות וכוכביות שבין המילים, והערות באותיות קטנות. שורה שחתוכה בקצה העליון או התחתון של התמונה — דלג עליה. מילה שאינה קריאה סמן […]. אם אין בתמונה טקסט ארמי כזה — החזר רק את המילה: ריק";
const ZS_COM_PROMPT =
  "לפניך קטע מטור אחד של פירוש עברי: אותיות קטנות, בלי ניקוד, והציטוטים מהזוהר מודגשים. תמלל אותו מילה במילה, בלי ניקוד, בלי לתקן ובלי להשלים מהזיכרון. כתוב כל פסקה כשורה אחת רצופה; שורה שמתחילה בהזחה פותחת פסקה חדשה, בשורה חדשה. פסקה שנפתחת בסימון אות — למשל: ג) וההוא טהירו וכו': — הסימון נשאר בראש השורה. דלג על: כותרת ממורכזת, שורת ההפניה הקטנה שבסוגריים בתחתית הטור (כגון דפו\"י), מילה בודדת בתחתית העמוד, הערות \"מסורת הזהר\" ו\"חלופי גרסאות\", ואותיות חתוכות מטור שכן שנראות בקצה. שורה שחתוכה בקצה העליון או התחתון של התמונה — דלג עליה. מילה שאינה קריאה סמן […]. אם אין בתמונה טקסט — החזר רק את המילה: ריק";
/* מחלק תחום גובה לקטעים חופפים */
function zsSlices(top, bottom, maxH, ov) {
  const h = bottom - top;
  if (h <= maxH) return [[top, bottom]];
  const n = Math.ceil((h - ov) / (maxH - ov)), step = (h - maxH) / (n - 1);
  return Array.from({ length: n }, (_, k) => [top + k * step, top + k * step + maxH]);
}

/* דף זוהר עם פירוש מזוהה לבד (צ'אט 27): שני טורים ברורים, ומעליהם טקסט לכל רוחב העמוד. כך אין צורך לבחור תבנית ביד. */
async function looksLikeZoharPage(file) {
  try {
    const lay = zsDetectLayout(pageLuma(await loadImageEl(file)));
    return !!lay && lay.bands >= 6 && lay.gap >= 0.014 && lay.right - lay.left >= 0.3 && lay.bottom - lay.top >= 0.12 && lay.top - lay.srcTop >= 0.04;
  } catch { return false; }
}
async function smartScanImages(files, mode, onProgress) {
  let spec = SCAN_MODES[mode] || SCAN_MODES.merged;
  if (!spec.assemble && files.length) {
    /* בודקים עד שלושה צילומים; מספיק שאחד נראה כדף זוהר */
    let hit = false;
    for (const f of files.slice(0, 3)) if (await looksLikeZoharPage(f)) { hit = true; break; }
    if (hit) { spec = SCAN_MODES.zohar; onProgress?.(1, files.length, " · זוהה דף זוהר עם פירוש"); }
  }
  if (spec.assemble) {
    /* שמונה פסים דקים וחופפים לעמוד (צ'אט 27): השרת קוטע קריאה שנמשכת יותר מכחצי דקה (504 Inactivity Timeout), והמודל החזק איטי —
       לכן כל קריאה קטנה: כ-6–9 שורות. החפיפה (כ-5% מגובה העמוד = שורה מלאה לפחות) מאפשרת לתפור בלי לאבד שורה.
       פס שבכל זאת נקטע בזמן מתפצל לשניים ונקרא שוב. שלוש קריאות רצות במקביל. */
    const N_BANDS = 8, BAND_H = 0.17, STEP = (1 - BAND_H) / (N_BANDS - 1);
    const BANDS = Array.from({ length: N_BANDS }, (_, k) => [k === 0 ? 0 : +(k * STEP).toFixed(4), k === N_BANDS - 1 ? 1 : +(k * STEP + BAND_H).toFixed(4)]);
    const NOTE_TOP = "\nזהו החלק העליון של העמוד בלבד. תמלל כל שורה שנראית במלואה, עד השורה השלמה האחרונה בכל טור.";
    const NOTE_MID = "\nזהו פס צר מאמצע העמוד בלבד. בכל טור התחל מהשורה הראשונה שנראית במלואה (גם אם היא אמצע משפט), והמשך עד השורה השלמה האחרונה. שורה חתוכה בקצה העליון או התחתון — דלג עליה. אם רואים רק חלק מהשכבות — כתוב רק אותן.";
    const NOTE_BOT = "\nזהו החלק התחתון של העמוד בלבד. בכל טור התחל מהשורה הראשונה שנראית במלואה (גם אם היא אמצע משפט), והמשך עד סוף הטור.";
    const noteFor = (y0, y1) => (y0 <= 0 ? NOTE_TOP : y1 >= 1 ? NOTE_BOT : NOTE_MID);
    const isEmptyErr = (e) => /ריקה/.test(String(e?.message || e));
    const isTimeoutErr = (e) => /504|Timeout|timeout/.test(String(e?.message || e));
    const isNetErr = (e) => /רשת|network|Load failed|Failed to fetch|502|503|529/i.test(String(e?.message || e));
    /* מחזיר מערך קטעים לפי הסדר (בדרך כלל אחד; שניים או ארבעה אם הפס פוצל) */
    const readRegion = async (img, y0, y1, depth) => {
      const go = () => scanPiece(spec, imgToJpegBase64(img, 1568, [y0, y1]), noteFor(y0, y1), 1500);
      let lastErr;
      for (let at = 0; at < 4; at++) {
        if (at) await new Promise((r) => setTimeout(r, at * 3000));
        try { return [await go()]; }
        catch (e) {
          lastErr = e;
          if (isEmptyErr(e)) { if (at >= 1) return [""]; continue; }
          if (isTimeoutErr(e)) {
            if (depth >= 2) continue; // כבר פוצל פעמיים — מנסים שוב כמו שהוא
            const mid = (y0 + y1) / 2, ov = Math.min(0.03, (y1 - y0) / 4);
            const [p1, p2] = await Promise.all([readRegion(img, y0, mid + ov, depth + 1), readRegion(img, mid - ov, y1, depth + 1)]);
            return [...p1, ...p2];
          }
          if (!isNetErr(e) && !isRetryableScanErr(e)) throw e;
        }
      }
      throw lastErr;
    };
    /* תור משותף: עד שש קריאות במקביל */
    const pool = async (jobs, onDone) => {
      const res = new Array(jobs.length);
      let next = 0, done = 0;
      const worker = async () => { while (next < jobs.length) { const k = next++; res[k] = await jobs[k](); onDone?.(++done, jobs.length); } };
      await Promise.all(Array.from({ length: 6 }, worker)); // שש קריאות במקביל (צ'אט 27: היו שלוש — הסריקה הייתה איטית)
      return res;
    };
    /* קריאת קטע חתוך (שכבה אחת), עם ניסיונות חוזרים; קטע שנקטע בזמן מתפצל לשניים */
    const readCrop = async (img, prompt, x0, y0, x1, y1, depth) => {
      const go = () => askClaude(prompt, 1400, false, cropToJpeg(img, x0, y0, x1, y1), "image/jpeg", true);
      let lastErr;
      for (let at = 0; at < 4; at++) {
        if (at) await new Promise((r) => setTimeout(r, at * 3000));
        try { return [zsCleanPiece(await go())]; }
        catch (e) {
          lastErr = e;
          if (isEmptyErr(e)) { if (at >= 1) return [""]; continue; }
          if (isTimeoutErr(e)) {
            if (depth >= 2) continue;
            const mid = (y0 + y1) / 2, ov = Math.min(0.015, (y1 - y0) / 4);
            const [p1, p2] = await Promise.all([readCrop(img, prompt, x0, y0, x1, mid + ov, depth + 1), readCrop(img, prompt, x0, mid - ov, x1, y1, depth + 1)]);
            return [...p1, ...p2];
          }
          if (!isNetErr(e) && !isRetryableScanErr(e)) throw e;
        }
      }
      throw lastErr;
    };
    /* גוף הזוהר מנוקד; הערות שוליים וכותרות שנקראו בטעות אינן מנוקדות — נשארות רק שורות מנוקדות.
       יורדות גם כותרות מאמר ("מַאֲמַר …" קצרה), ואותיות-הערה בודדות שבין המילים. */
    const keepVocalized = (t) => String(t || "").split("\n").map((l) => l.split(/\s+/).filter((wd) => !/^[א-ת]$/.test(wd)).join(" ")).filter((l) => {
      const letters = (l.match(/[א-ת]/g) || []).length;
      if (letters < 4 || (l.match(/[ְ-ׇּׁׂ]/g) || []).length / letters <= 0.4) return false;
      const plain = l.replace(/[֑-ׇ]/g, "").trim();
      return !(/^מאמר\s/.test(plain) && plain.split(/\s+/).length <= 8);
    }).join("\n");
    /* המסלול הראשי: מבנה הדף מזוהה בקוד, מתוך הפיקסלים (הרווח בין הטורים, גבולות הפירוש), והחיתוך לקטעים נופל ברווח הלבן שבין השורות —
       כך שורה לא נחתכת ולא נקראת פעמיים. רק כשאין רווח נקי (עמוד עקום) הקטעים חופפים ונתפרים. null אם לא נמצאו שני טורים (ואז עוברים לפסים). */
    const readPageByLayout = async (img, i) => {
      onProgress?.(i + 1, files.length, " · מאתר את מבנה הדף");
      let lay = null;
      try { lay = zsDetectLayout(pageLuma(img)); } catch { lay = null; }
      if (!lay || lay.bottom - lay.top < 0.05 || lay.right - lay.left < 0.3) return null;
      const jobs = [], kinds = [], cleans = [];
      const add = (kind, prompt, x0, x1, cuts, post) => cuts.forEach((c) => {
        jobs.push(async () => { const r = await readCrop(img, prompt, x0, Math.max(0, c.y0 - 0.003), x1, Math.min(1, c.y1 + 0.003), 0); return post ? r.map(post) : r; });
        kinds.push(kind); cleans.push(c.clean);
      });
      const srcBottom = zsSnapUp(lay, lay.left, lay.right, lay.top, 0.03);
      if (srcBottom - lay.srcTop > 0.03) add("src", ZS_SRC_PROMPT, lay.left - 0.03, lay.right + 0.03, zsCutRows(lay, lay.left - 0.03, lay.right + 0.03, lay.srcTop, srcBottom, 0.2), keepVocalized);
      const cTop = Math.max(0, lay.top - 0.004), cBot = Math.min(1, lay.bottom + 0.012);
      const gm = zsGutterAt(lay, (lay.top + lay.bottom) / 2);
      /* הרווח בין הטורים נמדד לכל קטע בגובה שלו (עמוד עקום); קצות הטורים זזים יחד איתו */
      const colCuts = (side) => zsCutRows(lay, side === "right" ? gm + 0.006 : lay.left - 0.02, side === "right" ? lay.right + 0.02 : gm - 0.006, cTop, cBot, 0.16);
      for (const side of ["right", "left"]) colCuts(side).forEach((c) => {
        const g = zsGutterAt(lay, (c.y0 + c.y1) / 2), dx = g - gm;
        const x0 = side === "right" ? g + 0.004 : lay.left + dx - 0.025, x1 = side === "right" ? lay.right + dx + 0.025 : g - 0.004;
        jobs.push(() => readCrop(img, ZS_COM_PROMPT, x0, Math.max(0, c.y0 - 0.003), x1, Math.min(1, c.y1 + 0.003), 0)); kinds.push(side); cleans.push(c.clean);
      });
      const res = await pool(jobs, (d, n) => onProgress?.(i + 1, files.length, ` · קטע ${d}/${n}`));
      /* חתך נקי — מחברים כמו שהוא; חתך עם חפיפה — תופרים */
      const layer = (kind) => { let acc = ""; res.forEach((r, k) => { if (kinds[k] !== kind) return; r.forEach((x, j) => { acc = cleans[k] && j === 0 ? zsFlow(acc, x) : joinOverlap(acc, x); }); }); return acc; };
      const r4 = (v) => +v.toFixed(4);
      return { src: layer("src"), com: zsFlow(layer("right"), layer("left")), debug: { layout: { srcTop: r4(lay.srcTop), srcBottom: r4(srcBottom), top: r4(lay.top), bottom: r4(lay.bottom), left: r4(lay.left), right: r4(lay.right), gutter: r4(gm) }, pieces: res.map((r, k) => [kinds[k] + (cleans[k] ? "" : "*"), ...r]) } };
    };
    const readPageByBands = async (img, i) => {
      const res = await pool(BANDS.map((b) => () => readRegion(img, b[0], b[1], 0)), (d, n) => onProgress?.(i + 1, files.length, ` · חלק ${d}/${n}`));
      const pieces = res.flat();
      return { ...bandsToLayers(pieces), debug: { bands: pieces } };
    };
    let srcAll = "", comAll = "";
    const debug = [];
    for (let i = 0; i < files.length; i++) {
      const img = await loadImageEl(files[i]);
      const page = (await readPageByLayout(img, i)) || (await readPageByBands(img, i));
      srcAll = zsFlow(srcAll, page.src);
      comAll = zsFlow(comAll, page.com);
      debug.push({ file: files[i].name, w: img.width, h: img.height, ...page.debug });
    }
    const text = assembleZoharText(srcAll, comAll);
    if (text.replace(/\s/g, "").length < 30) throw new Error("המנוע לא הצליח לפענח טקסט מהצילומים. נסה צילום חד, ישר ומואר יותר.");
    /* debug נשמר עם הספר (book.flex.scan) ונכנס לגיבוי — כדי שאפשר יהיה לראות מה המנוע החזיר לכל קטע */
    return { text, debug: { v: 5, at: new Date().toISOString(), pages: debug } };
  }
  /* דף רגיל (צ'אט 27): כל חצאי העמודים של כל הצילומים נקראים במקביל (עד שישה יחד) — במקום עמוד אחרי עמוד, חצי אחרי חצי */
  const TOP_NOTE = "\nזהו החלק העליון של העמוד בלבד — פענח רק אותו, ועצור במשפט השלם האחרון שנראה במלואו.";
  const BOT_NOTE = "\nזהו החלק התחתון של העמוד בלבד. בראש התמונה ייתכנו שורות חתוכות או כאלה שכבר פוענחו — דלג עליהן והתחל מהפסקה/המשפט השלם הראשון.";
  const halves = new Array(files.length * 2).fill("");
  let nextJob = 0, doneJobs = 0;
  onProgress?.(0, files.length, "");
  const readHalf = async (k) => {
    const img = await loadImageEl(files[k >> 1]);
    const go = () => scanPiece(spec, imgToJpegBase64(img, 1600, k % 2 ? [0.47, 1] : [0, 0.53]), k % 2 ? BOT_NOTE : TOP_NOTE, 2000);
    try { return await go(); }
    catch (e) { if (/ריקה/.test(String(e?.message || e))) return ""; if (!isRetryableScanErr(e) && !/רשת|502|503|529/.test(String(e?.message || e))) throw e; await new Promise((r) => setTimeout(r, 3000)); return await go(); }
  };
  const halfWorker = async () => {
    while (nextJob < halves.length) {
      const k = nextJob++;
      halves[k] = await readHalf(k);
      doneJobs++;
      onProgress?.(Math.min(files.length, Math.ceil(doneJobs / 2)), files.length, "");
    }
  };
  await Promise.all(Array.from({ length: 6 }, halfWorker));
  let out = "";
  for (let i = 0; i < files.length; i++) {
    const t = (halves[2 * i] + "\n" + halves[2 * i + 1]).trim();
    if (t) out += (out ? "\n\n" : "") + t;
  }
  const clean = out.trim();
  if (clean.replace(/\s/g, "").length < 30) {
    throw new Error("המנוע לא הצליח לפענח טקסט מהצילומים. נסה צילום חד, ישר ומואר יותר.");
  }
  return clean;
}

/* ── שער הקול 🎬: קובץ אודיו/וידאו ← טקסט עברי (Whisper דרך transcribe.cjs) ──
   הכול קורה בדפדפן: חילוץ פס הקול (גם מסרטון), הקטנה ל-16kHz מונו,
   חיתוך לנתחים בנקודות שקט (לא באמצע מילה), ושליחה נתח-נתח לתמלול. */
const TR_SR = 16000;      // קצב דגימה לתמלול
const TR_CHUNK_SEC = 110; // אורך נתח בשניות (WAV ≈ 3.5MB — מתחת למגבלת נטליפיי)

/* מסלול ב' לחילוץ שמע: כשהפענוח הישיר נכשל (MOV/HEVC מהאייפון), מנגנים את
   הסרטון בשקט דרך נגן נסתר ולוכדים את פס הקול בזמן אמת. אורך החילוץ = אורך הסרטון. */
async function decodeViaElement(file, onProgress) {
  const url = URL.createObjectURL(file);
  const el = document.createElement("video");
  el.src = url; el.playsInline = true; el.setAttribute("playsinline", ""); el.preload = "auto";
  el.style.cssText = "position:fixed;left:-20px;top:-20px;width:2px;height:2px;opacity:0;pointer-events:none;";
  document.body.appendChild(el);
  let wake = null;
  try { wake = await navigator.wakeLock?.request?.("screen"); } catch {}
  const cleanup = () => {
    try { el.pause(); } catch {}
    el.remove(); URL.revokeObjectURL(url);
    try { wake?.release?.(); } catch {}
  };
  try {
    await new Promise((res, rej) => {
      el.onloadedmetadata = () => res();
      el.onerror = () => rej(new Error("no-play"));
      setTimeout(() => rej(new Error("no-play")), 15000);
    });
    const dur = el.duration;
    if (!isFinite(dur) || dur <= 0) throw new Error("no-play");
    if (dur > 9000) throw new Error("הקובץ ארוך מ-2.5 שעות. פצל אותו לחלקים קצרים יותר (או תמלל מהמחשב).");
    const RATE = 2; // נגינה מוחשת ×2 בלי שימור גובה צליל — שקול לדגימת המקור בחצי הקצב
    el.playbackRate = RATE;
    try { el.preservesPitch = false; } catch {}
    try { el.webkitPreservesPitch = false; } catch {}
    try { el.mozPreservesPitch = false; } catch {}
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const srLive = ctx.sampleRate;
    try { await ctx.resume(); } catch {}
    const src = ctx.createMediaElementSource(el);
    const proc = ctx.createScriptProcessor(4096, 2, 1);
    const silent = ctx.createGain(); silent.gain.value = 0;
    src.connect(proc); proc.connect(silent); silent.connect(ctx.destination);
    const parts = [];
    proc.onaudioprocess = (ev) => {
      const ib = ev.inputBuffer, n = ib.length, chs = ib.numberOfChannels || 1;
      const m = new Float32Array(n);
      for (let c = 0; c < chs; c++) { const d = ib.getChannelData(c); for (let i = 0; i < n; i++) m[i] += d[i] / chs; }
      parts.push(m);
    };
    const done = new Promise((res, rej) => {
      el.onended = () => res();
      el.onerror = () => rej(new Error("no-play"));
    });
    try { await el.play(); } catch { throw new Error("play-blocked"); }
    const mins = Math.max(1, Math.round(dur / 60 / RATE));
    const iv = setInterval(() => {
      const pct = Math.min(99, Math.round((el.currentTime / dur) * 100));
      onProgress?.(0, 0, "🎬 מחלץ שמע מהסרטון (×2)… " + pct + "% (כ-" + mins + " דק' — השאר את המסך דולק)");
    }, 1000);
    try { await done; } finally { clearInterval(iv); }
    try { proc.disconnect(); src.disconnect(); silent.disconnect(); } catch {}
    try { ctx.close(); } catch {}
    let total = 0; for (const p of parts) total += p.length;
    const mono = new Float32Array(total);
    let off = 0; for (const p of parts) { mono.set(p, off); off += p.length; }
    if (total < srLive) throw new Error("no-play");
    return { mono, sr: srLive / RATE, dur };
  } finally { cleanup(); }
}

async function decodeMediaToMono(file, onProgress) {
  const buf = await file.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: TR_SR });
  let audio = null;
  try {
    audio = await ctx.decodeAudioData(buf);
  } catch {
    audio = null; // מסלול ב' למטה
  } finally {
    try { ctx.close(); } catch {}
  }
  if (!audio) {
    try {
      return await decodeViaElement(file, onProgress);
    } catch (e) {
      if (e && e.message === "play-blocked") {
        throw new Error("הדפדפן חסם את חילוץ השמע (הגנת אוטומטיות). נסה שוב מיד — הפעם ההרשאה תינתן.");
      }
      if (e && e.message === "no-play") {
        throw new Error("לא ניתן לחלץ שמע מ" + (file.name ? "הקובץ (" + file.name + ")" : "ההקלטה") + ". נסה MP3 / M4A / WAV, או סרטון MP4/MOV.");
      }
      throw e;
    }
  }
  if (audio.duration > 9000) {
    throw new Error("הקובץ ארוך מ-2.5 שעות. פצל אותו לחלקים קצרים יותר (או תמלל מהמחשב).");
  }
  const n = audio.length, chs = audio.numberOfChannels;
  const mono = new Float32Array(n);
  for (let c = 0; c < chs; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / chs;
  }
  return { mono, sr: audio.sampleRate, dur: audio.duration };
}

function resampleLinear(data, from, to) {
  if (from === to) return data;
  const outLen = Math.round((data.length * to) / from);
  const out = new Float32Array(outLen);
  const ratio = from / to;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(i0 + 1, data.length - 1), f = pos - i0;
    out[i] = data[i0] * (1 - f) + data[i1] * f;
  }
  return out;
}

/* מחפש את נקודת השקט הקרובה לגבול הנתח — כדי לא לחתוך מילה באמצע */
function quietCut(mono, target, sr) {
  const win = Math.round(sr * 0.2), span = Math.round(sr * 2.5);
  const from = Math.max(0, target - span), to = Math.min(mono.length - win, target + span);
  let best = target, bestE = Infinity;
  for (let s = from; s <= to; s += win) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += mono[i] * mono[i];
    if (e < bestE) { bestE = e; best = s + (win >> 1); }
  }
  return best;
}

function floatToWav16(samples, sr) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); ws(8, "WAVE");
  ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, "data"); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}

async function transcribeChunk(b64, hint) {
  const headers = await authHeaders();
  const res = await fetch(API_BASE + "/.netlify/functions/transcribe", {
    method: "POST",
    headers,
    body: JSON.stringify({ audio: b64, lang: "he", hint: hint || "" }),
  });
  const data = await res.json().catch(() => ({}));
  const ge = gateError(res, data);
  if (ge) throw ge;
  if (!res.ok) throw new Error(data?.error?.message || "שגיאת תמלול (" + res.status + ")");
  return String(data.text || "").trim();
}

async function transcribeMedia(file, onProgress, hint) {
  onProgress?.(0, 0, "🎬 מחלץ את פס הקול מהקובץ...");
  const { mono, sr } = await decodeMediaToMono(file, onProgress);
  const data = sr === TR_SR ? mono : resampleLinear(mono, sr, TR_SR);
  const chunkLen = TR_CHUNK_SEC * TR_SR;
  const cuts = [0];
  while (cuts[cuts.length - 1] + chunkLen < data.length) {
    cuts.push(quietCut(data, cuts[cuts.length - 1] + chunkLen, TR_SR));
  }
  cuts.push(data.length);
  const total = cuts.length - 1;
  let out = "";
  for (let i = 0; i < total; i++) {
    onProgress?.(i + 1, total);
    const piece = data.subarray(cuts[i], cuts[i + 1]);
    if (piece.length < TR_SR) continue; // נתח קצר משנייה — מדלגים
    const b64 = bufToBase64(floatToWav16(piece, TR_SR));
    let text;
    try {
      text = await transcribeChunk(b64, hint);
    } catch (e) {
      if (isGateError(e)) throw e; // כניסה/מכסה — ניסיון שני לא יעזור
      onProgress?.(i + 1, total, " · ניסיון שני");
      text = await transcribeChunk(b64, hint); // ניסיון חוזר אחד — ואם נכשל, השגיאה עולה למעלה
    }
    if (text) out += (out ? "\n\n" : "") + text;
  }
  const clean = out.trim();
  if (clean.replace(/\s/g, "").length < 30) {
    throw new Error("לא זוהה דיבור בקובץ. ודא שיש בו שמע ברור.");
  }
  return clean;
}

/* ליטוש חכם: תיקון שגיאות שמיעה בלבד — בלי לגעת בניסוח ובתוכן (עקרון העקיפה) */
const POLISH_PROMPT =
  "לפניך קטע מתמלול אוטומטי של הקלטה בעברית. תקן אך ורק: מילים שנכתבו לפי צליל דומה במקום המילה הנכונה בהקשר (למשל 'מיין' במקום 'מעין'), שגיאות כתיב, ופיסוק. אסור לשנות ניסוח, אסור להוסיף תוכן, אסור להשמיט משפטים, ואסור לסכם. שמור על חלוקת הפסקאות. החזר את הקטע המתוקן בלבד.\n\n";

async function polishTranscript(text, onProgress) {
  const paras = text.split(/\n\n+/);
  const chunks = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > 3000) { chunks.push(cur); cur = p; }
    else cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur) chunks.push(cur);
  let out = "";
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(i + 1, chunks.length);
    let t;
    try {
      t = await askClaude(POLISH_PROMPT + chunks[i], 1600, true, null, null, true);
    } catch {
      t = chunks[i]; // הליטוש נכשל בנתח הזה — משאירים את המקור, לא מפילים את הכול
    }
    out += (out ? "\n\n" : "") + String(t || chunks[i]).trim();
  }
  return out;
}

async function extractPdf(file) {
  await loadScript(PDFJS_SRC);
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) throw new Error("ספריית ה-PDF לא נטענה. ודא חיבור לאינטרנט ונסה שוב.");
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
 
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map((it) => it.str);
    const pageText = strings.join(" ").replace(/\s+/g, " ").trim();
    if (pageText) out += pageText + "\n\n";
  }
  const clean = out.trim();
  // אם כמעט אין טקסט — כנראה קובץ סרוק (צילום), שדורש OCR
  if (clean.replace(/\s/g, "").length < 40) {
    const err = new Error(
      "נראה שזהו קובץ PDF סרוק (צילום של דפים) שאין ממנו טקסט לחילוץ. כדי לקלוט אותו צריך OCR — זיהוי תווים — שנוסיף בשלב הבא. בינתיים אפשר להדביק טקסט ידנית."
    );
    err.isScan = true;
    throw err;
  }
  return clean;
}
 
async function extractDocx(file) {
  await loadScript(MAMMOTH_SRC);
  const mammoth = window.mammoth;
  if (!mammoth) throw new Error("ספריית ה-Word לא נטענה. ודא חיבור לאינטרנט ונסה שוב.");
  const buf = await file.arrayBuffer();
  const res = await mammoth.extractRawText({ arrayBuffer: buf });
  const clean = (res.value || "").trim();
  if (clean.replace(/\s/g, "").length < 40) {
    throw new Error("לא נמצא טקסט בקובץ ה-Word. ייתכן שהוא ריק או מכיל רק תמונות.");
  }
  return clean;
}
 
async function extractFileText(file) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdf(file);
  }
  if (
    name.endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractDocx(file);
  }
  if (name.endsWith(".txt") || file.type === "text/plain") {
    return (await file.text()).trim();
  }
  if (name.endsWith(".doc")) {
    throw new Error("קובצי .doc ישנים אינם נתמכים. שמור בפורמט .docx או PDF ונסה שוב.");
  }
  throw new Error("סוג קובץ לא נתמך. אפשר להעלות PDF, Word (docx) או טקסט (txt).");
}
 
function doneCount(book) {
  return book.chapters.reduce(
    (n, _, i) => n + (book.progress?.[i]?.done ? 1 : 0),
    0
  );
}
function chapterStatus(book, i) {
  if (book.progress?.[i]?.done) return "done";
  const hasAny = CHANNELS.some((c) => book.results?.[`${i}:${c.id}`]);
  return hasAny ? "learning" : "new";
}

/* ─── 📝 עורך ההערה (צ'אט 19): כתיבה או דיבור ───
   במקום חלון prompt של הדפדפן: חלונית עם תיבת טקסט וכפתור 🎙. הדיבור — קודם זיהוי הדיבור של הדפדפן (מיידי, בעברית);
   אם אין (למשל בתוך האפליקציה) — הקלטה קצרה ותמלול באותו צינור של "הקלטה חיה" (Whisper). */
const SpeechRec = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
function NoteEditor({ initial, src, onSave, onCancel, transcribe }) {
  const [txt, setTxt] = useState(initial || "");
  const [mode, setMode] = useState(null);   // null | "listen" | "rec" | "busy"
  const [msg, setMsg] = useState("");
  const [sec, setSec] = useState(0);
  const live = useRef(null);
  const ta = useRef(null);
  useEffect(() => { ta.current?.focus(); return () => stopAll(); }, []);
  const append = (t) => setTxt((v) => (v ? v.replace(/\s+$/, "") + " " : "") + t.trim());
  const stopAll = () => {
    try { live.current?.rec?.stop(); } catch {}
    try { live.current?.mr?.stop(); } catch {}
    if (live.current?.iv) clearInterval(live.current.iv);
    live.current = null;
  };
  const startMic = async () => {
    if (mode) { stopAll(); if (mode === "listen") setMode(null); return; }
    setMsg("");
    if (SpeechRec) {
      try {
        const rec = new SpeechRec();
        rec.lang = voiceLocale(getLang()); rec.continuous = true; rec.interimResults = true;
        let finalText = "", base = null;
        rec.onstart = () => { base = null; setMode("listen"); };
        rec.onresult = (ev) => {
          let interim = ""; finalText = "";
          for (let k = 0; k < ev.results.length; k++) { const r = ev.results[k]; if (r.isFinal) finalText += r[0].transcript + " "; else interim += r[0].transcript; }
          setTxt((v) => { if (base === null) base = v; return (base ? base.replace(/\s+$/, "") + " " : "") + (finalText + interim).trim(); });
        };
        rec.onerror = (ev) => { if (ev.error === "not-allowed" || ev.error === "service-not-allowed") { setMsg(tx("אין גישה למיקרופון — אשר הרשאה בדפדפן.")); } else if (ev.error !== "aborted" && ev.error !== "no-speech") setMsg(tx("זיהוי הדיבור נכשל ({e}) — מנסה הקלטה.", { e: ev.error })); };
        rec.onend = () => { live.current = null; setMode(null); };
        live.current = { rec };
        rec.start();
        return;
      } catch {}
    }
    /* חלופה: הקלטה ← תמלול */
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (live.current?.iv) clearInterval(live.current.iv);
        live.current = null;
        const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        if (blob.size < 3000) { setMode(null); setMsg(tx("ההקלטה קצרה מדי.")); return; }
        setMode("busy"); setMsg(tx("⏳ מתמלל…"));
        try { const t = await transcribe(blob); if (t) append(t); setMsg(""); }
        catch (e) { setMsg(tx("התמלול נכשל: ") + (e?.message || e)); }
        setMode(null);
      };
      live.current = { mr, iv: setInterval(() => setSec((x) => x + 1), 1000) };
      setSec(0); setMode("rec"); mr.start(1000);
    } catch { setMsg(tx("אין גישה למיקרופון. אשר לאתר הרשאת מיקרופון ונסה שוב.")); }
  };
  const node = (
    <div className="note-ed-back" onMouseDown={(e) => { if (e.target === e.currentTarget) { stopAll(); onCancel(); } }}>
      <div className="note-ed" dir={langDir()} role="dialog">
        <div className="note-ed-head">{tx("📝 הערה על הקטע")}</div>
        {src && <div className="note-ed-src">«{src}»</div>}
        <textarea ref={ta} className="note-ed-ta" rows={4} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={tx("כתוב כאן — או לחץ על המיקרופון ודבר")} />
        <div className="note-ed-row">
          <button type="button" className={"mark-btn note-mic" + (mode ? " on" : "")} onClick={startMic} disabled={mode === "busy"}>
            {mode === "listen" ? tx("⏹ עצור — מקשיב…") : mode === "rec" ? tx("⏹ עצור ({n} שנ׳)", { n: sec }) : mode === "busy" ? tx("⏳ מתמלל…") : tx("🎙 דבר")}
          </button>
          <span className="note-ed-msg">{msg}</span>
        </div>
        <div className="note-ed-row note-ed-actions">
          <button type="button" className="ch-key gold note-ed-save" onClick={() => { stopAll(); onSave(txt); }}>{tx("שמור")}</button>
          {initial ? <button type="button" className="mark-btn" onClick={() => { stopAll(); onSave(""); }}>{tx("🗑 מחק הערה")}</button> : null}
          <button type="button" className="mark-btn" onClick={() => { stopAll(); onCancel(); }}>{tx("ביטול")}</button>
        </div>
      </div>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}

/* ─── 🕯 לימוד משותף — שלב א (צ'אט 19) ───
   של השורש, לא של הלבוש: הרכיבים כאן מקבלים "ספר" ו"משתמש" בלבד. "חברותא" הוא רק השם שבית המדרש נותן לזה.
   הדף המשותף רץ על ערוץ Supabase Realtime (broadcast + presence) — בלי שרת נוסף. הווידאו (LiveKit) — שלב ב. */
const SHARE_COLORS = ["#4aa3ff", "#ff7bb0", "#39d98a", "#f2a33c", "#b7a6f2", "#ff7b7b"];
const makeShareCode = () => { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let c = ""; for (let i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)]; return c; };
const shareNameOf = (user) => (user?.user_metadata?.name || (user?.email || "").split("@")[0] || tx("לומד"));
/* 📹 חלון הווידאו של הלימוד המשותף — LiveKit (שלב ב).
   הכרטיס מגיע מ-netlify/functions/livekit-token (רק לחברי השיעור). מצלמה + מיקרופון של הלומד,
   והחברים באריחים קטנים. בטלפון: מי שמדבר גדול יותר (LiveKit מוריד רזולוציה לבד). */
/* הודעת הרשאות בעברית (צ'אט 24) — בלי הטקסט האנגלי של הדפדפן */
const mediaErrHe = (e) => {
  const n = e?.name || "";
  if (n === "NotAllowedError" || n === "SecurityError" || /not allowed|denied/i.test(e?.message || "")) return tx("הדפדפן לא קיבל רשות למצלמה/מיקרופון — הגדרות ← Chrome/Safari ← מצלמה, מיקרופון ← לאשר, ולנסות שוב.");
  if (n === "NotFoundError" || n === "OverconstrainedError") return tx("לא נמצאו מצלמה או מיקרופון במכשיר הזה.");
  if (n === "NotReadableError" || n === "AbortError") return tx("המצלמה או המיקרופון תפוסים באפליקציה אחרת (FaceTime? זום?) — לסגור אותה ולנסות שוב.");
  return tx("לא הצלחתי להפעיל מצלמה/מיקרופון. לנסות שוב.");
};
function VideoPanel({ sessionId, myName, onClose, watch }) {
  const [state, setState] = useState("connecting"); // connecting | on | error
  const [msg, setMsg] = useState("");
  const [tiles, setTiles] = useState([]); // [{id, name, local, videoTrack, audioTrack, speaking}]
  /* watch = מי שהצטרף מקישור: רואה ושומע מיד, המצלמה והמיקרופון שלו — רק בלחיצה */
  const [mic, setMic] = useState(!watch);
  const [cam, setCam] = useState(!watch);
  const [watching, setWatching] = useState(!!watch);
  const [retry, setRetry] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  /* גודל (3 מדרגות) ומיקום (גרירה בכותרת) — נשמרים לפעם הבאה */
  /* בטלפון החלון קטן בהרבה: החבר באריח אחד, אני בפינה שלו — כדי לא להסתיר את הדף */
  const NARROW = typeof window !== "undefined" && window.innerWidth <= 640;
  const SIZES = NARROW ? [120, 190, 9999] : [220, 320, 560];
  const [mini, setMini] = useState(false); // מצומצם לפס הכותרת בלבד — הקול ממשיך
  const [sizeIdx, setSizeIdx] = useState(() => { if (NARROW) { try { const v = parseInt(localStorage.getItem("lomedtv-video-size-m"), 10); return v >= 0 && v <= 2 ? v : 0; } catch { return 0; } } try { const v = parseInt(localStorage.getItem("lomedtv-video-size"), 10); return v >= 0 && v <= 2 ? v : 1; } catch { return 1; } });
  const [pos, setPos] = useState(() => { try { return JSON.parse(localStorage.getItem("lomedtv-video-pos") || "null"); } catch { return null; } });
  const panelRef = useRef(null);
  const cycleSize = () => setSizeIdx((i) => { const n = (i + 1) % SIZES.length; try { localStorage.setItem(NARROW ? "lomedtv-video-size-m" : "lomedtv-video-size", String(n)); } catch {} return n; });
  const lastTouch = useRef(0);
  const onGrab = (e) => {
    if (e.target.closest("button")) return;
    /* בטלפון כל הקשה מגיעה פעמיים (מגע ואז "עכבר" מדומה) — בלי זה ההקשה צמצמה ומיד פתחה בחזרה */
    if (e.touches) lastTouch.current = Date.now(); else if (Date.now() - lastTouch.current < 900) return;
    const r = panelRef.current?.getBoundingClientRect(); if (!r) return;
    const p0 = e.touches ? e.touches[0] : e;
    const dx = p0.clientX - r.left, dy = p0.clientY - r.top;
    let moved = false;
    const move = (ev) => {
      const p = ev.touches ? ev.touches[0] : ev;
      if (!moved && Math.abs(p.clientX - p0.clientX) + Math.abs(p.clientY - p0.clientY) < 7) return; /* רעד קטן של האצבע אינו גרירה */
      moved = true;
      const x = Math.min(Math.max(0, p.clientX - dx), window.innerWidth - r.width), y = Math.min(Math.max(0, p.clientY - dy), window.innerHeight - r.height);
      setPos({ x, y });
      if (ev.cancelable) ev.preventDefault();
    };
    const up = () => {
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move); window.removeEventListener("touchend", up);
      /* בטלפון: הקשה על הפס (בלי להזיז) מצמצמת את החלון לשורה, והקשה נוספת פותחת */
      if (!moved) { setMini((m) => !m); return; }
      setPos((p) => { try { p ? localStorage.setItem("lomedtv-video-pos", JSON.stringify(p)) : localStorage.removeItem("lomedtv-video-pos"); } catch {} return p; });
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move, { passive: false }); window.addEventListener("touchend", up);
    e.preventDefault();
  };
  const resetPos = () => { setPos(null); try { localStorage.removeItem("lomedtv-video-pos"); } catch {} };
  const roomRef = useRef(null);
  useEffect(() => {
    let room = null, dead = false;
    const refresh = () => {
      if (!room || dead) return;
      const list = [];
      const add = (p, local) => {
        let videoTrack = null, audioTrack = null;
        p.trackPublications.forEach((pub) => {
          if (!pub.track) return;
          if (pub.kind === Track.Kind.Video && pub.source !== Track.Source.ScreenShare) videoTrack = pub.track;
          if (pub.kind === Track.Kind.Audio) audioTrack = pub.track;
        });
        list.push({ id: p.identity, name: p.name || p.identity, local, videoTrack, audioTrack, speaking: p.isSpeaking });
      };
      add(room.localParticipant, true);
      room.remoteParticipants.forEach((p) => add(p, false));
      setTiles(list);
    };
    (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch(API_BASE + "/.netlify/functions/livekit-token", { method: "POST", headers, body: JSON.stringify({ session: sessionId, name: myName }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error?.message || tx("שגיאה בקבלת כרטיס לחדר (") + res.status + ")");
        if (dead) return;
        room = new Room({ adaptiveStream: true, dynacast: true, videoCaptureDefaults: { resolution: { width: 640, height: 360, frameRate: 24 } } });
        roomRef.current = room;
        const evs = [RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted];
        evs.forEach((e) => room.on(e, refresh));
        room.on(RoomEvent.Disconnected, () => { if (!dead) { setState("error"); setMsg(tx("החיבור לחדר הווידאו נותק.")); } });
        room.on(RoomEvent.AudioPlaybackStatusChanged, () => { if (!dead) setAudioBlocked(!room.canPlaybackAudio); });
        await room.connect(data.url, data.token);
        if (dead) return;
        setMsg("");
        if (!watching) {
          try { await room.localParticipant.enableCameraAndMicrophone(); setMic(true); setCam(true); }
          catch (e) {
            setMsg(mediaErrHe(e)); setCam(false);
            try { await room.localParticipant.setMicrophoneEnabled(true); setMic(true); } catch { setMic(false); }
          }
        }
        setAudioBlocked(!room.canPlaybackAudio);
        setState("on");
        refresh();
      } catch (e) {
        if (!dead) { setState("error"); setMsg(/Failed to fetch|NetworkError|Load failed/i.test(e?.message || "") ? tx("אין חיבור לרשת — החדר לא נפתח.") : (e?.message || String(e))); }
      }
    })();
    return () => { dead = true; try { room?.disconnect(); } catch {} roomRef.current = null; };
  }, [sessionId, retry]);
  const reconnect = () => { setState("connecting"); setMsg(""); setRetry((n) => n + 1); };
  const toggleMic = async () => { const r = roomRef.current; if (!r) return; const next = !mic; try { await r.localParticipant.setMicrophoneEnabled(next); setMic(next); setMsg(""); } catch (e) { setMsg(mediaErrHe(e)); } };
  const toggleCam = async () => { const r = roomRef.current; if (!r) return; const next = !cam; try { await r.localParticipant.setCameraEnabled(next); setCam(next); setMsg(""); } catch (e) { setMsg(mediaErrHe(e)); } };
  /* מצפייה להשתתפות: כאן הדפדפן מבקש רשות (אי אפשר לעקוף) */
  const joinWithMedia = async () => {
    const r = roomRef.current; if (!r) return;
    setWatching(false); setMsg("");
    try { await r.startAudio(); } catch {}
    try { await r.localParticipant.enableCameraAndMicrophone(); setMic(true); setCam(true); }
    catch (e) { setMsg(mediaErrHe(e)); try { await r.localParticipant.setMicrophoneEnabled(true); setMic(true); } catch {} }
  };
  const unblockAudio = async () => { try { await roomRef.current?.startAudio(); setAudioBlocked(false); } catch {} };
  const w = Math.min(SIZES[sizeIdx], window.innerWidth - 24);
  const style = pos
    ? { width: w, left: Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - w)), top: Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - 120)), bottom: "auto" }
    : { width: w };
  const shown = tiles.filter((t) => !(watching && t.local));
  const node = (
    <div ref={panelRef} className={"video-panel" + (NARROW ? " narrow sz" + sizeIdx : "") + (NARROW && sizeIdx < 2 && shown.some((t) => !t.local) && shown.some((t) => t.local) ? " pip" : "") + (mini ? " mini" : "")} style={style} dir={langDir()}>
      <div className="video-head" onMouseDown={onGrab} onTouchStart={onGrab} title={mini ? tx("לחיצה: פתח את הווידאו · אחוז וגרור להזזה") : tx("לחיצה: צמצם לפס · אחוז וגרור להזזה")}>
        <span className="video-title">{NARROW ? <><i className="video-handle" />{state === "connecting" ? "…" : state === "error" ? "⚠" : `📹 ${tiles.length}`}<i className="video-chev">{mini ? "▴" : "▾"}</i></> : <>⋮⋮ 📹 {state === "connecting" ? tx("מתחבר לחדר…") : state === "error" ? tx("שגיאה") : tx("{n} בחדר", { n: tiles.length })}</>}</span>
        <span className="video-btns">
          {!NARROW && <button className="mark-btn vmini" onClick={() => setMini((m) => !m)} title={mini ? tx("פתח את הווידאו") : tx("צמצם לפס — הקול ממשיך")}>{mini ? tx("▴ פתח") : "▾"}</button>}
          <button className="mark-btn" onClick={cycleSize} title={tx("גודל: קטן / בינוני / גדול")}>{sizeIdx === 0 ? "S" : sizeIdx === 1 ? "M" : "L"}</button>
          <button className={"mark-btn" + (mic ? "" : " off")} onClick={toggleMic} title={tx("מיקרופון")}>{mic ? "🎙" : "🔇"}</button>
          <button className={"mark-btn" + (cam ? "" : " off")} onClick={toggleCam} title={tx("מצלמה")}>{cam ? "📷" : "🚫"}</button>
          <button className="mark-btn" onClick={onClose} title={tx("צא מהחדר")}>✕</button>
        </span>
      </div>
      {msg && <div className="video-msg">{msg}</div>}
      {state === "error" && <div className="video-msg"><button className="mark-btn" onClick={reconnect}>{tx("↻ התחבר מחדש")}</button></div>}
      {state === "on" && audioBlocked && <div className="video-msg"><button className="mark-btn" onClick={unblockAudio}>{tx("🔊 הפעל שמע")}</button></div>}
      {state === "on" && watching && <div className="video-msg"><button className="mark-btn" onClick={joinWithMedia}>{tx("📷🎙 הצטרף עם מצלמה ומיקרופון")}</button> <span>{tx("אתה צופה בלבד — החבר עוד לא רואה ולא שומע אותך.")}</span></div>}
      {state === "on" && !NARROW && tiles.filter((t) => !t.local).length === 0 && <div className="video-msg">{tx("מחכים שהחבר יפתח 📹 וידאו…")}</div>}
      <div className="video-grid">
        {shown.map((t) => <VideoTile key={t.id} tile={t} />)}
      </div>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}
function VideoTile({ tile }) {
  const vRef = useRef(null), aRef = useRef(null);
  useEffect(() => { const el = vRef.current, tr = tile.videoTrack; if (!el || !tr) return; tr.attach(el); return () => { try { tr.detach(el); } catch {} }; }, [tile.videoTrack]);
  useEffect(() => { const el = aRef.current, tr = tile.audioTrack; if (!el || !tr || tile.local) return; tr.attach(el); return () => { try { tr.detach(el); } catch {} }; }, [tile.audioTrack, tile.local]);
  return (
    <div className={"video-tile" + (tile.speaking ? " speaking" : "") + (tile.local ? " local" : "")}>
      {tile.videoTrack ? <video ref={vRef} autoPlay playsInline muted={tile.local} /> : <div className="video-off">{tile.name}</div>}
      {!tile.local && <audio ref={aRef} autoPlay />}
      <span className="video-name">{tile.local ? tx("אתה") : tile.name}</span>
    </div>
  );
}

function ShareBar({ share, peers, me, onTake, onFollow, onLeave, onCopy, copied, video, onVideo, lost, onRejoin, away, onBack }) {
  const holderName = share.holder === me ? tx("אתה") : (peers[share.holder]?.name || share.hostName || "—");
  const online = Object.values(peers);
  const [min, setMin] = useState(() => { try { return localStorage.getItem("lomedtv-share-min") === "1"; } catch { return false; } });
  const toggleMin = () => setMin((m) => { try { localStorage.setItem("lomedtv-share-min", m ? "0" : "1"); } catch {} return !m; });
  /* מצומצם: פס דק — רק מי בחדר ומי מחזיק את הדף; לחיצה פותחת בחזרה */
  /* החיבור נפל — לא בשקט: הודעה וכפתור, גם כשהפס מצומצם */
  if (lost) return (
    <div className="share-bar share-lost" dir={langDir()} role="alert">
      <span>{tx("⚠ החיבור ללימוד המשותף נפל — החבר לא רואה אותך כרגע.")}</span>
      <button className="mark-btn on" onClick={onRejoin}>{tx("↻ הצטרף מחדש")}</button>
      <button className="mark-btn" onClick={onLeave}>✕ {share.hostId === me ? tx("סיים") : tx("צא")}</button>
    </div>
  );
  if (min) return (
    <button className="share-bar share-min" dir={langDir()} onClick={toggleMin} title={tx("הצג את כפתורי הלימוד המשותף")}>
      <span>🕯 {online.length ? online.map((p) => p.name).join(" · ") : tx("מחכה לחבר…")}</span>
      <span className="share-holder">{tx("מחזיק הדף:")} <b>{holderName}</b></span>
      <span className="share-min-open">{tx("▾ הצג")}</span>
    </button>
  );
  return (
    <div className="share-bar" dir={langDir()}>
      {away && <button className="mark-btn on" onClick={onBack}>{tx("📖 חזרה לדף המשותף")}</button>}
      <span className="share-title">{tx("🕯 לימוד משותף")}</span>
      <span className="share-code" title={tx("קוד ההזמנה")}>{share.code}</span>
      <button className="mark-btn share-copy" onClick={onCopy}>{copied ? tx("✓ הועתק") : tx("🔗 העתק קישור")}</button>
      <button className="mark-btn share-invite" onClick={onCopy} title={tx("🔗 העתק קישור")}>{copied ? tx("✓ הועתק") : tx("🔗 הזמן")}</button>
      <span className="share-who">{online.length ? online.map((p) => <span key={p.uid} className="share-peer" style={{ "--c": p.color }}>{p.name}</span>) : <span className="share-wait">{tx("מחכה לחבר…")}</span>}</span>
      <span className="share-holder">{tx("מחזיק הדף:")} <b>{holderName}</b></span>
      {share.holder !== me && <button className="mark-btn" onClick={onTake}>{tx("✋ קח את הדף")}</button>}
      {share.holder !== me && <button className={"mark-btn" + (share.follow ? " on" : "")} onClick={onFollow}>{share.follow ? tx("👁 עוקב") : tx("👁 חופשי")}</button>}
      <button className={"mark-btn" + (video ? " on" : "")} onClick={onVideo}>{video ? tx("📹 סגור וידאו") : tx("📹 וידאו")}</button>
      <button className="mark-btn" onClick={onLeave}>✕ {share.hostId === me ? tx("סיים") : tx("צא")}</button>
      <button className="mark-btn share-hide" onClick={toggleMin} title={tx("צמצם את החלונית לפס דק")}>{tx("▴ הסתר")}</button>
    </div>
  );
}

/* ─── ✍️ לשונית הלומד (צ'אט 19) ───
   לא חלון צף: לשונית קטנה שנפתחת מעל המילה/השורה שלחצו עליה, עם חץ שמצביע עליה, ונעה איתה בגלילה.
   העוגן: המילים שסומנו (.ws-pend) או המשפט ([data-si] בתצוגת הפרק, #para- במגילה) — ובתוכו השורה שבה הייתה הלחיצה.
   מצוירת מחוץ ל-.screen-body (portal) כי ה-zoom של גודל הגופן שם מזיז כל position:fixed שבפנים — זה היה הבאג במק. */
let LAST_POINT = null;
if (typeof window !== "undefined") {
  const rec = (e) => { const p = e.touches ? e.touches[0] : e; if (p && Number.isFinite(p.clientX)) LAST_POINT = { x: p.clientX, y: p.clientY }; };
  window.addEventListener("pointerdown", rec, true);
  window.addEventListener("pointerup", rec, true);
  window.addEventListener("touchend", (e) => { const p = e.changedTouches && e.changedTouches[0]; if (p) LAST_POINT = { x: p.clientX, y: p.clientY }; }, true);
}
/* ─── ✍️ שכבת הלומד על כל טקסט (צ'אט 20) ───
   ההכרעה: שכבת הלומד (מרקר, הדגשה, הערה) היא של הלומד, לא של הטקסט — ולכן היא מגיעה
   לכל מקום שיש בו טקסט, גם למה שהמכונה כתבה (סיכום, מושגים, כרטיסיות). הסימון על
   טקסט של ערוץ נשמר ב-book.flex.layer[מפתח], והמפתח כולל תמצית של הנוסח: סיכום
   שהופק מחדש מקבל מפתח חדש, והסימונים על הנוסח הישן נשארים (עם הנוסח) ונכנסים לשיקוף.
   הכלים משותפים לטקסט הספר ולטקסט הערוצים. */
const HL_COLORS = { y: "#fff3a0", g: "#d3f7c6", p: "#ffd6e8" };
const SENT_RE = /[^.!?׃]+[.!?׃]+["'״׳)\]]*\s*|[^.!?׃]+$/g;
const splitSents = (p) => ((p || "").match(SENT_RE) || [p]).map((t) => t.trim()).filter(Boolean);
function textHash(t) { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
/* מיקום תו בתוך span של משפט (מספרי הערות לא נספרים) */
function offsetInSpan(span, node, off) {
  if (!span || !node) return null;
  let total = 0, found = false;
  const walk = (el) => {
    if (found || !el) return;
    if (el.nodeType === 3) {
      if (el === node) { total += off; found = true; }
      else total += el.nodeValue.length;
    } else if (el.classList && el.classList.contains("note-pin")) {
      /* מספרי הערות לא נספרים */
    } else {
      for (const c of el.childNodes) { walk(c); if (found) return; }
    }
  };
  walk(span);
  return found ? total : null;
}
function snapWord(txt, s, e) {
  s = Math.max(0, Math.min(s, txt.length));
  e = Math.max(s, Math.min(e, txt.length));
  while (s > 0 && !/\s/.test(txt[s - 1])) s--;
  while (e < txt.length && !/\s/.test(txt[e])) e++;
  while (s < e && /\s/.test(txt[s])) s++;
  while (e > s && /\s/.test(txt[e - 1])) e--;
  return [s, e];
}
function applyWordPatch(w, s, e, patch) {
  const out = [];
  let gaps = [[s, e]];
  for (const r of w) {
    if (r.e <= s || r.s >= e) { out.push(r); continue; }
    if (r.s < s) out.push({ ...r, e: s });
    if (r.e > e) out.push({ ...r, s: e });
    const os = Math.max(r.s, s), oe = Math.min(r.e, e);
    if (patch) out.push({ s: os, e: oe, b: r.b, u: r.u, hl: r.hl, ...patch });
    gaps = gaps.flatMap(([gs, ge]) => {
      if (oe <= gs || os >= ge) return [[gs, ge]];
      const parts = [];
      if (gs < os) parts.push([gs, os]);
      if (ge > oe) parts.push([oe, ge]);
      return parts;
    });
  }
  if (patch) for (const [gs, ge] of gaps) if (ge > gs) out.push({ s: gs, e: ge, ...patch });
  return out
    .map((r) => { const o = { s: r.s, e: r.e }; if (r.b) o.b = 1; if (r.u) o.u = 1; if (r.hl) o.hl = r.hl; return o; })
    .filter((r) => (r.b || r.u || r.hl) && r.e > r.s)
    .sort((a, b) => a.s - b.s);
}
/* מציג משפט עם סגנון פר-משפט + טווחי מילים + הבהוב הסימון הממתין (txt = הנוסח המוצג) */
function renderMarked(txt, mk, pend, kara, gloss) {
  const w = (mk && Array.isArray(mk.w)) ? mk.w : [];
  /* סוגריים (מראי מקום, הפניות) מקבלים מחלקה "pr" — מוצגים קטנים ובהירים רק בתוך פסקת פירוש (CSS). הטקסט עצמו לא משתנה, ולכן הסימונים נשארים במקומם. */
  const pr = [];
  if (!gloss && typeof txt === "string" && txt.includes("(")) { const re = /\([^()\n]{1,90}\)/g; let m; while ((m = re.exec(txt))) pr.push([m.index, m.index + m[0].length]); }
  const bad = !gloss && typeof txt === "string" && ZV_BAD.size ? ZV_BAD.get(txt) || [] : [];
  if (!mk && !pend && kara == null && !gloss && !pr.length && !bad.length) return txt;
  const base = {};
  if (mk) {
    if (mk.b) base.fontWeight = 800;
    if (mk.u) base.textDecoration = "underline";
    if (mk.hl) base.background = HL_COLORS[mk.hl];
  }
  if (gloss) return renderGlossed(txt, w, base, kara, gloss);
  if (!w.length && !pend && kara == null && !pr.length && !bad.length) return <span style={base}>{txt}</span>;
  const pts = new Set([0, txt.length]);
  const clamp = (n) => Math.max(0, Math.min(n, txt.length));
  w.forEach((r) => { pts.add(clamp(r.s)); pts.add(clamp(r.e)); });
  if (pend) { pts.add(clamp(pend.s)); pts.add(clamp(pend.e)); }
  if (kara != null) pts.add(clamp(kara));
  pr.forEach(([a, b]) => { pts.add(a); pts.add(b); });
  bad.forEach(([a, b]) => { pts.add(clamp(a)); pts.add(clamp(b)); });
  const arr = [...pts].sort((a, b) => a - b);
  const nodes = [];
  for (let k = 0; k < arr.length - 1; k++) {
    const s = arr[k], e = arr[k + 1];
    if (e <= s) continue;
    const piece = txt.slice(s, e);
    const r = w.find((r2) => clamp(r2.s) <= s && clamp(r2.e) >= e);
    const isPend = pend && clamp(pend.s) <= s && clamp(pend.e) >= e;
    const st = { ...base };
    if (r) {
      if (r.b) st.fontWeight = 800;
      if (r.u) st.textDecoration = "underline";
      if (r.hl) st.background = HL_COLORS[r.hl];
    }
    if (isPend) { if (!st.background) st.background = "#fdeed3"; st.boxShadow = "0 2px 0 var(--amber)"; }
    const done = kara != null && e <= clamp(kara);
    const inPr = pr.some(([a, b]) => a <= s && b >= e);
    const isBad = bad.some(([a, b]) => clamp(a) <= s && clamp(b) >= e);
    const cls = [isPend ? "ws-pend" : "", done ? "kara-done" : "", inPr ? "pr" : "", isBad ? "vf" : ""].filter(Boolean).join(" ") || undefined;
    nodes.push(<span key={k} className={cls} style={Object.keys(st).length ? st : undefined}>{piece}</span>);
  }
  return nodes;
}
/* 📖 המילון הארמי בזמן ההקראה: כל מילה בשורה העליונה, ומתחתיה בקטן הפירוש העברי (gloss[k] למילה ה-k).
   המילים שכבר נקראו מתמלאות כרגיל (kara-done), גם בתוך מילה. */
function renderGlossed(txt, w, base, kara, gloss) {
  const clamp = (n) => Math.max(0, Math.min(n, txt.length));
  const kc = kara == null ? null : clamp(kara);
  const toks = txt.match(/\s+|\S+/g) || [];
  const nodes = [];
  let pos = 0, k = 0;
  for (const t of toks) {
    const s = pos, e = pos + t.length;
    pos = e;
    if (/^\s+$/.test(t)) { nodes.push(t); continue; }
    const r = w.find((r2) => clamp(r2.s) < e && clamp(r2.e) > s);
    const st = { ...base };
    if (r) { if (r.b) st.fontWeight = 800; if (r.u) st.textDecoration = "underline"; if (r.hl) st.background = HL_COLORS[r.hl]; }
    const style = Object.keys(st).length ? st : undefined;
    let top;
    if (kc == null || kc <= s) top = <span className="gl-top" style={style}>{t}</span>;
    else if (kc >= e) top = <span className="gl-top kara-done" style={style}>{t}</span>;
    else top = <span className="gl-top" style={style}><span className="kara-done">{t.slice(0, kc - s)}</span>{t.slice(kc - s)}</span>;
    const g = gloss[k++];
    nodes.push(<span key={s} className="gl-w">{top}<span className="gl-t">{g || "\u00a0"}</span></span>);
  }
  return nodes;
}
/* סרגל הכלים של השכבה — אותם כפתורים בכל מקום */
function MarkTools({ onMark, onNote, onClear }) {
  return (
    <>
      <span className="mark-title">{tx("✍️ שכבת הלומד:")}</span>
      <button className="mark-btn" style={{ fontWeight: 800 }} onClick={() => onMark({ b: 1 })}>{tx("B מודגש")}</button>
      <button className="mark-btn" style={{ textDecoration: "underline" }} onClick={() => onMark({ u: 1 })}>{tx("U קו תחתון")}</button>
      <button className="mark-btn hl-y" onClick={() => onMark({ hl: "y" })}>{tx("מרקר")}</button>
      <button className="mark-btn hl-g" onClick={() => onMark({ hl: "g" })}>{tx("מרקר")}</button>
      <button className="mark-btn hl-p" onClick={() => onMark({ hl: "p" })}>{tx("מרקר")}</button>
      <button className="mark-btn" onClick={onNote}>{tx("📝 הערה")}</button>
      <button className="mark-btn" onClick={() => onMark(null)}>{tx("✕ נקה עיצוב")}</button>
      <button className="mark-btn" onClick={onClear}>{tx("✕ בטל סימון")}</button>
    </>
  );
}
/* טקסט של ערוץ עם שכבת הלומד. layer = book.flex.layer; onChange(key, entry) שומר.
   base = "<פרק>:<ערוץ>:<חלק>"; המפתח הסופי מוסיף את תמצית הנוסח. */
function AiLayer({ text, base, layer, onChange, on, transcribe, as: Tag = "p", className = "" }) {
  const sents = useMemo(() => splitSents(text), [text]);
  const key = base + ":" + textHash(text || "");
  const entry = (layer && layer[key]) || {};
  const marks = entry.marks || {}, notes = entry.notes || {};
  const [sel, setSel] = useState(null);      // {a,b} טווח משפטים | {i,s,e} מילים
  const [noteEd, setNoteEd] = useState(null); // {i, initial}
  const rootRef = useRef(null);
  const justRef = useRef(false);
  useEffect(() => { setSel(null); setNoteEd(null); }, [key]);
  useEffect(() => {
    if (!sel) return;
    const onDown = (e) => { if (rootRef.current?.contains(e.target) || e.target.closest?.(".mark-bar, .note-ed")) return; setSel(null); };
    const onKey = (e) => { if (e.key === "Escape") setSel(null); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [sel]);
  if (!text) return null;
  const sid = (i) => `L:${key}:${i}`;
  const save = (patch) => onChange(key, { ...entry, sents, ...patch, at: Date.now() });
  const armJust = () => { justRef.current = true; setTimeout(() => { justRef.current = false; }, 0); }; // הקליק שאחרי הגרירה לא מבטל אותה
  const onMouseUp = () => {
    if (!on) return;
    const s = window.getSelection?.();
    if (!s || s.isCollapsed) return;
    const idxOf = (node) => { let el = node && (node.nodeType === 3 ? node.parentElement : node); while (el && !(el.dataset && el.dataset.li !== undefined)) el = el.parentElement; return el ? +el.dataset.li : null; };
    const a = idxOf(s.anchorNode), b = idxOf(s.focusNode);
    if (a === null || b === null) return;
    if (a === b) {
      const span = rootRef.current.querySelector(`[data-li="${a}"]`);
      const so = offsetInSpan(span, s.anchorNode, s.anchorOffset), eo = offsetInSpan(span, s.focusNode, s.focusOffset);
      if (so !== null && eo !== null && so !== eo) {
        const [ws, we] = snapWord(sents[a], Math.min(so, eo), Math.max(so, eo));
        if (we > ws) { setSel(we - ws >= sents[a].trim().length ? { a, b: a } : { i: a, s: ws, e: we }); s.removeAllRanges(); armJust(); return; }
      }
    }
    setSel({ a: Math.min(a, b), b: Math.max(a, b) }); s.removeAllRanges(); armJust();
  };
  const onClick = (i) => {
    if (!on) return;
    if (justRef.current) { justRef.current = false; return; }
    if (sel && sel.a !== undefined && sel.b === undefined) setSel({ a: Math.min(sel.a, i), b: Math.max(sel.a, i) });
    else if (sel && sel.a === i && sel.b === i) setSel(null);
    else setSel({ a: i, b: i });
  };
  const applyMark = (patch) => {
    if (!sel) return;
    const m = { ...marks };
    if (sel.i !== undefined) {
      const cur = { ...(m[sel.i] || {}) };
      const w = applyWordPatch(Array.isArray(cur.w) ? cur.w : [], sel.s, sel.e, patch);
      if (w.length) cur.w = w; else delete cur.w;
      if (patch === null && !w.length) { delete cur.b; delete cur.u; delete cur.hl; }
      if (Object.keys(cur).length) m[sel.i] = cur; else delete m[sel.i];
    } else {
      for (let i = sel.a; i <= sel.b; i++) {
        if (patch === null) delete m[i];
        else { const kept = m[i] && m[i].w ? { w: m[i].w } : {}; m[i] = { ...(m[i] || {}), ...kept, ...patch }; }
      }
    }
    save({ marks: m }); setSel(null);
  };
  const saveNote = (i, txt) => {
    const n = { ...notes };
    if (txt.trim()) n[i] = { t: txt.trim(), src: (sents[i] || "").slice(0, 160) }; else delete n[i];
    save({ notes: n }); setNoteEd(null); setSel(null);
  };
  const noteIdx = Object.keys(notes).map(Number).sort((x, y) => x - y);
  const anchor = sel ? (sel.i !== undefined ? sel.i : sel.b) : null;
  return (
    <>
      <Tag ref={rootRef} className={"ai-layer " + className} onMouseUp={onMouseUp}>
        {sents.map((t, i) => {
          const inRange = sel && sel.a !== undefined && i >= sel.a && i <= sel.b;
          return (
            <span key={i} data-li={i} data-si={sid(i)} className={"scroll-sent " + (on ? "clickable " : "") + (inRange ? "in-range " : "") + (notes[i] ? "has-note " : "")} onClick={() => onClick(i)}>
              {renderMarked(t, marks[i], sel && sel.i === i ? sel : null)}
              {notes[i] && <sup className="note-pin" title={notes[i].t} onClick={(e) => { e.stopPropagation(); setNoteEd({ i, initial: notes[i].t }); }}>[{noteIdx.indexOf(i) + 1}]</sup>}{" "}
            </span>
          );
        })}
      </Tag>
      {noteIdx.length > 0 && (
        <ol className="ai-notes">
          {noteIdx.map((i, k) => <li key={i} onClick={() => setNoteEd({ i, initial: notes[i].t })}><b>[{k + 1}]</b> {notes[i].t}</li>)}
        </ol>
      )}
      {on && sel && (
        <FloatingMarkBar anchorIdx={sid(anchor)} word={sel.i !== undefined}>
          <MarkTools onMark={applyMark} onNote={() => setNoteEd({ i: sel.i !== undefined ? sel.i : sel.a, initial: notes[sel.i !== undefined ? sel.i : sel.a]?.t || "" })} onClear={() => setSel(null)} />
        </FloatingMarkBar>
      )}
      {noteEd && (
        <NoteEditor key={noteEd.i} initial={noteEd.initial} src={(sents[noteEd.i] || "").slice(0, 90)} transcribe={transcribe}
          onSave={(t) => saveNote(noteEd.i, t)} onCancel={() => setNoteEd(null)} />
      )}
    </>
  );
}

function FloatingMarkBar({ anchorIdx, word, children }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const offRef = useRef(null); // המרחק של השורה שנלחצה מראש המשפט + מיקום X בתוכו — כדי שהלשונית תישאר באותה שורה בגלילה
  useEffect(() => { offRef.current = null; }, [anchorIdx, word]);
  useEffect(() => {
    const place = () => {
      const el = word ? document.querySelector(".ws-pend") : anchorIdx == null ? null : (document.querySelector(`[data-si="${String(anchorIdx).replace(/"/g, '\\"')}"]`) || document.getElementById("para-" + anchorIdx));
      if (!el) { setPos(null); return; }
      const r = el.getBoundingClientRect();
      const box = el.closest(".screen-body")?.getBoundingClientRect();
      const topLim = Math.max(0, box ? box.top : 0), botLim = Math.min(window.innerHeight, box ? box.bottom : window.innerHeight);
      if (!(r.bottom > topLim + 10 && r.top < botLim - 10)) { setPos(null); return; }
      if (!offRef.current) {
        const rects = [...el.getClientRects()].filter((q) => q.width > 0);
        let line = rects[0] || r;
        if (LAST_POINT) {
          const hit = rects.find((q) => LAST_POINT.y >= q.top - 2 && LAST_POINT.y <= q.bottom + 2);
          line = hit || rects.reduce((best, q) => Math.abs((q.top + q.bottom) / 2 - LAST_POINT.y) < Math.abs((best.top + best.bottom) / 2 - LAST_POINT.y) ? q : best, line);
        }
        const x = LAST_POINT && LAST_POINT.x >= line.left - 4 && LAST_POINT.x <= line.right + 4 ? LAST_POINT.x : (line.left + line.right) / 2;
        offRef.current = { dy: line.top - r.top, dyb: line.bottom - r.top, dx: x - r.left };
      }
      const o = offRef.current;
      const lineTop = r.top + o.dy, lineBottom = r.top + o.dyb, cx = r.left + o.dx;
      const h = ref.current?.offsetHeight || 44, w = ref.current?.offsetWidth || 320;
      const above = lineTop - h - 10;
      const flip = above < topLim + 4;
      const top = flip ? lineBottom + 10 : above;
      const left = Math.min(Math.max(6, cx - w / 2), Math.max(6, window.innerWidth - w - 6));
      setPos({ top, left, arrow: Math.min(Math.max(14, cx - left), w - 14), flip });
    };
    place();
    const id = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { cancelAnimationFrame(id); window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [anchorIdx, word]);
  const style = pos ? { top: pos.top, left: pos.left, "--arrow": pos.arrow + "px" } : { bottom: 12, left: "50%", transform: "translateX(-50%)" };
  const node = (
    <div ref={ref} className={"mark-bar floating" + (pos ? (pos.flip ? " below" : " above") : " parked")} style={style} dir={langDir()}>
      {children}
    </div>
  );
  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}

/* ─── 📜 זוהר עם סולם צמוד (מעגל 18) ───
   פסקת "הסולם:" (או "פירוש:" מצלם דף חכם) = פירוש; הפסקה שלפניה (האות) = הארמית, מובלטת.
   השער "משוך מאמר" מביא את הארמית ואת הסולם ישירות מספריא, לפי פרשה ואותיות — בלי עיבוד בדרך. */
const SULAM_RE = /^(הסולם|פירוש):/;
/* ─── נִקּוּד (צ'אט 20) ───
   הניקוד הוא שכבת תצוגה: המשפט השמור נשאר בלי ניקוד, והנוסח המנוקד (מהנקדן של דיקטה,
   דרך netlify/functions/nikud) נשמר לידו ב-book.flex.nikud[i]. המרקרים נשמרים לפי מיקום
   התו במשפט השמור, ולכן כל מעבר בין שני הנוסחים עובר דרך nikudOff. */
const NIKUD_MARK = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/;
const NIKUD_MARKS = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;
const stripNikud = (t) => (t || "").replace(NIKUD_MARKS, "");
const NIKUD_BATCH = 3000; // תווים לבקשה אחת
const NIKUD_SCROLL_MAX = 80000; // במגילה מנקדים ספר שלם רק עד הגודל הזה; ספר גדול יותר מנוקד פרק-פרק
/* ממיר מיקום תו בין שני נוסחים של אותו משפט (עם ניקוד ובלי): סופר אותיות, מדלג על סימני ניקוד */
function nikudOff(from, to, off) {
  let n = 0;
  for (let k = 0; k < off && k < from.length; k++) if (!NIKUD_MARK.test(from[k])) n++;
  let k = 0;
  while (k < to.length && n > 0) { if (!NIKUD_MARK.test(to[k])) n--; k++; }
  while (k < to.length && NIKUD_MARK.test(to[k])) k++;
  return k;
}
const isSulamPara = (sentences, g) => !!g && SULAM_RE.test(sentences[g[0]] || "");
const SEFARIA = "https://www.sefaria.org/api";
/* שמות הפרשות כפי שספריא קוראת להן ב-"Sulam on Zohar" — המספור של האותיות שם זהה לספר המודפס */
const ZOHAR_PARSHIOT = [
  ["Introduction", "הקדמת ספר הזוהר"], ["Bereshit I", "בראשית א"], ["Bereshit II", "בראשית ב"], ["Noach", "נח"],
  ["Lech Lecha", "לך לך"], ["Vayera", "וירא"], ["Chayei Sara", "חיי שרה"], ["Toldot", "תולדות"], ["Vayetzei", "ויצא"],
  ["Vayishlach", "וישלח"], ["Vayeshev", "וישב"], ["Miketz", "מקץ"], ["Vayigash", "ויגש"], ["Vayechi", "ויחי"],
  ["Shemot", "שמות"], ["Vaera", "וארא"], ["Bo", "בא"], ["Beshalach", "בשלח"], ["Yitro", "יתרו"], ["Mishpatim", "משפטים"],
  ["Terumah", "תרומה"], ["Sifra DiTzniuta", "ספרא דצניעותא"], ["Tetzaveh", "תצוה"], ["Ki Tisa", "כי תשא"],
  ["Vayakhel", "ויקהל"], ["Pekudei", "פקודי"], ["Vayikra", "ויקרא"], ["Tzav", "צו"], ["Shmini", "שמיני"],
  ["Tazria", "תזריע"], ["Metzora", "מצורע"], ["Achrei Mot", "אחרי מות"], ["Kedoshim", "קדושים"], ["Emor", "אמור"],
  ["Behar", "בהר"], ["Bechukotai", "בחקותי"], ["Bamidbar", "במדבר"], ["Nasso", "נשא"], ["Idra Rabba", "אדרא רבא"],
  ["Beha'alotcha", "בהעלותך"], ["Sh'lach", "שלח לך"], ["Korach", "קרח"], ["Chukat", "חקת"], ["Balak", "בלק"],
  ["Pinchas", "פנחס"], ["Matot", "מטות"], ["Vaetchanan", "ואתחנן"], ["Eikev", "עקב"], ["Shoftim", "שופטים"],
  ["Ki Teitzei", "כי תצא"], ["Vayeilech", "וילך"], ["Ha'Azinu", "האזינו"], ["Idra Zuta", "אדרא זוטא"],
  /* השמטות (צ'אט 27): בספריא הן "תוספות" של ספר הזוהר — לשון הזוהר המנוקדת בלבד; "הסולם על הזוהר" אינו כולל אותן */
  ["Addenda, Volume I", "השמטות · כרך א (בלי סולם)"], ["Addenda, Volume II", "השמטות · כרך ב (בלי סולם)"], ["Addenda, Volume III", "השמטות · כרך ג (בלי סולם)"],
];
const isZoharAddenda = (en) => /^Addenda/.test(en || "");
const ZOHAR_DEFAULT_PARASHA = 13; // ויחי
/* אות → מספר (קמג → 143). מקבל גם ספרות, גרשיים וגרש. 0 = לא תקין */
function gematria(s) {
  s = (s || "").trim();
  if (/^\d+$/.test(s)) return +s;
  const v = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };
  let n = 0;
  for (const c of s) {
    if (v[c]) n += v[c];
    else if (!/["'״׳\s().]/.test(c)) return 0;
  }
  return n;
}
/* רשימת המאמרים של פרשה: הגבולות מחלוקת ספריא (shape — אורכי המאמרים), השמות מקובץ המפתח public/zohar-names.json (לפי סדר) */
let zoharNamesCache = null;
async function fetchZoharArticles(en) {
  const enc = encodeURIComponent(en.replace(/ /g, "_"));
  const r = await fetch(`${SEFARIA}/shape/Zohar,_${enc}`);
  if (!r.ok) throw new Error(`ספריא ${r.status}`);
  const j = await r.json();
  const lens = (Array.isArray(j) ? j[0] : j)?.chapters;
  if (!Array.isArray(lens) || !lens.length) throw new Error("אין חלוקה למאמרים");
  if (!zoharNamesCache) {
    try { zoharNamesCache = await (await fetch("/zohar-names.json")).json(); } catch { zoharNamesCache = {}; }
  }
  const names = zoharNamesCache?.[en] || [];
  let at = 1;
  return lens.map((len, i) => {
    const a = { n: i + 1, from: at, to: at + len - 1, name: names[i] || "" };
    at += len;
    return a;
  });
}
const stripTags = (h) => String(h || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
/* מושך מאמר: הסולם בבקשה אחת (טווח אותיות), לשון הזוהר דרך הקישורים של כל אות.
   מחזיר טקסט במבנה שהתצוגה מכירה: "אות) ארמית" ואחריה פסקאות "הסולם: …" */
async function fetchZoharArticle(en, he, from, to, name, onProgress) {
  const enc = encodeURIComponent(en.replace(/ /g, "_"));
  const j = async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`ספריא השיבה ${r.status}`);
    return r.json();
  };
  if (isZoharAddenda(en)) {
    /* השמטות: האות היא המספר הרץ של הקטעים בכרך (סימן א = אות א, סימן ב = אותיות ב–ה…). אין סולם — רק לשון הזוהר. */
    onProgress?.("📜 מושך את לשון הזוהר…");
    const sh = await j(`${SEFARIA}/shape/Zohar,_${enc}`);
    const lens = (Array.isArray(sh) ? sh[0] : sh)?.chapters || [];
    const pos = [];
    lens.forEach((len, si) => { for (let k = 0; k < len; k++) pos.push([si + 1, k]); });
    if (!pos.length) throw new Error("לא נמצאה חלוקת ההשמטות בספריא");
    if (to > pos.length) throw new Error(`בכרך הזה יש ${pos.length} אותיות בלבד`);
    const need = [...new Set(pos.slice(from - 1, to).map(([si]) => si))];
    const secs = {};
    await Promise.all(need.map(async (si) => {
      const r = await j(`${SEFARIA}/v3/texts/Zohar,_${enc}.${si}?version=hebrew`);
      const t = r?.versions?.[0]?.text;
      secs[si] = Array.isArray(t) ? t.flat(3) : [t];
    }));
    const parts = [];
    for (let n = from; n <= to; n++) {
      const [si, k] = pos[n - 1];
      parts.push(`${hebNum(n)}) ${stripTags(secs[si]?.[k]) || "(לשון הזוהר לאות הזאת לא נמצאה בספריא)"}`);
    }
    return `${name}\nזוהר ${he.replace(/ \(.*\)$/, "")} · אותיות ${hebNum(from)}–${hebNum(to)} · מספריא\n\n${parts.join("\n\n")}`;
  }
  onProgress?.("📜 מושך את הסולם מספריא…");
  const sul = await j(`${SEFARIA}/v3/texts/Sulam_on_Zohar,_${enc}.${from}${to > from ? "-" + to : ""}`);
  let st = sul?.versions?.[0]?.text;
  if (!st || (Array.isArray(st) && !st.length)) throw new Error("לא נמצא הסולם לאותיות האלה");
  if (to === from) st = [st];
  const sulam = st.map((x) => (Array.isArray(x) ? x.flat(3) : [x]));
  onProgress?.("📜 מושך את לשון הזוהר…");
  const ots = [];
  for (let n = from; n <= to; n++) ots.push(n);
  const links = await Promise.all(
    ots.map((n) => j(`${SEFARIA}/links/Sulam_on_Zohar,_${enc}.${n}?with_text=1`).catch(() => []))
  );
  const parts = ots.map((n, i) => {
    const zl = (Array.isArray(links[i]) ? links[i] : []).find((l) => /^Zohar,/.test(l.ref || ""));
    let ar = zl ? zl.he : "";
    if (Array.isArray(ar)) ar = ar.flat(3).join(" ");
    ar = stripTags(ar);
    const segs = (sulam[i] || []).map(stripTags).filter(Boolean);
    return [`${hebNum(n)}) ${ar || "(לשון הזוהר לאות הזאת לא נמצאה בספריא)"}`, ...segs.map((s) => "הסולם: " + s)].join("\n\n");
  });
  return `${name}\nזוהר ${he} · אותיות ${hebNum(from)}–${hebNum(to)} · מספריא\n\n${parts.join("\n\n")}`;
}
/* ─── 🔍 אימות מול מקור (צ'אט 27) ───
   גוף הזוהר שנסרק מושווה מילה במילה מול ספריא. ההשוואה היא קוד ולא מודל: מתעלמת מניקוד ומכתיב מלא/חסר,
   ומחזירה רק את המקומות השונים. ההכרעה בכל מקום — של הלומד: לקבל את המקור, להשאיר, או לתקן ביד. */
const ZV_BAD = new Map(); // נוסח משפט → טווחי תווים שלא אומתו (לצביעה בתצוגה)
const zvStrip = (w) => String(w || "").replace(/[֑-ׇ]/g, "").replace(/[^א-ת]/g, "");
function zvCanon(w) {
  const x = zvStrip(w);
  if (x === "יי" || x === "ה" || x === "יהוה") return "יהוה";
  return x.replace(/[וי]/g, "") || x;
}
const zvWords = (t) => String(t || "").split(/\s+/).filter((w) => zvStrip(w));
/* נוסח ספריא: בלי תגיות, בלי סוגריים (מראי מקום, חילופי נוסח), בלי פיסוק */
const zvCleanRef = (t) => stripTags(t).replace(/\([^()]*\)/g, " ").replace(/[.,:;!?׃]/g, " ").replace(/\s+/g, " ").trim();
/* הבדלים בין מילות הסריקה למילות המקור (LCS). מחזיר { ok, total, diffs: [{ a0, a1, b0, b1 }] } */
function zvDiff(A, B) {
  const a = A.map(zvCanon), b = B.map(zvCanon), n = a.length, m = b.length;
  const W = m + 1, T = new Uint16Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i * W + j] = a[i] === b[j] ? T[(i + 1) * W + j + 1] + 1 : Math.max(T[(i + 1) * W + j], T[i * W + j + 1]);
  const diffs = [];
  let i = 0, j = 0, cur = null;
  const flush = () => { if (cur) { diffs.push(cur); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; continue; }
    if (!cur) cur = { a0: i, a1: i, b0: j, b1: j };
    if (j >= m || (i < n && T[(i + 1) * W + j] >= T[i * W + j + 1])) { i++; cur.a1 = i; } else { j++; cur.b1 = j; }
  }
  flush();
  return { ok: T[0], total: m, diffs };
}
/* פסקאות הזוהר שבפרק: [{ n, label, pi (מספר הפסקה), text (בלי הסימון) }] */
function zvParas(chText) {
  const out = [];
  String(chText || "").split(/\n{2,}/).forEach((p, pi) => {
    const m = p.trim().match(/^([א-ת]{1,4})['׳]?\)\s*([\s\S]*)$/);
    if (!m || SULAM_RE.test(p.trim())) return;
    const n = gematria(m[1]);
    const letters = (m[2].match(/[א-ת]/g) || []).length;
    if (n && letters >= 8 && (m[2].match(/[ְ-ׇּׁׂ]/g) || []).length / letters > 0.3) out.push({ n, label: m[1], pi, text: m[2] });
  });
  return out;
}
/* לשון הזוהר מספריא לאותיות שהתבקשו: { n: טקסט }. פרשה רגילה — דרך הקישורים של הסולם; השמטות — לפי המספר הרץ בכרך. */
async function fetchZoharSource(en, ns) {
  const enc = encodeURIComponent(en.replace(/ /g, "_"));
  const j = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`ספריא השיבה ${r.status}`); return r.json(); };
  const out = {};
  if (isZoharAddenda(en)) {
    const sh = await j(`${SEFARIA}/shape/Zohar,_${enc}`);
    const lens = (Array.isArray(sh) ? sh[0] : sh)?.chapters || [];
    const pos = [];
    lens.forEach((len, si) => { for (let k = 0; k < len; k++) pos.push([si + 1, k]); });
    const need = [...new Set(ns.filter((n) => pos[n - 1]).map((n) => pos[n - 1][0]))];
    const secs = {};
    await Promise.all(need.map(async (si) => { const r = await j(`${SEFARIA}/v3/texts/Zohar,_${enc}.${si}?version=hebrew`); const t = r?.versions?.[0]?.text; secs[si] = Array.isArray(t) ? t.flat(3) : [t]; }));
    for (const n of ns) { const q = pos[n - 1]; if (q && secs[q[0]]?.[q[1]]) out[n] = zvCleanRef(secs[q[0]][q[1]]); }
  } else {
    await Promise.all(ns.map(async (n) => {
      const links = await j(`${SEFARIA}/links/Sulam_on_Zohar,_${enc}.${n}?with_text=1`).catch(() => []);
      const zl = (Array.isArray(links) ? links : []).find((l) => /^Zohar,/.test(l.ref || ""));
      let ar = zl ? zl.he : "";
      if (Array.isArray(ar)) ar = ar.flat(3).join(" ");
      if (ar) out[n] = zvCleanRef(ar);
    }));
  }
  return out;
}
/* מחשב את מצב האימות של פרק מול נוסחי מקור שמורים (refs: { n: טקסט }, skip: הבדלים שהלומד בחר להשאיר) */
function zvCompute(chText, refs, skip) {
  const items = [];
  let ok = 0, total = 0;
  for (const p of zvParas(chText)) {
    const ref = refs?.[p.n];
    if (!ref) { items.push({ ...p, missing: true, diffs: [] }); continue; }
    const A = zvWords(p.text), B = zvWords(ref);
    const d = zvDiff(A, B);
    const diffs = d.diffs.map((x) => ({ ...x, got: A.slice(x.a0, x.a1).join(" "), want: B.slice(x.b0, x.b1).join(" ") }))
      .map((x) => ({ ...x, id: `${p.n}|${zvStrip(x.got)}|${zvStrip(x.want)}` }));
    const open = diffs.filter((x) => !skip?.[x.id]);
    const kept = diffs.length - open.length;
    total += Math.max(d.total, A.length);
    ok += Math.max(d.total, A.length) - open.reduce((t, x) => t + Math.max(x.a1 - x.a0, x.b1 - x.b0), 0);
    items.push({ ...p, words: A, diffs: open, kept });
  }
  return { items, ok: Math.max(0, ok), total };
}
/* מחליף בפסקת האות את המילים a0..a1 בנוסח חדש. הפיסוק של הסריקה נשמר (כדי שחלוקת המשפטים לא תזוז). מחזיר את נוסח הפרק החדש. */
function zvApply(chText, pi, a0, a1, repl) {
  const paras = String(chText || "").split(/(\n{2,})/); // שומר על המפרידים
  let k = -1, idx = -1;
  for (let x = 0; x < paras.length; x += 2) { if (paras[x].trim()) k++; else continue; if (k === pi) { idx = x; break; } }
  /* pi נספר כמו ב-zvParas: לפי split(/\n{2,}/) כולל פסקאות ריקות */
  const plain = String(chText || "").split(/\n{2,}/);
  const target = plain[pi];
  if (target == null) return chText;
  const m = target.match(/^(\s*[א-ת]{1,4}['׳]?\)\s*)([\s\S]*)$/);
  if (!m) return chText;
  const toks = m[2].split(/(\s+)/); // מילים ורווחים לסירוגין
  const wordIdx = [];
  toks.forEach((t, x) => { if (t.trim() && zvStrip(t)) wordIdx.push(x); });
  const END = /[.,:;!?׃]+["'״׳)\]]*$/;
  const newWords = String(repl || "").replace(/[.!?׃]/g, "").split(/\s+/).filter(Boolean);
  if (a1 > a0) {
    const first = wordIdx[a0], last = wordIdx[a1 - 1];
    if (first == null || last == null) return chText;
    const tail = (toks[last].match(END) || [""])[0];
    if (newWords.length) { newWords[newWords.length - 1] = newWords[newWords.length - 1].replace(END, "") + tail; toks.splice(first, last - first + 1, newWords.join(" ")); }
    else {
      /* מחיקה: הפיסוק עובר למילה שלפני; מוחקים גם רווח אחד */
      if (tail && a0 > 0) toks[wordIdx[a0 - 1]] = toks[wordIdx[a0 - 1]].replace(END, "") + tail;
      toks.splice(first, last - first + 1 + (toks[last + 1] != null && !toks[last + 1].trim() ? 1 : 0));
    }
  } else if (newWords.length) {
    /* הוספה לפני המילה a0 (או בסוף) */
    const at = wordIdx[a0];
    if (at == null) toks.push(" " + newWords.join(" ")); else toks.splice(at, 0, newWords.join(" ") + " ");
  }
  plain[pi] = m[1] + toks.join("");
  /* מרכיבים מחדש עם המפרידים המקוריים */
  const seps = String(chText || "").match(/\n{2,}/g) || [];
  return plain.map((x, q) => x + (seps[q] || "")).join("");
}
function paraKind(sentences, groups, pi) {
  if (isSulamPara(sentences, groups[pi])) return " sulam";
  if (isSulamPara(sentences, groups[pi + 1])) return " zohar";
  return "";
}

/* ─── כל טקסט הספר כמשפטים — האינדקס הגלובלי שבו נשמרים מרקרים והערות ───
   משמש גם את המגילה (useMemo בתוך האפליקציה) וגם את "שיקוף" (מחוץ לה). */
function bookSentences(book) {
  const sentences = [];
  const paraGroups = [];
  const chapterRanges = []; // בקשה ג': טווח המשפטים הגלובלי של כל פרק — [התחלה, סוף)
  if (!book) return { sentences, paraGroups, chapterRanges };
  for (const c of book.chapters || []) {
    const chStart = sentences.length;
    const paras = (c.text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    for (const p of paras) {
      const parts = p.match(/[^.!?׃]+[.!?׃]+["'״׳)\]]*\s*|[^.!?׃]+$/g) || [p];
      const start = sentences.length;
      for (const s of parts) {
        const t = s.trim();
        if (t) sentences.push(t);
      }
      if (sentences.length > start) paraGroups.push([start, sentences.length - start]);
    }
    chapterRanges.push([chStart, sentences.length]);
  }
  return { sentences, paraGroups, chapterRanges };
}

/* ─── 🎧 שיקוף (ערוץ 08) — חומר הגלם: השיחה של הלומד עם הספר ───
   כמה "מילים" הלומד השאיר בספר: הערות + משפטים מסומנים. הכפתור מופיע מסף 3. */
const MIRROR_MIN = 3;
const MIRROR_LENGTHS = [
  { id: "short", label: "קצר", mins: "כ-5 דק'", chunks: 4 },
  { id: "medium", label: "בינוני", mins: "כ-10 דק'", chunks: 8 },
  { id: "full", label: "מלא", mins: "כ-20 דק'", chunks: 16 },
];
function talkCount(book) {
  if (!book) return 0;
  const notes = Object.keys(book.notes || {}).filter((k) => (book.notes[k]?.t || "").trim()).length;
  const marks = Object.keys(book.marks || {}).length;
  return notes + marks;
}
/* ההערות והסימונים כטקסט — לפי סדר הופעתם בספר */
function mirrorMaterial(book) {
  const { sentences } = bookSentences(book);
  const notes = Object.keys(book.notes || {})
    .map(Number).filter((i) => !isNaN(i) && (book.notes[i]?.t || "").trim())
    .sort((a, b) => a - b)
    .map((i) => ({ src: (book.notes[i].src || sentences[i] || "").slice(0, 200), text: book.notes[i].t.trim() }));
  const marks = Object.keys(book.marks || {})
    .map(Number).filter((i) => !isNaN(i) && sentences[i])
    .sort((a, b) => a - b)
    .map((i) => {
      const mk = book.marks[i] || {};
      const s = sentences[i];
      /* סימון של מילים בתוך המשפט — לוקחים רק אותן; אחרת המשפט כולו */
      const ranges = Array.isArray(mk.w) ? mk.w.filter((r) => r.e > r.s) : [];
      const text = ranges.length && !mk.hl && !mk.b && !mk.u
        ? ranges.map((r) => s.slice(r.s, r.e).trim()).filter(Boolean).join(" … ")
        : s;
      return { text: text.slice(0, 240), color: mk.hl || (ranges.find((r) => r.hl) || {}).hl || "" };
    })
    .filter((m) => m.text);
  /* ✍️ השכבה על טקסט של ערוצים (סיכום, מושגים, כרטיסיות) — גם היא מהלומד, ונכנסת לשיחה */
  for (const e of Object.values(book.flex?.layer || {})) {
    const ss = Array.isArray(e.sents) ? e.sents : [];
    for (const [i, n] of Object.entries(e.notes || {})) if ((n?.t || "").trim()) notes.push({ src: (n.src || ss[i] || "").slice(0, 200), text: n.t.trim(), ai: true });
    for (const [i, mk] of Object.entries(e.marks || {})) {
      const t = ss[i]; if (!t) continue;
      const ranges = Array.isArray(mk.w) ? mk.w.filter((r) => r.e > r.s) : [];
      const text = ranges.length && !mk.hl && !mk.b && !mk.u ? ranges.map((r) => t.slice(r.s, r.e).trim()).filter(Boolean).join(" … ") : t;
      if (text) marks.push({ text: text.slice(0, 240), color: mk.hl || (ranges.find((r) => r.hl) || {}).hl || "", ai: true });
    }
  }
  return { notes, marks };
}
/* חלוקת התסריט לחתיכות של עד 700 תווים — בלי לשבור רפליקה.
   צ'אט 16: חתיכה של 1,900 תווים לקחה ל-ElevenLabs יותר מ-60 שניות (תקרת נטליפיי) ונהרגה.
   700 תווים ≈ 15–25 שניות לחתיכה — בטוח. תסריט קצר = 4–5 חלקים, המכסה היומית 30. */
const VOICE_CHUNK = 700;
function chunkScript(lines, max = VOICE_CHUNK) {
  const chunks = [];
  let cur = [], n = 0;
  for (const l of lines) {
    const parts = l.t.length <= max ? [l.t] : (l.t.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) || [l.t]);
    for (const p of parts) {
      const t = p.trim();
      if (!t) continue;
      if (n + t.length > max && cur.length) { chunks.push(cur); cur = []; n = 0; }
      cur.push({ s: l.s, t });
      n += t.length;
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/* קובץ הקול נשמר גם במכשיר (IndexedDB) — להאזנה חוזרת בלי רשת */
const voiceKey = (id) => "ltv-voice-" + id;
 
/* ─── תצוגות הערוצים ─── */
 
function SummaryView({ data, question, layer }) {
  const [mode, setMode] = useState("long");
  const L = (part, text, extra) => layer ? <AiLayer {...layer} base={layer.base + ":" + part} text={text} {...(extra || {})} /> : null;
  return (
    <div>
      <div className="pill-row">
        <button className={"pill " + (mode === "long" ? "on" : "")} onClick={() => setMode("long")}>{tx("מפורט")}</button>
        <button className={"pill " + (mode === "short" ? "on" : "")} onClick={() => setMode("short")}>{tx("קצר")}</button>
      </div>
      {layer ? L(mode, mode === "long" ? data.long : data.short, { className: "prose" }) : <p className="prose">{mode === "long" ? data.long : data.short}</p>}
      {data.forQuestion && question && (
        <div className="my-q my-q-answer">
          <span className="my-q-ic">❓</span>
          <span className="my-q-body">
            <small>{tx("לשאלה שאתה נושא —")} «{question}»</small>
            {layer ? L("q", data.forQuestion, { as: "span" }) : data.forQuestion}
          </span>
        </div>
      )}
    </div>
  );
}
 
function ConceptsView({ data, onTrace, layer }) {
  const L = (part, text, extra) => layer ? <AiLayer {...layer} base={layer.base + ":" + part} text={text} {...(extra || {})} /> : text;
  return (
    <div className="concepts">
      {onTrace && <p className="fm-hint">{tx("💡 לחיצה על מושג או כלל קופצת למקור בטקסט ומסמנת אותו בירוק.")}</p>}
      {data.concepts?.length > 0 && (
        <section>
          <h3 className="sec-title">{tx("מושגים")}</h3>
          {data.concepts.map((c, i) => (
            <div className="term-row" key={i}>
              <span
                className={"term" + (onTrace ? " traceable" : "")}
                onClick={onTrace ? () => onTrace(c.term) : undefined}
                title={onTrace ? tx("הצג את המקור בטקסט") : undefined}
              >{c.term}</span>
              {layer ? L("c" + i, c.definition, { as: "span", className: "def" }) : <span className="def">{c.definition}</span>}
            </div>
          ))}
        </section>
      )}
      {data.rules?.length > 0 && (
        <section>
          <h3 className="sec-title">{tx("כללים ועקרונות")}</h3>
          <ul className="rules">
            {data.rules.map((r, i) => (
              <li
                key={i}
                className={onTrace && !layer ? "traceable" : undefined}
                onClick={onTrace && !layer ? () => onTrace(r) : undefined}
                title={onTrace && !layer ? tx("הצג את המקור בטקסט") : undefined}
              >{layer ? <>{L("r" + i, r, { as: "span" })}{onTrace && <button className="trace-btn" title={tx("הצג את המקור בטקסט")} onClick={() => onTrace(r)}>{tx("↪ למקור")}</button>}</> : r}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
 
/* מפת חשיבה צפה: צמתים גרירים, ענפים נפתחים/נסגרים בלחיצה */
function MindmapView({ data }) {
  const W = 860, H = 540;
  const mains = data.children || [];
  const layout = useMemo(() => {
    const p = { root: { x: W / 2, y: H / 2 } };
    mains.forEach((m, i) => {
      const ang = (2 * Math.PI * i) / Math.max(mains.length, 1) - Math.PI / 2;
      p["m" + i] = { x: W / 2 + 185 * Math.cos(ang), y: H / 2 + 150 * Math.sin(ang) };
      (m.children || []).forEach((c, j) => {
        const a2 = ang + (j - ((m.children || []).length - 1) / 2) * 0.34;
        p["m" + i + "c" + j] = { x: W / 2 + 345 * Math.cos(a2), y: H / 2 + 245 * Math.sin(a2) };
      });
    });
    return p;
  }, [data]);
  const [pos, setPos] = useState(layout);
  useEffect(() => setPos(layout), [layout]);
  const [closed, setClosed] = useState({});
  const drag = useRef(null);
  const moved = useRef(false);

  /* בטלפון המפה (860 רוחב) מוקטנת לרוחב המסך — מתאימים גם את הגרירה לקנה המידה */
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const fit = () => setScale(Math.max(0.55, Math.min(1, (el.clientWidth || W) / W))); /* לא פחות מ-55% — מתחת לזה לא קריא; השאר בגלילה */
    fit(); const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null; ro?.observe(el);
    /* במפה מוקטנת: להתחיל מהמרכז (בגלילה RTL הערכים שליליים) */
    setTimeout(() => { const c = el.querySelector(".fm-canvas"); if (c && c.scrollWidth > c.clientWidth) c.scrollLeft = -(c.scrollWidth - c.clientWidth) / 2; }, 50);
    return () => ro?.disconnect();
  }, []);
  const down = (id) => (e) => {
    e.preventDefault();
    moved.current = false;
    drag.current = { id, dx: pos[id].x - e.clientX / scale, dy: pos[id].y - e.clientY / scale };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    moved.current = true;
    setPos((p) => ({ ...p, [d.id]: { x: e.clientX / scale + d.dx, y: e.clientY / scale + d.dy } }));
  };
  const up = () => { drag.current = null; };
  const toggle = (i) => {
    if (moved.current) return;
    setClosed((c) => ({ ...c, [i]: !c[i] }));
  };

  const node = (id, label, cls, onClick) => (
    <div
      key={id}
      className={"fm-node " + cls}
      style={{ left: pos[id]?.x, top: pos[id]?.y }}
      onPointerDown={down(id)}
      onClick={onClick}
    >
      {label}
    </div>
  );

  return (
    <div className="fm-wrap" ref={wrapRef}>
      <p className="fm-hint">{tx("✋ גרור צמתים · לחיצה על ענף ראשי פותחת/סוגרת ·")} <button className="mini-btn" onClick={() => { setPos(layout); setClosed({}); }}>{tx("🔄 סידור מחדש")}</button></p>
      <div className="fm-canvas" style={{ height: H * scale + 2 }}><div className="fm-sizer" style={{ width: W * scale, height: H * scale }}><div className="fm-scale" style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "100% 0" }} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
        <svg className="fm-lines" width="100%" height="100%">
          {mains.map((m, i) => (
            <g key={i}>
              <line x1={pos.root?.x} y1={pos.root?.y} x2={pos["m" + i]?.x} y2={pos["m" + i]?.y} />
              {!closed[i] && (m.children || []).map((c, j) => (
                <line key={j} x1={pos["m" + i]?.x} y1={pos["m" + i]?.y} x2={pos["m" + i + "c" + j]?.x} y2={pos["m" + i + "c" + j]?.y} />
              ))}
            </g>
          ))}
        </svg>
        {node("root", data.topic, "fm-root")}
        {mains.map((m, i) => node("m" + i, ((m.children || []).length ? (closed[i] ? "▸ " : "▾ ") : "") + m.label, "fm-main", () => toggle(i)))}
        {mains.flatMap((m, i) => (closed[i] ? [] : (m.children || []).map((c, j) => node("m" + i + "c" + j, c.label, "fm-sub"))))}
      </div></div></div>
    </div>
  );
}
 
function FlowView({ data }) {
  return (
    <div className="flow">
      <h3 className="sec-title center">{data.title}</h3>
      {(data.steps || []).map((s, i) => (
        <div className="flow-item" key={i}>
          <div className="flow-step">
            <span className="flow-num">{i + 1}</span>
            <span>{s}</span>
          </div>
          {i < data.steps.length - 1 && <div className="flow-arrow">↓</div>}
        </div>
      ))}
    </div>
  );
}
 
function QuizView({ data, saved, onComplete }) {
  const [answers, setAnswers] = useState({});
  const qs = data.questions || [];
  const answered = Object.keys(answers).length;
  const finished = answered === qs.length && qs.length > 0;
  const score = qs.reduce((n, q, i) => n + (answers[i] === q.correct ? 1 : 0), 0);
  const notified = useRef(false);
 
  useEffect(() => {
    if (finished && !notified.current) {
      notified.current = true;
      onComplete?.(score, qs.length);
    }
  }, [finished, score, qs.length, onComplete]);
 
  return (
    <div className="quiz">
      {saved && !finished && (
        <div className="quiz-prev">{tx("ציון קודם בפרק זה:")} {saved.score}/{saved.total}</div>
      )}
      {finished && (
        <div className="quiz-score">
          {tx("הציון שלך: {a} מתוך {b} — הפרק סומן כהושלם ✓", { a: score, b: qs.length })}
        </div>
      )}
      {qs.map((q, i) => {
        const picked = answers[i];
        return (
          <div className="quiz-q" key={i}>
            <p className="quiz-text">{i + 1}. {q.q}</p>
            <div className="quiz-opts">
              {q.options.map((op, j) => {
                let cls = "quiz-opt";
                if (picked !== undefined) {
                  if (j === q.correct) cls += " right";
                  else if (j === picked) cls += " wrong";
                }
                return (
                  <button
                    key={j}
                    className={cls}
                    disabled={picked !== undefined}
                    onClick={() => setAnswers({ ...answers, [i]: j })}
                  >
                    {op}
                  </button>
                );
              })}
            </div>
            {picked !== undefined && <p className="quiz-exp">{q.explanation}</p>}
          </div>
        );
      })}
    </div>
  );
}
 
function CardsView({ data, layer }) {
  const [flipped, setFlipped] = useState({});
  const [open, setOpen] = useState(null); // כרטיסייה פתוחה לסימון (עם שכבת הלומד)
  const L = (part, text) => <AiLayer {...layer} base={layer.base + ":" + part} text={text} as="div" className="card-text" />;
  return (
    <div className="cards">
      {(data.cards || []).map((c, i) => (
        <button
          key={i}
          className={"card " + (flipped[i] ? "flipped" : "")}
          onClick={() => setFlipped({ ...flipped, [i]: !flipped[i] })}
        >
          <span className="card-inner">
            <span className="card-face front">{c.front}</span>
            <span className="card-face back">{c.back}</span>
          </span>
        </button>
      ))}
      <p className="cards-hint">{tx("לחיצה על כרטיסייה הופכת אותה")}{layer?.on ? tx(" · ✍️ לסימון והערה: פתח כרטיסייה כטקסט") : ""}</p>
      {layer?.on && (
        <div className="card-open">
          <select className="scan-mode-select" value={open ?? ""} onChange={(e) => setOpen(e.target.value === "" ? null : +e.target.value)} aria-label={tx("כרטיסייה לסימון")}>
            <option value="">{tx("✍️ פתח כרטיסייה כטקסט…")}</option>
            {(data.cards || []).map((c, i) => <option key={i} value={i}>{i + 1}. {c.front.slice(0, 60)}</option>)}
          </select>
          {open !== null && data.cards?.[open] && (
            <div className="card-open-body">
              <div className="card-open-face"><b>{tx("שאלה:")}</b> {L("f" + open, data.cards[open].front)}</div>
              <div className="card-open-face"><b>{tx("תשובה:")}</b> {L("b" + open, data.cards[open].back)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
 
/* ─── ❔ המדריך בתוך האפליקציה (צ'אט 20) ───
   אותו מקור כמו דף המדריך לבודקים (public/guide/steps.json): צעדים עם צילום, טקסט ועצה.
   נפתח כשכבה מעל המסך בלחיצה על ❔, ו"חזרה ללימוד" מחזיר בדיוק למקום שהיה. 🔊 מקריא את הצעד. */
/* ─── ❔ המדריך (צ'אט 22): פעימות, הינשוף והלייזר ───
   steps.json: כל צעד = רצף "פעימות" (beats): משפט קריינות + הצילום שמוצג + יעד ללייזר (at).
   היעדים נמדדים אוטומטית בצילום (tools/shots-guide.mjs → shots/boxes.json: {צילום: {יעד: [x,y,w,h] כשברים}}):
   key:<כיתוב מקש בשלט> · bar:<כפתור בשורה העליונה> · sel:<בורר>.
   הקריינות: קובץ MP3 לכל פעימה (public/guide/voice/<id>-<n>.mp3, מופק ב-tools/guide-voice.mjs במק); כשאין — קול הדפדפן.
   🔊 מקריא את הצעד פעימה-פעימה; ▶ "כסרטון" עובר על כל הצעדים. הינשוף יושב משמאל לצילום, הלייזר שלו קופץ ליעד של כל פעימה. */
function GuideOwl({ aim, talking }) {
  /* aim: {ax, ay} וקטור יחידה מהמצביע אל היעד (או null) — הראש והאישונים פונים לשם */
  const tilt = aim ? Math.max(-10, Math.min(10, aim.ax * 10)) : 0;
  const px = aim ? aim.ax * 3.2 : 0, py = aim ? aim.ay * 2.4 : 0;
  return (
    <svg className={"owl" + (talking ? " talk" : "")} viewBox="0 0 120 140" aria-hidden="true">
      <defs>
        <radialGradient id="owlBody" cx="50%" cy="40%" r="65%"><stop offset="0" stopColor="#9a6b3a" /><stop offset="1" stopColor="#5c3d1e" /></radialGradient>
        <radialGradient id="owlBelly" cx="50%" cy="35%" r="60%"><stop offset="0" stopColor="#f3dfb8" /><stop offset="1" stopColor="#d9b98a" /></radialGradient>
      </defs>
      {/* ענף */}
      <path d="M4 128 Q60 118 116 130" stroke="#3b2a16" strokeWidth="5" fill="none" strokeLinecap="round" />
      {/* גוף */}
      <g className="owl-body">
        <ellipse cx="60" cy="88" rx="34" ry="38" fill="url(#owlBody)" />
        <ellipse cx="60" cy="96" rx="22" ry="26" fill="url(#owlBelly)" />
        <path d="M46 84 q7 5 14 0 M53 96 q7 5 14 0 M46 108 q7 5 14 0" stroke="#b08c5a" strokeWidth="1.6" fill="none" />
        {/* כנף שמאל (נחה) */}
        <path d="M30 78 q-12 20 -2 42 q10 -8 12 -40z" fill="#6b4824" />
        {/* רגליים */}
        <path d="M50 124 l-5 6 M50 124 l0 7 M50 124 l5 6 M70 124 l-5 6 M70 124 l0 7 M70 124 l5 6" stroke="#e0a04a" strokeWidth="2.4" strokeLinecap="round" />
      </g>
      {/* ראש */}
      <g className="owl-head" style={{ transform: `rotate(${tilt}deg)`, transformOrigin: "60px 62px" }}>
        <path d="M30 40 L22 14 L44 30 Z M90 40 L98 14 L76 30 Z" fill="#5c3d1e" />
        <circle cx="60" cy="48" r="32" fill="url(#owlBody)" />
        <circle cx="45" cy="48" r="14.5" fill="#f6ebd2" />
        <circle cx="75" cy="48" r="14.5" fill="#f6ebd2" />
        <g className="owl-eyes">
          <circle cx="45" cy="48" r="9.5" fill="#fff" />
          <circle cx="75" cy="48" r="9.5" fill="#fff" />
          <circle cx={45 + px} cy={48 + py} r="5.2" fill="#1b1410" />
          <circle cx={75 + px} cy={48 + py} r="5.2" fill="#1b1410" />
          <circle cx={47 + px} cy={46 + py} r="1.6" fill="#fff" />
          <circle cx={77 + px} cy={46 + py} r="1.6" fill="#fff" />
        </g>
        <g className="owl-lids"><rect x="30" y="33" width="30" height="30" rx="14" fill="#8a5f31" /><rect x="60" y="33" width="30" height="30" rx="14" fill="#8a5f31" /></g>
        <path className="owl-beak" d="M60 56 l-5 0 l5 9 l5 -9 z" fill="#f2a33c" />
      </g>
      {/* כנף ימין מחזיקה מצביע לייזר — הקצה ב-(112,58) */}
      <g className="owl-arm">
        <path d="M84 84 q14 -14 24 -24" stroke="#6b4824" strokeWidth="9" strokeLinecap="round" fill="none" />
        <rect x="96" y="54" width="20" height="7" rx="3" fill="#2b2f3a" transform="rotate(-40 106 58)" />
        <circle className="owl-laser-src" cx="112" cy="58" r="2.4" fill="#ff3b30" />
      </g>
    </svg>
  );
}
function HelpView({ onClose }) {
  const [data, setData] = useState(null);
  const [voices, setVoices] = useState(null); // index.json של הקריינות: {"id-n": {hash}} או {} כשאין
  const [boxes, setBoxes] = useState({});    // shots/boxes.json
  const [err, setErr] = useState("");
  const [k, setK] = useState(() => { try { return +sessionStorage.getItem("lomedtv-help-k") || 0; } catch { return 0; } });
  const [beat, setBeat] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [movie, setMovie] = useState(false);
  const [rate, setRate] = useState(() => { try { return +localStorage.getItem("lomedtv-help-rate") || 1; } catch { return 1; } }); // קצב הקריינות במדריך
  const rateRef = useRef(rate);
  useEffect(() => { rateRef.current = rate; try { localStorage.setItem("lomedtv-help-rate", String(rate)); } catch {} if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate]);
  const [laser, setLaser] = useState(null); // {x1,y1,x2,y2,box:[x,y,w,h] בפיקסלים של הבמה} או null
  const runRef = useRef(0), audioRef = useRef(null), kRef = useRef(k), stageRef = useRef(null), imgRef = useRef(null), tipRef = useRef(null), tweenRef = useRef(null);
  const v = encodeURIComponent(data?.version || "");
  useEffect(() => { fetch("/guide/steps.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : Promise.reject(new Error(r.status))).then(setData).catch((e) => setErr("המדריך לא נטען: " + e.message)); }, []);
  useEffect(() => { fetch("/guide/voice/index.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : {}).then(setVoices).catch(() => setVoices({})); }, []);
  useEffect(() => { fetch("/guide/shots/boxes.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : {}).then(setBoxes).catch(() => setBoxes({})); }, []);
  const stopAll = () => { runRef.current++; window.speechSynthesis?.cancel(); if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } setSpeaking(false); };
  useEffect(() => { kRef.current = k; try { sessionStorage.setItem("lomedtv-help-k", String(k)); } catch {} }, [k]);
  useEffect(() => () => { stopAll(); }, []);
  const steps = (data?.steps || []).filter((s) => KABBALAH || s.id !== "shelf");
  const st = steps[k];
  const beats = st ? (st.beats?.length ? st.beats : [{ say: st.text || "" }]) : [];
  const bt = beats[Math.min(beat, beats.length - 1)] || {};
  const shot = bt.shot || st?.shot || "";
  /* מקריא פעימה אחת; מסתיים כשהקריינות נגמרה (או נכשלה). run = מזהה הריצה — אם השתנה, הריצה בוטלה */
  const narrateBeat = (step, n, run) => new Promise((done) => {
    const b = step.beats?.[n] || { say: step.text || "" };
    const text = speakable(`${n === 0 ? step.title + ". " : ""}${b.say}${n === (step.beats?.length || 1) - 1 && step.tip ? " שימו לב: " + step.tip : ""}`).text;
    const finish = () => { setSpeaking(false); done(); };
    const browserVoice = () => {
      const synth = window.speechSynthesis; if (!synth) return finish();
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "he-IL"; u.rate = rateRef.current; const vv = pickHebrewVoice(synth); if (vv) u.voice = vv;
      u.onend = finish; u.onerror = finish;
      synth.speak(u); setSpeaking(true);
    };
    const id = `${step.id}-${n + 1}`;
    if (voices && voices[id]) {
      const a = new Audio(`/guide/voice/${id}.mp3?v=${voices[id].hash || ""}`);
      audioRef.current = a;
      a.playbackRate = rateRef.current; a.onloadedmetadata = () => { a.playbackRate = rateRef.current; };
      a.onended = finish; a.onerror = () => { if (runRef.current !== run) return finish(); audioRef.current = null; browserVoice(); };
      a.play().then(() => setSpeaking(true)).catch(() => { if (runRef.current !== run) return finish(); audioRef.current = null; browserVoice(); });
    } else browserVoice();
  });
  /* צעד שלם, פעימה אחרי פעימה; מחזיר false אם נעצר באמצע */
  const playStep = async (i, run, from = 0) => {
    const step = steps[i]; const n = step.beats?.length || 1;
    for (let b = from; b < n; b++) {
      if (runRef.current !== run) return false;
      setBeat(b);
      await narrateBeat(step, b, run);
      if (runRef.current !== run) return false;
      if (b < n - 1) await new Promise((r) => setTimeout(r, 350));
    }
    return runRef.current === run;
  };
  const speak = async () => {
    if (speaking) { stopAll(); setMovie(false); return; }
    if (!st) return;
    const run = ++runRef.current;
    await playStep(k, run, 0);
    if (runRef.current === run) setSpeaking(false);
  };
  /* ▶ כסרטון: מהצעד הנוכחי עד הסוף */
  const playMovie = async () => {
    if (movie) { stopAll(); setMovie(false); return; }
    const run = ++runRef.current; setMovie(true);
    let i = kRef.current;
    while (runRef.current === run && i < steps.length) {
      setK(i); setBeat(0);
      const ok = await playStep(i, run, 0);
      if (!ok) break;
      await new Promise((r) => setTimeout(r, 900));
      i++;
    }
    if (runRef.current === run) { setMovie(false); setSpeaking(false); }
  };
  const go = (i) => { stopAll(); setMovie(false); setK(i); setBeat(0); };
  const goBeat = (b) => { stopAll(); setMovie(false); setBeat(b); };
  /* ── הלייזר: מקצה המצביע אל היעד של הפעימה, בפיקסלים של הבמה ── */
  const aimAt = () => {
    const stage = stageRef.current, img = imgRef.current, tip = tipRef.current;
    if (!stage || !img || !tip || !bt.at) return null;
    const box = boxes[shot]?.[bt.at]; if (!box) return null;
    const S = stage.getBoundingClientRect(), I = img.getBoundingClientRect(), T = tip.getBoundingClientRect();
    if (!I.width) return null;
    const bx = I.left - S.left + box[0] * I.width, by = I.top - S.top + box[1] * I.height, bw = box[2] * I.width, bh = box[3] * I.height;
    return { x1: T.left - S.left + T.width / 2, y1: T.top - S.top + T.height / 2, x2: bx + bw / 2, y2: by + bh / 2, box: [bx, by, bw, bh], W: S.width, H: S.height };
  };
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const t = aimAt();
      if (!t) { setLaser(null); tweenRef.current = null; return; }
      const from = tweenRef.current || { x2: t.x1, y2: t.y1 };
      const t0 = performance.now(), D = 420;
      cancelAnimationFrame(raf);
      const step = (now) => {
        const p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 3);
        const cur = { ...t, x2: from.x2 + (t.x2 - from.x2) * e, y2: from.y2 + (t.y2 - from.y2) * e, p };
        tweenRef.current = cur; setLaser(cur);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    update();
    const img = imgRef.current; img?.addEventListener("load", update);
    const ro = typeof ResizeObserver !== "undefined" && stageRef.current ? new ResizeObserver(() => { const t = aimAt(); if (t) { tweenRef.current = { ...t, p: 1 }; setLaser({ ...t, p: 1 }); } else setLaser(null); }) : null;
    ro?.observe(stageRef.current);
    return () => { cancelAnimationFrame(raf); img?.removeEventListener("load", update); ro?.disconnect(); };
  }, [k, beat, shot, boxes, data]);
  /* בזמן הקריינות: המשפט הנוכחי נשאר גלוי מתחת לבמה (הבמה דביקה למעלה) */
  useEffect(() => {
    if (!speaking) return;
    const el = document.querySelector(".help-beat.on"), stage = stageRef.current; if (!el) return;
    const scroller = [el.parentElement, el.closest(".help-body"), el.closest(".screen-body")].find((x) => x && x.scrollHeight > x.clientHeight + 4) || el.closest(".help-body");
    if (!scroller) return;
    const r = el.getBoundingClientRect(), sr = scroller.getBoundingClientRect(), top = (stage ? stage.getBoundingClientRect().bottom : sr.top) + 8;
    if (r.top < top) scroller.scrollBy({ top: r.top - top, behavior: "smooth" });
    else if (r.bottom > sr.bottom - 8) scroller.scrollBy({ top: r.bottom - sr.bottom + 8, behavior: "smooth" });
  }, [beat, speaking]);
  const aim = laser ? (() => { const dx = laser.x2 - laser.x1, dy = laser.y2 - laser.y1, L = Math.hypot(dx, dy) || 1; return { ax: dx / L, ay: dy / L }; })() : null;
  const hq = !!(voices && st && voices[`${st.id}-1`]);
  return (
    <div className="help" dir={langDir()} role="dialog" aria-label="המדריך">
      <div className="help-head">
        <span className="help-title">❔ המדריך · {steps.length ? `${k + 1} / ${steps.length}` : ""}</span>
        <button className={"tts-btn sm " + (movie ? "" : "ghost")} onClick={playMovie} disabled={!steps.length} title="עובר על כל הצעדים ברצף, עם קריינות">{movie ? "⏹ עצור את הסרטון" : "▶ כסרטון"}</button>
        <label className="tts-rate help-rate" title="מהירות הקריינות">קצב <input type="range" min="0.6" max="1.6" step="0.1" value={rate} onChange={(e) => setRate(+e.target.value)} /> {rate.toFixed(1)}×</label>
        <button className="tts-btn sm" onClick={() => { stopAll(); onClose(); }}>↩ חזרה ללימוד</button>
      </div>
      {err && <div className="err">{err}</div>}
      {!data && !err && <div className="idle"><div className="idle-mark spin">✳</div><p>טוען את המדריך…</p></div>}
      {st && (
        <div className={"help-body" + (movie ? " movie" : "")}>
          <div className="help-nav">
            <button className="tts-btn ghost sm" onClick={() => go(Math.max(0, k - 1))} disabled={k === 0}>→ הקודם</button>
            <button className={"tts-btn sm " + (speaking ? "" : "ghost")} onClick={speak} title={hq ? "קריינות: קול איכותי" : "קריינות: קול הדפדפן"}>{speaking ? "⏹ עצור" : hq ? "🎙 הקרא" : "🔊 הקרא"}</button>
            <button className="tts-btn ghost sm" onClick={() => go(Math.min(steps.length - 1, k + 1))} disabled={k >= steps.length - 1}>הבא ←</button>
          </div>
          {shot && (
            <div className="help-stage" ref={stageRef} dir="ltr">
              <div className="help-owl"><GuideOwl aim={aim} talking={speaking} /><span className="owl-tip" ref={tipRef} /></div>
              <img ref={imgRef} className="help-shot" src={"/guide/shots/" + shot + "?v=" + v} alt={st.title} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              {laser && (
                <svg className="help-laser" viewBox={`0 0 ${laser.W} ${laser.H}`} width={laser.W} height={laser.H} aria-hidden="true">
                  <defs><filter id="lz-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" /></filter></defs>
                  <line className="lz-beam-glow" x1={laser.x1} y1={laser.y1} x2={laser.x2} y2={laser.y2} />
                  <line className="lz-beam" x1={laser.x1} y1={laser.y1} x2={laser.x2} y2={laser.y2} />
                  {laser.p >= 1 && <rect className="lz-box" x={laser.box[0] - 3} y={laser.box[1] - 3} width={laser.box[2] + 6} height={laser.box[3] + 6} rx="6" />}
                  <circle className="lz-dot-glow" cx={laser.x2} cy={laser.y2} r="7" />
                  <circle className="lz-dot" cx={laser.x2} cy={laser.y2} r="3.2" />
                </svg>
              )}
            </div>
          )}
          {/* הטקסט מנוקד כשיש ניקוד ב-steps.json (tools/guide-nikud.mjs, הנקדן של דיקטה) — בקשת חיים, צ'אט 22 */}
          <h2 className="help-h"><span className="n">{k + 1}</span>{st.title_nikud || st.title}</h2>
          <p className="help-text">
            {beats.map((b, i) => <span key={i} className={"help-beat" + (i === beat ? " on" : "") + (b.at ? " aimed" : "")} onClick={() => goBeat(i)} title={b.at ? "הלייזר מצביע" : undefined}>{b.nikud || b.say} </span>)}
          </p>
          {st.tip && <div className="help-tip">💡 {st.tip_nikud || st.tip}</div>}
          <div className="help-dots">{steps.map((x, i) => <button key={x.id} className={"help-dot " + (i === k ? "on" : "")} onClick={() => go(i)} title={x.title} />)}</div>
          <div className="help-foot">המדריך המלא, עם טופס משוב: <a href={SITE_URL + "/guide/"} target="_blank" rel="noopener noreferrer">famous-rolypoly…/guide</a></div>
        </div>
      )}
    </div>
  );
}

/* ─── 🔊 הקראה כקריוקי (צ'אט 20) ───
   ההקראה לא מחליפה את הדף: נגן קטן יושב מעל טקסט הפרק, הדף נשאר עם הסימונים וההערות,
   המשפט הנקרא מואר, המילים שכבר נקראו מתמלאות בצבע, והדף גולל בעקבות הקריאה.
   לפני ההקראה הטקסט מנוקה: ניקוד, גרשיים, מספור האותיות ו"הסולם:" יורדים, וראשי תיבות
   נפוצים מתפרשים. בדף סולם אפשר לבחור: הכול · ארמית בלבד · הסולם בלבד.
   מקור הקול: הדפדפן (חינם, מיידי). "קול איכותי" (ElevenLabs) — בגל הבא, על אותו נגן. */
const ABBR_MAP = {
  'הקב"ה': "הקדוש ברוך הוא", 'קב"ה': "הקדוש ברוך הוא", 'ה\'': "השם", 'ד\'': "השם", 'ר\'': "רבי", 'וכו\'': "וכולי", 'וגו\'': "וגומר",
  'ז"ל': "זכרונו לברכה", 'זצ"ל': "זכר צדיק לברכה", 'זי"ע': "זכותו יגן עלינו", 'ע"י': "על ידי", 'ע"ש': "על שם", 'ע"כ': "על כן",
  'פי\'': "פירוש", 'א"ר': "אמר רבי", 'ר"ש': "רבי שמעון", 'ר"א': "רבי אלעזר", 'ר"י': "רבי יהודה", 'רשב"י': "רבי שמעון בר יוחאי",
  'חג"ת': "חסד גבורה תפארת", 'נה"י': "נצח הוד יסוד", 'חב"ד': "חכמה בינה דעת", 'כח"ב': "כתר חכמה בינה", 'ז"א': "זעיר אנפין", 'או"א': "אבא ואמא",
  'א"א': "אריך אנפין", 'אע"פ': "אף על פי", 'אעפ"כ': "אף על פי כן", 'וז"ש': "וזה שכתוב", 'מ"ש': "מה שכתוב", 'שה"ס': "שהוא סוד", 'ע"ס': "עשר ספירות",
  'ד"ה': "דיבור המתחיל", 'כנ"ל': "כנזכר לעיל", 'וכנ"ל': "וכנזכר לעיל", 'צ"ל': "צריך לומר", 'ר"ל': "רוצה לומר", 'עכ"ל': "עד כאן לשונו", 'וז"ל': "וזה לשונו",
  'ב"ה': "ברוך הוא", 'ע"ז': "על זה", 'עי"ז': "על ידי זה", 'בזה"ל': "בזה הלשון", 'ס"א': "סטרא אחרא", 'ס"מ': "סמאל", 'ח"ו': "חס ושלום", 'ב"נ': "בר נש", 'ה"ה': "הרי הוא", 'ז"ס': "זה סוד", 'הנ"ל': "הנזכר לעיל", 'יעו"ש': "יעוין שם", 'ע"ב': "עמוד ב", 'ע"א': "עמוד א", 'ית"ש': "יתברך שמו", 'ית\'': "יתברך", 'ע"ה': "עליו השלום", 'בנ"י': "בני ישראל", 'א"כ': "אם כן", 'אח"כ': "אחר כך", 'עי"ז': "על ידי זה",
};
/* מחזיר {text, map}: הטקסט כפי שיוקרא, ו-map[k] = מיקום התו המקורי שאליו שייך התו ה-k בטקסט המוקרא */
function speakable(src) {
  let out = "", map = [];
  const push = (str, at) => { for (const ch of str) { out += ch; map.push(at); } };
  let i = 0;
  let t = src;
  /* מספור אות בראש משפט "נג) " או "תיד) " — לא מקריאים */
  const m0 = t.match(/^\s*[א-ת]{1,4}\)\s*/); if (m0) i = m0[0].length;
  const m1 = t.slice(i).match(/^(הסולם|פירוש):\s*/); if (m1) i += m1[0].length;
  while (i < t.length) {
    const ch = t[i];
    if (NIKUD_MARK.test(ch)) { i++; continue; }
    if (/[א-ת]/.test(ch)) {
      /* מילה שלמה (כולל גרש/גרשיים בתוכה) */
      let j = i; while (j < t.length && /[א-ת"'״׳֑-ׇ]/.test(t[j])) j++;
      const raw = t.slice(i, j).replace(NIKUD_MARKS, "").replace(/[״]/g, '"').replace(/[׳]/g, "'");
      const exp = ABBR_MAP[raw] || ABBR_MAP[raw.replace(/"$/, "")] || ABBR_MAP[raw.replace(/^"/, "")];
      if (exp) push(exp, i);
      else {
        /* ראשי תיבות לא מוכרים: הגרשיים יורדות והאותיות נקראות כמילה; גרש בסוף יורד */
        const clean = raw.replace(/["']/g, "");
        push(clean, i);
      }
      i = j; continue;
    }
    if (/[()\[\]{}"'״׳]/.test(ch)) { i++; continue; }
    if (ch === "—" || ch === "–") { push(",", i); i++; continue; }
    if (ch === "." && t[i + 1] === "." ) { while (t[i] === ".") i++; push(".", i - 1); continue; }
    push(ch, i); i++;
  }
  map.push(src.length);
  return { text: out.replace(/\s+/g, " ").trim() ? out : "", map };
}
/* שלב 2: ההקראה בקול של שפת הטקסט */
const VOICE_LOCALE = { he: "he-IL", en: "en-US", ar: "ar-SA", fr: "fr-FR", es: "es-ES", ru: "ru-RU", de: "de-DE" };
const voiceLocale = (l) => VOICE_LOCALE[l] || "he-IL";
/* במק יש עשרות קולות לכל שפה, ובהם קולות "בדיחה" (Albert, Bells, Zarvox…) וקולות חלשים (Eddy, Flo…):
   מעדיפים קול קריינות מוכר, אחריו כל קול רגיל, ורק בלית ברירה קול מהרשימה הפסולה. */
const VOICE_GOOD = { en: ["samantha", "ava", "allison", "susan", "alex", "tom", "daniel", "karen", "moira", "google us english", "google uk english", "microsoft"], fr: ["thomas", "amélie", "amelie", "audrey", "aurélie", "google", "microsoft"], es: ["mónica", "monica", "paulina", "jorge", "marisol", "google", "microsoft"], de: ["anna", "petra", "markus", "google", "microsoft"], ru: ["milena", "yuri", "katya", "google", "microsoft"], ar: ["maged", "majed", "laila", "tarik", "google", "microsoft"] };
const VOICE_BAD = /(?:^|[^a-z])(albert|bad news|badnews|goodnews|pipeorgan|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph|princess|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)(?![a-z])/i;
/* כל הקולות של שפה, מהמתאים ביותר; הלומד יכול לבחור קול בחלונית ההקראה, והבחירה נשמרת לכל שפה */
function rankVoices(synth, l) {
  l = l || "he";
  const want = voiceLocale(l).toLowerCase();
  const norm = (v) => v.lang.toLowerCase().replace("_", "-");
  const vs = (synth?.getVoices?.() || []).filter((v) => v.lang && norm(v).startsWith(l));
  const good = VOICE_GOOD[l] || [];
  const score = (v) => {
    /* במכשיר שהמערכת שלו לא באנגלית שמות הקולות מתורגמים ("סמנתה", "אלברט") — לכן בודקים גם את המזהה (voiceURI), שנשאר באנגלית */
    const id = v.voiceURI + " " + v.name, name = id.toLowerCase();
    const gi = good.findIndex((g) => name.includes(g));
    return (VOICE_BAD.test(name) ? -100 : 0) + (gi >= 0 ? 40 - gi : 0) + (/premium/i.test(id) ? 12 : /enhanced/i.test(id) ? 8 : /compact/i.test(v.voiceURI) ? -2 : 0) + (norm(v) === want ? 4 : 0) + (v.localService ? 1 : 0);
  };
  return vs.sort((x, y) => score(y) - score(x));
}
const savedVoice = (l) => { try { return localStorage.getItem("lomedtv-voice-" + (l || "he")) || ""; } catch { return ""; } };
function pickVoice(synth, l) {
  const vs = rankVoices(synth, l), sv = savedVoice(l);
  return (sv && vs.find((v) => v.voiceURI === sv)) || vs[0] || null;
}
/* השאלה שהלומד נושא נאמרת בשפה שבה נכתבה; המסגרת העברית ("השאלה שאתה נושא…") רק כשגם הטקסט עברי */
function spokenQuestion(question, lang) {
  const ql = textLang(question);
  return lang === "he" && ql === "he" ? { text: `השאלה שאתה נושא איתך: ${question}. הקשב לפרק מתוך השאלה הזאת.`, lang: "he" } : { text: question + ".", lang: ql };
}
function pickHebrewVoice(synth) {
  const vs = (synth?.getVoices?.() || []).filter((v) => v.lang && v.lang.toLowerCase().startsWith("he"));
  const score = (v) => (/premium/i.test(v.voiceURI + v.name) ? 3 : /enhanced/i.test(v.voiceURI + v.name) ? 2 : /compact/i.test(v.voiceURI) ? 0 : 1);
  return vs.sort((a, b) => score(b) - score(a))[0] || null;
}
/* 🎙 קול איכותי: חתיכות של עד ~1,200 תווים (טקסט מנוקה), כל חתיכה = קובץ MP3 + זמני תווים.
   מפתח החתיכה כולל תמצית של הטקסט: אותו פרק באותו מצב = אותם קבצים, גם במכשיר אחר (דרך הענן). */
const TTS_CHUNK = 350; // eleven_v3 איטי: חתיכה קטנה כדי לסיים הרבה לפני 60 השניות של נטליפיי
const ttsKey = (store, mode, n, text) => `tts:${store}:${mode}:${n}:${textHash(text)}`;
function buildChunks(queue) {
  const chunks = []; let cur = null;
  for (let k = 0; k < queue.length; k++) {
    const { text, map } = speakable(queue[k].text);
    const t = text.trim(); if (!t) continue;
    if (!cur || cur.text.length + t.length + 1 > TTS_CHUNK) { cur = { text: "", parts: [] }; chunks.push(cur); }
    const off = cur.text.length ? cur.text.length + 1 : 0;
    cur.text = cur.text ? cur.text + " " + t : t;
    cur.parts.push({ k, i: queue[k].i, off, len: t.length, map, orig: queue[k].text });
  }
  return chunks;
}
function Reader({ items, question, startAt, onPos, onClose, store, uid, ttsMeta, onTtsMeta, glossOn, onGloss, glossBusy, lang = "he" }) {
  /* items: [{i, kind, text}] — המשפטים של הפרק בסדר הדף; kind = "zohar" | "sulam" | "" */
  const hasSulam = items.some((x) => x.kind === "sulam");
  /* בחירת קול הדפדפן: הרשימה מתמלאת כשהדפדפן מסיים לטעון קולות (voiceschanged) */
  const [voices, setVoices] = useState([]);
  const [voiceUri, setVoiceUri] = useState(() => savedVoice(lang));
  useEffect(() => {
    const synth = window.speechSynthesis; if (!synth) return;
    const load = () => setVoices(rankVoices(synth, lang).map((v) => ({ uri: v.voiceURI, name: v.name, loc: v.lang })));
    load(); synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, [lang]);
  const [mode, setMode] = useState("all");
  const [rate, setRate] = useState(() => { try { return +localStorage.getItem("lomedtv-tts-rate") || 1; } catch { return 1; } });
  const [state, setState] = useState("idle"); // idle | playing | paused
  const [pos, setPos] = useState(-1);          // אינדקס בתור
  const queue = useMemo(() => items.filter((x) => mode === "all" || (mode === "zohar" ? x.kind === "zohar" : x.kind === "sulam")), [items, mode]);
  const posRef = useRef(-1), stateRef = useRef("idle"), timerRef = useRef(null), uRef = useRef(null), askedQ = useRef(false), rateRef = useRef(rate);
  const [mini, setMini] = useState(true); // true = רק השורה בסרגל; false = לוח ההגדרות פתוח
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("lomedtv-kara") || "amber"; } catch { return "amber"; } });
  const [showColors, setShowColors] = useState(false);
  const [hq, setHq] = useState(() => { try { return localStorage.getItem("lomedtv-tts-hq") === "on"; } catch { return false; } }); // 🎙 קול איכותי
  const [hqBusy, setHqBusy] = useState("");   // "מפיק חלק 1 מתוך 3…"
  const [hqErr, setHqErr] = useState("");
  const audioRef = useRef(null), chunkRef = useRef(null), hqRef = useRef(hq);
  useEffect(() => { hqRef.current = hq; try { localStorage.setItem("lomedtv-tts-hq", hq ? "on" : "off"); } catch {} }, [hq]);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    try { localStorage.setItem("lomedtv-tts-rate", String(rate)); } catch {}
    const changed = rateRef.current !== rate; rateRef.current = rate;
    if (audioRef.current) audioRef.current.playbackRate = rate; // בקול האיכותי הקצב משתנה מיד
    /* הדפדפן מקבל קצב רק בתחילת משפט: אם משנים באמצע, מתחילים את המשפט הנוכחי מחדש בקצב החדש */
    if (changed && !hqRef.current && stateRef.current === "playing" && posRef.current >= 0) speakAt(posRef.current);
  }, [rate]);
  useEffect(() => { try { localStorage.setItem("lomedtv-kara", theme); } catch {} document.documentElement.setAttribute("data-kara", theme); return () => document.documentElement.removeAttribute("data-kara"); }, [theme]);
  const stopAll = () => { window.speechSynthesis?.cancel(); clearInterval(timerRef.current); uRef.current = null; chunkRef.current = null; try { audioRef.current?.pause(); } catch {} };
  useEffect(() => () => { stopAll(); onPos?.(null); if (audioRef.current?.src) URL.revokeObjectURL(audioRef.current.src); }, []);
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;

  /* ── 🎙 המנוע של הקול האיכותי ── */
  const chunks = useMemo(() => buildChunks(queue), [queue]);
  const chunkKey = (n) => ttsKey(store, mode, n, chunks[n]?.text || "");
  const getChunk = async (n) => {
    const key = chunkKey(n), c = chunks[n];
    let blob = null, times = null;
    try { blob = await idbGet(voiceKey(key)); times = await idbGet(voiceKey(key) + ":t"); } catch {}
    if (blob && times) return { blob, times };
    const meta = ttsMeta?.[key];
    if (meta?.path && uid) {
      try {
        const [a, t] = await Promise.all([supa.storage.from("voice").createSignedUrl(meta.path, 3600), supa.storage.from("voice").createSignedUrl(meta.path.replace(/\.mp3$/, ".json"), 3600)]);
        if (!a.error && !t.error) {
          const [ab, tj] = await Promise.all([fetch(a.data.signedUrl).then((r) => r.ok ? r.blob() : null), fetch(t.data.signedUrl).then((r) => r.ok ? r.json() : null)]);
          if (ab && tj) { blob = ab; times = tj; idbSet(voiceKey(key), blob).catch(() => {}); idbSet(voiceKey(key) + ":t", times).catch(() => {}); return { blob, times }; }
        }
      } catch {}
    }
    setHqBusy(tx("🎙 מפיק קול… חלק {a} מתוך {b}", { a: n + 1, b: chunks.length }));
    const data = await postJson("/.netlify/functions/tts", { text: c.text });
    if (data.error) throw new Error(data.error.message || tx("שגיאה בהפקת הקול"));
    blob = new Blob([b64ToBytes(data.audio)], { type: data.mime || "audio/mpeg" });
    times = data.times || [];
    try { await idbSet(voiceKey(key), blob); await idbSet(voiceKey(key) + ":t", times); } catch {}
    if (uid) {
      const path = `${uid}/${store.split(":")[0]}/tts-${textHash(c.text)}.mp3`;
      try {
        const up = await supa.storage.from("voice").upload(path, blob, { contentType: "audio/mpeg", upsert: true });
        if (!up.error) {
          await supa.storage.from("voice").upload(path.replace(/\.mp3$/, ".json"), new Blob([JSON.stringify(times)], { type: "application/json" }), { contentType: "application/json", upsert: true });
          onTtsMeta?.(key, { path, chars: c.text.length, at: Date.now() });
        }
      } catch {}
    }
    setHqBusy("");
    return { blob, times };
  };
  const posFromTime = (c, times, t) => {
    /* חיפוש בינארי: התו האחרון שהתחיל לפני t */
    let lo = 0, hi = times.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (times[m] <= t) lo = m; else hi = m - 1; }
    const part = [...c.parts].reverse().find((p) => lo >= p.off) || c.parts[0];
    const local = Math.max(0, Math.min(part.len, lo - part.off));
    return { k: part.k, i: part.i, c: part.map[Math.min(local, part.map.length - 1)] };
  };
  const playChunk = async (n, fromK) => {
    if (n >= chunks.length) { setState("idle"); setPos(-1); posRef.current = -1; onPos?.(null); return; }
    const c = chunks[n];
    let got;
    try { got = await getChunk(n); } catch (e) { setHqErr(e.message); setHqBusy(""); setState("idle"); return; }
    if (stateRef.current !== "playing") return;
    const a = audioRef.current || new Audio(); audioRef.current = a;
    try { a.pause(); } catch {}
    if (a.src) URL.revokeObjectURL(a.src);
    a.src = URL.createObjectURL(got.blob); a.playbackRate = rateRef.current;
    chunkRef.current = { n, c, times: got.times };
    const startPart = fromK != null ? c.parts.find((p) => p.k === fromK) : null;
    a.ontimeupdate = () => { const ch = chunkRef.current; if (!ch) return; const p = posFromTime(ch.c, ch.times, a.currentTime); posRef.current = p.k; setPos(p.k); onPos?.({ i: p.i, c: p.c }); };
    a.onended = () => { if (chunkRef.current?.n === n) playChunk(n + 1); };
    a.onerror = () => { setHqErr(tx("הקובץ לא ניתן לנגינה")); setState("idle"); };
    const seekTo = startPart ? (got.times[startPart.off] || 0) : 0;
    const go = () => { a.currentTime = seekTo; a.play().catch((e) => setHqErr(tx("הדפדפן חסם נגינה: ") + e.message)); };
    if (a.readyState >= 1) go(); else a.onloadedmetadata = go;
    /* מפיקים את החתיכה הבאה ברקע, כדי שהמעבר יהיה חלק */
    if (n + 1 < chunks.length) getChunk(n + 1).catch(() => {});
  };
  const hqPlayFrom = (k) => {
    const n = chunks.findIndex((c) => c.parts.some((p) => p.k === k));
    if (n < 0) { setState("idle"); return; }
    setHqErr(""); setState("playing");
    playChunk(n, k);
  };
  const speakAt = (k) => {
    if (!synth) return;
    if (k >= queue.length) { setState("idle"); setPos(-1); posRef.current = -1; onPos?.(null); return; }
    const item = queue[k];
    const { text, map } = speakable(item.text);
    posRef.current = k; setPos(k);
    if (!text.trim()) { speakAt(k + 1); return; }
    onPos?.({ i: item.i, c: 0 });
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voiceLocale(lang); u.rate = rateRef.current;
    const v = pickVoice(synth, lang); if (v) u.voice = v;
    const t0 = Date.now(); let lastB = 0;
    const cps = 13 * rateRef.current; // הערכה כשהדפדפן לא מדווח על גבולות מילים
    u.onboundary = (ev) => { if (typeof ev.charIndex === "number") { lastB = ev.charIndex; onPos?.({ i: item.i, c: map[Math.min(ev.charIndex, map.length - 1)] }); } };
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (stateRef.current !== "playing") return;
      const est = Math.min(text.length, Math.floor((Date.now() - t0) / 1000 * cps));
      if (est > lastB + 12) onPos?.({ i: item.i, c: map[Math.min(est, map.length - 1)] });
    }, 250);
    u.onend = () => { if (uRef.current !== u) return; clearInterval(timerRef.current); onPos?.({ i: item.i, c: item.text.length }); speakAt(k + 1); };
    u.onerror = (e) => { if (uRef.current !== u) return; clearInterval(timerRef.current); if (e.error !== "interrupted" && e.error !== "canceled") speakAt(k + 1); };
    uRef.current = u;
    synth.speak(u);
  };
  const play = (from) => {
    if (hqRef.current) {
      if (state === "paused" && from == null) { audioRef.current?.play?.(); setState("playing"); return; }
      stopAll();
      const k = from != null ? from : Math.max(0, posRef.current);
      posRef.current = k; setPos(k);
      hqPlayFrom(k);
      return;
    }
    if (!synth) return;
    if (state === "paused" && from == null) { synth.resume(); setState("playing"); return; }
    stopAll();
    setState("playing"); setMini(true);
    const k = from != null ? from : Math.max(0, posRef.current);
    if (question && !askedQ.current && k === 0) {
      askedQ.current = true;
      const sq = spokenQuestion(question, lang);
      const uq = new SpeechSynthesisUtterance(sq.text);
      uq.lang = voiceLocale(sq.lang); uq.rate = rateRef.current; const v = pickVoice(synth, sq.lang); if (v) uq.voice = v;
      uq.onend = () => speakAt(k); uq.onerror = () => speakAt(k); uRef.current = uq; synth.speak(uq);
    } else speakAt(k);
  };
  const pause = () => { if (hqRef.current) { try { audioRef.current?.pause(); } catch {} } else synth?.pause(); setState("paused"); };
  const stop = () => { stopAll(); setState("idle"); setPos(-1); posRef.current = -1; onPos?.(null); };
  /* לחיצה על משפט בדף: להתחיל ממנו */
  useEffect(() => {
    if (startAt == null) return;
    const k = queue.findIndex((x) => x.i === startAt.i);
    if (k >= 0) play(k);
  }, [startAt]);
  useEffect(() => { if (state !== "idle") stop(); }, [mode]);
  useEffect(() => { if (stateRef.current === "playing" && posRef.current >= 0) play(posRef.current); }, [hq]);
  const step = (d) => { const k = Math.max(0, Math.min(queue.length - 1, (posRef.current < 0 ? 0 : posRef.current) + d)); play(k); };
  const KARA = [["amber", tx("ענבר")], ["green", tx("ירוק")], ["blue", tx("תכלת")], ["rose", tx("ורוד")], ["soft", tx("עדין")]];
  /* הנגן יושב בשורת המסך העליונה (ליד הכותרת, מימין לענן): שורה קטנה תמיד; ▾ פותח לוח מתחתיה עם קצב, צבע ומה להקריא */
  const slot = typeof document !== "undefined" ? document.getElementById("reader-slot") : null;
  const ui = !synth ? <span className="reader-note">{tx("הדפדפן הזה לא תומך בהקראה.")}</span> : (
    <span className="reader-bar" dir={langDir()}>
      {state === "playing"
        ? <button className="rb-btn main" onClick={pause} title={tx("השהה")}>⏸</button>
        : <button className="rb-btn main" onClick={() => play()} title={state === "paused" ? tx("המשך") : tx("הקרא")}>▶</button>}
      <button className="rb-btn" onClick={() => step(-1)} title={tx("משפט קודם")}>⏮</button>
      <button className="rb-btn" onClick={() => step(1)} title={tx("משפט הבא")}>⏭</button>
      <span className="rb-pos">{hqBusy ? "🎙…" : (hq ? "🎙 " : "") + (pos >= 0 ? `${pos + 1}/${queue.length}` : queue.length)}</span>
      <button className={"rb-btn " + (!mini ? "on" : "")} onClick={() => setMini((m) => !m)} title={mini ? tx("הגדרות ההקראה") : tx("סגור הגדרות")}>{mini ? "▾" : "▴"}</button>
      <button className="rb-btn" onClick={() => { stop(); onClose?.(); }} title={tx("סגור את ההקראה")}>✕</button>
      {!mini && (
        <div className="reader-pop" dir={langDir()}>
          <div className="reader-row">
            <label className="tts-rate">{tx("קצב")} <input type="range" min="0.6" max="1.6" step="0.1" value={rate} onChange={(e) => setRate(+e.target.value)} /> {rate.toFixed(1)}×</label>
            <button className="tts-btn ghost sm" onClick={stop} title={tx("עצור וחזור להתחלה")}>{tx("⏹ מההתחלה")}</button>
          </div>
          <div className="reader-row">
            <button className={"pill " + (hq ? "on" : "")} onClick={() => { setHqErr(""); setHq((v) => !v); }} title={tx("קול אנושי מ-ElevenLabs — מופק פעם אחת ונשמר")}>{tx("🎙 קול איכותי")} {hq ? tx("· דולק") : ""}</button>
            <span className="reader-note">{hq ? (uid ? tx("{n} חלקים · מופק פעם אחת ונשמר במכשיר ובענן", { n: chunks.length }) : tx("להיכנס לחשבון (☁) כדי להפיק")) : tx("קול הדפדפן (חינם)")}</span>
          </div>
          {!hq && voices.length > 1 && (
            <div className="reader-row">
              <label className="reader-note">{tx("קול:")} <select className="scan-mode-select" value={voices.some((v) => v.uri === voiceUri) ? voiceUri : voices[0].uri} aria-label={tx("קול:")}
                onChange={(e) => { const u = e.target.value; setVoiceUri(u); try { localStorage.setItem("lomedtv-voice-" + lang, u); } catch {} if (stateRef.current === "playing") { uRef.current = null; clearInterval(timerRef.current); try { window.speechSynthesis.cancel(); } catch {} setTimeout(() => speakAt(Math.max(0, posRef.current)), 120); } }}>
                {voices.map((v) => <option key={v.uri} value={v.uri}>{v.name} · {v.loc}</option>)}
              </select></label>
            </div>
          )}
          {hqBusy && <div className="reader-note busy-line">{hqBusy}</div>}
          {hqErr && <div className="err">{hqErr}</div>}
          <div className="reader-row" style={lang === "he" ? undefined : { display: "none" }}>
            <button className={"pill " + (glossOn ? "on" : "")} onClick={() => onGloss?.(!glossOn)} title="פירוש עברי קצר מתחת לכל מילה ארמית בזמן ההקראה">📖 מילון ארמי {glossOn ? "· דולק" : ""}</button>
            <span className="reader-note">{glossBusy || (glossOn ? "מתחת לכל מילה ארמית — הפירוש בעברית · מוכן פעם אחת ונשמר עם הספר · גם הכפתור 📖 בשורה העליונה" : "כבוי")}</span>
          </div>
          <div className="reader-row pill-row">
            <span className="reader-note">{tx("צבע ההארה:")}</span>
            {KARA.map(([k, l]) => <button key={k} className={"pill kara-pick " + (theme === k ? "on" : "")} data-kara={k} onClick={() => setTheme(k)}><i className="kara-sw" /> {l}</button>)}
          </div>
          {hasSulam && (
            <div className="reader-row pill-row">
              <span className="reader-note">מה להקריא:</span>
              <button className={"pill " + (mode === "all" ? "on" : "")} onClick={() => setMode("all")}>הכול, כסדר הדף</button>
              <button className={"pill " + (mode === "zohar" ? "on" : "")} onClick={() => setMode("zohar")}>הארמית בלבד</button>
              <button className={"pill " + (mode === "sulam" ? "on" : "")} onClick={() => setMode("sulam")}>הסולם בלבד</button>
            </div>
          )}
          <div className="reader-note">{tx("לחיצה על משפט בדף מתחילה את ההקראה ממנו · המשפט הנקרא מואר, המילים שנקראו מתמלאות")}</div>
        </div>
      )}
    </span>
  );
  if (slot) return createPortal(ui, slot);
  return (
    <div className="reader" dir={langDir()}>
      <div className="reader-row">
        {state === "playing"
          ? <button className="tts-btn" onClick={pause}>{tx("⏸ השהה")}</button>
          : <button className="tts-btn" onClick={() => play()}>▶ {state === "paused" ? tx("המשך") : tx("הקרא")}</button>}
        <button className="tts-btn ghost" onClick={() => step(-1)} title={tx("משפט קודם")}>⏮</button>
        <button className="tts-btn ghost" onClick={() => step(1)} title={tx("משפט הבא")}>⏭</button>
        <button className="tts-btn ghost" onClick={stop}>⏹</button>
        <span className="reader-pos">{pos >= 0 ? `${pos + 1} / ${queue.length}` : tx("{n} משפטים", { n: queue.length })}</span>
        <label className="tts-rate">{tx("קצב")} <input type="range" min="0.6" max="1.6" step="0.1" value={rate} onChange={(e) => setRate(+e.target.value)} /> {rate.toFixed(1)}×</label>
        <button className="tts-btn ghost sm" onClick={() => setShowColors((v) => !v)} title={tx("צבעי ההארה")}>🎨</button>
        <button className="tts-btn ghost sm" onClick={() => setMini(true)} title={tx("כווץ את הנגן")}>▴</button>
        <button className="tts-btn ghost reader-x" onClick={() => { stop(); onClose?.(); }} title={tx("סגור את הנגן")}>✕</button>
      </div>
      {showColors && (
        <div className="reader-row pill-row">
          <span className="reader-note">{tx("צבע ההארה:")}</span>
          {KARA.map(([k, l]) => <button key={k} className={"pill kara-pick " + (theme === k ? "on" : "")} data-kara={k} onClick={() => setTheme(k)}><i className="kara-sw" /> {l}</button>)}
        </div>
      )}
      {hasSulam && (
        <div className="reader-row pill-row">
          <span className="reader-note">מה להקריא:</span>
          <button className={"pill " + (mode === "all" ? "on" : "")} onClick={() => setMode("all")}>הכול, כסדר הדף</button>
          <button className={"pill " + (mode === "zohar" ? "on" : "")} onClick={() => setMode("zohar")}>הארמית בלבד</button>
          <button className={"pill " + (mode === "sulam" ? "on" : "")} onClick={() => setMode("sulam")}>הסולם בלבד</button>
        </div>
      )}
      <div className="reader-note reader-hint">{tx("לחיצה על משפט בדף מתחילה את ההקראה ממנו · המשפט הנקרא מואר, המילים שנקראו מתמלאות")}</div>
    </div>
  );
}

function TTSView({ text, question }) {
  const tLang = textLang(text);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => () => window.speechSynthesis?.cancel(), [text]);

  /* ההקראה פותחת בשאלה שהלומד נושא — כדי שיקשיב לפרק מתוכה */
  const spoken = question && tLang === "he" && textLang(question) === "he" ? `השאלה שאתה נושא איתך: ${question}. הקשב לפרק מתוך השאלה הזאת. ... ${text}` : text;

  const play = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (paused) { synth.resume(); setPaused(false); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(spoken);
    u.lang = voiceLocale(tLang);
    u.rate = rate;
    const heVoice = pickVoice(synth, tLang);
    if (heVoice) u.voice = heVoice;
    u.onend = () => { setSpeaking(false); setPaused(false); };
    u.onerror = () => { setSpeaking(false); setPaused(false); };
    synth.speak(u);
    setSpeaking(true);
  };
 
  return (
    <div className="tts">
      <div className="tts-controls">
        {!speaking || paused ? (
          <button className="tts-btn" onClick={play}>▶ {paused ? tx("המשך") : tx("הקרא")}</button>
        ) : (
          <button className="tts-btn" onClick={() => { window.speechSynthesis?.pause(); setPaused(true); }}>{tx("⏸ השהה")}</button>
        )}
        <button className="tts-btn ghost" onClick={() => { window.speechSynthesis?.cancel(); setSpeaking(false); setPaused(false); }}>{tx("⏹ עצור")}</button>
      </div>
      <label className="tts-rate">
        מהירות
        <input
          type="range" min="0.5" max="1.5" step="0.1" value={rate}
          disabled={speaking && !paused}
          onChange={(e) => setRate(Number(e.target.value))}
        />
        ×{rate.toFixed(1)}
      </label>
      <p className="tts-note">{tx("ההקראה משתמשת בקולות הדפדפן — איכות העברית תלויה במכשיר. מוקרא הפרק הנוכחי בלבד.")}</p>
      {question && (
        <div className="my-q my-q-answer">
          <span className="my-q-ic">❓</span>
          <span className="my-q-body"><small>{tx("ההקראה פותחת בשאלה שאתה נושא")}</small>{question}</span>
        </div>
      )}
      <div className="tts-text">{text}</div>
    </div>
  );
}
 
/* ─── 🎧 שיקוף — ערוץ 08 ───
   שיחה שהתקיימה, מוחזרת כקול ("אור חוזר"): מורה ותלמידה משוחחים על ההערות
   והסימונים שהלומד השאיר בספר — ועל השאלה שהוא נושא. הלומד מאזין; מדברים עליו
   בגוף שלישי. שני שלבים: תסריט (Claude, קורא לפני שמשלמים) → קול (ElevenLabs).
   הקובץ נשמר במכשיר (IndexedDB) ובענן (Supabase Storage, bucket voice). */
async function postJson(path, body) {
  const headers = await authHeaders();
  let res;
  try { res = await fetch(API_BASE + path, { method: "POST", headers, body: JSON.stringify(body) }); }
  catch { throw new Error(tx("בעיית רשת — הבקשה לא הגיעה לשרת")); }
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(tx("השרת החזיר תשובה לא תקינה [{s}]: ", { s: res.status }) + raw.slice(0, 160)); }
  const ge = gateError(res, data);
  if (ge) throw ge;
  if (!res.ok || data.error) throw new Error(data.error?.message || tx("שגיאה [{s}]", { s: res.status }));
  return data;
}
function MirrorView({ book, question, cloudUser, onSave }) {
  const mirrors = book.flex?.mirrors || [];
  const material = useMemo(() => mirrorMaterial(book), [book.id, book.notes, book.marks]);
  const [name, setName] = useState(() => { try { return localStorage.getItem("lomedtv-name") || ""; } catch { return ""; } });
  const [len, setLen] = useState("short");
  const [script, setScript] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [playing, setPlaying] = useState(null); // { id, url }
  const [delArm, setDelArm] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => () => { if (playing?.url?.startsWith("blob:")) URL.revokeObjectURL(playing.url); }, [playing]);

  const saveName = (v) => { setName(v); try { localStorage.setItem("lomedtv-name", v.trim()); } catch {} };

  const writeScript = async () => {
    setErr(""); setScript(null);
    setBusy("Claude קורא את ההערות והסימונים שלך וכותב את השיחה…");
    try {
      const data = await postJson("/.netlify/functions/dialogue", {
        title: book.title, question: question || "", learner: name.trim(), length: len,
        notes: material.notes, marks: material.marks,
      });
      setScript(data);
    } catch (e) { setErr(e.message); }
    setBusy("");
  };

  const produce = async () => {
    if (!script) return;
    setErr("");
    const chunks = chunkScript(script.lines);
    const parts = [];
    try {
      for (let i = 0; i < chunks.length; i++) {
        setBusy(`ElevenLabs מקליט… חלק ${i + 1} מתוך ${chunks.length}`);
        const data = await postJson("/.netlify/functions/voice", { lines: chunks[i] });
        parts.push(b64ToBytes(data.audio));
      }
      const blob = new Blob(parts, { type: "audio/mpeg" });
      const id = Date.now().toString(36);
      const uid = cloudUser?.id;
      const path = uid ? `${uid}/${book.id}/${id}.mp3` : "";
      setBusy("שומר במכשיר ובענן…");
      try { await idbSet(voiceKey(id), blob); } catch (e) { console.warn("voice idb", e); }
      let cloud = false;
      if (path) {
        const { error } = await supa.storage.from("voice").upload(path, blob, { contentType: "audio/mpeg", upsert: true });
        if (error) console.warn("voice upload", error.message); else cloud = true;
      }
      const entry = { id, title: script.title, ts: Date.now(), chars: script.chars, bytes: blob.size, path: cloud ? path : "", lines: script.lines.length };
      await onSave([entry, ...mirrors]);
      setScript(null);
      setPlaying({ id, url: URL.createObjectURL(blob) });
    } catch (e) { setErr(e.message); }
    setBusy("");
  };

  const play = async (m) => {
    setErr("");
    try {
      let url = "";
      try { const blob = await idbGet(voiceKey(m.id)); if (blob) url = URL.createObjectURL(blob); } catch {}
      if (!url && m.path) {
        const { data, error } = await supa.storage.from("voice").createSignedUrl(m.path, 3600);
        if (error) throw new Error("הקובץ בענן לא זמין: " + error.message);
        url = data.signedUrl;
        /* להורדה למכשיר — כדי שבפעם הבאה יתנגן גם בלי רשת */
        fetch(url).then((r) => r.ok ? r.blob() : null).then((b) => b && idbSet(voiceKey(m.id), b)).catch(() => {});
      }
      if (!url) throw new Error("הקובץ לא נמצא — לא במכשיר ולא בענן");
      setPlaying({ id: m.id, url });
      setTimeout(() => audioRef.current?.play?.().catch(() => {}), 50);
    } catch (e) { setErr(e.message); }
  };

  const remove = async (m) => {
    setDelArm(null);
    if (playing?.id === m.id) setPlaying(null);
    try { await idbDel(voiceKey(m.id)); } catch {}
    if (m.path) { try { await supa.storage.from("voice").remove([m.path]); } catch {} }
    await onSave(mirrors.filter((x) => x.id !== m.id));
  };

  const fmtDate = (ts) => new Date(ts).toLocaleDateString("he-IL", { day: "numeric", month: "short" });
  const fmtMin = (chars) => { const m = chars / 550; return m < 1 ? "פחות מדקה" : `כ-${Math.round(m)} דק'`; };
  const lenInfo = MIRROR_LENGTHS.find((l) => l.id === len);

  return (
    <div className="mirror">
      <div className="guide-head">
        <h2 className="guide-title">🎧 שיקוף · {book.title}</h2>
        <span className="guide-meta">{material.notes.length} הערות · {material.marks.length} סימונים{question ? " · שאלה אחת" : ""}</span>
      </div>
      <p className="intake-lead">
        שני קולות — מורה ותלמידה — משוחחים על מה שהשארת בספר: ההערות, הסימונים, והשאלה שאתה נושא.
        אתה לא בשיחה; אתה מאזין לה. מה שלמדת, חוזר אליך כאור חוזר.
      </p>

      {mirrors.length > 0 && (
        <div className="mirror-list">
          {mirrors.map((m) => (
            <div className={"mirror-row" + (playing?.id === m.id ? " on" : "")} key={m.id}>
              <button className="mirror-play" onClick={() => play(m)} title="נגן">{playing?.id === m.id ? "🎧" : "▶"}</button>
              <span className="mirror-body">
                <span className="mirror-title">{m.title}</span>
                <small>{fmtDate(m.ts)} · {fmtMin(m.chars)}{m.path ? " · ☁" : " · במכשיר בלבד"}</small>
              </span>
              {delArm === m.id
                ? <button className="del confirm" onClick={() => remove(m)}>בטוח?</button>
                : <button className="del" onClick={() => setDelArm(m.id)} title="מחק">✕</button>}
            </div>
          ))}
        </div>
      )}
      {playing && (
        <audio ref={audioRef} className="mirror-audio" src={playing.url} controls autoPlay playsInline />
      )}

      {err && <div className="err">{err}</div>}
      {busy && <div className="busy-line" style={{ display: "block", margin: "6px 0" }}>⏳ {busy}</div>}

      {!script && !busy && (
        <div className="mirror-new">
          <div className="mirror-opts">
            <label className="mirror-name">
              איך לקרוא לך בשיחה?
              <input value={name} onChange={(e) => saveName(e.target.value)} placeholder="הלומד" maxLength={40} />
            </label>
            <div className="pill-row" style={{ justifyContent: "flex-start", marginBottom: 0 }}>
              {MIRROR_LENGTHS.map((l) => (
                <button key={l.id} className={"pill" + (len === l.id ? " on" : "")} onClick={() => setLen(l.id)}>{l.label} · {l.mins}</button>
              ))}
            </div>
          </div>
          <button className="tts-btn" onClick={writeScript}>✍ כתוב את השיחה</button>
          <p className="tts-note">קודם התסריט — תקרא אותו, ורק אז תחליט אם להפיק קול. הפקת קול נספרת במכסה היומית (כ-{lenInfo.chunks} מתוך 30 חלקים ל{lenInfo.label}).</p>
        </div>
      )}

      {script && !busy && (
        <div className="mirror-script">
          <div className="guide-head">
            <h3 className="mirror-title">{script.title}</h3>
            <span className="guide-meta">{script.lines.length} רפליקות · {fmtMin(script.chars)}</span>
          </div>
          <div className="mirror-lines">
            {script.lines.map((l, i) => (
              <p key={i} className={"mirror-line " + l.s}>
                <b>{l.s === "t" ? "המורה" : "התלמידה"}</b>
                {l.t.replace(/\[[a-z ]+\]\s*/gi, "")}
              </p>
            ))}
          </div>
          <div className="tts-controls">
            <button className="tts-btn" onClick={produce}>🎧 הפק קול ({chunkScript(script.lines).length} חלקים)</button>
            <button className="tts-btn ghost" onClick={writeScript}>↻ כתוב מחדש</button>
            <button className="tts-btn ghost" onClick={() => setScript(null)}>✕ בטל</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── האפליקציה ─── */

/* ─── חיפוש בתוך הספר (קונקורדנציה חכמת-עברית) ───
   התאמה מדויקת + זיהוי תחיליות (ו/ה/ב/ל/מ/ש/כ וצירופיהן),
   התעלמות מגרשיים, וחיפוש רב-מילים (כל המילים חייבות להופיע במשפט). */
const HEB_PREFIXES = ["וכש","וה","וב","ול","ומ","וש","וכ","שה","שב","של","שמ","מה","כש","לכ","ו","ה","ב","ל","מ","ש","כ"];
const HEB_SUFFIXES = ["ותיהם","ותינו","יהם","יהן","ינו","יכם","ותיו","ות","ים","נו","כם","כן","הם","הן","יו","יה","ו","ה","י","ם","ן","ך"];
function hebClean(w) {
  return (w || "").replace(/["'׳״]/g, "");
}
function hebForms(w) {
  const out = new Set([w]);
  for (const p of HEB_PREFIXES) {
    if (w.startsWith(p) && w.length - p.length >= 2) out.add(w.slice(p.length));
  }
  return out;
}
function stemEq(token, q) {
  if (token === q) return true;
  if (token.startsWith(q)) {
    const rest = token.slice(q.length);
    if (HEB_SUFFIXES.includes(rest)) return true;
  }
  return false;
}
function sentenceMatches(sentence, qWords) {
  const tokens = sentence.split(/[^א-תa-zA-Z"'׳״]+/).filter(Boolean).map(hebClean);
  return qWords.every((q) => {
    const qf = hebForms(q);
    return tokens.some((t) => {
      for (const tf of hebForms(t)) {
        for (const f of qf) if (stemEq(tf, f)) return true;
      }
      return false;
    });
  });
}

/* בניית מבחן לפי מספר שאלות.
   כל 5 שאלות = קריאה נפרדת, וכולן רצות במקביל (10=2 קריאות, 20=4).
   כך אף קריאה לא חורגת ממגבלת הזמן של Netlify (~10 שניות). */
async function buildQuiz(text, n, q = "") {
  const ANGLES = [
    "התמקד בשאלות ידע והבנה ישירה של הנאמר בטקסט. ",
    "התמקד בשאלות העמקה, הסקה וקשרים בין רעיונות. אל תחזור על שאלות בסיסיות. ",
    "התמקד בשאלות על מושגים והגדרות מתוך הטקסט. ",
    "התמקד בשאלות יישום והשוואה בין חלקי הטקסט. ",
  ];
  const once = (size, k) =>
    askClaude(PROMPTS.quiz(text, size, ANGLES[k % ANGLES.length] + "הסברים קצרים — עד 12 מילים. ", k === 0 ? q : ""), 1800, true); // השאלה האישית — רק במנה הראשונה
  const withRetry = async (size, k) => {
    try { return await once(size, k); }
    catch (e) { if (isGateError(e)) throw e; return await once(size, k); } // ניסיון שני אוטומטי
  };
  const chunks = [];
  let left = n, k = 0;
  while (left > 0) {
    const size = Math.min(5, left);
    chunks.push(withRetry(size, k));
    left -= size;
    k++;
  }
  const results = await Promise.all(chunks);
  return { questions: results.flatMap((r) => r.questions || []) };
}


export default function LearningTV() {
  const [view, setView] = useState("boot"); // boot | library | intake | guide | tv
  /* הטלוויזיה "נדלקת": הכותרת מופיעה שנייה וחצי בכניסה ונעלמת — בתוך העבודה המסך תופס את כל השטח */
  const [powerOn, setPowerOn] = useState(true);
  useEffect(() => { const t = setTimeout(() => setPowerOn(false), 1900); return () => clearTimeout(t); }, []);
  /* 🎨 הרקע מסביב לטלוויזיה — נבחר פעם אחת ונשמר במכשיר */
  const [bgTheme, setBgTheme] = useState(() => { try { return localStorage.getItem("lomedtv-bg") || "night"; } catch { return "night"; } });
  const [bgOpen, setBgOpen] = useState(false);
  useEffect(() => { document.documentElement.setAttribute("data-bg", bgTheme); try { localStorage.setItem("lomedtv-bg", bgTheme); } catch {} }, [bgTheme]);
  const [isFull, setIsFull] = useState(false);
  /* 📖 מסך קריאה (צ'אט 25): רק התוכן, על כל המסך — בלי מסגרת הטלוויזיה, בלי הסרגל ובלי השלט. Esc או הכפתור הצף מחזירים. */
  const [focus, setFocus] = useState(false);
  /* 📱 טלפון (צ'אט 27): מקשי הערוצים 00–09 מקופלים למקש אחד; ▴ פורש אותם מעל הטקסט. במק אין שינוי. */
  const [keysOpen, setKeysOpen] = useState(false);
  useEffect(() => {
    if (!focus) return;
    const onKey = (e) => { if (e.key === "Escape") setFocus(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);
  useEffect(() => { const f = () => setIsFull(!!document.fullscreenElement); document.addEventListener("fullscreenchange", f); return () => document.removeEventListener("fullscreenchange", f); }, []);
  const toggleFull = () => { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch {} };
  const [index, setIndex] = useState([]);
  const [book, setBook] = useState(null);
  const [chIdx, setChIdx] = useState(0);
  const [channel, setChannel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [staticFx, setStaticFx] = useState(false);
  const [deleteArm, setDeleteArm] = useState(null);
  const [archiveOpen, setArchiveOpen] = useState(false); // 📚 הארכיון (ספרים שהוסרו מהמסך) פתוח?
  const shown = useMemo(() => index.filter((b) => b.pin !== false), [index]);
  const archived = useMemo(() => index.filter((b) => b.pin === false), [index]);
  /* 📌 להשאיר על המסך / להעביר לארכיון. הסימון נשמר עם הספר ומסתנכרן לענן. */
  /* ── 🔍 חיפוש: פיצ'רים (מילון ב-search.js) ותוכן (אינדקס במכשיר) ── */
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState("");
  const [findRes, setFindRes] = useState({ feats: [], hits: [], busy: false });
  const [listening, setListening] = useState(false);
  const [libHint, setLibHint] = useState("");
  const findInRef = useRef(null), findTimer = useRef(null), recogRef = useRef(null);

  const runFind = (q) => {
    clearTimeout(findTimer.current);
    if (!q.trim()) { setFindRes({ feats: [], hits: [], busy: false }); return; }
    setFindRes((r) => ({ ...r, busy: true }));
    findTimer.current = setTimeout(async () => {
      const feats = searchFeatures(q, tx);
      /* שם של שפה בשאילתה → כלי "החלף שפה" */
      const qn = q.trim().toLowerCase();
      for (const [id, name] of LANGS) if (qn.length >= 2 && id !== getLang() && (name.toLowerCase().startsWith(qn) || qn.startsWith(name.toLowerCase()))) feats.unshift({ id: "lang-" + id, name: "🌐 " + name, desc: tx("החלף את שפת המסך"), go: { act: "lang", lang: id } });
      setFindRes((r) => ({ ...r, feats, busy: true }));
      try { await buildIndex(index, loadBook, bookSentences); } catch (e) { console.warn("index", e); }
      setFindRes({ feats, hits: searchContent(q), busy: false });
    }, 160);
  };
  const openFind = (q = "") => { setFindOpen(true); setFindQ(q); runFind(q); setTimeout(() => findInRef.current?.focus(), 60); };
  const closeFind = () => { setFindOpen(false); try { recogRef.current?.stop(); } catch {} setListening(false); };
  /* 🎤 חיפוש קולי: זיהוי הדיבור של הדפדפן (ספארי, כרום). מה שנאמר נכנס לשדה ומחפש. */
  const voiceSearch = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setLibHint(tx("הדפדפן הזה לא תומך בחיפוש קולי — אפשר להקליד.")); return; }
    if (listening) { try { recogRef.current?.stop(); } catch {} setListening(false); return; }
    const rec = new SR();
    rec.lang = { he: "he-IL", en: "en-US", ar: "ar-SA", fr: "fr-FR", es: "es-ES", ru: "ru-RU", de: "de-DE" }[getLang()] || "he-IL";
    rec.interimResults = true; rec.continuous = false;
    rec.onresult = (ev) => { let t = ""; for (const r of ev.results) t += r[0].transcript; setFindQ(t); runFind(t); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recogRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); }
  };
  const hintFor = (ms = 7000) => (t) => { setLibHint(t); setTimeout(() => setLibHint(""), ms); };
  /* ניווט לפיצ'ר: פותח את המסך הנכון ומהבהב */
  const goFeature = (f) => {
    const g = f.go || {}; const hint = hintFor();
    closeFind(); setError(null);
    const needBook = () => { setView("library"); hint(tx("קודם פותחים ספר ופרק — ואז {n}", { n: tx(f.name) })); };
    if (g.gate) { enterFromOpening(false, g.gate); if (g.gate === "rec") hint(tx("למטה: 🎙 הקלט שיעור חי")); return; }
    if (g.view === "intake") { setView("intake"); if (g.focus === "yt") setTimeout(() => document.querySelector(".yt-row")?.scrollIntoView({ behavior: "smooth", block: "center" }), 200); flick(); return; }
    if (g.view === "library") { backToLibrary(); if (g.hint === "export") hint(tx("📤 ייצוא מופיע ליד ספר שנוצר מהקלטה חיה במכשיר הזה")); if (g.hint === "archive") { setArchiveOpen(true); hint(tx("▾ ליד ספר מוריד אותו לארכיון · ☑ בחר — קבוצה שלמה")); } flick(); return; }
    if (g.ch) { if (!book) return needBook(); setChannel(g.ch); setView("tv"); flick(); if (g.hint === "mark") hint(tx("לחץ על משפט התחלה ואז על משפט סוף — ואז מרקר, קו או 📝 הערה")); return; }
    switch (g.act) {
      case "scroll": return book ? openScroll() : needBook();
      case "mirror": return book ? openMirror(book.id) : needBook();
      case "lang": return changeLang(g.lang);
      case "share": return book ? (share ? backToShare() : startShare()) : needBook();
      case "join": return joinByCode();
      case "nikud": if (!book) return needBook(); setView("tv"); if (!nikudOn) toggleNikud(); return;
      case "gloss": if (!book) return needBook(); setView("tv"); setGlossOn(true); return;
      case "cloud": return setShowCloud(true);
      case "backup": return downloadBackup();
      case "restore": return pickRestoreFile();
      case "lang": setTimeout(() => document.querySelector(".lang-pick")?.focus(), 100); return hint(tx("תיבת השפה בשורה העליונה"));
      case "font": bumpFont(0.1); return hint(tx("א− / א+ בשורה העליונה"));
      case "bg": return setBgOpen(true);
      case "focus": return book ? setFocus(true) : needBook();
      case "print": return window.print();
      case "help": return setHelpOn(true);
      case "privacy": return window.open(SITE_URL + "/privacy/", "_blank");
      case "opening": return setShowOpening(true);
      default: return;
    }
  };
  /* ניווט לתוצאת תוכן: פותח את הספר בפרק, ובמשפט */
  const hitGuardRef = useRef(0); // אחרי ניווט מתוצאת חיפוש: לחיצות על משפטים נבלעות לרגע, כדי שלא ייפתח מצב בחירת טווח
  const goHit = async (h) => {
    closeFind(); setError(null); hitGuardRef.current = Date.now();
    const b = (book && book.id === h.bookId) ? book : await loadBook(h.bookId);
    if (!b) return;
    setBook(b); setChIdx(h.ch); setChannel(h.kind === "result" && h.channel ? h.channel : "read"); clearSelection(); flick(); setView("tv");
    hitGuardRef.current = Date.now();
    if (h.kind !== "result") setTimeout(() => { const el = document.querySelector(`[data-si="${h.si}"]`); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("search-hit"); setTimeout(() => el.classList.remove("search-hit"), 2600); } }, 450);
  };
  /* ☑ בחירה מרובה: "בחר" מציג תיבות; "סמן הכול"; "לארכיון" / "למסך" פועלים על המסומנים בלבד. */
  const [selMode, setSelMode] = useState(false);
  const [selIds, setSelIds] = useState(() => new Set());
  const toggleSel = (id) => setSelIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setPinMany = async (ids, pin) => {
    if (!ids.length) return;
    let nextIdx = index;
    for (const id of ids) {
      const b = await loadBook(id);
      if (!b || isPinned(b) === pin) continue;
      const nb = { ...b, flex: { ...(b.flex || {}), pin } };
      await saveBookToStorage(nb);
      nextIdx = nextIdx.map((e) => e.id === id ? { ...e, pin } : e);
      if (book && book.id === id) setBook(nb);
      queueSync({ k: "meta", book: nb });
    }
    setIndex(nextIdx);
    await saveIndex(nextIdx);
    setSelIds(new Set());
    setSelMode(false);
  };
  const togglePin = async (id) => {
    const b = await loadBook(id);
    if (!b) return;
    const pin = !isPinned(b);
    const nb = { ...b, flex: { ...(b.flex || {}), pin } };
    await saveBookToStorage(nb);
    const nextIdx = index.map((e) => e.id === id ? { ...e, pin } : e);
    setIndex(nextIdx);
    await saveIndex(nextIdx);
    if (book && book.id === id) setBook(nb);
    queueSync({ k: "meta", book: nb });
  };
  const [fileBusy, setFileBusy] = useState(null); // הודעת סטטוס בזמן קריאת קובץ

  /* ── ארון הספרים → ייבוא ללימוד ── */
  const [shelfIdx, setShelfIdx] = useState(null);     // index.json של הארון
  const [shelfErr, setShelfErr] = useState(null);
  const [shelfFilter, setShelfFilter] = useState("");  // מדף נבחר ("" = הכל)
  const [shelfQ, setShelfQ] = useState("");            // חיפוש בשמות
  const [shelfPick, setShelfPick] = useState(null);    // ספר שנבחר (רשומת המפתח)
  const [shelfSegs, setShelfSegs] = useState(null);    // הקטעים של הספר שנבחר
  const [shelfOpts, setShelfOpts] = useState([]);      // שערים/חלקים לבחירה בספר ענק

  /* ── מצב מגילה (גמיש) ── */
  const [markMode, setMarkMode] = useState(null); // null | 'start' | 'end' | 'bookmark'
  const [selStart, setSelStart] = useState(null); // אינדקס פסקה
  const [selEnd, setSelEnd] = useState(null);
  const [dragText, setDragText] = useState("");   // טקסט שסומן בגרירה
  const [wordSel, setWordSel] = useState(null);   // סימון ברמת מילה: {i, s, e} — משפט + טווח תווים
  const [transRes, setTransRes] = useState(null); // "גע ותרגם": {q,t,n?,err?,cached?}
  const [transLoading, setTransLoading] = useState(false);
  const [smartMode, setSmartMode] = useState("asis"); // תבנית צלם דף חכם — ברירת המחדל: דף רגיל (רוב השימוש); דף הזוהר המשולב הוא מסלול צדדי
  const [layerOn, setLayerOn] = useState(() => { try { return localStorage.getItem("lomedtv-layer") !== "off"; } catch { return true; } }); // ✍️ שכבת הלומד מוצגת?
  /* 🔊 הקראה כקריוקי: הנגן פתוח מעל טקסט הפרק; readPos = {i, c} המשפט והתו שנקראים עכשיו */
  const [helpOn, setHelpOn] = useState(false); // ❔ המדריך מעל המסך
  const [readerOn, setReaderOn] = useState(false);
  const [readPos, setReadPos] = useState(null);
  const [readerStart, setReaderStart] = useState(null);
  /* הגלילה בזמן ההקראה: השורה הנקראת יושבת בקביעות מעט מעל מרכז המסך, והדף גולש אליה ברצף (בלי קפיצות).
     נגיעה/גלגלת של הלומד משהה את המעקב ל-4 שניות. */
  const reading = readPos != null;
  useEffect(() => {
    if (!reading) return;
    let raf = 0, hold = 0, sb = null;
    const onUser = () => { hold = Date.now() + 4000; };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const sent = document.querySelector(".read-sents .kara-now");
      if (!sent) return;
      if (!sb) { sb = sent.closest(".screen-body"); if (!sb) return; sb.addEventListener("wheel", onUser, { passive: true }); sb.addEventListener("touchmove", onUser, { passive: true }); }
      if (Date.now() < hold) return;
      const done = sent.querySelectorAll(".kara-done");
      const el = done.length ? done[done.length - 1] : sent;
      const r = el.getBoundingClientRect(), b = sb.getBoundingClientRect();
      const diff = (done.length ? r.top + r.height / 2 : r.top + 14) - (b.top + b.height * 0.42); /* השורה הנקראת: מעט מעל מרכז המסך, תמיד באותו גובה */
      if (Math.abs(diff) < 1.5) return;
      const step = diff * 0.045;
      sb.scrollTop += Math.abs(step) < 0.6 ? Math.sign(diff) * 0.6 : step;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); if (sb) { sb.removeEventListener("wheel", onUser); sb.removeEventListener("touchmove", onUser); } };
  }, [reading]);
  /* 📖 מילון ארמי בזמן ההקראה: לכל משפט ארמי נשמר ב-book.flex.gloss[i] מערך פירושים — פירוש עברי קצר לכל מילה (לפי סדר המילים).
     מופק פעם אחת (Claude, חבילות של עד 3 משפטים, מהמשפט הנקרא והלאה) ונשמר עם הספר. */
  const [glossOn, setGlossOn] = useState(() => { try { return localStorage.getItem("lomedtv-gloss") !== "off"; } catch { return true; } });
  const [glossBusy, setGlossBusy] = useState("");
  const glossRun = useRef(false);
  useEffect(() => { try { localStorage.setItem("lomedtv-gloss", glossOn ? "on" : "off"); } catch {} }, [glossOn]);
  const splitWords = (t) => (t || "").match(/\S+/g) || [];
  const glossOf = (i) => {
    if (!glossOn || view !== "tv" || channel !== "read") return null;
    const g = book?.flex?.gloss?.[i];
    return Array.isArray(g) && g.length === splitWords(sentences[i]).length && glossHasNikud(g) ? g : null;
  };
  /* פירושים שהוכנו לפני שהמילון נוקד (בלי אף סימן ניקוד) מוכנים מחדש */
  const glossHasNikud = (g) => { const t = g.filter(Boolean); return !t.length || t.some((x) => /[\u0591-\u05C7]/.test(x)); };
  /* ארמית? פסקה שאחריה "הסולם:", או (בספר בלי סולם) משפט שרוב סימניו ארמיים */
  const isAramaicSent = (i, chParas) => {
    const pi = chParas.findIndex(([st, c]) => i >= st && i < st + c);
    if (pi < 0) return false;
    const kind = paraKind(sentences, chParas, pi).trim();
    if (kind === "sulam") return false;
    if (kind === "zohar") return true;
    const ws = splitWords(stripNikud(sentences[i]));
    if (ws.length < 3) return false;
    const hits = ws.filter((x) => /(א|ין|הו|וי)$/.test(x) || /^(ד|כד|בגין|אי|הא|לאו|מאן|האי|דא|כלא|קב"ה|דאיהו)/.test(x)).length;
    return hits / ws.length >= 0.3;
  };
  useEffect(() => {
    if (!glossOn || view !== "tv" || channel !== "read" || glossRun.current) return;
    const [rs, re] = chapterRanges[chIdx] || [0, 0];
    const chParas = paraGroups.filter(([start]) => start >= rs && start < re);
    const todo = [];
    const have = bookRef.current?.flex?.gloss || {};
    /* בזמן הקראה — מהמשפט הנקרא והלאה; אחרת — כל הפרק הפתוח מתחילתו (בחבילות, אחת אחרי השנייה) */
    const from = readerOn && readPos?.i != null ? readPos.i : rs;
    for (let i = from; i < re && todo.length < 3; i++) {
      if ((have[i] && glossHasNikud(have[i])) || !isAramaicSent(i, chParas)) continue;
      todo.push(i);
    }
    if (!todo.length) return;
    glossRun.current = true;
    setGlossBusy("📖 מכין את המילון…");
    (async () => {
      try {
        const lists = todo.map((i) => splitWords(sentences[i]));
        const body = todo.map((i, n) => `משפט ${n + 1}:\n` + lists[n].map((wd, k) => `${k + 1}. ${wd}`).join("\n")).join("\n\n");
        const data = await askClaude(
          `לפניך משפטים מהזוהר בארמית, מפוצלים למילים ממוספרות. לכל מילה כתוב פירוש עברי קצר (מילה אחת עד שלוש) לפי ההקשר במשפט — תרגום מילולי של המילה בלבד, לא ביאור. כתוב כל פירוש בניקוד מלא ומדויק (למשל: "אָמַר", "שֶׁל הָעוֹלָם"). למילה שהיא כבר עברית/שם/ציון מקור (כגון "ישעיהו", "ל"ב:כ'", אות סימון) החזר מחרוזת ריקה. שמור על מספר הפירושים = מספר המילים, באותו סדר.\n\n${body}\n\nהחזר JSON בלבד: {"s":[["פירוש מילה 1","פירוש מילה 2",...], ...]} — מערך אחד לכל משפט, לפי הסדר.`,
          1200,
          true
        );
        const arr = Array.isArray(data?.s) ? data.s : [];
        const b = bookRef.current; if (!b) return;
        const gloss = { ...(b.flex?.gloss || {}) };
        todo.forEach((i, n) => {
          const g = Array.isArray(arr[n]) ? arr[n].map((x) => String(x || "").trim()) : [];
          const need = lists[n].length;
          gloss[i] = g.length >= need ? g.slice(0, need) : [...g, ...Array(need - g.length).fill("")];
        });
        await persist({ ...b, flex: { ...(b.flex || {}), gloss } });
      } catch (e) {
        setGlossBusy("📖 המילון לא הוכן: " + e.message);
        setTimeout(() => setGlossBusy(""), 6000);
        glossRun.current = false;
        return;
      }
      setGlossBusy("");
      glossRun.current = false;
    })();
  }, [glossOn, readerOn, readPos?.i, book?.flex?.gloss, view, channel, chIdx]);
  const [nikudOn, setNikudOn] = useState(() => { try { return localStorage.getItem("lomedtv-nikud") === "on"; } catch { return false; } }); // נִ הניקוד מוצג?
  const [nikudMsg, setNikudMsg] = useState("");
  const nikudRun = useRef(0); // מספר הריצה הנוכחית; כיבוי או ריצה חדשה עוצרים את הקודמת
  /* ✍️ שכבת הלומד על טקסט של ערוצים (סיכום, מושגים, כרטיסיות) — נשמרת ב-book.flex.layer */
  const setLayerEntry = (k, entry) => {
    const b = bookRef.current; if (!b) return;
    persist({ ...b, flex: { ...(b.flex || {}), layer: { ...(b.flex?.layer || {}), [k]: entry } } });
  };
  const layerFor = (base) => ({ base, layer: book?.flex?.layer || {}, onChange: setLayerEntry, on: layerOn, transcribe: (blob) => transcribeMedia(blob, null, "הערה קצרה של לומד") });
  const toggleLayer = () => {
    const next = !layerOn;
    try { localStorage.setItem("lomedtv-layer", next ? "on" : "off"); } catch {}
    setLayerOn(next);
  };
  const [zoharArts, setZoharArts] = useState(null); // רשימת המאמרים של הפרשה שנבחרה (מספריא)
  const [ytForm, setYtForm] = useState({ url: "", title: "", text: "" }); // ▶ שער יוטיוב
  const [zoharForm, setZoharForm] = useState({ p: ZOHAR_DEFAULT_PARASHA, from: "", to: "", name: "" }); // 📜 שער הזוהר
  const dragJustRef = useRef(false);              // מונע שלחיצת-גרירה תיספר כלחיצת-בחירה
  const [flexResult, setFlexResult] = useState(null); // {channel, data}
  const [flexLoading, setFlexLoading] = useState(null); // label בזמן הפקה
  const [flexError, setFlexError] = useState(null);
  const [quizPick, setQuizPick] = useState(null); // null | 'tv' | 'flex' — בורר גודל מבחן פתוח
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState(null); // null=סגור, []=אין תוצאות
  const [checkedHits, setCheckedHits] = useState([]);
  const scrollBodyRef = useRef(null);
 
  const titleRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const photoRef = useRef(null);
  const smartRef = useRef(null);
  const mediaRef = useRef(null); // שער הקול — קובץ אודיו/וידאו לתמלול
  const cameraRef = useRef(null); // מצלמה חיה — צילום ישיר לצלם החכם
  const recRef = useRef(null); // הקלטה חיה — MediaRecorder פעיל
  const [recOn, setRecOn] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [recIds, setRecIds] = useState(() => new Set()); // 📤 לאילו ספרים יש הקלטה שמורה במכשיר (וגם "pending")
  const [recPend, setRecPend] = useState(null);          // פרטי ההקלטה שעוד לא תומללה: {sec, bytes, at}
  const [recReady, setRecReady] = useState(null);        // מזהה שהקובץ שלו כבר נטען וממתין ללחיצה שנייה (ספארי)
  const recFileRef = useRef(null);
  useEffect(() => {
    (async () => {
      try {
        const keys = (await idbKeys()).filter((k) => typeof k === "string" && k.startsWith(REC_PREFIX)).map((k) => k.slice(REC_PREFIX.length));
        setRecIds(new Set(keys));
        if (keys.includes(REC_PENDING)) { const r = await idbGet(recKey(REC_PENDING)); if (r?.blob) setRecPend({ sec: r.sec || 0, bytes: r.blob.size, at: r.at || 0 }); }
      } catch {}
    })();
  }, []);
  const [fontScale, setFontScale] = useState(() => {
    try { const v = parseFloat(localStorage.getItem("lomedtv-fontscale")); return v >= 0.7 && v <= 1.8 ? v : 1; } catch { return 1; }
  });
  const bumpFont = (d) => {
    setFontScale((s) => {
      const v = Math.min(1.8, Math.max(0.7, Math.round((s + d) * 10) / 10));
      try { localStorage.setItem("lomedtv-fontscale", String(v)); } catch {}
      return v;
    });
  };

  /* ─── הפנים: מסך הפתיחה — "מתי בפעם האחרונה ספר ענה לך בחזרה?" ───
     מוצג בפעם הראשונה (אין lomedtv-opened), ובכל פעם שהלומד חוזר אליו דרך "ל · הפנים".
     השאלה שהלומד נושא נשמרת (lomedtv-question) ומלווה אותו בספרייה ובקליטה כפתק ❓ —
     הצעד הראשון של "השאלות הפתוחות שלי". */
  /* שפת הממשק (צ'אט 25): הבחירה נשמרת ב-lomedtv-lang; ההחלפה מציירת את המסך מחדש */
  const [, setLangTick] = useState(0);
  const [transLang, setTransLang] = useState(null); // שפת היעד של ערוץ התרגום; null = ברירת המחדל לפי הטקסט
  const changeLang = (l) => {
    setLang(l); setLangTick((n) => n + 1);
    (async () => { const idx = await loadIndex(); const next = await seedStarter(idx); if (next !== idx) setIndex(next); })();
  };
  /* תגי הבחירה ("⌈ התחלה", "סוף ⌋") מצוירים ב-CSS; המילים נכנסות דרך משתני CSS כדי שיתורגמו עם שפת המסך */
  useEffect(() => {
    const st = document.documentElement.style;
    st.setProperty("--sel-a", JSON.stringify(tx("⌈ התחלה")));
    st.setProperty("--sel-z", JSON.stringify(tx("סוף ⌋")));
    st.setProperty("--sel-q", JSON.stringify(tx("סוף?")));
    st.setProperty("--sel-w", JSON.stringify(tx("⌈ התחלה · לחץ על משפט הסוף")));
  });
  const [showOpening, setShowOpening] = useState(() => {
    try { return !localStorage.getItem("lomedtv-opened"); } catch { return true; }
  });
  const [openQ, setOpenQ] = useState(() => {
    try { return localStorage.getItem("lomedtv-question") || ""; } catch { return ""; }
  });
  const openQRef = useRef(null);
  const saveOpenQ = (q) => {
    const v = (q || "").trim();
    setOpenQ(v);
    try { v ? localStorage.setItem("lomedtv-question", v) : localStorage.removeItem("lomedtv-question"); } catch {}
  };
  /* חמשת השערים: text → תיבת ההדבקה · photo → מצלמה · video → וידאו · file → קובץ שמע/וידאו · rec → מסך הקליטה (הקלטה) */
  const enterFromOpening = (withQuestion, gate) => {
    if (withQuestion) saveOpenQ(openQRef.current?.value);
    try { localStorage.setItem("lomedtv-opened", new Date().toISOString()); } catch {}
    setShowOpening(false);
    setError(null);
    if (shareRef.current || (pendingJoinRef.current && !pendingQuietRef.current)) return; /* הגענו מקישור הזמנה — הדף המשותף כבר נפתח (או ייפתח אחרי הכניסה) */
    const inputId = gate === "photo" ? "camera-scan-input" : gate === "video" ? "video-capture-input" : gate === "file" ? "media-transcribe-input" : null;
    if (inputId) {
      document.getElementById(inputId)?.click();
      return;
    }
    if (gate === "text" || gate === "rec" || !index.length) {
      setView("intake");
      if (gate === "text") setTimeout(() => inputRef.current?.focus(), 80);
    } else {
      setView("library");
    }
  };

  /* ─── חשבון ענן (Supabase) — שלב 1: כניסה בקישור למייל ─── */
  const [cloudUser, setCloudUser] = useState(null);
  const [showCloud, setShowCloud] = useState(false);
  const [cloudEmail, setCloudEmail] = useState("");
  const [cloudMsg, setCloudMsg] = useState("");
  const [cloudPwOn, setCloudPwOn] = useState(false); // כניסה בסיסמה (לחשבון שהוגדרה לו סיסמה)
  const [cloudPw, setCloudPw] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [cloudCode, setCloudCode] = useState("");      // קוד כניסה מהמייל (מובייל)
  const [cloudSent, setCloudSent] = useState(false);   // נשלח מייל — להציג שדה קוד
  const [authReady, setAuthReady] = useState(false);   // כבר יודעים אם יש חשבון מחובר (לא שואלים לפני כן)
  /* 🕯 אורח בשם בלבד (צ'אט 24): מי שהגיע מקישור הזמנה נכנס בלי מייל — כותב שם ובפנים */
  const [guestAsk, setGuestAsk] = useState(false);
  const [guestName, setGuestName] = useState(() => { try { return localStorage.getItem("lomedtv-guest-name") || ""; } catch { return ""; } });
  const [guestMsg, setGuestMsg] = useState("");
  const [guestBusy, setGuestBusy] = useState(false);
  const authErrHe = (m) => /security purposes|rate limit|only request this after/i.test(m || "") ? tx("רגע — אפשר לבקש קישור חדש רק פעם בדקה. המייל הקודם שנשלח עדיין בתוקף.") : /invalid|not valid/i.test(m || "") ? tx("כתובת המייל לא תקינה — לבדוק שאין תו מיותר בסוף.") : tx("שגיאה: ") + m;
  async function guestEnter() {
    const name = guestName.trim().slice(0, 30);
    if (!name) { setGuestMsg(tx("לכתוב שם — כך החבר יראה אותך.")); return; }
    setGuestBusy(true); setGuestMsg("");
    try { localStorage.setItem("lomedtv-guest-name", name); } catch {}
    try {
      const { error } = await supa.auth.signInAnonymously({ options: { data: { name } } });
      if (error) { console.warn("guest sign-in", error.message); setGuestMsg(tx("כניסת אורח לא זמינה כרגע — אפשר להיכנס במייל (למטה).")); }
      else setGuestAsk(false); /* ההצטרפות עצמה קורית מעצמה כשהחשבון נכנס */
    } catch (e) { console.warn("guest sign-in", e); setGuestMsg(tx("כניסת אורח לא זמינה כרגע — אפשר להיכנס במייל (למטה).")); }
    setGuestBusy(false);
  }
  useEffect(() => {
    supa.auth.getSession().then(({ data }) => { setCloudUser(data?.session?.user || null); setAuthReady(true); }).catch(() => setAuthReady(true));
    const { data: sub } = supa.auth.onAuthStateChange((_ev, session) => setCloudUser(session?.user || null));
    /* מובייל: הקישור מהמייל מפנה ל-lomedtv://auth#access_token=... —
       iOS פותח את האפליקציה עם הכתובת, ואנחנו מכניסים את הסשן. */
    let listener = null;
    if (IS_NATIVE) {
      CapApp.addListener("appUrlOpen", async ({ url }) => {
        try {
          if (!url || !url.startsWith("lomedtv://")) return;
          const hash = url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
          const q = url.includes("?") ? url.slice(url.indexOf("?") + 1).split("#")[0] : "";
          const params = new URLSearchParams(hash || q);
          const access_token = params.get("access_token");
          const refresh_token = params.get("refresh_token");
          const code = params.get("code");
          if (access_token && refresh_token) {
            const { error } = await supa.auth.setSession({ access_token, refresh_token });
            setCloudMsg(error ? tx("שגיאת כניסה: ") + error.message : tx("✅ מחובר!"));
          } else if (code) {
            const { error } = await supa.auth.exchangeCodeForSession(code);
            setCloudMsg(error ? tx("שגיאת כניסה: ") + error.message : tx("✅ מחובר!"));
          } else if (params.get("error_description")) {
            setCloudMsg(tx("שגיאת כניסה: ") + params.get("error_description"));
          }
        } catch (e) {
          console.error("appUrlOpen failed", e);
        }
      }).then((h) => { listener = h; });
    }
    return () => {
      try { sub.subscription.unsubscribe(); } catch {}
      try { listener && listener.remove(); } catch {}
    };
  }, []);
  async function sendMagicLink() {
    const email = cloudEmail.trim();
    if (!email || !email.includes("@")) { setCloudMsg(tx("כתובת מייל לא תקינה")); return; }
    setCloudMsg(tx("שולח קישור..."));
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: IS_NATIVE ? "lomedtv://auth" : window.location.origin + (() => { try { const v = JSON.parse(localStorage.getItem("lomedtv-pending-join") || "null"); return v && v.c && Date.now() - v.t < 24 * 3600e3 ? "/?join=" + encodeURIComponent(v.c) : ""; } catch { return ""; } })() },
    });
    if (error) { setCloudMsg(authErrHe(error.message)); return; }
    setCloudSent(true);
    setCloudMsg(IS_NATIVE
      ? tx("✅ נשלח! פתח את המייל בטלפון ולחץ על הקישור — האפליקציה תיפתח מחוברת. (אם יש במייל קוד — אפשר גם להזין אותו כאן)")
      : tx("✅ נשלח! פתח את המייל שלך ולחץ על הקישור — תחזור לכאן מחובר."));
  }
  /* כניסה עם קוד מהמייל — הדרך במובייל, שם הקישור נפתח בדפדפן ולא באפליקציה.
     דורש שתבנית המייל ב-Supabase תכלול את {{ .Token }}. */
  async function verifyCode() {
    const email = cloudEmail.trim();
    const token = cloudCode.replace(/\D/g, "");
    if (!email || token.length < 6) { setCloudMsg(tx("הזן את המייל ואת הקוד בן 6 הספרות מהמייל")); return; }
    setCloudMsg(tx("בודק קוד..."));
    const { error } = await supa.auth.verifyOtp({ email, token, type: "email" });
    if (error) { setCloudMsg(tx("הקוד לא התקבל: ") + error.message); return; }
    setCloudCode("");
    setCloudSent(false);
    setCloudMsg(tx("✅ מחובר!"));
  }
  async function cloudSignOut() {
    await supa.auth.signOut();
    setCloudMsg("");
  }
  /* כניסה בסיסמה — לחשבון שהוגדרה לו סיסמה (למשל חשבון הדגמה). הדרך הרגילה נשארת קישור למייל. */
  async function signInPassword() {
    const email = cloudEmail.trim();
    if (!email || !email.includes("@") || !cloudPw) { setCloudMsg(tx("הזן מייל וסיסמה")); return; }
    setCloudMsg(tx("נכנס..."));
    const { error } = await supa.auth.signInWithPassword({ email, password: cloudPw });
    if (error) { setCloudMsg(tx("שגיאת כניסה: ") + error.message); return; }
    setCloudPw(""); setCloudPwOn(false);
    setCloudMsg(tx("✅ מחובר!"));
  }
  /* מחיקת חשבון: מוחק מהענן את החשבון ואת כל מה ששמור תחתיו (ספרים, הערות, תוצרים, קבצי קול),
     ואחר כך מנקה את המכשיר הזה. בלתי הפיך. המחיקה בענן נעשית בפונקציית מסד הנתונים
     delete_my_account (supabase/delete_account.sql) — היא מוחקת רק את מי שקרא לה. */
  async function deleteAccount() {
    const u = cloudRef.current;
    if (!u || delBusy) return;
    if (!window.confirm(tx("למחוק את החשבון לצמיתות?\nכל הספרים, ההערות, התוצרים וההקלטות ששמורים בענן ובמכשיר הזה יימחקו. אי אפשר לשחזר."))) return;
    if (!window.confirm(tx("אישור אחרון: למחוק את החשבון ואת כל הנתונים?"))) return;
    setDelBusy(true);
    setCloudMsg(tx("מוחק את החשבון..."));
    try {
      /* קבצי הקול בענן: voice/<uid>/<ספר>/<קובץ> */
      try {
        const st = supa.storage.from("voice");
        const { data: dirs } = await st.list(u.id, { limit: 1000 });
        for (const d of dirs || []) {
          const { data: files } = await st.list(u.id + "/" + d.name, { limit: 1000 });
          const paths = (files || []).map((f) => u.id + "/" + d.name + "/" + f.name);
          if (paths.length) await st.remove(paths); else await st.remove([u.id + "/" + d.name]);
        }
      } catch (e) { console.warn("voice cleanup", e); }
      const { error } = await supa.rpc("delete_my_account");
      if (error) throw new Error(error.message);
      /* המכשיר הזה: כל מה שהאפליקציה שמרה */
      try { for (const k of await idbKeys()) if (typeof k === "string" && k.startsWith("ltv-")) await idbDel(k); } catch {}
      try { const lang = localStorage.getItem("lomedtv-lang"); for (const k of Object.keys(localStorage)) if (k.startsWith("lomedtv-") || k.startsWith("sb-")) localStorage.removeItem(k); if (lang) localStorage.setItem("lomedtv-lang", lang); } catch {}
      try { await supa.auth.signOut({ scope: "local" }); } catch {}
      window.alert(tx("החשבון וכל הנתונים נמחקו."));
      location.reload();
    } catch (e) {
      console.error("deleteAccount failed", e);
      setCloudMsg(tx("המחיקה נכשלה: ") + (e.message || "") + " · " + tx("אפשר לפנות אלינו ונמחק ידנית:") + " haimamar135@gmail.com");
      setDelBusy(false);
    }
  }

  /* ─── שלב 3: מנוע הסנכרון ───
     pushWholeBook — ספר שלם (פרקים + תוצרים + הערות). משמש בהגירה, ביצירת ספר
     ובכל מקרה שהספר עוד לא קיים בענן.
     בשאר הזמן נשלח רק מה שהשתנה: מרקר/ציון/סימנייה → עדכון שדה; הערה → שורה אחת;
     תוצר → שורה אחת. כך סימון מרקר בשער הכוונות (565 פרקים) לא שולח מגה-בייט. */
  const [syncState, setSyncState] = useState("idle"); // idle | saving | ok | err
  const [syncErr, setSyncErr] = useState("");
  const cloudRef = useRef(null);
  useEffect(() => { cloudRef.current = cloudUser; }, [cloudUser]);

  async function pushWholeBook(book, uid) {
    const now = new Date().toISOString();
    const { error: e1 } = await supa.from("books").upsert({
      user_id: uid,
      id: book.id,
      title: book.title || "",
      chapters: book.chapters || [],
      progress: book.progress || {},
      marks: book.marks || {},
      flex: book.flex || {},
      updated_at: now,
    });
    if (e1) throw new Error(e1.message);
    const outRows = [];
    for (const k of Object.keys(book.results || {})) {
      const p = k.indexOf(":");
      if (p < 1) continue;
      const ci = parseInt(k.slice(0, p), 10);
      const ch = k.slice(p + 1);
      if (isNaN(ci) || !ch) continue;
      outRows.push({ user_id: uid, book_id: book.id, chapter_idx: ci, channel: ch, data: { v: book.results[k] }, updated_at: now });
    }
    for (let j = 0; j < outRows.length; j += 40) {
      const { error: e2 } = await supa.from("outputs").upsert(outRows.slice(j, j + 40));
      if (e2) throw new Error(e2.message);
    }
    const noteRows = Object.keys(book.notes || {})
      .map((k) => ({
        user_id: uid,
        book_id: book.id,
        sent_idx: parseInt(k, 10),
        text: (book.notes[k] && book.notes[k].t) || "",
        src_quote: (book.notes[k] && book.notes[k].src) || "",
        updated_at: now,
      }))
      .filter((r) => !isNaN(r.sent_idx) && r.text.trim());
    for (let j = 0; j < noteRows.length; j += 100) {
      const { error: e3 } = await supa.from("notes").upsert(noteRows.slice(j, j + 100));
      if (e3) throw new Error(e3.message);
    }
    setSyncStamp(book.id, now);
    return { outputs: outRows.length, notes: noteRows.length };
  }

  /* עדכון קל — רק השדות שמשתנים תוך כדי לימוד. אם השורה עוד לא בענן: העלאה מלאה. */
  async function pushBookMeta(book, uid) {
    const now = new Date().toISOString();
    const { data, error } = await supa
      .from("books")
      .update({ title: book.title || "", progress: book.progress || {}, marks: book.marks || {}, flex: book.flex || {}, updated_at: now })
      .eq("user_id", uid)
      .eq("id", book.id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data || !data.length) { await pushWholeBook(book, uid); return; }
    setSyncStamp(book.id, now);
  }
  /* מרענן את חותמת הזמן של הספר אחרי כתיבת הערה/תוצר, כדי שמכשיר אחר יידע שיש חדש. */
  async function touchBook(bookId, uid, now) {
    const { data, error } = await supa.from("books").update({ updated_at: now }).eq("user_id", uid).eq("id", bookId).select("id");
    if (error) throw new Error(error.message);
    if (data && data.length) { setSyncStamp(bookId, now); return true; }
    return false;
  }
  async function pushNote(book, i, uid) {
    const now = new Date().toISOString();
    const n = (book.notes || {})[i];
    if (n && (n.t || "").trim()) {
      const { error } = await supa.from("notes").upsert({
        user_id: uid, book_id: book.id, sent_idx: Number(i),
        text: n.t || "", src_quote: n.src || "", updated_at: now,
      });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supa.from("notes").delete().eq("user_id", uid).eq("book_id", book.id).eq("sent_idx", Number(i));
      if (error) throw new Error(error.message);
    }
    if (!(await touchBook(book.id, uid, now))) await pushWholeBook(book, uid);
  }
  async function pushOutput(book, ci, ch, uid) {
    const now = new Date().toISOString();
    const v = (book.results || {})[ci + ":" + ch];
    if (v === undefined) return;
    const { error } = await supa.from("outputs").upsert({
      user_id: uid, book_id: book.id, chapter_idx: Number(ci), channel: ch, data: { v }, updated_at: now,
    });
    if (error) throw new Error(error.message);
    if (!(await touchBook(book.id, uid, now))) await pushWholeBook(book, uid);
  }

  /* תור הסנכרון: הערה ותוצר נשלחים מיד (אירוע בודד);
     מרקרים/ציונים מתאחדים בהשהיה קצרה כדי לא להציף בסימון רצוף. */
  const syncTimer = useRef(null);
  const syncJob = useRef(null);
  async function runSync(job) {
    const uid = cloudRef.current?.id;
    if (!uid || !job || !job.book) return;
    try {
      setSyncState("saving");
      setSyncErr("");
      if (job.k === "full") await pushWholeBook(job.book, uid);
      else if (job.k === "note") await pushNote(job.book, job.i, uid);
      else if (job.k === "output") await pushOutput(job.book, job.ci, job.ch, uid);
      else await pushBookMeta(job.book, uid);
      setSyncState("ok");
    } catch (e) {
      console.error("sync failed", e);
      setSyncState("err");
      setSyncErr(e.message || tx("שגיאת סנכרון"));
    }
  }
  function queueSync(job) {
    if (!cloudRef.current || cloudRef.current.is_anonymous) return; /* אורח: שום דבר לא עולה לענן */
    if (job.k !== "meta") { runSync(job); return; }
    syncJob.current = job;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      const j = syncJob.current;
      syncJob.current = null;
      runSync(j);
    }, 1200);
  }

  /* ─── שלב 2: הגירה — העלאת כל הספרייה המקומית לענן ───
     upsert = הרצה חוזרת בטוחה (מעדכנת, לא מכפילה). */
  const [migrating, setMigrating] = useState(false);
  async function migrateToCloud() {
    if (!cloudUser || migrating) return;
    setMigrating(true);
    try {
      setCloudMsg(tx("קורא את הספרייה המקומית..."));
      const idx = await loadIndex();
      if (!idx.length) { setCloudMsg(tx("אין ספרים מקומיים להעלאה.")); setMigrating(false); return; }
      let nBooks = 0, nOutputs = 0, nNotes = 0;
      for (let i = 0; i < idx.length; i++) {
        const b = await loadBook(idx[i].id);
        if (!b) continue;
        setCloudMsg(tx("מעלה ספר ") + (i + 1) + "/" + idx.length + ": " + (b.title || "") + "...");
        try {
          const r = await pushWholeBook(b, cloudUser.id);
          nBooks++;
          nOutputs += r.outputs;
          nNotes += r.notes;
        } catch (e) {
          throw new Error(tx("ספר") + ' "' + (b.title || "") + '": ' + e.message);
        }
      }
      setCloudMsg(tx("✅ ההעלאה הושלמה! ") + nBooks + tx(" ספרים · ") + nOutputs + tx(" תוצרים · ") + nNotes + tx(" הערות — שמורים בענן."));
    } catch (e) {
      setCloudMsg(tx("שגיאה בהעלאה: ") + e.message);
    }
    setMigrating(false);
  }

  /* ─── שלב 3: משיכה מהענן ─── */
  const [pullList, setPullList] = useState(null); // ספרים שיש בענן ואינם מעודכנים כאן
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState("");
  const [pullChecked, setPullChecked] = useState(false);

  async function fetchCloudIndex(uid) {
    const { data, error } = await supa.from("books").select("id,title,updated_at").eq("user_id", uid);
    if (error) throw new Error(error.message);
    return data || [];
  }
  async function pullBook(id, uid) {
    const { data: rows, error } = await supa.from("books").select("*").eq("user_id", uid).eq("id", id).limit(1);
    if (error) throw new Error(error.message);
    const b = rows && rows[0];
    if (!b) throw new Error(tx("הספר לא נמצא בענן"));
    const { data: outs, error: eo } = await supa.from("outputs").select("chapter_idx,channel,data").eq("user_id", uid).eq("book_id", id);
    if (eo) throw new Error(eo.message);
    const { data: nts, error: en } = await supa.from("notes").select("sent_idx,text,src_quote").eq("user_id", uid).eq("book_id", id);
    if (en) throw new Error(en.message);
    const results = {};
    for (const o of outs || []) if (o.data && o.data.v !== undefined) results[o.chapter_idx + ":" + o.channel] = o.data.v;
    const notes = {};
    for (const n of nts || []) if ((n.text || "").trim()) notes[n.sent_idx] = { t: n.text, src: n.src_quote || "" };
    const nb = {
      id: b.id,
      title: b.title || "",
      chapters: b.chapters || [],
      results,
      progress: b.progress || {},
      marks: b.marks || {},
      flex: b.flex || {},
      notes,
    };
    await saveBookToStorage(nb);
    setSyncStamp(nb.id, b.updated_at);
    return { book: nb, updatedAt: Date.parse(b.updated_at) || Date.now() };
  }

  /* בדיקה חד-פעמית בכל כניסה: האם בענן יש משהו חדש יותר ממה שיש כאן? */
  useEffect(() => {
    if (!cloudUser) { if (pullChecked) setPullChecked(false); return; }
    if (pullChecked) return;
    setPullChecked(true);
    if (cloudUser.is_anonymous) return;
    (async () => {
      try {
        const cloud = await fetchCloudIndex(cloudUser.id);
        if (!cloud.length) return;
        const localIdx = await loadIndex();
        const localIds = new Set(localIdx.map((b) => b.id));
        /* ריצה ראשונה של שלב 3: מה שכבר הועלה בהגירה נחשב מסונכרן — לא מציקים. */
        let raw = null;
        try { raw = localStorage.getItem("ltv-cloud-stamps"); } catch {}
        if (!raw) for (const c of cloud) if (localIds.has(c.id)) setSyncStamp(c.id, c.updated_at);
        const st = syncStamps();
        const fresh = cloud.filter((c) => {
          if (!localIds.has(c.id)) return !String(c.id).startsWith("shared-"); // ספר שאין כאן בכלל (עותקי לימוד משותף ישנים — לא מציעים)
          if (st[c.id] === c.updated_at) return false; // המכשיר הזה כתב אותו אחרון
          const loc = localIdx.find((b) => b.id === c.id);
          return (Date.parse(c.updated_at) || 0) > ((loc && loc.updatedAt) || 0);
        });
        if (fresh.length) setPullList(fresh.map((c) => ({ ...c, isNew: !localIds.has(c.id) })));
        /* ולכיוון השני: ספר שנוצר כאן כשלא היינו מחוברים — עולה עכשיו מעצמו.
           העלאה בלבד, לא נוגעת בשום דבר מקומי. */
        const cloudIds = new Set(cloud.map((c) => c.id));
        const orphans = localIdx.filter((b) => !cloudIds.has(b.id));
        if (orphans.length) {
          setSyncState("saving");
          for (const o of orphans) {
            const b = await loadBook(o.id);
            if (b) await pushWholeBook(b, cloudUser.id);
          }
          setSyncState("ok");
        }
      } catch (e) {
        console.error("cloud check failed", e);
        setSyncState("err");
        setSyncErr(e.message || tx("בדיקת הענן נכשלה"));
      }
    })();
  }, [cloudUser, pullChecked]);

  async function doPull(list) {
    if (!cloudUser || pulling || !list || !list.length) return;
    setPulling(true);
    setPullMsg("");
    try {
      let idx = await loadIndex();
      for (let i = 0; i < list.length; i++) {
        setPullMsg(tx("מוריד {a}/{b}: {t}...", { a: i + 1, b: list.length, t: list[i].title || "" }));
        const { book: nb, updatedAt } = await pullBook(list[i].id, cloudUser.id);
        const entry = { id: nb.id, title: nb.title, chapters: nb.chapters.length, done: doneCount(nb), talk: talkCount(nb), pin: isPinned(nb), updatedAt };
        idx = [entry, ...idx.filter((b) => b.id !== nb.id)];
        if (book && book.id === nb.id) setBook(nb);
      }
      await saveIndex(idx);
      setIndex(idx);
      setPullMsg(tx("✅ הורדו {n} ספרים מהענן.", { n: list.length }));
      setPullList(null);
      setSyncState("ok");
      if (view === "intake" && idx.length) setView("library");
    } catch (e) {
      setPullMsg(tx("שגיאה בהורדה: ") + e.message);
    }
    setPulling(false);
  }

  /* כפתור ידני בחלון החשבון — למכשיר חדש, או כשרוצים לרענן ביוזמה. */
  async function manualPull() {
    if (!cloudUser) return;
    setCloudMsg(tx("בודק מה יש בענן..."));
    try {
      const cloud = await fetchCloudIndex(cloudUser.id);
      if (!cloud.length) { setCloudMsg(tx("אין ספרים בענן עדיין.")); return; }
      setCloudMsg("");
      setShowCloud(false);
      setPullMsg("");
      setPullList(cloud.map((c) => ({ ...c, isNew: false, manual: true })));
    } catch (e) {
      setCloudMsg(tx("שגיאה: ") + e.message);
    }
  }
 
  /* כל טקסט הספר כמשפטים (מקובצים לפסקאות) — למצב המגילה.
     סימון ברמת משפט: כל לחיצה בוחרת משפט, כך שאפשר לסמן קטע מדויק
     גם כשהספר נקלט כפסקה אחת ארוכה (למשל מקובץ וורד). */
  const { sentences, paraGroups, chapterRanges } = useMemo(() => bookSentences(book), [book?.id, book?.chapters?.length, book?.flex?.textRev]);
  /* שלב 2: שפת הספר קובעת את כיוון הטקסט, את קול ההקראה, ואם ניקוד ומילון ארמי רלוונטיים */
  const bookLang = useMemo(() => textLang(sentences.slice(0, 40).join(" ")), [sentences]);
  const textDir = bookLang === "he" || bookLang === "ar" ? "rtl" : "ltr";
  const textIsHe = !book || bookLang === "he";

  /* נִ ניקוד: הנוסח המנוקד של משפט, אם הניקוד מוצג ויש נוסח תקף (אותן אותיות בדיוק) */
  const vocOf = (i) => {
    if (!nikudOn) return null;
    const v = book?.flex?.nikud?.[i];
    return v && stripNikud(v) === sentences[i] ? v : null;
  };
  /* מנקד את מה שמוצג (הפרק הפתוח, או כל הספר במגילה): רק משפטים שאין בהם ניקוד ועוד לא נוקדו */
  const runNikud = async () => {
    const b0 = bookRef.current;
    if (!b0) return;
    const run = ++nikudRun.current;
    const [rs, re] = view === "tv" ? (chapterRanges[chIdx] || [0, 0]) : [0, sentences.length];
    const have = b0.flex?.nikud || {};
    const todo = [];
    for (let i = rs; i < re; i++) {
      const t = sentences[i];
      if (!t || NIKUD_MARK.test(t) || !/[א-ת]/.test(t)) continue;
      if (have[i] && stripNikud(have[i]) === t) continue;
      todo.push(i);
    }
    if (!todo.length) return;
    const batches = [];
    let cur = [], size = 0;
    for (const i of todo) {
      const len = sentences[i].length;
      if (cur.length && size + len > NIKUD_BATCH) { batches.push(cur); cur = []; size = 0; }
      cur.push(i); size += len;
    }
    if (cur.length) batches.push(cur);
    let done = 0;
    try {
      for (const batch of batches) {
        if (nikudRun.current !== run) return;
        setNikudMsg(`מנקד… ${done} מתוך ${todo.length} משפטים`);
        const data = await postJson("/.netlify/functions/nikud", { texts: batch.map((i) => sentences[i]), genre: "rabbinic" });
        if (nikudRun.current !== run) return;
        const b = bookRef.current;
        if (!b || b.id !== b0.id) return;
        const nikud = { ...(b.flex?.nikud || {}) };
        batch.forEach((i, k) => {
          const v = data.texts?.[k];
          if (v && v !== sentences[i] && stripNikud(v) === sentences[i]) nikud[i] = v;
        });
        await persist({ ...b, flex: { ...(b.flex || {}), nikud } });
        done += batch.length;
      }
      setNikudMsg("");
    } catch (e) {
      if (nikudRun.current === run) { setNikudMsg("הניקוד לא הושלם: " + e.message); setTimeout(() => setNikudMsg(""), 7000); }
    }
  };
  const toggleNikud = () => {
    const next = !nikudOn;
    try { localStorage.setItem("lomedtv-nikud", next ? "on" : "off"); } catch {}
    setNikudOn(next);
    if (!next) { nikudRun.current++; setNikudMsg(""); }
  };
  /* כשהניקוד דלוק: כל פרק או ספר שנפתח מנוקד פעם אחת, ונשמר עם הספר */
  useEffect(() => {
    if (!nikudOn || !book || !sentences.length) return;
    if (!(view === "tv" && channel === "read") && view !== "scroll") return;
    if (view === "scroll" && sentences.reduce((n, t) => n + t.length, 0) > NIKUD_SCROLL_MAX) {
      setNikudMsg("ספר גדול: הניקוד נוסף פרק-פרק, בערוץ 00 של כל פרק");
      const t0 = setTimeout(() => setNikudMsg(""), 6000);
      return () => clearTimeout(t0);
    }
    const t = setTimeout(runNikud, 400);
    return () => clearTimeout(t);
  }, [nikudOn, book?.id, sentences.length, chIdx, view, channel]);
 
  useEffect(() => {
    (async () => {
      let idx = await loadIndex();
      /* שיקוף: ספרים שנשמרו לפני שהאינדקס ידע לספור הערות וסימונים — משלימים פעם אחת */
      if (idx.some((b) => b.talk === undefined || b.pin === undefined)) {
        idx = await Promise.all(idx.map(async (b) => (b.talk === undefined || b.pin === undefined) ? (async () => { const bk = await loadBook(b.id); return { ...b, talk: b.talk === undefined ? talkCount(bk) : b.talk, pin: isPinned(bk) }; })() : b));
        await saveIndex(idx);
      }
      idx = await seedStarter(idx);
      setIndex(idx);
      setView(idx.length ? "library" : "intake");
    })();
  }, []);
 
  const key = (ci, id) => `${ci}:${id}`;
  const flick = () => { setStaticFx(true); setTimeout(() => setStaticFx(false), 260); };
 
  /* שמירה: ספר + עדכון האינדקס בפעולה אחת — ומאז שלב 3, גם לענן.
     sync מתאר מה בדיוק השתנה, כדי שלענן ייסע רק זה:
       {k:"meta"}                — מרקרים / ציונים / סימנייה / שם
       {k:"note", i}             — הערה אחת על משפט i
       {k:"output", ci, ch}      — תוצר אחד (פרק ci, ערוץ ch)
       {k:"full"}                — הספר כולו (יצירה / העלאה ראשונה) */
  const persist = async (nextBook, sync = { k: "meta" }) => {
    setBook(nextBook);
    const entry = {
      id: nextBook.id,
      title: nextBook.title,
      chapters: nextBook.chapters.length,
      done: doneCount(nextBook),
      talk: talkCount(nextBook),
      pin: isPinned(nextBook),
      updatedAt: Date.now(),
    };
    const nextIdx = [entry, ...index.filter((b) => b.id !== nextBook.id)];
    setIndex(nextIdx);
    await saveBookToStorage(nextBook);
    await saveIndex(nextIdx);
    if (sync) queueSync({ ...sync, book: nextBook });
  };

  /* ── 🕯 לימוד משותף: מצב, ערוץ, אירועים ── */
  const [share, setShare] = useState(null);   // {id, code, hostId, hostName, holder, follow, bookId}
  const [peers, setPeers] = useState({});     // uid → {uid, name, color, marks, notes, pos}
  const [shareMsg, setShareMsg] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [shareVideo, setShareVideo] = useState(false); // 📹 חלון הווידאו פתוח?
  const [shareWatch, setShareWatch] = useState(false); // הווידאו נפתח מעצמו בצפייה (מי שהצטרף)
  const [shareLost, setShareLost] = useState(false);   // הערוץ נפל
  const [shareEpoch, setShareEpoch] = useState(0);     // "הצטרף מחדש" — בונה את הערוץ מחדש
  const shareChanRef = useRef(null);
  const shareRef = useRef(null);
  useEffect(() => { shareRef.current = share; }, [share]);
  const myUid = cloudUser?.id || null;
  const myShareColor = (uid) => SHARE_COLORS[Math.abs([...(uid || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % SHARE_COLORS.length];
  const shareSend = (event, payload) => { try { shareChanRef.current?.send({ type: "broadcast", event, payload: { ...payload, from: cloudRef.current?.id } }); } catch {} };
  const openSharedBook = async (row, isHost) => {
    const snap = row.book || {};
    let b;
    /* מארח: הספר שלו (גם אם חזר אחרי טעינה מחדש — נטען לפי ספר המקור) */
    if (isHost) { b = (book && (!snap.id || book.id === snap.id)) ? book : ((snap.id && await loadBook(snap.id)) || null); }
    if (!b) {
      /* אורח: עותק אחד לכל ספר מקור (snap.id), לא עותק לכל קוד — הסימונים וההערות נשארים מפעם לפעם */
      const id = "shared-" + (snap.id || row.code);
      const existing = (await loadBook(id)) || (await loadBook("shared-" + row.code));
      b = existing || { id, title: snap.title || tx("לימוד משותף"), chapters: snap.chapters || [], results: {}, progress: {}, marks: {}, notes: {}, flex: {} };
      if (!existing) await persist(b, { k: "meta" });
    }
    try { localStorage.setItem("lomedtv-share-active", JSON.stringify({ c: row.code, t: Date.now() })); } catch {}
    setShareLost(false); setShowOpening(false); setShowCloud(false); setGuestAsk(false);
    if (!isHost) { setShareWatch(true); setShareVideo(true); }
    setShare({ id: row.id, code: row.code, hostId: row.host, hostName: row.host_name || "", holder: row.holder || row.host, follow: !isHost, bookId: b.id, pay: isHost ? savedPay() : "host" });
    setPeers({});
    setBook(b);
    setChIdx(0);
    setChannel("read");
    setError(null);
    setView("tv");
  };
  const hostCodes = () => { try { return JSON.parse(localStorage.getItem("lomedtv-share-host") || "{}") || {}; } catch { return {}; } };
  const rememberHostCode = (bookId, code) => { try { const m = hostCodes(); if (code) m[bookId] = { c: code, t: Date.now() }; else delete m[bookId]; localStorage.setItem("lomedtv-share-host", JSON.stringify(m)); } catch {} };
  const startShare = async () => {
    if (!book) return;
    if (!cloudUser) { setShareMsg(tx("להיכנס לחשבון (☁) כדי להזמין ללימוד משותף.")); return; }
    setShareMsg("");
    const code = makeShareCode();
    const snap = { id: book.id, title: book.title, chapters: (book.chapters || []).map((c) => ({ title: c.title, text: c.text })) };
    /* יש כבר שיעור פתוח שלי על הספר הזה? חוזרים אליו — הקוד והקישור שנשלחו נשארים בתוקף.
       קודם לפי הקוד שהמכשיר זוכר (אותה דרך שבה אורח מצטרף), ואחר כך בחיפוש בטבלה. */
    try {
      const mem = hostCodes()[book.id];
      if (mem && Date.now() - mem.t < 12 * 3600e3) {
        const { data: j, error: je } = await supa.rpc("join_session", { p_code: mem.c, p_name: shareNameOf(cloudUser), p_color: myShareColor(cloudUser.id) });
        if (je) console.warn("share reuse (code)", je.message);
        if (j && j.id && j.host === cloudUser.id) { try { await supa.from("sessions").update({ book: snap }).eq("id", j.id); } catch {} await openSharedBook({ ...j, book: snap }, true); return; }
        console.warn("share reuse (code): not reusable", mem.c, j);
      }
    } catch (e) { console.warn("share reuse (code)", e); }
    try {
      const { data: old, error: oe } = await supa.from("sessions").select("*").eq("host", cloudUser.id).eq("status", "open").eq("book->>id", book.id).limit(1);
      if (oe) console.warn("share reuse (select)", oe.message);
      if (old && old[0]) { rememberHostCode(book.id, old[0].code); try { await supa.from("sessions").update({ book: snap }).eq("id", old[0].id); } catch {} await openSharedBook({ ...old[0], book: snap }, true); return; }
    } catch {}
    const { data, error } = await supa.from("sessions").insert({ code, host: cloudUser.id, host_name: shareNameOf(cloudUser), book: snap, holder: cloudUser.id }).select("*").single();
    if (error) { setShareMsg(tx("לא הצלחתי לפתוח שיעור: ") + error.message); return; }
    rememberHostCode(book.id, code);
    await openSharedBook(data, true);
  };
  const joinShare = async (code, quiet) => {
    if (!cloudUser) { setShareMsg(tx("להיכנס לחשבון (☁) כדי להצטרף ללימוד המשותף.")); return; }
    setShareMsg("");
    try { localStorage.removeItem("lomedtv-pending-join"); } catch {}
    const { data, error } = await supa.rpc("join_session", { p_code: code, p_name: shareNameOf(cloudUser), p_color: myShareColor(cloudUser.id) });
    console.log("join_session", code, error || data);
    if (error || !data || !data.id) {
      try { localStorage.removeItem("lomedtv-share-active"); } catch {}
      if (!quiet) setShareMsg(tx("לא נמצא שיעור פתוח עם הקוד ") + code + tx(" — אולי המארח כבר סיים. לבקש ממנו קישור חדש."));
      return;
    }
    await openSharedBook(data, data.host === cloudUser.id);
  };
  const leaveShare = async () => {
    const sh = shareRef.current;
    /* "סיים" סוגר את החדר לכולם — לא בלחיצה בטעות */
    if (sh && sh.hostId === myUid && !window.confirm(tx("לסיים את הלימוד המשותף? החדר ייסגר לכולם, והקישור שנשלח יפסיק לעבוד."))) return;
    if (sh && sh.hostId === myUid) { rememberHostCode(sh.bookId, null); shareSend("closed", {}); try { await supa.from("sessions").update({ status: "closed" }).eq("id", sh.id); } catch {} }
    try { localStorage.removeItem("lomedtv-share-active"); } catch {}
    setShare(null); setPeers({}); setShareVideo(false); setShareWatch(false); setShareLost(false);
  };
  const takePage = async () => {
    const sh = shareRef.current; if (!sh || !myUid) return;
    try { await supa.from("sessions").update({ holder: myUid }).eq("id", sh.id); } catch {}
    setShare({ ...sh, holder: myUid, follow: false });
    shareSend("holder", { uid: myUid });
  };
  /* החדר חי גם כשיוצאים מהספר — מכאן חוזרים לדף המשותף */
  const backToShare = async () => {
    const sh = shareRef.current; if (!sh) return;
    const b = book && book.id === sh.bookId ? book : await loadBook(sh.bookId);
    if (!b) { setShareMsg(tx("הספר של הלימוד המשותף לא נמצא במכשיר הזה.")); return; }
    setBook(b); setChannel("read"); setError(null); setView("tv");
  };
  const toggleFollow = () => setShare((sh) => sh ? { ...sh, follow: !sh.follow } : sh);
  const copyShareLink = async () => {
    const sh = shareRef.current; if (!sh) return;
    /* באפליקציה (Capacitor) הכתובת היא capacitor://localhost — הקישור חייב להצביע על האתר */
    const url = `${IS_NATIVE ? SITE_URL + "/" : location.origin + location.pathname}?join=${sh.code}`;
    const text = tx("בוא נלמד יחד במסך הלמידה — \"{title}\". פתח את הקישור וכתוב את שמך — הדף והווידאו ייפתחו מעצמם: {url}", { title: book?.title || "", url });
    /* בטלפון: גיליון השיתוף (וואטסאפ וכו'); במחשב: העתקה ללוח */
    if (navigator.share && (IS_NATIVE || /iPhone|iPad|Android/i.test(navigator.userAgent))) {
      try { await navigator.share({ title: tx("לימוד משותף"), text, url }); return; } catch (e) { if (e?.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); setShareCopied(true); setTimeout(() => setShareCopied(false), 1800); } catch { window.prompt(tx("הקישור להזמנה:"), url); }
  };
  /* הצטרפות מקישור ?join=CODE — אחרי שיש כניסה לחשבון */
  const pendingJoinRef = useRef(null);
  const pendingQuietRef = useRef(false);
  useEffect(() => {
    try {
      const fresh = (k, hours) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v && v.c && Date.now() - v.t < hours * 3600e3 ? String(v.c).toUpperCase() : null; } catch { return null; } };
      const c = new URLSearchParams(location.search).get("join");
      if (c) {
        /* נשמר גם בדפדפן: הכניסה במייל טוענת את האתר מחדש בלי ?join= — וההזמנה הייתה אובדת */
        pendingJoinRef.current = c.toUpperCase();
        try { localStorage.setItem("lomedtv-pending-join", JSON.stringify({ c: pendingJoinRef.current, t: Date.now() })); } catch {}
        setShowOpening(false); history.replaceState(null, "", location.pathname + location.hash);
      } else {
        const saved = fresh("lomedtv-pending-join", 24);
        const active = fresh("lomedtv-share-active", 12);
        if (saved) { pendingJoinRef.current = saved; setShowOpening(false); }
        /* הייתי בחדר והדף נטען מחדש — חוזרים אליו בשקט (אם עוד פתוח) */
        else if (active) { pendingJoinRef.current = active; pendingQuietRef.current = true; }
      }
    } catch {}
  }, []);
  useEffect(() => {
    if (pendingJoinRef.current && cloudUser && view !== "boot") { const c = pendingJoinRef.current, q = pendingQuietRef.current; pendingJoinRef.current = null; pendingQuietRef.current = false; if (!q) setShowOpening(false); joinShare(c, q); }
    else if (pendingQuietRef.current) { /* שחזור שקט בלי חשבון — לא מציקים */ }
    /* בלי חשבון: הקישור נשמר, ומזמינים להיכנס — ההצטרפות תקרה אחרי הכניסה */
    else if (pendingJoinRef.current && !cloudUser && authReady && view !== "boot" && !guestAsk && !showCloud) { setShowOpening(false); setGuestAsk(true); }
  }, [cloudUser, view, authReady]);
  const dropPendingJoin = () => { pendingJoinRef.current = null; try { localStorage.removeItem("lomedtv-pending-join"); } catch {} setGuestAsk(false); };
  /* 🕯 הצטרפות עם קוד מתוך האפליקציה (צ'אט 22) — בלי קישור: חבר אומר את הקוד, מקלידים */
  const joinByCode = () => {
    const c = (window.prompt(tx("קוד השיעור (6 תווים, מהחבר שפתח את הלימוד):"), "") || "").trim().toUpperCase();
    if (!c) return;
    if (!cloudUser) { pendingJoinRef.current = c; try { localStorage.setItem("lomedtv-pending-join", JSON.stringify({ c, t: Date.now() })); } catch {} setGuestAsk(true); return; }
    joinShare(c);
  };
  /* הערוץ: presence (מי כאן) + broadcast (סימונים, הערות, מיקום, מחזיק הדף) */
  useEffect(() => {
    if (!share || !myUid) return;
    const ch = supa.channel("session:" + share.id, { config: { broadcast: { self: false }, presence: { key: myUid } } });
    shareChanRef.current = ch;
    const upsertPeer = (uid, patch) => setPeers((ps) => uid === myUid ? ps : { ...ps, [uid]: { uid, name: "", color: myShareColor(uid), marks: {}, notes: {}, ...(ps[uid] || {}), ...patch } });
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState();
      setPeers((ps) => {
        const next = {};
        for (const uid of Object.keys(st)) { if (uid === myUid) continue; const meta = st[uid][0] || {}; next[uid] = { uid, color: myShareColor(uid), marks: {}, notes: {}, ...(ps[uid] || {}), name: meta.name || ps[uid]?.name || tx("לומד") }; }
        return next;
      });
    });
    ch.on("broadcast", { event: "layer" }, ({ payload }) => upsertPeer(payload.from, { marks: payload.marks || {}, notes: payload.notes || {} }));
    ch.on("broadcast", { event: "pos" }, ({ payload }) => {
      upsertPeer(payload.from, { pos: { ch: payload.ch, si: payload.si } });
      const sh = shareRef.current;
      if (sh && sh.follow && payload.from === sh.holder) {
        if (payload.ch !== chIdxRef.current) { setChIdx(payload.ch); setChannel("read"); setView("tv"); }
        setTimeout(() => document.querySelector(`[data-si="${payload.si}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }), payload.ch !== chIdxRef.current ? 350 : 0);
      }
    });
    ch.on("broadcast", { event: "holder" }, ({ payload }) => setShare((sh) => sh ? { ...sh, holder: payload.uid, follow: payload.uid !== myUid } : sh));
    ch.on("broadcast", { event: "hello" }, () => { const b = bookRef.current; shareSend("layer", { marks: b?.marks || {}, notes: b?.notes || {} }); const sh = shareRef.current; if (sh && sh.hostId === myUid) shareSend("pay", { mode: sh.pay || "host" }); });
    /* 🌐 הדף הדו-לשוני: מי משלם על התרגום (קובע היוזם בלבד), בקשת תרגום, והתרגום עצמו בחלקים */
    ch.on("broadcast", { event: "pay" }, ({ payload }) => setShare((sh) => sh && payload.from === sh.hostId && PAY_MODES.includes(payload.mode) ? { ...sh, pay: payload.mode } : sh));
    ch.on("broadcast", { event: "tr-req" }, ({ payload }) => biRef.current.onReq?.(payload));
    ch.on("broadcast", { event: "tr" }, ({ payload }) => biRef.current.onTr?.(payload));
    ch.on("broadcast", { event: "closed" }, () => { try { localStorage.removeItem("lomedtv-share-active"); } catch {} setShare(null); setPeers({}); setShareVideo(false); setShareWatch(false); setShareMsg(tx("המארח סיים את הלימוד המשותף.")); });
    let gone = false;
    ch.subscribe(async (status) => {
      if (gone) return;
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { setShareLost(true); return; }
      if (status === "SUBSCRIBED") {
        setShareLost(false);
        await ch.track({ name: shareNameOf(cloudRef.current), color: myShareColor(myUid) });
        const b = bookRef.current;
        shareSend("layer", { marks: b?.marks || {}, notes: b?.notes || {} });
        shareSend("hello", {});
      }
    });
    /* הרשת חזרה / חזרנו ללשונית — אם הערוץ לא מחובר, בונים אותו מחדש לבד */
    const revive = () => { if (gone) return; if (ch.state !== "joined" && ch.state !== "joining") setShareEpoch((n) => n + 1); else if (ch.state === "joined") setShareLost(false); };
    const onVis = () => { if (document.visibilityState === "visible") revive(); };
    const onOff = () => setShareLost(true);
    window.addEventListener("online", revive); window.addEventListener("offline", onOff); document.addEventListener("visibilitychange", onVis);
    /* שים לב: סגירת הערוץ כאן אינה סוגרת את השיעור — רק "סיים" (leaveShare) משדר closed */
    return () => { gone = true; window.removeEventListener("online", revive); window.removeEventListener("offline", onOff); document.removeEventListener("visibilitychange", onVis); supa.removeChannel(ch); shareChanRef.current = null; };
  }, [share?.id, myUid, shareEpoch]);
  const bookRef = useRef(null); useEffect(() => { bookRef.current = book; }, [book]);
  const chIdxRef = useRef(0); useEffect(() => { chIdxRef.current = chIdx; }, [chIdx]);

  /* ── 🌐 הדף הדו-לשוני (מדרגה 1ב, צ'אט 26) ──
     כל לומד רואה את הפרק גם בשפתו: מתחת לכל פסקת מקור — הפסקה המתורגמת, משפט מול משפט.
     הסימונים, ההערות והמיקום נשארים על משפטי המקור (אותו מספר משפט אצל כולם), ולכן עוברים בין שפות בלי שינוי.
     התרגום הוא אותו תוצר של ערוץ 09 (results["פרק:trans:שפה"]) — מופק פעם אחת ונשמר.
     שתי מערכות נפרדות: מחזיק הדף (share.holder, עובר ב"מסור את הדף") — ומי משלם על התרגום (share.pay, רק היוזם קובע):
       host — היוזם מפיק לכולם · each — כל אחד מפיק לעצמו · guest — המתארח מפיק.
     תרגום שכבר קיים אצל היוזם נשלח לכל מבקש בלי עלות. */
  const [biMode, setBiMode] = useState(() => { try { const v = localStorage.getItem("lomedtv-bi"); return v === "both" || v === "only" ? v : "off"; } catch { return "off"; } });
  /* שפת הדף שלי: כל עוד הלומד לא בחר אחרת — שפת הממשק */
  const [biSel, setBiLang] = useState(() => { try { const v = localStorage.getItem("lomedtv-bi-lang"); return LANGS.some(([id]) => id === v) ? v : null; } catch { return null; } });
  const biLang = biSel || getLang();
  const [biMsg, setBiMsg] = useState("");
  const biBusy = useRef({}), biBuf = useRef({}), biRef = useRef({});
  useEffect(() => { try { localStorage.setItem("lomedtv-bi", biMode); if (biSel) localStorage.setItem("lomedtv-bi-lang", biSel); } catch {} }, [biMode, biSel]);
  const setPay = (mode) => { if (!share || share.hostId !== myUid || !PAY_MODES.includes(mode)) return; try { localStorage.setItem("lomedtv-share-pay", mode); } catch {} setShare((sh) => sh ? { ...sh, pay: mode } : sh); shareSend("pay", { mode }); };
  const isAnonMe = () => !cloudRef.current || !!cloudRef.current.is_anonymous;
  const produceTrans = async (ci, lang) => {
    const k = ci + ":" + lang;
    if (biBusy.current[k]) return null;
    biBusy.current[k] = Date.now();
    const b0 = bookRef.current;
    try {
      if (!b0?.chapters?.[ci]) return null;
      setBiMsg(tx("🌐 מתרגם את הפרק…"));
      const t = await translateSentences(chapterSentences(b0.chapters[ci].text).sentences, lang);
      const b = bookRef.current;
      if (b && b.id === b0.id && !b.results?.[key(ci, "trans:" + lang)]) await persist({ ...b, results: { ...b.results, [key(ci, "trans:" + lang)]: { lang, t } } }, { k: "output", ci, ch: "trans:" + lang });
      setBiMsg("");
      return t;
    } catch (e) { setBiMsg("🌐 " + (e?.message || tx("התרגום נכשל. נסה שוב."))); return null; }
    finally { delete biBusy.current[k]; }
  };
  const sendTrans = async (ci, lang, t) => {
    for (let at = 0; at < t.length; at += 20) { shareSend("tr", { ci, lang, n: t.length, at, t: t.slice(at, at + 20) }); await new Promise((r) => setTimeout(r, 150)); }
  };
  const acquireTrans = (ci, lang) => {
    const k = ci + ":" + lang;
    if (biBusy.current[k]) return;
    const sh = shareRef.current, anon = isAnonMe(), mode = sh?.pay || "host";
    const mine = !sh || (mode === "host" ? sh.hostId === myUid : mode === "each" ? true : sh.hostId !== myUid);
    if (mine && !anon) { produceTrans(ci, lang); return; }
    if (!sh) { setBiMsg("🌐 " + loginMsg()); return; }
    biBusy.current[k] = Date.now();
    setBiMsg(tx("🌐 מבקש את התרגום…"));
    shareSend("tr-req", { ci, lang });
    setTimeout(() => {
      if (!biBusy.current[k]) return;
      delete biBusy.current[k]; delete biBuf.current[k];
      if (bookRef.current?.results?.[key(ci, "trans:" + lang)]) return;
      setBiMsg(anon && mode !== "host" ? tx("🌐 בלימוד הזה כל משתתף מתרגם על חשבונו — להיכנס לחשבון (☁) כדי לתרגם.") : tx("🌐 התרגום לא הגיע — מי שמפיק אותו צריך להיות מחובר ללימוד."));
    }, 45000);
  };
  biRef.current.onReq = async ({ ci, lang }) => {
    const sh = shareRef.current, b = bookRef.current;
    if (!sh || !b || b.id !== sh.bookId || !Number.isInteger(ci) || !LANGS.some(([id]) => id === lang)) return;
    const isHost = sh.hostId === myUid, anon = isAnonMe(), mode = sh.pay || "host";
    const cached = b.results?.[key(ci, "trans:" + lang)]?.t;
    if (cached) { if (isHost) sendTrans(ci, lang, cached); return; }
    const producer = !anon && (mode === "host" ? isHost : mode === "guest" ? !isHost : false);
    if (!producer) return;
    const t = await produceTrans(ci, lang);
    if (t) sendTrans(ci, lang, t);
  };
  biRef.current.onTr = async ({ ci, lang, n, at, t }) => {
    const sh = shareRef.current, b = bookRef.current;
    if (!sh || !b || b.id !== sh.bookId || !Array.isArray(t) || !(n > 0) || n > 5000) return;
    const k = ci + ":" + lang, kk = key(ci, "trans:" + lang);
    if (b.results?.[kk]) return;
    const buf = biBuf.current[k] && biBuf.current[k].n === n ? biBuf.current[k] : (biBuf.current[k] = { n, arr: new Array(n).fill(null) });
    t.forEach((x, j) => { if (at + j < n) buf.arr[at + j] = String(x); });
    if (buf.arr.some((x) => x === null)) return;
    delete biBuf.current[k]; delete biBusy.current[k];
    if (chapterSentences(b.chapters?.[ci]?.text || "").sentences.length !== n) { setBiMsg(tx("🌐 התרגום שהגיע לא תואם לנוסח הפרק שאצלך.")); return; }
    await persist({ ...b, results: { ...b.results, [kk]: { lang, t: buf.arr } } }, { k: "output", ci, ch: "trans:" + lang });
    setBiMsg("");
  };
  const biWanted = biMode !== "off" && !!book && view === "tv" && channel === "read" && biLang !== bookLang;
  const biHave = !!book?.results?.[key(chIdx, "trans:" + biLang)];
  useEffect(() => {
    if (!biWanted || biHave) return;
    const t = setTimeout(() => acquireTrans(chIdx, biLang), 700);
    return () => clearTimeout(t);
  }, [biWanted, biHave, book?.id, chIdx, biLang, share?.id, share?.pay]);
  useEffect(() => { setBiMsg(""); }, [chIdx, biLang, book?.id, biMode]);
  /* הסימונים וההערות שלי יוצאים לחבר בכל שינוי (עם השהיה קצרה) */
  useEffect(() => {
    if (!share || !book || book.id !== share.bookId) return;
    const t = setTimeout(() => shareSend("layer", { marks: book.marks || {}, notes: book.notes || {} }), 250);
    return () => clearTimeout(t);
  }, [share?.id, book?.marks, book?.notes]);
  /* מחזיק הדף משדר איפה הוא — המשפט הראשון שנראה במסך */
  useEffect(() => {
    if (!share || share.holder !== myUid) return;
    let last = -1, t = null;
    const report = () => {
      const box = document.querySelector(".screen-body"); if (!box) return;
      const top = box.getBoundingClientRect().top + 8;
      const els = box.querySelectorAll(".read-sents [data-si]");
      let si = -1;
      for (const el of els) { if (el.getBoundingClientRect().bottom >= top) { si = parseInt(el.getAttribute("data-si"), 10); break; } }
      if (si < 0 || si === last) return;
      last = si;
      shareSend("pos", { ch: chIdxRef.current, si });
    };
    const onScroll = () => { clearTimeout(t); t = setTimeout(report, 300); };
    window.addEventListener("scroll", onScroll, true);
    const t0 = setTimeout(report, 600);
    return () => { window.removeEventListener("scroll", onScroll, true); clearTimeout(t); clearTimeout(t0); };
  }, [share?.id, share?.holder, myUid, chIdx, view, channel]);
  /* השכבה של החברים על משפט i: מרקר/הערה/סמן */
  const peerLayer = (i) => {
    if (!share) return null;
    let cls = "", title = "", color = null, note = null, here = null;
    for (const p of Object.values(peers)) {
      const mk = p.marks?.[i];
      if (mk && (mk.hl || mk.b || mk.u || (mk.w && mk.w.length))) { cls += " peer-hl"; color = color || p.color; title += (title ? " · " : "") + tx("{name} סימן", { name: p.name }); }
      const n = p.notes?.[i]; const nt = typeof n === "string" ? n : n?.t;
      if (nt) { note = { name: p.name, color: p.color, t: nt }; }
      if (p.pos && p.pos.ch === chIdx && p.pos.si === i) here = p;
    }
    if (!cls && !note && !here) return null;
    return { cls: cls + (here ? " peer-here" : ""), color: color || here?.color || note?.color, title, note, here };
  };
 
  const buildBook = async (text, forcedTitle, stayInLibrary = false, presetChapters = null, extra = null) => {
    const chapters = presetChapters && presetChapters.length ? presetChapters : splitToChapters(text);
    const title =
      (forcedTitle && forcedTitle.trim()) ||
      titleRef.current?.value?.trim() ||
      chapters[0].title ||
      tx("ספר ללא שם");
    const nb = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      title,
      chapters,
      results: {},
      progress: {},
      ...(extra || {}),
    };
    await persist(nb, { k: "full" });
    setError(null);
    if (!stayInLibrary) {
      flick();
      setView("guide");
    }
    return nb;
  };

  /* ── ▶ שער יוטיוב: קישור + תמליל שהמשתמש הדביק ← ספר, והסרטון לצד הטקסט ── */
  const importYouTube = async () => {
    const id = ytId(ytForm.url);
    if (!id) { setError(tx("הקישור אינו קישור תקין לסרטון יוטיוב.")); return; }
    const text = cleanTranscript(ytForm.text);
    if (text.length < 80) { setError(tx("חסר התמליל: ביוטיוב, מתחת לסרטון — \"עוד\" ← \"הצג תמליל\" — להעתיק ולהדביק כאן.")); return; }
    await buildBook(text, ytForm.title.trim() || tx("סרטון יוטיוב"), false, null, { flex: { yt: { id, url: ytForm.url.trim() } } });
    setYtForm({ url: "", title: "", text: "" });
  };

  /* ── 📜 שער הזוהר: מאמר מספריא לפי פרשה ואותיות — נכנס כפרק לספר של אותה פרשה ── */
  const importZohar = async () => {
    const [en, he] = ZOHAR_PARSHIOT[zoharForm.p] || ZOHAR_PARSHIOT[ZOHAR_DEFAULT_PARASHA];
    const from = gematria(zoharForm.from);
    const to = zoharForm.to.trim() ? gematria(zoharForm.to) : from;
    if (!from) { setError("כתוב מאיזו אות מתחיל המאמר (למשל קמג)."); return; }
    if (!to || to < from) { setError("האות האחרונה צריכה להיות אחרי הראשונה."); return; }
    if (to - from > 40) { setError("עד 40 אותיות במשיכה אחת — מאמר ארוך מזה נמשך בשני חלקים."); return; }
    const name = zoharForm.name.trim() || `אותיות ${hebNum(from)}–${hebNum(to)}`;
    setError(null);
    setFileBusy("📜 פונה לספריא…");
    try {
      const text = await fetchZoharArticle(en, he, from, to, name, setFileBusy);
      const title = isZoharAddenda(en) ? `זוהר ${he.replace(/ \(.*\)$/, "")}` : `זוהר ${he} עם הסולם`;
      const chapter = { title: name, text };
      const existing = index.find((b) => b.title === title);
      const prev = existing ? await loadBook(existing.id) : null;
      if (prev) {
        await persist({ ...prev, chapters: [...prev.chapters, chapter] }, { k: "full" });
        flick();
        setView("guide");
      } else {
        await buildBook(text, title, false, [chapter]);
      }
      setZoharForm((f) => ({ ...f, from: "", to: "", name: "" }));
    } catch (e) {
      setError("משיכת הזוהר נכשלה: " + (e?.message || e));
    }
    setFileBusy(null);
  };

  useEffect(() => {
    if (view !== "intake" || !KABBALAH) return;
    const [en] = ZOHAR_PARSHIOT[zoharForm.p] || [];
    if (!en) return;
    let live = true;
    setZoharArts(null);
    fetchZoharArticles(en).then((a) => live && setZoharArts(a)).catch(() => live && setZoharArts([]));
    return () => { live = false; };
  }, [view, zoharForm.p]);
  const pickZoharArticle = (v) => {
    const a = zoharArts?.find((x) => String(x.n) === v);
    if (!a) return;
    setZoharForm((f) => ({ ...f, from: hebNum(a.from), to: hebNum(a.to), name: a.name || `מאמר ${a.n}` }));
  };

  /* ── הגשר: מהארון אל הלימוד ── */
  const openShelf = async () => {
    if (!KABBALAH) return;
    setError(null);
    setShelfErr(null);
    setShelfPick(null);
    setShelfSegs(null);
    setShelfOpts([]);
    flick();
    setView("shelf");
    if (shelfIdx) return;
    setFileBusy("קורא את מפתח הארון...");
    try {
      const idx = await shelfFetch("/index.json");
      if (!idx || !Array.isArray(idx.books)) throw new Error("מפתח הארון לא תקין");
      setShelfIdx(idx);
    } catch (e) {
      console.error("shelf index failed", e);
      setShelfErr(e.message || "הארון לא זמין כרגע");
    }
    setFileBusy(null);
  };

  /* ספר קטן — נכנס כולו. ספר ענק — מציגים שערים/חלקים לבחירה. */
  const pickShelfBook = async (b) => {
    setShelfErr(null);
    setShelfPick(b);
    setShelfSegs(null);
    setShelfOpts([]);
    setFileBusy(`מוריד את "${b.hebrew || b.title}" מהארון...`);
    try {
      const data = await shelfFetch("/books/" + b.file);
      const segs = (data && data.segments) || [];
      if (!segs.length) throw new Error("לא נמצאו קטעים בספר");
      if ((b.chars || 0) <= SHELF_IMPORT_MAX) {
        setFileBusy(null);
        await importFromShelf(b, segs, 0, segs.length, "");
        return;
      }
      const opts = [];
      for (const sec of shelfSections(segs)) opts.push(...shelfSplitSection(segs, sec, SHELF_IMPORT_MAX));
      setShelfSegs(segs);
      setShelfOpts(opts);
      setShelfQ("");
    } catch (e) {
      console.error("shelf book failed", e);
      setShelfErr(e.message || "הורדת הספר נכשלה");
      setShelfPick(null);
    }
    setFileBusy(null);
  };

  const importFromShelf = async (b, segs, from, to, suffix) => {
    const chapters = shelfToChapters(segs, from, to);
    if (!chapters.length) { setShelfErr("אין טקסט לייבוא"); return; }
    const name = b.hebrew || b.title || "ספר מהארון";
    const title = suffix ? `${name} — ${suffix}` : name;
    setFileBusy(`בונה "${title}" — ${chapters.length} פרקים...`);
    try {
      await buildBook("", title, false, chapters);
    } finally {
      setFileBusy(null);
    }
  };

  const createBook = async () => {
    const t = inputRef.current?.value?.trim();
    if (!t || t.length < 40) {
      setError(tx("הדבק טקסט של לפחות כמה משפטים, או העלה קובץ."));
      return;
    }
    await buildBook(t);
  };
 
  const onFilePicked = async (e) => {
    const files = Array.from(e.target.files || []);
    if (fileRef.current) fileRef.current.value = "";
    if (!files.length) return;
    setError(null);
    const failed = [];
 
    if (files.length === 1) {
      // קובץ בודד — נכנסים ישר לספר
      const file = files[0];
      setFileBusy(tx("קורא את \"{f}\"...", { f: file.name }));
      try {
        const text = await extractFileText(file);
        if (!text || text.length < 40) throw new Error(tx("לא נמצא מספיק טקסט בקובץ."));
        const base = file.name.replace(/\.[^.]+$/, "");
        setFileBusy(null);
        await buildBook(text, titleRef.current?.value?.trim() || base);
      } catch (err) {
        console.error("file extract failed", err);
        setError(err.message || tx("קריאת הקובץ נכשלה."));
        setFileBusy(null);
      }
      return;
    }
 
    // כמה קבצים — כל קובץ נהיה ספר בספרייה
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setFileBusy(tx("קורא קובץ {a}/{b}: \"{f}\"...", { a: i + 1, b: files.length, f: file.name }));
      try {
        const text = await extractFileText(file);
        if (!text || text.length < 40) throw new Error(tx("אין טקסט"));
        const base = file.name.replace(/\.[^.]+$/, "");
        await buildBook(text, base, true);
      } catch (err) {
        console.error("file failed:", file.name, err);
        failed.push(file.name);
      }
    }
    setFileBusy(null);
    if (failed.length) {
      setError(tx("נקלטו {n} ספרים. נכשלו: {f}", { n: files.length - failed.length, f: failed.join(", ") }));
    }
    flick();
    setView("library");
  };
 
  const onPhotosPicked = async (e) => {
    const files = Array.from(e.target.files || []).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
    if (photoRef.current) photoRef.current.value = "";
    if (!files.length) return;
    setError(null);
    setFileBusy(tx("טוען את מנוע ה-OCR (בפעם הראשונה זה לוקח רגע)..."));
    try {
      const text = await ocrImages(files, (n, total) =>
        setFileBusy(tx("מפענח צילום {a}/{b}... (OCR עברית)", { a: n, b: total }))
      );
      const base = files[0].name.replace(/\.[^.]+$/, "");
      const givenTitle = titleRef.current?.value?.trim();
      setFileBusy(null);
      await buildBook(text, givenTitle || tx("סריקה — ") + base);
    } catch (err) {
      console.error("ocr failed", err);
      setError(err.message || tx("פענוח הצילומים נכשל."));
      setFileBusy(null);
    }
  };
 
  const onSmartPicked = async (e) => {
    const files = Array.from(e.target.files || []).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
    e.target.value = ""; // ניקוי הקלט שממנו הגיעו הקבצים (העלאה או מצלמה)
    if (!files.length) return;
    setError(null);
    setFileBusy(tx("📸 טוען {b} צילומים…", { b: files.length })); // מיד עם הבחירה — שיהיה ברור שהעבודה התחילה
    /* המסך לא נרדם בזמן הסריקה (צ'אט 27: סריקה של כמה דקות נפלה כשהמק כיבה את הצג). הנעילה משתחררת בסוף; אם הלשונית הוסתרה וחזרה — מבקשים שוב. */
    let wake = null;
    const keepAwake = async () => { try { wake = await navigator.wakeLock?.request?.("screen"); } catch {} };
    const onVis = () => { if (document.visibilityState === "visible") keepAwake(); };
    await keepAwake();
    document.addEventListener("visibilitychange", onVis);
    const releaseWake = () => { document.removeEventListener("visibilitychange", onVis); try { wake?.release?.(); } catch {} };
    try {
      const scanned = await smartScanImages(files, smartMode, (n, total, extra) =>
        setFileBusy(tx("📸 המנוע קורא ומארגן את הדף {a}/{b}{x}... (עד דקה לעמוד)", { a: n, b: total, x: extra || "" }))
      );
      const text = typeof scanned === "string" ? scanned : scanned.text;
      const scanExtra = typeof scanned === "string" || !scanned.debug ? null : { flex: { scan: scanned.debug } };
      const base = files[0].name.replace(/\.[^.]+$/, "");
      const givenTitle = titleRef.current?.value?.trim();
      setFileBusy(null);
      /* צילומים שהועלו יחד הם מאמר אחד — פרק אחד, בלי חלוקה לפי אורך (חיים, צ'אט 27) */
      await buildBook(text, givenTitle || tx("דף חכם — ") + base, false, [{ title: givenTitle || tx("המאמר"), text }], scanExtra);
    } catch (err) {
      console.error("smart scan failed", err);
      setError(err.message || tx("פענוח הדף נכשל."));
      setFileBusy(null);
    }
    releaseWake();
  };

  /* זרימה משותפת לשער הקול: קובץ שנבחר או הקלטה חיה ← תמלול ← ליטוש (רשות) ← ספר */
  const processMedia = async (blob, fallbackBase, fromRec = false) => {
    try {
      const givenTitle = titleRef.current?.value?.trim();
      const hint = givenTitle ? "תמלול בעברית. הנושא: " + givenTitle : "";
      const text0 = await transcribeMedia(
        blob,
        (n, total, extra) =>
          setFileBusy(
            n === 0 ? extra : tx("🎬 מתמלל חלק {a}/{b}{x}... (עברית · Whisper)", { a: n, b: total, x: extra || "" })
          ),
        hint
      );
      let text = text0;
      if (window.confirm(tx("התמלול מוכן! להעביר אותו ליטוש חכם?\n(תיקון שגיאות שמיעה בלבד, בלי לשנות תוכן — מומלץ לשירים ולהקלטות רועשות)"))) {
        text = await polishTranscript(text0, (n, total) =>
          setFileBusy(tx("✨ מלטש את התמלול {a}/{b}...", { a: n, b: total }))
        );
      }
      setFileBusy(null);
      const nb = await buildBook(text, givenTitle || tx("תמלול — ") + fallbackBase);
      if (fromRec && nb?.id) {
        try {
          const r = await idbGet(recKey(REC_PENDING));
          if (r?.blob) {
            await idbSet(recKey(nb.id), r);
            await idbDel(recKey(REC_PENDING));
            setRecIds((s) => { const n = new Set(s); n.delete(REC_PENDING); n.add(nb.id); return n; });
            setRecPend(null);
          }
        } catch (e) { console.warn("rec attach", e); }
      }
    } catch (err) {
      console.error("transcribe failed", err);
      setError((err.message || tx("התמלול נכשל.")) + (fromRec ? " " + tx("ההקלטה עצמה שמורה במכשיר — אפשר לשלוח אותה או לתמלל שוב.") : ""));
      setFileBusy(null);
    }
  };

  /* 📤 שליחת קובץ ההקלטה: בטלפון — גיליון השיתוף (וואטסאפ, מייל, AirDrop); במחשב — הורדה לתיקיית ההורדות */
  const sendRec = async (id, title) => {
    setError(null);
    try {
      let file = recFileRef.current && recFileRef.current.id === id ? recFileRef.current.file : null;
      if (!file) {
        const r = await idbGet(recKey(id));
        if (!r?.blob) { setError(tx("ההקלטה לא נמצאה במכשיר הזה. היא נשמרת רק במכשיר שבו הוקלטה.")); return; }
        const mime = String(r.mime || r.blob.type || "audio/webm").split(";")[0];
        file = new File([r.blob], recFileName(title || r.title || tx("הקלטת שיעור"), mime), { type: mime });
      }
      /* המלל של הספר מצטרף להקלטה (להקלטה שעוד לא תומללה אין מלל) */
      let textFile = null;
      if (id !== REC_PENDING) {
        try {
          const b = book && book.id === id ? book : await loadBook(id);
          if (b?.chapters?.length) textFile = new File([bookAsText(b)], file.name.replace(/\.[^.]+$/, "") + ".txt", { type: "text/plain" });
        } catch {}
      }
      const mobile = IS_NATIVE || /iPhone|iPad|Android/i.test(navigator.userAgent);
      if (mobile && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          const both = textFile && navigator.canShare({ files: [file, textFile] }) ? [file, textFile] : [file];
          await navigator.share({ files: both, title: title || tx("הקלטת שיעור") });
          recFileRef.current = null; setRecReady(null);
          return;
        } catch (e) {
          if (e?.name === "AbortError") { recFileRef.current = null; setRecReady(null); return; }
          /* ספארי דורש שהשיתוף ייפתח ישירות מלחיצה: הקובץ כבר טעון — לחיצה שנייה תפתח מיד */
          if (e?.name === "NotAllowedError" && recReady !== id) { recFileRef.current = { id, file }; setRecReady(id); return; }
        }
      }
      recFileRef.current = null; setRecReady(null);
      /* במחשב: הקלטה + מלל יורדים יחד כקובץ ZIP אחד; הקלטה בלי מלל — קובץ השמע עצמו */
      let out = file;
      if (textFile) { try { out = new File([await zipStore([file, textFile])], file.name.replace(/\.[^.]+$/, "") + ".zip", { type: "application/zip" }); } catch (e) { console.warn("zip", e); } }
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url; a.download = out.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      console.error("sendRec failed", e);
      setError(tx("שליחת ההקלטה נכשלה."));
    }
  };
  const retryRec = async () => {
    if (fileBusy || recOn) return;
    setError(null);
    const r = await idbGet(recKey(REC_PENDING)).catch(() => null);
    if (!r?.blob) { setRecPend(null); return; }
    await processMedia(r.blob, tx("הקלטה חיה"), true);
  };
  const dropRec = async () => {
    if (!window.confirm(tx("למחוק את ההקלטה שלא תומללה? אי אפשר לשחזר אותה."))) return;
    try { await idbDel(recKey(REC_PENDING)); } catch {}
    setRecIds((s) => { const n = new Set(s); n.delete(REC_PENDING); return n; });
    setRecPend(null);
  };

  const onMediaPicked = async (e) => {
    const file = (e.target.files || [])[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    await processMedia(file, file.name.replace(/\.[^.]+$/, ""));
  };

  /* 🎙 הקלטה חיה: מקליטים מהמיקרופון, ובסיום — אותו צינור תמלול בדיוק */
  const startRec = async () => {
    if (recOn || fileBusy) return;
    if (recPend && !window.confirm(tx("יש הקלטה קודמת שעוד לא תומללה. הקלטה חדשה תחליף אותה. להמשיך?"))) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const t0 = Date.now();
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recRef.current?.iv) clearInterval(recRef.current.iv);
        recRef.current = null;
        setRecOn(false);
        const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        if (blob.size < 4000) { setError(tx("ההקלטה קצרה מדי — נסה שוב.")); return; }
        /* קודם כול שומרים את ההקלטה במכשיר — רק אחר כך מתמללים */
        let kept = false;
        try {
          const sec = Math.round((Date.now() - t0) / 1000);
          await idbSet(recKey(REC_PENDING), { blob, mime: blob.type, sec, at: Date.now() });
          setRecIds((s) => new Set(s).add(REC_PENDING));
          setRecPend({ sec, bytes: blob.size, at: Date.now() });
          kept = true;
        } catch (e) { console.warn("rec keep", e); }
        await processMedia(blob, tx("הקלטה חיה"), kept);
      };
      recRef.current = { mr, iv: setInterval(() => setRecSec((s) => s + 1), 1000) };
      setRecSec(0);
      setRecOn(true);
      setError(null);
      mr.start(1000);
    } catch {
      setError(tx("אין גישה למיקרופון. אשר לאתר הרשאת מיקרופון בדפדפן ונסה שוב."));
    }
  };
  const stopRec = () => { try { recRef.current?.mr?.stop(); } catch {} };

  const openBook = async (id) => {
    let b = await loadBook(id);
    /* ספר הפתיחה תמיד זמין: אם האחסון במכשיר לא החזיר אותו — נבנה מחדש מהאפליקציה עצמה */
    if (!b && starterBook(id)) { b = starterBook(id); saveBookToStorage(b); }
    if (!b) { setError(tx("הספר לא נמצא באחסון.")); return; }
    setBook(b);
    setChannel(null);
    setError(null);
    flick();
    setView("guide");
  };
 
  /* 🎧 שיקוף — נפתח מהספרייה או מלוח השידורים של הספר */
  const openMirror = async (id) => {
    const b = id && (!book || book.id !== id) ? await loadBook(id) : book;
    if (!b) { setError(tx("הספר לא נמצא באחסון.")); return; }
    setBook(b);
    setChannel(null);
    setError(null);
    flick();
    setView("mirror");
  };
  const saveMirrors = (mirrors) => persist({ ...book, flex: { ...(book.flex || {}), mirrors } }, { k: "meta" });

  const removeBook = async (id) => {
    const nextIdx = index.filter((b) => b.id !== id);
    setIndex(nextIdx);
    setDeleteArm(null);
    await deleteBookFromStorage(id);
    try { await idbDel(recKey(id)); } catch {}
    setRecIds((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
    await saveIndex(nextIdx);
    if (starterBook(id)) { try { localStorage.setItem("lomedtv-starter-" + id, "removed"); } catch {} } // ספר פתיחה שנמחק — לא חוזר
    clearSyncStamp(id);
    /* מחיקה אמיתית: כשמחוברים לענן, הספר נמחק גם שם — אחרת הוא יוצע להורדה מיד. */
    const uid = cloudRef.current?.id;
    if (uid) {
      try {
        await supa.from("notes").delete().eq("user_id", uid).eq("book_id", id);
        await supa.from("outputs").delete().eq("user_id", uid).eq("book_id", id);
        await supa.from("books").delete().eq("user_id", uid).eq("id", id);
      } catch (e) {
        console.error("cloud delete failed", e);
      }
    }
    if (!nextIdx.length) setView("intake");
  };
 
  const openChapter = (i) => {
    setChIdx(i);
    setChannel("read");
    setError(null);
    clearSelection();
    window.speechSynthesis?.cancel();
    flick();
    setView("tv");
  };
 
  /* ── מצב מגילה (גמיש) ── */
  const runSearch = () => {
    const words = searchQ.trim().split(/\s+/).map(hebClean).filter((w) => w.length >= 2);
    if (!words.length) return;
    const hits = [];
    sentences.forEach((s, i) => {
      if (sentenceMatches(s, words)) hits.push(i);
    });
    setSearchHits(hits.slice(0, 300));
    setCheckedHits([]);
  };

  const toggleHit = (i) =>
    setCheckedHits((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i].sort((a, b) => a - b)));

  const useHitsAsSelection = () => {
    const idxs = (checkedHits.length ? checkedHits : searchHits) || [];
    if (!idxs.length) return;
    setDragText(idxs.map((i) => sentences[i]).join("\n"));
    setSelStart(null);
    setSelEnd(null);
    setSearchHits(null);
    setCheckedHits([]);
  };

  /* ── סימון ברמת מילה ──
     המרקרים נשמרים כרגיל פר-משפט (book.marks[i]), ובנוסף אפשר טווחי-מילים:
     marks[i].w = [{s,e,b?,u?,hl?}] — אינדקסי תווים בתוך המשפט, מיושרים לגבולות מילים.
     offsetInSpan / snapWord / applyWordPatch / renderMarked — ברמת המודול (משותפים ל-AiLayer). */
  /* מציג משפט עם סגנון פר-משפט + טווחי מילים + הבהוב הסימון הממתין */
  const captureWordSel = (sel, span, i) => {
    const txt = sentences[i] || "";
    let so = offsetInSpan(span, sel.anchorNode, sel.anchorOffset);
    let eo = offsetInSpan(span, sel.focusNode, sel.focusOffset);
    if (so === null || eo === null || so === eo) return false;
    const voc = vocOf(i); // המסך מציג את הנוסח המנוקד: ממירים למיקום במשפט השמור
    if (voc) { so = nikudOff(voc, txt, so); eo = nikudOff(voc, txt, eo); if (so === eo) return false; }
    const [ws, we] = snapWord(txt, Math.min(so, eo), Math.max(so, eo));
    if (we <= ws) return false;
    if (we - ws >= txt.trim().length) {
      setSelStart(i); setSelEnd(i); setWordSel(null);
    } else {
      setWordSel({ i, s: ws, e: we }); setSelStart(null); setSelEnd(null);
    }
    setDragText("");
    sel.removeAllRanges();
    dragJustRef.current = true;
    return true;
  };
  const renderSentText = (plain, mk, pend, voc, kara, gloss) => {
    const txt = voc || plain;
    const cv = voc ? (r) => ({ ...r, s: nikudOff(plain, voc, r.s), e: nikudOff(plain, voc, r.e) }) : (r) => r;
    const w = ((mk && Array.isArray(mk.w)) ? mk.w : []).map(cv);
    const kc = kara == null ? null : voc ? nikudOff(plain, voc, kara) : kara;
    return renderMarked(txt, mk ? { ...mk, w } : mk, pend ? cv(pend) : pend, kc, gloss || null);
  };

  /* בקשה ג': סימון קטע בתצוגת הפרק (ערוץ 00) —
     לחיצה ראשונה בוחרת את משפט ההתחלה, שנייה את הסוף (סדר הפוך מתוקן אוטומטית),
     ולחיצה שלישית מתחילה סימון חדש. אותם מרקרים והערות של המגילה — אותו אחסון. */
  const onReadSentClick = (i) => {
    if (dragJustRef.current) { dragJustRef.current = false; return; }
    if (Date.now() - hitGuardRef.current < 900) return;
    if (wordSel) setWordSel(null);
    if (selStart === null || selEnd !== null) {
      setSelStart(i);
      setSelEnd(null);
      setDragText("");
    } else {
      setSelEnd(i);
    }
  };
  const applyMark = async (patch) => {
    if (!rangeIdx && !wordSel) return;
    const marks = { ...(book.marks || {}) };
    if (wordSel) {
      /* סימון ברמת מילה — נוגע רק בטווח שנגרר */
      const cur = { ...(marks[wordSel.i] || {}) };
      const w = applyWordPatch(Array.isArray(cur.w) ? cur.w : [], wordSel.s, wordSel.e, patch);
      if (w.length) cur.w = w; else delete cur.w;
      if (patch === null && !w.length) { delete cur.b; delete cur.u; delete cur.hl; }
      if (Object.keys(cur).length) marks[wordSel.i] = cur; else delete marks[wordSel.i];
      await persist({ ...book, marks });
      setWordSel(null);
      setDragText("");
      return;
    }
    for (let i = rangeIdx[0]; i <= rangeIdx[1]; i++) {
      if (patch === null) delete marks[i];
      else {
        const kept = marks[i] && marks[i].w ? { w: marks[i].w } : {};
        marks[i] = { ...(marks[i] || {}), ...kept, ...patch };
      }
    }
    await persist({ ...book, marks });
    setSelStart(null);
    setSelEnd(null);
    setDragText("");
  };

  /* הערות שוליים חיות: הערה אישית על משפט, נשמרת עם הספר */
  const noteVal = (n) => (typeof n === "string" ? n : n?.t || "");
  const [noteEd, setNoteEd] = useState(null); // {i, initial, clear} — עורך ההערה הפתוח
  const saveNote = async (i, txt, clear) => {
    const notes = { ...(book.notes || {}) };
    if (txt.trim()) notes[i] = { t: txt.trim(), src: (sentences[i] || "").slice(0, 160) };
    else delete notes[i];
    setNoteEd(null);
    await persist({ ...book, notes }, { k: "note", i });
    if (clear) { setSelStart(null); setSelEnd(null); setDragText(""); setWordSel(null); }
  };
  const addNote = () => {
    if (!rangeIdx && !wordSel) return;
    const i = wordSel ? wordSel.i : rangeIdx[0];
    setNoteEd({ i, initial: noteVal(book.notes?.[i]), clear: true });
  };
  const editNote = (i) => setNoteEd({ i, initial: noteVal(book.notes?.[i]), clear: false });
  const noteEditor = noteEd && (
    <NoteEditor
      key={noteEd.i}
      initial={noteEd.initial}
      src={(sentences[noteEd.i] || "").slice(0, 90)}
      transcribe={(blob) => transcribeMedia(blob, null, "הערה קצרה של לומד")}
      onSave={(t) => saveNote(noteEd.i, t, noteEd.clear)}
      onCancel={() => setNoteEd(null)}
    />
  );
  const [flashIdx, setFlashIdx] = useState(null);
  const jumpToSentence = (i) => {
    document.getElementById("para-" + i)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashIdx(i);
    setTimeout(() => setFlashIdx(null), 1600);
  };
  /* מספור הערות לפי סדר הופעתן בטקסט — כמו הערות שוליים בספר */
  const noteOrder = useMemo(
    () => Object.keys(book?.notes || {}).map(Number).sort((a, b) => a - b),
    [book?.notes]
  );
  const noteNum = (i) => noteOrder.indexOf(Number(i)) + 1;
  const [notesOpen, setNotesOpen] = useState(false);
  const [trace, setTrace] = useState(null); // { term, hits:[...] } — הדגשת מקור ירוקה

  /* מושג/כלל ← המקור בטקסט: מוצא משפטים תואמים, עובר למגילה ומסמן בירוק */
  const traceToSource = (phrase) => {
    const words = String(phrase).trim().split(/\s+/).map(hebClean).filter((w) => w.length >= 2).slice(0, 4);
    if (!words.length) return;
    let hits = [];
    sentences.forEach((s, i) => { if (sentenceMatches(s, words)) hits.push(i); });
    // אם צירוף מלא לא נמצא — ננסה עם שתי המילים הראשונות, ואז עם הראשונה
    if (!hits.length && words.length > 2) {
      sentences.forEach((s, i) => { if (sentenceMatches(s, words.slice(0, 2))) hits.push(i); });
    }
    if (!hits.length && words.length > 1) {
      sentences.forEach((s, i) => { if (sentenceMatches(s, [words[0]])) hits.push(i); });
    }
    if (!hits.length) { window.alert(tx("לא נמצא מקור מתאים בטקסט 🔍")); return; }
    hits = hits.slice(0, 60);
    setFlexResult(null);
    setNotesOpen(false);
    setSearchHits(null);
    setTrace({ term: phrase, hits });
    if (view !== "scroll") openScroll();
    setTimeout(() => {
      document.getElementById("para-" + hits[0])?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  };

  const closeSearch = () => {
    setSearchHits(null);
    setCheckedHits([]);
    setSearchQ("");
  };

  const openScroll = () => {
    setTrace(null);
    closeSearch();
    setQuizPick(null);
    setFlexResult(null);
    setFlexError(null);
    setMarkMode(null);
    setSelStart(null);
    setSelEnd(null);
    setDragText("");
    flick();
    setView("scroll");
  };
 
  // שחזור מיקום: גלילה אל הסימנייה כשנכנסים למגילה
  useEffect(() => {
    if (view !== "scroll" || !book?.flex?.upTo) return;
    const t = setTimeout(() => {
      document.getElementById("para-" + book.flex.upTo)?.scrollIntoView({ block: "center" });
    }, 120);
    return () => clearTimeout(t);
  }, [view]);
 
  const onSentenceClick = async (i) => {
    if (!markMode) return;
    if (markMode === "start") {
      setSelStart(i);
      setSelEnd(null);
      setDragText("");
      setMarkMode("end"); // זרימה טבעית: מיד בוחרים את הסוף
      return;
    } else if (markMode === "end") {
      setSelEnd(i);
      setDragText("");
    } else if (markMode === "bookmark") {
      await persist({ ...book, flex: { ...(book.flex || {}), upTo: i } });
    }
    setMarkMode(null);
  };
 
  const onScrollMouseUp = () => {
    if (markMode) return; // במצב סימון נקודות — לא גרירה
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed) return;
    // ממפה את הגרירה למשפטים שלמים — כך גם המרקרים עובדים על גרירה
    const idxOf = (node) => {
      let el = node && (node.nodeType === 3 ? node.parentElement : node);
      while (el && !(el.id && el.id.startsWith("para-"))) el = el.parentElement;
      const n = el ? parseInt(el.id.slice(5), 10) : NaN;
      return Number.isFinite(n) ? n : null;
    };
    const a = idxOf(sel.anchorNode);
    const b = idxOf(sel.focusNode);
    if (a !== null && b !== null && a === b) {
      /* גרירה בתוך משפט אחד — סימון ברמת מילה */
      if (captureWordSel(sel, document.getElementById("para-" + a), a)) return;
    }
    if (a !== null && b !== null) {
      setWordSel(null);
      setSelStart(Math.min(a, b));
      setSelEnd(Math.max(a, b));
      setDragText("");
      sel.removeAllRanges();
      return;
    }
    const s = sel.toString().trim();
    if (s.length >= 25) {
      setDragText(s);
      setSelStart(null);
      setSelEnd(null);
    }
  };
 
  const onReadMouseUp = () => {
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed) return;
    const idxOf = (node) => {
      let el = node && (node.nodeType === 3 ? node.parentElement : node);
      el = el && el.closest ? el.closest("[data-si]") : null;
      const n = el ? parseInt(el.getAttribute("data-si"), 10) : NaN;
      return Number.isFinite(n) ? { i: n, el } : null;
    };
    const a = idxOf(sel.anchorNode);
    const b = idxOf(sel.focusNode);
    if (a && b && a.i === b.i) {
      if (captureWordSel(sel, a.el, a.i)) return;
    }
    if (a && b) {
      setWordSel(null);
      setSelStart(Math.min(a.i, b.i));
      setSelEnd(Math.max(a.i, b.i));
      setDragText("");
      sel.removeAllRanges();
      dragJustRef.current = true;
    }
  };
  const clearSelection = () => {
    setSelStart(null);
    setSelEnd(null);
    setDragText("");
    setWordSel(null);
    setTransRes(null);
    setFlexError(null);
    window.getSelection?.()?.removeAllRanges?.();
  };

  /* ── "גע ותרגם" — תרגום ארמית↔עברית לפי הקשר + מילון אישי נצבר (flex.dict) ── */
  const translateSel = async () => {
    const phrase = (wordSel
      ? (sentences[wordSel.i] || "").slice(wordSel.s, wordSel.e)
      : rangeIdx
      ? sentences.slice(rangeIdx[0], rangeIdx[1] + 1).join(" ")
      : dragText || ""
    ).trim().replace(/\s+/g, " ");
    if (!phrase || transLoading) return;
    const dict = book.flex?.dict || {};
    if (dict[phrase]) {
      setTransRes({ q: phrase, ...dict[phrase], cached: true });
      return;
    }
    const ctx = wordSel ? (sentences[wordSel.i] || "") : phrase;
    setTransLoading(true);
    setTransRes(null);
    try {
      const data = await askClaude(
        `תרגם לעברית פשוטה את הביטוי הארמי המסומן מתוך ספר קבלה, לפי הקשרו במשפט. אם הביטוי כבר בעברית — באר אותו במשפט קצר.\nהביטוי: "${phrase.slice(0, 200)}"\nהמשפט המלא: "${ctx.slice(0, 400)}"\nהחזר JSON בלבד: {"t":"התרגום המילולי, קצר","n":"הערה קצרה רק אם באמת נחוצה, אחרת מחרוזת ריקה"}`,
        500,
        true
      );
      const entry = { t: String(data.t || "").trim(), n: String(data.n || "").trim() };
      if (!entry.t) throw new Error(tx("לא התקבל תרגום"));
      setTransRes({ q: phrase, ...entry });
      /* נשמר במילון האישי של הספר — פעם הבאה: מיידי, בלי AI */
      await persist({ ...book, flex: { ...(book.flex || {}), dict: { ...dict, [phrase]: entry } } });
    } catch (e) {
      setTransRes({ q: phrase, err: e.message });
    }
    setTransLoading(false);
  };
  const transBubble = (transLoading || transRes) && (
    <div className="trans-bubble" dir={langDir()}>
      {transLoading ? (
        <span>{tx("⏳ מתרגם…")}</span>
      ) : transRes.err ? (
        <span>⚠ {transRes.err}</span>
      ) : (
        <span>
          <b>{transRes.q}</b> = {transRes.t}
          {transRes.n ? <span className="trans-note"> · {transRes.n}</span> : null}
          {transRes.cached ? <span className="trans-note"> 📖</span> : null}
        </span>
      )}
      {!transLoading && (
        <button className="trans-x" onClick={() => setTransRes(null)}>✕</button>
      )}
    </div>
  );
 
  // הטקסט הנבחר בפועל: גרירה קודמת לנקודות
  /* סימון קטע — התחלה/סוף/תצוגה מקדימה: אחרי לחיצת ההתחלה, ריחוף מעל משפט מאוחר מראה את הקטע שייבחר */
  const [hoverIdx, setHoverIdx] = useState(null);
  const selCls = (i, inRange) => {
    const waiting = selStart !== null && selEnd === null;
    let c = "";
    if (inRange) { c += "in-range "; if (i === rangeIdx[0]) c += "sel-a "; if (i === rangeIdx[1]) c += "sel-z "; }
    if (waiting) {
      if (i === selStart) c += "in-range sel-a sel-wait ";
      else if (hoverIdx !== null && i > Math.min(selStart, hoverIdx) - 1 && i <= Math.max(selStart, hoverIdx) && i !== selStart) c += "sel-pre " + (i === hoverIdx ? "sel-z " : "");
    }
    return c;
  };
  const rangeIdx =
    selStart !== null && selEnd !== null
      ? [Math.min(selStart, selEnd), Math.max(selStart, selEnd)]
      : null;
  const selectedText =
    dragText ||
    (wordSel ? (sentences[wordSel.i] || "").slice(wordSel.s, wordSel.e) : "") ||
    (rangeIdx ? sentences.slice(rangeIdx[0], rangeIdx[1] + 1).join(" ") : "");
 
  const generateFlex = async (id, qCount) => {
    if (!selectedText || flexLoading) return;
    if (id === "quiz" && !qCount) {
      setQuizPick("flex"); // קודם בוחרים כמה שאלות
      return;
    }
    let t = selectedText;
    if (t.length > 9000) {
      const cut = t.lastIndexOf(".", 9000);
      t = t.slice(0, cut > 4500 ? cut + 1 : 9000);
    }
    const action = FLEX_ACTIONS.find((a) => a.id === id);
    setFlexLoading(action ? tx(action.label) : id);
    setFlexError(null);
    setFlexResult(null);
    try {
      const FAST_IDS = ["cards", "concepts", "flow"];
      const data = id === "quiz" ? await buildQuiz(t, qCount, openQ) : await askClaude(PROMPTS[id](t, openQ), 2000, FAST_IDS.includes(id));
      setFlexResult({ channel: id, data });
    } catch (e) {
      setFlexError(e.message || tx("ההפקה נכשלה. נסה שוב."));
    } finally {
      setFlexLoading(null);
    }
  };
 
  /* 🌐 תרגום הפרק לשפת יעד — נשמר במפתח "פרק:trans:שפה" */
  const generateTrans = async (ci, lang) => {
    const text = book.chapters[ci].text;
    const to = lang || transLang || defaultTransLang(text);
    if (book.results[key(ci, "trans:" + to)]) return;
    setLoading(true);
    setError(null);
    try {
      const t = await translateSentences(chapterSentences(text).sentences, to);
      await persist({ ...book, results: { ...book.results, [key(ci, "trans:" + to)]: { lang: to, t } } }, { k: "output", ci, ch: "trans:" + to });
    } catch (e) {
      setError(e.message || tx("התרגום נכשל. נסה שוב."));
    } finally {
      setLoading(false);
    }
  };
  const generate = async (id, ci, qCount) => {
    if (id === "tts" || id === "read") return;
    if (id === "trans") return generateTrans(ci);
    if (book.results[key(ci, id)]) return;
    if (id === "quiz" && !qCount) {
      setQuizPick("tv"); // קודם בוחרים כמה שאלות
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const FAST_IDS = ["cards", "concepts", "flow"];
      const data =
        id === "quiz"
          ? await buildQuiz(book.chapters[ci].text, qCount, openQ)
          : await askClaude(PROMPTS[id](book.chapters[ci].text, openQ), 2000, FAST_IDS.includes(id));
      await persist({ ...book, results: { ...book.results, [key(ci, id)]: data } }, { k: "output", ci, ch: id });
    } catch (e) {
      setError(e.message || tx("השידור נכשל. נסה שוב."));
    } finally {
      setLoading(false);
    }
  };
 
  const tune = (id) => {
    if (loading) return;
    flick();
    setQuizPick(null);
    if (id === "tts") { setChannel("read"); setReaderOn(true); setError(null); return; } // 07: הנגן מעל הדף, הדף נשאר
    if (id !== "read") { setReaderOn(false); setReadPos(null); }
    setChannel(id);
    setError(null);
    window.speechSynthesis?.cancel();
    generate(id, chIdx);
  };
 
  const gotoChapter = (i) => {
    if (loading || i === chIdx) return;
    flick();
    setQuizPick(null);
    clearSelection();
    setChIdx(i);
    setError(null);
    window.speechSynthesis?.cancel();
    if (channel) generate(channel, i);
  };
 
  const markDone = async (ci, score, total) => {
    const prev = book.progress?.[ci] || {};
    const entry = { ...prev, done: true };
    if (score !== undefined) { entry.score = score; entry.total = total; }
    await persist({ ...book, progress: { ...book.progress, [ci]: entry } });
  };
 
  const backToGuide = () => {
    window.speechSynthesis?.cancel();
    setQuizPick(null);
    setChannel(null);
    flick();
    setView("guide");
  };
  const backToLibrary = () => {
    window.speechSynthesis?.cancel();
    setQuizPick(null);
    setBook(null);
    setChannel(null);
    flick();
    setView("library");
  };
 
  const active = CHANNELS.find((c) => c.id === channel);
  const cur = book?.chapters?.[chIdx];
  /* ── 🔍 אימות מול מקור ── */
  const [vfP, setVfP] = useState(-1);          // הפרשה שנבחרה לאימות (-1 = לפי מה שנשמר / ברירת המחדל)
  const [vfBusy, setVfBusy] = useState("");
  const [vfEdit, setVfEdit] = useState(null);  // { id, val } — תיקון ביד
  const vfData = book?.flex?.verify?.[chIdx] || null; // { en, he, at, refs: { n: טקסט }, skip: { id: 1 } }
  const vfParas = useMemo(() => (view === "tv" && channel === "read" ? zvParas(cur?.text) : []), [view, channel, cur?.text]);
  const vfState = useMemo(() => (vfData && vfParas.length ? zvCompute(cur?.text, vfData.refs, vfData.skip) : null), [vfData, cur?.text, vfParas.length]);
  /* צביעה בטקסט: לכל הבדל פתוח — טווח התווים במשפט שבו הוא נמצא */
  useMemo(() => {
    ZV_BAD.clear();
    if (!vfState || (vfState.total > 0 && vfState.ok / vfState.total < 0.5)) return;
    const plain = String(cur?.text || "").split(/\n{2,}/);
    for (const it of vfState.items) {
      if (!it.diffs?.length) continue;
      const para = (plain[it.pi] || "").trim();
      const sents = chapterSentences(para).sentences;
      /* מיקום כל מילה של האות בתוך הפסקה */
      const head = para.match(/^[א-ת]{1,4}['׳]?\)\s*/)?.[0].length || 0;
      const wpos = [];
      const re = /\S+/g; let m;
      while ((m = re.exec(para))) if (m.index >= head && zvStrip(m[0])) wpos.push([m.index, m.index + m[0].length]);
      let from = 0;
      const spos = sents.map((t) => { const at = para.indexOf(t, from); from = at >= 0 ? at + t.length : from; return at; });
      for (const d of it.diffs) {
        const a0 = d.a1 > d.a0 ? d.a0 : Math.max(0, d.a0 - 1), a1 = d.a1 > d.a0 ? d.a1 : Math.min(wpos.length, d.a0 + 1);
        for (let k = a0; k < a1; k++) {
          const w = wpos[k]; if (!w) continue;
          const si = spos.findIndex((at, q) => at >= 0 && w[0] >= at && w[1] <= at + sents[q].length);
          if (si < 0) continue;
          const arr = ZV_BAD.get(sents[si]) || [];
          arr.push([w[0] - spos[si], w[1] - spos[si]]);
          ZV_BAD.set(sents[si], arr);
        }
      }
    }
  }, [vfState, cur?.text]);
  const vfSave = async (patch, newText) => {
    const b = bookRef.current; if (!b) return;
    const flex = { ...(b.flex || {}), verify: { ...(b.flex?.verify || {}), [chIdx]: { ...(b.flex?.verify?.[chIdx] || {}), ...patch } } };
    if (newText == null) { await persist({ ...b, flex }); return; }
    /* עריכת הנוסח: חלוקת המשפטים חייבת להישאר — אחרת הסימונים וההערות של הלומד יזוזו */
    const oldS = chapterSentences(b.chapters[chIdx].text).sentences, newS = chapterSentences(newText).sentences;
    if (oldS.length !== newS.length) { setError(tx("התיקון הזה משנה את חלוקת המשפטים — לא בוצע, כדי לא להזיז סימונים והערות.")); return; }
    const marks = { ...(b.marks || {}) };
    const base = bookSentences(b).chapterRanges[chIdx]?.[0] || 0;
    const k = oldS.findIndex((t, q) => t !== newS[q]);
    if (k >= 0 && marks[base + k]?.w?.length) {
      const o = oldS[k], n2 = newS[k]; let p0 = 0; while (p0 < o.length && p0 < n2.length && o[p0] === n2[p0]) p0++;
      const delta = n2.length - o.length;
      marks[base + k] = { ...marks[base + k], w: marks[base + k].w.map((r) => (r.s >= p0 ? { ...r, s: Math.max(0, r.s + delta), e: Math.max(0, r.e + delta) } : r.e > p0 ? { ...r, e: Math.max(r.s, r.e + delta) } : r)) };
    }
    const chapters = b.chapters.map((c, q) => (q === chIdx ? { ...c, text: newText } : c));
    await persist({ ...b, chapters, marks, flex: { ...flex, textRev: (b.flex?.textRev || 0) + 1 } }, { k: "full" });
  };
  const vfSel = vfP >= 0 ? vfP : ZOHAR_PARSHIOT.findIndex(([en]) => en === vfData?.en); // -1 = עוד לא נבחרה פרשה
  const vfRatio = vfState && vfState.total ? vfState.ok / vfState.total : 0;
  const vfLow = !!vfState && vfState.total > 0 && vfRatio < 0.5; // התאמה נמוכה = כנראה לא המקור הנכון; לא מציעים תיקונים
  /* זיהוי המקור לבד: האות הראשונה שבדף מושווית מול אותה אות בכל פרשה (שש בקשות במקביל), ונבחרת ההתאמה הטובה ביותר */
  const vfAuto = async () => {
    const b = bookRef.current; if (!b || !vfParas.length) return;
    const first = vfParas[0], A = zvWords(first.text);
    setError(null);
    let next = 0, done = 0, best = { r: 0, i: -1 };
    const worker = async () => {
      while (next < ZOHAR_PARSHIOT.length) {
        const i = next++;
        try {
          const refs = await fetchZoharSource(ZOHAR_PARSHIOT[i][0], [first.n]);
          if (refs[first.n]) { const B = zvWords(refs[first.n]); const d = zvDiff(A, B); const r = d.ok / Math.max(A.length, B.length, 1); if (r > best.r) best = { r, i }; }
        } catch {}
        setVfBusy(tx("🔎 מחפש את המקור בספריא… {a}/{b}", { a: ++done, b: ZOHAR_PARSHIOT.length }));
      }
    };
    setVfBusy(tx("🔎 מחפש את המקור בספריא…"));
    await Promise.all(Array.from({ length: 6 }, worker));
    setVfBusy("");
    if (best.i < 0 || best.r < 0.6) { setError(tx("לא נמצא בספריא מקור שמתאים לדף הזה. אפשר לבחור פרשה ביד.")); return; }
    setVfP(best.i);
    await vfRun(best.i);
  };
  const vfRun = async (forceIdx) => {
    const b = bookRef.current; if (!b || !vfParas.length) return;
    const pIdx = typeof forceIdx === "number" ? forceIdx : vfSel;
    if (pIdx < 0) { await vfAuto(); return; }
    const [en, he] = ZOHAR_PARSHIOT[pIdx] || ZOHAR_PARSHIOT[0];
    setError(null); setVfBusy(tx("🔍 מושך את לשון הזוהר מספריא…"));
    try {
      const refs = await fetchZoharSource(en, [...new Set(vfParas.map((x) => x.n))]);
      if (!Object.keys(refs).length) throw new Error(tx("לא נמצא נוסח לאותיות האלה בפרשה שנבחרה."));
      await vfSave({ en, he, at: Date.now(), refs, skip: {} });
    } catch (e) { setError(tx("האימות נכשל: ") + (e?.message || e)); }
    setVfBusy("");
  };
  const vfFix = async (it, d, repl) => { setVfEdit(null); await vfSave({}, zvApply(bookRef.current.chapters[chIdx].text, it.pi, d.a0, d.a1, repl)); };
  const vfKeep = async (d) => { setVfEdit(null); await vfSave({ skip: { ...(vfData?.skip || {}), [d.id]: 1 } }); };
  const transTo = channel === "trans" && cur ? (transLang || defaultTransLang(cur.text)) : null;
  const data = channel && book ? book.results[key(chIdx, channel === "trans" ? "trans:" + transTo : channel)] : null;
  const multi = book?.chapters?.length > 1;
  const prevSummary = book && chIdx > 0 ? book.results[key(chIdx - 1, "summary")] : null;
  const nextUnfinished = book
    ? book.chapters.findIndex((_, i) => !book.progress?.[i]?.done)
    : -1;
 
  const barTitle =
    view === "tv" && active ? tx(active.label)
    : view === "tv" ? tx("בחר ערוץ")
    : view === "scroll" ? tx("מגילה · לימוד גמיש")
    : view === "guide" ? tx("לוח שידורים")
    : view === "library" ? tx("ספריית השידורים")
    : view === "mirror" ? tx("שיקוף · אור חוזר")
    : view === "shelf" ? tx("ארון הספרים · ייבוא ללימוד")
    : tx("קליטת טקסט");
  const focusOn = focus && (view === "tv" || view === "scroll") && !!book && !helpOn;
  const barNum = view === "tv" && active ? `CH ${active.num}` : view === "scroll" ? "CH ∞" : view === "mirror" ? "CH 08" : "CH 00";
 
  return (
    <div className={"studio" + (focusOn ? " focus" : "")} dir={langDir()} lang={getLang()}>
      {focusOn && (
        <div className="focus-tools">
          <button className="focus-btn" onClick={() => setFocus(false)} title={tx("חזרה למסך הרגיל")} aria-label={tx("חזרה למסך הרגיל")}>⤡</button>
          <button className="focus-btn" onClick={() => bumpFont(-0.1)} title={tx("הקטנת טקסט")} aria-label={tx("הקטנת טקסט")}>{tx("אַ−")}</button>
          <button className="focus-btn" onClick={() => bumpFont(0.1)} title={tx("הגדלת טקסט")} aria-label={tx("הגדלת טקסט")}>{tx("אַ+")}</button>
        </div>
      )}
      <style>{css}</style>

      {/* ── הפנים: מסך הפתיחה ── */}
      {showOpening && (
        <div className="opening" dir={langDir()} lang={getLang()}>
          <select className="lang-pick op-lang" value={getLang()} onChange={(e) => changeLang(e.target.value)} aria-label="Language · שפה" title="Language · שפה">{LANGS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          <div className="op-brand">
            <div className="op-lamed" aria-label={tx("למ״ד על השורה")}>
              <div className="row">{tx("ב ר א ש י ת")}</div>
              <div className="base" />
              <div className="l">{tx("ל")}</div>
            </div>
            <div className="op-name">{tx("מסך הלמידה")}<small>{tx("חברותא שלא הולכת הביתה")}</small></div>
          </div>

          <header className="op-hero">
            <h1>{tx("מתי בפעם האחרונה")}<br />{tx("ספר ענה לך בחזרה?")}</h1>
            <p>{tx("יש לך ספרים שאתה חוזר אליהם שנים. הידע שלך גדל — והספר לא יודע מזה כלום. עד היום.")}</p>
          </header>

          <div className="op-vessel">
            <label htmlFor="op-q">{tx("מה השאלה שאתה נושא איתך אל הספר?")}</label>
            <div className="field">
              <input
                id="op-q"
                ref={openQRef}
                type="text"
                defaultValue={openQ}
                placeholder={tx("למשל: מה חובתי בעולמי?")}
                onKeyDown={(e) => { if (e.key === "Enter") enterFromOpening(true, null); }}
              />
              <button className="go" onClick={() => enterFromOpening(true, null)}>{tx("היכנס עם השאלה")}</button>
            </div>
            <span className="skip">
              {tx("אפשר גם")} <a href="#" onClick={(e) => { e.preventDefault(); enterFromOpening(false, null); }}>{tx("להיכנס בלי שאלה")}</a> {tx("— היא תגיע מתוך הלימוד")}
            </span>
          </div>

          {getLang() === "he" && <div className="op-peek">
            <div className="daf">
              <div className="sefer">{tx("מסילת ישרים · פרק א — בביאור כלל חובת האדם בעולמו")}</div>
              <p className="torah">
                יְסוֹד הַחֲסִידוּת וְשֹׁרֶשׁ הָעֲבוֹדָה הַתְּמִימָה הוּא{" "}
                <span className="hl">{tx("שֶׁיִּתְבָּרֵר וְיִתְאַמֵּת אֵצֶל הָאָדָם מַה חוֹבָתוֹ בְּעוֹלָמוֹ")}</span><span className="fn">[1]</span>,
                וּלְמָה צָרִיךְ שֶׁיָּשִׂים מַבָּטוֹ וּמְגַמָּתוֹ בְּכָל אֲשֶׁר הוּא{" "}
                <span className="un">{tx("עָמֵל כָּל יְמֵי חַיָּיו")}</span>.
              </p>
              <div className="note"><b>{tx("[1] ההערה שלך:")}</b> {tx("❓ מה בין \"חובתו\" ל\"מגמתו\" — שני דברים או אחד?")}</div>
              <svg className="thread" viewBox="0 0 640 290" preserveAspectRatio="none" aria-hidden="true">
                <path d="M 402 118 C 380 175, 300 150, 230 205" />
              </svg>
            </div>
            <p className="cap">{tx("הדף שלך, כמו שהוא באמת בפנים: מרקר, קו, והערה שקשורה בחוט אל השורה שלה.")}</p>
          </div>}

          <section className="op-gates">
            <h2>{tx("חמישה שערים אל הספר")}</h2>
            <p className="sub">{tx("מכל מקום שבו המציאות פוגשת אותך — היא נכנסת אל הדף")}</p>
            <div className="gate-row">
              <button className="g" onClick={() => enterFromOpening(true, "text")}><span className="ic">＋</span><span className="t">{tx("הדבק טקסט")}</span></button>
              <button className="g" onClick={() => enterFromOpening(true, "photo")}><span className="ic">📷</span><span className="t">{tx("צלם דף")}</span></button>
              <button className="g" onClick={() => enterFromOpening(true, "rec")}><span className="ic">🎙</span><span className="t">{tx("הקלט שיעור")}</span></button>
              <button className="g" onClick={() => enterFromOpening(true, "video")}><span className="ic">🎥</span><span className="t">{tx("צלם וידאו")}</span></button>
              <button className="g" onClick={() => enterFromOpening(true, "file")}><span className="ic">🎬</span><span className="t">{tx("קובץ שמע/וידאו")}</span></button>
            </div>
          </section>

          <footer className="op-foot">
            <p className="serif">{tx("יש כאן מי שמחכה ללמוד איתך.")}</p>
            <p>{tx("בְּפִיךָ וּבִלְבָבְךָ · הלימוד קרוב")}</p>
            {index.length > 0 && (
              <button className="op-lib" onClick={() => enterFromOpening(false, null)}>{tx("↩ לספרייה שלי ({n})", { n: index.filter((b) => b.pin !== false).length || index.length })}</button>
            )}
          </footer>
        </div>
      )}

      {powerOn && (
        <div className="power-on" aria-hidden="true">
          <span className="mast-dot" />
          <h1>{tx("מסך הלמידה")}</h1>
          <span className="mast-sub">{tx("כל טקסט הופך לשבעה ערוצי לימוד")}</span>
        </div>
      )}
 
      <div className="tv">
        <div className="bezel">
          <div className={"screen " + (staticFx ? "static-on" : "")}>
            <div className="screen-bar">
              <span className="ch-num">{barNum}</span>
              <span className="ch-name">
                {barTitle}
                {(view === "tv" || view === "scroll") && book ? ` · ${book.title}` : ""}
              </span>
              <span id="reader-slot" className="reader-slot" />
              <span className="font-btns">
                <button className="font-btn search-btn" onClick={() => openFind("")} title={tx("חיפוש: בספרים, בהערות ובכלים")} aria-label={tx("חיפוש")}>🔍</button>
                <select className="font-btn lang-pick" value={getLang()} onChange={(e) => changeLang(e.target.value)} aria-label="Language · שפה" title="Language · שפה">{LANGS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
                {(view === "tv" || view === "scroll") && book && <button className="font-btn focus-in" onClick={() => setFocus(true)} title={tx("מסך קריאה — רק התוכן, על כל המסך")} aria-label={tx("מסך קריאה")}>⤢</button>}
                <button className="font-btn" onClick={() => bumpFont(-0.1)} title={tx("הקטנת טקסט")} aria-label={tx("הקטנת טקסט")}>{tx("אַ−")}</button>
                <button className="font-btn" onClick={() => bumpFont(0.1)} title={tx("הגדלת טקסט")} aria-label={tx("הגדלת טקסט")}>{tx("אַ+")}</button>
                {typeof document !== "undefined" && document.fullscreenEnabled && <button className={"font-btn" + (isFull ? " on" : "")} onClick={toggleFull} title={isFull ? tx("יציאה ממסך מלא") : tx("מסך מלא — הטלוויזיה על כל המסך")} aria-label={tx("מסך מלא")}>⛶</button>}
                <button className={"font-btn" + (bgOpen ? " on" : "")} onClick={() => setBgOpen((v) => !v)} title={tx("הרקע מסביב לטלוויזיה")} aria-label={tx("רקע")}>🎨</button>
                <button className="font-btn print-btn" onClick={() => window.print()} title={tx("הדפסת התוכן המוצג")} aria-label={tx("הדפסה")}>🖨</button>
                <button className="font-btn" onClick={downloadBackup} title={tx("גיבוי: הורדת כל הספרים, ההערות והמרקרים לקובץ")} aria-label={tx("גיבוי")}>⬇</button>
                <button className="font-btn" onClick={pickRestoreFile} title={tx("שחזור מקובץ גיבוי")} aria-label={tx("שחזור")}>⬆</button>
                {getLang() === "he" && <button className={"font-btn help-btn" + (helpOn ? " on" : "")} onClick={() => setHelpOn((v) => !v)} title={helpOn ? tx("חזרה ללימוד") : tx("המדריך: איך משתמשים")} aria-label={tx("המדריך")}>❔</button>}
                {textIsHe && <button className={"font-btn layer-btn gloss-btn" + (glossOn ? " on" : "") + (glossBusy ? " busy" : "")} onClick={() => setGlossOn((v) => !v)} title={glossBusy || (glossOn ? tx("המילון הארמי מוצג — לחץ להסתיר") : tx("מילון ארמי: פירוש עברי קצר מתחת לכל מילה ארמית"))} aria-label={tx("מילון ארמי")} aria-pressed={glossOn}>📖</button>}
                {textIsHe && <button className={"font-btn layer-btn nikud-btn" + (nikudOn ? " on" : "")} onClick={toggleNikud} title={nikudOn ? tx("הניקוד מוצג — לחץ להסתיר") : tx("הוסף ניקוד לטקסט שאינו מנוקד (הסולם, פירושים)")} aria-label={tx("ניקוד")} aria-pressed={nikudOn}>{tx("בְּ")}</button>}
                <button className={"font-btn layer-btn" + (layerOn ? " on" : "")} onClick={toggleLayer} title={layerOn ? tx("שכבת הלומד מוצגת — לחץ להסתיר") : tx("שכבת הלומד מוסתרת — לחץ להציג")} aria-label={tx("שכבת הלומד")}>✍️</button>
                <button
                  className={"font-btn" + (cloudUser ? (syncState === "err" ? " cloud-err" : " cloud-on") : "")}
                  onClick={() => setShowCloud(true)}
                  title={
                    !cloudUser
                      ? tx("חשבון ענן — כניסה")
                      : syncState === "saving"
                      ? tx("שומר בענן...")
                      : syncState === "err"
                      ? tx("שגיאת סנכרון: ") + syncErr
                      : tx("מסונכרן לענן · ") + (cloudUser.email || "")
                  }
                  aria-label={tx("חשבון ענן")}
                >
                  {cloudUser && syncState === "saving" ? "⏳" : cloudUser && syncState === "err" ? "⚠" : "☁"}
                </button>
              </span>
              <span className={"onair " + (loading ? "live" : "")}>{loading ? "ON AIR" : ""}</span>
              {bgOpen && (
                <div className="bg-pop" dir={langDir()}>
                  <span className="reader-note">{tx("הרקע מסביב לטלוויזיה:")}</span>
                  <div className="bg-swatches">
                    {BG_THEMES.map(([id, label, sw]) => (
                      <button key={id} className={"bg-sw " + (bgTheme === id ? "on" : "")} style={{ background: sw }} title={tx(label)} onClick={() => { setBgTheme(id); setBgOpen(false); }}><span>{tx(label)}</span></button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {guestAsk && !cloudUser && (
              <div className="cloud-overlay">
                <div className="cloud-box" dir={langDir()}>
                  <h3>{tx("🕯 הזמינו אותך ללמוד יחד")}</h3>
                  <p>{tx("איך קוראים לך? כך החבר יראה אותך בדף.")}</p>
                  <input className="cloud-input" type="text" dir="auto" placeholder={tx("השם שלך")} maxLength={30} autoFocus value={guestName}
                    onChange={(e) => setGuestName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") guestEnter(); }} />
                  <div className="cloud-actions">
                    <button className="cloud-btn" onClick={guestEnter} disabled={guestBusy}>{guestBusy ? tx("נכנס…") : tx("🚪 היכנס לדף")}</button>
                  </div>
                  {guestMsg && <p style={{ fontSize: ".85rem", color: "#f8c778", marginTop: 8 }}>{guestMsg}</p>}
                  <div className="cloud-actions" style={{ marginTop: 10 }}>
                    <button className="cloud-btn ghost" onClick={() => { setGuestAsk(false); setShowCloud(true); }}>{tx("יש לי חשבון — כניסה במייל")}</button>
                    <button className="cloud-btn ghost" onClick={dropPendingJoin}>{tx("לא עכשיו")}</button>
                  </div>
                  <p style={{ fontSize: ".78rem", opacity: 0.7, marginTop: 8 }}>{tx("כאורח לא נשמר לך דבר לפעם הבאה. כניסה במייל שומרת את הסימונים וההערות.")}</p>
                </div>
              </div>
            )}
            {findOpen && (
              <div className="cloud-overlay search-overlay" onClick={closeFind}>
                <div className="search-box" dir={langDir()} onClick={(e) => e.stopPropagation()}>
                  <div className="search-row">
                    <input ref={findInRef} id="search-input" className="search-in" dir="auto" value={findQ} placeholder={tx("מה אתה מחפש? מילה, נושא, או כלי…")} onChange={(e) => { setFindQ(e.target.value); runFind(e.target.value); }} onKeyDown={(e) => { if (e.key === "Escape") closeFind(); if (e.key === "Enter") { const f = findRes.feats[0], h = findRes.hits[0]; if (f && !h) goFeature(f); else if (h) goHit(h); } }} />
                    <button className={"mark-btn mic" + (listening ? " on" : "")} onClick={voiceSearch} title={tx("חיפוש קולי")}>{listening ? "● " + tx("מקשיב…") : "🎤"}</button>
                    <select className="voice-lang" value={getLang()} onChange={(e) => { try { recogRef.current?.stop(); } catch {} setListening(false); changeLang(e.target.value); }} title={tx("שפת החיפוש והמסך")}>{LANGS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
                    <button className="mark-btn" onClick={closeFind} aria-label={tx("סגור")}>✕</button>
                  </div>
                  {libHint && <div className="lib-hint">{libHint}</div>}
                  <div className="search-results">
                    {!findQ.trim() && (
                      <div className="search-empty">
                        <p>{tx("אפשר לחפש מילה מתוך ספר או הערה, או שם של כלי: \"הקלטה\", \"ייצוא\", \"תרגום\", \"לימוד משותף\".")}</p>
                        <div className="search-chips">{["הקלט שיעור", "ייצוא", "תרגום", "לימוד משותף", "ארכיון", "מחיקת חשבון"].map((c) => <button key={c} className="ghost-btn" onClick={() => { setFindQ(tx(c)); runFind(tx(c)); }}>{tx(c)}</button>)}</div>
                      </div>
                    )}
                    {findRes.feats.length > 0 && (
                      <div className="search-group">
                        <div className="search-h">{tx("כלים")}</div>
                        {findRes.feats.map((f) => (
                          <button key={f.id} className="search-item feat" onClick={() => goFeature(f)}>
                            <b>{tx(f.name)}</b><span>{tx(f.desc)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {findQ.trim() && (
                      <div className="search-group">
                        <div className="search-h">{findRes.busy ? tx("מחפש בספרים…") : tx("בספרים שלך ({n})", { n: findRes.hits.length })}{!findRes.busy && <span className="search-stat"> · {tx("נסרקו {b} ספרים, {e} פריטים", indexStats().books !== undefined ? { b: indexStats().books, e: indexStats().entries } : {})}</span>}</div>
                        {findRes.hits.map((h, k) => { const [a, b, c] = searchSnippet(h.text, findQ); return (
                          <button key={k} className={"search-item hit" + (h.pin ? "" : " arch")} onClick={() => goHit(h)}>
                            <b>{h.title}{!h.pin && " · 📚"}</b>
                            <small>{h.kind === "title" ? tx("שם הספר") : h.kind === "note" ? tx("📝 הערה שלך") : h.kind === "result" ? tx("תוצר: {c}", { c: tx((CHANNELS.find((x) => x.id === h.channel) || {}).label || h.channel) }) : tx("פרק {n}", { n: h.ch + 1 })}</small>
                            <span dir="auto">{a}<mark>{b}</mark>{c}</span>
                          </button>
                        ); })}
                        {!findRes.busy && !findRes.hits.length && !findRes.feats.length && <p className="search-none">{tx("לא נמצא. נסה מילה אחרת, או קצרה יותר.")}</p>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {showCloud && (
              <div className="cloud-overlay" onClick={() => setShowCloud(false)}>
                <div className="cloud-box" onClick={(e) => e.stopPropagation()}>
                  <h3>{tx("☁ חשבון ענן")}</h3>
                  {cloudUser ? (
                    <>
                      <p>{cloudUser.is_anonymous ? tx("נכנסת כאורח:") : tx("מחובר בתור:")}<br /><b dir="auto">{cloudUser.is_anonymous ? shareNameOf(cloudUser) : cloudUser.email}</b></p>
                      <p className="sync-line">
                        {syncState === "saving" ? tx("⏳ שומר בענן...") : syncState === "err" ? "⚠ " + syncErr : tx("✅ סנכרון שוטף פעיל — כל מרקר, הערה, תוצר וציון נשמרים גם בענן.")}
                      </p>
                      <div className="cloud-actions">
                        <button className="cloud-btn" onClick={manualPull} disabled={migrating || pulling}>{tx("⬇ הורד את הספרים מהענן")}</button>
                      </div>
                      <p style={{ fontSize: ".8rem", opacity: 0.75, marginTop: 8 }}>{tx("למכשיר חדש, או כדי למשוך עבודה שנעשתה במקום אחר. תמיד יוצג מה עומד לרדת לפני שמחליטים.")}</p>
                      <div className="cloud-actions">
                        <button className="cloud-btn ghost" onClick={migrateToCloud} disabled={migrating}>{migrating ? tx("⏳ מעלה...") : tx("☁ העלאה מלאה מחדש")}</button>
                      </div>
                      <p style={{ fontSize: ".8rem", opacity: 0.6, marginTop: 8 }}>{tx("לרוב אין בזה צורך — הסנכרון השוטף מטפל בהכול. בטוח להריץ שוב: מעדכן ולא מכפיל.")}</p>
                      <div className="cloud-actions">
                        <button className="cloud-btn ghost" onClick={() => setShowCloud(false)} disabled={migrating}>{tx("סגור")}</button>
                        <button className="cloud-btn ghost" onClick={cloudSignOut} disabled={migrating}>{tx("התנתק")}</button>
                      </div>
                      <p style={{ fontSize: ".8rem", marginTop: 14, textAlign: "center" }}>
                        <a href="#" className="cloud-del" onClick={(e) => { e.preventDefault(); deleteAccount(); }} style={{ pointerEvents: delBusy || migrating ? "none" : "auto" }}>{delBusy ? tx("מוחק את החשבון...") : tx("מחיקת החשבון וכל הנתונים")}</a>
                        {" · "}
                        <a href={SITE_URL + "/privacy/"} target="_blank" rel="noopener noreferrer" className="cloud-link">{tx("מדיניות פרטיות")}</a>
                      </p>
                    </>
                  ) : (
                    <>
                      <p>{tx("כניסה בלי סיסמה: כתוב את המייל שלך ונשלח אליו קישור כניסה.")}</p>
                      <input
                        className="cloud-input"
                        type="email"
                        dir="ltr"
                        placeholder="you@email.com"
                        value={cloudEmail}
                        onChange={(e) => setCloudEmail(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") sendMagicLink(); }}
                      />
                      <div className="cloud-actions">
                        <button className="cloud-btn" onClick={sendMagicLink}>{tx("📨 שלח לי קישור כניסה")}</button>
                        <button className="cloud-btn ghost" onClick={() => setShowCloud(false)}>{tx("המשך בלי חשבון")}</button>
                      </div>
                      {cloudSent && (
                        <>
                          <input
                            className="cloud-input"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            dir="ltr"
                            placeholder={tx("קוד מהמייל · 6 ספרות")}
                            value={cloudCode}
                            onChange={(e) => setCloudCode(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") verifyCode(); }}
                          />
                          <div className="cloud-actions">
                            <button className="cloud-btn" onClick={verifyCode} disabled={cloudCode.replace(/\D/g, "").length < 6}>{tx("🔑 כניסה עם הקוד")}</button>
                          </div>
                        </>
                      )}
                      {cloudPwOn && (
                        <>
                          <input
                            className="cloud-input"
                            type="password"
                            autoComplete="current-password"
                            dir="ltr"
                            placeholder={tx("סיסמה")}
                            value={cloudPw}
                            onChange={(e) => setCloudPw(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") signInPassword(); }}
                          />
                          <div className="cloud-actions">
                            <button className="cloud-btn" onClick={signInPassword}>{tx("🔑 כניסה בסיסמה")}</button>
                          </div>
                        </>
                      )}
                      <p style={{ fontSize: ".8rem", marginTop: 14, textAlign: "center" }}>
                        {!cloudPwOn && <><a href="#" className="cloud-link" onClick={(e) => { e.preventDefault(); setCloudPwOn(true); }}>{tx("יש לי סיסמה")}</a>{" · "}</>}
                        <a href={SITE_URL + "/privacy/"} target="_blank" rel="noopener noreferrer" className="cloud-link">{tx("מדיניות פרטיות")}</a>
                      </p>
                    </>
                  )}
                  {cloudMsg && <p className="cloud-msg">{cloudMsg}</p>}
                </div>
              </div>
            )}

            {/* שלב 3: הצעת הורדה — נפתחת רק כשבענן יש משהו חדש יותר ממה שיש כאן */}
            {pullList && !share && (
              <div className="cloud-overlay" onClick={() => { if (!pulling) { setPullList(null); setPullMsg(""); } }}>
                <div className="cloud-box" onClick={(e) => e.stopPropagation()}>
                  <h3>{tx("⬇ יש חדש בענן")}</h3>
                  <p style={{ fontSize: ".9rem" }}>
                    {pullList[0]?.manual
                      ? tx("הספרים הבאים נמצאים בענן. ההורדה תחליף את העותק שבמכשיר הזה:")
                      : tx("הספרים הבאים עודכנו במקום אחר, או שאינם קיימים במכשיר הזה:")}
                  </p>
                  <ul className="pull-list">
                    {pullList.map((c) => (
                      <li key={c.id}>
                        <b>{c.title || tx("ללא שם")}</b>
                        {c.isNew ? <span className="pull-tag">{tx("חדש")}</span> : null}
                        <span className="pull-when">{c.updated_at ? new Date(c.updated_at).toLocaleString(getLang()) : ""}</span>
                      </li>
                    ))}
                  </ul>
                  {pullMsg && <p className="cloud-msg">{pullMsg}</p>}
                  <div className="cloud-actions">
                    <button className="cloud-btn" onClick={() => doPull(pullList)} disabled={pulling}>
                      {pulling ? tx("⏳ מוריד...") : tx("⬇ הורד הכול")}
                    </button>
                    <button className="cloud-btn ghost" onClick={() => { setPullList(null); setPullMsg(""); }} disabled={pulling}>
                      {tx("לא עכשיו")}
                    </button>
                  </div>
                  <p style={{ fontSize: ".78rem", opacity: 0.6, marginTop: 10 }}>
                    {tx("\"לא עכשיו\" בטוח לחלוטין — שום דבר לא נמחק, וההצעה תחזור בכניסה הבאה.")}
                  </p>
                </div>
              </div>
            )}
 
            {view === "tv" && multi && (
              <div className="chapter-strip">
                <span className="chapter-count">{chIdx + 1}/{book.chapters.length}</span>
                <div className="chapter-tabs">
                  {book.chapters.map((c, i) => (
                    <button
                      key={i}
                      dir={textDir} className={"chapter-tab " + (i === chIdx ? "on " : "") + (book.progress?.[i]?.done ? "ok" : "")}
                      onClick={() => gotoChapter(i)}
                      title={c.title}
                    >
                      {book.progress?.[i]?.done ? "✓ " : ""}{c.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
 
            {helpOn && <HelpView onClose={() => setHelpOn(false)} />}
            {/* 🕯 חלונית הלימוד המשותף — מחוץ לאזור הגלילה, כך שהיא תמיד מול העיניים */}
            {!helpOn && share && <ShareBar share={share} peers={peers} me={myUid} onTake={takePage} onFollow={toggleFollow} onLeave={leaveShare} onCopy={copyShareLink} copied={shareCopied} video={shareVideo} onVideo={() => { setShareWatch(false); setShareVideo((v) => !v); }} away={view !== "tv" || !book || book.id !== share.bookId} onBack={backToShare} lost={shareLost} onRejoin={() => { setShareLost(false); setShareEpoch((n) => n + 1); }} />}
            {share && shareVideo && <VideoPanel sessionId={share.id} myName={shareNameOf(cloudUser)} watch={shareWatch} onClose={() => setShareVideo(false)} />}
            <div className={"screen-body" + (helpOn ? " behind-help" : "")} style={{ zoom: fontScale }}>
              {view === "boot" && (
                <div className="idle"><div className="idle-mark spin">✳</div><p>{tx("טוען את הספרייה…")}</p></div>
              )}
 
              {/* ── קליטת ספר חדש ── */}
              {view === "intake" && (
                <div className="intake">
                  <p className="intake-lead">
                    {tx("הדבק ספר, פרק או מאמר — או העלה קובץ — והמסך יהפוך אותו לסדרת פרקים עם ערוצי למידה: סיכום, מושגים, מפת חשיבה, מבחן ועוד. ההתקדמות נשמרת, כך שאפשר ללמוד ספר שלם לאורך זמן.")}
                  </p>
                  {openQ && (
                    <div className="my-q">
                      <span className="my-q-ic">❓</span>
                      <span className="my-q-body"><small>{tx("השאלה שאתה נושא איתך")}</small>{openQ}</span>
                      <button className="my-q-x" onClick={() => saveOpenQ("")} title={tx("להסיר את השאלה")} aria-label={tx("להסיר את השאלה")}>✕</button>
                    </div>
                  )}
                  <input ref={titleRef} className="intake-title" placeholder={tx("שם הספר (למשל: אדיר במרום — הרמח״ל)")} />
 
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    style={{ display: "none" }}
                    onChange={onFilePicked}
                  />
                  <input
                    id="photo-ocr-input"
                    ref={photoRef}
                    type="file"
                    multiple
                    accept="image/*"
                    style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", clip: "rect(0 0 0 0)" }}
                    onChange={onPhotosPicked}
                  />
                  <div className="upload-box">
                    <span className="upload-hint">
                      {tx("⬇ הכפתורים למטה: שדר טקסט, העלה קבצים (אפשר כמה בבת אחת — כל קובץ נהיה ספר), צילומים לפענוח OCR עברי, או 🎬 שיעור מוקלט — קובץ אודיו או וידאו שמתומלל לטקסט עברי והופך לספר.")}
                    </span>
                    {fileBusy && <span className="busy-line">⏳ {fileBusy}</span>}
                  </div>
 
                  <input
                    id="smart-scan-input"
                    ref={smartRef}
                    type="file"
                    multiple
                    accept="image/*"
                    style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", clip: "rect(0 0 0 0)" }}
                    onChange={onSmartPicked}
                  />
                  <div className="scan-mode-row">
                    <span className="scan-mode-title">{KABBALAH ? tx("📸 צלם דף חכם (AI · לדפי זוהר ודפים מפורשים) — תבנית:") : tx("📸 צלם דף חכם (AI · לדפים עם פירוש) — תבנית:")}</span>
                    <select className="scan-mode-select" value={smartMode} onChange={(e) => setSmartMode(e.target.value)}>
                      {Object.entries(SCAN_MODES).filter(([k]) => k !== "zohar" || KABBALAH).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                    <label htmlFor="camera-scan-input" className="cam-btn" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
                      {tx("📷 צלם עכשיו")}
                    </label>
                    <label htmlFor="smart-scan-input" className="cam-btn" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
                      {tx("🖼 העלה צילומים — כמה יחד")}
                    </label>
                    <span className="scan-mode-title" style={{ opacity: 0.75, fontWeight: 400 }}>
                      {tx("כמה צילומים יחד נעשים מאמר אחד, לפי סדר שמות הקבצים (סדר הצילום).")}
                    </span>
                    {/* ההתקדמות והשגיאה כאן, ליד הכפתור — בטלפון ההודעות שלמעלה ולמטה מחוץ למסך */}
                    {fileBusy && <span className="busy-line" role="status">⏳ {fileBusy}</span>}
                    {error && !fileBusy && <span className="err" role="alert">{error}</span>}
                  </div>

                  {KABBALAH && <div className="scan-mode-row zohar-row">
                    <span className="scan-mode-title">{tx("📜 זוהר עם סולם צמוד — מאמר מספריא:")}</span>
                    <select className="scan-mode-select" value={zoharForm.p} onChange={(e) => setZoharForm((f) => ({ ...f, p: +e.target.value }))} aria-label={tx("פרשה")}>
                      {ZOHAR_PARSHIOT.map(([en, he], i) => (
                        <option key={en} value={i}>{he}</option>
                      ))}
                    </select>
                    <select className="scan-mode-select" value="" onChange={(e) => pickZoharArticle(e.target.value)} aria-label={tx("מאמר")} disabled={!zoharArts || !zoharArts.length}>
                      <option value="">{zoharArts === null ? tx("טוען מאמרים…") : zoharArts.length ? tx("בחר מאמר ({n})", { n: zoharArts.length }) : tx("אין רשימה — מלא אותיות ידנית")}</option>
                      {(zoharArts || []).map((a) => (
                        <option key={a.n} value={a.n}>{(a.name || tx("מאמר {n}", { n: a.n })) + " · " + hebNum(a.from) + (a.to > a.from ? "–" + hebNum(a.to) : "")}</option>
                      ))}
                    </select>
                    <input className="zohar-in" placeholder={tx("מאות (קמג)")} value={zoharForm.from} onChange={(e) => setZoharForm((f) => ({ ...f, from: e.target.value }))} aria-label={tx("מאות")} />
                    <input className="zohar-in" placeholder={tx("עד אות (קמו)")} value={zoharForm.to} onChange={(e) => setZoharForm((f) => ({ ...f, to: e.target.value }))} aria-label={tx("עד אות")} />
                    <input className="zohar-in wide" placeholder={tx("שם המאמר (ארבע קשרין)")} value={zoharForm.name} onChange={(e) => setZoharForm((f) => ({ ...f, name: e.target.value }))} aria-label={tx("שם המאמר")} />
                    <button className="cam-btn" onClick={importZohar} disabled={!!fileBusy}>{tx("📜 משוך מאמר")}</button>
                    <span className="scan-mode-title" style={{ opacity: 0.75, fontWeight: 400 }}>
                      {tx("הארמית והסולם לפי האותיות שבספר · מאמר חדש מצטרף לספר של אותה פרשה")}
                    </span>
                  </div>}
                  <div className="scan-mode-row yt-row">
                    <span className="scan-mode-title">{tx("▶ סרטון יוטיוב — קישור ותמליל:")}</span>
                    <input className="zohar-in wide" dir="ltr" placeholder="https://youtu.be/…" value={ytForm.url} onChange={(e) => setYtForm((f) => ({ ...f, url: e.target.value }))} aria-label={tx("קישור לסרטון")} />
                    <input className="zohar-in wide" dir="auto" placeholder={tx("שם השיעור")} value={ytForm.title} onChange={(e) => setYtForm((f) => ({ ...f, title: e.target.value }))} aria-label={tx("שם השיעור")} />
                    <textarea className="yt-text" dir="auto" placeholder={tx("הדבק כאן את התמליל שהעתקת מיוטיוב")} value={ytForm.text} onChange={(e) => setYtForm((f) => ({ ...f, text: e.target.value }))} />
                    <button className="cam-btn" onClick={importYouTube} disabled={!!fileBusy}>{tx("▶ הפוך לספר")}</button>
                    <span className="scan-mode-title" style={{ opacity: 0.75, fontWeight: 400 }}>
                      {tx("ביוטיוב: מתחת לסרטון — \"עוד\" ← \"הצג תמליל\" — לסמן הכול ולהעתיק. האפליקציה אינה מורידה את הסרטון; הוא יתנגן לצד הטקסט.")}
                    </span>
                  </div>
                  <div className="scan-mode-row">
                    {!recOn ? (
                      <button className="rec-btn" onClick={startRec} disabled={!!fileBusy}>
                        {tx("🎙 הקלט שיעור חי")}
                      </button>
                    ) : (
                      <>
                        <span className="rec-live">{tx("● מקליט…")} {Math.floor(recSec / 60)}:{String(recSec % 60).padStart(2, "0")}</span>
                        <button className="rec-btn stop" onClick={stopRec}>{tx("⏹ עצור וסיים")}</button>
                      </>
                    )}
                    <label htmlFor="video-capture-input" className="rec-btn" style={{ pointerEvents: fileBusy || recOn ? "none" : "auto", opacity: fileBusy || recOn ? 0.6 : 1, userSelect: "none" }}>
                      {tx("🎥 צלם וידאו")}
                    </label>
                    <span className="scan-mode-title" style={{ opacity: 0.75 }}>
                      {tx("שיעור, הרצאה או הקראה — בסיום ההקלטה מתומללת והופכת לספר")}
                    </span>
                  </div>

                  {recPend && !fileBusy && !recOn && (
                    <div className="rec-pend">
                      <span>{tx("🎙 הקלטה שעוד לא תומללה")} · {recClock(recPend.sec)}</span>
                      <button className="rec-btn" onClick={() => sendRec(REC_PENDING, titleRef.current?.value?.trim() || tx("הקלטת שיעור"))}>{recReady === REC_PENDING ? tx("📤 לחץ שוב לשליחה") : tx("📤 שלח הקלטה")}</button>
                      <button className="rec-btn" onClick={retryRec}>{tx("🔁 תמלל שוב")}</button>
                      <button className="del" onClick={dropRec} title={tx("מחק הקלטה")}>✕</button>
                    </div>
                  )}

                  <div className="or-divider"><span>{tx("או הדבק טקסט")}</span></div>
 
                  <textarea ref={inputRef} className="intake-text" placeholder={tx("הדבק את הטקסט כאן...")} />
                  <p className="intake-tip">
                    {tx("טקסט ארוך יחולק אוטומטית לפרקים. לחלוקה ידנית — שורה של === בין הקטעים.")}
                  </p>
                  {error && <div className="err">{error}</div>}
                </div>
              )}
 
              {/* ── ספרייה ── */}
              {view === "library" && (
                <div className="library">
                  <p className="intake-lead">
                    {tx("הספרים שלך. כל ספר שומר את הפרקים, התוצרים והציונים שלו.")}
                    <a href="#" className="to-opening" onClick={(e) => { e.preventDefault(); setShowOpening(true); }} title={tx("חזרה למסך הפתיחה")}>{tx("ל · הפנים")}</a>
                  </p>
                  {openQ && (
                    <div className="my-q">
                      <span className="my-q-ic">❓</span>
                      <span className="my-q-body"><small>{tx("השאלה שאתה נושא איתך")}</small>{openQ}</span>
                      <button className="my-q-x" onClick={() => saveOpenQ("")} title={tx("להסיר את השאלה")} aria-label={tx("להסיר את השאלה")}>✕</button>
                    </div>
                  )}
                  {fileBusy && <div className="busy-line" style={{ display: "block", margin: "2px 0 12px" }}>⏳ {fileBusy}</div>}
                  {!fileBusy && recOn && <div className="busy-line" style={{ display: "block", margin: "2px 0 12px", color: "#ff8a8a" }}>{tx("● מקליט… לסיום לחץ ⏹ למטה")}</div>}
                  {error && <div className="err">{error}</div>}
                  {recPend && !fileBusy && !recOn && (
                    <div className="rec-pend">
                      <span>{tx("🎙 הקלטה שעוד לא תומללה")} · {recClock(recPend.sec)}</span>
                      <button className="rec-btn" onClick={() => sendRec(REC_PENDING, titleRef.current?.value?.trim() || tx("הקלטת שיעור"))}>{recReady === REC_PENDING ? tx("📤 לחץ שוב לשליחה") : tx("📤 שלח הקלטה")}</button>
                      <button className="rec-btn" onClick={retryRec}>{tx("🔁 תמלל שוב")}</button>
                      <button className="del" onClick={dropRec} title={tx("מחק הקלטה")}>✕</button>
                    </div>
                  )}
                  <button className="search-bar" onClick={() => openFind("")}>
                    <span>🔍 {tx("חיפוש בספרים, בהערות ובכלים…")}</span>
                    <span className="search-mic" onClick={(e) => { e.stopPropagation(); openFind(""); setTimeout(voiceSearch, 120); }} title={tx("חיפוש קולי")}>🎤</span>
                  </button>
                  {libHint && <div className="lib-hint">{libHint}</div>}
                  {index.length > 1 && (
                    <div className="sel-bar">
                      {!selMode ? (
                        <button className="ghost-btn" onClick={() => { setSelMode(true); setSelIds(new Set()); }}>{tx("☑ בחר")}</button>
                      ) : (
                        <>
                          <button className="ghost-btn" onClick={() => setSelIds(new Set(shown.map((b) => b.id)))}>{tx("סמן הכול על המסך")}</button>
                          {archiveOpen && archived.length > 0 && <button className="ghost-btn" onClick={() => setSelIds(new Set(archived.map((b) => b.id)))}>{tx("סמן הכול בארכיון")}</button>}
                          <button className="ghost-btn on" disabled={![...selIds].some((id) => shown.some((b) => b.id === id))} onClick={() => setPinMany([...selIds].filter((id) => shown.some((b) => b.id === id)), false)}>{tx("▾ לארכיון ({n})", { n: [...selIds].filter((id) => shown.some((b) => b.id === id)).length })}</button>
                          {archived.length > 0 && <button className="ghost-btn on" disabled={![...selIds].some((id) => archived.some((b) => b.id === id))} onClick={() => setPinMany([...selIds].filter((id) => archived.some((b) => b.id === id)), true)}>{tx("📌 למסך ({n})", { n: [...selIds].filter((id) => archived.some((b) => b.id === id)).length })}</button>}
                          <button className="ghost-btn" onClick={() => { setSelMode(false); setSelIds(new Set()); }}>{tx("ביטול")}</button>
                        </>
                      )}
                    </div>
                  )}
                  {shown.map((b) => (
                    <div className={"book-row" + (selMode && selIds.has(b.id) ? " sel" : "")} key={b.id}>
                      {selMode && <input type="checkbox" className="sel-box" checked={selIds.has(b.id)} onChange={() => toggleSel(b.id)} aria-label={b.title} />}
                      <button className="book-main" onClick={() => selMode ? toggleSel(b.id) : openBook(b.id)}>
                        <span className="book-title">{b.title}</span>
                        <span className="book-meta">
                          {tx("{a}/{b} פרקים הושלמו", { a: b.done, b: b.chapters })}
                        </span>
                        <span className="mini-bar">
                          <span className="mini-fill" style={{ width: `${b.chapters ? (b.done / b.chapters) * 100 : 0}%` }} />
                        </span>
                      </button>
                      {(b.talk || 0) >= MIRROR_MIN && (
                        <button className="mirror-btn" onClick={() => openMirror(b.id)} title={tx("🎧 שיקוף — {n} הערות וסימונים בספר הזה", { n: b.talk })} aria-label={tx("שיקוף")}>
                          🎧<small>{tx("שיקוף")}</small>
                        </button>
                      )}
                      {recIds.has(b.id) && (
                        <button className="mirror-btn" onClick={() => sendRec(b.id, b.title)} title={tx("ייצוא: הקלטת השיעור יחד עם המלל (ההקלטה שמורה במכשיר הזה)")} aria-label={tx("שלח הקלטה")}>
                          📤<small>{recReady === b.id ? tx("לחץ שוב") : tx("ייצוא")}</small>
                        </button>
                      )}
                      <button className="del pin" onClick={() => togglePin(b.id)} title={tx("הסר מהמסך (הספר נשמר בארכיון)")} aria-label={tx("לארכיון")}>▾</button>
                      {deleteArm === b.id ? (
                        <button className="del confirm" onClick={() => removeBook(b.id)}>{tx("בטוח?")}</button>
                      ) : (
                        <button className="del" onClick={() => setDeleteArm(b.id)} title={tx("מחק ספר")}>✕</button>
                      )}
                    </div>
                  ))}
                  {!shown.length && archived.length > 0 && <p className="intake-tip" style={{ textAlign: "center" }}>{tx("המסך פנוי. הספרים שלך בארכיון למטה — 📌 מחזיר ספר למסך.")}</p>}
                  {archived.length > 0 && (
                    <div className={"archive" + (archiveOpen ? " open" : "")}>
                      <button className="archive-head" onClick={() => setArchiveOpen((v) => !v)} aria-expanded={archiveOpen}>
                        <span>{tx("📚 ארכיון · {n} ספרים", { n: archived.length })}</span>
                        <span className="archive-arrow">{archiveOpen ? "▴" : "▾"}</span>
                      </button>
                      {archiveOpen && archived.map((b) => (
                        <div className={"book-row archived" + (selMode && selIds.has(b.id) ? " sel" : "")} key={b.id}>
                          {selMode && <input type="checkbox" className="sel-box" checked={selIds.has(b.id)} onChange={() => toggleSel(b.id)} aria-label={b.title} />}
                          <button className="book-main" onClick={() => selMode ? toggleSel(b.id) : openBook(b.id)}>
                            <span className="book-title">{b.title}</span>
                            <span className="book-meta">{tx("{a}/{b} פרקים הושלמו", { a: b.done, b: b.chapters })}</span>
                          </button>
                          <button className="del pin on" onClick={() => togglePin(b.id)} title={tx("📌 החזר למסך")} aria-label={tx("📌 החזר למסך")}>📌</button>
                          {deleteArm === b.id ? (
                            <button className="del confirm" onClick={() => removeBook(b.id)}>{tx("בטוח?")}</button>
                          ) : (
                            <button className="del" onClick={() => setDeleteArm(b.id)} title={tx("מחק ספר")}>✕</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {error && <div className="err">{error}</div>}
                </div>
              )}

              {/* ── ארון הספרים → ייבוא ללימוד ── */}
              {view === "shelf" && (() => {
                const books = shelfIdx ? shelfIdx.books : [];
                const q = shelfQ.trim();
                const shown = books.filter((b) =>
                  (!shelfFilter || b.shelf === shelfFilter) &&
                  (!q || (b.hebrew || "").includes(q) || (b.title || "").toLowerCase().includes(q.toLowerCase()))
                );
                const optQ = q.toLowerCase();
                const shownOpts = shelfOpts.filter((o) => !q || o.label.toLowerCase().includes(optQ));
                return (
                  <div className="library shelf-screen">
                    {!shelfPick && (
                      <p className="intake-lead">
                        70 ספרי המקור של הארון. בחר ספר — והוא נכנס לספרייה שלך כספר עם פרקים, לסיכום, מבחן, מגילה ומרקרים.
                        ספר ענק נכנס שער אחר שער.
                        {" "}<a className="shelf-link" href={SHELF_URL} target="_blank" rel="noopener noreferrer">לקריאה בארון עצמו ↗</a>
                      </p>
                    )}
                    {fileBusy && <div className="busy-line" style={{ display: "block", margin: "2px 0 12px" }}>⏳ {fileBusy}</div>}
                    {shelfErr && <div className="err">{shelfErr}</div>}

                    {shelfPick && shelfSegs && (
                      <>
                        <div className="shelf-pick-head">
                          <button className="ghost-btn" onClick={() => { setShelfPick(null); setShelfSegs(null); setShelfOpts([]); setShelfQ(""); }}>→ כל הספרים</button>
                          <div>
                            <div className="book-title">{shelfPick.hebrew || shelfPick.title}</div>
                            <div className="book-meta">{fmtChars(shelfPick.chars)} · {shelfPick.segments.toLocaleString("he")} קטעים · ספר גדול — בחר שער או חלק לייבוא</div>
                          </div>
                        </div>
                        <input
                          className="shelf-search"
                          placeholder="סינון שערים..."
                          value={shelfQ}
                          onChange={(e) => setShelfQ(e.target.value)}
                        />
                        {shownOpts.map((o, i) => (
                          <div className="book-row" key={o.key + ":" + o.part + ":" + i}>
                            <button className="book-main" disabled={!!fileBusy} onClick={() => importFromShelf(shelfPick, shelfSegs, o.from, o.to, o.label)}>
                              <span className="book-title">{o.label}</span>
                              <span className="book-meta">{fmtChars(o.chars)} · {o.to - o.from} קטעים</span>
                            </button>
                          </div>
                        ))}
                        {!shownOpts.length && <p className="intake-tip">לא נמצא שער מתאים.</p>}
                      </>
                    )}

                    {!shelfPick && shelfIdx && (
                      <>
                        <input
                          className="shelf-search"
                          placeholder="חיפוש ספר בארון..."
                          value={shelfQ}
                          onChange={(e) => setShelfQ(e.target.value)}
                        />
                        <div className="shelf-chips">
                          <button className={"pill" + (!shelfFilter ? " on" : "")} onClick={() => setShelfFilter("")}>הכל · {books.length}</button>
                          {(shelfIdx.shelves || []).map((s) => (
                            <button key={s} className={"pill" + (shelfFilter === s ? " on" : "")} onClick={() => setShelfFilter(shelfFilter === s ? "" : s)}>{s}</button>
                          ))}
                        </div>
                        {shown.map((b) => (
                          <div className="book-row" key={b.file}>
                            <button className="book-main" disabled={!!fileBusy} onClick={() => pickShelfBook(b)}>
                              <span className="book-title">{b.hebrew || b.title}</span>
                              <span className="book-meta">
                                {b.shelf} · {fmtChars(b.chars)} · {b.segments.toLocaleString("he")} קטעים
                                {b.chars > SHELF_IMPORT_MAX ? " · ייבוא לפי שער" : " · נכנס כולו"}
                              </span>
                            </button>
                          </div>
                        ))}
                        {!shown.length && <p className="intake-tip">לא נמצא ספר מתאים.</p>}
                      </>
                    )}
                  </div>
                );
              })()}

              {/* ── לוח שידורים של ספר ── */}
              {view === "mirror" && book && (
                <MirrorView key={book.id} book={book} question={openQ} cloudUser={cloudUser} onSave={saveMirrors} />
              )}

              {view === "guide" && book && (
                <div className="guide">
                  <div className="guide-head">
                    <h2 className="guide-title">{book.title}</h2>
                    <span className="guide-meta">{tx("{a}/{b} פרקים הושלמו", { a: doneCount(book), b: book.chapters.length })}</span>
                  </div>
                  <div className="progressbar">
                    <span className="progress-fill" style={{ width: `${(doneCount(book) / book.chapters.length) * 100}%` }} />
                  </div>
                  <YouTubeBox yt={book.flex?.yt} />
                  <div className="g-list">
                    {book.chapters.map((c, i) => {
                      const st = chapterStatus(book, i);
                      const p = book.progress?.[i];
                      return (
                        <button className="g-row" key={i} onClick={() => openChapter(i)}>
                          <span className="g-num">{String(i + 1).padStart(2, "0")}</span>
                          <span className="g-title">{c.title}</span>
                          {p?.score !== undefined && (
                            <span className="g-score">{p.score}/{p.total}</span>
                          )}
                          <span className={"chip " + st}>
                            {st === "done" ? tx("הושלם ✓") : st === "learning" ? tx("בלימוד") : tx("טרם נלמד")}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
 
              {/* ── מגילה רציפה (לימוד גמיש) ── */}
              {view === "scroll" && book && (
                <div className="scrolly-wrap">
                  {!flexResult && !flexLoading && (
                    <div className="search-row">
                      <input
                        className="search-input"
                        type="text"
                        placeholder={tx("🔍 חיפוש בספר — מילה או כמה מילים (למשל: כוונה עמידה)")}
                        value={searchQ}
                        onChange={(e) => setSearchQ(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                      />
                      <button className="mini-btn" onClick={runSearch}>{tx("חפש")}</button>
                      <button className="mini-btn" onClick={() => setNotesOpen((o) => !o)}>
                        📝 הערות ({Object.keys(book.notes || {}).length})
                      </button>
                      {searchHits !== null && (
                        <button className="mini-btn" onClick={closeSearch}>{tx("✕ סגור")}</button>
                      )}
                    </div>
                  )}

                  {searchHits !== null && !flexResult && !flexLoading && (
                    <div className="search-panel">
                      {searchHits.length === 0 ? (
                        <p className="search-none">{tx("לא נמצאו מופעים. נסה מילה אחרת או פחות מילים.")}</p>
                      ) : (
                        <>
                          <div className="search-bar">
                            <span className="search-count">{tx("{n} מופעים", { n: searchHits.length })}{checkedHits.length ? tx(" · נבחרו {n}", { n: checkedHits.length }) : ""}</span>
                            <button className="mini-btn" onClick={() => setCheckedHits([...searchHits])}>{tx("סמן הכול")}</button>
                            <button className="mini-btn" onClick={() => setCheckedHits([])}>{tx("נקה")}</button>
                            <button className="mini-btn gold-btn" onClick={useHitsAsSelection}>
                              {checkedHits.length ? tx("✦ צור קטע מהנבחרים") : tx("✦ צור קטע מכל התוצאות")}
                            </button>
                          </div>
                          <div className="search-list">
                            {searchHits.map((i) => (
                              <label key={i} className="search-hit">
                                <input
                                  type="checkbox"
                                  checked={checkedHits.includes(i)}
                                  onChange={() => toggleHit(i)}
                                />
                                <span
                                  className="search-snip"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    document.getElementById("para-" + i)?.scrollIntoView({ behavior: "smooth", block: "center" });
                                  }}
                                >
                                  {sentences[i].length > 120 ? sentences[i].slice(0, 120) + "…" : sentences[i]}
                                </span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {notesOpen && !flexResult && !flexLoading && (
                    <div className="search-panel">
                      {Object.keys(book.notes || {}).length === 0 ? (
                        <p className="search-none">{tx("אין עדיין הערות. סמן קטע ולחץ 📝 הערה.")}</p>
                      ) : (
                        <div className="search-list">
                          {Object.entries(book.notes || {})
                            .sort((a, b) => Number(a[0]) - Number(b[0]))
                            .map(([i, n]) => (
                              <div key={i} className="search-hit">
                                <span className="search-snip" onClick={() => jumpToSentence(Number(i))}>
                                  <b>[{noteNum(i)}] {noteVal(n)}</b>
                                  <br />
                                  <span style={{ color: "#8a8467" }}>
                                    „{(n?.src || sentences[Number(i)] || "").slice(0, 90)}…"
                                  </span>
                                </span>
                                <button className="mini-btn" onClick={() => editNote(Number(i))}>✎</button>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}

                  {trace && !flexResult && !flexLoading && (
                    <div className="trace-bar">
                      🟢 מקור: <b>{trace.term.length > 40 ? trace.term.slice(0, 40) + "…" : trace.term}</b>
                      <span> · {tx("{n} מופעים", { n: trace.hits.length })}</span>
                      <button className="mini-btn" onClick={() => {
                        const cur = trace.hits;
                        const pos = cur.indexOf(trace.at ?? cur[0]);
                        const next = cur[(pos + 1) % cur.length];
                        setTrace({ ...trace, at: next });
                        document.getElementById("para-" + next)?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}>{tx("⤵ הבא")}</button>
                      <button className="mini-btn" onClick={() => setTrace(null)}>{tx("✕ נקה")}</button>
                    </div>
                  )}

                  <p className="flex-hint">
                    {markMode === "bookmark"
                      ? tx("📍 לחץ על משפט כדי לקבוע: עד כאן קראתי.")
                      : markMode === "start"
                      ? tx("⟢ לחץ על המשפט שבו מתחיל הקטע.")
                      : markMode === "end"
                      ? tx("⟣ עכשיו לחץ על המשפט שבו מסתיים הקטע.")
                      : selectedText
                      ? tx("✓ סומן קטע ({n} תווים) — בחר למטה מה להפיק עליו.", { n: selectedText.length.toLocaleString() })
                      : tx("גלול וקרא חופשי. סמן קטע בגרירת עכבר, או לחץ ⟢ התחלה ואז בחר משפט התחלה ומשפט סוף.")}
                  </p>
 
                  {/* תוצאה שהופקה על הקטע */}
                  {quizPick === "flex" && !flexLoading && !flexResult && (
                    <div className="flex-panel">
                      <h3 style={{ margin: "0 0 10px" }}>{tx("כמה שאלות במבחן על הקטע?")}</h3>
                      <div className="quiz-size-row">
                        {[5, 10, 15, 20].map((n) => (
                          <button key={n} className="quiz-size-btn" onClick={() => { setQuizPick(null); generateFlex("quiz", n); }}>
                            {n}
                          </button>
                        ))}
                      </div>
                      <button className="mini-btn" onClick={() => setQuizPick(null)}>{tx("✕ ביטול")}</button>
                    </div>
                  )}

                  {flexLoading && (
                    <div className="flex-panel">
                      <div className="idle-mark spin" style={{ fontSize: "1.6rem" }}>✳</div>
                      <p>{tx("משדרים את {c} על הקטע שסימנת...", { c: flexLoading })}</p>
                    </div>
                  )}
                  {flexError && (
                    <div className="flex-panel">
                      <div className="err">{flexError}</div>
                    </div>
                  )}
                  {flexResult && !flexLoading && (
                    <div className="flex-panel">
                      <div className="flex-panel-head">
                        <strong>{tx(FLEX_ACTIONS.find((a) => a.id === flexResult.channel)?.label || "")} · {tx("על הקטע שסימנת")}</strong>
                        <button className="mini-btn" onClick={() => setFlexResult(null)}>{tx("✕ חזרה לטקסט")}</button>
                      </div>
                      <div dir={textDir}>
                      {flexResult.channel === "summary" && <SummaryView data={flexResult.data} question={openQ} layer={layerFor("flex:summary")} />}
                      {flexResult.channel === "concepts" && <ConceptsView data={flexResult.data} onTrace={traceToSource} layer={layerFor("flex:concepts")} />}
                      {flexResult.channel === "mindmap" && <MindmapView data={flexResult.data} />}
                      {flexResult.channel === "flow" && <FlowView data={flexResult.data} />}
                      {flexResult.channel === "quiz" && <QuizView data={flexResult.data} saved={null} onComplete={() => {}} />}
                      {flexResult.channel === "cards" && <CardsView data={flexResult.data} layer={layerFor("flex:cards")} />}
                      </div>
                    </div>
                  )}
 
                  {/* המגילה עצמה */}
                  {!flexResult && !flexLoading && (
                    <div className="scroll-text" dir={textDir} ref={scrollBodyRef} onMouseUp={onScrollMouseUp}>
                      {paraGroups.map(([start, count], pi) => (
                        <div key={pi}>
                          <p className={"scroll-para" + paraKind(sentences, paraGroups, pi)}>
                            {sentences.slice(start, start + count).map((s, j) => {
                              const i = start + j;
                              const inRange = rangeIdx && i >= rangeIdx[0] && i <= rangeIdx[1];
                              const isStart = selStart !== null && i === selStart && selEnd === null;
                              const isRead = book.flex?.upTo !== undefined && i <= book.flex.upTo;
                              return (
                                <span
                                  key={i}
                                  id={"para-" + i}
                                  className={
                                    "scroll-sent " +
                                    selCls(i, inRange) +
                                    (searchHits && searchHits.includes(i) ? "hit " : "") +
                                    (trace && trace.hits.includes(i) ? "trace-hit " : "") +
                                    (book.notes?.[i] ? "has-note " : "") +
                                    (flashIdx === i ? "flash " : "") +
                                    (isRead ? "was-read " : "") +
                                    (markMode ? "clickable" : "")
                                  }
                                  onClick={() => onSentenceClick(i)}
                                  onMouseEnter={selStart !== null && selEnd === null ? () => setHoverIdx(i) : undefined}
                                >
                                  {renderSentText(s, book.marks?.[i], wordSel && wordSel.i === i ? wordSel : null, vocOf(i))}
                                  {book.notes?.[i] && (
                                    <sup
                                      className="note-pin"
                                      title={noteVal(book.notes[i])}
                                      onClick={(e) => { e.stopPropagation(); editNote(i); }}
                                    >[{noteNum(i)}]</sup>
                                  )}{" "}
                                </span>
                              );
                            })}
                          </p>
                          {book.flex?.upTo !== undefined &&
                            book.flex.upTo >= start &&
                            book.flex.upTo < start + count && (
                              <div className="bookmark-line">{tx("📍 עד כאן קראת")}</div>
                            )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
 
              {/* ── מסך הלימוד (טלוויזיה) ── */}
              {view === "tv" && book && !channel && (
                <div className="idle open">
                  <div className="chapter-head">
                    <h2 className="guide-title">{cur.title}</h2>
                    {book.progress?.[chIdx]?.done && <span className="chip done">{tx("הושלם ✓")}</span>}
                  </div>
                  {prevSummary && (
                    <div className="recap">
                      <h4>{tx("בפרקים הקודמים…")}</h4>
                      <p>{prevSummary.short}</p>
                    </div>
                  )}
                  <p className="idle-hint">{tx("בחר ערוץ למטה. סיום המבחן מסמן את הפרק כהושלם.")}</p>
                </div>
              )}
 
              {view === "tv" && channel === "quiz" && quizPick === "tv" && !loading && (
                <div className="idle open">
                  <h2 className="guide-title">{tx("כמה שאלות במבחן?")}</h2>
                  <div className="quiz-size-row">
                    {[5, 10, 15, 20].map((n) => (
                      <button key={n} className="quiz-size-btn" onClick={() => { setQuizPick(null); generate("quiz", chIdx, n); }}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="idle-hint">{tx("מבחן ארוך יותר לוקח מעט יותר זמן להפקה.")}</p>
                </div>
              )}

              {view === "tv" && channel && loading && (
                <div className="idle">
                  <div className="idle-mark spin">✳</div>
                  <p>{tx("משדרים את {c} — {t}...", { c: tx(active.label), t: cur.title })}</p>
                </div>
              )}
 
              {view === "tv" && channel && !loading && error && (
                <div className="idle">
                  <div className="err big">{error}</div>
                  <button className="broadcast" onClick={() => generate(channel, chIdx)}>{tx("נסה שוב")}</button>
                </div>
              )}
 
              {view === "tv" && channel === "read" && !loading && cur && (
                <div className="read" key={key(chIdx, "read")}>
                  <YouTubeBox yt={book.flex?.yt} />
                  <h2 className="read-title">{cur.title}</h2>
                  <p className="flex-hint read-mark-hint">
                    {selStart !== null && selEnd === null
                      ? tx("⟣ עכשיו לחץ על המשפט שבו מסתיים הקטע.")
                      : wordSel
                      ? tx("✓ סומנו מילים — בחר בסרגל: מרקר, הדגשה או 📝 הערה.")
                      : rangeIdx
                      ? tx("✓ סומן קטע — בחר בסרגל: מרקר, הדגשה או 📝 הערה.")
                      : tx("קרא חופשי. גרור על מילה או כמה מילים לסימון עדין — או לחץ על משפט התחלה ואז על משפט סוף.")}
                  </p>
                  {KABBALAH && vfParas.length > 0 && (
                    <div className="vf-box" dir="rtl">
                      <div className="vf-row">
                        <b>{tx("🔍 אימות מול מקור")}</b>
                        <select className="scan-mode-select" value={vfSel} onChange={(e) => setVfP(+e.target.value)} aria-label={tx("פרשה")}>
                          <option value={-1}>{tx("המקור: זהה לבד")}</option>
                          {ZOHAR_PARSHIOT.map(([en, he], i) => <option key={en} value={i}>{he}</option>)}
                        </select>
                        <button className="mark-btn" onClick={() => vfRun()} disabled={!!vfBusy}>{vfBusy || (vfData ? tx("אמת שוב מול ספריא") : tx("אמת מול ספריא"))}</button>
                        {vfData && <button className="mark-btn" onClick={vfAuto} disabled={!!vfBusy}>{tx("🔎 זהה את המקור לבד")}</button>}
                        {vfState && vfState.total > 0 && !vfLow && (
                          <>
                            <span className="vf-bar" aria-hidden="true"><i style={{ width: Math.round((vfState.ok / vfState.total) * 100) + "%" }} /></span>
                            <span>{tx("{p}% אומת · {n} לבדיקה", { p: Math.floor((vfState.ok / vfState.total) * 100), n: vfState.items.reduce((t, it) => t + it.diffs.length, 0) })}</span>
                          </>
                        )}
                      </div>
                      {vfLow && <div style={{ color: "#a33", fontWeight: 700, marginTop: 6 }}>{tx("ההתאמה למקור שנבחר נמוכה מאוד ({p}%) — כנראה זו לא הפרשה הנכונה, ולכן לא מוצעים תיקונים. בחר פרשה אחרת, או לחץ \"🔎 זהה את המקור לבד\".", { p: Math.floor(vfRatio * 100) })}</div>}
                      {vfState && vfData && !vfLow && <div style={{ opacity: 0.75, marginTop: 4 }}>{tx("המקור: ספריא · זוהר {he} · אותיות {a}–{b}. מה שמסומן באדום בדף לא תואם למקור.", { he: vfData.he, a: vfState.items[0]?.label, b: vfState.items[vfState.items.length - 1]?.label })}</div>}
                      {vfState && vfState.items.some((it) => it.missing) && <div style={{ color: "#a33", marginTop: 4 }}>{tx("לא נמצא מקור לאותיות: ") + vfState.items.filter((it) => it.missing).map((it) => it.label).join(", ")}</div>}
                      {vfState && !vfLow && (
                        <ul className="vf-list">
                          {vfState.items.flatMap((it) => it.diffs.map((d) => (
                            <li className="vf-item" key={d.id + ":" + d.a0}>
                              <span>{tx("אות")} {it.label}</span>
                              {d.got ? <span>{tx("נסרק:")} <b className="vf-got">{d.got}</b></span> : <span>{tx("חסר בסריקה, אחרי")} <b>{it.words[d.a0 - 1] || "—"}</b></span>}
                              {d.want ? <span>{tx("במקור:")} <b className="vf-want">{d.want}</b></span> : <span>{tx("אין במקור")}</span>}
                              {vfEdit?.id === d.id ? (
                                <>
                                  <input className="vf-in" dir="rtl" value={vfEdit.val} autoFocus onChange={(e) => setVfEdit({ id: d.id, val: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") vfFix(it, d, vfEdit.val); }} aria-label={tx("תיקון ביד")} />
                                  <button className="mark-btn" onClick={() => vfFix(it, d, vfEdit.val)}>{tx("שמור")}</button>
                                  <button className="mark-btn" onClick={() => setVfEdit(null)}>{tx("בטל")}</button>
                                </>
                              ) : (
                                <>
                                  <button className="mark-btn" onClick={() => vfFix(it, d, d.want)}>{d.want ? tx("✓ כמו במקור") : tx("✓ מחק")}</button>
                                  <button className="mark-btn" onClick={() => vfKeep(d)}>{tx("השאר כמו בספר שלי")}</button>
                                  <button className="mark-btn" onClick={() => setVfEdit({ id: d.id, val: d.got || d.want })}>{tx("✎ תקן ביד")}</button>
                                </>
                              )}
                            </li>
                          )))}
                        </ul>
                      )}
                      {vfState && vfState.total > 0 && vfState.items.every((it) => !it.diffs.length && !it.missing) && <div style={{ color: "#2f8f6b", fontWeight: 700, marginTop: 6 }}>{tx("✓ לשון הזוהר אומתה במלואה.")}{vfState.items.some((it) => it.kept) ? " " + tx("(כולל מקומות שבחרת להשאיר כמו בספר שלך)") : ""}</div>}
                    </div>
                  )}
                  {layerOn && (rangeIdx || wordSel) && (
                    <FloatingMarkBar anchorIdx={wordSel ? wordSel.i : rangeIdx[1]} word={!!wordSel}>
                      <span className="mark-title">{tx("✍️ שכבת הלומד:")}</span>
                      <button className="mark-btn" style={{ fontWeight: 800 }} onClick={() => applyMark({ b: 1 })}>{tx("B מודגש")}</button>
                      <button className="mark-btn" style={{ textDecoration: "underline" }} onClick={() => applyMark({ u: 1 })}>{tx("U קו תחתון")}</button>
                      <button className="mark-btn hl-y" onClick={() => applyMark({ hl: "y" })}>{tx("מרקר")}</button>
                      <button className="mark-btn hl-g" onClick={() => applyMark({ hl: "g" })}>{tx("מרקר")}</button>
                      <button className="mark-btn hl-p" onClick={() => applyMark({ hl: "p" })}>{tx("מרקר")}</button>
                      <button className="mark-btn" onClick={addNote}>{tx("📝 הערה")}</button>
                      <button className="mark-btn" onClick={() => applyMark(null)}>{tx("✕ נקה עיצוב")}</button>
                      <button className="mark-btn" onClick={clearSelection}>{tx("✕ בטל סימון")}</button>
                    </FloatingMarkBar>
                  )}
                  {noteEditor}
                  {readerOn && (() => {
                    const [rs, re] = chapterRanges[chIdx] || [0, 0];
                    const chParas = paraGroups.filter(([start]) => start >= rs && start < re);
                    const items = [];
                    chParas.forEach(([start, count], pi) => { const kind = paraKind(sentences, chParas, pi).trim(); for (let i = start; i < start + count; i++) items.push({ i, kind, text: sentences[i] }); });
                    return <Reader key={key(chIdx, "reader")} lang={bookLang} items={items} question={openQ} startAt={readerStart} onPos={setReadPos} onClose={() => { setReaderOn(false); setReadPos(null); }}
                      glossOn={glossOn} onGloss={setGlossOn} glossBusy={glossBusy}
                      store={`${book.id}:${chIdx}`} uid={cloudUser?.id} ttsMeta={book.flex?.tts || {}} onTtsMeta={(k, m) => { const b = bookRef.current; if (b) persist({ ...b, flex: { ...(b.flex || {}), tts: { ...(b.flex?.tts || {}), [k]: m } } }); }} />;
                  })()}
                  {(biMode !== "off" || biLang !== bookLang || share) && (
                    <div className="bi-row" dir={langDir()}>
                      <span className="bi-lbl">{tx("🌐 הדף בשפה שלי:")}</span>
                      <select className="scan-mode-select" value={biLang} onChange={(e) => setBiLang(e.target.value)} aria-label={tx("🌐 הדף בשפה שלי:")}>{LANGS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
                      {[["off", "כבוי"], ["both", "לצד המקור"], ["only", "רק התרגום"]].map(([id, label]) => <button key={id} className={"mark-btn" + (biMode === id ? " on" : "")} onClick={() => setBiMode(id)}>{tx(label)}</button>)}
                      {share && (share.hostId === myUid
                        ? <label className="bi-pay">{tx("התרגום על חשבון:")} <select className="scan-mode-select" value={share.pay || "host"} onChange={(e) => setPay(e.target.value)}>
                            <option value="host">{tx("שלי (היוזם)")}</option><option value="each">{tx("כל אחד לעצמו")}</option><option value="guest">{tx("המתארח")}</option>
                          </select></label>
                        : <span className="bi-pay">{tx("התרגום על חשבון:")} <b>{tx((share.pay || "host") === "host" ? "היוזם" : share.pay === "each" ? "כל אחד לעצמו" : "המתארח")}</b></span>)}
                      {biMode !== "off" && biLang === bookLang && <span className="bi-msg">{tx("הספר כבר כתוב בשפה הזאת.")}</span>}
                      {biMsg && biWanted && !biHave && <span className="bi-msg">{biMsg}</span>}
                    </div>
                  )}
                  <div className={"read-body read-sents" + (biWanted && biHave && biMode === "only" ? " bi-only" : "")} dir={textDir} onMouseUp={onReadMouseUp}>
                    {(() => {
                      const [rs, re] = chapterRanges[chIdx] || [0, 0];
                      const chParas = paraGroups.filter(([start]) => start >= rs && start < re);
                      if (!chParas.length) return cur.text; // ביטחון: אם אין משפטים — הטקסט כמו שהוא
                      const biT = biWanted ? book.results?.[key(chIdx, "trans:" + biLang)]?.t : null;
                      const biOk = Array.isArray(biT) && biT.length === re - rs;
                      return chParas.map(([start, count], pi) => [
                        <p className={"scroll-para" + paraKind(sentences, chParas, pi)} key={pi}>
                          {sentences.slice(start, start + count).map((s, j) => {
                            const i = start + j;
                            const inRange = rangeIdx && i >= rangeIdx[0] && i <= rangeIdx[1];
                            const isStart = selStart !== null && i === selStart && selEnd === null;
                            const mk = book.marks?.[i];
                            const pl = peerLayer(i);
                            return (
                              <span
                                key={i}
                                data-si={i}
                                className={
                                  "scroll-sent clickable " +
                                  selCls(i, inRange) +
                                  (book.notes?.[i] ? "has-note " : "") +
                                  (readPos && readPos.i === i ? "kara-now " : "") +
                                  (pl ? pl.cls : "")
                                }
                                style={pl ? { "--peer": pl.color } : undefined}
                                title={pl?.title || undefined}
                                onClick={() => (readerOn ? setReaderStart({ i, t: Date.now() }) : onReadSentClick(i))}
                                onMouseEnter={selStart !== null && selEnd === null ? () => setHoverIdx(i) : undefined}
                              >
                                {pl?.here && <span className="peer-cursor" style={{ background: pl.here.color }} title={tx("{name} כאן", { name: pl.here.name })}>{pl.here.name}</span>}
                                {renderSentText(s, mk, wordSel && wordSel.i === i ? wordSel : null, vocOf(i), readPos && readPos.i === i ? readPos.c : null, glossOf(i))}
                                {pl?.note && <sup className="note-pin peer-note" style={{ color: pl.note.color }} title={pl.note.name + ": " + pl.note.t}>💬</sup>}
                                {book.notes?.[i] && (
                                  <sup
                                    className="note-pin"
                                    title={noteVal(book.notes[i])}
                                    onClick={(e) => { e.stopPropagation(); editNote(i); }}
                                  >[{noteNum(i)}]</sup>
                                )}{" "}
                              </span>
                            );
                          })}
                        </p>,
                        biOk && (
                          <p className="scroll-para bi-para" key={"t" + pi} dir={biLang === "he" || biLang === "ar" ? "rtl" : "ltr"} lang={biLang}>
                            {Array.from({ length: count }, (_, j) => start + j).map((i) => {
                              const mk = book.marks?.[i], pl = peerLayer(i);
                              const inRange = rangeIdx && i >= rangeIdx[0] && i <= rangeIdx[1];
                              const mine = mk && (mk.hl || mk.b || mk.u || (mk.w && mk.w.length));
                              return (
                                <span key={i} data-tsi={i}
                                  className={"bi-sent " + selCls(i, inRange) + (mine ? "bi-mine " + (mk.hl ? "hl-" + mk.hl + " " : "") : "") + (book.notes?.[i] ? "has-note " : "") + (readPos && readPos.i === i ? "kara-now " : "") + (pl ? pl.cls : "")}
                                  style={pl ? { "--peer": pl.color } : undefined} title={pl?.title || undefined}
                                  onClick={() => (readerOn ? setReaderStart({ i, t: Date.now() }) : onReadSentClick(i))}>
                                  {pl?.here && <span className="peer-cursor" style={{ background: pl.here.color }}>{pl.here.name}</span>}
                                  {biT[i - rs]}
                                  {pl?.note && <sup className="note-pin peer-note" style={{ color: pl.note.color }} title={pl.note.name + ": " + pl.note.t}>💬</sup>}
                                  {book.notes?.[i] && <sup className="note-pin" title={noteVal(book.notes[i])} onClick={(e) => { e.stopPropagation(); editNote(i); }}>[{noteNum(i)}]</sup>}{" "}
                                </span>
                              );
                            })}
                          </p>
                        ),
                      ]);
                    })()}
                  </div>
                  <p className="read-hint">{tx("אחרי שקראת — בחר ערוץ למטה כדי לקבל סיכום, מבחן, כרטיסיות ועוד. הסימונים וההערות נשמרים ומופיעים גם במגילה.")}</p>
                </div>
              )}
 
              {view === "tv" && channel === "tts" && !loading && cur && (
                <TTSView key={key(chIdx, "tts")} text={cur.text} question={openQ} />
              )}
 
              {view === "tv" && channel && channel !== "tts" && channel !== "read" && !loading && !error && data && (
                <div dir={textDir}>
                  {channel === "summary" && <SummaryView key={key(chIdx, channel)} data={data} question={openQ} layer={layerFor(chIdx + ":summary")} />}
                  {channel === "concepts" && <ConceptsView data={data} onTrace={traceToSource} layer={layerFor(chIdx + ":concepts")} />}
                  {channel === "mindmap" && <MindmapView data={data} />}
                  {channel === "flow" && <FlowView data={data} />}
                  {channel === "quiz" && (
                    <QuizView
                      key={key(chIdx, channel)}
                      data={data}
                      saved={book.progress?.[chIdx]?.score !== undefined ? book.progress[chIdx] : null}
                      onComplete={(s, t) => markDone(chIdx, s, t)}
                    />
                  )}
                  {channel === "cards" && <CardsView key={key(chIdx, channel)} data={data} layer={layerFor(chIdx + ":cards")} />}
                  {channel === "trans" && <TransView key={key(chIdx, "trans:" + transTo)} text={cur.text} data={data} lang={transTo} onLang={(l) => { if (loading) return; setTransLang(l); generateTrans(chIdx, l); }} />}
                </div>
              )}
            </div>
 
          </div>
          <div className="tv-chin with-keys">
            <span className={"power-led " + (loading || flexLoading ? "live" : "")} />
            {view === "scroll" && book && (
              /* המגילה: המקשים בתוך המסגרת, בסנטר הטלוויזיה — קטנים, גדלים בנגיעה */
              <span className="chin-keys">
                {flexResult ? (
                  <button className="chin-key gold" onClick={() => setFlexResult(null)} title={tx("חזרה לטקסט")}><span className="ck-ic">↩</span><span className="ck-l">{tx("חזרה לטקסט")}</span></button>
                ) : !flexLoading && (
                  <>
                    <button className={"chin-key" + (markMode === "bookmark" ? " active" : "")} onClick={() => setMarkMode(markMode === "bookmark" ? null : "bookmark")} title={tx("סימנייה")}><span className="ck-ic">📍</span><span className="ck-l">{tx("סימנייה")}</span></button>
                    <button className={"chin-key" + (markMode === "start" ? " active" : "")} onClick={() => setMarkMode(markMode === "start" ? null : "start")} title={tx("התחלה")}><span className="ck-ic">⟢</span><span className="ck-l">{tx("התחלה")}</span></button>
                    <button className={"chin-key" + (markMode === "end" ? " active" : "")} onClick={() => setMarkMode(markMode === "end" ? null : "end")} title={tx("סוף")}><span className="ck-ic">⟣</span><span className="ck-l">{tx("סוף")}</span></button>
                    {(selectedText || rangeIdx) && <button className="chin-key" onClick={clearSelection} title={tx("נקה סימון")}><span className="ck-ic">✕</span><span className="ck-l">{tx("נקה סימון")}</span></button>}
                    {selectedText && <span className="chin-sep" />}
                    {selectedText && FLEX_ACTIONS.map((a) => (
                      <button key={a.id} className="chin-key gold" onClick={() => generateFlex(a.id)} title={tx(a.label)}><span className="ck-ic">✦</span><span className="ck-l">{tx(a.label)}</span></button>
                    ))}
                  </>
                )}
                <button className="chin-key" onClick={backToGuide} title={tx("חזרה ללוח השידורים")}><span className="ck-ic">↩</span><span className="ck-l">{tx("ללוח")}</span></button>
              </span>
            )}
            <div className={"chin-slot" + (view === "tv" && book ? " tvkeys" : "")}>
      {/* לוח מקשים — משתנה לפי ההקשר */}
      {/* ── שערי המציאות: קלטים גלובליים — המצלמה והמיקרופון זמינים מכל מסך ── */}
      <input
        id="media-transcribe-input"
        ref={mediaRef}
        type="file"
        accept="audio/*,video/*,.mp3,.m4a,.wav,.aac,.ogg,.mp4,.mov"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", clip: "rect(0 0 0 0)" }}
        onChange={onMediaPicked}
      />
      <input
        id="camera-scan-input"
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", clip: "rect(0 0 0 0)" }}
        onChange={onSmartPicked}
      />
      <input
        id="video-capture-input"
        type="file"
        accept="video/*"
        capture="environment"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", clip: "rect(0 0 0 0)" }}
        onChange={onMediaPicked}
      />

      {nikudMsg && <div className="nikud-msg" role="status">נִ · {nikudMsg}</div>}
      {view === "library" && (
        <div className="deck">
          <button className="ch-key gold" onClick={() => { setError(null); setView("intake"); }} disabled={!!fileBusy}>
            <span className="key-num">＋</span>
            <span className="key-label">{tx("ספר חדש")}</span>
          </button>
          <button className="ch-key share" onClick={joinByCode} title={tx("הצטרפות ללימוד משותף שחבר פתח — עם הקוד שלו")}>
            <span className="key-num">🕯</span>
            <span className="key-label">{tx("הצטרף עם קוד")}</span>
          </button>
          <label htmlFor="camera-scan-input" className="ch-key green" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
            <span className="key-num">📷</span>
            <span className="key-label">{tx("צלם דף")}</span>
          </label>
          <label htmlFor="video-capture-input" className="ch-key media" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
            <span className="key-num">🎥</span>
            <span className="key-label">{tx("צלם וידאו")}</span>
          </label>
          {!recOn ? (
            <button className="ch-key media" onClick={startRec} disabled={!!fileBusy}>
              <span className="key-num">🎙</span>
              <span className="key-label">{tx("הקלט שיעור")}</span>
            </button>
          ) : (
            <button className="ch-key rec-on" onClick={stopRec}>
              <span className="key-num">⏹</span>
              <span className="key-label">{tx("עצור")} {Math.floor(recSec / 60)}:{String(recSec % 60).padStart(2, "0")}</span>
            </button>
          )}
          <label htmlFor="media-transcribe-input" className="ch-key media" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
            <span className="key-num">🎬</span>
            <span className="key-label">{tx("אודיו/וידאו")}</span>
          </label>
          {KABBALAH && <button
            className="ch-key shelf"
            onClick={openShelf}
            disabled={!!fileBusy}
            title={tx("ארון הספרים — 70 ספרי מקור, לייבוא ללימוד")}
          >
            <span className="key-num">📚</span>
            <span className="key-label">{tx("ארון הספרים")}</span>
          </button>}
        </div>
      )}

      {view === "shelf" && (
        <div className="deck">
          {shelfPick && shelfSegs && (
            <button className="ch-key" onClick={() => { setShelfPick(null); setShelfSegs(null); setShelfOpts([]); setShelfQ(""); }} disabled={!!fileBusy}>
              <span className="key-num">📚</span>
              <span className="key-label">{tx("כל הספרים")}</span>
            </button>
          )}
          <a className="ch-key shelf" href={SHELF_URL} target="_blank" rel="noopener noreferrer" title={tx("פותח את הארון בלשונית חדשה")}>
            <span className="key-num">↗</span>
            <span className="key-label">{tx("פתח את הארון")}</span>
          </a>
          <button className="ch-key newtext" onClick={() => { backToLibrary(); if (!index.length) setView("intake"); }} disabled={!!fileBusy}>
            <span className="key-num">↩</span>
            <span className="key-label">{tx("חזרה לספרייה")}</span>
          </button>
        </div>
      )}

      {view === "intake" && (
        <div className="deck">
          <button className="ch-key gold" onClick={createBook} disabled={!!fileBusy}>
            <span className="key-num">▸</span>
            <span className="key-label">{tx("שדר טקסט")}</span>
          </button>
          <button className="ch-key" onClick={() => fileRef.current?.click()} disabled={!!fileBusy}>
            <span className="key-num">⬆</span>
            <span className="key-label">{tx("קבצים")}</span>
          </button>
          <label htmlFor="photo-ocr-input" className="ch-key green" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
            <span className="key-num">📷</span>
            <span className="key-label">{tx("צילומים OCR")}</span>
          </label>
          <label htmlFor="smart-scan-input" className="ch-key smart" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
            <span className="key-num">📸</span>
            <span className="key-label">{tx("דף חכם AI")}</span>
          </label>
          <label htmlFor="media-transcribe-input" className="ch-key media" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
            <span className="key-num">🎬</span>
            <span className="key-label">{tx("שיעור מוקלט")}</span>
          </label>
          <button className="ch-key share" onClick={joinByCode} title={tx("הצטרפות ללימוד משותף שחבר פתח — עם הקוד שלו")}>
            <span className="key-num">🕯</span>
            <span className="key-label">{tx("הצטרף עם קוד")}</span>
          </button>
          {index.length > 0 && (
            <button className="ch-key newtext" onClick={backToLibrary} disabled={!!fileBusy}>
              <span className="key-num">↩</span>
              <span className="key-label">{tx("חזרה לספרייה")}</span>
            </button>
          )}
        </div>
      )}
 
      {view === "tv" && book && (
        <>
          {keysOpen && <div className="keys-shade" onClick={() => setKeysOpen(false)} />}
          <div className={"deck ch-deck" + (keysOpen ? " open" : "")}>
            {CHANNELS.map((c) => {
              const isOn = c.id === "tts" ? (readerOn && channel === "read") : channel === c.id;
              const cached = (c.id === "tts" || c.id === "read") ? isOn : c.id === "trans" ? Object.keys(book.results || {}).some((k) => k.startsWith(chIdx + ":trans:")) : !!book.results[key(chIdx, c.id)];
              return (
                <button
                  key={c.id}
                  className={"ch-key " + (isOn ? "active " : "") + (cached ? "cached " : "")}
                  disabled={loading}
                  onClick={() => { setKeysOpen(false); tune(c.id); }}
                >
                  <span className="key-num">{c.num}</span>
                  <span className="key-label">{tx(c.label)}</span>
                </button>
              );
            })}
            {!book.progress?.[chIdx]?.done && (
              <button className="ch-key newtext sheet-only" onClick={() => { setKeysOpen(false); markDone(chIdx); }} disabled={loading}>
                <span className="key-num">✓</span>
                <span className="key-label">{tx("סמן כהושלם")}</span>
              </button>
            )}
            <button className="ch-key newtext sheet-only" onClick={() => setKeysOpen(false)} aria-label={tx("סגור")}>
              <span className="key-num">▾</span>
              <span className="key-label">{tx("סגור")}</span>
            </button>
          </div>
          <div className="deck nav-deck">
            <button className="ch-key newtext keys-toggle" onClick={() => setKeysOpen(true)} aria-expanded={keysOpen} aria-label="00–09">
              <span className="key-num">▴</span>
              <span className="key-label" dir="ltr">00–09</span>
            </button>
            {!book.progress?.[chIdx]?.done && (
              <button className="ch-key newtext wide-only" onClick={() => markDone(chIdx)} disabled={loading}>
                <span className="key-num">✓</span>
                <span className="key-label">{tx("סמן כהושלם")}</span>
              </button>
            )}
            <button className="ch-key newtext" onClick={backToGuide} disabled={loading}>
              <span className="key-num">↩</span>
              <span className="key-label lbl-long">{tx("חזרה ללוח השידורים")}</span>
              <span className="key-label lbl-short">{tx("ללוח")}</span>
            </button>
          </div>
        </>
      )}
 
      {view === "guide" && book && (
        <div className="deck">
          {nextUnfinished >= 0 && (
            <button className="ch-key gold" onClick={() => openChapter(nextUnfinished)}>
              <span className="key-num">▸</span>
              <span className="key-label">{tx("המשך לימוד")}</span>
            </button>
          )}
          <button className="ch-key green" onClick={openScroll}>
            <span className="key-num">📜</span>
            <span className="key-label">{tx("מגילה — לימוד גמיש")}</span>
          </button>
          {talkCount(book) >= MIRROR_MIN && (
            <button className="ch-key mirror" onClick={() => openMirror(book.id)} title={tx("שיקוף — השיחה שלך עם הספר, בקול")}>
              <span className="key-num">🎧</span>
              <span className="key-label">{tx("שיקוף")}</span>
            </button>
          )}
          <button className="ch-key share" onClick={share ? backToShare : startShare} title={tx("לימוד משותף — אותו דף, שני לומדים, בזמן אמת")}>
            <span className="key-num">🕯</span>
            <span className="key-label">{share ? tx("חזרה ללימוד המשותף") : tx("לימוד משותף")}</span>
          </button>
          <button className="ch-key newtext" onClick={backToLibrary}>
            <span className="key-num">↩</span>
            <span className="key-label">{tx("חזרה לספרייה")}</span>
          </button>
        </div>
      )}
      {shareMsg && <p className="share-msg share-toast" dir={langDir()} role="status">{shareMsg} <button className="mark-btn" onClick={() => setShareMsg("")}>✕</button></p>}

      {view === "mirror" && book && (
        <div className="deck">
          <button className="ch-key" onClick={() => { flick(); setView("guide"); }}>
            <span className="key-num">📖</span>
            <span className="key-label">{tx("לוח השידורים של הספר")}</span>
          </button>
          <button className="ch-key green" onClick={openScroll}>
            <span className="key-num">📜</span>
            <span className="key-label">{tx("מגילה — להוסיף הערות")}</span>
          </button>
          <button className="ch-key newtext" onClick={backToLibrary}>
            <span className="key-num">↩</span>
            <span className="key-label">{tx("חזרה לספרייה")}</span>
          </button>
        </div>
      )}
 
      {view === "scroll" && book && (
        <>
          {layerOn && selectedText && !flexResult && !flexLoading && ((selStart !== null && selEnd !== null) || wordSel) && (
            <FloatingMarkBar anchorIdx={wordSel ? wordSel.i : Math.max(selStart, selEnd)} word={!!wordSel}>
              <span className="mark-title">{tx("✍️ שכבת הלומד:")}</span>
              <button className="mark-btn" style={{ fontWeight: 800 }} onClick={() => applyMark({ b: 1 })}>{tx("B מודגש")}</button>
              <button className="mark-btn" style={{ textDecoration: "underline" }} onClick={() => applyMark({ u: 1 })}>{tx("U קו תחתון")}</button>
              <button className="mark-btn hl-y" onClick={() => applyMark({ hl: "y" })}>{tx("מרקר")}</button>
              <button className="mark-btn hl-g" onClick={() => applyMark({ hl: "g" })}>{tx("מרקר")}</button>
              <button className="mark-btn hl-p" onClick={() => applyMark({ hl: "p" })}>{tx("מרקר")}</button>
              <button className="mark-btn" onClick={addNote}>{tx("📝 הערה")}</button>
              <button className="mark-btn trans-btn" onClick={translateSel}>א⇄ע תרגם</button>
              <button className="mark-btn" onClick={() => applyMark(null)}>{tx("✕ נקה עיצוב")}</button>
            </FloatingMarkBar>
          )}
          {transBubble}
          {noteEditor}

        </>
      )}
            </div>
            <span className="brand">LOMED·TV</span>
            <span className="grille"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></span>
          </div>
        </div>
        <div className="tv-stand"><span className="tv-neck" /><span className="tv-base" /></div>
      </div>

      {/* ── מתחת לטלוויזיה: לוחות המקשים. המסגרת קבועה; רק התוכן בתוך המסך נגלל (צ'אט 20) ── */}
    </div>
  );
}
 
/* ─── עיצוב ─── */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;600;800&family=IBM+Plex+Mono:wght@400;600&family=Frank+Ruhl+Libre:wght@500;700;900&display=swap');
 
:root{
  --studio:#0d1226; --studio-2:#141a33;
  --amber:#f2a33c; --amber-deep:#b96f14;
  --teal:#3fd6c4;
  --key:#1a2140; --key-edge:#2c3560;
  --paper:#f5f2e9; --ink:#232323; --ink-soft:#5a5647;
}
*{box-sizing:border-box;margin:0;padding:0}
.studio{
  min-height:100vh;
  background:
    radial-gradient(70% 55% at 50% 38%,rgba(246,205,140,.07),transparent 70%),
    radial-gradient(120% 90% at 50% 0%,var(--studio-2),var(--studio) 70%),
    linear-gradient(180deg,#0f1530,#080b1a);
  font-family:'Heebo',sans-serif;color:#e8eaf4;
  display:flex;flex-direction:column;align-items:center;padding:28px 16px 60px;
  /* מובייל: לא להיכנס מתחת ל-notch ולפס הבית */
  padding-top:calc(28px + env(safe-area-inset-top,0px));padding-bottom:calc(60px + env(safe-area-inset-bottom,0px));
}
/* ── הבמה הקבועה (צ'אט 20): המסגרת, הכותרת והמקשים ממלאים את המסך ולא זזים; רק התוכן שבתוך מסך הטלוויזיה נגלל ── */
.studio{height:100vh;height:100dvh;min-height:0;overflow:hidden;padding:14px 16px 10px;
  padding-top:calc(12px + env(safe-area-inset-top,0px));padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))}
.power-on{position:fixed;inset:0;z-index:900;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:var(--studio);animation:poweron 1.9s ease forwards;pointer-events:none}
.power-on h1{font-size:2.2rem;font-weight:800;letter-spacing:.5px}
.power-on .mast-dot{width:12px;height:12px}
@keyframes poweron{0%{opacity:0}12%{opacity:1}70%{opacity:1}100%{opacity:0;visibility:hidden}}
.studio>.tv{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;width:auto;max-width:100%;aspect-ratio:16/10}
@media (max-width:900px){.studio>.tv{width:100%;aspect-ratio:auto}}
.bezel{padding:clamp(12px,1.4vw,26px);border-radius:clamp(18px,2vw,34px)}
.tv-neck{width:clamp(90px,8vw,160px)}
.tv-base{width:clamp(260px,22vw,440px)}
.studio>.tv .bezel{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.studio>.tv .screen{flex:1 1 auto;min-height:0}
.studio>.tv .screen-body{max-height:none;-webkit-overflow-scrolling:touch}
.studio>.tv .tv-chin,.studio>.tv .tv-stand{flex:none}
/* ── 🎨 רקעים (צ'אט 21): data-bg על html. ברירת המחדל = לילה. ברקעים בהירים הטלוויזיה מטילה צל רך במקום הילה ── */
:root[data-bg="silver"] .studio{background:radial-gradient(90% 70% at 50% 30%,#fbfcfe,#dfe3ea 70%,#c9ced8);color:#1c2233}
:root[data-bg="cream"] .studio{background:radial-gradient(90% 70% at 50% 30%,#fcf8ef,#ece3cf 70%,#dccfb4);color:#2a2418}
:root[data-bg="sky"] .studio{background:radial-gradient(90% 70% at 50% 30%,#f3f8fe,#d6e3f3 70%,#bcd0ea);color:#182236}
:root[data-bg="sage"] .studio{background:radial-gradient(90% 70% at 50% 30%,#f4f8f3,#d7e2d8 70%,#bfd0c2);color:#1c261f}
:root[data-bg="graphite"] .studio{background:radial-gradient(90% 70% at 50% 30%,#5a6070,#3a3f4b 70%,#262a33);color:#e8eaf4}
:root[data-bg="silver"] .bezel,:root[data-bg="cream"] .bezel,:root[data-bg="sky"] .bezel,:root[data-bg="sage"] .bezel{box-shadow:0 30px 70px rgba(20,25,45,.35),0 0 0 1px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.10),inset 0 -2px 0 rgba(0,0,0,.45)}
:root[data-bg="silver"] .bezel::after,:root[data-bg="cream"] .bezel::after,:root[data-bg="sky"] .bezel::after,:root[data-bg="sage"] .bezel::after{background:radial-gradient(60% 55% at 50% 60%,rgba(20,25,45,.18),transparent 75%)}
:root[data-bg="silver"] .power-on,:root[data-bg="cream"] .power-on,:root[data-bg="sky"] .power-on,:root[data-bg="sage"] .power-on{background:#eef0f4;color:#1c2233}
:root[data-bg="silver"] .studio::before,:root[data-bg="cream"] .studio::before,:root[data-bg="sky"] .studio::before,:root[data-bg="sage"] .studio::before{background:#e4e7ee}
.bg-pop{position:absolute;top:calc(100% + 6px);left:10px;z-index:40;background:#fff8e6;color:#3a2c14;border:1.5px solid #e0c98f;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-family:'Heebo',sans-serif;white-space:normal}
.bg-swatches{display:flex;flex-wrap:wrap;gap:8px;max-width:300px}
.bg-sw{width:88px;height:48px;border-radius:10px;border:2px solid #d8c7a0;cursor:pointer;display:flex;align-items:flex-end;justify-content:center;padding:3px;font-family:'Heebo',sans-serif;font-size:.68rem;color:#241a08}
.bg-sw span{background:rgba(255,255,255,.85);border-radius:6px;padding:1px 6px;line-height:1.3}
.bg-sw.on{border-color:var(--amber);box-shadow:0 0 0 2px var(--amber)}
.bg-sw:hover{transform:scale(1.05)}
@media (max-width:640px){.bg-pop{left:8px;right:8px}.bg-swatches{max-width:none}}
/* ── השלט (צ'אט 21): כל המקשים יושבים בסנטר הטלוויזיה, בתוך המסגרת — קטנים ונקיים, גדלים בנגיעה ── */
.chin-slot{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}
.chin-slot .deck{margin:0;gap:6px;max-width:none}
.chin-slot .ch-key{flex-direction:row;gap:5px;min-width:0;border-radius:999px;padding:4px 10px;font-size:.74rem;line-height:1;white-space:nowrap;transition:transform .12s,font-size .12s,border-color .15s;background:linear-gradient(180deg,#212844,var(--key));border-color:var(--key-edge);color:#cfd3e6}
.chin-slot .ch-key .key-num{font-size:.7rem;color:var(--teal);letter-spacing:0}
.chin-slot .ch-key .key-label{font-size:.76rem;font-weight:600;color:#dfe3f3}
.chin-slot .ch-key:hover:not(:disabled),.chin-slot .ch-key:focus-visible{transform:scale(1.18);border-color:var(--amber);z-index:2}
.chin-slot .ch-key:active:not(:disabled){transform:scale(1.1)}
.chin-slot .ch-key.active{border-color:var(--amber);box-shadow:0 0 0 1px var(--amber) inset}
.chin-slot .ch-key.active .key-label{color:#fff}
.chin-slot .ch-key.cached:not(.active) .key-num{color:var(--amber-soft,#f8c778)}
.chin-slot .ch-key.gold,.chin-slot .ch-key.gold .key-num,.chin-slot .ch-key.gold .key-label{color:#241a08}
.chin-slot .ch-key.gold{background:linear-gradient(180deg,#f5b95c,var(--amber));border-color:var(--amber-deep)}
.chin-slot .ch-key.green,.chin-slot .ch-key.media,.chin-slot .ch-key.shelf,.chin-slot .ch-key.share,.chin-slot .ch-key.mirror,.chin-slot .ch-key.smart,.chin-slot .ch-key.newtext{background:linear-gradient(180deg,#212844,var(--key));border-color:var(--key-edge);color:#cfd3e6;border-style:solid}
.chin-slot .ch-key.green .key-num,.chin-slot .ch-key.media .key-num,.chin-slot .ch-key.shelf .key-num,.chin-slot .ch-key.share .key-num,.chin-slot .ch-key.mirror .key-num,.chin-slot .ch-key.smart .key-num,.chin-slot .ch-key.newtext .key-num{color:var(--teal)}
.chin-slot .ch-key.green .key-label,.chin-slot .ch-key.media .key-label,.chin-slot .ch-key.shelf .key-label,.chin-slot .ch-key.share .key-label,.chin-slot .ch-key.mirror .key-label,.chin-slot .ch-key.smart .key-label,.chin-slot .ch-key.newtext .key-label{color:#dfe3f3}
.chin-slot .ch-key.rec-on{border-color:#ff5b5b}
.chin-slot .ch-key.rec-on .key-label{color:#ff9b9b}
.chin-slot .ch-key:disabled{opacity:.5}
.chin-slot .share-msg{font-size:.78rem;margin:0}
/* הודעת הלימוד המשותף כטוסט למעלה — בטלפון השלט לא מראה אותה (צ'אט 22) */
.share-toast{position:fixed;top:calc(10px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:70;max-width:min(92vw,520px);box-shadow:0 8px 24px rgba(0,0,0,.3)}
@media (max-width:640px){.chin-slot .ch-key{padding:7px 10px;min-height:36px}.chin-slot .ch-key .key-label{font-size:.8rem}.chin-slot .deck{gap:5px}.chin-slot .ch-key:hover:not(:disabled){transform:none}}
@media (max-height:760px){
  .studio>.masthead{display:none}
  .studio>.tv .tv-stand{display:none}
  .studio>.tv .tv-chin{padding:4px 0 2px}
}
/* iOS: פס קבוע ואטום מאחורי שורת המצב — כדי שהפסים הדביקים (פרקים, מגילה) לא ייכנסו מתחת לשעון בגלילה */
.studio::before{
  content:"";position:fixed;top:0;left:0;right:0;z-index:500;pointer-events:none;
  height:env(safe-area-inset-top,0px);background:var(--studio-2);
}

/* ── הפנים: מסך הפתיחה (שכבה מעל האולפן) ── */
.opening{
  --night:#171008; --klaf:#f2e7cd; --klaf-ink:#2c2314; --dim:#b7a276; --gold:#d9a441; --marker:#f5d76e; --line:#43341c;
  position:fixed;inset:0;z-index:600;overflow-y:auto;-webkit-overflow-scrolling:touch;
  background:var(--night);color:var(--klaf);font-family:'Heebo',sans-serif;font-weight:300;line-height:1.7;
  padding-top:env(safe-area-inset-top,0px);padding-bottom:calc(20px + env(safe-area-inset-bottom,0px));
}
.opening::before{
  content:"";position:fixed;top:0;left:0;right:0;z-index:2;height:env(safe-area-inset-top,0px);background:var(--night);
}
.opening button,.opening input{font-family:inherit}
.opening :focus-visible{outline:2px solid var(--gold);outline-offset:3px;border-radius:3px}
.lang-pick{font-family:inherit;font-size:.8rem;padding:0 4px;max-width:92px}
.op-lang{position:absolute;top:calc(10px + env(safe-area-inset-top,0px));inset-inline-end:12px;z-index:3;background:transparent;color:var(--dim);border:1px solid var(--line);border-radius:8px;height:30px}
.op-brand{display:flex;align-items:center;justify-content:center;gap:12px;padding:34px 20px 0}
.op-lamed{position:relative;width:56px;height:56px;flex:none}
.op-lamed .row{position:absolute;bottom:10px;right:0;left:0;text-align:center;font-family:'Frank Ruhl Libre',serif;font-size:19px;color:var(--dim);opacity:.45;letter-spacing:2px;white-space:nowrap;overflow:hidden}
.op-lamed .l{position:absolute;bottom:6px;right:50%;transform:translateX(50%);font-family:'Frank Ruhl Libre',serif;font-weight:900;font-size:46px;line-height:1;color:var(--gold);text-shadow:0 0 22px rgba(217,164,65,.35)}
.op-lamed .base{position:absolute;bottom:8px;right:2px;left:2px;height:1px;background:var(--line)}
.op-name{font-family:'Frank Ruhl Libre',serif;font-weight:700;font-size:1.3rem;line-height:1.3}
.op-name small{display:block;font-family:'Heebo',sans-serif;font-weight:300;font-size:.78rem;color:var(--dim);letter-spacing:.06em}
.op-hero{text-align:center;padding:44px 22px 8px;position:relative}
.op-hero::before{content:'';position:absolute;inset:-120px 0 auto 0;height:560px;pointer-events:none;background:radial-gradient(ellipse 620px 380px at 50% 40%,rgba(217,164,65,.10),transparent 70%)}
.op-hero h1{font-family:'Frank Ruhl Libre',serif;font-weight:700;font-size:clamp(1.7rem,5.4vw,2.9rem);line-height:1.4;max-width:19ch;margin:0 auto;position:relative}
.op-hero p{color:var(--dim);margin:14px auto 0;max-width:44ch;font-size:1rem;position:relative}
.op-vessel{max-width:560px;margin:30px auto 0;padding:0 22px;position:relative}
.op-vessel label{display:block;font-size:.92rem;color:var(--dim);margin-bottom:10px;text-align:center}
.op-vessel .field{display:flex;gap:10px;align-items:center;background:rgba(242,231,205,.05);border:1px solid var(--line);border-radius:12px;padding:6px 6px 6px 16px;box-shadow:inset 0 2px 12px rgba(0,0,0,.35)}
.op-vessel input{flex:1;background:none;border:none;color:var(--klaf);font-family:'Frank Ruhl Libre',serif;font-size:1.05rem;padding:10px 8px;min-width:0}
.op-vessel input::placeholder{color:rgba(183,162,118,.55)}
.op-vessel .go{background:var(--gold);color:var(--night);border:none;border-radius:9px;font-weight:500;font-size:.95rem;padding:11px 20px;white-space:nowrap;cursor:pointer}
.op-vessel .go:hover{filter:brightness(1.08)}
.op-vessel .skip{display:block;text-align:center;margin-top:12px;font-size:.85rem;color:var(--dim)}
.op-vessel .skip a{color:var(--dim);text-decoration:underline;text-underline-offset:3px}
@media(max-width:480px){.op-vessel .field{flex-direction:column;align-items:stretch;padding:8px} .op-vessel .go{width:100%}}
.op-peek{max-width:640px;margin:56px auto 0;padding:0 18px;position:relative}
.op-peek .daf{position:relative;background:var(--klaf);color:var(--klaf-ink);border-radius:10px 10px 0 0;padding:34px 38px 0;box-shadow:0 -2px 60px rgba(217,164,65,.13),0 -1px 0 rgba(242,231,205,.25);min-height:290px;overflow:hidden}
.op-peek .daf::after{content:'';position:absolute;bottom:0;right:0;left:0;height:90px;background:linear-gradient(180deg,transparent,var(--night))}
.op-peek .sefer{font-size:.8rem;color:#8a7248;margin-bottom:14px}
.op-peek .torah{font-family:'Frank Ruhl Libre',serif;font-size:1.22rem;line-height:2.05;font-weight:500;max-width:34ch}
.op-peek .hl{background:linear-gradient(180deg,transparent 12%,var(--marker) 12%,var(--marker) 88%,transparent 88%);padding:0 2px;border-radius:2px}
.op-peek .un{border-bottom:2px solid #b5852f}
.op-peek .fn{color:#a06a1f;font-size:.72em;vertical-align:super;font-weight:700}
.op-peek .note{position:absolute;bottom:64px;left:26px;max-width:200px;background:#fff8e6;border:1px solid #e0c98f;border-radius:8px;padding:9px 12px;font-size:.82rem;line-height:1.55;color:#4a3a1a;box-shadow:0 3px 14px rgba(60,40,0,.18);transform:rotate(-1.2deg)}
.op-peek .note b{font-weight:500;color:#8a5a10}
.op-peek .thread{position:absolute;pointer-events:none;inset:0;width:100%;height:100%}
.op-peek .thread path{fill:none;stroke:var(--gold);stroke-width:1.6;stroke-dasharray:4 5;opacity:.9}
@media (prefers-reduced-motion:no-preference){.op-peek .thread path{stroke-dashoffset:220;animation:opSew 1.6s .5s ease-out forwards} @keyframes opSew{to{stroke-dashoffset:0}}}
.op-peek .cap{text-align:center;color:var(--dim);font-size:.85rem;margin-top:14px}
@media(max-width:480px){.op-peek .daf{padding:26px 22px 0} .op-peek .note{max-width:170px;left:12px;bottom:56px}}
.op-gates{max-width:760px;margin:54px auto 0;padding:0 20px;text-align:center}
.op-gates h2{font-family:'Frank Ruhl Libre',serif;font-weight:700;font-size:1.25rem;margin-bottom:4px}
.op-gates .sub{color:var(--dim);font-size:.9rem;margin-bottom:22px}
.op-gates .gate-row{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
@media(max-width:640px){.op-gates .gate-row{grid-template-columns:repeat(2,1fr)} .op-gates .g:last-child{grid-column:span 2}}
.op-gates .g{background:rgba(242,231,205,.04);border:1px solid var(--line);border-radius:12px;padding:18px 8px 14px;color:var(--klaf);display:flex;flex-direction:column;gap:6px;align-items:center;cursor:pointer;transition:border-color .2s,background .2s}
.op-gates .g:hover{border-color:var(--gold);background:rgba(217,164,65,.07)}
.op-gates .ic{font-size:1.5rem}
.op-gates .t{font-size:.88rem;font-weight:400}
.op-foot{text-align:center;padding:44px 20px 40px;color:var(--dim);font-size:.9rem}
.op-foot .serif{font-family:'Frank Ruhl Libre',serif;color:var(--klaf);font-size:1.08rem}
.op-foot p+p{margin-top:6px}
.op-lib{margin-top:22px;background:none;border:1px solid var(--line);color:var(--klaf);border-radius:999px;padding:8px 18px;font-size:.9rem;cursor:pointer}
.op-lib:hover{border-color:var(--gold);color:var(--gold)}

/* ── השאלה שהלומד נושא — פתק ❓ בספרייה ובקליטה ── */
.to-opening{float:left;font-size:.82rem;color:#8a6a2a;text-decoration:none;border:1px solid #d8c9a0;border-radius:999px;padding:1px 10px;margin-inline-start:10px;white-space:nowrap}
.to-opening:hover{border-color:var(--amber-deep);color:var(--amber-deep)}
.my-q{display:flex;align-items:center;gap:10px;margin:10px 0 14px;background:#fff8e6;border:1px solid #e0c98f;border-radius:10px;padding:9px 12px;box-shadow:0 3px 12px rgba(60,40,0,.10);transform:rotate(-.4deg)}
.my-q-ic{font-size:1.1rem;flex:none}
.my-q-body{flex:1;font-family:'Frank Ruhl Libre',serif;font-weight:500;font-size:1.02rem;line-height:1.45;color:#3a2c14}
.my-q-body small{display:block;font-family:'Heebo',sans-serif;font-weight:400;font-size:.72rem;color:#8a6a2a;letter-spacing:.03em}
.my-q-x{flex:none;background:none;border:none;color:#a08850;font-size:.95rem;cursor:pointer;padding:4px 6px;border-radius:6px}
.my-q-answer{margin-top:18px;align-items:flex-start;transform:rotate(.3deg)}
.my-q-answer .my-q-body{font-size:.98rem;line-height:1.6;white-space:pre-wrap}
.my-q-x:hover{background:rgba(160,136,80,.15);color:#5a3a10}

.masthead{display:flex;align-items:baseline;gap:12px;margin-bottom:22px;flex-wrap:wrap;justify-content:center}
.mast-dot{width:10px;height:10px;border-radius:50%;background:var(--amber);box-shadow:0 0 12px var(--amber);align-self:center}
.masthead h1{font-size:1.9rem;font-weight:800;letter-spacing:.5px}
.mast-sub{color:#9aa1c4;font-size:.95rem}
 
.tv{width:100%;max-width:1500px} /* צ'אט 20: הטלוויזיה גדלה עד שהיא נוגעת בגובה או ברוחב של המסך, ושומרת על הפרופורציה של טלוויזיה */
/* ── הטלוויזיה כגוף (צ'אט 21): מסגרת עם עומק, מסך שקוע, והילה חמה על הקיר מאחור (כמו תאורת רקע של טלוויזיה) ── */
.bezel{
  position:relative;
  background:linear-gradient(160deg,#2a3258 0%,#1b2244 45%,#141a35 100%);
  border:1px solid #39436f;border-radius:26px;padding:16px;
  box-shadow:
    0 30px 70px rgba(0,0,0,.6),
    0 0 0 1px rgba(0,0,0,.5),
    0 0 90px 18px rgba(242,190,120,.10),
    inset 0 1px 0 rgba(255,255,255,.10),
    inset 0 -2px 0 rgba(0,0,0,.45),
    inset 1px 0 0 rgba(255,255,255,.04),
    inset -1px 0 0 rgba(0,0,0,.3);
}
.bezel::before{ /* ברק עדין על הקצה העליון של המסגרת */
  content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,0) 18%);
}
.bezel::after{ /* ההילה על הקיר — דועכת למטה ולצדדים */
  content:"";position:absolute;inset:-6% -4% -2%;z-index:-1;border-radius:40px;pointer-events:none;
  background:radial-gradient(60% 55% at 50% 40%,rgba(246,205,140,.16),rgba(246,205,140,.05) 55%,transparent 75%);
  filter:blur(18px);
}
.screen{box-shadow:inset 0 0 0 1px rgba(0,0,0,.6),inset 0 6px 18px rgba(0,0,0,.55),inset 0 -3px 10px rgba(0,0,0,.35)}
.screen::before{ /* ויניטה קלה בפינות המסך — זכוכית */
  content:"";position:absolute;inset:0;pointer-events:none;z-index:3;border-radius:inherit;
  background:radial-gradient(120% 100% at 50% 50%,transparent 70%,rgba(20,16,8,.12) 100%);
}
.screen{
  position:relative;background:#0a0e20;border-radius:16px;overflow:hidden;
  border:1px solid #262e56;min-height:440px;display:flex;flex-direction:column;
}
.screen.static-on::after{
  content:"";position:absolute;inset:0;z-index:9;pointer-events:none;
  background:repeating-linear-gradient(0deg,rgba(255,255,255,.14) 0 2px,rgba(0,0,0,.28) 2px 4px);
  animation:staticFlick .26s steps(4) both;
}
@keyframes staticFlick{from{opacity:1}to{opacity:0}}
@media (prefers-reduced-motion: reduce){
  .screen.static-on::after{animation:none;opacity:0}
  .idle-mark.spin{animation:none}
}
 
.screen-bar{
  display:flex;align-items:center;gap:14px;padding:10px 16px;
  background:#0d1230;border-bottom:1px solid #232b52;
  font-family:'IBM Plex Mono',monospace;
}
.ch-num{color:var(--amber);font-weight:600;letter-spacing:1px;font-size:.85rem}
.ch-name{color:#cfd3e6;font-family:'Heebo',sans-serif;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.onair{margin-inline-start:auto;font-size:.75rem;letter-spacing:2px;color:#ff5b5b;opacity:0}
.onair.live{opacity:1;animation:blink 1s infinite}
@keyframes blink{50%{opacity:.25}}
 
.chapter-strip{
  display:flex;align-items:center;gap:10px;padding:8px 14px;
  background:#0b102a;border-bottom:1px solid #1e2648;
}
.chapter-count{font-family:'IBM Plex Mono',monospace;font-size:.75rem;color:var(--teal);letter-spacing:1px;white-space:nowrap}
.chapter-tabs{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;scrollbar-width:thin}
.chapter-tab{
  background:transparent;border:1px solid #2c3560;border-radius:20px;
  color:#aab1d4;font-family:'Heebo',sans-serif;font-size:.82rem;font-weight:600;
  padding:5px 14px;cursor:pointer;white-space:nowrap;max-width:200px;
  overflow:hidden;text-overflow:ellipsis;transition:border-color .15s,color .15s;
}
.chapter-tab:hover{border-color:var(--amber);color:#fff}
.chapter-tab.on{border-color:var(--amber);color:var(--amber);background:rgba(242,163,60,.08)}
.chapter-tab.ok{color:var(--teal)}
.chapter-tab.on.ok{border-color:var(--teal)}
 
.font-btns{display:flex;gap:6px;margin-inline-start:auto;margin-inline-end:10px}
.font-btn{background:#1b2a4a;color:#cfd3e6;border:1px solid #3a4a72;border-radius:8px;min-width:34px;height:26px;font-size:.85rem;cursor:pointer;line-height:1}
.font-btn:hover{border-color:#f2a33c;color:#fff}
.font-btn.cloud-on{border-color:#39d98a;color:#39d98a}
.font-btn.cloud-err{border-color:#ff7b6b;color:#ff7b6b}
.sync-line{font-size:.82rem;opacity:.85;margin:6px 0 2px;line-height:1.5}
.pull-list{list-style:none;padding:0;margin:10px 0;text-align:right;max-height:190px;overflow:auto}
.pull-list li{padding:6px 8px;border-bottom:1px solid #26355c;font-size:.9rem}
.pull-list li:last-child{border-bottom:none}
.pull-tag{background:#39d98a;color:#06210f;border-radius:5px;padding:1px 6px;font-size:.7rem;margin-inline-start:6px}
.pull-when{display:block;font-size:.72rem;opacity:.6}
.cloud-overlay{position:fixed;inset:0;background:rgba(5,10,25,.75);z-index:400;display:flex;align-items:center;justify-content:center}
.cloud-box{background:#101c38;border:1px solid #3a4a72;border-radius:14px;padding:22px 26px;max-width:360px;width:90%;color:#e8ebf7;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.5)}
.cloud-box h3{margin:0 0 10px;color:#f2a33c}
.cloud-input{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:8px;border:1px solid #3a4a72;background:#0b1430;color:#fff;font-size:1rem;margin:8px 0}
.cloud-actions{display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap}
.cloud-btn{background:#1b2a4a;color:#fff;border:1px solid #3a4a72;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:.95rem}
.cloud-btn:hover{border-color:#f2a33c}
.cloud-btn.ghost{opacity:.75}
.cloud-msg{font-size:.85rem;color:#ffd27a;margin-top:10px}
.screen-body{
  flex:1;background:var(--paper);color:var(--ink);padding:26px clamp(26px,4vw,90px);overflow-y:auto;max-height:560px;
  background-image:radial-gradient(rgba(0,0,0,.03) 1px,transparent 1px);background-size:5px 5px;
}
.prose{line-height:1.9;font-size:1.05rem;white-space:pre-wrap}
.ai-layer{white-space:pre-wrap}
.ai-layer .scroll-sent.clickable{cursor:text}
.ai-notes{margin:8px 0 0;padding-inline-start:18px;font-size:.92rem;color:#5a4a2a;line-height:1.7}
.ai-notes li{cursor:pointer}
.ai-notes li:hover{color:var(--amber)}
.trace-btn{font-family:inherit;font-size:.78rem;margin-inline-start:8px;border:1px solid #d8b06a;background:#fffdf6;border-radius:999px;padding:1px 8px;cursor:pointer;color:#7a5410}
.card-open{margin-top:12px;display:flex;flex-direction:column;gap:10px;width:100%}
.card-open-body{background:#fffdf6;border:1.5px solid #d8b06a;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;text-align:start}
.card-open-face b{color:#7a5410;margin-inline-end:6px}
.card-text{display:inline}
 
.intake,.library{display:flex;flex-direction:column;gap:14px}
.intake-lead{color:var(--ink-soft);line-height:1.7}
.intake-tip{color:#8a8467;font-size:.85rem}
.intake-title{
  width:100%;border:1.5px solid #cfc8b4;border-radius:12px;padding:11px 14px;
  font-family:'Heebo',sans-serif;font-size:1rem;background:#fffdf6;color:var(--ink);
}
.intake-text{
  width:100%;min-height:170px;resize:vertical;border:1.5px solid #cfc8b4;border-radius:12px;
  padding:14px;font-family:'Heebo',sans-serif;font-size:1rem;line-height:1.7;background:#fffdf6;color:var(--ink);
}
.intake-title:focus,.intake-text:focus{outline:2px solid var(--amber);border-color:var(--amber)}
.upload-box{display:flex;flex-direction:column;gap:8px;border:1.5px dashed #cdb37e;border-radius:12px;padding:16px;background:#fffdf6}
.upload-row{display:flex;gap:10px;flex-wrap:wrap}
.upload-btn.photo{background:#1e5c52}
.upload-btn.photo:hover:not(:disabled){background:#2a7a6e}
.upload-btn{
  align-self:flex-start;background:#232323;color:#fff;border:none;border-radius:10px;
  padding:11px 22px;font-family:'Heebo',sans-serif;font-size:1rem;font-weight:600;cursor:pointer;
}
.upload-btn:hover:not(:disabled){background:#3a3a3a}
.upload-btn:disabled{opacity:.7;cursor:default}
.upload-hint{color:#8a8467;font-size:.82rem;line-height:1.5}
.or-divider{display:flex;align-items:center;gap:12px;color:#a89f82;font-size:.85rem;margin:2px 0}
.or-divider::before,.or-divider::after{content:"";flex:1;height:1px;background:#ddd4bd}
.btn-row{display:flex;gap:10px;align-items:center}
.broadcast{
  align-self:flex-start;background:var(--amber);border:none;border-radius:12px;
  padding:12px 34px;font-size:1.05rem;font-weight:800;font-family:'Heebo',sans-serif;
  color:#241a08;cursor:pointer;box-shadow:0 4px 0 var(--amber-deep);
}
.broadcast.slim{padding:10px 22px;font-size:.95rem}
.broadcast:active{transform:translateY(2px);box-shadow:0 2px 0 var(--amber-deep)}
.ghost-btn{
  background:transparent;border:1.5px solid #cfc8b4;border-radius:12px;padding:11px 20px;
  font-family:'Heebo',sans-serif;font-weight:600;color:var(--ink-soft);cursor:pointer;
}
.err{background:#fbe6e0;border:1px solid #e2a493;color:#8c3a25;border-radius:10px;padding:10px 14px;font-size:.95rem}
.err.big{margin-bottom:16px}
 
.idle{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;min-height:280px;text-align:center;color:var(--ink-soft)}
.idle.open{justify-content:flex-start;align-items:stretch;text-align:start;min-height:0}
.idle-mark{font-size:2.4rem;color:var(--amber)}
.idle-mark.spin{animation:spin 1.6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.idle-hint{color:#8a8467;font-size:.9rem}
 
/* ספרייה */
.book-row{display:flex;gap:8px;align-items:stretch}
.book-main{
  flex:1;display:flex;flex-direction:column;gap:6px;text-align:start;
  background:#fffdf6;border:1.5px solid #d8b06a;border-radius:12px;padding:14px 16px;
  cursor:pointer;font-family:'Heebo',sans-serif;color:var(--ink);
}
.book-main:hover{border-color:var(--amber-deep)}
.book-title{font-weight:800;font-size:1.05rem}
.book-meta{color:var(--ink-soft);font-size:.85rem}
.mini-bar{height:6px;border-radius:4px;background:#e8e1cb;overflow:hidden}
.mini-fill{display:block;height:100%;background:var(--teal);border-radius:4px}
.del{
  border:1.5px solid #cfc8b4;background:transparent;border-radius:12px;min-width:44px;
  color:#8c6a5a;cursor:pointer;font-size:1rem;font-family:'Heebo',sans-serif;
}
.del.confirm{background:#fbe6e0;border-color:#e2a493;color:#8c3a25;font-weight:600;padding:0 10px}
.del.pin{color:#7a5410;font-size:1.05rem}
.search-bar{width:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:10px 14px;margin:0 0 10px;font-family:'Heebo',sans-serif;font-size:1rem;color:#6b5a3e;cursor:text;text-align:start}
.search-bar:hover{border-color:var(--amber-deep)}
.search-mic{font-size:1.15rem;padding:0 4px;cursor:pointer}
.lib-hint{background:#fff3d6;border:1px solid #d8b06a;color:#5a3a10;border-radius:10px;padding:8px 12px;margin:0 0 10px;font-size:.95rem}
.search-overlay{align-items:flex-start;padding-top:max(24px,env(safe-area-inset-top,0px))}
.search-box{background:#fffdf8;color:#1b2238;border-radius:16px;width:min(720px,94%);max-height:86vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.5);overflow:hidden}
.search-row{display:flex;gap:6px;padding:12px;border-bottom:1px solid var(--line);align-items:center}
.search-in{flex:1;min-width:0;font-family:'Heebo',sans-serif;font-size:1.1rem;padding:10px 12px;border:1.5px solid #c9b8f2;border-radius:10px;background:#fff;color:#1b2238}
.search-in:focus{outline:none;border-color:var(--amber-deep)}
.search-row .voice-lang{font-family:'Heebo',sans-serif;font-size:.85rem;padding:6px 4px;border:1.5px solid #c9b8f2;border-radius:10px;background:#fff;color:#1b2238;max-width:92px}
.search-stat{font-weight:400;opacity:.7;font-size:.8em}
.search-row .mic.on{background:#fbe6e0;border-color:#e2a493;color:#8c3a25}
.search-results{overflow-y:auto;padding:8px 12px 16px}
.search-h{font-size:.8rem;letter-spacing:.06em;color:#8a7a5e;margin:10px 4px 4px;text-transform:uppercase}
.search-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:start;background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:4px 0;font-family:'Heebo',sans-serif;cursor:pointer;color:#1b2238}
.search-item:hover{border-color:var(--amber-deep);background:#fff8e6}
.search-item b{font-size:1rem}.search-item span{font-size:.92rem;color:#4b4a5a;line-height:1.45}.search-item small{font-size:.78rem;color:#8a7a5e}
.search-item.feat{border-color:#d8b06a;background:#fffaf0}
.search-item.arch{opacity:.8}
.search-item mark{background:#ffe08a;color:inherit;padding:0 2px;border-radius:3px}
.search-empty{padding:10px 4px;color:#6b5a3e}.search-empty p{margin:0 0 8px;font-size:.95rem}
.search-chips{display:flex;flex-wrap:wrap;gap:6px}
.search-none{color:#8a7a5e;padding:8px 4px}
.scroll-sent.search-hit{background:#ffe08a !important;transition:background .4s}
.sel-bar{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.sel-bar .ghost-btn:disabled{opacity:.45;cursor:default}
.sel-bar .ghost-btn.on{background:#fff3d6;border-color:#d8b06a;color:#7a5410;font-weight:700}
.sel-box{width:22px;height:22px;align-self:center;accent-color:#c8871c;flex:none}
.book-row.sel .book-main{border-color:#c8871c;background:#fff8e6}
.del.pin.on{background:#fff8e6;border-color:#d8b06a}
.archive{margin-top:18px;border-top:1px dashed var(--line);padding-top:8px}
.archive-head{width:100%;display:flex;justify-content:space-between;align-items:center;background:none;border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-family:'Heebo',sans-serif;font-size:.95rem;color:#6b5a3e;cursor:pointer}
.archive.open .archive-head{border-bottom-left-radius:0;border-bottom-right-radius:0;background:#f7f2e6}
.archive .book-row.archived{margin-top:6px;opacity:.85}
.archive .book-row.archived .book-main{background:#fbf8f1}
 
/* 🎧 שיקוף */
.mirror-btn{
  border:1.5px solid #d8b06a;background:#fff8e6;border-radius:12px;min-width:52px;padding:0 8px;
  color:#7a5410;cursor:pointer;font-family:'Heebo',sans-serif;font-size:1.05rem;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
}
.mirror-btn small{font-size:.62rem;font-weight:700;letter-spacing:.02em}
.mirror-btn:hover{border-color:var(--amber-deep);background:#fff3d6}
.cloud-link{color:inherit;opacity:.75;text-decoration:underline}
.cloud-del{color:#ff9a9a;text-decoration:underline}
.rec-pend{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0 12px;padding:10px 12px;border:1.5px dashed #6f96d0;border-radius:12px;background:rgba(63,111,181,.10);font-family:'Heebo',sans-serif;font-size:.95rem}
.rec-pend > span{flex:1 1 180px;font-weight:600}
.rec-pend .del{min-height:38px}
.ch-key.mirror{background:linear-gradient(180deg,#3a2b12,#241a0c);border-color:#6b4d1c;color:#f3e2bd}
.ch-key.mirror .key-num{color:var(--amber)}
.mirror{display:flex;flex-direction:column;gap:14px}
.mirror-list{display:flex;flex-direction:column;gap:8px}
.mirror-row{display:flex;align-items:center;gap:10px;background:#fffdf6;border:1.5px solid #e0d8c0;border-radius:12px;padding:8px 10px 8px 8px}
.mirror-row.on{border-color:var(--amber-deep);background:#fff8e6}
.mirror-play{border:none;background:#232323;color:#fff;border-radius:10px;min-width:44px;height:40px;font-size:1rem;cursor:pointer}
.mirror-body{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}
.mirror-title{font-weight:800;font-size:1rem}
.mirror-body small{color:var(--ink-soft);font-size:.8rem}
.mirror-audio{width:100%;margin:2px 0 6px}
.mirror-new{display:flex;flex-direction:column;gap:12px;align-items:flex-start;border-top:1px dashed #d8cfb4;padding-top:14px}
.mirror-opts{display:flex;flex-direction:column;gap:10px;width:100%}
.mirror-name{display:flex;align-items:center;gap:10px;font-size:.92rem;color:var(--ink-soft);flex-wrap:wrap}
.mirror-name input{border:1.5px solid #cfc8b4;background:#fffdf6;border-radius:10px;padding:8px 12px;font-family:'Heebo',sans-serif;font-size:1rem;color:var(--ink);min-width:160px}
.mirror-name input:focus{outline:none;border-color:var(--amber)}
.mirror-script{display:flex;flex-direction:column;gap:12px;border-top:1px dashed #d8cfb4;padding-top:14px}
.mirror-lines{display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto;padding:2px 2px 2px 6px}
.mirror-line{line-height:1.75;font-size:1rem;padding:8px 12px;border-radius:12px;max-width:92%}
.mirror-line b{display:block;font-size:.72rem;letter-spacing:.04em;color:var(--ink-soft);margin-bottom:2px}
.mirror-line.t{background:#f3ecda;align-self:flex-start}
.mirror-line.s{background:#e6f1ee;align-self:flex-end}

/* לוח שידורים */
.guide{display:flex;flex-direction:column;gap:14px}
.guide-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.guide-title{font-size:1.25rem;font-weight:800}
.guide-meta{color:var(--ink-soft);font-size:.9rem}
.progressbar{height:10px;border-radius:6px;background:#e8e1cb;overflow:hidden}
.progress-fill{display:block;height:100%;background:linear-gradient(90deg,var(--teal),#2aa896);border-radius:6px;transition:width .4s}
.g-list{display:flex;flex-direction:column;gap:8px}
.g-row{
  display:flex;align-items:center;gap:12px;background:#fffdf6;border:1.5px solid #e0d8c0;
  border-radius:12px;padding:12px 14px;cursor:pointer;font-family:'Heebo',sans-serif;color:var(--ink);text-align:start;
}
.g-row:hover{border-color:var(--amber)}
.g-num{font-family:'IBM Plex Mono',monospace;color:var(--amber-deep);font-size:.85rem;font-weight:600}
.g-title{flex:1;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.g-score{font-family:'IBM Plex Mono',monospace;font-size:.8rem;color:var(--ink-soft)}
.chip{font-size:.75rem;font-weight:600;border-radius:20px;padding:4px 12px;white-space:nowrap}
.chip.new{background:#eee8d5;color:#8a8467}
.chip.learning{background:#fdeed3;color:#9a5f10}
.chip.done{background:#dff3ee;color:#1e7c6d}
 
/* פתיחת פרק */
.chapter-head{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.recap{
  border:1.5px dashed #d8b06a;border-radius:12px;padding:14px 16px;background:#fffdf6;margin-bottom:14px;
}
.recap h4{color:#7a5410;font-size:.9rem;margin-bottom:6px;letter-spacing:.3px}
.recap p{line-height:1.7;font-size:.95rem;color:#3f3b2e}
 
/* סיכום */
.pill-row{display:flex;gap:8px;justify-content:flex-end;margin-bottom:18px}
.pill{
  border:1.5px solid #cfc8b4;background:transparent;border-radius:20px;padding:6px 20px;
  font-family:'Heebo',sans-serif;font-weight:600;font-size:.9rem;color:var(--ink-soft);cursor:pointer;
}
.pill.on{background:#232323;color:#fff;border-color:#232323}
 
/* מושגים */
.concepts{display:flex;flex-direction:column;gap:22px}
.sec-title{font-size:1.05rem;font-weight:800;color:#7a5410;margin-bottom:10px}
.sec-title.center{text-align:center}
.yt-row{background:#fff1f0;border-color:#f0b8b2;color:#63201a}
.yt-text{flex:1 1 100%;min-height:90px;font-family:inherit;font-size:.95rem;padding:8px 10px;border-radius:8px;border:1.5px solid #f0b8b2;background:#fff;color:#2c2314}
.yt-box{margin:8px 0 12px}
.yt-frame{position:relative;width:100%;max-width:720px;aspect-ratio:16/9;margin-top:8px;border-radius:10px;overflow:hidden;background:#000}
.yt-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.font-btn.focus-in{border-color:var(--amber);color:var(--amber)}
.studio.focus{padding:0}
.studio.focus>.tv{aspect-ratio:auto;max-width:none;width:100%}
.studio.focus .bezel{padding:0;border-radius:0;box-shadow:none}
.studio.focus .screen{border-radius:0;box-shadow:none}
.studio.focus .screen-bar,.studio.focus .chapter-strip,.studio.focus .tv-chin,.studio.focus .tv-stand,.studio.focus .tv-foot{display:none}
.studio.focus .screen-body{padding-top:calc(env(safe-area-inset-top,0px) + 46px);padding-bottom:calc(env(safe-area-inset-bottom,0px) + 30px)}
.studio.focus .screen-body>*{max-width:900px;margin-inline:auto}
.focus-tools{position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);inset-inline-end:10px;z-index:550;display:flex;gap:6px;opacity:.5;transition:opacity .2s}
.focus-tools:hover,.focus-tools:focus-within{opacity:1}
.focus-btn{min-width:38px;height:32px;border-radius:9px;border:1px solid #3a4a72;background:#1b2a4a;color:#e9ecf8;font-size:.95rem;line-height:1;cursor:pointer;font-family:inherit}
@media(hover:none){.focus-tools{opacity:.7}}
.tl{display:flex;flex-direction:column;gap:14px}
.tl-head{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.tl-head .mark-btn.on{background:#1b3a6b;color:#fff;border-color:#1b3a6b}
.tl-to{font-weight:800;color:#7a5410;margin-inline-end:4px}
.tl-para{display:flex;flex-direction:column;gap:6px;padding-bottom:10px;border-bottom:1px dashed #e0d2ae}
.tl-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
.tl-row p{margin:0;line-height:1.8}
.tl-src{color:#2c2314}
.tl-dst{color:#1b3a6b;background:#f3f7ff;border-radius:8px;padding:2px 8px}
.tl-foot{font-size:.8rem;opacity:.65}
@media(max-width:640px){.tl-row{grid-template-columns:1fr;gap:2px}.tl-dst{margin-bottom:8px}}
.term-row{display:flex;gap:12px;padding:9px 0;border-bottom:1px dashed #d9d2bd;line-height:1.6}
.term{font-weight:800;min-width:120px}
.def{color:#3f3b2e}
.rules{padding-inline-start:20px;line-height:2}
 
/* מפת חשיבה */
.mindmap{display:flex;flex-direction:column;align-items:center;gap:20px}
.mm-topic{background:#232323;color:#fff;border-radius:12px;padding:10px 26px;font-weight:800;font-size:1.05rem;text-align:center}
.mm-branches{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;width:100%}
.mm-branch{
  flex:1 1 170px;max-width:220px;border:1.5px solid #d8b06a;border-radius:12px;padding:12px;
  display:flex;flex-direction:column;gap:8px;background:#fffdf6;
}
.mm-branch-label{font-weight:800;color:#7a5410;text-align:center;padding-bottom:6px;border-bottom:1px solid #ecd9b4}
.mm-leaf{border:1px solid #e3ddc8;border-radius:8px;padding:7px 9px;font-size:.9rem;line-height:1.5;background:#fff}
 
/* תרשים זרימה */
.flow{display:flex;flex-direction:column;align-items:center}
.flow-item{width:100%;max-width:520px;display:flex;flex-direction:column;align-items:center}
.flow-step{
  width:100%;display:flex;gap:12px;align-items:flex-start;background:#fffdf6;
  border:1.5px solid #d8b06a;border-radius:12px;padding:12px 16px;line-height:1.6;
}
.flow-num{
  font-family:'IBM Plex Mono',monospace;font-weight:600;color:var(--amber-deep);
  border:1.5px solid var(--amber);border-radius:50%;width:28px;height:28px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;font-size:.85rem;
}
.flow-arrow{color:#b3a97f;font-size:1.2rem;padding:4px 0}
 
/* מבחן */
.fm-wrap{width:100%}
.fm-hint{font-size:.85rem;color:#6c6449;margin:0 0 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.fm-sizer{position:relative;margin-inline-start:auto}
.fm-scale{position:absolute;top:0;right:0;touch-action:none}
.fm-canvas{position:relative;width:100%;background:#faf7ee;border:1.5px solid #d8d0ba;border-radius:14px;overflow:auto;touch-action:pan-x pan-y}
.fm-lines{position:absolute;inset:0}
.fm-lines line{stroke:#c9b98a;stroke-width:2}
.fm-node{position:absolute;transform:translate(-50%,-50%);cursor:grab;user-select:none;border-radius:12px;padding:8px 14px;font-size:.9rem;line-height:1.4;max-width:190px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.fm-node:active{cursor:grabbing}
.fm-root{background:var(--amber);color:#241a08;font-weight:800;font-size:1rem;z-index:3}
.fm-main{background:#1a2140;color:#fff;font-weight:700;z-index:2}
.fm-sub{background:#fff;border:1.5px solid #d8d0ba;color:#232323;font-size:.82rem;z-index:1}
.mark-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#f7f3e8;border:1.5px solid #d8d0ba;border-radius:12px;padding:8px 12px;margin:0 auto 10px;max-width:860px;justify-content:center}
.mark-bar.floating{position:fixed;z-index:60;margin:0;width:max-content;max-width:calc(100vw - 24px);box-shadow:0 8px 24px rgba(20,14,0,.28);border-color:var(--amber);animation:barIn .16s ease-out;gap:5px;padding:5px 8px;border-radius:10px;font-size:16px}
.mark-bar.floating .mark-title{display:none}
.mark-bar.floating .mark-btn{font-size:.82rem;padding:4px 9px;border-radius:7px}
/* החץ של הלשונית — מצביע על המילה/השורה שנלחצה */
.mark-bar.floating.above::after,.mark-bar.floating.below::after{content:"";position:absolute;left:var(--arrow,50%);width:12px;height:12px;background:#f7f3e8;border:1.5px solid var(--amber);transform:translateX(-50%) rotate(45deg)}
.mark-bar.floating.above::after{bottom:-7px;border-top:none;border-left:none}
.mark-bar.floating.below::after{top:-7px;border-bottom:none;border-right:none}
/* 🕯 לימוד משותף */
.share-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#fff8e6;border:1.5px solid var(--amber);border-radius:12px;padding:7px 12px;margin:0 0 12px;font-size:.9rem;color:#4a3a1a}
.share-title{font-weight:800}
.share-invite{display:none}
.share-code{font-family:'IBM Plex Mono',monospace;letter-spacing:.12em;background:#fff;border:1px solid #e0c98f;border-radius:6px;padding:2px 8px;font-weight:600}
.share-who{display:flex;gap:6px;flex-wrap:wrap}
.share-peer{background:var(--c);color:#fff;border-radius:999px;padding:1px 9px;font-size:.82rem;font-weight:600}
.share-wait{color:#8a7a55;font-size:.85rem}
.share-bar.share-lost{background:#ffe9e4;border-color:#d9534f;color:#7a1f1c;font-weight:600}
.share-holder{font-size:.85rem}
.share-bar .mark-btn.on{border-color:var(--amber);background:#fdeed3}
/* החלונית יושבת מעל אזור הגלילה (לא בתוכו) — "קח את הדף", וידאו ו"צא" תמיד בהישג יד. בטלפון: שורה אחת צרה שנגללת לצדדים */
.screen>.share-bar{margin:0;border-radius:0;border-width:0 0 1.5px;flex:none}
.share-bar.share-min{width:100%;cursor:pointer;font:inherit;font-size:.78rem;padding:2px 12px;gap:10px;flex-wrap:nowrap;white-space:nowrap;overflow:hidden;text-align:start}
.share-min .share-min-open{margin-inline-start:auto;opacity:.7}
@media (max-width:640px){.screen>.share-bar{flex-wrap:nowrap;overflow-x:auto;white-space:nowrap;gap:6px;padding:5px 8px;font-size:.8rem;-webkit-overflow-scrolling:touch}.screen>.share-bar>*{flex:none}.screen>.share-bar .mark-btn{padding:3px 8px;font-size:.8rem;order:-1}.screen>.share-bar .share-title,.screen>.share-bar .share-copy{display:none}.screen>.share-bar .share-invite{display:inline-block;order:-2;background:var(--amber-deep,#c8871c);color:#fff;border-color:transparent;font-weight:800}}
.share-msg{max-width:860px;margin:10px auto;background:#fff8e6;border:1px solid #e0c98f;border-radius:10px;padding:8px 12px;color:#4a3a1a;display:flex;gap:10px;align-items:center;justify-content:space-between}
.ch-key.share{border-color:#b7a6f2}
.scroll-sent.peer-hl{box-shadow:inset 0 -3px 0 var(--peer,#4aa3ff);border-radius:3px}
.scroll-sent.peer-here{outline:2px dashed var(--peer,#4aa3ff);outline-offset:2px;border-radius:4px}
.peer-cursor{display:inline-block;color:#fff;font-size:.68rem;border-radius:999px;padding:0 7px;margin-inline-end:5px;vertical-align:middle;font-weight:700;line-height:1.5}
.peer-note{cursor:help;font-size:.8em}
/* 📹 חלון הווידאו */
.video-panel{position:fixed;left:12px;bottom:12px;z-index:65;width:min(320px,calc(100vw - 24px));background:#141a33;color:#e9ecf8;border:1.5px solid var(--amber);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.45);overflow:hidden;font-size:.85rem}
.video-head{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:6px 10px;background:#0d1226;cursor:grab;user-select:none;touch-action:none}
.video-head:active{cursor:grabbing}
.video-btns{display:flex;gap:4px}
.video-btns .mark-btn{padding:2px 7px;font-size:.85rem;background:#1d2c55;border-color:#2c3f70;color:#e9ecf8}
.video-btns .mark-btn.off{background:#5a1d1d;border-color:#8a2d2d}
.video-msg{padding:6px 10px;color:#f8c778;font-size:.8rem}
.video-panel.mini .video-grid,.video-panel.mini .video-msg{display:none}
.video-panel.mini .video-btns .mark-btn:not(.vmini){display:none}
.video-panel.mini{width:auto!important;min-width:104px}
.video-panel.mini .video-head{cursor:pointer}
.video-panel.narrow.mini .video-btns{display:none}
.video-panel.narrow{left:8px;bottom:calc(8px + env(safe-area-inset-bottom));font-size:.74rem;border-radius:11px}
.video-panel.narrow .video-head{flex-direction:column;gap:2px;padding:0 3px 3px}
.video-panel.narrow.mini .video-head{padding-bottom:0}
.video-panel.narrow .video-title{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;padding:6px 0 5px;font-size:.72rem;line-height:1}
.video-handle{display:inline-block;width:30px;height:4px;border-radius:4px;background:#8fa0d8}
.video-chev{font-style:normal;opacity:.75}
.video-panel.narrow .video-btns{gap:3px;justify-content:center;flex-wrap:wrap}
.video-panel.narrow .video-btns .mark-btn{padding:1px 5px;font-size:.72rem;min-width:0}
.video-panel.narrow .video-msg{padding:4px 6px;font-size:.72rem}
.video-panel.narrow .video-grid{grid-template-columns:1fr;padding:3px}
.video-panel.narrow.sz2 .video-grid{grid-template-columns:1fr 1fr}
.video-panel.pip .video-grid{position:relative}
.video-panel.pip .video-tile.local{position:absolute;width:36%;left:7px;bottom:7px;z-index:2;border:1.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5)}
.video-panel.pip .video-tile.local .video-name{display:none}
.video-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:4px;padding:4px}
.video-tile{position:relative;aspect-ratio:4/3;background:#0a1128;border-radius:8px;overflow:hidden;border:2px solid transparent}
.video-tile.speaking{border-color:var(--green,#39d98a)}
.video-tile video{width:100%;height:100%;object-fit:cover;display:block}
.video-tile.local video{transform:scaleX(-1)}
.video-off{display:flex;align-items:center;justify-content:center;height:100%;color:#a7b0cf;font-size:1rem}
.video-name{position:absolute;bottom:4px;right:6px;background:rgba(0,0,0,.55);color:#fff;font-size:.72rem;padding:1px 7px;border-radius:999px}
/* 📝 עורך ההערה */
.note-ed-back{position:fixed;inset:0;z-index:70;background:rgba(10,12,30,.45);display:flex;align-items:center;justify-content:center;padding:16px;animation:barIn .14s ease-out}
.note-ed{background:#fffdf6;color:#232323;border:1.5px solid var(--amber);border-radius:14px;padding:14px 16px;width:min(520px,100%);box-shadow:0 14px 40px rgba(0,0,0,.35);font-family:inherit;font-size:16px}
.note-ed-head{font-weight:800;margin-bottom:6px}
.note-ed-src{font-size:.85rem;color:#6c6449;margin-bottom:8px;line-height:1.5}
.note-ed-ta{width:100%;box-sizing:border-box;font-family:inherit;font-size:1.05rem;line-height:1.6;padding:10px 12px;border-radius:10px;border:1.5px solid #cfc8b4;background:#fff;color:#232323;resize:vertical}
.note-ed-ta:focus{outline:none;border-color:var(--amber)}
.note-ed-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
.note-ed-actions{justify-content:flex-start}
.note-ed-save{padding:8px 18px;font-size:1rem}
.note-ed-msg{font-size:.85rem;color:#8a3b12}
.note-mic.on{border-color:#d33;background:#fff0ee;animation:micPulse 1.2s ease-in-out infinite}
@keyframes micPulse{0%,100%{box-shadow:0 0 0 0 rgba(220,50,50,.35)}50%{box-shadow:0 0 0 6px rgba(220,50,50,0)}}
.layer-btn{opacity:.45}
.layer-btn.on{opacity:1;border-color:var(--amber);box-shadow:0 0 6px rgba(242,163,60,.45)}
@keyframes barIn{from{opacity:0;translate:0 4px}to{opacity:1;translate:0 0}}
.mark-title{font-weight:800;font-size:.9rem;color:#6c6449}
.mark-btn{font-family:inherit;font-size:.85rem;padding:6px 12px;border-radius:9px;border:1.5px solid #cfc8b4;background:#fffdf6;color:#232323;cursor:pointer}
.mark-btn:hover{border-color:var(--amber)}
.mark-btn.hl-y{background:#fff3a0}
.mark-btn.hl-g{background:#d3f7c6}
.mark-btn.hl-p{background:#ffd6e8}
@media print{
  body{background:#fff!important}
  .masthead,.deck,.dial,.tv-chin,.tv-stand,.font-btns,.search-row,.search-panel,.flex-hint,.mark-bar,.fm-hint,.bar-title,.opening,.studio::before,.to-opening,.my-q-x{display:none!important}
  .tv-frame,.screen,.screen-body{position:static!important;box-shadow:none!important;border:none!important;background:#fff!important;color:#000!important;max-height:none!important;overflow:visible!important;zoom:1!important}
  .scroll-text{max-height:none!important;overflow:visible!important}
}
.search-row{display:flex;gap:8px;margin-bottom:10px}
.search-input{flex:1;font-family:inherit;font-size:.95rem;padding:9px 12px;border-radius:10px;border:1.5px solid #cfc8b4;background:#fffdf6;color:#232323}
.search-input:focus{outline:none;border-color:var(--amber)}
.gold-btn{background:var(--amber)!important;color:#241a08!important;font-weight:800}
.search-panel{background:#f7f3e8;border:1.5px solid #d8d0ba;border-radius:12px;padding:10px 12px;margin-bottom:12px}
.search-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.search-count{font-weight:800;font-size:.9rem;color:#6c6449}
.search-none{color:#6c6449;font-size:.92rem;margin:4px 0}
.search-list{max-height:230px;overflow-y:auto;display:flex;flex-direction:column;gap:4px}
.search-hit{display:flex;gap:8px;align-items:flex-start;font-size:.9rem;line-height:1.55;padding:4px 6px;border-radius:8px;cursor:pointer}
.search-hit:hover{background:#efe9d8}
.search-hit input{margin-top:4px;accent-color:var(--amber)}
.search-snip{cursor:pointer}
.scroll-sent.hit{background:#fff3c9;box-shadow:0 2px 0 var(--amber)}
.trace-bar{display:flex;gap:10px;align-items:center;background:#e8f7e3;border:1.5px solid #9ed18c;border-radius:12px;padding:8px 14px;margin-bottom:10px;font-size:.92rem;flex-wrap:wrap}
.scroll-sent.trace-hit{background:#d3f7c6!important;font-weight:800;box-shadow:0 2px 0 #5cae4a}
.term.traceable,.rules .traceable{cursor:pointer}
.term.traceable:hover{color:var(--amber);text-decoration:underline}
.rules .traceable:hover{background:#fdeed3;border-radius:6px}
.note-pin{cursor:pointer;font-size:.72em;margin-inline-start:2px;color:#b3661f;font-weight:800}
.note-pin:hover{color:var(--amber);text-decoration:underline}
.scroll-sent.has-note{border-bottom:1.5px dashed #d8b06a}
@keyframes noteflash{0%{background:#ffe08a}100%{background:transparent}}
.scroll-sent.flash{animation:noteflash 1.5s ease-out}
.quiz-size-row{display:flex;gap:12px;justify-content:center;margin:14px 0;flex-wrap:wrap}
.quiz-size-btn{font-family:inherit;font-size:1.3rem;font-weight:800;width:64px;height:64px;border-radius:14px;border:2px solid var(--key-edge);background:var(--key);color:#fff;cursor:pointer;transition:all .15s}
.quiz-size-btn:hover{border-color:var(--amber);background:#232c52;transform:translateY(-2px)}
.quiz{display:flex;flex-direction:column;gap:24px}
.quiz-score{background:#232323;color:#fff;border-radius:12px;padding:12px 20px;text-align:center;font-weight:800;font-size:1.05rem}
.quiz-prev{background:#eee8d5;color:#6c6449;border-radius:10px;padding:8px 14px;font-size:.88rem;text-align:center}
.quiz-text{font-weight:800;margin-bottom:10px;line-height:1.6}
.quiz-opts{display:flex;flex-direction:column;gap:8px}
.quiz-opt{
  text-align:start;border:1.5px solid #cfc8b4;background:#fffdf6;border-radius:10px;padding:10px 14px;
  font-family:'Heebo',sans-serif;font-size:.98rem;cursor:pointer;line-height:1.5;color:var(--ink);
}
.quiz-opt:hover:not(:disabled){border-color:var(--amber)}
.quiz-opt:disabled{cursor:default}
.quiz-opt.right{border-color:#3f9d6b;background:#e7f5ec}
.quiz-opt.wrong{border-color:#c96a4e;background:#fbe6e0}
.quiz-exp{margin-top:8px;color:var(--ink-soft);font-size:.92rem;line-height:1.6;border-inline-start:3px solid var(--amber);padding-inline-start:10px}
 
/* כרטיסיות */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}
.card{background:none;border:none;padding:0;cursor:pointer;perspective:900px;min-height:130px;font-family:'Heebo',sans-serif}
.card-inner{
  position:relative;display:block;width:100%;height:100%;min-height:130px;
  transition:transform .5s;transform-style:preserve-3d;
}
.card.flipped .card-inner{transform:rotateY(180deg)}
.card-face{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;
  border-radius:12px;padding:14px;line-height:1.5;backface-visibility:hidden;font-size:.95rem;
}
.card-face.front{background:#fffdf6;border:1.5px solid #d8b06a;font-weight:800;color:var(--ink)}
.card-face.back{background:#232323;color:#fff;transform:rotateY(180deg)}
.cards-hint{grid-column:1/-1;text-align:center;color:#8a8467;font-size:.85rem;margin-top:4px}
@media (prefers-reduced-motion: reduce){.card-inner{transition:none}}
 
/* מגילה רציפה — לימוד גמיש */
.scrolly-wrap{display:flex;flex-direction:column;gap:12px;position:relative;min-height:100%}
.ghost-btn.scrolly{align-self:flex-start;border-style:dashed;color:#7a5410;border-color:#d8b06a;font-weight:700}
.flex-bar{display:flex;gap:8px;flex-wrap:wrap;position:sticky;top:-26px;background:var(--paper);padding:6px 0;z-index:3}
.mini-btn{
  border:1.5px solid #cfc8b4;background:#fffdf6;border-radius:20px;padding:6px 14px;
  font-family:'Heebo',sans-serif;font-weight:600;font-size:.85rem;color:#5a5647;cursor:pointer;
}
.mini-btn:hover{border-color:var(--amber)}
.mini-btn.on{background:#232323;color:#fff;border-color:#232323}
.mini-btn.gold{background:var(--amber);border-color:var(--amber-deep);color:#241a08;font-weight:700}
.mini-btn.danger{color:#8c3a25;border-color:#e2a493}
.flex-hint{color:#8a8467;font-size:.85rem;line-height:1.5}
.scroll-text{display:flex;flex-direction:column;gap:2px;padding-bottom:70px}
.scroll-para{line-height:2.05;font-size:1.06rem;color:#232323;padding:6px 8px;border-radius:8px;white-space:pre-wrap}
.scroll-sent{border-radius:6px;padding:1px 2px;transition:background .12s}
.scroll-sent.clickable{cursor:pointer}
/* סימון קטע: ריחוף = מסגרת עדינה בלבד · הקטע = שטיפה בהירה + קו דק מימין · התחלה ⌈ וסוף ⌋ עם תוויות · תצוגה מקדימה חיוורת */
.scroll-sent.clickable:hover{box-shadow:0 0 0 1px #e6d3a6 inset}
.scroll-sent.in-range{background:#fbf5e4;box-shadow:-3px 0 0 #e8c882}
.scroll-sent.sel-pre{background:#fcf9f0;box-shadow:-3px 0 0 #f1e2bd}
.scroll-sent.sel-wait{background:#fbf0d6}
.scroll-sent.sel-a::before,.scroll-sent.sel-z::after{font-family:'Heebo',sans-serif;font-size:.6rem;font-weight:700;letter-spacing:.02em;color:#fff;background:var(--amber);border-radius:4px;padding:1px 5px;vertical-align:middle;margin:0 3px;white-space:nowrap;line-height:1.2}
.scroll-sent.sel-a::before{content:var(--sel-a,"⌈ התחלה")}
.scroll-sent.sel-z::after{content:var(--sel-z,"סוף ⌋")}
.scroll-sent.sel-pre.sel-z::after{content:var(--sel-q,"סוף?");background:#e3cfa0}
.scroll-sent.sel-wait.sel-a::before{content:var(--sel-w,"⌈ התחלה · לחץ על משפט הסוף")}
.scroll-sent.was-read{color:#6c6449}
.bookmark-line{
  display:flex;align-items:center;gap:8px;color:#1e7c6d;font-weight:700;font-size:.85rem;
  border-top:2px dashed var(--teal);margin:6px 0;padding-top:4px;
}
.flex-actions{
  position:sticky;bottom:-26px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;
  background:#fffdf6;border:1.5px solid var(--amber);border-radius:12px;padding:10px 14px;
  box-shadow:0 -6px 18px rgba(0,0,0,.08);z-index:4;
}
.flex-actions-label{font-size:.85rem;color:#5a5647;font-weight:600}
.flex-panel{display:flex;flex-direction:column;gap:14px;padding:6px 0}
.flex-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:2px solid var(--amber);padding-bottom:8px;color:#232323}
 
/* קריאה — טקסט הפרק */
.read{display:flex;flex-direction:column;gap:16px}
.read-sents{white-space:normal}
.read-sents:has(.kara-now){padding-bottom:60vh}
.read-sents .scroll-para{padding:0;margin:0 0 14px}
/* 📖 המילון הארמי: המילה למעלה, הפירוש העברי קטן מתחתיה */
.gl-w{display:inline-flex;flex-direction:column;align-items:center;vertical-align:baseline;line-height:1.1;margin:0 .04em}
.gl-top{white-space:nowrap}
.gl-t{font-family:'Heebo',sans-serif;font-weight:400;font-size:.44em;line-height:1.1;color:#8a6a2a;white-space:nowrap;margin-top:2px;max-width:9em;overflow:hidden;text-overflow:ellipsis;direction:rtl}
.scroll-para:has(.gl-w){line-height:1.75}
.kara-now .gl-t{color:#5c4410}
.gloss-btn.busy{animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
.scroll-para.zohar{font-family:'Frank Ruhl Libre',serif;font-weight:700;font-size:1.2em;color:#1a1408;margin-bottom:6px}
.vf{background:#ffe3dd;box-shadow:0 2px 0 #d9534f;border-radius:3px}
.vf-box{margin:8px 0 14px;padding:10px 12px;border:1.5px solid #e0c98f;border-radius:12px;background:#fffaf0;font-family:'Heebo',sans-serif;font-size:.9rem;color:#3a2c14}
.vf-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.vf-bar{flex:1 1 140px;height:8px;border-radius:99px;background:#eadfc6;overflow:hidden;min-width:100px}
.vf-bar i{display:block;height:100%;background:#2f8f6b}
.vf-list{margin:10px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.vf-item{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;border-radius:8px;background:#fff;border:1px solid #eadfc6}
.vf-item b{font-family:'Frank Ruhl Libre',serif;font-size:1.08em}
.vf-got{background:#ffe3dd;border-radius:4px;padding:0 4px}
.vf-want{background:#dff3e6;border-radius:4px;padding:0 4px}
.vf-in{flex:1 1 140px;font:inherit;font-family:'Frank Ruhl Libre',serif;padding:3px 8px;border:1px solid #c9b88a;border-radius:6px;background:#fff}
.scroll-para.sulam .pr{font-size:.8em;color:#a39a86;font-weight:400}
.scroll-para.sulam,.read-sents .scroll-para.sulam{color:#4d4636;border-inline-start:3px solid var(--amber);padding-inline-start:12px;margin-bottom:22px}
.read-mark-hint{margin:0}
.scan-mode-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#f2ecff;border:1.5px solid #c9b8f2;border-radius:10px;padding:10px 14px;margin:10px 0;font-size:.98rem;color:#3a2a63}
.scan-mode-title{font-weight:600}
.scan-mode-select{font-size:.95rem;padding:6px 10px;border-radius:8px;border:1.5px solid #c9b8f2;background:#fff;color:#3a2a63}
.zohar-row{background:#fff6e6;border-color:#e8c88a;color:#5a3a10}
.zohar-row .scan-mode-select{border-color:#e8c88a;color:#5a3a10}
.zohar-in{font-family:'Heebo',sans-serif;font-size:.95rem;padding:6px 10px;border-radius:8px;border:1.5px solid #e8c88a;background:#fff;color:#5a3a10;width:118px}
.zohar-in.wide{width:210px}
.zohar-in:focus{outline:none;border-color:var(--amber)}
.ch-key.smart{background:linear-gradient(180deg,#7a5cc4,#5d3fa8);border-color:#8f74d6}
.ch-key.media{background:linear-gradient(180deg,#3f6fb5,#2a4f8f);border-color:#6f96d0}
.ch-key.rec-on{background:linear-gradient(180deg,#b54848,#8f2f2f);border-color:#d07a7a;animation:recPulse 1.2s ease-in-out infinite}
.cam-btn{background:#1e5c52;color:#fff;border:1.5px solid #2a7a6e;border-radius:9px;
  padding:6px 12px;font-size:.92rem;cursor:pointer;white-space:nowrap;user-select:none}
.cam-btn:hover{background:#2a7a6e}
.rec-btn{background:linear-gradient(180deg,#3f6fb5,#2a4f8f);color:#fff;border:1.5px solid #6f96d0;
  border-radius:9px;padding:6px 14px;font-size:.95rem;cursor:pointer;white-space:nowrap}
.rec-btn:hover:not(:disabled){filter:brightness(1.12)}
.rec-btn:disabled{opacity:.6;cursor:default}
.rec-btn.stop{background:linear-gradient(180deg,#b54848,#8f2f2f);border-color:#d07a7a}
.rec-live{color:#ff8a8a;font-weight:700;font-size:.98rem;white-space:nowrap;animation:recPulse 1.2s ease-in-out infinite}
@keyframes recPulse{0%,100%{opacity:1}50%{opacity:.45}}
.trans-btn{background:#eaf3ff;border-color:#9fc3ef}
.trans-bubble{display:flex;align-items:center;gap:10px;background:#eaf3ff;border:1.5px solid #9fc3ef;
  border-radius:10px;padding:8px 12px;margin:8px 0;font-size:1.02rem;color:#1d3a5f;box-shadow:0 2px 6px rgba(30,60,110,.12)}
.trans-bubble b{color:#0d2b52}
.trans-note{color:#4a6a95;font-size:.92em}
.trans-x{margin-inline-start:auto;border:none;background:none;cursor:pointer;color:#4a6a95;font-size:1rem}
.read-title{font-size:1.25rem;font-weight:800;color:#232323;border-bottom:2px solid var(--amber);padding-bottom:10px}
.read-body{line-height:2.05;font-size:1.08rem;white-space:pre-wrap;color:#232323}
.bi-row{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;margin:4px 0 10px;padding:8px 10px;border:1px dashed #d9d2bd;border-radius:10px;font-size:.85rem;color:#6b6450}
.bi-row .mark-btn.on{background:#1b3a6b;color:#fff;border-color:#1b3a6b}
.bi-lbl{font-weight:700}
.bi-pay{margin-inline-start:auto;display:inline-flex;gap:6px;align-items:center}
.bi-msg{flex-basis:100%;color:#8a5a12}
.read-sents .scroll-para.bi-para{margin:-8px 0 16px;padding:6px 10px;background:#eef2f9;border-inline-start:3px solid #7d93bd;color:#26324a;font-size:1em}
.bi-sent{cursor:pointer;border-radius:4px}
.bi-sent.bi-mine{background:#fff3b0}
.bi-sent.bi-mine.hl-g{background:#cdeccd}.bi-sent.bi-mine.hl-p{background:#f6d3e3}
.bi-sent.peer-hl{box-shadow:inset 0 -2px 0 var(--peer,#4aa3ff)}
.bi-sent.peer-here{outline:2px dashed var(--peer,#4aa3ff);outline-offset:2px}
.bi-sent.kara-now{background:#ffe9a8}
.read-sents.bi-only .scroll-para:not(.bi-para){height:0;overflow:hidden;padding:0;margin:0;opacity:0}
.read-sents.bi-only .scroll-para.bi-para{margin:0 0 14px;background:none;border:0;padding:0;color:#232323}
.read-hint{margin-top:8px;color:#8a8467;font-size:.9rem;line-height:1.6;border-top:1px dashed #d9d2bd;padding-top:14px}
 
/* הקראה */
.reader{position:sticky;top:0;z-index:5;background:#fff8e6;border:1.5px solid #e0c98f;border-radius:12px;padding:6px 10px;display:flex;flex-direction:column;gap:4px;box-shadow:0 4px 14px rgba(60,40,0,.12)}
@media (max-width:640px){.reader .reader-hint{display:none}.reader .tts-rate input{width:70px}.reader .pill{padding:4px 10px;font-size:.82rem}}
.reader-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.reader .tts-btn{padding:6px 12px;font-size:.92rem}
.reader-pos{font-family:'IBM Plex Mono',monospace;font-size:.8rem;color:#7a5410}
.reader-note{color:#8a6a2a;font-size:.8rem}
.reader-x{margin-inline-start:auto}
.reader .pill-row{gap:6px}
/* צבעי הקריוקי: המשפט הנקרא (--kara-sent, --kara-line) והמילים שכבר נקראו (--kara-word) */
:root{--kara-sent:#fff3c9;--kara-line:#f2a33c;--kara-word:#f8d98a}
:root[data-kara="green"]{--kara-sent:#e9f8e0;--kara-line:#5cae4a;--kara-word:#b9eca3}
:root[data-kara="blue"]{--kara-sent:#e6f2fb;--kara-line:#4a90d9;--kara-word:#bfe0f7}
:root[data-kara="rose"]{--kara-sent:#fde9ef;--kara-line:#d9608a;--kara-word:#f7c3d5}
:root[data-kara="soft"]{--kara-sent:transparent;--kara-line:#c9c0a8;--kara-word:#eee7d4}
.scroll-sent.kara-now{background:var(--kara-sent);box-shadow:0 2px 0 var(--kara-line);border-radius:4px}
.kara-done{background:var(--kara-word);color:#1a1408}
.reader-slot{position:static;display:inline-flex;align-items:center;margin-inline-start:4px;flex:none}
.screen-bar{position:relative}
.screen-bar .ch-name{flex:1 1 auto;min-width:0}
.reader-bar{display:inline-flex;align-items:center;gap:4px;background:#1b2a4a;border:1px solid var(--amber);border-radius:999px;padding:2px 6px}
.rb-btn{background:transparent;border:none;color:#cfd3e6;font-size:.82rem;cursor:pointer;padding:3px 6px;border-radius:999px;line-height:1;font-family:inherit}
.rb-btn:hover{background:#2a3a62}
.rb-btn.main{background:var(--amber);color:#241a08;font-weight:800;padding:3px 9px}
.rb-btn.on{background:#2a3a62;color:var(--amber)}
.rb-pos{font-family:'IBM Plex Mono',monospace;font-size:.72rem;color:#f8c778;padding:0 4px}
.reader-pop{position:absolute;top:calc(100% + 6px);right:10px;left:auto;z-index:40;min-width:300px;max-width:min(92vw,560px);background:#fff8e6;color:#3a2c14;border:1.5px solid #e0c98f;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;box-shadow:0 10px 30px rgba(0,0,0,.35);font-family:'Heebo',sans-serif;white-space:normal;text-align:start}
.reader-pop .reader-row{flex-wrap:wrap}
@media (max-width:640px){.screen-bar{flex-wrap:wrap;row-gap:6px}.reader-slot{order:3;margin-inline-start:0}.reader-pop{left:8px;right:8px;min-width:0;max-width:none}}
.help{flex:1 1 auto;min-height:0;background:var(--paper);color:var(--ink);display:flex;flex-direction:column;overflow:clip;font-family:'Heebo',sans-serif}
.screen-body.behind-help{display:none}
.help .tts-btn{padding:6px 12px;font-size:.9rem;box-shadow:none}
.help-nav .tts-btn{white-space:nowrap}
.help-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;background:#fff8e6;border-bottom:1.5px solid #e0c98f}
.help-title{font-weight:800;color:#7a5410}
.help-body{flex:1;overflow-y:auto;padding:16px 22px 30px;display:flex;flex-direction:column;gap:12px}
.help-nav{display:flex;justify-content:space-between;align-items:center;gap:8px}
.help-h{font-family:'Frank Ruhl Libre',serif;font-weight:800;font-size:1.35rem;margin:4px 0;display:flex;align-items:center;gap:10px}
.help-h .n{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--amber);color:#241a08;font-family:'IBM Plex Mono',monospace;font-size:.9rem}
.help-text{line-height:2.1;font-size:1.1rem;white-space:pre-wrap;font-family:'Frank Ruhl Libre',serif}
.help-tip{background:#fff3c4;border-inline-start:3px solid var(--amber);border-radius:8px;padding:8px 12px;font-size:.95rem;line-height:1.7}
.help-shot{width:100%;max-width:420px;align-self:center;border:1px solid #d9d2bd;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.help-body.movie .help-shot{box-shadow:0 0 0 2px var(--amber),0 10px 30px rgba(0,0,0,.25)}
.help-dots{display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:6px}
.help-dot{width:10px;height:10px;border-radius:50%;border:1px solid #b9ad8c;background:transparent;cursor:pointer;padding:0}
.help-dot.on{background:var(--amber);border-color:var(--amber)}
.help-foot{text-align:center;color:#8a8467;font-size:.85rem}
.help-btn.on{border-color:var(--amber);color:var(--amber)}
/* ── הבמה של המדריך: הינשוף, הצילום והלייזר (צ'אט 22) ── */
.help-stage{position:sticky;top:-16px;z-index:3;display:flex;align-items:flex-end;justify-content:center;gap:4px;align-self:stretch;margin:-6px -22px 0;padding:10px 22px 8px;background:var(--paper);box-shadow:0 10px 14px -12px rgba(0,0,0,.35)}
.help-stage .help-shot{align-self:auto;width:auto;max-width:min(420px,calc(100% - 118px));max-height:min(56vh,600px)}
.help-owl{position:relative;flex:0 0 auto;width:clamp(76px,24%,120px);margin-bottom:4px;filter:drop-shadow(0 6px 10px rgba(0,0,0,.25))}
.owl{width:100%;height:auto;display:block;overflow:visible}
.owl-tip{position:absolute;left:93.3%;top:41.4%;width:2px;height:2px;pointer-events:none}
.owl-head{transition:transform .45s ease}
.owl-eyes circle{transition:cx .4s ease,cy .4s ease}
.owl-lids rect{transform-box:fill-box;transform-origin:center;transform:scaleY(0);animation:owlBlink 4.6s infinite}
.owl-lids rect:last-child{animation-delay:.05s}
@keyframes owlBlink{0%,92%,100%{transform:scaleY(0)}95%{transform:scaleY(1)}}
.owl-body{transform-origin:60px 100px;animation:owlBreath 3.4s ease-in-out infinite}
@keyframes owlBreath{0%,100%{transform:scale(1)}50%{transform:scale(1.02,1.035)}}
.owl-beak{transform-box:fill-box;transform-origin:50% 0}
.owl.talk .owl-beak{animation:owlTalk .3s ease-in-out infinite alternate}
@keyframes owlTalk{from{transform:scaleY(.55)}to{transform:scaleY(1.3)}}
.owl-laser-src{animation:lzSrc 1.1s ease-in-out infinite}
@keyframes lzSrc{0%,100%{opacity:1}50%{opacity:.45}}
.help-laser{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.lz-beam{stroke:#ff3b30;stroke-width:1.6;stroke-linecap:round;fill:none}
.lz-beam-glow{stroke:#ff3b30;stroke-width:5;opacity:.3;filter:url(#lz-glow);fill:none}
.lz-dot{fill:#ff3b30}
.lz-dot-glow{fill:#ff3b30;opacity:.35;filter:url(#lz-glow);transform-box:fill-box;transform-origin:center;animation:lzPulse 1.1s ease-in-out infinite}
@keyframes lzPulse{0%,100%{transform:scale(1);opacity:.35}50%{transform:scale(1.7);opacity:.12}}
.lz-box{fill:rgba(255,59,48,.07);stroke:#ff3b30;stroke-width:1.5;stroke-dasharray:4 3;animation:lzBox .45s ease-out}
@keyframes lzBox{from{opacity:0;stroke-width:4}to{opacity:1;stroke-width:1.5}}
.help-beat{cursor:pointer;border-radius:4px;padding:0 2px;transition:background .25s,box-shadow .25s}
.help-beat:hover{background:#fff3d6}
.help-beat.on{background:#ffe9b3;box-shadow:0 0 0 1px #e0c98f}
@media (prefers-reduced-motion:reduce){.owl-lids rect,.owl-body,.owl.talk .owl-beak,.lz-dot-glow,.owl-laser-src{animation:none}}
@media (max-width:640px){.help-stage{gap:2px;margin:-6px -16px 0;padding:6px 10px 4px}.help-stage .help-shot{max-width:calc(100% - 70px);max-height:40vh}.help-owl{width:66px}}
.reader.mini{padding:3px 8px}
.reader .tts-btn.sm{padding:4px 9px;font-size:.85rem;min-width:34px}
.kara-pick .kara-sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:middle;background:var(--sw,#f8d98a);margin-inline-end:4px}
.kara-pick[data-kara="amber"]{--sw:#f8d98a}.kara-pick[data-kara="green"]{--sw:#b9eca3}.kara-pick[data-kara="blue"]{--sw:#bfe0f7}.kara-pick[data-kara="rose"]{--sw:#f7c3d5}.kara-pick[data-kara="soft"]{--sw:#eee7d4}
.tts{display:flex;flex-direction:column;gap:18px;align-items:flex-start}
.tts-controls{display:flex;gap:10px}
.tts-btn{
  background:var(--amber);border:none;border-radius:10px;padding:12px 26px;font-size:1rem;font-weight:600;
  font-family:'Heebo',sans-serif;cursor:pointer;color:#241a08;box-shadow:0 3px 0 var(--amber-deep);
}
.tts-btn.ghost{background:transparent;border:1.5px solid #cfc8b4;box-shadow:none;color:var(--ink-soft)}
.tts-rate{display:flex;align-items:center;gap:8px;color:var(--ink-soft);font-size:.92rem}
.help-rate{white-space:nowrap}.help-rate input{width:90px}
@media (max-width:640px){.help-rate input{width:64px}}
.tts-note{color:#8a8467;font-size:.85rem;line-height:1.6}
.tts-text{
  max-height:220px;overflow-y:auto;border:1px dashed #cfc8b4;border-radius:10px;padding:14px;
  line-height:1.9;white-space:pre-wrap;font-size:.95rem;width:100%;
}
 
/* תחתית הטלוויזיה — סנטר, רמקול, נורית ורגל */
.tv-foot{display:flex;justify-content:center;padding:10px 0 2px;background:#0a0e20}
.tv-chin{
  display:flex;align-items:center;justify-content:space-between;gap:14px;
  padding:12px 18px 4px;
}
.power-led{width:9px;height:9px;border-radius:50%;background:#3a4166;box-shadow:inset 0 0 3px rgba(0,0,0,.6)}
.power-led.live{background:#ff5b5b;box-shadow:0 0 10px #ff5b5b;animation:blink 1s infinite}
.grille{display:flex;gap:4px;align-items:center}
.grille i{display:block;width:3px;height:14px;border-radius:2px;background:#2c3560}
.tv-stand{display:flex;flex-direction:column;align-items:center;margin-top:-2px}
.tv-neck{width:90px;height:16px;background:linear-gradient(180deg,#1d2444,#141a33);border:1px solid #2c3560;border-top:none;border-radius:0 0 8px 8px}
.tv-base{width:260px;height:12px;margin-top:2px;background:linear-gradient(180deg,#232a4c,#171d3a);border:1px solid #323b68;border-radius:10px;box-shadow:0 8px 18px rgba(0,0,0,.45)}
.busy-line{color:#7a5410;font-weight:700;font-size:.9rem}
.nikud-btn{font-family:'Frank Ruhl Libre',serif;font-weight:700;font-size:1.05rem;padding-bottom:3px}
/* בטלפון: 12 כפתורים לא נכנסים בשורה אחת (322px) — נגללים לשורה שנייה, וההדפסה מוסתרת (צ'אט 22: ☁ ✍️ בְּ נחתכו משמאל) */
@media (max-width:480px){.font-btns{gap:4px;margin-inline-end:6px;flex-wrap:wrap;justify-content:flex-end;row-gap:4px}.font-btn{min-width:30px}.font-btn.print-btn{display:none}}
.nikud-msg{position:fixed;bottom:calc(18px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);z-index:60;background:#1b2a4a;color:#f8c778;border:1px solid var(--amber);border-radius:999px;padding:7px 16px;font-size:.88rem;box-shadow:0 4px 18px rgba(0,0,0,.35);max-width:90vw;text-align:center}
.ch-key.gold{background:linear-gradient(180deg,#f5b95c,var(--amber));border-color:var(--amber-deep);color:#241a08}
.ch-key.gold .key-num,.ch-key.gold .key-label{color:#241a08}
.ch-key.gold:hover:not(:disabled){border-color:#8a5510}
.ch-key.green{background:linear-gradient(180deg,#25695e,#1e5c52);border-color:#2a7a6e;color:#eafff9}
.ch-key.green .key-num{color:#9fe8d9}
.brand{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:5px;color:#6e769c}
/* מקשי הסנטר (מגילה): בתוך המסגרת, קטנים ונקיים; נגיעה/ריחוף מגדילים */
.tv-chin.with-keys{padding:8px 14px 6px;gap:10px}
.tv-chin.with-keys .brand{font-size:.6rem;letter-spacing:3px}
.chin-keys{flex:1;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px;min-width:0}
.chin-key{display:inline-flex;align-items:center;gap:5px;background:linear-gradient(180deg,#212844,var(--key));border:1px solid var(--key-edge);border-radius:999px;padding:4px 10px;color:#cfd3e6;font-family:'Heebo',sans-serif;font-size:.74rem;line-height:1;cursor:pointer;transition:transform .12s,font-size .12s,border-color .15s;white-space:nowrap}
.chin-key .ck-ic{font-size:.85rem;color:var(--teal)}
.chin-key:hover,.chin-key:focus-visible{transform:scale(1.18);font-size:.86rem;border-color:var(--amber);z-index:2}
.chin-key:active{transform:scale(1.1)}
.chin-key.active{border-color:var(--amber);box-shadow:0 0 0 1px var(--amber) inset;color:#fff}
.chin-key.gold{background:linear-gradient(180deg,#f5b95c,var(--amber));border-color:var(--amber-deep);color:#241a08}
.chin-key.gold .ck-ic{color:#241a08}
.chin-sep{width:1px;height:18px;background:#2c3560;margin:0 3px}
@media (max-width:640px){.tv-chin.with-keys .grille{display:none}.tv-chin.with-keys .brand{display:none}.tv-chin.with-keys .power-led{display:none}.chin-key{padding:7px 10px;font-size:.78rem;min-height:36px}.chin-key:hover{transform:none}.tv-stand{display:none}}
.deck{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:24px;max-width:1500px}
.ch-key{
  display:flex;flex-direction:column;align-items:center;gap:4px;min-width:104px;
  background:linear-gradient(180deg,#212844,var(--key));border:1px solid var(--key-edge);
  border-radius:12px;padding:12px 14px;cursor:pointer;color:#cfd3e6;font-family:'Heebo',sans-serif;
  transition:transform .08s, border-color .15s;
}
.ch-key:hover:not(:disabled){border-color:var(--amber)}
.ch-key:active:not(:disabled){transform:translateY(2px)}
.ch-key.active{border-color:var(--amber);box-shadow:0 0 16px rgba(242,163,60,.35);color:#fff}
.ch-key.cached .key-num{color:var(--teal)}
.ch-key.newtext{border-style:dashed}
.ch-key.shelf{background:linear-gradient(180deg,#2a3560,#1d2c55);border-color:#3b4c85;text-decoration:none;color:#dbe2ff}
.ch-key.shelf .key-num{color:var(--amber)}
.ch-key.shelf:hover{border-color:var(--amber);text-decoration:none}
/* ארון הספרים → ייבוא */
.shelf-link{color:#7a5410;font-weight:700;text-decoration:none;border-bottom:1px dashed #d8b06a}
.shelf-link:hover{color:var(--amber-deep)}
.shelf-search{
  width:100%;box-sizing:border-box;border:1.5px solid #cfc8b4;background:#fffdf6;border-radius:10px;padding:10px 14px;
  font-family:'Heebo',sans-serif;font-size:1rem;color:var(--ink);margin-bottom:10px;
}
.shelf-search:focus{outline:none;border-color:var(--amber)}
.shelf-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.shelf-chips .pill{padding:5px 12px;font-size:.82rem}
.shelf-pick-head{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px}
.shelf-pick-head .book-title{font-size:1.15rem}
.shelf-screen .book-main:disabled{cursor:default;opacity:.6}
.ch-key:disabled{cursor:default;opacity:.6}
.key-num{font-family:'IBM Plex Mono',monospace;font-size:.78rem;color:var(--amber);letter-spacing:1px}
.key-label{font-size:.92rem;font-weight:600}
.ch-key:focus-visible,.pill:focus-visible,.broadcast:focus-visible,.ghost-btn:focus-visible,.quiz-opt:focus-visible,.tts-btn:focus-visible,.chapter-tab:focus-visible,.card:focus-visible,.g-row:focus-visible,.book-main:focus-visible,.del:focus-visible{
  outline:2px solid var(--teal);outline-offset:2px;
}
 
@media (max-width:640px){
  .screen-body{padding:18px}
  .masthead h1{font-size:1.5rem}
  .ch-key{min-width:88px;padding:10px}
  .term{min-width:90px}
  .g-title{white-space:normal}
}
/* ── 📱 טלפון (צ'אט 27): להגדיל את אזור התוכן. המסגרת דקה, הסרגל העליון בשורה אחת, ומקשי הערוצים מקופלים למקש אחד שנפרש ב-▴. במק (מעל 640px) אין שינוי. ── */
.keys-toggle,.sheet-only,.lbl-short,.keys-shade{display:none}
@media (max-width:640px){
  .studio{padding:4px 4px 2px;padding-top:calc(4px + env(safe-area-inset-top,0px));padding-bottom:calc(2px + env(safe-area-inset-bottom,0px))}
  .studio .bezel{padding:5px;border-radius:14px}
  .studio .screen-bar{padding:5px 8px;gap:6px;row-gap:4px}
  .studio .screen-bar .ch-num{font-size:.7rem;flex:none}
  .studio .screen-bar .ch-name{font-size:.82rem;flex:1 1 0;min-width:0}
  .studio .screen-bar .font-btns{flex:0 1 56%;min-width:0;flex-wrap:nowrap;overflow-x:auto;justify-content:flex-start;margin:0;gap:4px;scrollbar-width:none;-webkit-overflow-scrolling:touch;-webkit-mask-image:linear-gradient(to left,#000 86%,transparent);mask-image:linear-gradient(to left,#000 86%,transparent)}
  .studio .screen-bar .font-btns:dir(ltr){-webkit-mask-image:linear-gradient(to right,#000 86%,transparent);mask-image:linear-gradient(to right,#000 86%,transparent)}
  .studio .screen-bar .font-btns::-webkit-scrollbar{display:none}
  .studio .screen-bar .font-btns>*{flex:none}
  .studio .screen-bar .lang-pick{max-width:78px}
  .studio .reader-slot:empty{display:none}
  .studio .reader-slot{flex-basis:100%}
  .studio .chapter-strip{padding:3px 8px}
  .studio .chapter-tab{flex:none;max-width:160px;padding:4px 12px}
  .studio>.tv .tv-chin.with-keys{padding:5px 4px 3px}
  .chin-slot.tvkeys{flex-direction:row;flex-wrap:wrap;justify-content:center;align-items:center;gap:5px}
  .chin-slot.tvkeys .wide-only,.chin-slot.tvkeys .lbl-long{display:none}
  .chin-slot.tvkeys .keys-toggle{display:flex}
  .chin-slot.tvkeys .lbl-short{display:inline}
  .chin-slot.tvkeys .ch-deck:not(.open) .ch-key:not(.active){display:none}
  .chin-slot.tvkeys .ch-deck.open{position:fixed;left:0;right:0;bottom:0;z-index:81;margin:0;padding:14px 10px calc(14px + env(safe-area-inset-bottom,0px));gap:8px;background:linear-gradient(180deg,#1c2342,#141a34);border-top:1px solid #323b68;border-radius:18px 18px 0 0;box-shadow:0 -12px 34px rgba(0,0,0,.55)}
  .chin-slot.tvkeys .ch-deck.open .sheet-only{display:flex}
  .chin-slot.tvkeys .ch-deck.open .ch-key{padding:10px 14px;min-height:42px}
  .keys-shade{display:block;position:fixed;inset:0;z-index:80;background:rgba(5,8,20,.5)}
}
`;
  
