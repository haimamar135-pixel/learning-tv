   import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { Room, RoomEvent, Track } from "livekit-client";
import { createClient } from "@supabase/supabase-js";
import { App as CapApp } from "@capacitor/app";

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
];
 
/* פעולות במצב הגמיש (מגילה) — מופקות על הקטע שסומן */
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
 
/* ─── השער: כל קריאה שעולה כסף נושאת את הטוקן של המשתמש המחובר ───
   הפונקציות בנטליפיי (claude, transcribe) דוחות בקשה בלי טוקן (401) ובקשה
   מעבר למכסה היומית (429). כאן מצרפים את הטוקן ומתרגמים את הדחייה להודעה. */
const LOGIN_MSG = "כדי להשתמש בערוצי הלימוד יש להיכנס לחשבון — לחץ על ☁ למעלה";
async function authHeaders() {
  let token = null;
  try { token = (await supa.auth.getSession()).data?.session?.access_token || null; } catch {}
  if (!token) throw new Error(LOGIN_MSG);
  return { "Content-Type": "application/json", Authorization: "Bearer " + token };
}
const isGateError = (e) => /להיכנס לחשבון|פג|המכסה/.test(e?.message || "");
function gateError(res, data) {
  if (res.status === 401 || data?.code === "login") return new Error(data?.error?.message || LOGIN_MSG);
  if (res.status === 429 || data?.code === "quota") return new Error(data?.error?.message || "המכסה היומית נגמרה — מתחדשת בחצות");
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
    throw new Error("בעיית רשת — הבקשה לא הגיעה לשרת");
  }
 
  const raw = await res.text();
  console.log("API status:", res.status, raw.slice(0, 300));
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`השרת החזיר תשובה לא תקינה [${res.status}]: ${raw.slice(0, 160)}`);
  }
 
  const ge = gateError(res, data);
  if (ge) throw ge;
  if (data.type === "error" || data.error) {
    throw new Error(`שגיאת API [${res.status}]: ${data.error?.message || ""}`);
  }
  if (data.errorMessage) {
    throw new Error(`שגיאת שרת [${res.status}]: ${data.errorMessage}`);
  }
 
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
 
  if (!text.trim()) throw new Error(`התקבלה תשובה ריקה [${res.status}]: ${raw.slice(0, 160)}`);

  if (rawMode) return text.trim(); // מצב טקסט גולמי — בלי חילוץ JSON

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("התשובה לא הכילה JSON");
  }
  const slice = text.slice(start, end + 1).replace(/```json|```/g, "");
  try {
    return JSON.parse(slice);
  } catch {
    console.log("Raw model output:", text.slice(0, 500));
    throw new Error("ה-JSON מהמודל פגום — ייתכן שהתשובה נחתכה באמצע");
  }
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
      const when = payload.savedAt ? new Date(payload.savedAt).toLocaleString("he-IL") : "";
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
  asis: {
    label: "כפי שהוא — נאמן לדף",
    prompt:
      "לפניך צילום עמוד מספר קודש. תמלל את העמוד בנאמנות מלאה, בסדר הקריאה הנכון (ימין לשמאל, טור אחר טור, מקור לפני פירוש). אל תשמיט דבר מלבד כותרות עמוד רצות ומספרי עמוד. תקן רק שברי מילים ברורים שנוצרו מהצילום.",
  },
};

const isRetryableScanErr = (e) => /504|Timeout|timeout|פגום|נחתכה|ריקה/.test(String(e?.message || e));

async function scanPiece(spec, b64, note, mt) {
  const text = await askClaude(spec.prompt + (note || "") + "\n\nהחזר את הטקסט המפוענח בלבד.", mt, true, b64, "image/jpeg", true);
  return String(text || "").trim();
}

async function smartScanImages(files, mode, onProgress) {
  const spec = SCAN_MODES[mode] || SCAN_MODES.merged;
  let out = "";
  for (let i = 0; i < files.length; i++) {
    onProgress?.(i + 1, files.length, "");
    const img = await loadImageEl(files[i]);
    /* תמיד בחצאים: כל חצי עמוד נשלח ברזולוציה מלאה — אותיות גדולות = קריאה מדויקת */
    onProgress?.(i + 1, files.length, " · חלק עליון");
    const top = await scanPiece(spec, imgToJpegBase64(img, 1600, [0, 0.53]),
      "\nזהו החלק העליון של העמוד בלבד — פענח רק אותו, ועצור במשפט השלם האחרון שנראה במלואו.", 2000);
    onProgress?.(i + 1, files.length, " · חלק תחתון");
    const bottom = await scanPiece(spec, imgToJpegBase64(img, 1600, [0.47, 1]),
      "\nזהו החלק התחתון של העמוד בלבד. בראש התמונה ייתכנו שורות חתוכות או כאלה שכבר פוענחו — דלג עליהן והתחל מהפסקה/המשפט השלם הראשון.", 2000);
    const t = (top + "\n" + bottom).trim();
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
        rec.lang = "he-IL"; rec.continuous = true; rec.interimResults = true;
        let finalText = "", base = null;
        rec.onstart = () => { base = null; setMode("listen"); };
        rec.onresult = (ev) => {
          let interim = ""; finalText = "";
          for (let k = 0; k < ev.results.length; k++) { const r = ev.results[k]; if (r.isFinal) finalText += r[0].transcript + " "; else interim += r[0].transcript; }
          setTxt((v) => { if (base === null) base = v; return (base ? base.replace(/\s+$/, "") + " " : "") + (finalText + interim).trim(); });
        };
        rec.onerror = (ev) => { if (ev.error === "not-allowed" || ev.error === "service-not-allowed") { setMsg("אין גישה למיקרופון — אשר הרשאה בדפדפן."); } else if (ev.error !== "aborted" && ev.error !== "no-speech") setMsg("זיהוי הדיבור נכשל (" + ev.error + ") — מנסה הקלטה."); };
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
        if (blob.size < 3000) { setMode(null); setMsg("ההקלטה קצרה מדי."); return; }
        setMode("busy"); setMsg("⏳ מתמלל…");
        try { const t = await transcribe(blob); if (t) append(t); setMsg(""); }
        catch (e) { setMsg("התמלול נכשל: " + (e?.message || e)); }
        setMode(null);
      };
      live.current = { mr, iv: setInterval(() => setSec((x) => x + 1), 1000) };
      setSec(0); setMode("rec"); mr.start(1000);
    } catch { setMsg("אין גישה למיקרופון. אשר לאתר הרשאת מיקרופון ונסה שוב."); }
  };
  const node = (
    <div className="note-ed-back" onMouseDown={(e) => { if (e.target === e.currentTarget) { stopAll(); onCancel(); } }}>
      <div className="note-ed" dir="rtl" role="dialog">
        <div className="note-ed-head">📝 הערה על הקטע</div>
        {src && <div className="note-ed-src">«{src}»</div>}
        <textarea ref={ta} className="note-ed-ta" rows={4} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="כתוב כאן — או לחץ על המיקרופון ודבר" />
        <div className="note-ed-row">
          <button type="button" className={"mark-btn note-mic" + (mode ? " on" : "")} onClick={startMic} disabled={mode === "busy"}>
            {mode === "listen" ? "⏹ עצור — מקשיב…" : mode === "rec" ? `⏹ עצור (${sec} שנ׳)` : mode === "busy" ? "⏳ מתמלל…" : "🎙 דבר"}
          </button>
          <span className="note-ed-msg">{msg}</span>
        </div>
        <div className="note-ed-row note-ed-actions">
          <button type="button" className="ch-key gold note-ed-save" onClick={() => { stopAll(); onSave(txt); }}>שמור</button>
          {initial ? <button type="button" className="mark-btn" onClick={() => { stopAll(); onSave(""); }}>🗑 מחק הערה</button> : null}
          <button type="button" className="mark-btn" onClick={() => { stopAll(); onCancel(); }}>ביטול</button>
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
const shareNameOf = (user) => (user?.user_metadata?.name || (user?.email || "").split("@")[0] || "לומד");
/* 📹 חלון הווידאו של הלימוד המשותף — LiveKit (שלב ב).
   הכרטיס מגיע מ-netlify/functions/livekit-token (רק לחברי השיעור). מצלמה + מיקרופון של הלומד,
   והחברים באריחים קטנים. בטלפון: מי שמדבר גדול יותר (LiveKit מוריד רזולוציה לבד). */
function VideoPanel({ sessionId, myName, onClose }) {
  const [state, setState] = useState("connecting"); // connecting | on | error
  const [msg, setMsg] = useState("");
  const [tiles, setTiles] = useState([]); // [{id, name, local, videoTrack, audioTrack, speaking}]
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  /* גודל (3 מדרגות) ומיקום (גרירה בכותרת) — נשמרים לפעם הבאה */
  const SIZES = [220, 320, 560];
  const [sizeIdx, setSizeIdx] = useState(() => { try { const v = parseInt(localStorage.getItem("lomedtv-video-size"), 10); return v >= 0 && v <= 2 ? v : 1; } catch { return 1; } });
  const [pos, setPos] = useState(() => { try { return JSON.parse(localStorage.getItem("lomedtv-video-pos") || "null"); } catch { return null; } });
  const panelRef = useRef(null);
  const cycleSize = () => setSizeIdx((i) => { const n = (i + 1) % SIZES.length; try { localStorage.setItem("lomedtv-video-size", String(n)); } catch {} return n; });
  const onGrab = (e) => {
    if (e.target.closest("button")) return;
    const r = panelRef.current?.getBoundingClientRect(); if (!r) return;
    const p0 = e.touches ? e.touches[0] : e;
    const dx = p0.clientX - r.left, dy = p0.clientY - r.top;
    const move = (ev) => {
      const p = ev.touches ? ev.touches[0] : ev;
      const x = Math.min(Math.max(0, p.clientX - dx), window.innerWidth - r.width), y = Math.min(Math.max(0, p.clientY - dy), window.innerHeight - r.height);
      setPos({ x, y });
      if (ev.cancelable) ev.preventDefault();
    };
    const up = () => {
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move); window.removeEventListener("touchend", up);
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
        if (!res.ok) throw new Error(data?.error?.message || "שגיאה בקבלת כרטיס לחדר (" + res.status + ")");
        if (dead) return;
        room = new Room({ adaptiveStream: true, dynacast: true, videoCaptureDefaults: { resolution: { width: 640, height: 360, frameRate: 24 } } });
        roomRef.current = room;
        const evs = [RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted];
        evs.forEach((e) => room.on(e, refresh));
        room.on(RoomEvent.Disconnected, () => { if (!dead) { setState("error"); setMsg("החיבור לחדר נותק."); } });
        await room.connect(data.url, data.token);
        try { await room.localParticipant.enableCameraAndMicrophone(); }
        catch (e) { setMsg("אין גישה למצלמה/מיקרופון — אשר הרשאה בדפדפן. " + (e?.message || "")); try { await room.localParticipant.setMicrophoneEnabled(true); } catch {} }
        setState("on");
        refresh();
      } catch (e) {
        if (!dead) { setState("error"); setMsg(e?.message || String(e)); }
      }
    })();
    return () => { dead = true; try { room?.disconnect(); } catch {} roomRef.current = null; };
  }, [sessionId]);
  const toggleMic = async () => { const r = roomRef.current; if (!r) return; const next = !mic; setMic(next); try { await r.localParticipant.setMicrophoneEnabled(next); } catch {} };
  const toggleCam = async () => { const r = roomRef.current; if (!r) return; const next = !cam; setCam(next); try { await r.localParticipant.setCameraEnabled(next); } catch {} };
  const w = Math.min(SIZES[sizeIdx], window.innerWidth - 24);
  const style = pos
    ? { width: w, left: Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - w)), top: Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - 120)), bottom: "auto" }
    : { width: w };
  const node = (
    <div ref={panelRef} className="video-panel" style={style} dir="rtl">
      <div className="video-head" onMouseDown={onGrab} onTouchStart={onGrab} onDoubleClick={resetPos} title="אחוז וגרור · לחיצה כפולה: חזרה לפינה">
        <span>⋮⋮ 📹 {state === "connecting" ? "מתחבר לחדר…" : state === "error" ? "שגיאה" : `${tiles.length} בחדר`}</span>
        <span className="video-btns">
          <button className="mark-btn" onClick={cycleSize} title="גודל: קטן / בינוני / גדול">{sizeIdx === 0 ? "S" : sizeIdx === 1 ? "M" : "L"}</button>
          <button className={"mark-btn" + (mic ? "" : " off")} onClick={toggleMic} title="מיקרופון">{mic ? "🎙" : "🔇"}</button>
          <button className={"mark-btn" + (cam ? "" : " off")} onClick={toggleCam} title="מצלמה">{cam ? "📷" : "🚫"}</button>
          <button className="mark-btn" onClick={onClose} title="צא מהחדר">✕</button>
        </span>
      </div>
      {msg && <div className="video-msg">{msg}</div>}
      <div className="video-grid">
        {tiles.map((t) => <VideoTile key={t.id} tile={t} />)}
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
      <span className="video-name">{tile.local ? "אתה" : tile.name}</span>
    </div>
  );
}

function ShareBar({ share, peers, me, onTake, onFollow, onLeave, onCopy, copied, video, onVideo }) {
  const holderName = share.holder === me ? "אתה" : (peers[share.holder]?.name || share.hostName || "—");
  const online = Object.values(peers);
  return (
    <div className="share-bar" dir="rtl">
      <span className="share-title">🕯 לימוד משותף</span>
      <span className="share-code" title="קוד ההזמנה">{share.code}</span>
      <button className="mark-btn" onClick={onCopy}>{copied ? "✓ הועתק" : "🔗 העתק קישור"}</button>
      <span className="share-who">{online.length ? online.map((p) => <span key={p.uid} className="share-peer" style={{ "--c": p.color }}>{p.name}</span>) : <span className="share-wait">מחכה לחבר…</span>}</span>
      <span className="share-holder">מחזיק הדף: <b>{holderName}</b></span>
      {share.holder !== me && <button className="mark-btn" onClick={onTake}>✋ קח את הדף</button>}
      {share.holder !== me && <button className={"mark-btn" + (share.follow ? " on" : "")} onClick={onFollow}>{share.follow ? "👁 עוקב" : "👁 חופשי"}</button>}
      <button className={"mark-btn" + (video ? " on" : "")} onClick={onVideo}>{video ? "📹 סגור וידאו" : "📹 וידאו"}</button>
      <button className="mark-btn" onClick={onLeave}>✕ {share.hostId === me ? "סיים" : "צא"}</button>
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
function renderMarked(txt, mk, pend, kara) {
  const w = (mk && Array.isArray(mk.w)) ? mk.w : [];
  if (!mk && !pend && kara == null) return txt;
  const base = {};
  if (mk) {
    if (mk.b) base.fontWeight = 800;
    if (mk.u) base.textDecoration = "underline";
    if (mk.hl) base.background = HL_COLORS[mk.hl];
  }
  if (!w.length && !pend && kara == null) return <span style={base}>{txt}</span>;
  const pts = new Set([0, txt.length]);
  const clamp = (n) => Math.max(0, Math.min(n, txt.length));
  w.forEach((r) => { pts.add(clamp(r.s)); pts.add(clamp(r.e)); });
  if (pend) { pts.add(clamp(pend.s)); pts.add(clamp(pend.e)); }
  if (kara != null) pts.add(clamp(kara));
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
    const cls = [isPend ? "ws-pend" : "", done ? "kara-done" : ""].filter(Boolean).join(" ") || undefined;
    nodes.push(<span key={k} className={cls} style={Object.keys(st).length ? st : undefined}>{piece}</span>);
  }
  return nodes;
}
/* סרגל הכלים של השכבה — אותם כפתורים בכל מקום */
function MarkTools({ onMark, onNote, onClear }) {
  return (
    <>
      <span className="mark-title">✍️ שכבת הלומד:</span>
      <button className="mark-btn" style={{ fontWeight: 800 }} onClick={() => onMark({ b: 1 })}>B מודגש</button>
      <button className="mark-btn" style={{ textDecoration: "underline" }} onClick={() => onMark({ u: 1 })}>U קו תחתון</button>
      <button className="mark-btn hl-y" onClick={() => onMark({ hl: "y" })}>מרקר</button>
      <button className="mark-btn hl-g" onClick={() => onMark({ hl: "g" })}>מרקר</button>
      <button className="mark-btn hl-p" onClick={() => onMark({ hl: "p" })}>מרקר</button>
      <button className="mark-btn" onClick={onNote}>📝 הערה</button>
      <button className="mark-btn" onClick={() => onMark(null)}>✕ נקה עיצוב</button>
      <button className="mark-btn" onClick={onClear}>✕ בטל סימון</button>
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
    <div ref={ref} className={"mark-bar floating" + (pos ? (pos.flip ? " below" : " above") : " parked")} style={style} dir="rtl">
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
];
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
        <button className={"pill " + (mode === "long" ? "on" : "")} onClick={() => setMode("long")}>מפורט</button>
        <button className={"pill " + (mode === "short" ? "on" : "")} onClick={() => setMode("short")}>קצר</button>
      </div>
      {layer ? L(mode, mode === "long" ? data.long : data.short, { className: "prose" }) : <p className="prose">{mode === "long" ? data.long : data.short}</p>}
      {data.forQuestion && question && (
        <div className="my-q my-q-answer">
          <span className="my-q-ic">❓</span>
          <span className="my-q-body">
            <small>לשאלה שאתה נושא — «{question}»</small>
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
      {onTrace && <p className="fm-hint">💡 לחיצה על מושג או כלל קופצת למקור בטקסט ומסמנת אותו בירוק.</p>}
      {data.concepts?.length > 0 && (
        <section>
          <h3 className="sec-title">מושגים</h3>
          {data.concepts.map((c, i) => (
            <div className="term-row" key={i}>
              <span
                className={"term" + (onTrace ? " traceable" : "")}
                onClick={onTrace ? () => onTrace(c.term) : undefined}
                title={onTrace ? "הצג את המקור בטקסט" : undefined}
              >{c.term}</span>
              {layer ? L("c" + i, c.definition, { as: "span", className: "def" }) : <span className="def">{c.definition}</span>}
            </div>
          ))}
        </section>
      )}
      {data.rules?.length > 0 && (
        <section>
          <h3 className="sec-title">כללים ועקרונות</h3>
          <ul className="rules">
            {data.rules.map((r, i) => (
              <li
                key={i}
                className={onTrace && !layer ? "traceable" : undefined}
                onClick={onTrace && !layer ? () => onTrace(r) : undefined}
                title={onTrace && !layer ? "הצג את המקור בטקסט" : undefined}
              >{layer ? <>{L("r" + i, r, { as: "span" })}{onTrace && <button className="trace-btn" title="הצג את המקור בטקסט" onClick={() => onTrace(r)}>↪ למקור</button>}</> : r}</li>
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

  const down = (id) => (e) => {
    e.preventDefault();
    moved.current = false;
    drag.current = { id, dx: pos[id].x - e.clientX, dy: pos[id].y - e.clientY };
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    moved.current = true;
    setPos((p) => ({ ...p, [d.id]: { x: e.clientX + d.dx, y: e.clientY + d.dy } }));
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
    <div className="fm-wrap">
      <p className="fm-hint">✋ גרור צמתים · לחיצה על ענף ראשי פותחת/סוגרת · <button className="mini-btn" onClick={() => { setPos(layout); setClosed({}); }}>🔄 סידור מחדש</button></p>
      <div className="fm-canvas" style={{ height: H }} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
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
      </div>
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
        <div className="quiz-prev">ציון קודם בפרק זה: {saved.score}/{saved.total}</div>
      )}
      {finished && (
        <div className="quiz-score">
          הציון שלך: {score} מתוך {qs.length} — הפרק סומן כהושלם ✓
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
      <p className="cards-hint">לחיצה על כרטיסייה הופכת אותה{layer?.on ? " · ✍️ לסימון והערה: פתח כרטיסייה כטקסט" : ""}</p>
      {layer?.on && (
        <div className="card-open">
          <select className="scan-mode-select" value={open ?? ""} onChange={(e) => setOpen(e.target.value === "" ? null : +e.target.value)} aria-label="כרטיסייה לסימון">
            <option value="">✍️ פתח כרטיסייה כטקסט…</option>
            {(data.cards || []).map((c, i) => <option key={i} value={i}>{i + 1}. {c.front.slice(0, 60)}</option>)}
          </select>
          {open !== null && data.cards?.[open] && (
            <div className="card-open-body">
              <div className="card-open-face"><b>שאלה:</b> {L("f" + open, data.cards[open].front)}</div>
              <div className="card-open-face"><b>תשובה:</b> {L("b" + open, data.cards[open].back)}</div>
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
function HelpView({ onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [k, setK] = useState(() => { try { return +sessionStorage.getItem("lomedtv-help-k") || 0; } catch { return 0; } });
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => { fetch("/guide/steps.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : Promise.reject(new Error(r.status))).then(setData).catch((e) => setErr("המדריך לא נטען: " + e.message)); }, []);
  useEffect(() => { try { sessionStorage.setItem("lomedtv-help-k", String(k)); } catch {} window.speechSynthesis?.cancel(); setSpeaking(false); }, [k]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  const steps = data?.steps || [];
  const st = steps[k];
  const speak = () => {
    const synth = window.speechSynthesis; if (!synth || !st) return;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(speakable(`${st.title}. ${st.text} ${st.tip || ""}`).text);
    u.lang = "he-IL"; const v = pickHebrewVoice(synth); if (v) u.voice = v;
    u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
    synth.speak(u); setSpeaking(true);
  };
  return (
    <div className="help" dir="rtl" role="dialog" aria-label="המדריך">
      <div className="help-head">
        <span className="help-title">❔ המדריך · {steps.length ? `${k + 1} / ${steps.length}` : ""}</span>
        <button className="tts-btn sm" onClick={onClose}>↩ חזרה ללימוד</button>
      </div>
      {err && <div className="err">{err}</div>}
      {!data && !err && <div className="idle"><div className="idle-mark spin">✳</div><p>טוען את המדריך…</p></div>}
      {st && (
        <div className="help-body">
          <div className="help-nav">
            <button className="tts-btn ghost sm" onClick={() => setK((x) => Math.max(0, x - 1))} disabled={k === 0}>→ הקודם</button>
            <button className={"tts-btn sm " + (speaking ? "" : "ghost")} onClick={speak}>{speaking ? "⏹ עצור" : "🔊 הקרא"}</button>
            <button className="tts-btn ghost sm" onClick={() => setK((x) => Math.min(steps.length - 1, x + 1))} disabled={k >= steps.length - 1}>הבא ←</button>
          </div>
          <h2 className="help-h"><span className="n">{k + 1}</span>{st.title}</h2>
          <p className="help-text">{st.text}</p>
          {st.tip && <div className="help-tip">💡 {st.tip}</div>}
          {st.shot && <img className="help-shot" src={"/guide/shots/" + st.shot} alt={st.title} loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
          <div className="help-dots">{steps.map((x, i) => <button key={x.id} className={"help-dot " + (i === k ? "on" : "")} onClick={() => setK(i)} title={x.title} />)}</div>
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
function pickHebrewVoice(synth) {
  const vs = (synth?.getVoices?.() || []).filter((v) => v.lang && v.lang.toLowerCase().startsWith("he"));
  const score = (v) => (/premium/i.test(v.voiceURI + v.name) ? 3 : /enhanced/i.test(v.voiceURI + v.name) ? 2 : /compact/i.test(v.voiceURI) ? 0 : 1);
  return vs.sort((a, b) => score(b) - score(a))[0] || null;
}
/* 🎙 קול איכותי: חתיכות של עד ~1,200 תווים (טקסט מנוקה), כל חתיכה = קובץ MP3 + זמני תווים.
   מפתח החתיכה כולל תמצית של הטקסט: אותו פרק באותו מצב = אותם קבצים, גם במכשיר אחר (דרך הענן). */
const TTS_CHUNK = 1200;
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
function Reader({ items, question, startAt, onPos, onClose, store, uid, ttsMeta, onTtsMeta }) {
  /* items: [{i, kind, text}] — המשפטים של הפרק בסדר הדף; kind = "zohar" | "sulam" | "" */
  const hasSulam = items.some((x) => x.kind === "sulam");
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
    setHqBusy(`🎙 מפיק קול… חלק ${n + 1} מתוך ${chunks.length}`);
    const data = await postJson("/.netlify/functions/tts", { text: c.text });
    if (data.error) throw new Error(data.error.message || "שגיאה בהפקת הקול");
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
    a.onerror = () => { setHqErr("הקובץ לא ניתן לנגינה"); setState("idle"); };
    const seekTo = startPart ? (got.times[startPart.off] || 0) : 0;
    const go = () => { a.currentTime = seekTo; a.play().catch((e) => setHqErr("הדפדפן חסם נגינה: " + e.message)); };
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
    u.lang = "he-IL"; u.rate = rateRef.current;
    const v = pickHebrewVoice(synth); if (v) u.voice = v;
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
      const uq = new SpeechSynthesisUtterance(`השאלה שאתה נושא איתך: ${question}. הקשב לפרק מתוך השאלה הזאת.`);
      uq.lang = "he-IL"; uq.rate = rateRef.current; const v = pickHebrewVoice(synth); if (v) uq.voice = v;
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
  const KARA = [["amber", "ענבר"], ["green", "ירוק"], ["blue", "תכלת"], ["rose", "ורוד"], ["soft", "עדין"]];
  /* הנגן יושב בשורת המסך העליונה (ליד הכותרת, מימין לענן): שורה קטנה תמיד; ▾ פותח לוח מתחתיה עם קצב, צבע ומה להקריא */
  const slot = typeof document !== "undefined" ? document.getElementById("reader-slot") : null;
  const ui = !synth ? <span className="reader-note">הדפדפן הזה לא תומך בהקראה.</span> : (
    <span className="reader-bar" dir="rtl">
      {state === "playing"
        ? <button className="rb-btn main" onClick={pause} title="השהה">⏸</button>
        : <button className="rb-btn main" onClick={() => play()} title={state === "paused" ? "המשך" : "הקרא"}>▶</button>}
      <button className="rb-btn" onClick={() => step(-1)} title="משפט קודם">⏮</button>
      <button className="rb-btn" onClick={() => step(1)} title="משפט הבא">⏭</button>
      <span className="rb-pos">{hqBusy ? "🎙…" : (hq ? "🎙 " : "") + (pos >= 0 ? `${pos + 1}/${queue.length}` : queue.length)}</span>
      <button className={"rb-btn " + (!mini ? "on" : "")} onClick={() => setMini((m) => !m)} title={mini ? "הגדרות ההקראה" : "סגור הגדרות"}>{mini ? "▾" : "▴"}</button>
      <button className="rb-btn" onClick={() => { stop(); onClose?.(); }} title="סגור את ההקראה">✕</button>
      {!mini && (
        <div className="reader-pop" dir="rtl">
          <div className="reader-row">
            <label className="tts-rate">קצב <input type="range" min="0.6" max="1.6" step="0.1" value={rate} onChange={(e) => setRate(+e.target.value)} /> {rate.toFixed(1)}×</label>
            <button className="tts-btn ghost sm" onClick={stop} title="עצור וחזור להתחלה">⏹ מההתחלה</button>
          </div>
          <div className="reader-row">
            <button className={"pill " + (hq ? "on" : "")} onClick={() => { setHqErr(""); setHq((v) => !v); }} title="קול אנושי מ-ElevenLabs — מופק פעם אחת ונשמר">🎙 קול איכותי {hq ? "· דולק" : ""}</button>
            <span className="reader-note">{hq ? (uid ? `${chunks.length} חלקים · מופק פעם אחת ונשמר במכשיר ובענן` : "להיכנס לחשבון (☁) כדי להפיק") : "קול הדפדפן (חינם)"}</span>
          </div>
          {hqBusy && <div className="reader-note busy-line">{hqBusy}</div>}
          {hqErr && <div className="err">{hqErr}</div>}
          <div className="reader-row pill-row">
            <span className="reader-note">צבע ההארה:</span>
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
          <div className="reader-note">לחיצה על משפט בדף מתחילה את ההקראה ממנו · המשפט הנקרא מואר, המילים שנקראו מתמלאות</div>
        </div>
      )}
    </span>
  );
  if (slot) return createPortal(ui, slot);
  return (
    <div className="reader" dir="rtl">
      <div className="reader-row">
        {state === "playing"
          ? <button className="tts-btn" onClick={pause}>⏸ השהה</button>
          : <button className="tts-btn" onClick={() => play()}>▶ {state === "paused" ? "המשך" : "הקרא"}</button>}
        <button className="tts-btn ghost" onClick={() => step(-1)} title="משפט קודם">⏮</button>
        <button className="tts-btn ghost" onClick={() => step(1)} title="משפט הבא">⏭</button>
        <button className="tts-btn ghost" onClick={stop}>⏹</button>
        <span className="reader-pos">{pos >= 0 ? `${pos + 1} / ${queue.length}` : `${queue.length} משפטים`}</span>
        <label className="tts-rate">קצב <input type="range" min="0.6" max="1.6" step="0.1" value={rate} onChange={(e) => setRate(+e.target.value)} /> {rate.toFixed(1)}×</label>
        <button className="tts-btn ghost sm" onClick={() => setShowColors((v) => !v)} title="צבעי ההארה">🎨</button>
        <button className="tts-btn ghost sm" onClick={() => setMini(true)} title="כווץ את הנגן">▴</button>
        <button className="tts-btn ghost reader-x" onClick={() => { stop(); onClose?.(); }} title="סגור את הנגן">✕</button>
      </div>
      {showColors && (
        <div className="reader-row pill-row">
          <span className="reader-note">צבע ההארה:</span>
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
      <div className="reader-note reader-hint">לחיצה על משפט בדף מתחילה את ההקראה ממנו · המשפט הנקרא מואר, המילים שנקראו מתמלאות</div>
    </div>
  );
}

function TTSView({ text, question }) {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => () => window.speechSynthesis?.cancel(), [text]);

  /* ההקראה פותחת בשאלה שהלומד נושא — כדי שיקשיב לפרק מתוכה */
  const spoken = question ? `השאלה שאתה נושא איתך: ${question}. הקשב לפרק מתוך השאלה הזאת. ... ${text}` : text;

  const play = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (paused) { synth.resume(); setPaused(false); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(spoken);
    u.lang = "he-IL";
    u.rate = rate;
    const heVoice = synth.getVoices().find((v) => v.lang && v.lang.startsWith("he"));
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
          <button className="tts-btn" onClick={play}>▶ {paused ? "המשך" : "הקרא"}</button>
        ) : (
          <button className="tts-btn" onClick={() => { window.speechSynthesis?.pause(); setPaused(true); }}>⏸ השהה</button>
        )}
        <button className="tts-btn ghost" onClick={() => { window.speechSynthesis?.cancel(); setSpeaking(false); setPaused(false); }}>⏹ עצור</button>
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
      <p className="tts-note">ההקראה משתמשת בקולות הדפדפן — איכות העברית תלויה במכשיר. מוקרא הפרק הנוכחי בלבד.</p>
      {question && (
        <div className="my-q my-q-answer">
          <span className="my-q-ic">❓</span>
          <span className="my-q-body"><small>ההקראה פותחת בשאלה שאתה נושא</small>{question}</span>
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
  catch { throw new Error("בעיית רשת — הבקשה לא הגיעה לשרת"); }
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`השרת החזיר תשובה לא תקינה [${res.status}]: ${raw.slice(0, 160)}`); }
  const ge = gateError(res, data);
  if (ge) throw ge;
  if (!res.ok || data.error) throw new Error(data.error?.message || `שגיאה [${res.status}]`);
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
  const [index, setIndex] = useState([]);
  const [book, setBook] = useState(null);
  const [chIdx, setChIdx] = useState(0);
  const [channel, setChannel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [staticFx, setStaticFx] = useState(false);
  const [deleteArm, setDeleteArm] = useState(null);
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
  const [smartMode, setSmartMode] = useState("merged"); // תבנית צלם דף חכם
  const [layerOn, setLayerOn] = useState(() => { try { return localStorage.getItem("lomedtv-layer") !== "off"; } catch { return true; } }); // ✍️ שכבת הלומד מוצגת?
  /* 🔊 הקראה כקריוקי: הנגן פתוח מעל טקסט הפרק; readPos = {i, c} המשפט והתו שנקראים עכשיו */
  const [helpOn, setHelpOn] = useState(false); // ❔ המדריך מעל המסך
  const [readerOn, setReaderOn] = useState(false);
  const [readPos, setReadPos] = useState(null);
  const [readerStart, setReaderStart] = useState(null);
  const readSentRef = useRef(null);
  useEffect(() => {
    const i = readPos?.i;
    if (i == null || readSentRef.current === i) return;
    readSentRef.current = i;
    const el = document.querySelector(`.read-sents [data-si="${i}"]`);
    const sb = el?.closest(".screen-body");
    if (!el || !sb) return;
    const rd = sb.querySelector(".reader");
    const top = el.getBoundingClientRect().top - sb.getBoundingClientRect().top + sb.scrollTop - (rd ? rd.offsetHeight : 0) - 40;
    sb.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [readPos?.i]);
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
  const [cloudCode, setCloudCode] = useState("");      // קוד כניסה מהמייל (מובייל)
  const [cloudSent, setCloudSent] = useState(false);   // נשלח מייל — להציג שדה קוד
  useEffect(() => {
    supa.auth.getSession().then(({ data }) => setCloudUser(data?.session?.user || null));
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
            setCloudMsg(error ? "שגיאת כניסה: " + error.message : "✅ מחובר!");
          } else if (code) {
            const { error } = await supa.auth.exchangeCodeForSession(code);
            setCloudMsg(error ? "שגיאת כניסה: " + error.message : "✅ מחובר!");
          } else if (params.get("error_description")) {
            setCloudMsg("שגיאת כניסה: " + params.get("error_description"));
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
    if (!email || !email.includes("@")) { setCloudMsg("כתובת מייל לא תקינה"); return; }
    setCloudMsg("שולח קישור...");
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: IS_NATIVE ? "lomedtv://auth" : window.location.origin },
    });
    if (error) { setCloudMsg("שגיאה: " + error.message); return; }
    setCloudSent(true);
    setCloudMsg(IS_NATIVE
      ? "✅ נשלח! פתח את המייל בטלפון ולחץ על הקישור — האפליקציה תיפתח מחוברת. (אם יש במייל קוד — אפשר גם להזין אותו כאן)"
      : "✅ נשלח! פתח את המייל שלך ולחץ על הקישור — תחזור לכאן מחובר.");
  }
  /* כניסה עם קוד מהמייל — הדרך במובייל, שם הקישור נפתח בדפדפן ולא באפליקציה.
     דורש שתבנית המייל ב-Supabase תכלול את {{ .Token }}. */
  async function verifyCode() {
    const email = cloudEmail.trim();
    const token = cloudCode.replace(/\D/g, "");
    if (!email || token.length < 6) { setCloudMsg("הזן את המייל ואת הקוד בן 6 הספרות מהמייל"); return; }
    setCloudMsg("בודק קוד...");
    const { error } = await supa.auth.verifyOtp({ email, token, type: "email" });
    if (error) { setCloudMsg("הקוד לא התקבל: " + error.message); return; }
    setCloudCode("");
    setCloudSent(false);
    setCloudMsg("✅ מחובר!");
  }
  async function cloudSignOut() {
    await supa.auth.signOut();
    setCloudMsg("");
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
      setSyncErr(e.message || "שגיאת סנכרון");
    }
  }
  function queueSync(job) {
    if (!cloudRef.current) return;
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
      setCloudMsg("קורא את הספרייה המקומית...");
      const idx = await loadIndex();
      if (!idx.length) { setCloudMsg("אין ספרים מקומיים להעלאה."); setMigrating(false); return; }
      let nBooks = 0, nOutputs = 0, nNotes = 0;
      for (let i = 0; i < idx.length; i++) {
        const b = await loadBook(idx[i].id);
        if (!b) continue;
        setCloudMsg("מעלה ספר " + (i + 1) + "/" + idx.length + ": " + (b.title || "") + "...");
        try {
          const r = await pushWholeBook(b, cloudUser.id);
          nBooks++;
          nOutputs += r.outputs;
          nNotes += r.notes;
        } catch (e) {
          throw new Error('ספר "' + (b.title || "") + '": ' + e.message);
        }
      }
      setCloudMsg("✅ ההעלאה הושלמה! " + nBooks + " ספרים · " + nOutputs + " תוצרים · " + nNotes + " הערות — שמורים בענן.");
    } catch (e) {
      setCloudMsg("שגיאה בהעלאה: " + e.message);
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
    if (!b) throw new Error("הספר לא נמצא בענן");
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
          if (!localIds.has(c.id)) return true; // ספר שאין כאן בכלל
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
        setSyncErr(e.message || "בדיקת הענן נכשלה");
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
        setPullMsg("מוריד " + (i + 1) + "/" + list.length + ": " + (list[i].title || "") + "...");
        const { book: nb, updatedAt } = await pullBook(list[i].id, cloudUser.id);
        const entry = { id: nb.id, title: nb.title, chapters: nb.chapters.length, done: doneCount(nb), talk: talkCount(nb), updatedAt };
        idx = [entry, ...idx.filter((b) => b.id !== nb.id)];
        if (book && book.id === nb.id) setBook(nb);
      }
      await saveIndex(idx);
      setIndex(idx);
      setPullMsg("✅ הורדו " + list.length + " ספרים מהענן.");
      setPullList(null);
      setSyncState("ok");
      if (view === "intake" && idx.length) setView("library");
    } catch (e) {
      setPullMsg("שגיאה בהורדה: " + e.message);
    }
    setPulling(false);
  }

  /* כפתור ידני בחלון החשבון — למכשיר חדש, או כשרוצים לרענן ביוזמה. */
  async function manualPull() {
    if (!cloudUser) return;
    setCloudMsg("בודק מה יש בענן...");
    try {
      const cloud = await fetchCloudIndex(cloudUser.id);
      if (!cloud.length) { setCloudMsg("אין ספרים בענן עדיין."); return; }
      setCloudMsg("");
      setShowCloud(false);
      setPullMsg("");
      setPullList(cloud.map((c) => ({ ...c, isNew: false, manual: true })));
    } catch (e) {
      setCloudMsg("שגיאה: " + e.message);
    }
  }
 
  /* כל טקסט הספר כמשפטים (מקובצים לפסקאות) — למצב המגילה.
     סימון ברמת משפט: כל לחיצה בוחרת משפט, כך שאפשר לסמן קטע מדויק
     גם כשהספר נקלט כפסקה אחת ארוכה (למשל מקובץ וורד). */
  const { sentences, paraGroups, chapterRanges } = useMemo(() => bookSentences(book), [book?.id, book?.chapters?.length]);

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
      if (idx.some((b) => b.talk === undefined)) {
        idx = await Promise.all(idx.map(async (b) => b.talk === undefined ? { ...b, talk: talkCount(await loadBook(b.id)) } : b));
        await saveIndex(idx);
      }
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
  const shareChanRef = useRef(null);
  const shareRef = useRef(null);
  useEffect(() => { shareRef.current = share; }, [share]);
  const myUid = cloudUser?.id || null;
  const myShareColor = (uid) => SHARE_COLORS[Math.abs([...(uid || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % SHARE_COLORS.length];
  const shareSend = (event, payload) => { try { shareChanRef.current?.send({ type: "broadcast", event, payload: { ...payload, from: cloudRef.current?.id } }); } catch {} };
  const openSharedBook = async (row, isHost) => {
    const snap = row.book || {};
    let b;
    if (isHost) { b = book; }
    else {
      const id = "shared-" + row.code;
      const existing = await loadBook(id);
      b = existing || { id, title: snap.title || "לימוד משותף", chapters: snap.chapters || [], results: {}, progress: {}, marks: {}, notes: {}, flex: {} };
      await persist(b, { k: "meta" });
    }
    setShare({ id: row.id, code: row.code, hostId: row.host, hostName: row.host_name || "", holder: row.holder || row.host, follow: !isHost, bookId: b.id });
    setPeers({});
    setBook(b);
    setChIdx(0);
    setChannel("read");
    setError(null);
    setView("tv");
  };
  const startShare = async () => {
    if (!book) return;
    if (!cloudUser) { setShareMsg("להיכנס לחשבון (☁) כדי להזמין ללימוד משותף."); return; }
    setShareMsg("");
    const code = makeShareCode();
    const snap = { id: book.id, title: book.title, chapters: (book.chapters || []).map((c) => ({ title: c.title, text: c.text })) };
    const { data, error } = await supa.from("sessions").insert({ code, host: cloudUser.id, host_name: shareNameOf(cloudUser), book: snap, holder: cloudUser.id }).select("*").single();
    if (error) { setShareMsg("לא הצלחתי לפתוח שיעור: " + error.message); return; }
    await openSharedBook(data, true);
  };
  const joinShare = async (code) => {
    if (!cloudUser) { setShareMsg("להיכנס לחשבון (☁) כדי להצטרף ללימוד המשותף."); return; }
    setShareMsg("");
    const { data, error } = await supa.rpc("join_session", { p_code: code, p_name: shareNameOf(cloudUser), p_color: myShareColor(cloudUser.id) });
    if (error || !data) { setShareMsg("לא נמצא שיעור פתוח עם הקוד " + code + (error ? " (" + error.message + ")" : "")); return; }
    await openSharedBook(data, data.host === cloudUser.id);
  };
  const leaveShare = async () => {
    const sh = shareRef.current;
    if (sh && sh.hostId === myUid) { try { await supa.from("sessions").update({ status: "closed" }).eq("id", sh.id); } catch {} }
    setShare(null); setPeers({}); setShareVideo(false);
  };
  const takePage = async () => {
    const sh = shareRef.current; if (!sh || !myUid) return;
    try { await supa.from("sessions").update({ holder: myUid }).eq("id", sh.id); } catch {}
    setShare({ ...sh, holder: myUid, follow: false });
    shareSend("holder", { uid: myUid });
  };
  const toggleFollow = () => setShare((sh) => sh ? { ...sh, follow: !sh.follow } : sh);
  const copyShareLink = async () => {
    const sh = shareRef.current; if (!sh) return;
    /* באפליקציה (Capacitor) הכתובת היא capacitor://localhost — הקישור חייב להצביע על האתר */
    const url = `${IS_NATIVE ? SITE_URL + "/" : location.origin + location.pathname}?join=${sh.code}`;
    const text = `בוא נלמד יחד ב"מסך הלמידה" — "${book?.title || ""}". פתח את הקישור, היכנס עם המייל שלך, ולחץ 📹 וידאו: ${url}`;
    /* בטלפון: גיליון השיתוף (וואטסאפ וכו'); במחשב: העתקה ללוח */
    if (navigator.share && (IS_NATIVE || /iPhone|iPad|Android/i.test(navigator.userAgent))) {
      try { await navigator.share({ title: "לימוד משותף", text, url }); return; } catch (e) { if (e?.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); setShareCopied(true); setTimeout(() => setShareCopied(false), 1800); } catch { window.prompt("הקישור להזמנה:", url); }
  };
  /* הצטרפות מקישור ?join=CODE — אחרי שיש כניסה לחשבון */
  const pendingJoinRef = useRef(null);
  useEffect(() => { try { const c = new URLSearchParams(location.search).get("join"); if (c) { pendingJoinRef.current = c.toUpperCase(); history.replaceState(null, "", location.pathname); } } catch {} }, []);
  useEffect(() => {
    if (pendingJoinRef.current && cloudUser && view !== "boot") { const c = pendingJoinRef.current; pendingJoinRef.current = null; setShowOpening(false); joinShare(c); }
  }, [cloudUser, view]);
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
        for (const uid of Object.keys(st)) { if (uid === myUid) continue; const meta = st[uid][0] || {}; next[uid] = { uid, color: myShareColor(uid), marks: {}, notes: {}, ...(ps[uid] || {}), name: meta.name || ps[uid]?.name || "לומד" }; }
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
    ch.on("broadcast", { event: "hello" }, () => { const b = bookRef.current; shareSend("layer", { marks: b?.marks || {}, notes: b?.notes || {} }); });
    ch.on("broadcast", { event: "closed" }, () => { setShare(null); setPeers({}); setShareMsg("המארח סיים את הלימוד המשותף."); });
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ name: shareNameOf(cloudRef.current), color: myShareColor(myUid) });
        const b = bookRef.current;
        shareSend("layer", { marks: b?.marks || {}, notes: b?.notes || {} });
        shareSend("hello", {});
      }
    });
    return () => { if (shareRef.current?.hostId === myUid) { try { ch.send({ type: "broadcast", event: "closed", payload: {} }); } catch {} } supa.removeChannel(ch); shareChanRef.current = null; };
  }, [share?.id, myUid]);
  const bookRef = useRef(null); useEffect(() => { bookRef.current = book; }, [book]);
  const chIdxRef = useRef(0); useEffect(() => { chIdxRef.current = chIdx; }, [chIdx]);
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
      if (mk && (mk.hl || mk.b || mk.u || (mk.w && mk.w.length))) { cls += " peer-hl"; color = color || p.color; title += (title ? " · " : "") + p.name + " סימן"; }
      const n = p.notes?.[i]; const nt = typeof n === "string" ? n : n?.t;
      if (nt) { note = { name: p.name, color: p.color, t: nt }; }
      if (p.pos && p.pos.ch === chIdx && p.pos.si === i) here = p;
    }
    if (!cls && !note && !here) return null;
    return { cls: cls + (here ? " peer-here" : ""), color: color || here?.color || note?.color, title, note, here };
  };
 
  const buildBook = async (text, forcedTitle, stayInLibrary = false, presetChapters = null) => {
    const chapters = presetChapters && presetChapters.length ? presetChapters : splitToChapters(text);
    const title =
      (forcedTitle && forcedTitle.trim()) ||
      titleRef.current?.value?.trim() ||
      chapters[0].title ||
      "ספר ללא שם";
    const nb = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      title,
      chapters,
      results: {},
      progress: {},
    };
    await persist(nb, { k: "full" });
    setError(null);
    if (!stayInLibrary) {
      flick();
      setView("guide");
    }
    return nb;
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
      const title = `זוהר ${he} עם הסולם`;
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
    if (view !== "intake") return;
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
      setError("הדבק טקסט של לפחות כמה משפטים, או העלה קובץ.");
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
      setFileBusy(`קורא את "${file.name}"...`);
      try {
        const text = await extractFileText(file);
        if (!text || text.length < 40) throw new Error("לא נמצא מספיק טקסט בקובץ.");
        const base = file.name.replace(/\.[^.]+$/, "");
        setFileBusy(null);
        await buildBook(text, titleRef.current?.value?.trim() || base);
      } catch (err) {
        console.error("file extract failed", err);
        setError(err.message || "קריאת הקובץ נכשלה.");
        setFileBusy(null);
      }
      return;
    }
 
    // כמה קבצים — כל קובץ נהיה ספר בספרייה
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setFileBusy(`קורא קובץ ${i + 1}/${files.length}: "${file.name}"...`);
      try {
        const text = await extractFileText(file);
        if (!text || text.length < 40) throw new Error("אין טקסט");
        const base = file.name.replace(/\.[^.]+$/, "");
        await buildBook(text, base, true);
      } catch (err) {
        console.error("file failed:", file.name, err);
        failed.push(file.name);
      }
    }
    setFileBusy(null);
    if (failed.length) {
      setError(`נקלטו ${files.length - failed.length} ספרים. נכשלו: ${failed.join(", ")}`);
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
    setFileBusy("טוען את מנוע ה-OCR (בפעם הראשונה זה לוקח רגע)...");
    try {
      const text = await ocrImages(files, (n, total) =>
        setFileBusy(`מפענח צילום ${n}/${total}... (OCR עברית)`)
      );
      const base = files[0].name.replace(/\.[^.]+$/, "");
      const givenTitle = titleRef.current?.value?.trim();
      setFileBusy(null);
      await buildBook(text, givenTitle || "סריקה — " + base);
    } catch (err) {
      console.error("ocr failed", err);
      setError(err.message || "פענוח הצילומים נכשל.");
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
    try {
      const text = await smartScanImages(files, smartMode, (n, total, extra) =>
        setFileBusy(`📸 המנוע קורא ומארגן את הדף ${n}/${total}${extra || ""}... (עד דקה לעמוד)`)
      );
      const base = files[0].name.replace(/\.[^.]+$/, "");
      const givenTitle = titleRef.current?.value?.trim();
      setFileBusy(null);
      await buildBook(text, givenTitle || "דף חכם — " + base);
    } catch (err) {
      console.error("smart scan failed", err);
      setError(err.message || "פענוח הדף נכשל.");
      setFileBusy(null);
    }
  };

  /* זרימה משותפת לשער הקול: קובץ שנבחר או הקלטה חיה ← תמלול ← ליטוש (רשות) ← ספר */
  const processMedia = async (blob, fallbackBase) => {
    try {
      const givenTitle = titleRef.current?.value?.trim();
      const hint = givenTitle ? "תמלול בעברית. הנושא: " + givenTitle : "";
      const text0 = await transcribeMedia(
        blob,
        (n, total, extra) =>
          setFileBusy(
            n === 0 ? extra : `🎬 מתמלל חלק ${n}/${total}${extra || ""}... (עברית · Whisper)`
          ),
        hint
      );
      let text = text0;
      if (window.confirm("התמלול מוכן! להעביר אותו ליטוש חכם?\n(תיקון שגיאות שמיעה בלבד, בלי לשנות תוכן — מומלץ לשירים ולהקלטות רועשות)")) {
        text = await polishTranscript(text0, (n, total) =>
          setFileBusy(`✨ מלטש את התמלול ${n}/${total}...`)
        );
      }
      setFileBusy(null);
      await buildBook(text, givenTitle || "תמלול — " + fallbackBase);
    } catch (err) {
      console.error("transcribe failed", err);
      setError(err.message || "התמלול נכשל.");
      setFileBusy(null);
    }
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recRef.current?.iv) clearInterval(recRef.current.iv);
        recRef.current = null;
        setRecOn(false);
        const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        if (blob.size < 4000) { setError("ההקלטה קצרה מדי — נסה שוב."); return; }
        await processMedia(blob, "הקלטה חיה");
      };
      recRef.current = { mr, iv: setInterval(() => setRecSec((s) => s + 1), 1000) };
      setRecSec(0);
      setRecOn(true);
      setError(null);
      mr.start(1000);
    } catch {
      setError("אין גישה למיקרופון. אשר לאתר הרשאת מיקרופון בדפדפן ונסה שוב.");
    }
  };
  const stopRec = () => { try { recRef.current?.mr?.stop(); } catch {} };

  const openBook = async (id) => {
    const b = await loadBook(id);
    if (!b) { setError("הספר לא נמצא באחסון."); return; }
    setBook(b);
    setChannel(null);
    setError(null);
    flick();
    setView("guide");
  };
 
  /* 🎧 שיקוף — נפתח מהספרייה או מלוח השידורים של הספר */
  const openMirror = async (id) => {
    const b = id && (!book || book.id !== id) ? await loadBook(id) : book;
    if (!b) { setError("הספר לא נמצא באחסון."); return; }
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
    await saveIndex(nextIdx);
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
  const renderSentText = (plain, mk, pend, voc, kara) => {
    const txt = voc || plain;
    const cv = voc ? (r) => ({ ...r, s: nikudOff(plain, voc, r.s), e: nikudOff(plain, voc, r.e) }) : (r) => r;
    const w = ((mk && Array.isArray(mk.w)) ? mk.w : []).map(cv);
    const kc = kara == null ? null : voc ? nikudOff(plain, voc, kara) : kara;
    return renderMarked(txt, mk ? { ...mk, w } : mk, pend ? cv(pend) : pend, kc);
  };

  /* בקשה ג': סימון קטע בתצוגת הפרק (ערוץ 00) —
     לחיצה ראשונה בוחרת את משפט ההתחלה, שנייה את הסוף (סדר הפוך מתוקן אוטומטית),
     ולחיצה שלישית מתחילה סימון חדש. אותם מרקרים והערות של המגילה — אותו אחסון. */
  const onReadSentClick = (i) => {
    if (dragJustRef.current) { dragJustRef.current = false; return; }
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
    if (!hits.length) { window.alert("לא נמצא מקור מתאים בטקסט 🔍"); return; }
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
      if (!entry.t) throw new Error("לא התקבל תרגום");
      setTransRes({ q: phrase, ...entry });
      /* נשמר במילון האישי של הספר — פעם הבאה: מיידי, בלי AI */
      await persist({ ...book, flex: { ...(book.flex || {}), dict: { ...dict, [phrase]: entry } } });
    } catch (e) {
      setTransRes({ q: phrase, err: e.message });
    }
    setTransLoading(false);
  };
  const transBubble = (transLoading || transRes) && (
    <div className="trans-bubble" dir="rtl">
      {transLoading ? (
        <span>⏳ מתרגם…</span>
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
    setFlexLoading(action?.label || id);
    setFlexError(null);
    setFlexResult(null);
    try {
      const FAST_IDS = ["cards", "concepts", "flow"];
      const data = id === "quiz" ? await buildQuiz(t, qCount, openQ) : await askClaude(PROMPTS[id](t, openQ), 2000, FAST_IDS.includes(id));
      setFlexResult({ channel: id, data });
    } catch (e) {
      setFlexError(e.message || "ההפקה נכשלה. נסה שוב.");
    } finally {
      setFlexLoading(null);
    }
  };
 
  const generate = async (id, ci, qCount) => {
    if (id === "tts" || id === "read") return;
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
      setError(e.message || "השידור נכשל. נסה שוב.");
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
  const data = channel && book ? book.results[key(chIdx, channel)] : null;
  const multi = book?.chapters?.length > 1;
  const prevSummary = book && chIdx > 0 ? book.results[key(chIdx - 1, "summary")] : null;
  const nextUnfinished = book
    ? book.chapters.findIndex((_, i) => !book.progress?.[i]?.done)
    : -1;
 
  const barTitle =
    view === "tv" && active ? active.label
    : view === "tv" ? "בחר ערוץ"
    : view === "scroll" ? "מגילה · לימוד גמיש"
    : view === "guide" ? "לוח שידורים"
    : view === "library" ? "ספריית השידורים"
    : view === "mirror" ? "שיקוף · אור חוזר"
    : view === "shelf" ? "ארון הספרים · ייבוא ללימוד"
    : "קליטת טקסט";
  const barNum = view === "tv" && active ? `CH ${active.num}` : view === "scroll" ? "CH ∞" : view === "mirror" ? "CH 08" : "CH 00";
 
  return (
    <div className="studio" dir="rtl">
      <style>{css}</style>

      {/* ── הפנים: מסך הפתיחה ── */}
      {showOpening && (
        <div className="opening" dir="rtl" lang="he">
          <div className="op-brand">
            <div className="op-lamed" aria-label="למ״ד על השורה">
              <div className="row">ב ר א ש י ת</div>
              <div className="base" />
              <div className="l">ל</div>
            </div>
            <div className="op-name">מסך הלמידה<small>חברותא שלא הולכת הביתה</small></div>
          </div>

          <header className="op-hero">
            <h1>מתי בפעם האחרונה<br />ספר ענה לך בחזרה?</h1>
            <p>יש לך ספרים שאתה חוזר אליהם שנים. הידע שלך גדל — והספר לא יודע מזה כלום. עד היום.</p>
          </header>

          <div className="op-vessel">
            <label htmlFor="op-q">מה השאלה שאתה נושא איתך אל הספר?</label>
            <div className="field">
              <input
                id="op-q"
                ref={openQRef}
                type="text"
                defaultValue={openQ}
                placeholder="למשל: מה חובתי בעולמי?"
                onKeyDown={(e) => { if (e.key === "Enter") enterFromOpening(true, null); }}
              />
              <button className="go" onClick={() => enterFromOpening(true, null)}>היכנס עם השאלה</button>
            </div>
            <span className="skip">
              אפשר גם <a href="#" onClick={(e) => { e.preventDefault(); enterFromOpening(false, null); }}>להיכנס בלי שאלה</a> — היא תגיע מתוך הלימוד
            </span>
          </div>

          <div className="op-peek">
            <div className="daf">
              <div className="sefer">מסילת ישרים · פרק א — בביאור כלל חובת האדם בעולמו</div>
              <p className="torah">
                יְסוֹד הַחֲסִידוּת וְשֹׁרֶשׁ הָעֲבוֹדָה הַתְּמִימָה הוּא{" "}
                <span className="hl">שֶׁיִּתְבָּרֵר וְיִתְאַמֵּת אֵצֶל הָאָדָם מַה חוֹבָתוֹ בְּעוֹלָמוֹ</span><span className="fn">[1]</span>,
                וּלְמָה צָרִיךְ שֶׁיָּשִׂים מַבָּטוֹ וּמְגַמָּתוֹ בְּכָל אֲשֶׁר הוּא{" "}
                <span className="un">עָמֵל כָּל יְמֵי חַיָּיו</span>.
              </p>
              <div className="note"><b>[1] ההערה שלך:</b> ❓ מה בין "חובתו" ל"מגמתו" — שני דברים או אחד?</div>
              <svg className="thread" viewBox="0 0 640 290" preserveAspectRatio="none" aria-hidden="true">
                <path d="M 402 118 C 380 175, 300 150, 230 205" />
              </svg>
            </div>
            <p className="cap">הדף שלך, כמו שהוא באמת בפנים: מרקר, קו, והערה שקשורה בחוט אל השורה שלה.</p>
          </div>

          <section className="op-gates">
            <h2>חמישה שערים אל הספר</h2>
            <p className="sub">מכל מקום שבו המציאות פוגשת אותך — היא נכנסת אל הדף</p>
            <div className="gate-row">
              <button className="g" onClick={() => enterFromOpening(true, "text")}><span className="ic">＋</span><span className="t">הדבק טקסט</span></button>
              <button className="g" onClick={() => enterFromOpening(true, "photo")}><span className="ic">📷</span><span className="t">צלם דף</span></button>
              <button className="g" onClick={() => enterFromOpening(true, "rec")}><span className="ic">🎙</span><span className="t">הקלט שיעור</span></button>
              <button className="g" onClick={() => enterFromOpening(true, "video")}><span className="ic">🎥</span><span className="t">צלם וידאו</span></button>
              <button className="g" onClick={() => enterFromOpening(true, "file")}><span className="ic">🎬</span><span className="t">קובץ שמע/וידאו</span></button>
            </div>
          </section>

          <footer className="op-foot">
            <p className="serif">יש כאן מי שמחכה ללמוד איתך.</p>
            <p>בְּפִיךָ וּבִלְבָבְךָ · הלימוד קרוב</p>
            {index.length > 0 && (
              <button className="op-lib" onClick={() => enterFromOpening(false, null)}>↩ לספרייה שלי ({index.length})</button>
            )}
          </footer>
        </div>
      )}

      <header className="masthead">
        <span className="mast-dot" />
        <h1>מסך הלמידה</h1>
        <span className="mast-sub">כל טקסט הופך לשבעה ערוצי לימוד</span>
      </header>
 
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
                <button className="font-btn" onClick={() => bumpFont(-0.1)} title="הקטנת טקסט" aria-label="הקטנת טקסט">אַ−</button>
                <button className="font-btn" onClick={() => bumpFont(0.1)} title="הגדלת טקסט" aria-label="הגדלת טקסט">אַ+</button>
                <button className="font-btn" onClick={() => window.print()} title="הדפסת התוכן המוצג" aria-label="הדפסה">🖨</button>
                <button className="font-btn" onClick={downloadBackup} title="גיבוי: הורדת כל הספרים, ההערות והמרקרים לקובץ" aria-label="גיבוי">⬇</button>
                <button className="font-btn" onClick={pickRestoreFile} title="שחזור מקובץ גיבוי" aria-label="שחזור">⬆</button>
                <button className={"font-btn help-btn" + (helpOn ? " on" : "")} onClick={() => setHelpOn((v) => !v)} title={helpOn ? "חזרה ללימוד" : "המדריך: איך משתמשים"} aria-label="המדריך">❔</button>
                <button className={"font-btn layer-btn nikud-btn" + (nikudOn ? " on" : "")} onClick={toggleNikud} title={nikudOn ? "הניקוד מוצג — לחץ להסתיר" : "הוסף ניקוד לטקסט שאינו מנוקד (הסולם, פירושים)"} aria-label="ניקוד" aria-pressed={nikudOn}>בְּ</button>
                <button className={"font-btn layer-btn" + (layerOn ? " on" : "")} onClick={toggleLayer} title={layerOn ? "שכבת הלומד מוצגת — לחץ להסתיר" : "שכבת הלומד מוסתרת — לחץ להציג"} aria-label="שכבת הלומד">✍️</button>
                <button
                  className={"font-btn" + (cloudUser ? (syncState === "err" ? " cloud-err" : " cloud-on") : "")}
                  onClick={() => setShowCloud(true)}
                  title={
                    !cloudUser
                      ? "חשבון ענן — כניסה"
                      : syncState === "saving"
                      ? "שומר בענן..."
                      : syncState === "err"
                      ? "שגיאת סנכרון: " + syncErr
                      : "מסונכרן לענן · " + (cloudUser.email || "")
                  }
                  aria-label="חשבון ענן"
                >
                  {cloudUser && syncState === "saving" ? "⏳" : cloudUser && syncState === "err" ? "⚠" : "☁"}
                </button>
              </span>
              <span className={"onair " + (loading ? "live" : "")}>{loading ? "ON AIR" : ""}</span>
            </div>

            {showCloud && (
              <div className="cloud-overlay" onClick={() => setShowCloud(false)}>
                <div className="cloud-box" onClick={(e) => e.stopPropagation()}>
                  <h3>☁ חשבון ענן</h3>
                  {cloudUser ? (
                    <>
                      <p>מחובר בתור:<br /><b dir="ltr">{cloudUser.email}</b></p>
                      <p className="sync-line">
                        {syncState === "saving" ? "⏳ שומר בענן..." : syncState === "err" ? "⚠ " + syncErr : "✅ סנכרון שוטף פעיל — כל מרקר, הערה, תוצר וציון נשמרים גם בענן."}
                      </p>
                      <div className="cloud-actions">
                        <button className="cloud-btn" onClick={manualPull} disabled={migrating || pulling}>⬇ הורד את הספרים מהענן</button>
                      </div>
                      <p style={{ fontSize: ".8rem", opacity: 0.75, marginTop: 8 }}>למכשיר חדש, או כדי למשוך עבודה שנעשתה במקום אחר. תמיד יוצג מה עומד לרדת לפני שמחליטים.</p>
                      <div className="cloud-actions">
                        <button className="cloud-btn ghost" onClick={migrateToCloud} disabled={migrating}>{migrating ? "⏳ מעלה..." : "☁ העלאה מלאה מחדש"}</button>
                      </div>
                      <p style={{ fontSize: ".8rem", opacity: 0.6, marginTop: 8 }}>לרוב אין בזה צורך — הסנכרון השוטף מטפל בהכול. בטוח להריץ שוב: מעדכן ולא מכפיל.</p>
                      <div className="cloud-actions">
                        <button className="cloud-btn ghost" onClick={() => setShowCloud(false)} disabled={migrating}>סגור</button>
                        <button className="cloud-btn ghost" onClick={cloudSignOut} disabled={migrating}>התנתק</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p>כניסה בלי סיסמה: כתוב את המייל שלך ונשלח אליו קישור כניסה.</p>
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
                        <button className="cloud-btn" onClick={sendMagicLink}>📨 שלח לי קישור כניסה</button>
                        <button className="cloud-btn ghost" onClick={() => setShowCloud(false)}>המשך בלי חשבון</button>
                      </div>
                      {cloudSent && (
                        <>
                          <input
                            className="cloud-input"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            dir="ltr"
                            placeholder="קוד מהמייל · 6 ספרות"
                            value={cloudCode}
                            onChange={(e) => setCloudCode(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") verifyCode(); }}
                          />
                          <div className="cloud-actions">
                            <button className="cloud-btn" onClick={verifyCode} disabled={cloudCode.replace(/\D/g, "").length < 6}>🔑 כניסה עם הקוד</button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                  {cloudMsg && <p className="cloud-msg">{cloudMsg}</p>}
                </div>
              </div>
            )}

            {/* שלב 3: הצעת הורדה — נפתחת רק כשבענן יש משהו חדש יותר ממה שיש כאן */}
            {pullList && (
              <div className="cloud-overlay" onClick={() => { if (!pulling) { setPullList(null); setPullMsg(""); } }}>
                <div className="cloud-box" onClick={(e) => e.stopPropagation()}>
                  <h3>⬇ יש חדש בענן</h3>
                  <p style={{ fontSize: ".9rem" }}>
                    {pullList[0]?.manual
                      ? "הספרים הבאים נמצאים בענן. ההורדה תחליף את העותק שבמכשיר הזה:"
                      : "הספרים הבאים עודכנו במקום אחר, או שאינם קיימים במכשיר הזה:"}
                  </p>
                  <ul className="pull-list">
                    {pullList.map((c) => (
                      <li key={c.id}>
                        <b>{c.title || "ללא שם"}</b>
                        {c.isNew ? <span className="pull-tag">חדש</span> : null}
                        <span className="pull-when">{c.updated_at ? new Date(c.updated_at).toLocaleString("he-IL") : ""}</span>
                      </li>
                    ))}
                  </ul>
                  {pullMsg && <p className="cloud-msg">{pullMsg}</p>}
                  <div className="cloud-actions">
                    <button className="cloud-btn" onClick={() => doPull(pullList)} disabled={pulling}>
                      {pulling ? "⏳ מוריד..." : "⬇ הורד הכול"}
                    </button>
                    <button className="cloud-btn ghost" onClick={() => { setPullList(null); setPullMsg(""); }} disabled={pulling}>
                      לא עכשיו
                    </button>
                  </div>
                  <p style={{ fontSize: ".78rem", opacity: 0.6, marginTop: 10 }}>
                    "לא עכשיו" בטוח לחלוטין — שום דבר לא נמחק, וההצעה תחזור בכניסה הבאה.
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
                      className={"chapter-tab " + (i === chIdx ? "on " : "") + (book.progress?.[i]?.done ? "ok" : "")}
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
            <div className={"screen-body" + (helpOn ? " behind-help" : "")} style={{ zoom: fontScale }}>
              {view === "boot" && (
                <div className="idle"><div className="idle-mark spin">✳</div><p>טוען את הספרייה…</p></div>
              )}
 
              {/* ── קליטת ספר חדש ── */}
              {view === "intake" && (
                <div className="intake">
                  <p className="intake-lead">
                    הדבק ספר, פרק או מאמר — או העלה קובץ — והמסך יהפוך אותו לסדרת פרקים עם ערוצי למידה: סיכום, מושגים, מפת חשיבה, מבחן ועוד. ההתקדמות נשמרת, כך שאפשר ללמוד ספר שלם לאורך זמן.
                  </p>
                  {openQ && (
                    <div className="my-q">
                      <span className="my-q-ic">❓</span>
                      <span className="my-q-body"><small>השאלה שאתה נושא איתך</small>{openQ}</span>
                      <button className="my-q-x" onClick={() => saveOpenQ("")} title="להסיר את השאלה" aria-label="להסיר את השאלה">✕</button>
                    </div>
                  )}
                  <input ref={titleRef} className="intake-title" placeholder="שם הספר (למשל: אדיר במרום — הרמח״ל)" />
 
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
                      ⬇ הכפתורים למטה: שדר טקסט, העלה קבצים (אפשר כמה בבת אחת — כל קובץ נהיה ספר), צילומים לפענוח OCR עברי, או 🎬 שיעור מוקלט — קובץ אודיו או וידאו שמתומלל לטקסט עברי והופך לספר.
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
                    <span className="scan-mode-title">📸 צלם דף חכם (AI · לדפי זוהר ודפים מפורשים) — תבנית:</span>
                    <select className="scan-mode-select" value={smartMode} onChange={(e) => setSmartMode(e.target.value)}>
                      {Object.entries(SCAN_MODES).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                    <label htmlFor="camera-scan-input" className="cam-btn" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
                      📷 צלם עכשיו
                    </label>
                  </div>

                  <div className="scan-mode-row zohar-row">
                    <span className="scan-mode-title">📜 זוהר עם סולם צמוד — מאמר מספריא:</span>
                    <select className="scan-mode-select" value={zoharForm.p} onChange={(e) => setZoharForm((f) => ({ ...f, p: +e.target.value }))} aria-label="פרשה">
                      {ZOHAR_PARSHIOT.map(([en, he], i) => (
                        <option key={en} value={i}>{he}</option>
                      ))}
                    </select>
                    <select className="scan-mode-select" value="" onChange={(e) => pickZoharArticle(e.target.value)} aria-label="מאמר" disabled={!zoharArts || !zoharArts.length}>
                      <option value="">{zoharArts === null ? "טוען מאמרים…" : zoharArts.length ? `בחר מאמר (${zoharArts.length})` : "אין רשימה — מלא אותיות ידנית"}</option>
                      {(zoharArts || []).map((a) => (
                        <option key={a.n} value={a.n}>{(a.name || `מאמר ${a.n}`) + " · " + hebNum(a.from) + (a.to > a.from ? "–" + hebNum(a.to) : "")}</option>
                      ))}
                    </select>
                    <input className="zohar-in" placeholder="מאות (קמג)" value={zoharForm.from} onChange={(e) => setZoharForm((f) => ({ ...f, from: e.target.value }))} aria-label="מאות" />
                    <input className="zohar-in" placeholder="עד אות (קמו)" value={zoharForm.to} onChange={(e) => setZoharForm((f) => ({ ...f, to: e.target.value }))} aria-label="עד אות" />
                    <input className="zohar-in wide" placeholder="שם המאמר (ארבע קשרין)" value={zoharForm.name} onChange={(e) => setZoharForm((f) => ({ ...f, name: e.target.value }))} aria-label="שם המאמר" />
                    <button className="cam-btn" onClick={importZohar} disabled={!!fileBusy}>📜 משוך מאמר</button>
                    <span className="scan-mode-title" style={{ opacity: 0.75, fontWeight: 400 }}>
                      הארמית והסולם לפי האותיות שבספר · מאמר חדש מצטרף לספר של אותה פרשה
                    </span>
                  </div>
                  <div className="scan-mode-row">
                    {!recOn ? (
                      <button className="rec-btn" onClick={startRec} disabled={!!fileBusy}>
                        🎙 הקלט שיעור חי
                      </button>
                    ) : (
                      <>
                        <span className="rec-live">● מקליט… {Math.floor(recSec / 60)}:{String(recSec % 60).padStart(2, "0")}</span>
                        <button className="rec-btn stop" onClick={stopRec}>⏹ עצור וסיים</button>
                      </>
                    )}
                    <label htmlFor="video-capture-input" className="rec-btn" style={{ pointerEvents: fileBusy || recOn ? "none" : "auto", opacity: fileBusy || recOn ? 0.6 : 1, userSelect: "none" }}>
                      🎥 צלם וידאו
                    </label>
                    <span className="scan-mode-title" style={{ opacity: 0.75 }}>
                      שיעור, הרצאה או הקראה — בסיום ההקלטה מתומללת והופכת לספר
                    </span>
                  </div>

                  <div className="or-divider"><span>או הדבק טקסט</span></div>
 
                  <textarea ref={inputRef} className="intake-text" placeholder="הדבק את הטקסט כאן..." />
                  <p className="intake-tip">
                    טקסט ארוך יחולק אוטומטית לפרקים. לחלוקה ידנית — שורה של === בין הקטעים.
                  </p>
                  {error && <div className="err">{error}</div>}
                </div>
              )}
 
              {/* ── ספרייה ── */}
              {view === "library" && (
                <div className="library">
                  <p className="intake-lead">
                    הספרים שלך. כל ספר שומר את הפרקים, התוצרים והציונים שלו.
                    <a href="#" className="to-opening" onClick={(e) => { e.preventDefault(); setShowOpening(true); }} title="חזרה למסך הפתיחה">ל · הפנים</a>
                  </p>
                  {openQ && (
                    <div className="my-q">
                      <span className="my-q-ic">❓</span>
                      <span className="my-q-body"><small>השאלה שאתה נושא איתך</small>{openQ}</span>
                      <button className="my-q-x" onClick={() => saveOpenQ("")} title="להסיר את השאלה" aria-label="להסיר את השאלה">✕</button>
                    </div>
                  )}
                  {fileBusy && <div className="busy-line" style={{ display: "block", margin: "2px 0 12px" }}>⏳ {fileBusy}</div>}
                  {!fileBusy && recOn && <div className="busy-line" style={{ display: "block", margin: "2px 0 12px", color: "#ff8a8a" }}>● מקליט… לסיום לחץ ⏹ למטה</div>}
                  {error && <div className="err">{error}</div>}
                  {index.map((b) => (
                    <div className="book-row" key={b.id}>
                      <button className="book-main" onClick={() => openBook(b.id)}>
                        <span className="book-title">{b.title}</span>
                        <span className="book-meta">
                          {b.done}/{b.chapters} פרקים הושלמו
                        </span>
                        <span className="mini-bar">
                          <span className="mini-fill" style={{ width: `${b.chapters ? (b.done / b.chapters) * 100 : 0}%` }} />
                        </span>
                      </button>
                      {(b.talk || 0) >= MIRROR_MIN && (
                        <button className="mirror-btn" onClick={() => openMirror(b.id)} title={`🎧 שיקוף — ${b.talk} הערות וסימונים בספר הזה`} aria-label="שיקוף">
                          🎧<small>שיקוף</small>
                        </button>
                      )}
                      {deleteArm === b.id ? (
                        <button className="del confirm" onClick={() => removeBook(b.id)}>בטוח?</button>
                      ) : (
                        <button className="del" onClick={() => setDeleteArm(b.id)} title="מחק ספר">✕</button>
                      )}
                    </div>
                  ))}
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
                    <span className="guide-meta">{doneCount(book)}/{book.chapters.length} פרקים הושלמו</span>
                  </div>
                  <div className="progressbar">
                    <span className="progress-fill" style={{ width: `${(doneCount(book) / book.chapters.length) * 100}%` }} />
                  </div>
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
                            {st === "done" ? "הושלם ✓" : st === "learning" ? "בלימוד" : "טרם נלמד"}
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
                        placeholder="🔍 חיפוש בספר — מילה או כמה מילים (למשל: כוונה עמידה)"
                        value={searchQ}
                        onChange={(e) => setSearchQ(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                      />
                      <button className="mini-btn" onClick={runSearch}>חפש</button>
                      <button className="mini-btn" onClick={() => setNotesOpen((o) => !o)}>
                        📝 הערות ({Object.keys(book.notes || {}).length})
                      </button>
                      {searchHits !== null && (
                        <button className="mini-btn" onClick={closeSearch}>✕ סגור</button>
                      )}
                    </div>
                  )}

                  {searchHits !== null && !flexResult && !flexLoading && (
                    <div className="search-panel">
                      {searchHits.length === 0 ? (
                        <p className="search-none">לא נמצאו מופעים. נסה מילה אחרת או פחות מילים.</p>
                      ) : (
                        <>
                          <div className="search-bar">
                            <span className="search-count">{searchHits.length} מופעים{checkedHits.length ? ` · נבחרו ${checkedHits.length}` : ""}</span>
                            <button className="mini-btn" onClick={() => setCheckedHits([...searchHits])}>סמן הכול</button>
                            <button className="mini-btn" onClick={() => setCheckedHits([])}>נקה</button>
                            <button className="mini-btn gold-btn" onClick={useHitsAsSelection}>
                              ✦ צור קטע מ{checkedHits.length ? "הנבחרים" : "כל התוצאות"}
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
                        <p className="search-none">אין עדיין הערות. סמן קטע ולחץ 📝 הערה.</p>
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
                      <span> · {trace.hits.length} מופעים</span>
                      <button className="mini-btn" onClick={() => {
                        const cur = trace.hits;
                        const pos = cur.indexOf(trace.at ?? cur[0]);
                        const next = cur[(pos + 1) % cur.length];
                        setTrace({ ...trace, at: next });
                        document.getElementById("para-" + next)?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}>⤵ הבא</button>
                      <button className="mini-btn" onClick={() => setTrace(null)}>✕ נקה</button>
                    </div>
                  )}

                  <p className="flex-hint">
                    {markMode === "bookmark"
                      ? "📍 לחץ על משפט כדי לקבוע: עד כאן קראתי."
                      : markMode === "start"
                      ? "⟢ לחץ על המשפט שבו מתחיל הקטע."
                      : markMode === "end"
                      ? "⟣ עכשיו לחץ על המשפט שבו מסתיים הקטע."
                      : selectedText
                      ? `✓ סומן קטע (${selectedText.length.toLocaleString()} תווים) — בחר למטה מה להפיק עליו.`
                      : "גלול וקרא חופשי. סמן קטע בגרירת עכבר, או לחץ ⟢ התחלה ואז בחר משפט התחלה ומשפט סוף."}
                  </p>
 
                  {/* תוצאה שהופקה על הקטע */}
                  {quizPick === "flex" && !flexLoading && !flexResult && (
                    <div className="flex-panel">
                      <h3 style={{ margin: "0 0 10px" }}>כמה שאלות במבחן על הקטע?</h3>
                      <div className="quiz-size-row">
                        {[5, 10, 15, 20].map((n) => (
                          <button key={n} className="quiz-size-btn" onClick={() => { setQuizPick(null); generateFlex("quiz", n); }}>
                            {n}
                          </button>
                        ))}
                      </div>
                      <button className="mini-btn" onClick={() => setQuizPick(null)}>✕ ביטול</button>
                    </div>
                  )}

                  {flexLoading && (
                    <div className="flex-panel">
                      <div className="idle-mark spin" style={{ fontSize: "1.6rem" }}>✳</div>
                      <p>משדרים את {flexLoading} על הקטע שסימנת...</p>
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
                        <strong>{FLEX_ACTIONS.find((a) => a.id === flexResult.channel)?.label} · על הקטע שסימנת</strong>
                        <button className="mini-btn" onClick={() => setFlexResult(null)}>✕ חזרה לטקסט</button>
                      </div>
                      {flexResult.channel === "summary" && <SummaryView data={flexResult.data} question={openQ} layer={layerFor("flex:summary")} />}
                      {flexResult.channel === "concepts" && <ConceptsView data={flexResult.data} onTrace={traceToSource} layer={layerFor("flex:concepts")} />}
                      {flexResult.channel === "mindmap" && <MindmapView data={flexResult.data} />}
                      {flexResult.channel === "flow" && <FlowView data={flexResult.data} />}
                      {flexResult.channel === "quiz" && <QuizView data={flexResult.data} saved={null} onComplete={() => {}} />}
                      {flexResult.channel === "cards" && <CardsView data={flexResult.data} layer={layerFor("flex:cards")} />}
                    </div>
                  )}
 
                  {/* המגילה עצמה */}
                  {!flexResult && !flexLoading && (
                    <div className="scroll-text" ref={scrollBodyRef} onMouseUp={onScrollMouseUp}>
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
                                    (inRange || isStart ? "in-range " : "") +
                                    (searchHits && searchHits.includes(i) ? "hit " : "") +
                                    (trace && trace.hits.includes(i) ? "trace-hit " : "") +
                                    (book.notes?.[i] ? "has-note " : "") +
                                    (flashIdx === i ? "flash " : "") +
                                    (isRead ? "was-read " : "") +
                                    (markMode ? "clickable" : "")
                                  }
                                  onClick={() => onSentenceClick(i)}
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
                              <div className="bookmark-line">📍 עד כאן קראת</div>
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
                    {book.progress?.[chIdx]?.done && <span className="chip done">הושלם ✓</span>}
                  </div>
                  {prevSummary && (
                    <div className="recap">
                      <h4>בפרקים הקודמים…</h4>
                      <p>{prevSummary.short}</p>
                    </div>
                  )}
                  <p className="idle-hint">בחר ערוץ למטה. סיום המבחן מסמן את הפרק כהושלם.</p>
                </div>
              )}
 
              {view === "tv" && channel === "quiz" && quizPick === "tv" && !loading && (
                <div className="idle open">
                  <h2 className="guide-title">כמה שאלות במבחן?</h2>
                  <div className="quiz-size-row">
                    {[5, 10, 15, 20].map((n) => (
                      <button key={n} className="quiz-size-btn" onClick={() => { setQuizPick(null); generate("quiz", chIdx, n); }}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="idle-hint">מבחן ארוך יותר לוקח מעט יותר זמן להפקה.</p>
                </div>
              )}

              {view === "tv" && channel && loading && (
                <div className="idle">
                  <div className="idle-mark spin">✳</div>
                  <p>משדרים את {active.label} — {cur.title}...</p>
                </div>
              )}
 
              {view === "tv" && channel && !loading && error && (
                <div className="idle">
                  <div className="err big">{error}</div>
                  <button className="broadcast" onClick={() => generate(channel, chIdx)}>נסה שוב</button>
                </div>
              )}
 
              {view === "tv" && channel === "read" && !loading && cur && (
                <div className="read" key={key(chIdx, "read")}>
                  <h2 className="read-title">{cur.title}</h2>
                  <p className="flex-hint read-mark-hint">
                    {selStart !== null && selEnd === null
                      ? "⟣ עכשיו לחץ על המשפט שבו מסתיים הקטע."
                      : wordSel
                      ? "✓ סומנו מילים — בחר בסרגל: מרקר, הדגשה או 📝 הערה."
                      : rangeIdx
                      ? "✓ סומן קטע — בחר בסרגל: מרקר, הדגשה או 📝 הערה."
                      : "קרא חופשי. גרור על מילה או כמה מילים לסימון עדין — או לחץ על משפט התחלה ואז על משפט סוף."}
                  </p>
                  {layerOn && (rangeIdx || wordSel) && (
                    <FloatingMarkBar anchorIdx={wordSel ? wordSel.i : rangeIdx[1]} word={!!wordSel}>
                      <span className="mark-title">✍️ שכבת הלומד:</span>
                      <button className="mark-btn" style={{ fontWeight: 800 }} onClick={() => applyMark({ b: 1 })}>B מודגש</button>
                      <button className="mark-btn" style={{ textDecoration: "underline" }} onClick={() => applyMark({ u: 1 })}>U קו תחתון</button>
                      <button className="mark-btn hl-y" onClick={() => applyMark({ hl: "y" })}>מרקר</button>
                      <button className="mark-btn hl-g" onClick={() => applyMark({ hl: "g" })}>מרקר</button>
                      <button className="mark-btn hl-p" onClick={() => applyMark({ hl: "p" })}>מרקר</button>
                      <button className="mark-btn" onClick={addNote}>📝 הערה</button>
                      <button className="mark-btn" onClick={() => applyMark(null)}>✕ נקה עיצוב</button>
                      <button className="mark-btn" onClick={clearSelection}>✕ בטל סימון</button>
                    </FloatingMarkBar>
                  )}
                  {noteEditor}
                  {readerOn && (() => {
                    const [rs, re] = chapterRanges[chIdx] || [0, 0];
                    const chParas = paraGroups.filter(([start]) => start >= rs && start < re);
                    const items = [];
                    chParas.forEach(([start, count], pi) => { const kind = paraKind(sentences, chParas, pi).trim(); for (let i = start; i < start + count; i++) items.push({ i, kind, text: sentences[i] }); });
                    return <Reader key={key(chIdx, "reader")} items={items} question={openQ} startAt={readerStart} onPos={setReadPos} onClose={() => { setReaderOn(false); setReadPos(null); }}
                      store={`${book.id}:${chIdx}`} uid={cloudUser?.id} ttsMeta={book.flex?.tts || {}} onTtsMeta={(k, m) => { const b = bookRef.current; if (b) persist({ ...b, flex: { ...(b.flex || {}), tts: { ...(b.flex?.tts || {}), [k]: m } } }); }} />;
                  })()}
                  {share && <ShareBar share={share} peers={peers} me={myUid} onTake={takePage} onFollow={toggleFollow} onLeave={leaveShare} onCopy={copyShareLink} copied={shareCopied} video={shareVideo} onVideo={() => setShareVideo((v) => !v)} />}
                  {share && shareVideo && <VideoPanel sessionId={share.id} myName={shareNameOf(cloudUser)} onClose={() => setShareVideo(false)} />}
                  <div className="read-body read-sents" onMouseUp={onReadMouseUp}>
                    {(() => {
                      const [rs, re] = chapterRanges[chIdx] || [0, 0];
                      const chParas = paraGroups.filter(([start]) => start >= rs && start < re);
                      if (!chParas.length) return cur.text; // ביטחון: אם אין משפטים — הטקסט כמו שהוא
                      return chParas.map(([start, count], pi) => (
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
                                  (inRange || isStart ? "in-range " : "") +
                                  (book.notes?.[i] ? "has-note " : "") +
                                  (readPos && readPos.i === i ? "kara-now " : "") +
                                  (pl ? pl.cls : "")
                                }
                                style={pl ? { "--peer": pl.color } : undefined}
                                title={pl?.title || undefined}
                                onClick={() => (readerOn ? setReaderStart({ i, t: Date.now() }) : onReadSentClick(i))}
                              >
                                {pl?.here && <span className="peer-cursor" style={{ background: pl.here.color }} title={pl.here.name + " כאן"}>{pl.here.name}</span>}
                                {renderSentText(s, mk, wordSel && wordSel.i === i ? wordSel : null, vocOf(i), readPos && readPos.i === i ? readPos.c : null)}
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
                        </p>
                      ));
                    })()}
                  </div>
                  <p className="read-hint">אחרי שקראת — בחר ערוץ למטה כדי לקבל סיכום, מבחן, כרטיסיות ועוד. הסימונים וההערות נשמרים ומופיעים גם במגילה.</p>
                </div>
              )}
 
              {view === "tv" && channel === "tts" && !loading && cur && (
                <TTSView key={key(chIdx, "tts")} text={cur.text} question={openQ} />
              )}
 
              {view === "tv" && channel && channel !== "tts" && channel !== "read" && !loading && !error && data && (
                <>
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
                </>
              )}
            </div>
 
          </div>
          <div className="tv-chin">
            <span className={"power-led " + (loading || flexLoading ? "live" : "")} />
            <span className="brand">LOMED·TV</span>
            <span className="grille"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></span>
          </div>
        </div>
        <div className="tv-stand"><span className="tv-neck" /><span className="tv-base" /></div>
      </div>

      {/* ── מתחת לטלוויזיה: לוחות המקשים. המסגרת קבועה; רק התוכן בתוך המסך נגלל (צ'אט 20) ── */}
      <div className="under">
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
            <span className="key-label">ספר חדש</span>
          </button>
          <label htmlFor="camera-scan-input" className="ch-key green" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
            <span className="key-num">📷</span>
            <span className="key-label">צלם דף</span>
          </label>
          <label htmlFor="video-capture-input" className="ch-key media" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
            <span className="key-num">🎥</span>
            <span className="key-label">צלם וידאו</span>
          </label>
          {!recOn ? (
            <button className="ch-key media" onClick={startRec} disabled={!!fileBusy}>
              <span className="key-num">🎙</span>
              <span className="key-label">הקלט שיעור</span>
            </button>
          ) : (
            <button className="ch-key rec-on" onClick={stopRec}>
              <span className="key-num">⏹</span>
              <span className="key-label">עצור {Math.floor(recSec / 60)}:{String(recSec % 60).padStart(2, "0")}</span>
            </button>
          )}
          <label htmlFor="media-transcribe-input" className="ch-key media" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
            <span className="key-num">🎬</span>
            <span className="key-label">אודיו/וידאו</span>
          </label>
          <button
            className="ch-key shelf"
            onClick={openShelf}
            disabled={!!fileBusy}
            title="ארון הספרים — 70 ספרי מקור, לייבוא ללימוד"
          >
            <span className="key-num">📚</span>
            <span className="key-label">ארון הספרים</span>
          </button>
        </div>
      )}

      {view === "shelf" && (
        <div className="deck">
          {shelfPick && shelfSegs && (
            <button className="ch-key" onClick={() => { setShelfPick(null); setShelfSegs(null); setShelfOpts([]); setShelfQ(""); }} disabled={!!fileBusy}>
              <span className="key-num">📚</span>
              <span className="key-label">כל הספרים</span>
            </button>
          )}
          <a className="ch-key shelf" href={SHELF_URL} target="_blank" rel="noopener noreferrer" title="פותח את הארון בלשונית חדשה">
            <span className="key-num">↗</span>
            <span className="key-label">פתח את הארון</span>
          </a>
          <button className="ch-key newtext" onClick={() => { backToLibrary(); if (!index.length) setView("intake"); }} disabled={!!fileBusy}>
            <span className="key-num">↩</span>
            <span className="key-label">חזרה לספרייה</span>
          </button>
        </div>
      )}

      {view === "intake" && (
        <div className="deck">
          <button className="ch-key gold" onClick={createBook} disabled={!!fileBusy}>
            <span className="key-num">▸</span>
            <span className="key-label">שדר טקסט</span>
          </button>
          <button className="ch-key" onClick={() => fileRef.current?.click()} disabled={!!fileBusy}>
            <span className="key-num">⬆</span>
            <span className="key-label">קבצים</span>
          </button>
          <label htmlFor="photo-ocr-input" className="ch-key green" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
            <span className="key-num">📷</span>
            <span className="key-label">צילומים OCR</span>
          </label>
          <label htmlFor="smart-scan-input" className="ch-key smart" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
            <span className="key-num">📸</span>
            <span className="key-label">דף חכם AI</span>
          </label>
          <label htmlFor="media-transcribe-input" className="ch-key media" style={{ pointerEvents: fileBusy ? "none" : "auto", opacity: fileBusy ? 0.6 : 1 }}>
            <span className="key-num">🎬</span>
            <span className="key-label">שיעור מוקלט</span>
          </label>
          {index.length > 0 && (
            <button className="ch-key newtext" onClick={backToLibrary} disabled={!!fileBusy}>
              <span className="key-num">↩</span>
              <span className="key-label">חזרה לספרייה</span>
            </button>
          )}
        </div>
      )}
 
      {view === "tv" && book && (
        <>
          <div className="deck">
            {CHANNELS.map((c) => {
              const isOn = c.id === "tts" ? (readerOn && channel === "read") : channel === c.id;
              const cached = (c.id === "tts" || c.id === "read") ? isOn : !!book.results[key(chIdx, c.id)];
              return (
                <button
                  key={c.id}
                  className={"ch-key " + (isOn ? "active " : "") + (cached ? "cached " : "")}
                  disabled={loading}
                  onClick={() => tune(c.id)}
                >
                  <span className="key-num">{c.num}</span>
                  <span className="key-label">{c.label}</span>
                </button>
              );
            })}
          </div>
          <div className="deck">
            {!book.progress?.[chIdx]?.done && (
              <button className="ch-key newtext" onClick={() => markDone(chIdx)} disabled={loading}>
                <span className="key-num">✓</span>
                <span className="key-label">סמן כהושלם</span>
              </button>
            )}
            <button className="ch-key newtext" onClick={backToGuide} disabled={loading}>
              <span className="key-num">↩</span>
              <span className="key-label">חזרה ללוח השידורים</span>
            </button>
          </div>
        </>
      )}
 
      {view === "guide" && book && (
        <div className="deck">
          {nextUnfinished >= 0 && (
            <button className="ch-key gold" onClick={() => openChapter(nextUnfinished)}>
              <span className="key-num">▸</span>
              <span className="key-label">המשך לימוד</span>
            </button>
          )}
          <button className="ch-key green" onClick={openScroll}>
            <span className="key-num">📜</span>
            <span className="key-label">מגילה — לימוד גמיש</span>
          </button>
          {talkCount(book) >= MIRROR_MIN && (
            <button className="ch-key mirror" onClick={() => openMirror(book.id)} title="שיקוף — השיחה שלך עם הספר, בקול">
              <span className="key-num">🎧</span>
              <span className="key-label">שיקוף</span>
            </button>
          )}
          <button className="ch-key share" onClick={share ? () => { setChannel("read"); setView("tv"); } : startShare} title="לימוד משותף — אותו דף, שני לומדים, בזמן אמת">
            <span className="key-num">🕯</span>
            <span className="key-label">{share ? "חזרה ללימוד המשותף" : "לימוד משותף"}</span>
          </button>
          <button className="ch-key newtext" onClick={backToLibrary}>
            <span className="key-num">↩</span>
            <span className="key-label">חזרה לספרייה</span>
          </button>
        </div>
      )}
      {shareMsg && <p className="share-msg" dir="rtl">{shareMsg} <button className="mark-btn" onClick={() => setShareMsg("")}>✕</button></p>}

      {view === "mirror" && book && (
        <div className="deck">
          <button className="ch-key" onClick={() => { flick(); setView("guide"); }}>
            <span className="key-num">📖</span>
            <span className="key-label">לוח השידורים של הספר</span>
          </button>
          <button className="ch-key green" onClick={openScroll}>
            <span className="key-num">📜</span>
            <span className="key-label">מגילה — להוסיף הערות</span>
          </button>
          <button className="ch-key newtext" onClick={backToLibrary}>
            <span className="key-num">↩</span>
            <span className="key-label">חזרה לספרייה</span>
          </button>
        </div>
      )}
 
      {view === "scroll" && book && (
        <>
          {!flexResult && !flexLoading && (
            <div className="deck">
              <button
                className={"ch-key " + (markMode === "bookmark" ? "active" : "")}
                onClick={() => setMarkMode(markMode === "bookmark" ? null : "bookmark")}
              >
                <span className="key-num">📍</span>
                <span className="key-label">סימנייה</span>
              </button>
              <button
                className={"ch-key " + (markMode === "start" ? "active" : "")}
                onClick={() => setMarkMode(markMode === "start" ? null : "start")}
              >
                <span className="key-num">⟢</span>
                <span className="key-label">התחלה</span>
              </button>
              <button
                className={"ch-key " + (markMode === "end" ? "active" : "")}
                onClick={() => setMarkMode(markMode === "end" ? null : "end")}
              >
                <span className="key-num">⟣</span>
                <span className="key-label">סוף</span>
              </button>
              {(selectedText || rangeIdx) && (
                <button className="ch-key newtext" onClick={clearSelection}>
                  <span className="key-num">✕</span>
                  <span className="key-label">נקה סימון</span>
                </button>
              )}
            </div>
          )}
 
          {layerOn && selectedText && !flexResult && !flexLoading && ((selStart !== null && selEnd !== null) || wordSel) && (
            <FloatingMarkBar anchorIdx={wordSel ? wordSel.i : Math.max(selStart, selEnd)} word={!!wordSel}>
              <span className="mark-title">✍️ שכבת הלומד:</span>
              <button className="mark-btn" style={{ fontWeight: 800 }} onClick={() => applyMark({ b: 1 })}>B מודגש</button>
              <button className="mark-btn" style={{ textDecoration: "underline" }} onClick={() => applyMark({ u: 1 })}>U קו תחתון</button>
              <button className="mark-btn hl-y" onClick={() => applyMark({ hl: "y" })}>מרקר</button>
              <button className="mark-btn hl-g" onClick={() => applyMark({ hl: "g" })}>מרקר</button>
              <button className="mark-btn hl-p" onClick={() => applyMark({ hl: "p" })}>מרקר</button>
              <button className="mark-btn" onClick={addNote}>📝 הערה</button>
              <button className="mark-btn trans-btn" onClick={translateSel}>א⇄ע תרגם</button>
              <button className="mark-btn" onClick={() => applyMark(null)}>✕ נקה עיצוב</button>
            </FloatingMarkBar>
          )}
          {transBubble}
          {noteEditor}

          {selectedText && !flexResult && !flexLoading && (
            <div className="deck">
              {FLEX_ACTIONS.map((a) => (
                <button key={a.id} className="ch-key gold" onClick={() => generateFlex(a.id)}>
                  <span className="key-num">✦</span>
                  <span className="key-label">{a.label}</span>
                </button>
              ))}
            </div>
          )}
 
          <div className="deck">
            {flexResult && (
              <button className="ch-key gold" onClick={() => setFlexResult(null)}>
                <span className="key-num">↩</span>
                <span className="key-label">חזרה לטקסט</span>
              </button>
            )}
            <button className="ch-key newtext" onClick={backToGuide}>
              <span className="key-num">↩</span>
              <span className="key-label">חזרה ללוח השידורים</span>
            </button>
          </div>
        </>
      )}
      </div>
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
  min-height:100vh;background:radial-gradient(120% 90% at 50% 0%,var(--studio-2),var(--studio) 70%);
  font-family:'Heebo',sans-serif;color:#e8eaf4;
  display:flex;flex-direction:column;align-items:center;padding:28px 16px 60px;
  /* מובייל: לא להיכנס מתחת ל-notch ולפס הבית */
  padding-top:calc(28px + env(safe-area-inset-top,0px));padding-bottom:calc(60px + env(safe-area-inset-bottom,0px));
}
/* ── הבמה הקבועה (צ'אט 20): המסגרת, הכותרת והמקשים ממלאים את המסך ולא זזים; רק התוכן שבתוך מסך הטלוויזיה נגלל ── */
.studio{height:100vh;height:100dvh;min-height:0;overflow:hidden;padding:14px 16px 10px;
  padding-top:calc(12px + env(safe-area-inset-top,0px));padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))}
.studio>.masthead{flex:none;margin-bottom:10px}
.studio>.tv{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;width:auto;max-width:100%;aspect-ratio:16/10}
@media (max-width:900px){.studio>.tv{width:100%;aspect-ratio:auto}}
.bezel{padding:clamp(12px,1.4vw,26px);border-radius:clamp(18px,2vw,34px)}
.tv-neck{width:clamp(90px,8vw,160px)}
.tv-base{width:clamp(260px,22vw,440px)}
.studio>.tv .bezel{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.studio>.tv .screen{flex:1 1 auto;min-height:0}
.studio>.tv .screen-body{max-height:none;-webkit-overflow-scrolling:touch}
.studio>.tv .tv-chin,.studio>.tv .tv-stand{flex:none}
.under{flex:none;width:100%;max-height:44vh;max-height:44dvh;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;align-items:center;padding-bottom:4px}
.under .deck{margin-top:12px}
@media (max-height:760px){
  .studio>.masthead{display:none}
  .studio>.tv .tv-stand{display:none}
  .studio>.tv .tv-chin{padding:4px 0 2px}
  .under .ch-key{padding:7px 10px;min-width:84px;gap:2px}
  .under .key-label{font-size:.84rem}
  .under .deck{gap:7px;margin-top:8px}
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
.bezel{
  background:linear-gradient(180deg,#232a4c,#171d3a);
  border:1px solid #323b68;border-radius:26px;padding:16px;
  box-shadow:0 22px 60px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.06);
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
 
/* 🎧 שיקוף */
.mirror-btn{
  border:1.5px solid #d8b06a;background:#fff8e6;border-radius:12px;min-width:52px;padding:0 8px;
  color:#7a5410;cursor:pointer;font-family:'Heebo',sans-serif;font-size:1.05rem;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
}
.mirror-btn small{font-size:.62rem;font-weight:700;letter-spacing:.02em}
.mirror-btn:hover{border-color:var(--amber-deep);background:#fff3d6}
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
.fm-canvas{position:relative;width:100%;background:#faf7ee;border:1.5px solid #d8d0ba;border-radius:14px;overflow:hidden;touch-action:none}
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
.share-code{font-family:'IBM Plex Mono',monospace;letter-spacing:.12em;background:#fff;border:1px solid #e0c98f;border-radius:6px;padding:2px 8px;font-weight:600}
.share-who{display:flex;gap:6px;flex-wrap:wrap}
.share-peer{background:var(--c);color:#fff;border-radius:999px;padding:1px 9px;font-size:.82rem;font-weight:600}
.share-wait{color:#8a7a55;font-size:.85rem}
.share-holder{font-size:.85rem}
.share-bar .mark-btn.on{border-color:var(--amber);background:#fdeed3}
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
.scroll-sent.clickable:hover{background:#f6dfae;box-shadow:0 0 0 1px #d8b06a inset}
.scroll-sent.in-range{background:#fdeed3;box-shadow:-3px 0 0 var(--amber)}
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
.read-sents .scroll-para{padding:0;margin:0 0 14px}
.scroll-para.zohar{font-family:'Frank Ruhl Libre',serif;font-weight:700;font-size:1.2em;color:#1a1408;margin-bottom:6px}
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
.help{flex:1 1 auto;min-height:0;background:var(--paper);color:var(--ink);display:flex;flex-direction:column;overflow:hidden;font-family:'Heebo',sans-serif}
.screen-body.behind-help{display:none}
.help .tts-btn{padding:6px 12px;font-size:.9rem;box-shadow:none}
.help-nav .tts-btn{white-space:nowrap}
.help-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;background:#fff8e6;border-bottom:1.5px solid #e0c98f}
.help-title{font-weight:800;color:#7a5410}
.help-body{flex:1;overflow-y:auto;padding:16px 22px 30px;display:flex;flex-direction:column;gap:12px}
.help-nav{display:flex;justify-content:space-between;align-items:center;gap:8px}
.help-h{font-family:'Frank Ruhl Libre',serif;font-weight:800;font-size:1.35rem;margin:4px 0;display:flex;align-items:center;gap:10px}
.help-h .n{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--amber);color:#241a08;font-family:'IBM Plex Mono',monospace;font-size:.9rem}
.help-text{line-height:1.9;font-size:1.05rem;white-space:pre-wrap}
.help-tip{background:#fff3c4;border-inline-start:3px solid var(--amber);border-radius:8px;padding:8px 12px;font-size:.95rem;line-height:1.7}
.help-shot{width:100%;max-width:420px;align-self:center;border:1px solid #d9d2bd;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.help-dots{display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:6px}
.help-dot{width:10px;height:10px;border-radius:50%;border:1px solid #b9ad8c;background:transparent;cursor:pointer;padding:0}
.help-dot.on{background:var(--amber);border-color:var(--amber)}
.help-foot{text-align:center;color:#8a8467;font-size:.85rem}
.help-btn.on{border-color:var(--amber);color:var(--amber)}
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
@media (max-width:480px){.font-btns{gap:4px;margin-inline-end:6px}.font-btn{min-width:30px}}
.nikud-msg{position:fixed;bottom:calc(18px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);z-index:60;background:#1b2a4a;color:#f8c778;border:1px solid var(--amber);border-radius:999px;padding:7px 16px;font-size:.88rem;box-shadow:0 4px 18px rgba(0,0,0,.35);max-width:90vw;text-align:center}
.ch-key.gold{background:linear-gradient(180deg,#f5b95c,var(--amber));border-color:var(--amber-deep);color:#241a08}
.ch-key.gold .key-num,.ch-key.gold .key-label{color:#241a08}
.ch-key.gold:hover:not(:disabled){border-color:#8a5510}
.ch-key.green{background:linear-gradient(180deg,#25695e,#1e5c52);border-color:#2a7a6e;color:#eafff9}
.ch-key.green .key-num{color:#9fe8d9}
.brand{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:5px;color:#6e769c}
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
`;
  
