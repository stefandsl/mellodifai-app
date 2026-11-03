-- A master preview can be the song's only playable audio, with no take audio to align.
alter table public.versions add column if not exists lyric_timing jsonb;

create or replace function public.request_lyric_alignment(p_version uuid, p_take uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); t public.takes; job_id uuid; job_key text;
begin
  if not public.stems_allowed_status(v.status) and v.status <> 'takes_review' then
    raise exception 'playable song required';
  end if;
  if p_take is null then
    if v.lyric_timing is not null then raise exception 'lyrics already aligned'; end if;
    if not exists (select 1 from public.renders r where r.version_id = v.id
      and r.kind = 'master' and r.render_attempt = v.render_attempt
      and r.preview_path is not null) then
      raise exception 'playable master preview required';
    end if;
    job_key := 'align_lyrics:master:' || v.id;
  else
    select * into t from public.takes where id = p_take and version_id = v.id
      and owner_id = auth.uid() and generation = v.generation_count and audio_preview_path is not null;
    if not found then raise exception 'playable take required'; end if;
    if t.lyric_timing is not null then raise exception 'lyrics already aligned'; end if;
    job_key := 'align_lyrics:' || t.id;
  end if;
  if nullif(btrim(coalesce(t.lyrics, v.lyric_pack->>'lyrics', '')), '') is null then
    raise exception 'lyrics required';
  end if;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key,payload)
  values (auth.uid(),v.id,'align_lyrics',job_key,
    case when p_take is null then jsonb_build_object('source','master')
      else jsonb_build_object('take_id',t.id) end)
  on conflict (idempotency_key) do update
    set status='queued', attempts=0, error=null, result=null, worker_id=null,
        heartbeat_at=null, started_at=null, finished_at=null, not_before=null
    where public.jobs.status in ('failed','cancelled')
  returning id into job_id;
  if job_id is null then select id into job_id from public.jobs where idempotency_key=job_key; end if;
  return job_id;
end; $$;
