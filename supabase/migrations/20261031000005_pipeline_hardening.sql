alter table public.jobs add column not_before timestamptz;
alter table public.workers alter column kie_balance type numeric using kie_balance::numeric;
alter table public.projects add column if not exists mood text;
alter table public.projects add column if not exists vocal_gender text check (vocal_gender in ('m','f'));
alter table public.versions add column generation_count integer not null default 1 check (generation_count > 0);
alter table public.versions add column kie_generation integer not null default 1;
alter table public.versions add column kie_submit_state text check (kie_submit_state in ('submitting','submitted'));
alter table public.takes add column generation integer not null default 1;
alter table public.takes add column take_number integer;
-- Preserve legacy rows; newly produced rows always have take_number 1 or 2.
alter table public.takes add constraint takes_number_check check (take_number in (1,2));
alter table public.takes add constraint takes_generation_number_unique unique (version_id,generation,take_number);
alter table public.publications add column upload_state text not null default 'pending' check (upload_state in ('pending','uploading','uploaded'));
alter table public.publications add column privacy_applied text;
alter table public.publications add column publish_at timestamptz;
-- Historical IDs could have been client-written. Do not promote them to trusted
-- uploads; a service-role operator must verify them before any confirmation.
update public.publications set confirmed_by=null,confirmed_at=null;

revoke insert, update, delete on public.takes,public.renders,public.publications,public.versions,public.workers,public.job_events from authenticated,anon;
-- Remove the earlier column-level default on confirmations as well.
alter table public.publications alter column confirmed_by drop default;
grant insert (owner_id,project_id,lang,lyric_pack) on public.versions to authenticated;
grant update (lyric_pack) on public.versions to authenticated;
revoke insert on public.jobs from authenticated;
grant insert (owner_id,version_id,stage,idempotency_key,payload) on public.jobs to authenticated;
drop policy "owners enqueue jobs" on public.jobs;
create policy "owners enqueue jobs" on public.jobs for insert to authenticated with check (
  owner_id=auth.uid() and exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','customer'))
  and stage in ('draft_lyrics','generate_song','timing','publish','set_privacy')
  and status='queued' and attempts=0 and worker_id is null and result is null and error is null
  and heartbeat_at is null and started_at is null and finished_at is null and not_before is null
);

create or replace function public.claim_job(p_worker text) returns setof public.jobs
language plpgsql security definer set search_path='' as $$
begin
  if p_worker is null or btrim(p_worker)='' then raise exception 'p_worker must not be empty'; end if;
  return query with candidate as (
    select id from public.jobs where status='queued' and (not_before is null or not_before<=now())
    order by created_at,id for update skip locked limit 1
  ) update public.jobs j set status='running',attempts=j.attempts+1,worker_id=p_worker,heartbeat_at=now(),started_at=now(),finished_at=null
    from candidate c where j.id=c.id returning j.*;
end;
$$;
revoke all on function public.claim_job(text) from public,anon,authenticated;
grant execute on function public.claim_job(text) to service_role;

create function public.reserve_youtube_upload(p_worker text) returns boolean
language plpgsql security definer set search_path='' as $$
declare quota_day date := (now() at time zone 'America/Los_Angeles')::date;
begin
  update public.workers set youtube_uploads_today=case when youtube_quota_day=quota_day then youtube_uploads_today+1 else 1 end,
    youtube_quota_day=quota_day
    where id=p_worker and (youtube_quota_day is distinct from quota_day or youtube_uploads_today<4);
  return found;
end;
$$;
revoke all on function public.reserve_youtube_upload(text) from public,anon,authenticated;
grant execute on function public.reserve_youtube_upload(text) to service_role;

-- Serialize competing attempts for a render. Quota and reservation commit together.
create function public.reserve_publication_upload(p_render uuid,p_worker text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.renders; p public.publications;
begin
  select * into r from public.renders where id=p_render for update;
  if not found then raise exception 'render missing'; end if;
  if not exists(select 1 from public.workers where id=p_worker and owner_id=r.owner_id) then raise exception 'worker owner mismatch'; end if;
  select * into p from public.publications where render_id=p_render and upload_state in ('uploading','uploaded')
    order by created_at desc,id desc limit 1;
  if found then return jsonb_build_object('kind',p.upload_state,'publication',to_jsonb(p)); end if;
  if not public.reserve_youtube_upload(p_worker) then return jsonb_build_object('kind','quota'); end if;
  insert into public.publications(owner_id,render_id,privacy,upload_state) values(r.owner_id,r.id,'private','uploading') returning * into p;
  return jsonb_build_object('kind','reserved','publication',to_jsonb(p));
end;
$$;
revoke all on function public.reserve_publication_upload(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_publication_upload(uuid,text) to service_role;

create function public.confirm_publication(p_publication uuid,p_privacy text,p_publish_at timestamptz default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.publications; v public.versions; job_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select pub.* into p from public.publications pub join public.renders r on r.id=pub.render_id
    join public.versions ver on ver.id=r.version_id join public.projects pr on pr.id=ver.project_id
    where pub.id=p_publication and pub.owner_id=auth.uid() and r.owner_id=auth.uid() and ver.owner_id=auth.uid() and pr.owner_id=auth.uid()
    for update of pub;
  if not found or p.youtube_video_id is null or p.upload_state<>'uploaded' then raise exception 'owned uploaded publication required'; end if;
  if p_privacy is null or p_privacy not in ('public','private','unlisted','scheduled') then raise exception 'invalid privacy'; end if;
  if p_privacy='scheduled' and (p_publish_at is null or p_publish_at<=now()) then raise exception 'publish_at must be in the future'; end if;
  if p_privacy<>'scheduled' and p_publish_at is not null then raise exception 'publish_at requires scheduled privacy'; end if;
  select ver.* into v from public.versions ver join public.renders r on r.version_id=ver.id where r.id=p.render_id;
  if v.status not in ('approved','publishing','published') then raise exception 'version not approved'; end if;
  update public.publications set confirmed_by=auth.uid(),confirmed_at=now(),privacy=p_privacy,publish_at=p_publish_at where id=p.id;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key,payload)
    values(auth.uid(),v.id,'set_privacy','set_privacy:'||p.id||':'||gen_random_uuid(),jsonb_build_object('publication_id',p.id)) returning id into job_id;
  return job_id;
end;
$$;
revoke all on function public.confirm_publication(uuid,text,timestamptz) from public,anon;
grant execute on function public.confirm_publication(uuid,text,timestamptz) to authenticated;

-- Client transitions are explicit, ownership-checked and atomic with enqueueing.
create function public.transition_version(p_version uuid,p_action text,p_take uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions; target text; job_stage text; attempt integer;
begin
  select ver.* into v from public.versions ver join public.projects p on p.id=ver.project_id
    where ver.id=p_version and ver.owner_id=auth.uid() and p.owner_id=auth.uid() for update of ver;
  if not found then raise exception 'owned version required'; end if;
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
revoke all on function public.transition_version(uuid,text,uuid) from public,anon;
grant execute on function public.transition_version(uuid,text,uuid) to authenticated;
