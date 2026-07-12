# מסך הלמידה · פריסה ב-Netlify

אפליקציית React שהופכת כל טקסט לערוצי לימוד: סיכום, מושגים, מפת חשיבה, תרשים זרימה, מבחן, כרטיסיות והקראה — עם ספריית ספרים ומעקב התקדמות.

## מה צריך מראש
1. חשבון GitHub (חינם)
2. חשבון Netlify (חינם) — netlify.com
3. מפתח API של Anthropic — console.anthropic.com ← API Keys ← Create Key (השימוש בתשלום לפי צריכה)

## פריסה — שלב אחר שלב

### 1. העלאה ל-GitHub
צרו repository חדש והעלו אליו את כל תיקיית הפרויקט (אפשר דרך "Add file → Upload files" באתר GitHub, בלי שורת פקודה).

### 2. חיבור ל-Netlify
- ב-Netlify: **Add new site → Import an existing project → GitHub** ובחרו את ה-repo.
- Netlify יזהה לבד את ההגדרות מ-netlify.toml (build: `npm run build`, publish: `dist`).
- לחצו **Deploy**.

### 3. הגדרת המפתח (קריטי!)
- באתר שנוצר: **Site configuration → Environment variables → Add a variable**
- Key: `ANTHROPIC_API_KEY`
- Value: המפתח שלכם (מתחיל ב-`sk-ant-`)
- שמרו ואז **Deploys → Trigger deploy → Deploy site** כדי שהמשתנה ייכנס לתוקף.

זהו — האתר חי בכתובת שקיבלתם מ-Netlify.

## הרצה מקומית (אופציונלי)
```bash
npm install
npm install -g netlify-cli
cp .env.example .env        # והכניסו את המפתח שלכם
netlify dev                  # מריץ את האתר + הפונקציה יחד
```
שימו לב: `npm run dev` לבד לא מריץ את פונקציית השרת — להרצה מלאה השתמשו ב-`netlify dev`.

## איך זה בנוי
- `src/App.jsx` — האפליקציה כולה
- `netlify/functions/claude.js` — פונקציית שרת שמחזיקה את המפתח ומעבירה בקשות ל-Anthropic API. **המפתח לעולם לא מגיע לדפדפן.**
- השמירה: localStorage — הספרים וההתקדמות נשמרים במכשיר/דפדפן הנוכחי. לסנכרון בין מכשירים וחשבונות משתמש — השלב הבא (Supabase).

## אזהרות
- אל תעלו את קובץ `.env` ל-GitHub (הוא כבר ב-.gitignore).
- האתר פתוח לכל מי שיש לו את הכתובת — וכל שימוש מחויב במפתח שלכם. אם תרצו להגביל, אפשר להוסיף סיסמה בסיסית (Netlify Identity / הגנת סיסמה בתוכנית בתשלום) או מגבלת שימוש בפונקציה.
