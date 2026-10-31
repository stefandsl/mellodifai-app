-- Confirmed terminal Kie failures only; timeout/network failures remain pollable.
alter table public.versions add column kie_task_state text
  check (kie_task_state is null or kie_task_state = 'failed');

-- Clients may read their own task state through existing RLS, never write it.
revoke update (kie_task_state), insert (kie_task_state) on public.versions from public, anon, authenticated;
grant update (kie_task_state), insert (kie_task_state) on public.versions to service_role;
