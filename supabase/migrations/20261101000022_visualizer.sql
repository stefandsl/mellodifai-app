-- Visualizer videos from the Video Studio (feature-parity-plan.md T13, ace-ui-replica-prompt.md
-- item G).
--
-- request_visualizer stores the studio's parameters on the song's visualizer render (one per
-- aspect: renders.kind 'visualizer', renders.aspect '16:9' or '9:16') and queues the on-demand
-- 'visualizer' stage, which renders the chosen take on the PC with Remotion and writes the video
-- into renders.preview_path. A new request for the same aspect reuses the row: its parameters are
-- replaced and the job is queued again, so "Riprova" and re-renders keep one video per aspect.
--
-- renders.visualizer_params is the VisualizerParams of packages/shared/src/visualizer/params.ts,
-- validated by the web action and again by the worker; this function checks what decides access:
-- the aspect, and that every uploaded picture or video belongs to the caller and fits its limit.

alter table public.jobs drop constraint jobs_stage_check;
alter table public.jobs add constraint jobs_stage_check check (stage in (
  'draft_lyrics', 'generate_song', 'timing', 'storyboard', 'render_master', 'render_hook', 'qa',
  'art', 'publish', 'set_privacy', 'import_legacy', 'stems', 'visualizer'));

alter table public.renders drop constraint renders_kind_check;
alter table public.renders add constraint renders_kind_check check (kind in ('master', 'hook', 'visualizer'));
alter table public.renders add column if not exists aspect text;
alter table public.renders add column if not exists visualizer_params jsonb;
alter table public.renders add constraint renders_visualizer_shape check (
  case when kind = 'visualizer'
    then coalesce(aspect in ('16:9', '9:16') and jsonb_typeof(visualizer_params) = 'object', false)
    else aspect is null and visualizer_params is null end);
create unique index renders_visualizer_aspect_key on public.renders (version_id, aspect)
  where kind = 'visualizer';

-- Uploads for the studio: backgrounds (pictures up to 10 MB, videos up to 100 MB) and centre
-- images, under <owner>/<uuid>.<ext>; the royalty-free "Casuale" backgrounds under stock/.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 104857600,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "owners upload studio files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);
create policy "owners read studio files"
on storage.objects for select to authenticated
using (
  bucket_id = 'uploads'
  and ((storage.foldername(name))[1] = (select auth.uid())::text or (storage.foldername(name))[1] = 'stock')
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);
create policy "owners delete studio files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- An uploaded asset named by the studio as /media/uploads/<owner>/<uuid>.<ext>: it must be the
-- caller's, exist, and be a picture up to 10 MB (or, for a background video, a video up to 100 MB).
create function public.visualizer_asset_ok(p_url text, p_kind text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare path text; o storage.objects;
begin
  if p_url is null then return true; end if;
  if p_url !~ ('^/media/uploads/' || auth.uid() || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|mp4|webm)$') then
    return false;
  end if;
  path := substr(p_url, length('/media/uploads/') + 1);
  select * into o from storage.objects where bucket_id = 'uploads' and name = path;
  if not found then return false; end if;
  if p_kind = 'video' then
    return o.metadata->>'mimetype' in ('video/mp4', 'video/webm')
      and coalesce((o.metadata->>'size')::bigint, 0) <= 104857600;
  end if;
  return o.metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
    and coalesce((o.metadata->>'size')::bigint, 0) <= 10485760;
end; $$;

create function public.request_visualizer(p_version uuid, p_params jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v public.versions := public.web_version(p_version);
  aspect_value text := p_params->>'aspect';
  bg jsonb := p_params->'background';
  center jsonb := p_params->'centerImage';
  render_id uuid; job_id uuid; job_key text;
begin
  if not public.stems_allowed_status(v.status) or v.chosen_take_id is null then
    raise exception 'chosen take required';
  end if;
  if not exists (select 1 from public.takes where id = v.chosen_take_id and audio_preview_path is not null) then
    raise exception 'chosen take audio required';
  end if;
  if not coalesce(jsonb_typeof(p_params) = 'object' and pg_column_size(p_params) <= 16384
      and aspect_value in ('16:9', '9:16')
      and jsonb_typeof(bg) = 'object' and jsonb_typeof(center) = 'object', false) then
    raise exception 'invalid visualizer params';
  end if;
  if not public.visualizer_asset_ok(
      case when bg->>'mode' in ('image', 'video') then bg->>'assetUrl' end,
      case when bg->>'mode' = 'video' then 'video' else 'image' end)
    or not public.visualizer_asset_ok(
      case when center->>'mode' = 'upload' then center->>'assetUrl' end, 'image') then
    raise exception 'invalid visualizer asset';
  end if;
  job_key := 'visualizer:' || v.id || ':' || aspect_value;
  if exists (select 1 from public.jobs where idempotency_key = job_key and status = 'running') then
    raise exception 'visualizer already rendering';
  end if;
  insert into public.renders(owner_id, version_id, kind, aspect, render_attempt, visualizer_params)
  values (auth.uid(), v.id, 'visualizer', aspect_value, v.render_attempt, p_params)
  on conflict (version_id, aspect) where kind = 'visualizer'
  do update set visualizer_params = excluded.visualizer_params
  returning id into render_id;
  insert into public.jobs(owner_id, version_id, stage, idempotency_key, payload)
  values (auth.uid(), v.id, 'visualizer', job_key,
    jsonb_build_object('render_id', render_id, 'take_id', v.chosen_take_id))
  on conflict (idempotency_key) do update
    set status = 'queued', attempts = 0, error = null, result = null, worker_id = null,
        heartbeat_at = null, started_at = null, finished_at = null, not_before = null,
        payload = excluded.payload,
        -- A finished or failed render goes to the back of the line; a waiting one keeps its place.
        created_at = case when public.jobs.status = 'queued' then public.jobs.created_at else now() end
    where public.jobs.status in ('queued', 'done', 'failed', 'cancelled')
  returning id into job_id;
  if job_id is null then raise exception 'visualizer already rendering'; end if;
  return job_id;
end; $$;

-- Where each of the caller's queued visualizer jobs waits on the render PC, like my_stems_queue.
create function public.my_visualizer_queue() returns table(version_id uuid, aspect text, queue_position integer)
language sql stable security definer set search_path='' as $$
  with live as (
    select j.id, j.status, j.created_at from public.jobs j
    join public.versions v on v.id = j.version_id
    where v.trashed_at is null and (j.status = 'running'
      or (j.status = 'queued' and (j.not_before is null or j.not_before <= now())))
  ), mine as (
    select j.version_id, j.id, j.created_at,
      (select r.aspect from public.renders r where r.id = (j.payload->>'render_id')::uuid) as aspect
    from public.jobs j
    join public.versions v on v.id = j.version_id
    where j.owner_id = auth.uid() and v.trashed_at is null and j.status = 'queued' and j.stage = 'visualizer'
      and (j.not_before is null or j.not_before <= now())
  )
  select m.version_id, m.aspect,
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
      and j.stage not in ('stems', 'visualizer')
      and (j.not_before is null or j.not_before<=now())
    order by j.version_id, j.created_at, j.id
  )
  select m.version_id,
    1 + (select count(*)::integer from live o
         where o.id<>m.id and (o.status='running' or (o.created_at,o.id)<(m.created_at,m.id)))
  from mine m;
$$;

revoke all on function public.request_visualizer(uuid, jsonb), public.my_visualizer_queue(),
  public.visualizer_asset_ok(text, text) from public, anon;
grant execute on function public.request_visualizer(uuid, jsonb), public.my_visualizer_queue()
  to authenticated;
