create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  version_id uuid not null,
  stage text not null check (stage in ('draft_lyrics', 'generate_song', 'timing', 'storyboard', 'render_master', 'render_hook', 'qa', 'art', 'publish', 'set_privacy', 'import_legacy')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  worker_id text,
  heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (id, owner_id),
  foreign key (version_id, owner_id) references public.versions(id, owner_id) on delete cascade
);

alter table public.workers
  add constraint workers_busy_job_id_fkey
  foreign key (busy_job_id) references public.jobs(id) on delete set null;

create index jobs_queued_created_at_idx on public.jobs (created_at, id) where status = 'queued';
create index jobs_running_heartbeat_at_idx on public.jobs (heartbeat_at) where status = 'running';

create table public.job_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  at timestamptz not null default now(),
  level text not null default 'info',
  message text not null,
  progress numeric,
  check (progress is null or (progress >= 0 and progress <= 100))
);

create index job_events_job_id_at_idx on public.job_events (job_id, at, id);

alter table public.jobs enable row level security;
alter table public.job_events enable row level security;

revoke all on table public.jobs, public.job_events from anon, authenticated;
revoke all on sequence public.job_events_id_seq from anon, authenticated;

create policy "jobs are accessible to their profiled owner"
on public.jobs for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);

create policy "job events are accessible to their profiled owner"
on public.job_events for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);

grant select, insert, update, delete on public.jobs, public.job_events to authenticated;
grant usage, select on sequence public.job_events_id_seq to authenticated;

-- RPC contract: returns [job] when claimed or [] when idle; workers read data[0].
create function public.claim_job(p_worker text)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker is null or btrim(p_worker) = '' then
    raise exception 'p_worker must not be empty';
  end if;

  return query
  with next_job as (
    select id
    from public.jobs
    where status = 'queued'
    order by created_at, id
    for update skip locked
    limit 1
  )
  update public.jobs as job
  set status = 'running',
      attempts = job.attempts + 1,
      worker_id = p_worker,
      heartbeat_at = now(),
      started_at = now(),
      finished_at = null
  from next_job
  where job.id = next_job.id
  returning job.*;
end;
$$;

create function public.heartbeat_job(p_job uuid, p_worker text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs
  set heartbeat_at = now()
  where id = p_job
    and status = 'running'
    and worker_id = p_worker;

  return found;
end;
$$;

create function public.requeue_stale(p_seconds integer default 120)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  requeued_count integer;
begin
  if p_seconds <= 0 then
    raise exception 'p_seconds must be positive';
  end if;

  update public.jobs
  set status = 'queued',
      worker_id = null,
      heartbeat_at = null,
      started_at = null
  where status = 'running'
    and heartbeat_at < now() - make_interval(secs => p_seconds);

  get diagnostics requeued_count = row_count;
  return requeued_count;
end;
$$;

revoke all on function public.claim_job(text) from public, anon, authenticated;
revoke all on function public.heartbeat_job(uuid, text) from public, anon, authenticated;
revoke all on function public.requeue_stale(integer) from public, anon, authenticated;
grant execute on function public.claim_job(text) to service_role;
grant execute on function public.heartbeat_job(uuid, text) to service_role;
grant execute on function public.requeue_stale(integer) to service_role;

alter table public.jobs replica identity full;
alter table public.job_events replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jobs'
  ) then
    alter publication supabase_realtime add table public.jobs;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_events'
  ) then
    alter publication supabase_realtime add table public.job_events;
  end if;
end;
$$;
