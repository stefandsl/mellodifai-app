create or replace function public.create_allowlisted_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null and new.email is not null and exists (
    select 1 from public.admin_allowlist where lower(email) = lower(new.email)
  ) then
    insert into public.profiles (id, email, role)
    values (new.id, new.email, 'admin')
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

create trigger create_allowlisted_profile_after_confirmation
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function public.create_allowlisted_profile();

revoke all on function public.create_allowlisted_profile() from public, anon, authenticated;

revoke all on public.jobs, public.job_events, public.workers from authenticated;
revoke all on sequence public.job_events_id_seq from authenticated;
grant select on public.jobs, public.job_events, public.workers to authenticated;
grant insert on public.jobs to authenticated;
grant update (status) on public.jobs to authenticated;

drop policy "jobs are accessible to their profiled owner" on public.jobs;
create policy "owners read jobs" on public.jobs for select to authenticated
using (owner_id = (select auth.uid()) and exists (
  select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer')
));
create policy "owners enqueue jobs" on public.jobs for insert to authenticated
with check (
  owner_id = (select auth.uid()) and exists (
    select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer')
  )
  and status = 'queued' and attempts = 0
  and worker_id is null and result is null and error is null
  and heartbeat_at is null and started_at is null and finished_at is null
);
create policy "owners cancel queued jobs" on public.jobs for update to authenticated
using (owner_id = (select auth.uid()) and status = 'queued' and exists (
  select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer')
))
with check (owner_id = (select auth.uid()) and status = 'cancelled');

drop policy "job events are accessible to their profiled owner" on public.job_events;
create policy "owners read job events" on public.job_events for select to authenticated
using (owner_id = (select auth.uid()) and exists (
  select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer')
));
drop policy "workers are accessible to their profiled owner" on public.workers;
create policy "owners read workers" on public.workers for select to authenticated
using (owner_id = (select auth.uid()) and exists (
  select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer')
));

-- jobs already has unique (id, owner_id) from the queue migration.
alter table public.job_events drop constraint job_events_job_id_fkey;
alter table public.job_events add constraint job_events_job_owner_fkey
foreign key (job_id, owner_id) references public.jobs(id, owner_id) on delete cascade;
alter table public.workers drop constraint workers_busy_job_id_fkey;
alter table public.workers add constraint workers_busy_job_owner_fkey
foreign key (busy_job_id, owner_id) references public.jobs(id, owner_id)
on delete set null (busy_job_id);

alter table public.publications alter column confirmed_by set default auth.uid();
alter table public.publications add constraint publications_confirmation_owner_check
check (confirmed_by is null or confirmed_by = owner_id);
