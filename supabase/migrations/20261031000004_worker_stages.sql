alter table public.versions add column if not exists render_attempt integer not null default 1;
alter table public.versions add column if not exists kie_task_id text;
