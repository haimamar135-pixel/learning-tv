-- ─── טבלת המשוב של הבודקים (עמוד המדריך /guide/) ───
-- להריץ פעם אחת ב-Supabase: SQL Editor ← New query ← להדביק ← Run.
-- כל אחד (גם בלי חשבון) יכול לשלוח משוב; לקרוא יכול רק בעל הפרויקט (Table Editor).

create table if not exists public.feedback (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  name       text,
  device     text,
  liked      text,
  confusing  text,
  improve    text,
  rating     integer check (rating between 1 and 5),
  page       text
);

alter table public.feedback enable row level security;

drop policy if exists "feedback: anyone can send" on public.feedback;
create policy "feedback: anyone can send" on public.feedback
  for insert to anon, authenticated with check (true);

-- אין policy ל-select/update/delete: משובים נקראים רק מה-Dashboard.
-- לקריאה: Table Editor ← feedback, או:
-- select created_at, name, device, rating, liked, confusing, improve from feedback order by created_at desc;
