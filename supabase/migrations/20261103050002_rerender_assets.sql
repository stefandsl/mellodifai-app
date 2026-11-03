-- Render file paths and QA assets are written by the worker, never by a browser client.
drop policy if exists "renders are accessible to their profiled owner" on public.renders;
drop policy if exists "owners read renders" on public.renders;
create policy "owners read renders" on public.renders for select to authenticated
using (owner_id = (select auth.uid()) and exists (
  select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer')
));

create or replace function public.render_again(p_version uuid) returns void
language plpgsql security definer set search_path='' as $$
declare
  v public.versions := public.web_version(p_version);
  prior public.renders;
  published_metadata jsonb;
  look jsonb;
  assets jsonb;
begin
  if v.status not in ('video_review','approved','published') then raise exception 'render review required'; end if;
  if exists(select 1 from public.jobs where version_id=v.id and status in ('queued','running')) then raise exception 'job already active'; end if;
  select * into prior from public.renders
    where version_id=v.id and kind='master' and render_attempt=v.render_attempt
    order by created_at desc limit 1;
  if prior.id is null then raise exception 'current render required'; end if;
  select metadata into published_metadata from public.publications
    where render_id=prior.id order by created_at desc limit 1;
  select visualizer_params into look from public.renders
    where version_id=v.id and kind='visualizer' and aspect='16:9' limit 1;
  if look is null then
    select song_settings->'visualizer' into look from public.projects where id=v.project_id;
  end if;
  assets := coalesce(prior.qa_results->'assets','{}'::jsonb) || jsonb_build_object(
    'storyboard_path',v.storyboard_path,
    'storyboard_sections',v.storyboard_sections,
    'metadata',coalesce(published_metadata,'{}'::jsonb),
    'visualizer_params',coalesce(look,'null'::jsonb));
  update public.versions set render_attempt=render_attempt+1,status='producing' where id=v.id;
  insert into public.renders(owner_id,version_id,kind,render_attempt,qa_results)
    values(auth.uid(),v.id,'master',v.render_attempt+1,jsonb_build_object('assets',assets));
  insert into public.jobs(owner_id,version_id,stage,idempotency_key)
    values(auth.uid(),v.id,'timing','timing:'||v.id||':'||(v.render_attempt+1));
end; $$;
