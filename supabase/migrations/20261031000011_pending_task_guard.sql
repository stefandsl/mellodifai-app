-- Never abandon a submitted task that may still succeed, even after a wait error.
create or replace function public.generate_again(p_version uuid,p_generation integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.versions := public.web_version(p_version);
begin
  if v.kie_task_id is not null and v.kie_task_state is distinct from 'failed' then
    raise exception 'kie task may still succeed: use Retry, it is free';
  end if;
  if v.kie_submit_state='submitting' and v.kie_task_id is null then
    raise exception 'kie submission state unknown: resolve it in the kie dashboard first';
  end if;
  if v.status not in ('takes_review','failed') or p_generation is null or v.generation_count<>p_generation then raise exception 'generation review required'; end if;
  update public.versions set generation_count=generation_count+1,render_attempt=render_attempt+1,status='song_queued',chosen_take_id=null where id=v.id;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(auth.uid(),v.id,'generate_song','generate_song:'||v.id||':'||(v.generation_count+1));
end; $$;

create or replace function public.back_to_lyrics(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.versions := public.web_version(p_version);
begin
  if v.kie_task_id is not null and v.kie_task_state is distinct from 'failed' then
    raise exception 'kie task may still succeed: use Retry, it is free';
  end if;
  if v.status <> 'failed' then raise exception 'failed version required'; end if;
  if v.kie_submit_state='submitting' and v.kie_task_id is null then raise exception 'resolve unknown submission first'; end if;
  if exists(select 1 from public.jobs where version_id=v.id and status in ('queued','running')) then raise exception 'job already active'; end if;
  -- A subsequent approval must use a fresh generation and archive old task files.
  update public.versions set status='lyrics_review',generation_count=generation_count+1,render_attempt=render_attempt+1,chosen_take_id=null,kie_task_id=null,kie_submit_state=null where id=v.id;
end; $$;

-- CREATE OR REPLACE preserves previous direct grants: reset them explicitly.
revoke all on function public.generate_again(uuid,integer), public.back_to_lyrics(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.generate_again(uuid,integer), public.back_to_lyrics(uuid)
  to authenticated;
