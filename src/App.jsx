

App · JSX
import { useState, useEffect, useRef, useMemo } from "react";
 
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
  quiz: (t) =>
    `קרא את הטקסט הבא וכתוב מבחן. החזר JSON בלבד במבנה: {"questions":[{"q":"שאלה","options":["א","ב","ג","ד"],"correct":0,"explanation":"הסבר קצר לתשובה הנכונה"}]}. 5 שאלות, correct הוא אינדקס התשובה הנכונה. הטקסט:\n${t}`,
  cards: (t) =>
    `קרא את הטקסט הבא וצור כרטיסיות זיכרון. החזר JSON בלבד במבנה: {"cards":[{"front":"שאלה או מושג","back":"תשובה או הגדרה"}]}. בין 6 ל-10 כרטיסיות. הטקסט:\n${t}`,
};
 
/* ─── קריאה ל-Claude דרך Netlify Function ───
   המפתח נשמר בצד השרת (משתנה סביבה ANTHROPIC_API_KEY) ולא נחשף לדפדפן. */
async function askClaude(prompt) {
  let res;
  try {
    res = await fetch("/.netlify/functions/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
  } catch (e) {
    console.log("Network error:", e);
    throw new Error("בעיית רשת — הבקשה לא הגיעה לשרת");
  }
 
  const data = await res.json();
  console.log("API status:", res.status);
 
  if (data.type === "error" || data.error) {
    throw new Error(`שגיאת API [${res.status}]: ${data.error?.message || ""}`);
  }
 
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
 
  if (!text.trim()) throw new Error("התקבלה תשובה ריקה");
 
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
 
function ConceptsView({ data }) {
  return (
    <div className="concepts">
      {data.concepts?.length > 0 && (
        <section>
          <h3 className="sec-title">מושגים</h3>
          {data.concepts.map((c, i) => (
            <div className="term-row" key={i}>
              <span className="term">{c.term}</span>
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
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
 
function MindmapView({ data }) {
  return (
    <div className="mindmap">
      <div className="mm-topic">{data.topic}</div>
      <div className="mm-branches">
        {(data.children || []).map((b, i) => (
          <div className="mm-branch" key={i}>
            <div className="mm-branch-label">{b.label}</div>
            {(b.children || []).map((s, j) => (
              <div className="mm-leaf" key={j}>{s.label}</div>
            ))}
          </div>
        ))}
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
  const scrollBodyRef = useRef(null);
 
  const titleRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const photoRef = useRef(null);
 
  /* כל טקסט הספר כפסקאות — למצב המגילה */
  const paragraphs = useMemo(() => {
    if (!book) return [];
    const all = book.chapters.map((c) => c.text).join("\n\n");
    return all.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
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
 
  /* שמירה: ספר + עדכון האינדקס בפעולה אחת */
  const persist = async (nextBook) => {
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
    await persist(nb);
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
  const openScroll = () => {
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
 
  const onParagraphClick = async (i) => {
    if (!markMode) return;
    if (markMode === "start") {
      setSelStart(i);
      setDragText("");
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
    const s = window.getSelection?.()?.toString().trim() || "";
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
    (rangeIdx ? paragraphs.slice(rangeIdx[0], rangeIdx[1] + 1).join("\n\n") : "");
 
  const generateFlex = async (id) => {
    if (!selectedText || flexLoading) return;
    let t = selectedText;
    if (t.length > 12000) {
      const cut = t.lastIndexOf(".", 12000);
      t = t.slice(0, cut > 6000 ? cut + 1 : 12000);
    }
    const action = FLEX_ACTIONS.find((a) => a.id === id);
    setFlexLoading(action?.label || id);
    setFlexError(null);
    setFlexResult(null);
    try {
      const data = await askClaude(PROMPTS[id](t));
      setFlexResult({ channel: id, data });
    } catch (e) {
      setFlexError(e.message || "ההפקה נכשלה. נסה שוב.");
    } finally {
      setFlexLoading(null);
    }
  };
 
  const generate = async (id, ci) => {
    if (id === "tts" || id === "read") return;
    if (book.results[key(ci, id)]) return;
    setLoading(true);
    setError(null);
    try {
      const data = await askClaude(PROMPTS[id](book.chapters[ci].text));
      await persist({ ...book, results: { ...book.results, [key(ci, id)]: data } });
    } catch (e) {
      setError(e.message || "השידור נכשל. נסה שוב.");
    } finally {
      setLoading(false);
    }
  };
 
  const tune = (id) => {
    if (loading) return;
    flick();
    setChannel(id);
    setError(null);
    window.speechSynthesis?.cancel();
    generate(id, chIdx);
  };
 
  const gotoChapter = (i) => {
    if (loading || i === chIdx) return;
    flick();
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
    setChannel(null);
    flick();
    setView("guide");
  };
  const backToLibrary = () => {
    window.speechSynthesis?.cancel();
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
              <span className={"onair " + (loading ? "live" : "")}>{loading ? "ON AIR" : ""}</span>
            </div>
 
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
 
            <div className="screen-body">
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
                    ref={photoRef}
                    type="file"
                    multiple
                    accept="image/*"
                    style={{ display: "none" }}
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
                  <p className="flex-hint">
                    {markMode === "bookmark"
                      ? "📍 לחץ על פסקה כדי לקבוע: עד כאן קראתי."
                      : markMode === "start"
                      ? "⟢ לחץ על הפסקה שבה מתחיל הקטע."
                      : markMode === "end"
                      ? "⟣ לחץ על הפסקה שבה מסתיים הקטע."
                      : selectedText
                      ? `✓ סומן קטע (${selectedText.length.toLocaleString()} תווים) — בחר למטה מה להפיק עליו.`
                      : "גלול וקרא חופשי. סמן קטע בגרירת עכבר, או השתמש בכפתורים למטה: סימנייה · התחלה · סוף."}
                  </p>
 
                  {/* תוצאה שהופקה על הקטע */}
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
                      {flexResult.channel === "concepts" && <ConceptsView data={flexResult.data} />}
                      {flexResult.channel === "mindmap" && <MindmapView data={flexResult.data} />}
                      {flexResult.channel === "flow" && <FlowView data={flexResult.data} />}
                      {flexResult.channel === "quiz" && <QuizView data={flexResult.data} saved={null} onComplete={() => {}} />}
                      {flexResult.channel === "cards" && <CardsView data={flexResult.data} />}
                    </div>
                  )}
 
                  {/* המגילה עצמה */}
                  {!flexResult && !flexLoading && (
                    <div className="scroll-text" ref={scrollBodyRef} onMouseUp={onScrollMouseUp}>
                      {paragraphs.map((p, i) => {
                        const inRange = rangeIdx && i >= rangeIdx[0] && i <= rangeIdx[1];
                        const isRead = book.flex?.upTo !== undefined && i <= book.flex.upTo;
                        return (
                          <div key={i} id={"para-" + i}>
                            <p
                              className={
                                "scroll-para " +
                                (inRange ? "in-range " : "") +
                                (isRead ? "was-read " : "") +
                                (markMode ? "clickable" : "")
                              }
                              onClick={() => onParagraphClick(i)}
                            >
                              {p}
                            </p>
                            {book.flex?.upTo === i && (
                              <div className="bookmark-line">📍 עד כאן קראת</div>
                            )}
                          </div>
                        );
                      })}
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
                  {channel === "concepts" && <ConceptsView data={data} />}
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
          <button className="ch-key green" onClick={() => photoRef.current?.click()} disabled={!!fileBusy}>
            <span className="key-num">📷</span>
            <span className="key-label">צילומים OCR</span>
          </button>
          {index.length > 0 && (
            <button className="ch-key newtext" onClick={backToLibrary} disabled={!!fileBusy}>
              <span className="key-num">⏏</span>
              <span className="key-label">לספרייה</span>
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
            <button className="ch-key newtext" onClick={backToGuide} disabled={loading}>
              <span className="key-num">⏏</span>
              <span className="key-label">לוח שידורים</span>
            </button>
            {!book.progress?.[chIdx]?.done && (
              <button className="ch-key newtext" onClick={() => markDone(chIdx)} disabled={loading}>
                <span className="key-num">✓</span>
                <span className="key-label">סמן כהושלם</span>
              </button>
            )}
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
            <span className="key-num">⏏</span>
            <span className="key-label">לספרייה</span>
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
              <span className="key-num">⏏</span>
              <span className="key-label">לוח שידורים</span>
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
.scroll-para.clickable{cursor:pointer}
.scroll-para.clickable:hover{background:#fdeed3}
.scroll-para.in-range{background:#fdeed3;border-inline-start:3px solid var(--amber)}
.scroll-para.was-read{color:#6c6449}
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
 
