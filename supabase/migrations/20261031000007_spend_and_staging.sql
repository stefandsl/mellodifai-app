-- Preserve migration 00006 checkpoints and close the ambiguous-submission spend path.
create or replace function public.generate_again(p_version uuid,p_generation integer) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version);
begin
  if v.kie_submit_state='submitting' and v.kie_task_id is null then
    raise exception 'kie submission state unknown: resolve it in the kie dashboard first';
  end if;
  if v.status not in ('takes_review','failed') or p_generation is null or v.generation_count<>p_generation then raise exception 'generation review required'; end if;
  update public.versions set generation_count=generation_count+1,render_attempt=render_attempt+1,status='song_queued',chosen_take_id=null where id=v.id;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(auth.uid(),v.id,'generate_song','generate_song:'||v.id||':'||(v.generation_count+1));
end; $$;
revoke all on function public.generate_again(uuid,integer) from public,anon;
grant execute on function public.generate_again(uuid,integer) to authenticated;

-- Also harden the retired RPC; do not restore its client execute grant.
create or replace function public.transition_version(p_version uuid,p_action text,p_take uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions; target text; job_stage text; attempt integer;
begin
  select ver.* into v from public.versions ver join public.projects p on p.id=ver.project_id
    where ver.id=p_version and ver.owner_id=auth.uid() and p.owner_id=auth.uid() for update of ver;
  if not found then raise exception 'owned version required'; end if;
  if p_action='generate_again' and v.kie_submit_state='submitting' and v.kie_task_id is null then
    raise exception 'kie submission state unknown: resolve it in the kie dashboard first';
  end if;
  if p_action='approve_lyrics' and v.status='lyrics_review' then target='song_queued';job_stage='generate_song';
  elsif p_action='generate_again' and v.status in ('takes_review','failed') then
    target='song_queued';job_stage='generate_song';v.generation_count=v.generation_count+1;
  elsif p_action='pick_take' and v.status='takes_review' then
    if not exists(select 1 from public.takes where id=p_take and version_id=v.id and owner_id=auth.uid() and generation=v.generation_count) then raise exception 'owned current take required'; end if;
    target='takes_review';job_stage='timing';v.chosen_take_id=p_take;
  elsif p_action='render_again' and v.status in ('video_review','approved') then
    target='producing';job_stage='timing';v.render_attempt=v.render_attempt+1;
  elsif p_action='approve_video' and v.status='video_review' then
    if not exists(select 1 from public.renders where version_id=v.id and kind='master'
      and jsonb_typeof(qa_results->'gates')='array' and jsonb_array_length(qa_results->'gates')>=4
      and not exists(select 1 from jsonb_array_elements(qa_results->'gates') g where (g->>'pass') is distinct from 'true')) then raise exception 'passing QA required'; end if;
    target='approved';
  else raise exception 'transition not allowed'; end if;
  update public.versions set status=target,chosen_take_id=v.chosen_take_id,generation_count=v.generation_count,render_attempt=v.render_attempt where id=v.id;
  if job_stage is not null then
    attempt=case when job_stage='generate_song' then v.generation_count else v.render_attempt end;
    insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(auth.uid(),v.id,job_stage,job_stage||':'||v.id||':'||attempt) on conflict(idempotency_key) do nothing;
  end if;
end;
$$;
revoke all on function public.transition_version(uuid,text,uuid) from public,anon,authenticated;

-- Resolution records an operator's dashboard decision, never starts a paid job.
-- Use Generate again after not_submitted; retry_stage (same generation) after submitted.
create function public.resolve_kie_submission(p_version uuid,p_outcome text) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions; task_id text;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then
    raise exception 'admin required';
  end if;
  v=public.web_version(p_version);
  if v.status<>'failed' or v.kie_submit_state is distinct from 'submitting' or v.kie_task_id is not null then
    raise exception 'ambiguous failed submission required';
  end if;
  if exists(select 1 from public.jobs where version_id=v.id and status in ('queued','running')) then
    raise exception 'job already active';
  end if;
  if p_outcome='not_submitted' then
    update public.versions set kie_submit_state=null where id=v.id;
  elsif p_outcome like 'submitted:%' then
    task_id=substring(p_outcome from 11);
    if length(task_id)=0 or task_id ~ '[[:space:][:cntrl:]]' then raise exception 'invalid task id'; end if;
    update public.versions set kie_task_id=task_id,kie_submit_state='submitted',kie_generation=generation_count where id=v.id;
  else raise exception 'invalid outcome'; end if;
end; $$;
revoke all on function public.resolve_kie_submission(uuid,text) from public,anon;
grant execute on function public.resolve_kie_submission(uuid,text) to authenticated;
