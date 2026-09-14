-- ─── 🎧 שיקוף: אחסון קבצי הקול ───
-- להריץ פעם אחת ב-Supabase: SQL Editor ← New query ← להדביק ← Run.
-- יוצר bucket פרטי בשם "voice". כל משתמש קורא, כותב ומוחק רק בתיקייה שלו:
--   voice/<user_id>/<book_id>/<mirror_id>.mp3
-- האפליקציה מעלה את הקובץ עם הטוקן של המשתמש (supabase-js), ומנגנת דרך signed URL.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice', 'voice', false, 26214400, array['audio/mpeg'])
on conflict (id) do update set public = false, file_size_limit = 26214400, allowed_mime_types = array['audio/mpeg'];

drop policy if exists "voice: read own" on storage.objects;
create policy "voice: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "voice: insert own" on storage.objects;
create policy "voice: insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "voice: update own" on storage.objects;
create policy "voice: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "voice: delete own" on storage.objects;
create policy "voice: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);

-- לבדיקה (אחרי הרצה): select id, name, public from storage.buckets where id = 'voice';
