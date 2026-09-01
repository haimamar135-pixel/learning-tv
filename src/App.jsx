   import { useState, useEffect, useRef, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";

/* ─── ענן (Supabase) — שלב 1: חשבון משתמש ───
   המפתח הזה ציבורי בכוונה (publishable); ההגנה היא Row Level Security
   בצד השרת — כל משתמש רואה אך ורק את הנתונים שלו. */
const SUPA_URL = "https://hghlesijwzpfdhmlvgiv.supabase.co";
const SUPA_KEY = "sb_publishable_JsWZApJRwuzZId7iUPwUkA_EGlZfNNe";
const supa = createClient(SUPA_URL, SUPA_KEY);
 
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
 
const PROMPTS = {
  summary: (t) =>
    `קרא את הטקסט הבא והחזר JSON בלבד במבנה: {"short":"סיכום קצר של 2-3 משפטים","long":"סיכום מפורט של 2-3 פסקאות"}. הטקסט:\n${t}`,
  concepts: (t) =>
    `קרא את הטקסט הבא והחזר JSON בלבד במבנה: {"concepts":[{"term":"מושג","definition":"הגדרה קצרה"}],"rules":["כלל או עיקרון מהטקסט"]}. הפק עד 8 מושגים ועד 6 כללים. הטקסט:\n${t}`,
  mindmap: (t) =>
    `קרא את הטקסט הבא והחזר JSON בלבד של מפת חשיבה במבנה: {"topic":"הנושא המרכזי","children":[{"label":"ענף ראשי","children":[{"label":"תת-ענף"}]}]}. עד 5 ענפים ראשיים, עד 4 תתי-ענפים לכל אחד. הטקסט:\n${t}`,
  flow: (t) =>
    `קרא את הטקסט הבא והחזר JSON בלבד של תרשים זרימה לוגי (תהליך, רצף רעיונות או השתלשלות) במבנה: {"title":"כותרת התהליך","steps":["שלב 1","שלב 2"]}. בין 4 ל-8 שלבים. הטקסט:\n${t}`,
  quiz: (t, n = 5, angle = "") =>
    `קרא את הטקסט הבא וכתוב מבחן. החזר JSON בלבד במבנה: {"questions":[{"q":"שאלה","options":["א","ב","ג","ד"],"correct":0,"explanation":"הסבר קצר לתשובה הנכונה"}]}. בדיוק ${n} שאלות, correct הוא אינדקס התשובה הנכונה. ${angle}הטקסט:\n${t}`,
  cards: (t) =>
    `קרא את הטקסט הבא וצור כרטיסיות זיכרון. החזר JSON בלבד במבנה: {"cards":[{"front":"שאלה או מושג","back":"תשובה או הגדרה"}]}. בין 6 ל-10 כרטיסיות. הטקסט:\n${t}`,
};
 
/* ─── קריאה ל-Claude דרך Netlify Function ───
   המפתח נשמר בצד השרת (משתנה סביבה ANTHROPIC_API_KEY) ולא נחשף לדפדפן. */
async function askClaude(prompt, maxTokens, fast) {
  let res;
  try {
    res = await fetch("/.netlify/functions/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, maxTokens, fast }),
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
  } else if (clean.length <= CHAPTER_LIMIT) {
    chunks = [clean];
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
 
/* ─── אחסון מתמשך (localStorage) ───
   נשמר במכשיר/דפדפן הנוכחי. לסנכרון בין מכשירים — שלב החשבונות (Supabase). */
async function loadIndex() {
  try {
    const v = localStorage.getItem("ltv-books-index");
    return v ? JSON.parse(v) : [];
  } catch {
    return [];
  }
}
async function saveIndex(idx) {
  try {
    localStorage.setItem("ltv-books-index", JSON.stringify(idx));
  } catch (e) {
    console.error("saveIndex failed", e);
  }
}
async function loadBook(id) {
  try {
    const v = localStorage.getItem("ltv-book-" + id);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
async function saveBookToStorage(book) {
  try {
    localStorage.setItem("ltv-book-" + book.id, JSON.stringify(book));
  } catch (e) {
    console.error("saveBook failed", e);
  }
}
async function deleteBookFromStorage(id) {
  try {
    localStorage.removeItem("ltv-book-" + id);
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
function downloadBackup() {
  try {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      /* חותמות הסנכרון שייכות למכשיר הזה בלבד — לא נכנסות לגיבוי,
         כדי ששחזור במכשיר אחר לא ישתיק שם הצעת הורדה לגיטימית מהענן. */
      if (k === "ltv-cloud-stamps") continue;
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
  reader.onload = () => {
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
      for (const k of keys) localStorage.setItem(k, payload.data[k]);
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
 
/* ─── תצוגות הערוצים ─── */
 
function SummaryView({ data }) {
  const [mode, setMode] = useState("long");
  return (
    <div>
      <div className="pill-row">
        <button className={"pill " + (mode === "long" ? "on" : "")} onClick={() => setMode("long")}>מפורט</button>
        <button className={"pill " + (mode === "short" ? "on" : "")} onClick={() => setMode("short")}>קצר</button>
      </div>
      <p className="prose">{mode === "long" ? data.long : data.short}</p>
    </div>
  );
}
 
function ConceptsView({ data, onTrace }) {
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
              <span className="def">{c.definition}</span>
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
                className={onTrace ? "traceable" : undefined}
                onClick={onTrace ? () => onTrace(r) : undefined}
                title={onTrace ? "הצג את המקור בטקסט" : undefined}
              >{r}</li>
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
 
function ReadView({ text, title }) {
  return (
    <div className="read">
      <h2 className="read-title">{title}</h2>
      <div className="read-body">{text}</div>
      <p className="read-hint">אחרי שקראת — בחר ערוץ למטה כדי לקבל סיכום, מבחן, כרטיסיות ועוד על מה שלמדת.</p>
    </div>
  );
}
 
function CardsView({ data }) {
  const [flipped, setFlipped] = useState({});
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
      <p className="cards-hint">לחיצה על כרטיסייה הופכת אותה</p>
    </div>
  );
}
 
function TTSView({ text }) {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1);
 
  useEffect(() => () => window.speechSynthesis?.cancel(), [text]);
 
  const play = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (paused) { synth.resume(); setPaused(false); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
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
      <div className="tts-text">{text}</div>
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
async function buildQuiz(text, n) {
  const ANGLES = [
    "התמקד בשאלות ידע והבנה ישירה של הנאמר בטקסט. ",
    "התמקד בשאלות העמקה, הסקה וקשרים בין רעיונות. אל תחזור על שאלות בסיסיות. ",
    "התמקד בשאלות על מושגים והגדרות מתוך הטקסט. ",
    "התמקד בשאלות יישום והשוואה בין חלקי הטקסט. ",
  ];
  const once = (size, k) =>
    askClaude(PROMPTS.quiz(text, size, ANGLES[k % ANGLES.length] + "הסברים קצרים — עד 12 מילים. "), 1800, true);
  const withRetry = async (size, k) => {
    try { return await once(size, k); }
    catch { return await once(size, k); } // ניסיון שני אוטומטי
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
 
  /* ── מצב מגילה (גמיש) ── */
  const [markMode, setMarkMode] = useState(null); // null | 'start' | 'end' | 'bookmark'
  const [selStart, setSelStart] = useState(null); // אינדקס פסקה
  const [selEnd, setSelEnd] = useState(null);
  const [dragText, setDragText] = useState("");   // טקסט שסומן בגרירה
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

  /* ─── חשבון ענן (Supabase) — שלב 1: כניסה בקישור למייל ─── */
  const [cloudUser, setCloudUser] = useState(null);
  const [showCloud, setShowCloud] = useState(false);
  const [cloudEmail, setCloudEmail] = useState("");
  const [cloudMsg, setCloudMsg] = useState("");
  useEffect(() => {
    supa.auth.getSession().then(({ data }) => setCloudUser(data?.session?.user || null));
    const { data: sub } = supa.auth.onAuthStateChange((_ev, session) => setCloudUser(session?.user || null));
    return () => { try { sub.subscription.unsubscribe(); } catch {} };
  }, []);
  async function sendMagicLink() {
    const email = cloudEmail.trim();
    if (!email || !email.includes("@")) { setCloudMsg("כתובת מייל לא תקינה"); return; }
    setCloudMsg("שולח קישור...");
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setCloudMsg(error ? "שגיאה: " + error.message : "✅ נשלח! פתח את המייל שלך ולחץ על הקישור — תחזור לכאן מחובר.");
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
        const entry = { id: nb.id, title: nb.title, chapters: nb.chapters.length, done: doneCount(nb), updatedAt };
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
  const { sentences, paraGroups } = useMemo(() => {
    if (!book) return { sentences: [], paraGroups: [] };
    const all = book.chapters.map((c) => c.text).join("\n\n");
    const paras = all.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const sentences = [];
    const paraGroups = [];
    for (const p of paras) {
      const parts = p.match(/[^.!?׃]+[.!?׃]+["'״׳)\]]*\s*|[^.!?׃]+$/g) || [p];
      const start = sentences.length;
      for (const s of parts) {
        const t = s.trim();
        if (t) sentences.push(t);
      }
      if (sentences.length > start) paraGroups.push([start, sentences.length - start]);
    }
    return { sentences, paraGroups };
  }, [book?.id, book?.chapters?.length]);
 
  useEffect(() => {
    (async () => {
      const idx = await loadIndex();
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
      updatedAt: Date.now(),
    };
    const nextIdx = [entry, ...index.filter((b) => b.id !== nextBook.id)];
    setIndex(nextIdx);
    await saveBookToStorage(nextBook);
    await saveIndex(nextIdx);
    if (sync) queueSync({ ...sync, book: nextBook });
  };
 
  const buildBook = async (text, forcedTitle, stayInLibrary = false) => {
    const chapters = splitToChapters(text);
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
 
  const openBook = async (id) => {
    const b = await loadBook(id);
    if (!b) { setError("הספר לא נמצא באחסון."); return; }
    setBook(b);
    setChannel(null);
    setError(null);
    flick();
    setView("guide");
  };
 
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

  const HL_COLORS = { y: "#fff3a0", g: "#d3f7c6", p: "#ffd6e8" };
  const applyMark = async (patch) => {
    if (!rangeIdx) return;
    const marks = { ...(book.marks || {}) };
    for (let i = rangeIdx[0]; i <= rangeIdx[1]; i++) {
      if (patch === null) delete marks[i];
      else marks[i] = { ...(marks[i] || {}), ...patch };
    }
    await persist({ ...book, marks });
    setSelStart(null);
    setSelEnd(null);
    setDragText("");
  };

  /* הערות שוליים חיות: הערה אישית על משפט, נשמרת עם הספר */
  const noteVal = (n) => (typeof n === "string" ? n : n?.t || "");
  const addNote = async () => {
    if (!rangeIdx) return;
    const i = rangeIdx[0];
    const existing = noteVal(book.notes?.[i]);
    const txt = window.prompt("✏️ הערה על הקטע (השאר ריק למחיקה):", existing);
    if (txt === null) return;
    const notes = { ...(book.notes || {}) };
    if (txt.trim()) notes[i] = { t: txt.trim(), src: (sentences[i] || "").slice(0, 160) };
    else delete notes[i];
    await persist({ ...book, notes }, { k: "note", i });
    setSelStart(null); setSelEnd(null); setDragText("");
  };
  const editNote = async (i) => {
    const existing = noteVal(book.notes?.[i]);
    const txt = window.prompt("✏️ הערה (השאר ריק למחיקה):", existing);
    if (txt === null) return;
    const notes = { ...(book.notes || {}) };
    if (txt.trim()) notes[i] = { t: txt.trim(), src: (sentences[i] || "").slice(0, 160) };
    else delete notes[i];
    await persist({ ...book, notes }, { k: "note", i });
  };
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
    if (a !== null && b !== null) {
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
 
  const clearSelection = () => {
    setSelStart(null);
    setSelEnd(null);
    setDragText("");
    setFlexError(null);
    window.getSelection?.()?.removeAllRanges?.();
  };
 
  // הטקסט הנבחר בפועל: גרירה קודמת לנקודות
  const rangeIdx =
    selStart !== null && selEnd !== null
      ? [Math.min(selStart, selEnd), Math.max(selStart, selEnd)]
      : null;
  const selectedText =
    dragText ||
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
      const data = id === "quiz" ? await buildQuiz(t, qCount) : await askClaude(PROMPTS[id](t), 2000, FAST_IDS.includes(id));
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
          ? await buildQuiz(book.chapters[ci].text, qCount)
          : await askClaude(PROMPTS[id](book.chapters[ci].text), 2000, FAST_IDS.includes(id));
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
    setChannel(id);
    setError(null);
    window.speechSynthesis?.cancel();
    generate(id, chIdx);
  };
 
  const gotoChapter = (i) => {
    if (loading || i === chIdx) return;
    flick();
    setQuizPick(null);
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
    : "קליטת טקסט";
  const barNum = view === "tv" && active ? `CH ${active.num}` : view === "scroll" ? "CH ∞" : "CH 00";
 
  return (
    <div className="studio" dir="rtl">
      <style>{css}</style>
 
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
              <span className="font-btns">
                <button className="font-btn" onClick={() => bumpFont(-0.1)} title="הקטנת טקסט" aria-label="הקטנת טקסט">אַ−</button>
                <button className="font-btn" onClick={() => bumpFont(0.1)} title="הגדלת טקסט" aria-label="הגדלת טקסט">אַ+</button>
                <button className="font-btn" onClick={() => window.print()} title="הדפסת התוכן המוצג" aria-label="הדפסה">🖨</button>
                <button className="font-btn" onClick={downloadBackup} title="גיבוי: הורדת כל הספרים, ההערות והמרקרים לקובץ" aria-label="גיבוי">⬇</button>
                <button className="font-btn" onClick={pickRestoreFile} title="שחזור מקובץ גיבוי" aria-label="שחזור">⬆</button>
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
 
            <div className="screen-body" style={{ zoom: fontScale }}>
              {view === "boot" && (
                <div className="idle"><div className="idle-mark spin">✳</div><p>טוען את הספרייה…</p></div>
              )}
 
              {/* ── קליטת ספר חדש ── */}
              {view === "intake" && (
                <div className="intake">
                  <p className="intake-lead">
                    הדבק ספר, פרק או מאמר — או העלה קובץ — והמסך יהפוך אותו לסדרת פרקים עם ערוצי למידה: סיכום, מושגים, מפת חשיבה, מבחן ועוד. ההתקדמות נשמרת, כך שאפשר ללמוד ספר שלם לאורך זמן.
                  </p>
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
                      ⬇ הכפתורים למטה: שדר טקסט, העלה קבצים (אפשר כמה בבת אחת — כל קובץ נהיה ספר), או צילומים לפענוח OCR עברי. הכל נקרא במחשב שלך בלבד.
                    </span>
                    {fileBusy && <span className="busy-line">⏳ {fileBusy}</span>}
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
                  <p className="intake-lead">הספרים שלך. כל ספר שומר את הפרקים, התוצרים והציונים שלו.</p>
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
 
              {/* ── לוח שידורים של ספר ── */}
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
                      {flexResult.channel === "summary" && <SummaryView data={flexResult.data} />}
                      {flexResult.channel === "concepts" && <ConceptsView data={flexResult.data} onTrace={traceToSource} />}
                      {flexResult.channel === "mindmap" && <MindmapView data={flexResult.data} />}
                      {flexResult.channel === "flow" && <FlowView data={flexResult.data} />}
                      {flexResult.channel === "quiz" && <QuizView data={flexResult.data} saved={null} onComplete={() => {}} />}
                      {flexResult.channel === "cards" && <CardsView data={flexResult.data} />}
                    </div>
                  )}
 
                  {/* המגילה עצמה */}
                  {!flexResult && !flexLoading && (
                    <div className="scroll-text" ref={scrollBodyRef} onMouseUp={onScrollMouseUp}>
                      {paraGroups.map(([start, count], pi) => (
                        <div key={pi}>
                          <p className="scroll-para">
                            {sentences.slice(start, start + count).map((s, j) => {
                              const i = start + j;
                              const inRange = rangeIdx && i >= rangeIdx[0] && i <= rangeIdx[1];
                              const isStart = selStart !== null && i === selStart && selEnd === null;
                              const isRead = book.flex?.upTo !== undefined && i <= book.flex.upTo;
                              return (
                                <span
                                  key={i}
                                  id={"para-" + i}
                                  style={(() => {
                                    const mk = book.marks?.[i];
                                    if (!mk) return undefined;
                                    return {
                                      fontWeight: mk.b ? 800 : undefined,
                                      textDecoration: mk.u ? "underline" : undefined,
                                      background: mk.hl ? HL_COLORS[mk.hl] : undefined,
                                    };
                                  })()}
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
                                  {s}
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
                <ReadView key={key(chIdx, "read")} text={cur.text} title={cur.title} />
              )}
 
              {view === "tv" && channel === "tts" && !loading && cur && (
                <TTSView key={key(chIdx, "tts")} text={cur.text} />
              )}
 
              {view === "tv" && channel && channel !== "tts" && channel !== "read" && !loading && !error && data && (
                <>
                  {channel === "summary" && <SummaryView key={key(chIdx, channel)} data={data} />}
                  {channel === "concepts" && <ConceptsView data={data} onTrace={traceToSource} />}
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
                  {channel === "cards" && <CardsView key={key(chIdx, channel)} data={data} />}
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
 
      {/* לוח מקשים — משתנה לפי ההקשר */}
      {view === "library" && (
        <div className="deck">
          <button className="ch-key gold" onClick={() => { setError(null); setView("intake"); }}>
            <span className="key-num">＋</span>
            <span className="key-label">ספר חדש</span>
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
              const cached = (c.id === "tts" || c.id === "read") ? channel === c.id : !!book.results[key(chIdx, c.id)];
              return (
                <button
                  key={c.id}
                  className={"ch-key " + (channel === c.id ? "active " : "") + (cached ? "cached " : "")}
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
 
          {selectedText && !flexResult && !flexLoading && selStart !== null && selEnd !== null && (
            <div className="mark-bar">
              <span className="mark-title">✍️ שכבת הלומד:</span>
              <button className="mark-btn" style={{ fontWeight: 800 }} onClick={() => applyMark({ b: 1 })}>B מודגש</button>
              <button className="mark-btn" style={{ textDecoration: "underline" }} onClick={() => applyMark({ u: 1 })}>U קו תחתון</button>
              <button className="mark-btn hl-y" onClick={() => applyMark({ hl: "y" })}>מרקר</button>
              <button className="mark-btn hl-g" onClick={() => applyMark({ hl: "g" })}>מרקר</button>
              <button className="mark-btn hl-p" onClick={() => applyMark({ hl: "p" })}>מרקר</button>
              <button className="mark-btn" onClick={addNote}>📝 הערה</button>
              <button className="mark-btn" onClick={() => applyMark(null)}>✕ נקה עיצוב</button>
            </div>
          )}

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
  );
}
 
/* ─── עיצוב ─── */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;800&family=IBM+Plex+Mono:wght@400;600&display=swap');
 
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
}
 
.masthead{display:flex;align-items:baseline;gap:12px;margin-bottom:22px;flex-wrap:wrap;justify-content:center}
.mast-dot{width:10px;height:10px;border-radius:50%;background:var(--amber);box-shadow:0 0 12px var(--amber);align-self:center}
.masthead h1{font-size:1.9rem;font-weight:800;letter-spacing:.5px}
.mast-sub{color:#9aa1c4;font-size:.95rem}
 
.tv{width:100%;max-width:860px}
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
  flex:1;background:var(--paper);color:var(--ink);padding:26px 30px;overflow-y:auto;max-height:560px;
  background-image:radial-gradient(rgba(0,0,0,.03) 1px,transparent 1px);background-size:5px 5px;
}
.prose{line-height:1.9;font-size:1.05rem;white-space:pre-wrap}
 
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
.mark-title{font-weight:800;font-size:.9rem;color:#6c6449}
.mark-btn{font-family:inherit;font-size:.85rem;padding:6px 12px;border-radius:9px;border:1.5px solid #cfc8b4;background:#fffdf6;color:#232323;cursor:pointer}
.mark-btn:hover{border-color:var(--amber)}
.mark-btn.hl-y{background:#fff3a0}
.mark-btn.hl-g{background:#d3f7c6}
.mark-btn.hl-p{background:#ffd6e8}
@media print{
  body{background:#fff!important}
  .masthead,.deck,.dial,.tv-chin,.tv-stand,.font-btns,.search-row,.search-panel,.flex-hint,.mark-bar,.fm-hint,.bar-title{display:none!important}
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
.read-title{font-size:1.25rem;font-weight:800;color:#232323;border-bottom:2px solid var(--amber);padding-bottom:10px}
.read-body{line-height:2.05;font-size:1.08rem;white-space:pre-wrap;color:#232323}
.read-hint{margin-top:8px;color:#8a8467;font-size:.9rem;line-height:1.6;border-top:1px dashed #d9d2bd;padding-top:14px}
 
/* הקראה */
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
.ch-key.gold{background:linear-gradient(180deg,#f5b95c,var(--amber));border-color:var(--amber-deep);color:#241a08}
.ch-key.gold .key-num,.ch-key.gold .key-label{color:#241a08}
.ch-key.gold:hover:not(:disabled){border-color:#8a5510}
.ch-key.green{background:linear-gradient(180deg,#25695e,#1e5c52);border-color:#2a7a6e;color:#eafff9}
.ch-key.green .key-num{color:#9fe8d9}
.brand{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:5px;color:#6e769c}
.deck{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:24px;max-width:860px}
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
  
