-- Web checkpoints are serialized on the owned version row.
alter table public.renders add column render_attempt integer not null default 1;
-- Before attempt-scoped renders, each kind represented the version's latest render.
update public.renders r set render_attempt=v.render_attempt from public.versions v where v.id=r.version_id;
alter table public.renders add column approved_by uuid references public.profiles(id);
alter table public.renders add column override_reason text;
alter table public.versions add column storyboard_sections jsonb;
revoke update (lyric_pack) on public.versions from authenticated;
-- The old RPC must not provide a way around checkpoint validation.
revoke execute on function public.transition_version(uuid,text,uuid) from authenticated;

create function public.web_version(p_version uuid) returns public.versions
language plpgsql security definer set search_path='' as $$
declare v public.versions;
begin
  select ver.* into v from public.versions ver join public.projects p on p.id=ver.project_id
  join public.profiles pr on pr.id=ver.owner_id
  where ver.id=p_version and ver.owner_id=auth.uid() and p.owner_id=auth.uid() for update of ver;
  if not found then raise exception 'owned version required'; end if;
  return v;
end; $$;
revoke all on function public.web_version(uuid) from public,anon,authenticated;

create function public.create_project(p_topic text,p_brief text,p_languages text[],p_style text,p_mood text,p_vocal_gender text) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid; vid uuid; lang_code text;
begin
  if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'profile required'; end if;
  if p_topic is null or length(btrim(p_topic)) not between 1 and 250 or p_style is null or length(btrim(p_style)) not between 1 and 1000
    or p_vocal_gender is null or p_vocal_gender not in ('m','f') or coalesce(cardinality(p_languages),0)=0 then raise exception 'invalid project'; end if;
  if exists(select 1 from unnest(p_languages) l where l is null or l not in ('it','ru','ro','ja','en','es','de','zh','pt','ko','fr')) then raise exception 'invalid language'; end if;
  insert into public.projects(owner_id,topic,brief,style,mood,vocal_gender,theme)
    values(auth.uid(),p_topic,p_brief,p_style,p_mood,p_vocal_gender,'vbp') returning id into pid;
  for lang_code in select distinct unnest(p_languages) loop
    insert into public.versions(owner_id,project_id,lang) values(auth.uid(),pid,lang_code) returning id into vid;
    insert into public.jobs(owner_id,version_id,stage,idempotency_key)
      values(auth.uid(),vid,'draft_lyrics','draft_lyrics:'||vid||':1');
  end loop;
  return pid;
end; $$;

create function public.approve_lyrics(p_version uuid,p_pack jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version);
begin
  if v.status<>'lyrics_review' then raise exception 'lyrics review required'; end if;
  if p_pack is null or jsonb_typeof(p_pack)<>'object' or jsonb_typeof(p_pack->'title') is distinct from 'string'
    or length(btrim(p_pack->>'title'))=0 or jsonb_typeof(p_pack->'lyrics') is distinct from 'string' then raise exception 'invalid lyric pack'; end if;
  update public.versions set lyric_pack=p_pack,status='song_queued' where id=v.id;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(auth.uid(),v.id,'generate_song','generate_song:'||v.id||':'||v.generation_count);
end; $$;

create function public.pick_take(p_version uuid,p_take uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version);
begin
  if v.status<>'takes_review' then raise exception 'takes review required'; end if;
  if not exists(select 1 from public.takes where id=p_take and version_id=v.id and owner_id=auth.uid() and generation=v.generation_count) then raise exception 'current take required'; end if;
  update public.versions set chosen_take_id=p_take,status='producing' where id=v.id;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(auth.uid(),v.id,'timing','timing:'||v.id||':'||v.render_attempt);
end; $$;

create function public.approve_video(p_version uuid,p_override_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); r public.renders; failed boolean;
begin
  if v.status<>'video_review' then raise exception 'video review required'; end if;
  select * into r from public.renders where version_id=v.id and kind='master' and render_attempt=v.render_attempt order by created_at desc limit 1 for update;
  if not found or jsonb_typeof(r.qa_results->'gates') is distinct from 'array' or jsonb_array_length(r.qa_results->'gates')=0 then raise exception 'QA required'; end if;
  select exists(select 1 from jsonb_array_elements(r.qa_results->'gates') g where (g->>'pass') is distinct from 'true') into failed;
  if failed and coalesce(length(btrim(p_override_reason)),0)<3 then raise exception 'override reason required'; end if;
  if length(p_override_reason)>1000 then raise exception 'override too long'; end if;
  update public.renders set approved_at=now(),approved_by=auth.uid(),override_reason=case when failed then btrim(p_override_reason) else null end where id=r.id;
  update public.versions set status='approved' where id=v.id;
end; $$;

create function public.render_again(p_version uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version);
begin
  if v.status not in ('video_review','approved') then raise exception 'render review required'; end if;
  update public.versions set render_attempt=render_attempt+1,status='producing' where id=v.id;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(auth.uid(),v.id,'timing','timing:'||v.id||':'||(v.render_attempt+1));
end; $$;

create function public.generate_again(p_version uuid,p_generation integer) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version);
begin
  if v.status not in ('takes_review','failed') or p_generation is null or v.generation_count<>p_generation then raise exception 'generation review required'; end if;
  update public.versions set generation_count=generation_count+1,render_attempt=render_attempt+1,status='song_queued',chosen_take_id=null where id=v.id;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(auth.uid(),v.id,'generate_song','generate_song:'||v.id||':'||(v.generation_count+1));
end; $$;

create function public.enqueue_publish(p_render uuid,p_metadata jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions; r public.renders; n integer;
begin
  select * into r from public.renders where id=p_render and owner_id=auth.uid();
  if not found then raise exception 'owned render required'; end if;
  v=public.web_version(r.version_id);
  if v.status not in ('approved','publishing') or r.kind<>'master' or r.render_attempt<>v.render_attempt or r.approved_at is null then raise exception 'approved current master required'; end if;
  if jsonb_typeof(p_metadata) is distinct from 'object' or coalesce(length(p_metadata->>'title'),0)=0 then raise exception 'metadata required'; end if;
  if exists(select 1 from public.jobs where version_id=v.id and stage='publish' and payload->>'render_id'=p_render::text and status in ('queued','running','done')) then return; end if;
  select count(*)+1 into n from public.jobs where version_id=v.id and stage='publish' and payload->>'render_id'=p_render::text;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key,payload) values(auth.uid(),v.id,'publish','publish:'||r.id||':'||n,jsonb_build_object('render_id',r.id,'metadata',p_metadata));
  update public.versions set status='publishing' where id=v.id;
end; $$;

create function public.retry_stage(p_version uuid,p_job uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); j public.jobs; target text;
begin
  if v.status<>'failed' then raise exception 'failed version required'; end if;
  select * into j from public.jobs where id=p_job and version_id=v.id and status='failed' and owner_id=auth.uid();
  if not found then raise exception 'failed job required'; end if;
  if exists(select 1 from public.jobs where version_id=v.id and status in ('running','queued')) then raise exception 'job already active'; end if;
  target=case j.stage when 'draft_lyrics' then 'drafting' when 'generate_song' then 'song_queued' when 'publish' then 'approved' when 'set_privacy' then 'approved' else 'producing' end;
  update public.versions set status=target where id=v.id;
  -- Same generation: the worker resumes an accepted kie task, never spends again.
  if j.stage='publish' then
    perform public.enqueue_publish((j.payload->>'render_id')::uuid,j.payload->'metadata');
  else
    insert into public.jobs(owner_id,version_id,stage,idempotency_key,payload) values(auth.uid(),v.id,j.stage,j.idempotency_key||':retry:'||j.id,j.payload);
  end if;
end; $$;

revoke all on function public.create_project(text,text,text[],text,text,text), public.approve_lyrics(uuid,jsonb), public.pick_take(uuid,uuid),
 public.approve_video(uuid,text), public.render_again(uuid), public.generate_again(uuid,integer), public.enqueue_publish(uuid,jsonb), public.retry_stage(uuid,uuid) from public,anon;
grant execute on function public.create_project(text,text,text[],text,text,text), public.approve_lyrics(uuid,jsonb), public.pick_take(uuid,uuid),
 public.approve_video(uuid,text), public.render_again(uuid), public.generate_again(uuid,integer), public.enqueue_publish(uuid,jsonb), public.retry_stage(uuid,uuid) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='versions') then alter publication supabase_realtime add table public.versions; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='workers') then alter publication supabase_realtime add table public.workers; end if;
end; $$;
