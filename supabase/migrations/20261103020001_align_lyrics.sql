-- Local, on-demand lyric alignment for a playable take. It leaves the song status alone.
do $$
declare definition text;
begin
  select pg_get_constraintdef(c.oid) into definition from pg_constraint c
  where c.conrelid = 'public.jobs'::regclass and c.conname = 'jobs_stage_check';
  if definition is null then raise exception 'jobs_stage_check missing'; end if;
  execute 'alter table public.jobs drop constraint jobs_stage_check';
  execute format('alter table public.jobs add constraint jobs_stage_check check ((%s) or stage = %L)',
    substring(definition from 8 for length(definition) - 8), 'align_lyrics');
end; $$;

create function public.request_lyric_alignment(p_version uuid, p_take uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); t public.takes; job_id uuid; job_key text;
begin
  if not public.stems_allowed_status(v.status) and v.status <> 'takes_review' then
    raise exception 'playable song required';
  end if;
  select * into t from public.takes where id = p_take and version_id = v.id
    and owner_id = auth.uid() and generation = v.generation_count and audio_preview_path is not null;
  if not found then raise exception 'playable take required'; end if;
  if t.lyric_timing is not null then raise exception 'lyrics already aligned'; end if;
  if nullif(btrim(coalesce(t.lyrics, v.lyric_pack->>'lyrics', '')), '') is null then
    raise exception 'lyrics required';
  end if;
  job_key := 'align_lyrics:' || t.id;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key,payload)
  values (auth.uid(),v.id,'align_lyrics',job_key,jsonb_build_object('take_id',t.id))
  on conflict (idempotency_key) do update
    set status='queued', attempts=0, error=null, result=null, worker_id=null,
        heartbeat_at=null, started_at=null, finished_at=null, not_before=null
    where public.jobs.status in ('failed','cancelled')
  returning id into job_id;
  if job_id is null then select id into job_id from public.jobs where idempotency_key=job_key; end if;
  return job_id;
end; $$;

revoke all on function public.request_lyric_alignment(uuid,uuid) from public, anon;
grant execute on function public.request_lyric_alignment(uuid,uuid) to authenticated;
