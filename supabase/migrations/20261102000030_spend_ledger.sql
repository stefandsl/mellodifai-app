-- Task 15 already owns spend_caps; this migration seeds it.
create table public.price_book (
  provider text not null, model text not null default '',
  unit text not null check (unit in ('credit','image','mtok_in','mtok_out','audio_hour','call')),
  usd_per_unit numeric(12,6) not null, checked_on date not null, source text not null,
  verified boolean not null default false,
  primary key (provider, model, unit)
);
create policy "prices readable" on public.price_book for select to authenticated using (true);

create table public.provider_operations (
  provider text not null, operation text not null, model text not null default '',
  items jsonb not null, verified boolean not null default false,
  checked_on date not null, source text not null,
  primary key (provider, operation, model)
);                                                                      -- no grants


create table public.spend_counters (
  scope text not null, key text not null, provider text not null, unit text not null,
  period text not null, window_start date not null,          -- Europe/Rome; '1970-01-01' for run
  used numeric(14,4) not null default 0,
  primary key (scope, key, provider, unit, period, window_start)
);                                                                      -- no grants

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid unique references public.jobs(id) on delete set null,
  job_gone boolean not null default false,       -- set by the before-delete trigger on jobs
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_id uuid references public.agent_tokens(id) on delete set null,
  run_id uuid, version_id uuid,
  estimate jsonb not null,                        -- [{provider, model, items, usd}]
  charges jsonb not null default '[]',            -- [{scope,key,provider,unit,period,window_start,amount}]
  state text not null default 'open' check (state in ('open','ambiguous','closed')),
  -- revision 6 (round-5 Major 6): what the close rule's kie steps may act on
  kie_submit_reserved boolean not null default false,
  kie_generation integer, section_edit_id uuid,
  created_at timestamptz not null default now(), closed_at timestamptz
);
create index on public.reservations (state) where state <> 'closed';
create index on public.reservations (user_id, created_at desc);         -- read own

create table public.spend_entries (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  call_key text not null, provider text not null, model text not null default '',
  items_est jsonb not null, usd_est numeric(10,4) not null,
  items jsonb, usd numeric(10,4),
  state text not null default 'open' check (state in ('open','settled')),
  over_estimate boolean not null default false,   -- revision 6 (round-5 Major 8): actual > 3x estimate
  created_at timestamptz not null default now(), settled_at timestamptz,
  unique (reservation_id, call_key)
);
create index on public.spend_entries (provider, settled_at);           -- read through ops.costs_get

alter table public.jobs
  add column token_id uuid references public.agent_tokens(id) on delete set null,
  add column run_id uuid,
  add column resource_class text not null default 'cpu' check (resource_class in ('gpu','cpu','net')),
  add column priority smallint not null default 0,
  add column fake_providers boolean not null default false;

alter table public.price_book enable row level security;
alter table public.provider_operations enable row level security;
alter table public.spend_counters enable row level security;
alter table public.reservations enable row level security;
alter table public.spend_entries enable row level security;
revoke all on public.price_book, public.provider_operations, public.spend_counters,
  public.reservations, public.spend_entries from public, anon, authenticated, service_role, mdf_web, mdf_auth;
grant select on public.price_book, public.reservations to authenticated;
create policy "owners read reservations" on public.reservations for select to authenticated
  using (user_id = (select auth.uid()));

-- Public GET on 2026-11-03, no key or paid call. Jev is absent from /v1/models;
-- its official model page supplies its input-only price instead.
insert into public.price_book (provider,model,unit,usd_per_unit,checked_on,source,verified) values
  ('kie','','credit',0.005,'2026-11-03','packages/shared/src/rewrite.ts KIE_CREDITS; USD per credit awaits owner confirmation',false),
  ('groq','','audio_hour',0.1,'2026-11-03','design 11.5',true),
  ('openrouter','anthropic/claude-opus-5.5','mtok_in',4,'2026-11-03','https://openrouter.ai/api/v1/models',true),
  ('openrouter','anthropic/claude-opus-5.5','mtok_out',20,'2026-11-03','https://openrouter.ai/api/v1/models',true),
  ('openrouter','anthropic/claude-haiku-5.5','mtok_in',0.1,'2026-11-03','https://openrouter.ai/api/v1/models',true),
  ('openrouter','anthropic/claude-haiku-5.5','mtok_out',0.5,'2026-11-03','https://openrouter.ai/api/v1/models',true),
  ('openrouter','google/gemini-3.8-flash','mtok_in',0.825,'2026-11-03','https://openrouter.ai/api/v1/models',true),
  ('openrouter','google/gemini-3.8-flash','mtok_out',4.125,'2026-11-03','https://openrouter.ai/api/v1/models',true),
  ('openrouter','typesafe/jev-1.14','mtok_in',0.042,'2026-11-03','https://openrouter.ai/typesafe/jev-1.14/',true),
  ('openrouter','typesafe/jev-1.14','mtok_out',0,'2026-11-03','https://openrouter.ai/typesafe/jev-1.14/',true)
on conflict do nothing;

-- Per-language token estimates: router 2k in/256 out; five strong writers each
-- 8k in/4k out; three judges each 8k in/1k out. Jev combines router and judge.
insert into public.provider_operations (provider,operation,model,items,checked_on,source) values
  ('kie','generate','','{"credit":12}','2026-11-03','packages/shared/src/rewrite.ts KIE_CREDITS'),
  ('kie','replace','','{"credit":5}','2026-11-03','packages/shared/src/rewrite.ts KIE_CREDITS'),
  ('kie','cover','','{"credit":12}','2026-11-03','packages/shared/src/rewrite.ts KIE_CREDITS'),
  ('kie','extend','','{"credit":12}','2026-11-03','packages/shared/src/rewrite.ts KIE_CREDITS'),
  ('groq','take','','{"audio_hour":0.1}','2026-11-03','design 11.5: six minutes per take'),
  ('openrouter','draft_lyrics','typesafe/jev-1.14','{"mtok_in":0.010,"mtok_out":0.001256}','2026-11-03','design 11.5; worker lyric-jury.ts router and judge'),
  ('openrouter','draft_lyrics','anthropic/claude-opus-5.5','{"mtok_in":0.040,"mtok_out":0.020}','2026-11-03','design 11.5; five strong writers'),
  ('openrouter','draft_lyrics','anthropic/claude-haiku-5.5','{"mtok_in":0.008,"mtok_out":0.001}','2026-11-03','design 11.5; one judge'),
  ('openrouter','draft_lyrics','google/gemini-3.8-flash','{"mtok_in":0.008,"mtok_out":0.001}','2026-11-03','design 11.5; one judge')
on conflict do nothing;

-- Estimate = 0.572445 USD; 3x = 1.717335. Round up to the next 0.25: 1.75.
insert into public.spend_caps (scope,key,provider,unit,period,"limit") values
  ('global','','','usd','day',3), ('global','','','usd','month',40),
  ('global','','kie','credit','day',120),
  ('user','default:admin','','usd','day',3),
  ('user','default:customer','','usd','day',1.75),
  ('user','default:customer','kie','credit','day',0)
on conflict do nothing;

create function ops.price(p_provider text, p_model text, p_unit text) returns numeric
language plpgsql stable security definer set search_path = '' set timezone = 'UTC' as $$
declare v_price numeric;
begin
  select usd_per_unit into v_price from public.price_book
    where provider=p_provider and unit=p_unit and model in (p_model,'')
    order by (model=p_model) desc limit 1;
  if v_price is null or v_price < 0 then
    raise exception 'price_missing' using errcode='MDF05';
  end if;
  return v_price;
end;
$$;

create function ops._spend_window(p_period text, p_at timestamptz) returns date
language sql immutable security definer set search_path = '' set timezone = 'UTC' as $$
  select case p_period when 'run' then date '1970-01-01'
    when 'month' then date_trunc('month',p_at at time zone 'Europe/Rome')::date
    else (p_at at time zone 'Europe/Rome')::date end;
$$;

create function ops.job_spend_rule(p_job uuid)
returns table(provider text, model text, items jsonb)
language plpgsql stable security definer set search_path = '' set timezone = 'UTC' as $$
declare j public.jobs%rowtype; v public.versions%rowtype;
  settings jsonb; e public.section_edits%rowtype; op text;
begin
  select * into j from public.jobs where id=p_job;
  if not found then raise exception 'job not found'; end if;
  if j.fake_providers or (coalesce((select fake_stack from public.stack_settings where id),false)
    and current_setting('mdf.force_caps',true) is distinct from 'on') then return; end if;
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

-- Shared by reserve and extend so pricing, fallback and lock order cannot diverge.
create function ops._charge_spend(p_user uuid,p_token uuid,p_run uuid,p_estimate jsonb)
returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare caps jsonb; charges jsonb := '[]'; c record; e jsonb;
  role_name text; amount numeric; used_amount numeric;
begin
  select role into role_name from public.profiles where id=p_user;
  select coalesce(jsonb_agg(to_jsonb(selected_cap)), '[]') into caps from (
    select scope,key,provider,unit,period,"limit" from public.spend_caps
      where (scope='global' and key='') or (scope='token' and key=p_token::text)
        or (scope='run' and key=p_run::text)
    union all
    select scope,p_user::text,provider,unit,period,"limit" from (
      select distinct on (provider,unit,period) * from public.spend_caps
      where scope='user' and key in (p_user::text,'default:'||role_name)
      order by provider,unit,period,(key=p_user::text) desc
    ) u
  ) selected_cap;
  for e in select value from jsonb_array_elements(p_estimate) loop
    if not exists (select 1 from jsonb_to_recordset(caps) as c(scope text,provider text,unit text,period text)
      where scope='global' and unit='usd' and period='day' and provider in ('',e->>'provider'))
      or not exists (select 1 from jsonb_to_recordset(caps) as c(scope text,provider text,unit text,period text)
      where scope='user' and unit='usd' and period='day' and provider in ('',e->>'provider'))
      or (p_token is not null and not exists (
        select 1 from jsonb_to_recordset(caps) as c(scope text,provider text,unit text,period text)
        where scope='token' and unit='usd' and period='day' and provider in ('',e->>'provider'))) then
      raise exception 'no_cap' using errcode='MDF06';
    end if;
  end loop;
  for c in select *,ops._spend_window(period,now()) as window_start
    from jsonb_to_recordset(caps) as c(scope text,key text,provider text,unit text,period text,"limit" numeric)
    order by scope,key,provider,unit,period,window_start loop
    amount := 0;
    for e in select value from jsonb_array_elements(p_estimate) loop
      if c.provider in ('',e->>'provider') then
        amount := amount + case when c.unit='usd' then (e->>'usd')::numeric
          else coalesce((e->'items'->>c.unit)::numeric,0) end;
      end if;
    end loop;
    -- Never round a positive charge down to zero at the counter's four-decimal precision.
    amount := ceil(amount*10000)/10000;
    if amount=0 then continue; end if;
    charges := charges || jsonb_build_array(jsonb_build_object('scope',c.scope,'key',c.key,
      'provider',c.provider,'unit',c.unit,'period',c.period,'window_start',c.window_start,
      'amount',amount,'limit',c."limit"));
  end loop;
  for c in select * from jsonb_to_recordset(charges)
    as c(scope text,key text,provider text,unit text,period text,window_start date,amount numeric,"limit" numeric)
    order by scope,key,provider,unit,period,window_start loop
    insert into public.spend_counters (scope,key,provider,unit,period,window_start)
      values(c.scope,c.key,c.provider,c.unit,c.period,c.window_start) on conflict do nothing;
  end loop;
  for c in select * from jsonb_to_recordset(charges)
    as c(scope text,key text,provider text,unit text,period text,window_start date,amount numeric,"limit" numeric)
    order by scope,key,provider,unit,period,window_start loop
    select used into used_amount from public.spend_counters
      where (scope,key,provider,unit,period,window_start)=(c.scope,c.key,c.provider,c.unit,c.period,c.window_start)
      for update;
    if used_amount+c.amount>c."limit" then
      raise exception 'cap_exceeded:%:%:%:%',c.scope,c.provider,c.unit,c.period using errcode='MDF02';
    end if;
    update public.spend_counters set used=used+c.amount
      where (scope,key,provider,unit,period,window_start)=(c.scope,c.key,c.provider,c.unit,c.period,c.window_start);
  end loop;
  return (select coalesce(jsonb_agg(value-'limit'),'[]') from jsonb_array_elements(charges));
end;
$$;

create function ops._price_items(p_provider text,p_model text,p_items jsonb) returns numeric
language plpgsql stable security definer set search_path = '' set timezone = 'UTC' as $$
declare i record; total numeric := 0;
begin
  if p_items is null or jsonb_typeof(p_items)<>'object' or p_items='{}'::jsonb then
    raise exception 'invalid spend items';
  end if;
  for i in select key,value from jsonb_each(p_items) loop
    if jsonb_typeof(i.value)<>'number' or i.value::numeric<0 then raise exception 'invalid spend items'; end if;
    total := total + i.value::numeric * ops.price(p_provider,p_model,i.key);
  end loop;
  return ceil(total*10000)/10000;
end;
$$;

create function ops.reserve_job(p_job uuid) returns uuid
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare j public.jobs%rowtype; r public.reservations%rowtype; rule record;
  estimate jsonb := '[]'; charges jsonb; usd numeric; generation integer; kie boolean := false;
begin
  select * into j from public.jobs where id=p_job for update;
  if not found then raise exception 'job not found'; end if;
  select * into r from public.reservations where job_id=p_job;
  if found then
    if r.state<>'open' then raise exception 'reservation already closed or ambiguous'; end if;
    return r.id;
  end if;
  for rule in select * from ops.job_spend_rule(p_job) loop
    usd := ops._price_items(rule.provider,rule.model,rule.items);
    estimate := estimate || jsonb_build_array(jsonb_build_object('provider',rule.provider,
      'model',rule.model,'items',rule.items,'usd',usd));
    kie := kie or rule.provider='kie';
  end loop;
  if estimate='[]'::jsonb then return null; end if;
  charges := ops._charge_spend(j.owner_id,j.token_id,j.run_id,estimate);
  select generation_count into generation from public.versions where id=j.version_id;
  insert into public.reservations (job_id,user_id,token_id,run_id,version_id,estimate,charges,
    kie_submit_reserved,kie_generation,section_edit_id)
    values(j.id,j.owner_id,j.token_id,j.run_id,j.version_id,estimate,charges,kie,
      case when kie and j.stage='generate_song' then generation end,
      case when j.stage='replace_section' then (j.payload->>'edit_id')::uuid end)
    returning id into r.id;
  return r.id;
end;
$$;

create function ops.extend_reservation(p_reservation uuid,p_provider text,p_model text,p_items jsonb)
returns void language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare r public.reservations%rowtype; v_estimate jsonb; v_charges jsonb;
begin
  select * into r from public.reservations where id=p_reservation for update;
  if not found then raise exception 'reservation not found'; end if;
  if r.state<>'open' then raise exception 'reservation already closed or ambiguous'; end if;
  v_estimate := jsonb_build_array(jsonb_build_object('provider',p_provider,'model',p_model,
    'items',p_items,'usd',ops._price_items(p_provider,p_model,p_items)));
  v_charges := ops._charge_spend(r.user_id,r.token_id,r.run_id,v_estimate);
  update public.reservations set estimate=reservations.estimate||v_estimate,
    charges=reservations.charges||v_charges where id=p_reservation;
end;
$$;

create function ops.jobs_set_resource_class() returns trigger
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  -- Keep in sync with STAGE_RESOURCE_CLASS; database tests compare every stage.
  new.resource_class := case
    when new.stage in ('render_master','render_hook','stems','visualizer') then 'gpu'
    when new.stage in ('draft_lyrics','generate_song','timing','publish','set_privacy',
      'replace_section','import_audio','remake_ingest','remake_analyse','remake_rewrite','lyrics_assist') then 'net'
    else 'cpu' end;
  if new.stage='generate_song' and exists (select 1 from public.versions v
    join public.projects p on p.id=v.project_id where v.id=new.version_id
    and p.song_settings->>'engine' in ('ace-step','yue2')) then new.resource_class := 'gpu'; end if;
  if new.stage='replace_section' and exists (select 1 from public.section_edits
    where id=(new.payload->>'edit_id')::uuid and engine='ace-step') then new.resource_class := 'gpu'; end if;
  return new;
end;
$$;
create trigger jobs_set_resource_class before insert on public.jobs
  for each row execute function ops.jobs_set_resource_class();

create function ops.jobs_mark_reservation_gone() returns trigger
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  update public.reservations set job_gone=true where job_id=old.id;
  return old;
end;
$$;
create trigger jobs_mark_reservation_gone before delete on public.jobs
  for each row execute function ops.jobs_mark_reservation_gone();

alter function ops.price(text,text,text) owner to postgres;
revoke execute on function ops.price(text,text,text) from public,anon,authenticated;
grant execute on function ops.price(text,text,text) to service_role;
alter function ops._spend_window(text,timestamptz) owner to postgres;
revoke execute on function ops._spend_window(text,timestamptz) from public,anon,authenticated;
grant execute on function ops._spend_window(text,timestamptz) to service_role;
alter function ops.job_spend_rule(uuid) owner to postgres;
revoke execute on function ops.job_spend_rule(uuid) from public,anon,authenticated;
grant execute on function ops.job_spend_rule(uuid) to service_role;
alter function ops._charge_spend(uuid,uuid,uuid,jsonb) owner to postgres;
revoke execute on function ops._charge_spend(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function ops._charge_spend(uuid,uuid,uuid,jsonb) to service_role;
alter function ops._price_items(text,text,jsonb) owner to postgres;
revoke execute on function ops._price_items(text,text,jsonb) from public,anon,authenticated;
grant execute on function ops._price_items(text,text,jsonb) to service_role;
alter function ops.reserve_job(uuid) owner to postgres;
revoke execute on function ops.reserve_job(uuid) from public,anon,authenticated;
grant execute on function ops.reserve_job(uuid) to service_role;
alter function ops.extend_reservation(uuid,text,text,jsonb) owner to postgres;
revoke execute on function ops.extend_reservation(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function ops.extend_reservation(uuid,text,text,jsonb) to service_role;
alter function ops.jobs_set_resource_class() owner to postgres;
revoke execute on function ops.jobs_set_resource_class() from public,anon,authenticated;
grant execute on function ops.jobs_set_resource_class() to service_role;
alter function ops.jobs_mark_reservation_gone() owner to postgres;
revoke execute on function ops.jobs_mark_reservation_gone() from public,anon,authenticated;
grant execute on function ops.jobs_mark_reservation_gone() to service_role;
