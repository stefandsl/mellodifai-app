-- Task 28: the user's own logos in the Video Studio (params.logos, up to 2). Each logo is an
-- upload like the centre picture, so request_visualizer checks it the same way: the caller's own
-- file, present, a picture up to 10 MB. The render PC reads these files with the service role, so
-- nothing else may reach it. The rest of the function is unchanged from 20261101000022.
create or replace function public.request_visualizer(p_version uuid, p_params jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v public.versions := public.web_version(p_version);
  aspect_value text := p_params->>'aspect';
  bg jsonb := p_params->'background';
  center jsonb := p_params->'centerImage';
  logos jsonb := coalesce(p_params->'logos', '[]'::jsonb);
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
      and jsonb_typeof(bg) = 'object' and jsonb_typeof(center) = 'object'
      and jsonb_typeof(logos) = 'array' and jsonb_array_length(logos) <= 2, false) then
    raise exception 'invalid visualizer params';
  end if;
  if not public.visualizer_asset_ok(
      case when bg->>'mode' in ('image', 'video') then bg->>'assetUrl' end,
      case when bg->>'mode' = 'video' then 'video' else 'image' end)
    or not public.visualizer_asset_ok(
      case when center->>'mode' = 'upload' then center->>'assetUrl' end, 'image')
    or exists (
      select 1 from jsonb_array_elements(logos) as logo
      where jsonb_typeof(logo) <> 'object'
        or logo->>'assetUrl' is null
        or not public.visualizer_asset_ok(logo->>'assetUrl', 'image')) then
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

revoke all on function public.request_visualizer(uuid, jsonb) from public, anon;
grant execute on function public.request_visualizer(uuid, jsonb) to authenticated;
