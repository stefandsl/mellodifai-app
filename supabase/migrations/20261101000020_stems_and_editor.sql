-- Stems and the audio editor (docs/egm/v2-local-engines/feature-parity-plan.md, T11).
--
-- Stems: an on-demand worker stage. The web asks for them with request_stems; the worker
-- separates the chosen take with Demucs (htdemucs, the model the timing stage uses) and writes
-- the four tracks into takes.stems. The stage never changes the song status.
--
-- takes.stems, written by the worker only (authenticated has no write grant on takes):
-- { "model": "htdemucs", "format": "mp3", "bitrate": 192, "duration": 281.04, "seconds": 74.2,
--   "created_at": "...", "tracks": { "vocals": { "path": "previews/...", "peaks": [0..1, ...] },
--   "drums": {...}, "bass": {...}, "other": {...} } }
-- Stems belong to one take, so the preview cleanup that drops superseded takes drops their
-- stems too, and a new chosen take (an edit) starts without stems.

alter table public.jobs drop constraint jobs_stage_check;
alter table public.jobs add constraint jobs_stage_check check (stage in (
  'draft_lyrics', 'generate_song', 'timing', 'storyboard', 'render_master', 'render_hook', 'qa',
  'art', 'publish', 'set_privacy', 'import_legacy', 'stems'));

alter table public.takes add column if not exists stems jsonb;
alter table public.takes add constraint takes_stems_object check (stems is null or jsonb_typeof(stems) = 'object');

-- 'edit': a take saved from the audio editor ("Salva come nuova versione").
alter table public.takes drop constraint takes_engine_check;
alter table public.takes add constraint takes_engine_check check (engine in ('kie', 'ace-step', 'yue2', 'edit'));

-- Statuses in which a song has a chosen take whose audio is final enough to separate.
create function public.stems_allowed_status(p_status text) returns boolean
language sql immutable set search_path='' as $$
  select p_status in ('audio_ready', 'producing', 'video_review', 'approved', 'publishing', 'published');
$$;

-- Queues the stems of the chosen take and returns the job id. Asking again for the same take
-- returns the same job; a failed or cancelled job is queued again (the "Riprova" button).
create function public.request_stems(p_version uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); job_id uuid; job_key text;
begin
  if not public.stems_allowed_status(v.status) or v.chosen_take_id is null then
    raise exception 'chosen take required';
  end if;
  if not exists (select 1 from public.takes where id = v.chosen_take_id and audio_preview_path is not null) then
    raise exception 'chosen take audio required';
  end if;
  job_key := 'stems:' || v.id || ':' || v.chosen_take_id;
  insert into public.jobs(owner_id, version_id, stage, idempotency_key, payload)
  values (auth.uid(), v.id, 'stems', job_key, jsonb_build_object('take_id', v.chosen_take_id))
  on conflict (idempotency_key) do update
    set status = 'queued', attempts = 0, error = null, result = null, worker_id = null,
        heartbeat_at = null, started_at = null, finished_at = null, not_before = null
    where public.jobs.status in ('failed', 'cancelled')
  returning id into job_id;
  -- The conflict branch returns nothing when the job is queued, running or done.
  if job_id is null then
    select id into job_id from public.jobs where idempotency_key = job_key;
  end if;
  return job_id;
end; $$;

-- Where each of the caller's queued stems jobs waits on the render PC, like my_queue_positions.
create function public.my_stems_queue() returns table(version_id uuid, queue_position integer)
language sql stable security definer set search_path='' as $$
  with live as (
    select j.id, j.status, j.created_at from public.jobs j
    join public.versions v on v.id = j.version_id
    where v.trashed_at is null and (j.status = 'running'
      or (j.status = 'queued' and (j.not_before is null or j.not_before <= now())))
  ), mine as (
    select distinct on (j.version_id) j.version_id, j.id, j.created_at from public.jobs j
    join public.versions v on v.id = j.version_id
    where j.owner_id = auth.uid() and v.trashed_at is null and j.status = 'queued' and j.stage = 'stems'
      and (j.not_before is null or j.not_before <= now())
    order by j.version_id, j.created_at, j.id
  )
  select m.version_id,
    1 + (select count(*)::integer from live o
         where o.id <> m.id and (o.status = 'running' or (o.created_at, o.id) < (m.created_at, m.id)))
  from mine m;
$$;

-- The song's "In coda #N" badge is about the song's own pipeline; a stems request has its own
-- line. Stems jobs still count as work ahead of the other songs.
create or replace function public.my_queue_positions() returns table(version_id uuid, queue_position integer)
language sql stable security definer set search_path='' as $$
  with live as (
    select j.id, j.status, j.created_at from public.jobs j
    join public.versions v on v.id=j.version_id
    where v.trashed_at is null and (j.status='running'
      or (j.status='queued' and (j.not_before is null or j.not_before<=now())))
  ), mine as (
    select distinct on (j.version_id) j.version_id, j.id, j.created_at from public.jobs j
    join public.versions v on v.id=j.version_id
    where j.owner_id=auth.uid() and v.trashed_at is null and j.status='queued' and j.stage<>'stems'
      and (j.not_before is null or j.not_before<=now())
    order by j.version_id, j.created_at, j.id
  )
  select m.version_id,
    1 + (select count(*)::integer from live o
         where o.id<>m.id and (o.status='running' or (o.created_at,o.id)<(m.created_at,m.id)))
  from mine m;
$$;

-- Edited audio: the browser uploads the file to previews/edits/<owner>/<version>/<uuid>.mp3
-- (policies below), then save_edited_take records it as the song's new take.
create policy "owners upload edited audio"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'previews'
  and (storage.foldername(name))[1] = 'edits'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);
create policy "owners read edited audio"
on storage.objects for select to authenticated
using (
  bucket_id = 'previews'
  and (storage.foldername(name))[1] = 'edits'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);
-- Lets the editor remove an upload that could not be saved as a take.
create policy "owners delete unsaved edited audio"
on storage.objects for delete to authenticated
using (
  bucket_id = 'previews'
  and (storage.foldername(name))[1] = 'edits'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and not exists (select 1 from public.takes t where t.audio_preview_path = name)
);

-- Statuses in which an edit may become the chosen take: the song is not being produced or
-- published right now. The video of a song that has one keeps the audio it was rendered with.
create function public.save_edited_take(p_version uuid, p_path text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); chosen public.takes; take_id uuid;
begin
  if v.status not in ('audio_ready', 'video_review', 'approved', 'published') or v.chosen_take_id is null then
    raise exception 'chosen take required';
  end if;
  if p_path is null or p_path !~ ('^edits/' || auth.uid() || '/' || v.id || '/[0-9a-f-]{36}\.mp3$') then
    raise exception 'invalid edit path';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'previews' and o.name = p_path and o.metadata->>'mimetype' = 'audio/mpeg'
  ) then
    raise exception 'uploaded audio required';
  end if;
  if exists (select 1 from public.takes where audio_preview_path = p_path) then
    raise exception 'edit already saved';
  end if;
  select * into chosen from public.takes where id = v.chosen_take_id;
  insert into public.takes(owner_id, version_id, generation, take_number, engine, audio_preview_path, cover_path)
  values (auth.uid(), v.id, v.generation_count + 1, 1, 'edit', p_path, chosen.cover_path)
  returning id into take_id;
  update public.versions set generation_count = generation_count + 1, chosen_take_id = take_id where id = v.id;
  return take_id;
end; $$;

revoke all on function public.request_stems(uuid), public.my_stems_queue(), public.save_edited_take(uuid, text),
  public.stems_allowed_status(text) from public, anon;
grant execute on function public.request_stems(uuid), public.my_stems_queue(), public.save_edited_take(uuid, text)
  to authenticated;
