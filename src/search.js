/* ─── 🔍 חיפוש: פיצ'רים ותוכן ───
   שכבה א — מילון הפיצ'רים (FEATURES): לכל פיצ'ר מילות חיפוש בכמה שפות ו"איך מגיעים" (go).
   שכבה ב — אינדקס התוכן: לכל ספר, המשפטים (לפי אותה חלוקה של המסך), ההערות והתוצרים,
   מנורמלים (בלי ניקוד, בלי פיסוק, אותיות קטנות). נבנה במכשיר, בלי שרת.
   הכול בזיכרון; נבנה בפעם הראשונה שמחפשים ומתעדכן לספר ששונה. */

/* ניקוד וטעמים, סימני פיסוק, גרשיים */
const NIKUD = /[֑-ׇ]/g;
const PUNCT = /[.,;:!?׃"'״׳()\[\]{}<>«»\-–—_/\\|*#@^~`+=…]/g;
export function norm(s) {
  return String(s || "").replace(NIKUD, "").toLowerCase().replace(PUNCT, " ").replace(/\s+/g, " ").trim();
}
/* אותיות שימוש בעברית: "והספר" ← "ספר". מחזיר את המילה וגם גרסה בלי האות הראשונה (כשהיא אות שימוש). */
const PREFIX = /^[והבלכמש]/;
function variants(w) {
  const out = [w];
  if (w.length > 3 && PREFIX.test(w)) out.push(w.slice(1));
  if (w.length > 4 && /^[ו][הבלכמש]/.test(w)) out.push(w.slice(2));
  return out;
}
/* מילת שאילתה q תואמת מילת טקסט w אם q היא תחילית של אחת הגרסאות של w (או להפך לשאילתה עם אות שימוש) */
function wordHit(q, w) {
  for (const v of variants(w)) if (v.startsWith(q)) return true;
  return false;
}
function tokens(s) { return norm(s).split(" ").filter((t) => t.length >= 2); }
/* האם כל מילות השאילתה נמצאות במשפט (כל אחת כתחילית של מילה כלשהי) */
export function matches(qTokens, text) {
  const words = norm(text).split(" ");
  for (const q of qTokens) {
    const qs = variants(q);
    let ok = false;
    for (const w of words) { for (const qv of qs) if (wordHit(qv, w)) { ok = true; break; } if (ok) break; }
    if (!ok) return false;
  }
  return true;
}

/* ─── שכבה א · הפיצ'רים ───
   go: { view } | { gate } | { ch } | { act } — מפורש ב-App.jsx (goFeature).
   keys: מילים ונרדפות, בעברית ובאנגלית (ובערבית/רוסית לחלק). החיפוש הוא לפי תחילית, אז "הקלט" תופס גם "הקלטה". */
export const FEATURES = [
  { id: "new", name: "ספר חדש", desc: "להכניס טקסט, קובץ, צילום או הקלטה", keys: "ספר חדש להוסיף הוספה טקסט הדבק הדבקה קובץ pdf word new book add paste text file upload", go: { view: "intake" } },
  { id: "rec", name: "🎙 הקלט שיעור", desc: "מקליטים מהמיקרופון, ההקלטה מתומללת והופכת לספר", keys: "הקלט הקלטה להקליט מיקרופון שיעור חי לדבר דיבור תמלול תמלל record recording microphone lesson live transcribe voice", go: { gate: "rec" } },
  { id: "photo", name: "📷 צלם דף", desc: "צילום דף מודפס הופך לטקסט (OCR)", keys: "צלם צילום מצלמה דף סריקה סרוק ocr תמונה photograph photo camera page scan", go: { gate: "photo" } },
  { id: "video", name: "🎥 צלם וידאו", desc: "מצלמים שיעור בווידאו, התמלול הופך לספר", keys: "וידאו סרטון צלם וידאו video film", go: { gate: "video" } },
  { id: "media", name: "🎬 קובץ שמע או וידאו", desc: "מעלים הקלטה קיימת (MP3, M4A, MP4) לתמלול", keys: "אודיו שמע קובץ שמע mp3 m4a mp4 וידאו העלאה audio media file upload", go: { gate: "file" } },
  { id: "yt", name: "▶ סרטון יוטיוב", desc: "קישור ותמליל מיוטיוב נעשים ספר, הסרטון לצד הטקסט", keys: "יוטיוב youtube סרטון קישור תמליל link", go: { view: "intake", focus: "yt" } },
  { id: "export", name: "📤 ייצוא הקלטה", desc: "שולחים את קובץ ההקלטה עם המלל (בספרייה, ליד הספר)", keys: "ייצוא ייצא לייצא שלח שליחה הקלטה וואטסאפ מייל קובץ שמע export share send recording whatsapp", go: { view: "library", hint: "export" } },
  { id: "summary", name: "01 סיכום", desc: "סיכום הפרק, מפורט או קצר", keys: "סיכום סכם תקציר summary summarize", go: { ch: "summary" } },
  { id: "concepts", name: "02 מושגים וכללים", desc: "מונחי המפתח של הפרק מוסברים", keys: "מושגים מושג כללים הגדרות מונחים concepts rules terms definitions", go: { ch: "concepts" } },
  { id: "mindmap", name: "03 מפת חשיבה", desc: "מבנה הפרק כמפה", keys: "מפת חשיבה מפה מבנה mind map mindmap", go: { ch: "mindmap" } },
  { id: "flow", name: "04 תרשים זרימה", desc: "השלבים בפרק כתרשים", keys: "תרשים זרימה שלבים flow chart diagram", go: { ch: "flow" } },
  { id: "quiz", name: "05 מבחן", desc: "שאלות על הפרק, לבדוק מה נשאר", keys: "מבחן בוחן שאלות בחינה quiz test questions exam", go: { ch: "quiz" } },
  { id: "cards", name: "06 כרטיסיות", desc: "כרטיסי שינון: שאלה מצד אחד, תשובה מהצד השני", keys: "כרטיסיות כרטיס שינון flashcards cards flash", go: { ch: "cards" } },
  { id: "tts", name: "07 הקראה", desc: "הטקסט מוקרא בקול, והמשפט הנקרא מסומן (קריוקי)", keys: "הקראה הקרא קול להקשיב האזנה קריוקי שמיעה read aloud listen voice audio karaoke", go: { ch: "tts" } },
  { id: "trans", name: "09 תרגום", desc: "הפרק בשפה אחרת, לצד המקור", keys: "תרגום תרגם אנגלית ערבית רוסית צרפתית ספרדית גרמנית שפה translate translation english arabic russian language", go: { ch: "trans" } },
  { id: "mark", name: "מרקר והערה", desc: "לוחצים על משפט התחלה ומשפט סוף, ואז מרקר, קו או 📝 הערה", keys: "מרקר סימון סמן הדגשה קו הערה הערות לכתוב הערה highlight mark note notes underline annotate", go: { ch: "read", hint: "mark" } },
  { id: "scroll", name: "📜 המגילה", desc: "כל הספר ברצף אחד, עם כל הסימונים וההערות", keys: "מגילה גלילה רצף כל הספר scroll whole book continuous", go: { act: "scroll" } },
  { id: "mirror", name: "🎧 שיקוף", desc: "שיחה מוקלטת על ההערות והסימונים שלך (מ-3 הערות)", keys: "שיקוף פודקאסט שיחה על ההערות mirror podcast reflection", go: { act: "mirror" } },
  { id: "share", name: "🕯 לימוד משותף", desc: "פותחים שיעור, שולחים קישור, לומדים את אותו דף יחד עם וידאו", keys: "לימוד משותף חברותא הזמן הזמנה קישור שותף חבר ביחד וידאו שיחה קוד share together partner invite link chavruta study with friend video call", go: { act: "share" } },
  { id: "join", name: "🕯 הצטרף עם קוד", desc: "מצטרפים לשיעור שחבר פתח, עם הקוד שלו", keys: "הצטרף הצטרפות קוד join code", go: { act: "join" } },
  { id: "bi", name: "🌐 הדף בשפה שלי", desc: "בלימוד משותף: כל אחד רואה את הדף בשפה שלו", keys: "הדף בשפה שלי דו לשוני תרגום חי bilingual my language", go: { act: "share", hint: "bi" } },
  { id: "nikud", name: "ניקוד", desc: "ניקוד אוטומטי לטקסט עברי (כפתור בשורה העליונה)", keys: "ניקוד נקד מנוקד vowels nikud", go: { act: "nikud" } },
  { id: "gloss", name: "מילון ארמי", desc: "פירוש מתחת למילים הארמיות (בטקסט עברי/ארמי)", keys: "מילון ארמי ארמית פירוש מילים זוהר תרגום מילה gloss aramaic dictionary", go: { act: "gloss" } },
  { id: "cloud", name: "☁ חשבון ענן", desc: "כניסה, סנכרון בין מכשירים, התנתקות", keys: "ענן חשבון כניסה התחבר התנתק סנכרון מייל סיסמה login sign in account cloud sync password sign out", go: { act: "cloud" } },
  { id: "delete-account", name: "מחיקת החשבון", desc: "בחלון חשבון הענן, למטה: מוחק את החשבון וכל הנתונים", keys: "מחק חשבון מחיקת חשבון למחוק delete account remove", go: { act: "cloud" } },
  { id: "backup", name: "⬇ גיבוי", desc: "הורדת כל הספרים, ההערות והסימונים לקובץ אחד", keys: "גיבוי גבה הורדה שמירה backup download save", go: { act: "backup" } },
  { id: "restore", name: "⬆ שחזור", desc: "טעינת ספרים מקובץ גיבוי", keys: "שחזור שחזר העלאת גיבוי restore import", go: { act: "restore" } },
  { id: "archive", name: "📚 ארכיון", desc: "ספרים שהוסרו מהמסך; 📌 מחזיר. ☑ בחר: קבוצה שלמה", keys: "ארכיון ארכב הסתר הסרה מהמסך להעלים סיכה להחזיר בחר סמן הכל archive hide remove pin select all", go: { view: "library", hint: "archive" } },
  { id: "delete-book", name: "✕ מחיקת ספר", desc: "ה-✕ ליד הספר מוחק אותו (גם מהענן)", keys: "מחק ספר מחיקה למחוק delete book", go: { view: "library" } },
  { id: "lang", name: "שפת הממשק", desc: "תיבת השפה בשורה העליונה: עברית, English, العربية, Français, Español, Русский, Deutsch", keys: "שפה שפת הממשק אנגלית עברית ערבית language interface english hebrew", go: { act: "lang" } },
  { id: "font", name: "גודל טקסט", desc: "א− / א+ בשורה העליונה", keys: "גודל טקסט הגדל הקטן אותיות font size bigger smaller zoom", go: { act: "font" } },
  { id: "bg", name: "🎨 רקע", desc: "הרקע מסביב למסך", keys: "רקע צבע עיצוב background color theme", go: { act: "bg" } },
  { id: "focus", name: "⛶ מסך קריאה", desc: "רק התוכן, על כל המסך", keys: "מסך מלא קריאה נקי focus full screen reading", go: { act: "focus" } },
  { id: "print", name: "🖨 הדפסה", desc: "הדפסת התוכן המוצג", keys: "הדפס הדפסה print", go: { act: "print" } },
  { id: "help", name: "❔ המדריך", desc: "סיור קצר בכל האפליקציה, עם קול", keys: "מדריך עזרה הסבר איך משתמשים guide help how to tutorial", go: { act: "help" } },
  { id: "privacy", name: "מדיניות פרטיות", desc: "מה נשמר, לאן נשלח ואיך מוחקים", keys: "פרטיות מדיניות privacy policy data", go: { act: "privacy" } },
  { id: "question", name: "❓ השאלה שאתה נושא", desc: "השאלה ממסך הפתיחה נכנסת לסיכום ולמבחן", keys: "שאלה שאלה שלי מסך פתיחה question opening", go: { act: "opening" } },
];
/* מילות החיפוש מתורגמות בזמן ריצה דרך tx (השם והתיאור), והמילים האנגליות כבר ברשימה */
export function searchFeatures(query, tx) {
  const q = tokens(query);
  if (!q.length) return [];
  const out = [];
  for (const f of FEATURES) {
    const hay = f.keys + " " + f.name + " " + f.desc + " " + (tx ? tx(f.name) + " " + tx(f.desc) : "");
    if (matches(q, hay)) out.push(f);
  }
  return out.slice(0, 5);
}

/* ─── שכבה ב · התוכן ───
   entries: [{ bookId, title, pin, kind: "text"|"note"|"result", ch, si, text }]
   si — אינדקס המשפט הגלובלי בספר (כמו data-si במסך הקריאה). */
const cache = new Map(); // bookId → { stamp, entries }
export function indexBook(book, meta, bookSentences) {
  const entries = [];
  if (!book) return entries;
  const { sentences, chapterRanges } = bookSentences(book);
  const chOf = (si) => { for (let c = 0; c < chapterRanges.length; c++) { const [a, b] = chapterRanges[c]; if (si >= a && si < b) return c; } return 0; };
  const base = { bookId: book.id, title: book.title || "", pin: !(book.flex && book.flex.pin === false) };
  sentences.forEach((t, si) => { if (t && t.length > 1) entries.push({ ...base, kind: "text", ch: chOf(si), si, text: t }); });
  for (const k of Object.keys(book.notes || {})) {
    const n = book.notes[k]; const t = n && (n.t || "").trim();
    if (t) entries.push({ ...base, kind: "note", ch: chOf(+k), si: +k, text: t });
  }
  for (const k of Object.keys(book.results || {})) {
    const p = k.indexOf(":"); if (p < 1) continue;
    const ci = parseInt(k.slice(0, p), 10), ch = k.slice(p + 1);
    if (isNaN(ci) || ch.startsWith("trans")) continue;
    const v = book.results[k];
    const strs = [];
    const walk = (x, d) => { if (d > 4 || x == null) return; if (typeof x === "string") { if (x.length > 2) strs.push(x); } else if (Array.isArray(x)) x.forEach((y) => walk(y, d + 1)); else if (typeof x === "object") Object.values(x).forEach((y) => walk(y, d + 1)); };
    walk(v, 0);
    for (const s of strs.slice(0, 120)) entries.push({ ...base, kind: "result", ch: ci, si: chapterRanges[ci] ? chapterRanges[ci][0] : 0, channel: ch, text: s });
  }
  return entries;
}
/* בונה/מרענן את האינדקס לכל הספרים שברשימה. loadBook — אסינכרוני. */
export async function buildIndex(indexList, loadBook, bookSentences) {
  for (const m of indexList) {
    const stamp = String(m.updatedAt || 0) + ":" + (m.pin === false ? 0 : 1);
    const c = cache.get(m.id);
    if (c && c.stamp === stamp) continue;
    const b = await loadBook(m.id);
    cache.set(m.id, { stamp, entries: indexBook(b, m, bookSentences) });
  }
  for (const id of [...cache.keys()]) if (!indexList.some((m) => m.id === id)) cache.delete(id);
}
export function invalidateBook(id) { cache.delete(id); }
export function searchContent(query, limit = 40) {
  const q = tokens(query);
  if (!q.length) return [];
  const hits = [];
  for (const { entries } of cache.values()) {
    for (const e of entries) {
      if (matches(q, e.text)) { hits.push(e); if (hits.length >= limit * 4) break; }
    }
  }
  /* הערות ותוצרים לפני טקסט; על המסך לפני ארכיון */
  const rank = (e) => (e.kind === "note" ? 0 : e.kind === "result" ? 1 : 2) + (e.pin ? 0 : 3);
  hits.sort((a, b) => rank(a) - rank(b));
  return hits.slice(0, limit);
}
/* קטע עם הדגשה: מחזיר [לפני, הדגשה, אחרי] סביב המילה הראשונה שנמצאה */
export function snippet(text, query, width = 70) {
  const q = tokens(query);
  const n = norm(text);
  let pos = -1, len = 0;
  for (const t of q) { for (const v of variants(t)) { const p = n.indexOf(v); if (p >= 0 && (pos < 0 || p < pos)) { pos = p; len = v.length; } } }
  /* n ו-text שונים באורך (ניקוד הוסר) — מחפשים את המילה גם בטקסט המקורי בלי ניקוד */
  const plain = text.replace(NIKUD, "");
  const pp = pos >= 0 ? plain.toLowerCase().indexOf(n.slice(pos, pos + len)) : -1;
  if (pp < 0) return [plain.slice(0, width * 2), "", ""];
  const a = Math.max(0, pp - width), b = Math.min(plain.length, pp + len + width);
  return [(a > 0 ? "…" : "") + plain.slice(a, pp), plain.slice(pp, pp + len), plain.slice(pp + len, b) + (b < plain.length ? "…" : "")];
}
