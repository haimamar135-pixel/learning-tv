// בדיקה מקומית של "שיקוף": vite preview + session מדומה + פונקציות מדומות
import { chromium } from "playwright";

const BASE = "http://localhost:4173";
const now = Math.floor(Date.now() / 1000);
const payload = Buffer.from(JSON.stringify({ sub: "11111111-2222-3333-4444-555555555555", email: "t@t.com", exp: now + 86400, role: "authenticated", aud: "authenticated" })).toString("base64url");
const jwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.sig`;
const session = { access_token: jwt, refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: now + 86400, user: { id: "11111111-2222-3333-4444-555555555555", email: "t@t.com", aud: "authenticated", role: "authenticated" } };

const book = {
  id: "bk1", title: "מסילת ישרים — פרק א",
  chapters: [{ title: "פרק א", text: "יסוד החסידות ושורש העבודה התמימה הוא שיתברר ויתאמת אצל האדם מה חובתו בעולמו. ולמה צריך שישים מבטו ומגמתו בכל אשר הוא עמל כל ימי חייו. והנה מה שהורונו חכמינו זכרונם לברכה הוא שהאדם לא נברא אלא להתענג על ה'. וליהנות מזיו שכינתו שזהו התענוג האמיתי." }],
  results: {}, progress: {},
  marks: { 0: { hl: "y" }, 2: { hl: "g" } },
  notes: { 1: { t: "זו השאלה שלי כבר שנים — לאן המבט?", src: "ולמה צריך שישים מבטו" } },
};
const index = [{ id: "bk1", title: book.title, chapters: 1, done: 0, updatedAt: Date.now() }];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(({ session, book, index }) => {
  localStorage.setItem("sb-hghlesijwzpfdhmlvgiv-auth-token", JSON.stringify(session));
  localStorage.setItem("lomedtv-question", "לאן אני צריך לכוון את המבט?");
  localStorage.setItem("lomedtv-opening-seen", "1");
  const req = indexedDB.open("lomedtv", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("kv");
  req.onsuccess = () => {
    const tx = req.result.transaction("kv", "readwrite");
    tx.objectStore("kv").put(index, "ltv-books-index");
    tx.objectStore("kv").put(book, "ltv-book-bk1");
  };
}, { session, book, index });

const log = [];
await ctx.route("**/hghlesijwzpfdhmlvgiv.supabase.co/**", async (route) => {
  const u = route.request().url();
  if (u.includes("/auth/v1/token")) return route.fulfill({ json: session });
  if (u.includes("/auth/v1/user")) return route.fulfill({ json: session.user });
  if (u.includes("/storage/v1/object/sign/")) return route.fulfill({ json: { signedURL: "/storage/v1/object/sign/x?token=y" } });
  if (u.includes("/storage/v1/object/voice/")) { log.push("storage upload " + u.split("/voice/")[1]); return route.fulfill({ json: { Key: "voice/x", Id: "1" } }); }
  if (u.includes("/rest/v1/")) return route.fulfill({ json: [] });
  return route.fulfill({ json: {} });
});
await ctx.route("**/.netlify/functions/dialogue", async (route) => {
  const body = JSON.parse(route.request().postData());
  log.push(`dialogue: notes=${body.notes.length} marks=${body.marks.length} q=${!!body.question} learner=${body.learner} len=${body.length}`);
  log.push("dialogue mark0: " + body.marks[0].text.slice(0, 40));
  const lines = [];
  for (let i = 0; i < 14; i++) lines.push({ s: i % 2 ? "s" : "t", t: (i % 2 ? "[curious] " : "") + "רפליקה מספר " + (i + 1) + " — " + "מילים מילים מילים ".repeat(18) });
  const chars = lines.reduce((n, l) => n + l.t.length, 0);
  return route.fulfill({ json: { title: "המבט של חיים", lines, chars, minutes: 2 } });
});
let voiceCalls = 0;
await ctx.route("**/.netlify/functions/voice", async (route) => {
  const body = JSON.parse(route.request().postData());
  const chars = body.lines.reduce((n, l) => n + l.t.length, 0);
  voiceCalls++;
  log.push(`voice #${voiceCalls}: lines=${body.lines.length} chars=${chars}`);
  if (chars > 2000) return route.fulfill({ status: 400, json: { error: { message: "too long" } } });
  return route.fulfill({ json: { audio: Buffer.alloc(3000, 0x55).toString("base64"), mime: "audio/mpeg", chars, bytes: 3000 } });
});

const page = await ctx.newPage();
page.on("pageerror", (e) => log.push("PAGEERROR " + e.message));
await page.goto(BASE);
await page.waitForTimeout(1500);
// אם מסך הפתיחה מוצג — לדלג
const opening = page.locator(".opening");
if (await opening.count()) { const b = page.locator(".opening button, .opening a").filter({ hasText: /ספריי|היכנס|דלג/ }).first(); if (await b.count()) await b.click(); }
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/claude-0/-home-claude/ed934e75-e1e2-5cd4-830f-95333c2e6676/scratchpad/m1-library.png" });
const mirrorBtn = page.locator(".mirror-btn");
log.push("library mirror buttons: " + (await mirrorBtn.count()));
await mirrorBtn.first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/claude-0/-home-claude/ed934e75-e1e2-5cd4-830f-95333c2e6676/scratchpad/m2-mirror.png" });
await page.fill(".mirror-name input", "חיים");
await page.click(".pill:has-text('בינוני')");
await page.click("text=✍ כתוב את השיחה");
await page.waitForSelector(".mirror-script", { timeout: 8000 });
await page.screenshot({ path: "/tmp/claude-0/-home-claude/ed934e75-e1e2-5cd4-830f-95333c2e6676/scratchpad/m3-script.png", fullPage: true });
log.push("script lines rendered: " + (await page.locator(".mirror-line").count()));
await page.click("button:has-text('הפק קול')");
await page.waitForSelector(".mirror-row", { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/claude-0/-home-claude/ed934e75-e1e2-5cd4-830f-95333c2e6676/scratchpad/m4-done.png" });
log.push("mirror rows: " + (await page.locator(".mirror-row").count()) + " · audio: " + (await page.locator("audio.mirror-audio").count()));
// נשמר ב-IDB?
const saved = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open("lomedtv", 1);
  req.onsuccess = () => { const tx = req.result.transaction("kv"); const st = tx.objectStore("kv");
    st.getAllKeys().onsuccess = (e) => { const keys = e.target.result; st.get("ltv-book-bk1").onsuccess = (e2) => res({ voiceKeys: keys.filter((k) => String(k).startsWith("ltv-voice-")), mirrors: e2.target.result.flex?.mirrors }); }; };
}));
log.push("idb: " + JSON.stringify(saved));
// חזרה ללוח השידורים — המקש בדק
await page.click("text=לוח השידורים של הספר");
await page.waitForTimeout(300);
log.push("guide deck mirror key: " + (await page.locator(".ch-key.mirror").count()));
console.log(log.join("\n"));
await browser.close();
