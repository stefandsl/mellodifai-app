-- Final recovery paths and least-privilege corrections.
revoke update, delete on public.projects from authenticated, anon;

-- Persist the quota reservation provenance so recovery cannot decrement a
-- different worker or a later quota day.
alter table public.publications add column upload_worker_id text references public.workers(id) on delete set null;
alter table public.publications add column upload_quota_day date;
create index publications_upload_worker_id_idx on public.publications(upload_worker_id);
create or replace function public.reserve_publication_upload(p_render uuid,p_worker text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.renders; p public.publications;
begin
  select * into r from public.renders where id=p_render for update;
  if not found then raise exception 'render missing'; end if;
  if not exists(select 1 from public.workers where id=p_worker and owner_id=r.owner_id) then raise exception 'worker owner mismatch'; end if;
  select * into p from public.publications where render_id=p_render and upload_state in ('uploading','uploaded') order by created_at desc,id desc limit 1;
  if found then return jsonb_build_object('kind',p.upload_state,'publication',to_jsonb(p)); end if;
  if not public.reserve_youtube_upload(p_worker) then return jsonb_build_object('kind','quota'); end if;
  insert into public.publications(owner_id,render_id,privacy,upload_state,upload_worker_id,upload_quota_day)
    values(r.owner_id,r.id,'private','uploading',p_worker,(now() at time zone 'America/Los_Angeles')::date) returning * into p;
  return jsonb_build_object('kind','reserved','publication',to_jsonb(p));
end; $$;

create function public.back_to_lyrics(p_version uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version);
begin
  if v.status <> 'failed' then raise exception 'failed version required'; end if;
  if v.kie_submit_state='submitting' and v.kie_task_id is null then raise exception 'resolve unknown submission first'; end if;
  if exists(select 1 from public.jobs where version_id=v.id and status in ('queued','running')) then raise exception 'job already active'; end if;
  -- A subsequent approval must use a fresh generation and archive old task files.
  update public.versions set status='lyrics_review',generation_count=generation_count+1,render_attempt=render_attempt+1,chosen_take_id=null,kie_task_id=null,kie_submit_state=null where id=v.id;
end; $$;

create function public.resolve_kie_submission(p_version uuid,p_charged boolean,p_task_id text default null) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version);
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'admin required'; end if;
  if p_charged is null or v.status <> 'failed' or v.kie_submit_state is distinct from 'submitting' or v.kie_task_id is not null then raise exception 'unknown submission required'; end if;
  if exists(select 1 from public.jobs where version_id=v.id and status in ('queued','running')) then raise exception 'job already active'; end if;
  if p_charged then
    if coalesce(length(btrim(p_task_id)),0)=0 or p_task_id ~ '[[:space:][:cntrl:]]' then raise exception 'task id required'; end if;
    update public.versions set status='song_queued', kie_task_id=btrim(p_task_id), kie_submit_state='submitted' where id=v.id;
    insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(auth.uid(),v.id,'generate_song','generate_song:'||v.id||':'||v.generation_count||':resolved:'||gen_random_uuid());
  else
    update public.versions set status='lyrics_review',generation_count=generation_count+1,render_attempt=render_attempt+1,chosen_take_id=null, kie_task_id=null, kie_submit_state=null where id=v.id;
  end if;
end; $$;

create function public.release_youtube_upload(p_publication uuid,p_worker text,p_error text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.publications;
begin
  select * into p from public.publications where id=p_publication for update;
  if not found or p.upload_state <> 'uploading' then raise exception 'upload reservation required'; end if;
  if p.upload_worker_id is distinct from p_worker then raise exception 'reservation worker mismatch'; end if;
  update public.publications set upload_state='pending', metadata=jsonb_set(metadata,'{upload_error}',to_jsonb(coalesce(p_error,'upload failed')),true) where id=p.id;
  update public.workers set youtube_uploads_today=greatest(0,youtube_uploads_today-1) where id=p_worker and owner_id=p.owner_id and youtube_quota_day=p.upload_quota_day;
end; $$;

create function public.resolve_upload(p_publication uuid,p_uploaded boolean,p_video_id text default null) returns void
language plpgsql security definer set search_path='' as $$
declare p public.publications;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'admin required'; end if;
  select pub.* into p from public.publications pub where pub.id=p_publication and pub.owner_id=auth.uid() for update;
  if not found or p.upload_state <> 'uploading' or p_uploaded is null then raise exception 'uploading publication required'; end if;
  if exists(select 1 from public.jobs j join public.renders r on r.version_id=j.version_id where r.id=p.render_id and j.status in ('queued','running')) then raise exception 'job already active'; end if;
  if p_uploaded then
    if coalesce(length(btrim(p_video_id)),0)=0 or p_video_id !~ '^[A-Za-z0-9_-]+$' then raise exception 'video id required'; end if;
    update public.publications set upload_state='uploaded',youtube_video_id=btrim(p_video_id),privacy='private',privacy_applied='private' where id=p.id;
  else
    update public.publications set upload_state='pending' where id=p.id;
    update public.workers set youtube_uploads_today=greatest(0,youtube_uploads_today-1) where id=p.upload_worker_id and owner_id=p.owner_id and youtube_quota_day=p.upload_quota_day;
  end if;
end; $$;

-- Reset explicit role grants as well as PUBLIC inheritance. Supabase default
-- privileges can grant authenticated EXECUTE directly on newly created functions;
-- CREATE OR REPLACE also preserves an existing function's ACL.
-- Cover every overload, including the earlier text-form Kie resolution RPC.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature, p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and p.proname in (
        'release_youtube_upload','reserve_publication_upload','reserve_youtube_upload',
        'back_to_lyrics','resolve_kie_submission','resolve_upload','generate_again'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', f.signature);
    execute format('alter function %s security definer', f.signature);
    execute format('alter function %s set search_path = %L', f.signature, '');
    if f.proname in ('release_youtube_upload','reserve_publication_upload','reserve_youtube_upload') then
      execute format('grant execute on function %s to service_role', f.signature);
    else
      execute format('grant execute on function %s to authenticated, service_role', f.signature);
    end if;
  end loop;
end;
$$;
