-- "Rifai da YouTube" in the studio and the AI lyric buttons (task 27; master design 8.3 to 8.5,
-- stages R1 to R3).
--
-- 1. A remake is a project with one version (status 'analysing') and a remakes row. Its jobs
--    remake_ingest (R1), remake_analyse (R2) and remake_rewrite (R3) run on that version, so
--    jobs.version_id stays NOT NULL for them (design 8.3). The worker owns remakes.lyrics; the
--    person's edits wait in remakes.pending until a remake_rewrite check job ran the gates on
--    them. remake_accept turns the reviewed lyrics into the song's lyric pack and queues
--    generate_song, the normal song generation. Every review action carries the revision the
--    person saw (design 8.5 expected_stage_version): a mismatch is a conflict, never a lost edit.
-- 2. The lyrics editor's "Scrivi con AI", "Rigenera" and "Migliora" are lyrics_assist jobs that
--    belong to no song: jobs.version_id is null for them and only for them; the request and its
--    result live in lyric_requests.

-- Statuses and stages ---------------------------------------------------------------------------
alter table public.versions drop constraint versions_status_check;
alter table public.versions add constraint versions_status_check check (status in (
  'analysing', 'drafting', 'lyrics_review', 'song_queued', 'takes_review', 'audio_ready',
  'producing', 'video_review', 'approved', 'publishing', 'published', 'failed'));

alter table public.jobs drop constraint jobs_stage_check;
alter table public.jobs add constraint jobs_stage_check check (stage in (
  'draft_lyrics', 'generate_song', 'timing', 'storyboard', 'render_master', 'render_hook', 'qa',
  'art', 'publish', 'set_privacy', 'import_legacy', 'stems', 'visualizer', 'replace_section',
  'import_audio', 'remake_ingest', 'remake_analyse', 'remake_rewrite', 'lyrics_assist'));

alter table public.jobs alter column version_id drop not null;
alter table public.jobs add constraint jobs_songless_stage check ((version_id is null) = (stage = 'lyrics_assist'));

-- Where a song came from: a remake records its YouTube source (shared SongSourceSchema kinds plus
-- 'remake'); the licence is what YouTube reports.
alter table public.projects drop constraint projects_source_object;
alter table public.projects add constraint projects_source_object check (source is null or (
  jsonb_typeof(source) = 'object' and source->>'kind' in ('suno', 'upload', 'cover', 'reference', 'extend', 'remake')
  and coalesce(source->>'licence', 'unknown') in ('own', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa',
    'cc-by-nd', 'cc-by-nc-nd', 'cc0', 'public-domain', 'licensed', 'unknown')));

-- Remakes ---------------------------------------------------------------------------------------
-- analysis: shared RemakeSummarySchema (no lyrics, no media paths); lyrics: RemakeLyricsSchema;
-- pending: { "lines": [{ "index", "text" }], "title" } edits not checked yet;
-- cost: { "analysisUsd", "rewriteUsd", "sectionsUsd" } (shared RemakeCostSplitSchema).
create table public.remakes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  project_id uuid not null,
  version_id uuid not null unique,
  url text not null check (length(url) between 11 and 500),
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  lang text not null check (lang in ('it', 'ru', 'ro', 'ja', 'en', 'es', 'de', 'zh', 'pt', 'ko', 'fr')),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  stage text not null default 'ingest'
    check (stage in ('ingest', 'analyse', 'rewrite', 'review', 'accepted', 'failed', 'cancelled')),
  error_code text check (error_code is null or error_code in ('invalid_url', 'private', 'age_restricted',
    'too_long', 'unavailable', 'no_lyrics', 'privacy_filter', 'cost_cap', 'failed')),
  error text check (error is null or length(error) <= 2000),
  source jsonb check (source is null or jsonb_typeof(source) = 'object'),
  analysis jsonb check (analysis is null or jsonb_typeof(analysis) = 'object'),
  lyrics jsonb check (lyrics is null or jsonb_typeof(lyrics) = 'object'),
  pending jsonb check (pending is null or jsonb_typeof(pending) = 'object'),
  revision integer not null default 0 check (revision >= 0),
  cost jsonb not null default '{}'::jsonb check (jsonb_typeof(cost) = 'object'),
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (project_id, owner_id) references public.projects(id, owner_id) on delete cascade,
  foreign key (version_id, owner_id) references public.versions(id, owner_id) on delete cascade
);
create index remakes_owner_created_idx on public.remakes (owner_id, created_at desc);
alter table public.remakes enable row level security;
revoke all on public.remakes from anon, authenticated;
grant select on public.remakes to authenticated;
create policy "owners read remakes" on public.remakes for select to authenticated
using (owner_id = (select auth.uid()) and exists (
  select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer')
));
create trigger remakes_updated_at before update on public.remakes
for each row execute function public.set_updated_at();

-- The lyrics a remake's song is generated from, exactly as shared remakeLyricsText composes it:
-- "[Label]" then the section's lines, sections separated by a blank line.
create function public.remake_lyrics_text(p_lyrics jsonb) returns text
language sql immutable set search_path='' as $$
  select coalesce(string_agg(block, E'\n\n' order by s_ord), '')
  from (
    select s_ord, concat_ws(E'\n', '[' || (s->>'label') || ']',
      (select string_agg(btrim(l->>'text'), E'\n' order by l_ord)
       from jsonb_array_elements(coalesce(s->'lines', '[]'::jsonb)) with ordinality as lines(l, l_ord))) as block
    from jsonb_array_elements(coalesce(p_lyrics->'sections', '[]'::jsonb)) with ordinality as sections(s, s_ord)
  ) blocks;
$$;

-- The originality gate (design 10.3) on stored lyrics: no flagged or empty line, no reused phrase.
create function public.remake_gate_ok(p_lyrics jsonb) returns boolean
language sql immutable set search_path='' as $$
  select p_lyrics is not null
    and coalesce((p_lyrics->'originality'->'phrase'->>'ok')::boolean, false)
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_lyrics->'sections', '[]'::jsonb)) s,
        jsonb_array_elements(coalesce(s->'lines', '[]'::jsonb)) l
      where coalesce((l->'originality'->>'flagged')::boolean, true) or btrim(coalesce(l->>'text', '')) = ''
    );
$$;

-- The caller's remake with an active job's state, for the create panel's poll. Trashed songs
-- and dismissed remakes are left out.
create function public.owned_remake(p_remake uuid) returns public.remakes
language plpgsql security definer set search_path='' as $$
declare r public.remakes;
begin
  select rm.* into r from public.remakes rm
  join public.versions v on v.id = rm.version_id
  where rm.id = p_remake and rm.owner_id = auth.uid() and v.trashed_at is null
  for update of rm;
  if not found then raise exception 'owned remake required'; end if;
  return r;
end; $$;

create function public.remake_active_job(p_version uuid) returns public.jobs
language sql stable security definer set search_path='' as $$
  select j.* from public.jobs j
  where j.version_id = p_version and j.status in ('queued', 'running')
  order by j.created_at desc, j.id desc limit 1;
$$;

-- Starts R1 for a YouTube link: a project, one version in the target language, the remake row and
-- the remake_ingest job. One remake runs at a time per person, 20 a day.
create function public.remake_start(p_url text, p_video_id text, p_lang text, p_country text default null)
returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid; vid uuid; rid uuid; url text := btrim(coalesce(p_url, ''));
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'customer')) then
    raise exception 'profile required';
  end if;
  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' or position(p_video_id in url) = 0
    or url !~* '^(https?://)?([a-z0-9-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)/' then
    raise exception 'invalid youtube link';
  end if;
  if p_lang is null or p_lang not in ('it', 'ru', 'ro', 'ja', 'en', 'es', 'de', 'zh', 'pt', 'ko', 'fr') then
    raise exception 'invalid language';
  end if;
  if p_country is not null and p_country !~ '^[A-Z]{2}$' then raise exception 'invalid country'; end if;
  if exists (
    select 1 from public.remakes rm join public.versions v on v.id = rm.version_id
    where rm.owner_id = auth.uid() and rm.stage in ('ingest', 'analyse', 'rewrite') and v.trashed_at is null
  ) then
    raise exception 'a remake is already running';
  end if;
  if (select count(*) from public.remakes where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'daily remake limit reached';
  end if;
  insert into public.projects(owner_id, topic, theme, song_settings, source)
  values (auth.uid(), 'YouTube ' || p_video_id, 'general', '{}'::jsonb,
    jsonb_build_object('kind', 'remake', 'url', 'https://www.youtube.com/watch?v=' || p_video_id, 'licence', 'unknown'))
  returning id into pid;
  insert into public.versions(owner_id, project_id, lang, status)
  values (auth.uid(), pid, p_lang, 'analysing') returning id into vid;
  insert into public.remakes(owner_id, project_id, version_id, url, video_id, lang, country)
  values (auth.uid(), pid, vid, left(url, 500), p_video_id, p_lang, p_country) returning id into rid;
  insert into public.jobs(owner_id, version_id, stage, idempotency_key, payload)
  values (auth.uid(), vid, 'remake_ingest', 'remake_ingest:' || rid, '{}'::jsonb);
  return rid;
end; $$;

-- The person changed lines or the title: they wait in pending until the check job ran the gates.
-- p_lines: [{ "index": n, "text": "..." }]; returns the new revision.
create function public.remake_edit(p_remake uuid, p_revision integer, p_lines jsonb, p_title text default null)
returns integer
language plpgsql security definer set search_path='' as $$
declare r public.remakes := public.owned_remake(p_remake); edit jsonb; merged jsonb; next_revision integer;
begin
  if r.stage <> 'review' or r.lyrics is null then raise exception 'remake review required'; end if;
  if p_revision is distinct from r.revision then raise exception 'conflict: the lyrics changed meanwhile'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception 'invalid edits';
  end if;
  if p_title is not null and length(btrim(p_title)) not between 1 and 100 then raise exception 'invalid title'; end if;
  if jsonb_array_length(p_lines) = 0 and p_title is null then raise exception 'nothing to save'; end if;
  merged := coalesce(r.pending->'lines', '[]'::jsonb);
  for edit in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(edit->'index') <> 'number' or jsonb_typeof(edit->'text') <> 'string'
      or length(btrim(edit->>'text')) not between 1 and 200 or (edit->>'text') ~ '[\r\n]'
      or position(chr(8212) in edit->>'text') > 0 then
      raise exception 'invalid edits';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(r.lyrics->'sections') s, jsonb_array_elements(s->'lines') l
      where (l->>'index')::integer = (edit->>'index')::integer
    ) then
      raise exception 'unknown line';
    end if;
    merged := coalesce((select jsonb_agg(e) from jsonb_array_elements(merged) e
      where (e->>'index')::integer <> (edit->>'index')::integer), '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('index', (edit->>'index')::integer, 'text', btrim(edit->>'text')));
  end loop;
  next_revision := r.revision + 1;
  update public.remakes
  set pending = jsonb_strip_nulls(jsonb_build_object('lines', merged,
        'title', coalesce(nullif(btrim(p_title), ''), r.pending->>'title'))),
      revision = next_revision, error_code = null, error = null
  where id = r.id;
  insert into public.jobs(owner_id, version_id, stage, idempotency_key, payload)
  values (auth.uid(), r.version_id, 'remake_rewrite', 'remake_check:' || r.id || ':' || next_revision,
    jsonb_build_object('mode', 'check', 'revision', next_revision));
  return next_revision;
end; $$;

-- "Rigenera sezione": one section written again (R3 for that section), then one jury round.
create function public.remake_regenerate_section(p_remake uuid, p_revision integer, p_section text)
returns void
language plpgsql security definer set search_path='' as $$
declare r public.remakes := public.owned_remake(p_remake);
begin
  if r.stage <> 'review' or r.lyrics is null then raise exception 'remake review required'; end if;
  if p_revision is distinct from r.revision then raise exception 'conflict: the lyrics changed meanwhile'; end if;
  if (public.remake_active_job(r.version_id)).id is not null or r.pending is not null then
    raise exception 'wait for the running step';
  end if;
  if p_section is null or not exists (
    select 1 from jsonb_array_elements(r.lyrics->'sections') s
    where s->>'id' = p_section and jsonb_array_length(coalesce(s->'lines', '[]'::jsonb)) > 0
  ) then
    raise exception 'unknown section';
  end if;
  update public.remakes set error_code = null, error = null where id = r.id;
  insert into public.jobs(owner_id, version_id, stage, idempotency_key, payload)
  values (auth.uid(), r.version_id, 'remake_rewrite',
    'remake_section:' || r.id || ':' || p_section || ':' || r.revision,
    jsonb_build_object('mode', 'section', 'section', p_section, 'revision', r.revision));
end; $$;

-- Accepts the reviewed lyrics: they become the song's lyric pack (the server composes it with
-- shared remakeLyricsText; the text must be exactly the gated lyrics) and the normal song
-- generation starts. The originality gate can never be skipped (design 8.5).
create function public.remake_accept(p_remake uuid, p_revision integer, p_pack jsonb, p_settings jsonb,
  p_vocal_gender text default null)
returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.remakes := public.owned_remake(p_remake); v public.versions; engine text;
begin
  if r.stage <> 'review' or r.lyrics is null then raise exception 'remake review required'; end if;
  if p_revision is distinct from r.revision then raise exception 'conflict: the lyrics changed meanwhile'; end if;
  if (public.remake_active_job(r.version_id)).id is not null or r.pending is not null then
    raise exception 'wait for the running step';
  end if;
  if not public.remake_gate_ok(r.lyrics) then raise exception 'originality gate not passed'; end if;
  if p_pack is null or jsonb_typeof(p_pack) <> 'object'
    or jsonb_typeof(p_pack->'title') is distinct from 'string' or length(btrim(p_pack->>'title')) not between 1 and 100
    or jsonb_typeof(p_pack->'style') is distinct from 'string' or length(btrim(p_pack->>'style')) not between 1 and 1000
    or jsonb_typeof(p_pack->'settings') is distinct from 'object' then
    raise exception 'invalid lyric pack';
  end if;
  if p_pack->>'lyrics' is distinct from public.remake_lyrics_text(r.lyrics) then
    raise exception 'lyrics differ from the reviewed ones';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or p_settings ? 'source' then
    raise exception 'invalid settings';
  end if;
  if p_vocal_gender is not null and p_vocal_gender not in ('m', 'f') then raise exception 'invalid vocal gender'; end if;
  engine := coalesce(p_settings->>'engine', 'kie');
  if engine not in ('kie', 'ace-step', 'yue2') then raise exception 'invalid engine'; end if;
  if engine <> 'kie' and not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'local engines are admin only';
  end if;
  v := public.web_version(r.version_id);
  if v.status <> 'analysing' then raise exception 'remake review required'; end if;
  update public.projects
  set topic = btrim(p_pack->>'title'), style = btrim(p_pack->>'style'), song_settings = p_settings,
      vocal_gender = p_vocal_gender,
      source = coalesce(source, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('kind', 'remake',
        'title', nullif(left(btrim(coalesce(r.source->>'title', '')), 200), '')))
  where id = r.project_id;
  update public.versions set lyric_pack = p_pack, status = 'song_queued' where id = v.id;
  insert into public.jobs(owner_id, version_id, stage, idempotency_key)
  values (auth.uid(), v.id, 'generate_song', 'generate_song:' || v.id || ':' || v.generation_count);
  update public.remakes set stage = 'accepted', error_code = null, error = null where id = r.id;
  return v.id;
end; $$;

-- Stops a remake: its queued and running jobs are cancelled (a running one stops at its next
-- heartbeat) and the unfinished song leaves the library.
create function public.remake_cancel(p_remake uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.remakes := public.owned_remake(p_remake);
begin
  if r.stage in ('accepted', 'cancelled') then raise exception 'remake already finished'; end if;
  update public.jobs set status = 'cancelled', finished_at = now(), heartbeat_at = null
  where version_id = r.version_id and status in ('queued', 'running');
  update public.remakes set stage = 'cancelled', dismissed_at = now(), pending = null where id = r.id;
  update public.versions set trashed_at = now() where id = r.version_id and trashed_at is null;
end; $$;

-- Hides a finished remake from the create panel; a failed one also leaves the library.
create function public.remake_dismiss(p_remake uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.remakes := public.owned_remake(p_remake);
begin
  if r.stage not in ('failed', 'accepted', 'cancelled') then raise exception 'remake still running'; end if;
  update public.remakes set dismissed_at = coalesce(dismissed_at, now()) where id = r.id;
  if r.stage = 'failed' then
    update public.versions set trashed_at = now() where id = r.version_id and trashed_at is null;
  end if;
end; $$;

-- Retries a failed stage. A failed R1 to R3 job set the version to failed; retry_stage brings it
-- back to analysing and queues the same stage again (the engine reuses what it already has).
create or replace function public.retry_stage(p_version uuid,p_job uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); j public.jobs; target text;
begin
  if v.status<>'failed' then raise exception 'failed version required'; end if;
  select * into j from public.jobs where id=p_job and version_id=v.id and status='failed' and owner_id=auth.uid();
  if not found then raise exception 'failed job required'; end if;
  if exists(select 1 from public.jobs where version_id=v.id and status in ('running','queued')) then raise exception 'job already active'; end if;
  target=case j.stage when 'draft_lyrics' then 'drafting' when 'generate_song' then 'song_queued'
    when 'import_audio' then 'song_queued' when 'publish' then 'approved' when 'set_privacy' then 'approved'
    when 'remake_ingest' then 'analysing' when 'remake_analyse' then 'analysing' when 'remake_rewrite' then 'analysing'
    else 'producing' end;
  update public.versions set status=target where id=v.id;
  if j.stage in ('remake_ingest', 'remake_analyse', 'remake_rewrite') then
    update public.remakes
    set stage = case j.stage when 'remake_ingest' then 'ingest' when 'remake_analyse' then 'analyse' else 'rewrite' end,
        error_code = null, error = null, dismissed_at = null
    where version_id = v.id and owner_id = auth.uid();
  end if;
  -- Same generation: the worker resumes an accepted kie task, never spends again.
  if j.stage='publish' then
    perform public.enqueue_publish((j.payload->>'render_id')::uuid,j.payload->'metadata');
  else
    insert into public.jobs(owner_id,version_id,stage,idempotency_key,payload) values(auth.uid(),v.id,j.stage,j.idempotency_key||':retry:'||j.id,j.payload);
  end if;
end; $$;

create function public.remake_retry(p_remake uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.remakes := public.owned_remake(p_remake); j public.jobs;
begin
  if r.stage <> 'failed' then raise exception 'failed remake required'; end if;
  select * into j from public.jobs
  where version_id = r.version_id and status = 'failed' and stage in ('remake_ingest', 'remake_analyse', 'remake_rewrite')
  order by created_at desc, id desc limit 1;
  if not found then raise exception 'failed job required'; end if;
  perform public.retry_stage(r.version_id, j.id);
end; $$;

-- Where a queued job of the caller waits (1 = next), counting every live job of the PC.
create function public.my_job_queue_position(p_job uuid) returns integer
language sql stable security definer set search_path='' as $$
  select case when m.status = 'running' then 0 else 1 + (
    select count(*)::integer from public.jobs o
    left join public.versions v on v.id = o.version_id
    where o.id <> m.id and (v.id is null or v.trashed_at is null)
      and (o.status = 'running' or (o.status = 'queued' and (o.not_before is null or o.not_before <= now())
        and (o.created_at, o.id) < (m.created_at, m.id))))
  end
  from public.jobs m where m.id = p_job and m.owner_id = auth.uid() and m.status in ('queued', 'running');
$$;

-- The create panel's one poll: the caller's latest remake that is neither dismissed nor trashed,
-- with its active job (stage, progress, last message, queue position) and its last failed job.
create function public.my_remake() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.remakes; j public.jobs; failed public.jobs; ev public.job_events;
begin
  select rm.* into r from public.remakes rm join public.versions v on v.id = rm.version_id
  where rm.owner_id = auth.uid() and rm.dismissed_at is null and v.trashed_at is null
  order by rm.created_at desc limit 1;
  if not found then return null; end if;
  j := public.remake_active_job(r.version_id);
  if j.id is not null then
    select * into ev from public.job_events where job_id = j.id order by at desc, id desc limit 1;
  end if;
  select * into failed from public.jobs
  where version_id = r.version_id and status = 'failed' order by finished_at desc nulls last, id desc limit 1;
  return jsonb_build_object(
    'remake', to_jsonb(r),
    'job', case when j.id is null then null else jsonb_build_object(
      'id', j.id, 'stage', j.stage, 'status', j.status, 'mode', j.payload->>'mode',
      'section', j.payload->>'section', 'progress', ev.progress, 'message', ev.message,
      'queuePosition', public.my_job_queue_position(j.id)) end,
    'failedJob', case when failed.id is null then null else jsonb_build_object(
      'id', failed.id, 'stage', failed.stage, 'mode', failed.payload->>'mode', 'error', left(failed.error, 500)) end);
end; $$;

-- AI lyric buttons ------------------------------------------------------------------------------
-- input: shared LyricsAssistInputSchema; result: LyricsAssistResultSchema (written by the worker).
create table public.lyric_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('write', 'regenerate', 'improve')),
  lang text not null check (lang in ('it', 'ru', 'ro', 'ja', 'en', 'es', 'de', 'zh', 'pt', 'ko', 'fr')),
  input jsonb not null check (jsonb_typeof(input) = 'object' and length(input::text) <= 12000),
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  error_code text check (error_code is null or error_code in ('privacy_filter', 'limit', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index lyric_requests_owner_created_idx on public.lyric_requests (owner_id, created_at desc);
alter table public.lyric_requests enable row level security;
revoke all on public.lyric_requests from anon, authenticated;
grant select on public.lyric_requests to authenticated;
create policy "owners read lyric requests" on public.lyric_requests for select to authenticated
using (owner_id = (select auth.uid()) and exists (
  select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer')
));
create trigger lyric_requests_updated_at before update on public.lyric_requests
for each row execute function public.set_updated_at();

-- Queues one lyrics_assist job; one at a time per person, 60 a day.
create function public.lyrics_assist_request(p_mode text, p_lang text, p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'customer')) then
    raise exception 'profile required';
  end if;
  if p_mode is null or p_mode not in ('write', 'regenerate', 'improve') then raise exception 'invalid mode'; end if;
  if p_lang is null or p_lang not in ('it', 'ru', 'ro', 'ja', 'en', 'es', 'de', 'zh', 'pt', 'ko', 'fr') then
    raise exception 'invalid language';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or length(p_input::text) > 12000
    or length(coalesce(p_input->>'lyrics', '')) > 5000 then
    raise exception 'invalid input';
  end if;
  if p_mode <> 'write' and btrim(coalesce(p_input->>'lyrics', '')) = '' then raise exception 'lyrics required'; end if;
  if p_mode = 'write' and btrim(concat(p_input->>'title', p_input->>'brief', p_input->>'style')) = '' then
    raise exception 'a title, a brief or a style is needed';
  end if;
  if exists (
    select 1 from public.jobs where owner_id = auth.uid() and stage = 'lyrics_assist' and status in ('queued', 'running')
  ) then
    raise exception 'a lyrics request is already running';
  end if;
  if (select count(*) from public.lyric_requests where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 60 then
    raise exception 'daily lyrics limit reached';
  end if;
  insert into public.lyric_requests(owner_id, mode, lang, input)
  values (auth.uid(), p_mode, p_lang, p_input) returning id into rid;
  insert into public.jobs(owner_id, version_id, stage, idempotency_key, payload)
  values (auth.uid(), null, 'lyrics_assist', 'lyrics_assist:' || rid, jsonb_build_object('request_id', rid));
  return rid;
end; $$;

create function public.lyrics_assist_cancel(p_request uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.lyric_requests where id = p_request and owner_id = auth.uid()) then
    raise exception 'owned request required';
  end if;
  update public.jobs set status = 'cancelled', finished_at = now(), heartbeat_at = null
  where owner_id = auth.uid() and stage = 'lyrics_assist' and payload->>'request_id' = p_request::text
    and status in ('queued', 'running');
end; $$;

-- One poll for a request: its job's status, progress and queue position, then its result.
create function public.lyrics_assist_state(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q public.lyric_requests; j public.jobs; ev public.job_events;
begin
  select * into q from public.lyric_requests where id = p_request and owner_id = auth.uid();
  if not found then return null; end if;
  select * into j from public.jobs
  where owner_id = auth.uid() and stage = 'lyrics_assist' and payload->>'request_id' = q.id::text
  order by created_at desc limit 1;
  if j.id is not null then
    select * into ev from public.job_events where job_id = j.id order by at desc, id desc limit 1;
  end if;
  return jsonb_build_object('id', q.id, 'mode', q.mode, 'status', j.status, 'progress', ev.progress,
    'message', ev.message, 'queuePosition', public.my_job_queue_position(j.id), 'result', q.result,
    'errorCode', q.error_code);
end; $$;

revoke all on function public.remake_lyrics_text(jsonb), public.remake_gate_ok(jsonb),
  public.owned_remake(uuid), public.remake_active_job(uuid) from public, anon, authenticated;
revoke all on function public.remake_start(text, text, text, text), public.remake_edit(uuid, integer, jsonb, text),
  public.remake_regenerate_section(uuid, integer, text), public.remake_accept(uuid, integer, jsonb, jsonb, text),
  public.remake_cancel(uuid), public.remake_dismiss(uuid), public.remake_retry(uuid),
  public.my_job_queue_position(uuid), public.my_remake(), public.lyrics_assist_request(text, text, jsonb),
  public.lyrics_assist_cancel(uuid), public.lyrics_assist_state(uuid) from public, anon;
grant execute on function public.remake_start(text, text, text, text), public.remake_edit(uuid, integer, jsonb, text),
  public.remake_regenerate_section(uuid, integer, text), public.remake_accept(uuid, integer, jsonb, jsonb, text),
  public.remake_cancel(uuid), public.remake_dismiss(uuid), public.remake_retry(uuid),
  public.my_job_queue_position(uuid), public.my_remake(), public.lyrics_assist_request(text, text, jsonb),
  public.lyrics_assist_cancel(uuid), public.lyrics_assist_state(uuid) to authenticated;
-- The worker (service role) composes and checks lyrics the same way.
grant execute on function public.remake_lyrics_text(jsonb), public.remake_gate_ok(jsonb) to service_role;
