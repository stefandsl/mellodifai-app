do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mdf_web') then
    create role mdf_web nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'mdf_auth') then
    create role mdf_auth nologin noinherit;
  end if;
end;
$$;

create schema if not exists ops authorization postgres;
-- Only new objects/defaults are restricted here. Existing app grants wait for ops_lockdown.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema ops revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema ops revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema ops revoke all on sequences from anon, authenticated, service_role;
revoke all on schema ops from public;
grant usage on schema ops to mdf_web, mdf_auth, service_role;

-- The core audit/actor contracts need this table before Task 15's token operations.
create table public.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('pat','oauth','autopilot')),
  name text not null check (length(name) between 1 and 60),
  token_hash text unique, token_hint text,
  oauth_client_id text, grant_id text unique,
  scopes text[] not null check (scopes <@ array['read','create','spend','publish']),
  remote boolean not null default false,
  test_mode boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(), last_used_at timestamptz, revoked_at timestamptz,
  check ((kind = 'pat') = (token_hash is not null)),
  check ((kind = 'oauth') = (oauth_client_id is not null)),
  check (not remote or expires_at is not null)
);
alter table public.agent_tokens enable row level security;
revoke all on public.agent_tokens from anon, authenticated;
create unique index agent_tokens_one_grant on public.agent_tokens (owner_id, oauth_client_id)
  where kind = 'oauth' and revoked_at is null;
create policy "owners read tokens" on public.agent_tokens for select to authenticated
  using (owner_id = (select auth.uid()));
grant select (id, owner_id, kind, name, token_hint, oauth_client_id, scopes, remote, test_mode,
  expires_at, created_at, last_used_at, revoked_at) on public.agent_tokens to authenticated;

create table public.stack_settings (
  id boolean primary key default true check (id), fake_stack boolean not null default false
);
alter table public.stack_settings enable row level security;
revoke all on public.stack_settings from public, anon, authenticated, service_role, mdf_web, mdf_auth;
insert into public.stack_settings (id) values (true);

create table public.idempotency_keys (
  actor_key text not null, key text not null check (length(key) between 8 and 100),
  request_hash text not null, state text not null check (state in ('in_flight','done')),
  response jsonb, created_at timestamptz not null default now(),
  primary key (actor_key, key)
);
comment on column public.idempotency_keys.actor_key is '<actor_kind>:<user id or token id>';
alter table public.idempotency_keys enable row level security;
revoke all on public.idempotency_keys from anon, authenticated;

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  owner_id uuid references public.profiles(id) on delete cascade,
  actor_kind text not null check (actor_kind in ('session','pat','oauth','worker','unknown')),
  token_id uuid references public.agent_tokens(id) on delete set null,
  operation text not null, args_hash text not null,
  result text not null check (result in ('ok','error')), error_code text,
  remote boolean not null default false
);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
create index on public.audit_log (owner_id, at desc);
create policy "owners read audit" on public.audit_log for select to authenticated
  using (owner_id = (select auth.uid()));
grant select on public.audit_log to authenticated;

create table public.app_flags (
  flag text primary key check (flag in ('remote_mcp','autopilot','auto_publish_public','loop_merge','premium')),
  enabled boolean not null default false, changed_by uuid, changed_at timestamptz
);
alter table public.app_flags enable row level security;
revoke all on public.app_flags from anon, authenticated;
create policy "flags readable" on public.app_flags for select to authenticated using (true);
grant select on public.app_flags to authenticated;
insert into public.app_flags (flag) values
  ('remote_mcp'), ('autopilot'), ('auto_publish_public'), ('loop_merge'), ('premium');

create table public.scheduled_tasks (
  name text primary key, interval_s integer, daily_at time,
  next_run_at timestamptz not null, running_by text, started_at timestamptz,
  last_ok_at timestamptz, last_error text,
  check ((interval_s is null) <> (daily_at is null))
);
alter table public.scheduled_tasks enable row level security;
revoke all on public.scheduled_tasks from anon, authenticated;

create table public.ops_health (id boolean primary key default true check (id), at timestamptz);
alter table public.ops_health enable row level security;
revoke all on public.ops_health from anon, authenticated;
alter table public.versions add column test_run boolean not null default false;

create function ops._enter() returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform set_config('mdf.job_ids', '', true);
  perform set_config('mdf.job_ctx', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
alter function ops._enter() owner to postgres;
revoke execute on function ops._enter() from public, anon, authenticated;
grant execute on function ops._enter() to service_role;

create function ops._fake_stack() returns boolean
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform ops._enter();
  return coalesce((select fake_stack from public.stack_settings where id), false)
    and current_setting('mdf.force_caps', true) is distinct from 'on';
end;
$$;
alter function ops._fake_stack() owner to postgres;
revoke execute on function ops._fake_stack() from public, anon, authenticated;
grant execute on function ops._fake_stack() to service_role;

create function ops._actor(p_ctx jsonb,
  out user_id uuid, out role text, out actor_kind text, out token_id uuid,
  out scopes text[], out test_mode boolean, out remote boolean) returns record
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_token public.agent_tokens%rowtype;
begin
  perform ops._enter();
  actor_kind := p_ctx->>'actor_kind';
  remote := coalesce((p_ctx->>'remote')::boolean, false);
  test_mode := false;
  if actor_kind = 'session' then
    select s.user_id into user_id from auth.sessions s
      where s.id = (p_ctx->>'session_id')::uuid and s.user_id = (p_ctx->>'user_id')::uuid
      and (s.not_after is null or s.not_after > now())
      and coalesce(s.refreshed_at, s.created_at) >= now() - interval '65 minutes';
    if user_id is null then raise exception 'authentication required'; end if;
    scopes := array['read','create','spend','publish'];
  elsif actor_kind = 'pat' then
    select t.* into v_token from public.agent_tokens t
      where t.kind = 'pat' and t.token_hash = p_ctx->>'token_hash'
      and t.revoked_at is null and (t.expires_at is null or t.expires_at > now());
    if not found then raise exception 'authentication required'; end if;
    if remote and not v_token.remote then
      raise exception 'remote access refused' using errcode = '42501';
    end if;
    user_id := v_token.owner_id;
    token_id := v_token.id;
    scopes := v_token.scopes;
    test_mode := v_token.test_mode;
  else
    -- shortcut: OAuth fails closed until Task 15 installs its store and resolver.
    raise exception 'authentication required';
  end if;
  select p.role into role from public.profiles p where p.id = user_id;
  if role is null then raise exception 'profile required'; end if;
exception when invalid_text_representation then
  raise exception 'authentication required';
end;
$$;
alter function ops._actor(jsonb) owner to postgres;
revoke execute on function ops._actor(jsonb) from public, anon, authenticated;
grant execute on function ops._actor(jsonb) to service_role;

create function ops.map_error(sqlstate text, message text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_code text;
  v_reason text;
begin
  perform ops._enter();
  case sqlstate
    when 'MDF01' then v_code := 'validation'; v_reason := 'idempotency_key_required';
    when 'MDF02' then v_code := 'cap_exceeded'; v_reason := 'cap';
    when 'MDF03' then v_code := 'unauthorized'; v_reason := case when message like '%consent%' then 'consent' else 'claim' end;
    when 'MDF04' then v_code := 'forbidden_scope'; v_reason := 'test_rule';
    when 'MDF05' then v_code := 'internal'; v_reason := 'price_missing';
    when 'MDF06' then v_code := 'cap_exceeded'; v_reason := 'no_cap';
    when 'MDF07' then v_code := 'cap_exceeded'; v_reason := 'entry_beyond_reservation';
    else
      v_code := case
        when sqlstate like 'MDF%' then 'internal'
        when message in ('authentication required','profile required') then 'unauthorized'
        when message in ('admin required','local engines are admin only','remote access refused') then 'forbidden_scope'
        when message like 'owned % required' or message like '% not found'
          or message in ('render missing','source take required','failed job required') then 'not_found'
        when message like 'kie submission state unknown%' or message like 'kie task may still succeed%'
          or message = 'resolve unknown submission first' then 'ambiguous_spend'
        when message like 'invalid %' or message like '%too long' or message like 'too many %'
          or message like '% must %' or message like 'a part is %'
          or message in ('range outside the take','an upload or a take, not both','title required',
            'language required','metadata required','prompt or title required','task id required',
            'video id required','override reason required','lyrics of the part required',
            'publish_at requires scheduled privacy','uploaded audio required','current take required') then 'validation'
        when message like '%required' or message like '% already %'
          or message in ('transition not allowed','version not approved','rewrite discarded',
            'song not ready for a rewrite','the song has new takes since this rewrite',
            'this engine cannot start from audio in this way') then 'conflict'
        else 'internal'
      end;
  end case;
  return jsonb_build_object('code', v_code, 'reason', v_reason);
end;
$$;
alter function ops.map_error(text, text) owner to postgres;
revoke execute on function ops.map_error(text, text) from public, anon, authenticated;
grant execute on function ops.map_error(text, text) to service_role;

create function ops.idem_begin(p_ctx jsonb, key text, request_hash text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_actor record;
  v_actor_key text;
  v_row public.idempotency_keys%rowtype;
  v_error jsonb;
begin
  perform ops._enter();
  select null::uuid as user_id, null::text as actor_kind, null::uuid as token_id, false as remote into v_actor;
  begin
    select * into v_actor from ops._actor(p_ctx);
    v_actor_key := v_actor.actor_kind || ':' || coalesce(v_actor.token_id, v_actor.user_id)::text;
    if key is null or key = '' then
      raise exception 'idempotency key required' using errcode = 'MDF01';
    end if;
    if length(key) not between 8 and 100 or request_hash is null or request_hash = '' then
      raise exception 'invalid idempotency input';
    end if;
    insert into public.idempotency_keys (actor_key, key, request_hash, state)
      values (v_actor_key, idem_begin.key, idem_begin.request_hash, 'in_flight')
      on conflict do nothing;
    if found then return jsonb_build_object('ok', true, 'data', jsonb_build_object('status', 'new')); end if;
    select i.* into v_row from public.idempotency_keys i
      where i.actor_key = v_actor_key and i.key = idem_begin.key for update;
    if v_row.request_hash <> request_hash then
      return jsonb_build_object('ok', false, 'code', 'idempotency_mismatch', 'message', 'Idempotency key used for another request');
    elsif v_row.state = 'done' then
      return jsonb_build_object('ok', true, 'data', jsonb_build_object('status', 'replay', 'response', v_row.response));
    elsif v_row.created_at <= now() - interval '10 minutes' then
      update public.idempotency_keys i set created_at = now()
        where i.actor_key = v_actor_key and i.key = idem_begin.key;
      return jsonb_build_object('ok', true, 'data', jsonb_build_object('status', 'new'));
    end if;
    return jsonb_build_object('ok', false, 'code', 'in_progress', 'message', 'Request in progress', 'retry_after', 2);
  exception when others then
    v_error := ops.map_error(SQLSTATE, SQLERRM);
    delete from public.idempotency_keys i where i.actor_key = v_actor_key and i.key = idem_begin.key
      and i.request_hash = idem_begin.request_hash and i.state = 'in_flight';
    insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, error_code, remote)
      values (v_actor.user_id, coalesce(v_actor.actor_kind, 'unknown'), v_actor.token_id,
        'idem_begin', coalesce(request_hash, ''), 'error', v_error->>'code', coalesce(v_actor.remote, false));
    return jsonb_build_object('ok', false, 'code', v_error->>'code',
      'message', case when v_error->>'code' = 'internal' then 'Internal error' else SQLERRM end,
      'details', jsonb_build_object('reason', v_error->'reason'));
  end;
end;
$$;
alter function ops.idem_begin(jsonb, text, text) owner to postgres;
revoke execute on function ops.idem_begin(jsonb, text, text) from public, anon, authenticated;
grant execute on function ops.idem_begin(jsonb, text, text) to mdf_web;

create function ops.health() returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_at timestamptz;
  v_schema text;
  v_age numeric;
  v_queue bigint;
begin
  perform ops._enter();
  insert into public.ops_health (id, at) values (true, clock_timestamp())
    on conflict (id) do update set at = excluded.at;
  select at into strict v_at from public.ops_health where id;
  select max(version) into v_schema from supabase_migrations.schema_migrations;
  select greatest(0, floor(extract(epoch from (now() - max(last_seen))))) into v_age from public.workers;
  if not exists (select 1 from public.workers where last_seen is not null) then v_age := null; end if;
  select count(*) into v_queue from public.jobs where status = 'queued';
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'db', 'ok', 'ops', 'ok', 'at', v_at, 'schema', v_schema,
    'worker_heartbeat_age_s', v_age, 'queue_depth', v_queue));
end;
$$;
alter function ops.health() owner to postgres;
revoke execute on function ops.health() from public, anon, authenticated;
grant execute on function ops.health() to mdf_web;

create function ops.flags() returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform ops._enter();
  return jsonb_build_object('ok', true, 'data', (select jsonb_object_agg(flag, enabled) from public.app_flags));
end;
$$;
alter function ops.flags() owner to postgres;
revoke execute on function ops.flags() from public, anon, authenticated;
grant execute on function ops.flags() to mdf_web;
