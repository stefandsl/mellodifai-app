-- Songs from songs (docs/egm/v2-local-engines/feature-parity-plan.md, T12).
--
-- 1. "Riscrivi una parte" (Suno's Replace Section): request_section_edit records a range of a take
--    and its new lyrics in section_edits and queues the on-demand stage replace_section; the worker
--    writes the alternatives into section_edits.alternatives; keep_section_edit turns the chosen
--    one into a new take of the same generation, next to the original (A/B), and makes it the
--    song's audio. choose_take switches back. The song status never changes.
-- 2. "Importa da Suno": import_song makes a song from an uploaded recording; the stage
--    import_audio turns the upload into the song's take (song_queued -> audio_ready).
-- 3. Covers, references and extensions: create_song accepts song_settings.source (an upload or a
--    take of the owner's) and records where the song came from in projects.source.

alter table public.jobs drop constraint jobs_stage_check;
alter table public.jobs add constraint jobs_stage_check check (stage in (
  'draft_lyrics', 'generate_song', 'timing', 'storyboard', 'render_master', 'render_hook', 'qa',
  'art', 'publish', 'set_privacy', 'import_legacy', 'stems', 'visualizer', 'replace_section',
  'import_audio'));

-- takes.kie_audio_id: Suno's id of the track, which kie's replace-section needs with the task id.
-- takes.source: how a take was made when it is not a plain generation
--   { "kind": "replace", "from_take_id", "edit_id", "start", "end" } or { "kind": "import" }.
-- takes.lyric_timing: the sung lines with their times (shared LyricTimingSchema), written by the
--   worker from the timing stage, the take scoring or a transcription.
-- takes.lyrics: the lyrics this take sings when they differ from the song's (a rewritten part);
--   choosing the take brings them back into the song.
alter table public.takes add column if not exists kie_audio_id text;
alter table public.takes add column if not exists source jsonb;
alter table public.takes add column if not exists lyric_timing jsonb;
alter table public.takes add column if not exists lyrics text;
alter table public.takes add constraint takes_source_object check (source is null or jsonb_typeof(source) = 'object');
alter table public.takes add constraint takes_lyric_timing_object check (lyric_timing is null or jsonb_typeof(lyric_timing) = 'object');
alter table public.takes add constraint takes_lyrics_length check (lyrics is null or length(lyrics) <= 5000);
-- 'import': a recording the owner brought in.
alter table public.takes drop constraint takes_engine_check;
alter table public.takes add constraint takes_engine_check check (engine in ('kie', 'ace-step', 'yue2', 'edit', 'import'));

-- Where the song's audio came from, and its licence (shared SongSourceSchema):
-- { "kind": "suno"|"upload"|"cover"|"reference"|"extend", "title", "author", "url",
--   "licence", "versionId", "upload" }.
alter table public.projects add column if not exists source jsonb;
alter table public.projects add constraint projects_source_object check (source is null or (
  jsonb_typeof(source) = 'object' and source->>'kind' in ('suno', 'upload', 'cover', 'reference', 'extend')
  and coalesce(source->>'licence', 'unknown') in ('own', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa',
    'cc-by-nd', 'cc-by-nc-nd', 'cc0', 'public-domain', 'licensed', 'unknown')));

-- One request to rewrite a part of a take. alternatives, written by the worker:
-- [{ "path": "previews/...", "duration": 281.0, "kie_task_id": "...", "kie_audio_id": "...",
--    "lyric_timing": {...} }, ...]
create table public.section_edits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  version_id uuid not null,
  take_id uuid not null,
  engine text not null check (engine in ('kie', 'ace-step')),
  start_s numeric(8, 2) not null check (start_s >= 0),
  end_s numeric(8, 2) not null,
  duration_s numeric(8, 2) not null check (duration_s > 0),
  section_lines integer[] not null default '{}',
  section_lyrics text not null check (length(section_lyrics) between 1 and 5000),
  full_lyrics text not null check (length(full_lyrics) <= 5000),
  old_lyrics text not null check (length(old_lyrics) <= 5000),
  alternatives jsonb not null default '[]'::jsonb check (jsonb_typeof(alternatives) = 'array'),
  kie_task_id text,
  kie_submit_state text check (kie_submit_state in ('submitting', 'submitted')),
  kept_take_id uuid,
  discarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  check (end_s > start_s),
  foreign key (version_id, owner_id) references public.versions(id, owner_id) on delete cascade,
  foreign key (take_id, owner_id) references public.takes(id, owner_id) on delete cascade,
  foreign key (kept_take_id, owner_id) references public.takes(id, owner_id) on delete set null (kept_take_id)
);
create index section_edits_version_idx on public.section_edits (version_id, created_at desc);
alter table public.section_edits enable row level security;
revoke all on public.section_edits from anon, authenticated;
grant select on public.section_edits to authenticated;
create policy "owners read section edits" on public.section_edits for select to authenticated
using (owner_id = (select auth.uid()) and exists (
  select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer')
));
create trigger section_edits_updated_at before update on public.section_edits
for each row execute function public.set_updated_at();

-- The uploads bucket also takes recordings (create panel, "Importa da Suno") under
-- <owner>/audio/<uuid>.<ext>; the owner-folder policies of migration 22 apply.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/wav', 'audio/flac']
where id = 'uploads';

-- An uploaded recording of the caller: the path shape and the stored object.
create function public.audio_upload_ok(p_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if p_path is null or p_path !~ ('^' || auth.uid() || '/audio/[0-9a-f-]{36}\.(mp3|wav|flac)$') then
    return false;
  end if;
  return exists (
    select 1 from storage.objects o
    where o.bucket_id = 'uploads' and o.name = p_path
      and o.metadata->>'mimetype' in ('audio/mpeg', 'audio/wav', 'audio/flac')
  );
end; $$;

-- Statuses in which a part may be rewritten (shared REWRITE_STATUSES).
create function public.rewrite_allowed_status(p_status text) returns boolean
language sql immutable set search_path='' as $$
  select p_status in ('takes_review', 'audio_ready', 'video_review', 'approved', 'published');
$$;

-- Queues the alternatives of one part of a take and returns the request id. The limits are
-- Suno's: 10 to 30 seconds, at most half of the take.
create function public.request_section_edit(
  p_version uuid, p_take uuid, p_engine text, p_start numeric, p_end numeric, p_duration numeric,
  p_lines integer[], p_section text, p_full text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); t public.takes; edit_id uuid;
begin
  if not public.rewrite_allowed_status(v.status) then raise exception 'song not ready for a rewrite'; end if;
  select * into t from public.takes
  where id = p_take and version_id = v.id and owner_id = auth.uid() and generation = v.generation_count;
  if not found or t.audio_preview_path is null then raise exception 'current take with audio required'; end if;
  if p_engine is null or p_engine not in ('kie', 'ace-step') then raise exception 'invalid engine'; end if;
  if p_engine <> 'kie' and not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'local engines are admin only';
  end if;
  if p_duration is null or p_duration <= 0 or p_duration > 3600 or p_start is null or p_end is null
    or p_start < 0 or p_end > p_duration + 0.01 then
    raise exception 'range outside the take';
  end if;
  if round(p_end - p_start, 2) < 10 or round(p_end - p_start, 2) > 30
    or round(p_end - p_start, 2) > round(p_duration * 0.5, 2) then
    raise exception 'a part is 10 to 30 seconds and at most half of the take';
  end if;
  if p_section is null or btrim(p_section) = '' or length(p_section) > 5000 then raise exception 'lyrics of the part required'; end if;
  if p_full is null or length(p_full) > 5000 then raise exception 'lyrics too long'; end if;
  if exists (
    select 1 from public.jobs j
    where j.version_id = v.id and j.stage = 'replace_section' and j.status in ('queued', 'running')
  ) then
    raise exception 'a rewrite of this song is already running';
  end if;
  insert into public.section_edits(owner_id, version_id, take_id, engine, start_s, end_s, duration_s,
    section_lines, section_lyrics, full_lyrics, old_lyrics)
  values (auth.uid(), v.id, t.id, p_engine, round(p_start, 2), round(p_end, 2), round(p_duration, 2),
    coalesce(p_lines, '{}'), p_section, p_full,
    coalesce(t.lyrics, v.lyric_pack->>'lyrics', ''))
  returning id into edit_id;
  insert into public.jobs(owner_id, version_id, stage, idempotency_key, payload)
  values (auth.uid(), v.id, 'replace_section', 'replace_section:' || edit_id,
    jsonb_build_object('edit_id', edit_id, 'take_id', t.id));
  return edit_id;
end; $$;

-- Keeps alternative N (0-based) of a finished request: a new take of the same generation, made
-- the song's audio unless the takes are still being reviewed. The original stays as it was.
create function public.keep_section_edit(p_edit uuid, p_alternative integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.section_edits; v public.versions; src public.takes; alt jsonb; new_take uuid; next_number integer;
begin
  select * into e from public.section_edits where id = p_edit and owner_id = auth.uid() for update;
  if not found then raise exception 'owned rewrite required'; end if;
  v := public.web_version(e.version_id);
  if e.kept_take_id is not null then raise exception 'rewrite already kept'; end if;
  if e.discarded_at is not null then raise exception 'rewrite discarded'; end if;
  if not public.rewrite_allowed_status(v.status) then raise exception 'song not ready for a rewrite'; end if;
  alt := e.alternatives -> p_alternative;
  if p_alternative is null or p_alternative < 0 or alt is null or coalesce(alt->>'path', '') = '' then
    raise exception 'alternative not found';
  end if;
  select * into src from public.takes where id = e.take_id and generation = v.generation_count;
  if not found then raise exception 'the song has new takes since this rewrite'; end if;
  select coalesce(max(take_number), 0) + 1 into next_number from public.takes
  where version_id = v.id and generation = v.generation_count;
  insert into public.takes(owner_id, version_id, generation, take_number, engine, audio_preview_path,
    cover_path, kie_task_id, kie_audio_id, lyrics, lyric_timing, source)
  values (auth.uid(), v.id, v.generation_count, next_number, e.engine, alt->>'path', src.cover_path,
    nullif(alt->>'kie_task_id', ''), nullif(alt->>'kie_audio_id', ''), e.full_lyrics,
    case when jsonb_typeof(alt->'lyric_timing') = 'object' then alt->'lyric_timing' end,
    jsonb_build_object('kind', 'replace', 'from_take_id', src.id, 'edit_id', e.id,
      'start', e.start_s, 'end', e.end_s, 'alternative', p_alternative))
  returning id into new_take;
  -- The original keeps the lyrics it sings, so choosing it again brings them back.
  update public.takes set lyrics = e.old_lyrics where id = src.id and lyrics is null;
  update public.section_edits set kept_take_id = new_take where id = e.id;
  if v.status <> 'takes_review' then
    update public.versions
    set chosen_take_id = new_take,
        lyric_pack = case when lyric_pack is null then null
          else jsonb_set(lyric_pack, '{lyrics}', to_jsonb(e.full_lyrics)) end
    where id = v.id;
  end if;
  return new_take;
end; $$;

-- Puts a finished request away without keeping anything.
create function public.discard_section_edit(p_edit uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e public.section_edits;
begin
  select * into e from public.section_edits where id = p_edit and owner_id = auth.uid() for update;
  if not found then raise exception 'owned rewrite required'; end if;
  perform public.web_version(e.version_id);
  if e.kept_take_id is not null then raise exception 'rewrite already kept'; end if;
  update public.section_edits set discarded_at = coalesce(discarded_at, now()) where id = e.id;
end; $$;

-- Makes another take of the current generation the song's audio again (A/B after a rewrite).
-- Same statuses as save_edited_take: nothing is being produced or published.
create function public.choose_take(p_version uuid, p_take uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); t public.takes;
begin
  if v.status not in ('audio_ready', 'video_review', 'approved', 'published') then
    raise exception 'chosen take required';
  end if;
  select * into t from public.takes
  where id = p_take and version_id = v.id and owner_id = auth.uid() and generation = v.generation_count;
  if not found or t.audio_preview_path is null then raise exception 'current take with audio required'; end if;
  update public.versions
  set chosen_take_id = t.id,
      lyric_pack = case when t.lyrics is null or lyric_pack is null then lyric_pack
        else jsonb_set(lyric_pack, '{lyrics}', to_jsonb(t.lyrics)) end
  where id = v.id;
end; $$;

-- Picking a take in the review also brings its own lyrics (a rewritten part) into the song.
create or replace function public.pick_take(p_version uuid,p_take uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); t public.takes;
begin
  if v.status<>'takes_review' then raise exception 'takes review required'; end if;
  select * into t from public.takes where id=p_take and version_id=v.id and owner_id=auth.uid() and generation=v.generation_count;
  if not found then raise exception 'current take required'; end if;
  update public.versions set chosen_take_id=p_take,status='producing',
    lyric_pack = case when t.lyrics is null or lyric_pack is null then lyric_pack else jsonb_set(lyric_pack,'{lyrics}',to_jsonb(t.lyrics)) end
  where id=v.id;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(auth.uid(),v.id,'timing','timing:'||v.id||':'||v.render_attempt);
end; $$;
create or replace function public.keep_audio(p_version uuid, p_take uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); t public.takes;
begin
  if v.status<>'takes_review' then raise exception 'takes review required'; end if;
  select * into t from public.takes where id=p_take and version_id=v.id and owner_id=auth.uid() and generation=v.generation_count;
  if not found then raise exception 'current take required'; end if;
  update public.versions set chosen_take_id=p_take,status='audio_ready',
    lyric_pack = case when t.lyrics is null or lyric_pack is null then lyric_pack else jsonb_set(lyric_pack,'{lyrics}',to_jsonb(t.lyrics)) end
  where id=v.id;
end; $$;

-- Where each of the caller's queued rewrites waits on the render PC, like my_stems_queue.
create function public.my_section_queue() returns table(edit_id uuid, queue_position integer)
language sql stable security definer set search_path='' as $$
  with live as (
    select j.id, j.status, j.created_at from public.jobs j
    join public.versions v on v.id = j.version_id
    where v.trashed_at is null and (j.status = 'running'
      or (j.status = 'queued' and (j.not_before is null or j.not_before <= now())))
  ), mine as (
    select (j.payload->>'edit_id')::uuid as edit_id, j.id, j.created_at from public.jobs j
    join public.versions v on v.id = j.version_id
    where j.owner_id = auth.uid() and v.trashed_at is null and j.status = 'queued' and j.stage = 'replace_section'
      and (j.not_before is null or j.not_before <= now())
  )
  select m.edit_id,
    1 + (select count(*)::integer from live o
         where o.id <> m.id and (o.status = 'running' or (o.created_at, o.id) < (m.created_at, m.id)))
  from mine m;
$$;

-- The song's own "In coda #N" badge leaves out the on-demand stages, which have their own lines.
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
    where j.owner_id=auth.uid() and v.trashed_at is null and j.status='queued'
      and j.stage not in ('stems', 'visualizer', 'replace_section')
      and (j.not_before is null or j.not_before<=now())
    order by j.version_id, j.created_at, j.id
  )
  select m.version_id,
    1 + (select count(*)::integer from live o
         where o.id<>m.id and (o.status='running' or (o.created_at,o.id)<(m.created_at,m.id)))
  from mine m;
$$;

-- The source record of a song as the studio sends it: only the fields and values the shared
-- SongSourceSchema knows; versionId and upload are checked against the caller's own data.
create function public.clean_song_source(p_source jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare out jsonb := '{}'::jsonb; field text;
begin
  if p_source is null then return null; end if;
  if jsonb_typeof(p_source) <> 'object' or p_source->>'kind' not in ('suno', 'upload', 'cover', 'reference', 'extend') then
    raise exception 'invalid source';
  end if;
  if coalesce(p_source->>'licence', 'unknown') not in ('own', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa',
    'cc-by-nd', 'cc-by-nc-nd', 'cc0', 'public-domain', 'licensed', 'unknown') then
    raise exception 'invalid licence';
  end if;
  out := jsonb_build_object('kind', p_source->>'kind', 'licence', coalesce(p_source->>'licence', 'unknown'));
  foreach field in array array['title', 'author'] loop
    if nullif(btrim(coalesce(p_source->>field, '')), '') is not null then
      if length(p_source->>field) > 200 then raise exception 'source % too long', field; end if;
      out := out || jsonb_build_object(field, btrim(p_source->>field));
    end if;
  end loop;
  if nullif(btrim(coalesce(p_source->>'url', '')), '') is not null then
    if length(p_source->>'url') > 500 or btrim(p_source->>'url') !~ '^https?://[^\s]+$' then raise exception 'invalid source url'; end if;
    out := out || jsonb_build_object('url', btrim(p_source->>'url'));
  end if;
  if p_source ? 'versionId' and p_source->>'versionId' is not null then
    if not exists (select 1 from public.versions where id::text = p_source->>'versionId' and owner_id = auth.uid()) then
      raise exception 'source song not found';
    end if;
    out := out || jsonb_build_object('versionId', p_source->>'versionId');
  end if;
  if p_source ? 'upload' and p_source->>'upload' is not null then
    if not public.audio_upload_ok(p_source->>'upload') then raise exception 'uploaded audio required'; end if;
    out := out || jsonb_build_object('upload', p_source->>'upload');
  end if;
  return out;
end; $$;

-- "Importa da Suno": a song from a recording in the caller's uploads folder. The song waits in
-- song_queued until import_audio has made its take.
create function public.import_song(
  p_title text, p_style text, p_lyrics text, p_lang text, p_upload text, p_source jsonb
) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid; vid uuid; src jsonb; title text := btrim(coalesce(p_title, '')); style text := btrim(coalesce(p_style, ''));
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'customer')) then
    raise exception 'profile required';
  end if;
  if length(title) not between 1 and 100 then raise exception 'title required'; end if;
  if length(style) > 1000 or length(coalesce(p_lyrics, '')) > 5000 then raise exception 'too long'; end if;
  if p_lang is null or p_lang not in ('it', 'ru', 'ro', 'ja', 'en', 'es', 'de', 'zh', 'pt', 'ko', 'fr') then
    raise exception 'invalid language';
  end if;
  if not public.audio_upload_ok(p_upload) then raise exception 'uploaded audio required'; end if;
  src := public.clean_song_source(coalesce(p_source, '{}'::jsonb) || jsonb_build_object('upload', p_upload));
  if src->>'kind' not in ('suno', 'upload') then raise exception 'invalid source'; end if;
  if style = '' then
    style := case when src->>'kind' = 'suno' then 'Importata da Suno' else 'Audio caricato' end;
  end if;
  insert into public.projects(owner_id, topic, brief, style, theme, song_settings, source)
  values (auth.uid(), title, nullif(btrim(coalesce(p_lyrics, '')), ''), style, 'vbp',
    jsonb_build_object('engine', 'kie', 'title', left(title, 80), 'video', 'off'), src)
  returning id into pid;
  insert into public.versions(owner_id, project_id, lang, status, lyric_pack)
  values (auth.uid(), pid, p_lang, 'song_queued', jsonb_build_object(
    'title', title, 'lyrics', coalesce(p_lyrics, ''), 'style', style, 'exclude', '',
    'settings', jsonb_build_object('model', 'V6', 'styleWeight', 0.7, 'weirdness', 0.35, 'variety', 1, 'duration', null),
    'displayMap', '{}'::jsonb, 'l10n', '{}'::jsonb))
  returning id into vid;
  insert into public.jobs(owner_id, version_id, stage, idempotency_key, payload)
  values (auth.uid(), vid, 'import_audio', 'import_audio:' || vid, jsonb_build_object('upload', p_upload));
  return pid;
end; $$;

-- Changes the title, author, link and licence of a song's source ("Fonti"); the kind, the
-- library song and the upload stay as recorded.
create function public.set_song_source(p_version uuid, p_source jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); old jsonb; next jsonb;
begin
  select source into old from public.projects where id = v.project_id;
  if p_source is null or jsonb_typeof(p_source) <> 'object' then raise exception 'invalid source'; end if;
  next := public.clean_song_source(
    (p_source - 'kind' - 'versionId' - 'upload')
    || jsonb_build_object('kind', coalesce(old->>'kind', 'upload'))
    || case when old ? 'versionId' then jsonb_build_object('versionId', old->'versionId') else '{}'::jsonb end
    || case when old ? 'upload' then jsonb_build_object('upload', old->'upload') else '{}'::jsonb end);
  update public.projects set source = next where id = v.project_id;
end; $$;

-- create_song (migration 16) plus the audio a song may start from: an upload of the caller's or a
-- take of one of the caller's songs, in a mode the engine supports (shared sourceModesFor).
create or replace function public.create_song(
  p_prompt text,
  p_lyrics text,
  p_languages text[],
  p_style text,
  p_vocal_gender text,
  p_settings jsonb
) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid; vid uuid; lang_code text; topic text; engine text; src jsonb; mode text; song_source jsonb;
  from_version uuid;
begin
  if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'profile required'; end if;
  topic := btrim(coalesce(nullif(btrim(p_prompt),''), nullif(btrim(p_settings->>'title'),''), ''));
  if length(topic) not between 1 and 500 then raise exception 'prompt or title required'; end if;
  if length(coalesce(p_lyrics,'')) > 5000 or length(coalesce(p_style,'')) > 1000 then raise exception 'too long'; end if;
  if p_vocal_gender is not null and p_vocal_gender not in ('m','f') then raise exception 'invalid vocal gender'; end if;
  if coalesce(cardinality(p_languages),0)=0 then raise exception 'language required'; end if;
  if exists(select 1 from unnest(p_languages) l where l is null or l not in ('it','ru','ro','ja','en','es','de','zh','pt','ko','fr')) then raise exception 'invalid language'; end if;
  if p_settings is null or jsonb_typeof(p_settings)<>'object' then raise exception 'invalid settings'; end if;
  engine := coalesce(p_settings->>'engine', 'kie');
  if engine not in ('kie','ace-step','yue2') then raise exception 'invalid engine'; end if;
  if engine<>'kie' and not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then
    raise exception 'local engines are admin only';
  end if;
  src := p_settings->'source';
  if src is not null and jsonb_typeof(src) <> 'null' then
    if jsonb_typeof(src) <> 'object' then raise exception 'invalid source'; end if;
    mode := src->>'mode';
    if mode is null or mode not in ('cover', 'reference', 'extend') then raise exception 'invalid source mode'; end if;
    if not (engine = 'kie' or (engine = 'ace-step' and mode = 'cover')) then
      raise exception 'this engine cannot start from audio in this way';
    end if;
    if (src ? 'upload') = (src ? 'takeId') then raise exception 'an upload or a take, not both'; end if;
    if src ? 'upload' then
      if not public.audio_upload_ok(src->>'upload') then raise exception 'uploaded audio required'; end if;
    else
      select t.version_id into from_version from public.takes t
      where t.id::text = src->>'takeId' and t.owner_id = auth.uid() and t.audio_preview_path is not null;
      if not found then raise exception 'source take required'; end if;
    end if;
    song_source := jsonb_strip_nulls(jsonb_build_object('kind', mode, 'licence', 'own',
      'title', nullif(left(btrim(coalesce(src->>'title', '')), 200), ''),
      'versionId', from_version::text, 'upload', src->>'upload'));
  end if;
  insert into public.projects(owner_id,topic,brief,style,vocal_gender,theme,song_settings,source)
    values(auth.uid(),topic,nullif(btrim(coalesce(p_lyrics,'')),''),nullif(btrim(coalesce(p_style,'')),''),p_vocal_gender,'vbp',p_settings,song_source)
    returning id into pid;
  for lang_code in select distinct unnest(p_languages) loop
    insert into public.versions(owner_id,project_id,lang) values(auth.uid(),pid,lang_code) returning id into vid;
    insert into public.jobs(owner_id,version_id,stage,idempotency_key)
      values(auth.uid(),vid,'draft_lyrics','draft_lyrics:'||vid||':1');
  end loop;
  return pid;
end; $$;

revoke all on function public.audio_upload_ok(text), public.rewrite_allowed_status(text),
  public.clean_song_source(jsonb) from public, anon, authenticated;
revoke all on function public.request_section_edit(uuid, uuid, text, numeric, numeric, numeric, integer[], text, text),
  public.keep_section_edit(uuid, integer), public.discard_section_edit(uuid), public.choose_take(uuid, uuid),
  public.my_section_queue(), public.import_song(text, text, text, text, text, jsonb),
  public.set_song_source(uuid, jsonb) from public, anon;
grant execute on function public.request_section_edit(uuid, uuid, text, numeric, numeric, numeric, integer[], text, text),
  public.keep_section_edit(uuid, integer), public.discard_section_edit(uuid), public.choose_take(uuid, uuid),
  public.my_section_queue(), public.import_song(text, text, text, text, text, jsonb),
  public.set_song_source(uuid, jsonb) to authenticated;
