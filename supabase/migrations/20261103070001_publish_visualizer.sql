-- The owner may upload a completed 16:9 Video Studio render after approving the song's master.
create or replace function public.enqueue_publish(p_render uuid,p_metadata jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions; r public.renders; n integer;
begin
  select * into r from public.renders where id=p_render and owner_id=auth.uid();
  if not found then raise exception 'owned render required'; end if;
  v=public.web_version(r.version_id);
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
  if exists(select 1 from public.jobs where version_id=v.id and stage='publish' and payload->>'render_id'=p_render::text and status in ('queued','running','done')) then return; end if;
  select count(*)+1 into n from public.jobs where version_id=v.id and stage='publish' and payload->>'render_id'=p_render::text;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key,payload) values(auth.uid(),v.id,'publish','publish:'||r.id||':'||n,jsonb_build_object('render_id',r.id,'metadata',p_metadata));
  update public.versions set status='publishing' where id=v.id;
end; $$;

revoke all on function public.enqueue_publish(uuid,jsonb) from public,anon;
grant execute on function public.enqueue_publish(uuid,jsonb) to authenticated;
