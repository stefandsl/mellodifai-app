-- Library: likes, play counts, renames, trash and the queue position (feature-parity-plan T7).
-- Per-version state. The authenticated role has SELECT only on versions, so every write below
-- goes through a security definer RPC that checks the owner.
alter table public.versions add column liked boolean not null default false;
alter table public.versions add column disliked boolean not null default false;
alter table public.versions add column play_count integer not null default 0 check (play_count >= 0);
alter table public.versions add column trashed_at timestamptz;
-- The feed shows display_title, else the lyric pack title, else the topic. lyric_pack is not edited.
alter table public.versions add column display_title text
  check (display_title is null or length(display_title) between 1 and 100);
alter table public.versions add constraint versions_reaction_exclusive check (not (liked and disliked));
create index versions_trashed_at_idx on public.versions (trashed_at) where trashed_at is not null;

-- A trashed song cannot move through the pipeline from the web (approve, pick, render, ...).
-- Same signature as before, so the grants stay; only the not-trashed condition is new.
create or replace function public.web_version(p_version uuid) returns public.versions
language plpgsql security definer set search_path='' as $$
declare v public.versions;
begin
  select ver.* into v from public.versions ver join public.projects p on p.id=ver.project_id
  join public.profiles pr on pr.id=ver.owner_id
  where ver.id=p_version and ver.owner_id=auth.uid() and p.owner_id=auth.uid() and ver.trashed_at is null
  for update of ver;
  if not found then raise exception 'owned version required'; end if;
  return v;
end; $$;

-- The worker must not start new jobs for a trashed song. Queued jobs stay queued (restore
-- resumes them); a job that is already running finishes.
create or replace function public.claim_job(p_worker text) returns setof public.jobs
language plpgsql security definer set search_path='' as $$
begin
  if p_worker is null or btrim(p_worker)='' then raise exception 'p_worker must not be empty'; end if;
  return query with candidate as (
    select j.id from public.jobs j
    where j.status='queued' and (j.not_before is null or j.not_before<=now())
      and not exists (select 1 from public.versions v where v.id=j.version_id and v.trashed_at is not null)
    order by j.created_at,j.id for update of j skip locked limit 1
  ) update public.jobs j set status='running',attempts=j.attempts+1,worker_id=p_worker,heartbeat_at=now(),started_at=now(),finished_at=null
    from candidate c where j.id=c.id returning j.*;
end;
$$;

create function public.set_reaction(p_version uuid, p_reaction text) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version);
begin
  if p_reaction is null or p_reaction not in ('like','dislike','none') then raise exception 'invalid reaction'; end if;
  update public.versions set liked=(p_reaction='like'),disliked=(p_reaction='dislike') where id=v.id;
end; $$;

-- The web calls this once per track after 30 s of playback.
create function public.count_play(p_version uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version);
begin
  update public.versions set play_count=play_count+1 where id=v.id;
end; $$;

create function public.rename_version(p_version uuid, p_title text) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); t text := btrim(coalesce(p_title,''));
begin
  if length(t) not between 1 and 100 then raise exception 'invalid title'; end if;
  update public.versions set display_title=t where id=v.id;
end; $$;

-- Both return the number of songs that actually changed; ids the caller does not own, and songs
-- already in the wanted state, do not count.
create function public.trash_versions(p_versions uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'profile required'; end if;
  if p_versions is null or cardinality(p_versions) not between 1 and 500 then raise exception 'invalid versions'; end if;
  update public.versions set trashed_at=now() where id=any(p_versions) and owner_id=auth.uid() and trashed_at is null;
  get diagnostics n = row_count;
  return n;
end; $$;

create function public.restore_versions(p_versions uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'profile required'; end if;
  if p_versions is null or cardinality(p_versions) not between 1 and 500 then raise exception 'invalid versions'; end if;
  update public.versions set trashed_at=null where id=any(p_versions) and owner_id=auth.uid() and trashed_at is not null;
  get diagnostics n = row_count;
  return n;
end; $$;

-- For each of the caller's songs with a queued job: 1 + the jobs ahead of it on the render PC
-- (every running job, and every claimable queued job created earlier, of any owner). Only the
-- count crosses owners. Trashed songs neither appear nor count, because the worker skips them.
create function public.my_queue_positions() returns table(version_id uuid, queue_position integer)
language sql stable security definer set search_path='' as $$
  with live as (
    select j.id, j.status, j.created_at from public.jobs j
    join public.versions v on v.id=j.version_id
    where v.trashed_at is null and (j.status='running'
      or (j.status='queued' and (j.not_before is null or j.not_before<=now())))
  ), mine as (
    select distinct on (j.version_id) j.version_id, j.id, j.created_at from public.jobs j
    join public.versions v on v.id=j.version_id
    where j.owner_id=auth.uid() and v.trashed_at is null and j.status='queued'
      and (j.not_before is null or j.not_before<=now())
    order by j.version_id, j.created_at, j.id
  )
  select m.version_id,
    1 + (select count(*)::integer from live o
         where o.id<>m.id and (o.status='running' or (o.created_at,o.id)<(m.created_at,m.id)))
  from mine m;
$$;

revoke all on function public.set_reaction(uuid,text), public.count_play(uuid), public.rename_version(uuid,text),
  public.trash_versions(uuid[]), public.restore_versions(uuid[]), public.my_queue_positions() from public, anon;
grant execute on function public.set_reaction(uuid,text), public.count_play(uuid), public.rename_version(uuid,text),
  public.trash_versions(uuid[]), public.restore_versions(uuid[]), public.my_queue_positions() to authenticated;
