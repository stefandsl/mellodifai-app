-- ACE-Step: a free song engine that runs on the PC worker.
-- Idempotent with 20261101000016_engines_and_covers.sql, which already adds these columns. Renumbered from 20261101000017 at the L2 merge (that number is taken by admins_read_workers).
-- workers.engines holds the setup state the worker publishes, e.g.
-- {"ace-step": {"state": "installing", "step": "download_models", "pct": 40}}.
alter table public.workers add column if not exists engines jsonb not null default '{}'::jsonb;
grant select (engines) on public.workers to authenticated;

-- Which engine made a take and with which seed, so a take can be traced and redone.
alter table public.takes add column if not exists engine text not null default 'kie'
  check (engine in ('kie', 'ace-step', 'yue2'));
alter table public.takes add column if not exists seed bigint;
