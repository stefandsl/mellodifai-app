-- Local song engines and covers (docs/egm/v2-local-engines/design_draft.md, migration A).
alter table public.takes add column if not exists seed bigint;
alter table public.takes add column if not exists engine text not null default 'kie'
  check (engine in ('kie', 'ace-step', 'yue2'));
alter table public.takes add column if not exists cover_path text;
-- YuE2's ABC score: what makes a local take reproducible, not the seed alone.
alter table public.takes add column if not exists abc text;

-- Engine availability reported by the worker from file checks, without starting ComfyUI:
-- { "<engine>": { "installed": bool, "passedLangs": [..], "minutesPerAudioMinute": n, "checkedAt": ts } }
alter table public.workers add column if not exists engines jsonb not null default '{}'::jsonb;
grant select (engines) on public.workers to authenticated;

-- create_song now validates the engine: kie for everyone, local engines for the admin only
-- (YuE2 weights are licensed to individual creators, not to a paid service).
create or replace function public.create_song(
  p_prompt text,
  p_lyrics text,
  p_languages text[],
  p_style text,
  p_vocal_gender text,
  p_settings jsonb
) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid; vid uuid; lang_code text; topic text; engine text;
begin
  if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'profile required'; end if;
  topic := btrim(coalesce(nullif(btrim(p_prompt),''), nullif(btrim(p_settings->>'title'),''), ''));
  if length(topic) not between 1 and 500 then raise exception 'prompt or title required'; end if;
  if length(coalesce(p_lyrics,'')) > 5000 or length(coalesce(p_style,'')) > 1000 then raise exception 'too long'; end if;
  if p_vocal_gender is not null and p_vocal_gender not in ('m','f') then raise exception 'invalid vocal gender'; end if;
  if coalesce(cardinality(p_languages),0)=0 then raise exception 'language required'; end if;
  if exists(select 1 from unnest(p_languages) l where l is null or l not in ('it','ru','ro','ja','en','es','de','zh','pt','ko','fr')) then raise exception 'invalid language'; end if;
  if p_settings is null or jsonb_typeof(p_settings)<>'object' then raise exception 'invalid settings'; end if;
  engine := coalesce(p_settings->>'engine', 'kie');
  if engine not in ('kie','ace-step','yue2') then raise exception 'invalid engine'; end if;
  if engine<>'kie' and not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then
    raise exception 'local engines are admin only';
  end if;
  insert into public.projects(owner_id,topic,brief,style,vocal_gender,theme,song_settings)
    values(auth.uid(),topic,nullif(btrim(coalesce(p_lyrics,'')),''),nullif(btrim(coalesce(p_style,'')),''),p_vocal_gender,'vbp',p_settings)
    returning id into pid;
  for lang_code in select distinct unnest(p_languages) loop
    insert into public.versions(owner_id,project_id,lang) values(auth.uid(),pid,lang_code) returning id into vid;
    insert into public.jobs(owner_id,version_id,stage,idempotency_key)
      values(auth.uid(),vid,'draft_lyrics','draft_lyrics:'||vid||':1');
  end loop;
  return pid;
end; $$;
