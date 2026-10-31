-- A worker can process a job for any customer, regardless of who owns its row.
alter table public.workers drop constraint workers_busy_job_owner_fkey;
alter table public.workers add constraint workers_busy_job_id_fkey
foreign key (busy_job_id) references public.jobs(id) on delete set null;

-- Worker status is client-visible, but its assignment and owner are internal.
revoke select on public.workers from authenticated;
grant select (id, last_seen, kie_balance, youtube_uploads_today, youtube_quota_day, engine_version)
on public.workers to authenticated;
