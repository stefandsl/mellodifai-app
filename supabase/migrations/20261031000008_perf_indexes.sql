-- Index every foreign-key lookup path that is not already covered by a key.
create index if not exists projects_owner_id_idx on public.projects (owner_id);
create index if not exists versions_owner_id_idx on public.versions (owner_id);
create index if not exists versions_project_owner_id_idx on public.versions (project_id, owner_id);
create index if not exists versions_chosen_take_owner_id_idx on public.versions (chosen_take_id, owner_id);
create index if not exists takes_owner_id_idx on public.takes (owner_id);
create index if not exists takes_version_owner_id_idx on public.takes (version_id, owner_id);
create index if not exists renders_owner_id_idx on public.renders (owner_id);
create index if not exists renders_version_owner_id_idx on public.renders (version_id, owner_id);
create index if not exists renders_approved_by_idx on public.renders (approved_by);
create index if not exists publications_owner_id_idx on public.publications (owner_id);
create index if not exists publications_render_owner_id_idx on public.publications (render_id, owner_id);
create index if not exists publications_confirmed_by_idx on public.publications (confirmed_by);
create index if not exists workers_owner_id_idx on public.workers (owner_id);
create index if not exists workers_busy_job_owner_id_idx on public.workers (busy_job_id, owner_id);
create index if not exists jobs_owner_id_idx on public.jobs (owner_id);
create index if not exists jobs_version_owner_id_idx on public.jobs (version_id, owner_id);
create index if not exists job_events_owner_id_idx on public.job_events (owner_id);
create index if not exists job_events_job_owner_id_idx on public.job_events (job_id, owner_id);

drop policy "owners enqueue jobs" on public.jobs;
create policy "owners enqueue jobs" on public.jobs for insert to authenticated with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('admin', 'customer')
  )
  and stage in ('draft_lyrics', 'generate_song', 'timing', 'publish', 'set_privacy')
  and status = 'queued' and attempts = 0
  and worker_id is null and result is null and error is null
  and heartbeat_at is null and started_at is null and finished_at is null
  and not_before is null
);
