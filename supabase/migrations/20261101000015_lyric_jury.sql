-- Report of the lyric pipeline (router choice, jury scores, revision rounds), written by the worker.
alter table public.versions add column if not exists lyric_jury jsonb;
