-- ─── טבלת השימוש של השער (מכסות יומיות) ───
-- להריץ פעם אחת ב-Supabase: SQL Editor ← New query ← להדביק ← Run.
-- כל משתמש רואה וכותב רק את השורות שלו, ואינו יכול למחוק או לשנות אותן.
-- הפונקציות בנטליפיי (claude, transcribe) כותבות לכאן שורה לכל קריאה,
-- וסוכמות את היום הנוכחי לפני כל קריאה חדשה.

create table if not exists public.usage_log (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  fn         text not null check (fn in ('claude', 'transcribe', 'voice')),
  units      integer not null default 1 check (units > 0 and units <= 100),
  created_at timestamptz not null default now()
);

create index if not exists usage_log_user_day
  on public.usage_log (user_id, fn, created_at desc);

alter table public.usage_log enable row level security;

drop policy if exists "usage: read own" on public.usage_log;
create policy "usage: read own" on public.usage_log
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "usage: insert own" on public.usage_log;
create policy "usage: insert own" on public.usage_log
  for insert to authenticated with check (auth.uid() = user_id);

-- אין policy ל-update/delete בכוונה: אי אפשר "לאפס" את המכסה מהצד של המשתמש.

-- לבדיקה (אחרי הרצה): מי ניצל כמה היום
-- select u.email, l.fn, sum(l.units) from usage_log l join auth.users u on u.id = l.user_id
--   where l.created_at >= (now() at time zone 'Asia/Jerusalem')::date group by 1,2 order by 3 desc;
