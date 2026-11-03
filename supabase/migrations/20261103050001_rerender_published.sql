-- A published render remains immutable while the song starts another attempt.
create or replace function public.render_again(p_version uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version);
begin
  if v.status not in ('video_review','approved','published') then raise exception 'render review required'; end if;
  if exists(select 1 from public.jobs where version_id=v.id and status in ('queued','running')) then raise exception 'job already active'; end if;
  update public.versions set render_attempt=render_attempt+1,status='producing' where id=v.id;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(auth.uid(),v.id,'timing','timing:'||v.id||':'||(v.render_attempt+1));
end; $$;
revoke all on function public.render_again(uuid) from public,anon;
grant execute on function public.render_again(uuid) to authenticated;
