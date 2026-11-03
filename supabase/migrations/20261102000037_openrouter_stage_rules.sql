-- Prices checked against OpenRouter on 2026-11-03. Existing model prices are in 030 and 035.
alter table public.spend_entries add column engine_claimed_at timestamptz;

-- Claim each open entry once. Row locks serialize two workers racing the same id.
create or replace function ops.spend_entries_authorize(p_entries uuid[], p_providers text[])
returns boolean language plpgsql volatile security definer
set search_path = '' set timezone = 'UTC' as $$
declare v_id uuid; v_provider text; v_claimed timestamptz; v_count integer := 0;
begin
  if coalesce(cardinality(p_entries),0)=0 or coalesce(cardinality(p_providers),0)=0
    or cardinality(p_entries)<>(select count(distinct id) from unnest(p_entries) as requested(id))
    then return false; end if;
  for v_id in select id from unnest(p_entries) as requested(id) order by id loop
    select e.provider,e.engine_claimed_at into v_provider,v_claimed
      from public.spend_entries e join public.reservations r on r.id=e.reservation_id
      where e.id=v_id and e.state='open' and r.state='open'
      for update of r,e;
    if not found or v_claimed is not null or not v_provider=any(p_providers) then return false; end if;
    v_count := v_count+1;
  end loop;
  if exists (select 1 from unnest(p_providers) as requested(provider)
    where not exists (select 1 from public.spend_entries e
      where e.id=any(p_entries) and e.provider=requested.provider)) then return false; end if;
  update public.spend_entries set engine_claimed_at=now() where id=any(p_entries);
  return v_count=cardinality(p_entries);
end;
$$;

insert into public.price_book (provider, model, unit, usd_per_unit, checked_on, source, verified) values
  ('openrouter','baai/bge-m3','mtok_in',0.01,'2026-11-03','https://openrouter.ai/baai/bge-m3/pricing',true),
  ('openrouter','baai/bge-m3','mtok_out',0,'2026-11-03','https://openrouter.ai/baai/bge-m3/pricing',true)
on conflict do nothing;

-- These are conservative stage estimates. Extra calls extend before they are sent.
insert into public.provider_operations (provider, operation, model, items, checked_on, source) values
  ('openrouter','lyrics_assist','typesafe/jev-1.14','{"mtok_in":0.026,"mtok_out":0.004}','2026-11-03','worker route and two jury rounds'),
  ('openrouter','lyrics_assist','anthropic/claude-opus-5.5','{"mtok_in":0.016,"mtok_out":0.008}','2026-11-03','two strong writer calls'),
  ('openrouter','lyrics_assist','anthropic/claude-sonnet-5.5','{"mtok_in":0.016,"mtok_out":0.008}','2026-11-03','two fast writer calls'),
  ('openrouter','lyrics_assist','anthropic/claude-haiku-5.5','{"mtok_in":0.016,"mtok_out":0.002}','2026-11-03','two jury rounds'),
  ('openrouter','lyrics_assist','google/gemini-3.8-flash','{"mtok_in":0.016,"mtok_out":0.002}','2026-11-03','two jury rounds'),
  ('openrouter','remake_analyse','anthropic/claude-haiku-5.5','{"mtok_in":0.024,"mtok_out":0.012}','2026-11-03','analysis and retry'),
  ('openrouter','remake_analyse','google/gemini-3.8-flash','{"mtok_in":0.016,"mtok_out":0.004}','2026-11-03','vision analysis'),
  ('openrouter','remake_rewrite','typesafe/jev-1.14','{"mtok_in":0.060,"mtok_out":0.006}','2026-11-03','jury decisions'),
  ('openrouter','remake_rewrite','anthropic/claude-haiku-5.5','{"mtok_in":0.080,"mtok_out":0.040}','2026-11-03','draft and line fixes'),
  ('openrouter','remake_rewrite','anthropic/claude-sonnet-5.5','{"mtok_in":0.040,"mtok_out":0.020}','2026-11-03','final pass and devil'),
  ('openrouter','remake_rewrite','google/gemini-3.8-flash','{"mtok_in":0.040,"mtok_out":0.010}','2026-11-03','jury decisions'),
  ('openrouter','remake_rewrite','baai/bge-m3','{"mtok_in":0.040,"mtok_out":0}','2026-11-03','optional embedding fallback')
on conflict do nothing;

create or replace function ops.job_spend_rule(p_job uuid)
returns table(provider text, model text, items jsonb)
language plpgsql stable security definer set search_path = '' set timezone = 'UTC' as $$
declare j public.jobs%rowtype; v public.versions%rowtype;
  settings jsonb; e public.section_edits%rowtype; op text;
begin
  select * into j from public.jobs where id=p_job;
  if not found then raise exception 'job not found'; end if;
  if j.fake_providers or (coalesce((select fake_stack from public.stack_settings where id),false)
    and current_setting('mdf.force_caps',true) is distinct from 'on') then return; end if;
  if j.stage in ('lyrics_assist','remake_analyse','remake_rewrite') then
    return query select p.provider,p.model,p.items from public.provider_operations p
      where p.provider='openrouter' and p.operation=j.stage order by p.model;
    if not found then raise exception 'price_missing' using errcode='MDF05'; end if;
    return;
  end if;
  select * into v from public.versions where id=j.version_id;
  select song_settings into settings from public.projects where id=v.project_id;
  if j.stage='draft_lyrics' then
    return query select p.provider,p.model,p.items from public.provider_operations p
      where p.provider='openrouter' and p.operation='draft_lyrics' order by p.model;
    if not found then raise exception 'price_missing' using errcode='MDF05'; end if;
  elsif j.stage='generate_song' then
    if coalesce(settings->>'engine','kie')='kie'
      and not (v.kie_task_id is not null and v.kie_generation=v.generation_count) then
      op := case when settings->'source'->>'mode' in ('cover','reference') then 'cover'
        when settings->'source'->>'mode'='extend' then 'extend' else 'generate' end;
      return query select p.provider,p.model,p.items from public.provider_operations p
        where p.provider='kie' and p.operation=op;
      if not found then raise exception 'price_missing' using errcode='MDF05'; end if;
    end if;
    return query select p.provider,p.model,
      (select jsonb_object_agg(x.key,x.value::numeric*2) from jsonb_each_text(p.items) x)
      from public.provider_operations p where p.provider='groq' and p.operation='take';
    if not found then raise exception 'price_missing' using errcode='MDF05'; end if;
  elsif j.stage='replace_section' then
    select * into e from public.section_edits where id=(j.payload->>'edit_id')::uuid
      and owner_id=j.owner_id and version_id=j.version_id;
    if not found then raise exception 'section edit not found'; end if;
    if e.engine='kie' and e.kie_task_id is null then
      return query select p.provider,p.model,p.items from public.provider_operations p
        where p.provider='kie' and p.operation='replace';
      if not found then raise exception 'price_missing' using errcode='MDF05'; end if;
    end if;
  elsif j.stage in ('import_audio','timing') then
    return query select p.provider,p.model,p.items from public.provider_operations p
      where p.provider='groq' and p.operation='take';
    if not found then raise exception 'price_missing' using errcode='MDF05'; end if;
  end if;
end;
$$;
