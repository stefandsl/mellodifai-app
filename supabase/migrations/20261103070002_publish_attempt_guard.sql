-- Publishing is entered through enqueue_publish, and one render attempt has one upload.
drop policy "owners enqueue jobs" on public.jobs;
create policy "owners enqueue jobs" on public.jobs for insert to authenticated with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
  and stage in ('draft_lyrics', 'generate_song', 'timing', 'set_privacy')
  and status = 'queued' and attempts = 0
  and worker_id is null and result is null and error is null
  and heartbeat_at is null and started_at is null and finished_at is null
  and not_before is null
);

create or replace function public.enqueue_publish(p_render uuid,p_metadata jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions; r public.renders; n integer;
begin
  select * into r from public.renders where id=p_render and owner_id=auth.uid();
  if not found then raise exception 'owned render required'; end if;
  select * into v from public.versions where id=r.version_id and owner_id=auth.uid() for update;
  if not found then raise exception 'owned version required'; end if;
  if v.status not in ('approved','publishing') or r.render_attempt<>v.render_attempt
    or not (
      (r.kind='master' and r.approved_at is not null)
      or (r.kind='visualizer' and r.aspect='16:9' and r.path is not null
        and r.preview_path is not null and exists (
          select 1 from public.renders master
          where master.version_id=v.id and master.kind='master'
            and master.render_attempt=v.render_attempt and master.approved_at is not null
        ))
    ) then raise exception 'approved current render required'; end if;
  if jsonb_typeof(p_metadata) is distinct from 'object' or coalesce(length(p_metadata->>'title'),0)=0 then raise exception 'metadata required'; end if;
  if exists (
    select 1 from public.jobs j join public.renders prior on prior.id::text=j.payload->>'render_id'
    where j.version_id=v.id and j.stage='publish' and prior.render_attempt=v.render_attempt
      and j.status in ('queued','running','done')
  ) or exists (
    select 1 from public.publications pub join public.renders prior on prior.id=pub.render_id
    where prior.version_id=v.id and prior.render_attempt=v.render_attempt
      and pub.upload_state in ('uploading','uploaded')
  ) then return; end if;
  select count(*)+1 into n from public.jobs where version_id=v.id and stage='publish' and payload->>'render_id'=p_render::text;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key,payload) values(auth.uid(),v.id,'publish','publish:'||r.id||':'||n,jsonb_build_object('render_id',r.id,'metadata',p_metadata));
  update public.versions set status='publishing' where id=v.id;
end; $$;

create or replace function public.reserve_publication_upload(p_render uuid,p_worker text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.renders; v public.versions; p public.publications;
begin
  select * into r from public.renders where id=p_render;
  if not found then raise exception 'render missing'; end if;
  select * into v from public.versions where id=r.version_id for update;
  if not found or v.status not in ('approved','publishing') or r.render_attempt<>v.render_attempt
    or not (
      (r.kind='master' and r.approved_at is not null)
      or (r.kind='visualizer' and r.aspect='16:9' and r.path is not null
        and r.preview_path is not null and exists (
          select 1 from public.renders master
          where master.version_id=v.id and master.kind='master'
            and master.render_attempt=v.render_attempt and master.approved_at is not null
        ))
    ) then raise exception 'approved current render required'; end if;
  if not exists(select 1 from public.workers where id=p_worker and owner_id=r.owner_id) then raise exception 'worker owner mismatch'; end if;
  select pub.* into p from public.publications pub join public.renders prior on prior.id=pub.render_id
    where prior.version_id=v.id and prior.render_attempt=v.render_attempt
      and pub.upload_state in ('uploading','uploaded')
    order by pub.created_at desc,pub.id desc limit 1;
  if found then
    if p.render_id<>r.id then raise exception 'render attempt already has an upload'; end if;
    return jsonb_build_object('kind',p.upload_state,'publication',to_jsonb(p));
  end if;
  if not public.reserve_youtube_upload(p_worker) then return jsonb_build_object('kind','quota'); end if;
  insert into public.publications(owner_id,render_id,privacy,upload_state,upload_worker_id,upload_quota_day)
    values(r.owner_id,r.id,'private','uploading',p_worker,(now() at time zone 'America/Los_Angeles')::date) returning * into p;
  return jsonb_build_object('kind','reserved','publication',to_jsonb(p));
end; $$;
