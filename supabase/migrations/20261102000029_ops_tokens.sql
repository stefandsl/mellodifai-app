-- Token caps precede the ledger implementation (preflight ruling 3).
create table public.spend_caps (
  scope text not null check (scope in ('global','user','token','run')),
  key text not null default '', provider text not null default '',
  unit text not null default 'usd',
  period text not null check (period in ('day','month','run')),
  "limit" numeric(12,4) not null check ("limit" >= 0),
  primary key (scope, key, provider, unit, period),
  check (unit = 'usd' or provider <> ''),
  check ((scope = 'run') = (period = 'run'))
);
create table public.oauth_store (
  model text not null, id_hash text not null, payload jsonb not null,
  grant_id text, uid text, user_code text, flow_nonce_hash text,
  expires_at timestamptz, consumed_at timestamptz,
  primary key (model, id_hash)
);
create index on public.oauth_store (grant_id);
create index on public.oauth_store (uid);
create unique index oauth_interaction_uid on public.oauth_store (uid) where model = 'Interaction';
create index on public.oauth_store (expires_at);
create table public.oauth_consents (
  uid text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_id text not null, scopes text[] not null, test_mode boolean not null default false,
  flow_nonce_hash text not null, used_at timestamptz,
  token_id uuid references public.agent_tokens(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.oauth_pairing (
  id boolean primary key default true check (id), open_until timestamptz,
  client_id text, client_name text, redirect_host text, registered_at timestamptz,
  loopback_only boolean
);
insert into public.oauth_pairing (id) values (true);
alter table public.spend_caps enable row level security;
revoke all on public.spend_caps from public, anon, authenticated, service_role, mdf_web, mdf_auth;
alter table public.oauth_store enable row level security;
revoke all on public.oauth_store from public, anon, authenticated, service_role, mdf_web, mdf_auth;
alter table public.oauth_consents enable row level security;
revoke all on public.oauth_consents from public, anon, authenticated, service_role, mdf_web, mdf_auth;
alter table public.oauth_pairing enable row level security;
revoke all on public.oauth_pairing from public, anon, authenticated, service_role, mdf_web, mdf_auth;

create function ops.admin_token_create(p_ctx jsonb, name text, token_hash text, token_hint text, scopes text[], remote boolean, test_mode boolean, expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_actor record;
  v_data jsonb;
  v_error jsonb;
  v_id uuid;
begin
  perform ops._enter();
  select null::uuid as user_id, null::text as actor_kind, null::uuid as token_id, false as remote into v_actor;
  begin
    select * into v_actor from ops._actor(p_ctx);
    if v_actor.actor_kind <> 'session' or v_actor.role <> 'admin' then
      raise exception 'admin required' using errcode = '42501';
    end if;
    if v_actor.remote then raise exception 'remote access refused' using errcode = '42501'; end if;
    if name is null or length(btrim(name)) not between 1 and 60
      or token_hash is null or token_hash !~ '^[0-9a-f]{64}$'
      or token_hint is null or length(token_hint) > 32
      or scopes is null or cardinality(scopes) = 0 or array_position(scopes, null) is not null
      or not scopes <@ array['read','create','spend']
      or remote is null or test_mode is null
      or (remote and expires_at is null) or expires_at <= now() then
      raise exception 'invalid token input';
    end if;
    insert into public.agent_tokens (owner_id, kind, name, token_hash, token_hint, scopes, remote, test_mode, expires_at)
      values (v_actor.user_id, 'pat', name, token_hash, token_hint, scopes, remote, test_mode, expires_at)
      returning id into v_id;
    insert into public.spend_caps (scope, key, period, "limit") values ('token', v_id::text, 'day', 1);
    v_data := jsonb_build_object('id', v_id);
  exception when others then
    v_error := ops.map_error(SQLSTATE, SQLERRM);
    insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, error_code, remote)
      values (v_actor.user_id, coalesce(v_actor.actor_kind, 'unknown'), v_actor.token_id,
        'admin_token_create', coalesce(p_ctx->>'request_hash', ''), 'error', v_error->>'code', coalesce(v_actor.remote, false));
    return jsonb_build_object('ok', false, 'code', v_error->>'code',
      'message', case when v_error->>'code' = 'internal' then 'Internal error' else SQLERRM end,
      'details', jsonb_build_object('reason', v_error->'reason'));
  end;
  insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, remote)
    values (v_actor.user_id, v_actor.actor_kind, v_actor.token_id, 'admin_token_create',
      coalesce(p_ctx->>'request_hash', ''), 'ok', v_actor.remote);
  perform ops._enter();
  return jsonb_build_object('ok', true, 'data', v_data);
end;
$$;
alter function ops.admin_token_create(jsonb, text, text, text, text[], boolean, boolean, timestamptz) owner to postgres;
revoke execute on function ops.admin_token_create(jsonb, text, text, text, text[], boolean, boolean, timestamptz) from public, anon, authenticated;
grant execute on function ops.admin_token_create(jsonb, text, text, text, text[], boolean, boolean, timestamptz) to mdf_web;

create function ops.admin_tokens_list(p_ctx jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_actor record;
  v_data jsonb;
  v_error jsonb;

begin
  perform ops._enter();
  select null::uuid as user_id, null::text as actor_kind, null::uuid as token_id, false as remote into v_actor;
  begin
    select * into v_actor from ops._actor(p_ctx);
    if v_actor.actor_kind <> 'session' or v_actor.role <> 'admin' then
      raise exception 'admin required' using errcode = '42501';
    end if;
    if v_actor.remote then raise exception 'remote access refused' using errcode = '42501'; end if;
    select coalesce(jsonb_agg(to_jsonb(t) - 'token_hash' - 'grant_id' order by t.created_at desc), '[]'::jsonb)
      into v_data from public.agent_tokens t where t.owner_id = v_actor.user_id;
  exception when others then
    v_error := ops.map_error(SQLSTATE, SQLERRM);
    insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, error_code, remote)
      values (v_actor.user_id, coalesce(v_actor.actor_kind, 'unknown'), v_actor.token_id,
        'admin_tokens_list', coalesce(p_ctx->>'request_hash', ''), 'error', v_error->>'code', coalesce(v_actor.remote, false));
    return jsonb_build_object('ok', false, 'code', v_error->>'code',
      'message', case when v_error->>'code' = 'internal' then 'Internal error' else SQLERRM end,
      'details', jsonb_build_object('reason', v_error->'reason'));
  end;
  insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, remote)
    values (v_actor.user_id, v_actor.actor_kind, v_actor.token_id, 'admin_tokens_list',
      coalesce(p_ctx->>'request_hash', ''), 'ok', v_actor.remote);
  perform ops._enter();
  return jsonb_build_object('ok', true, 'data', v_data);
end;
$$;
alter function ops.admin_tokens_list(jsonb) owner to postgres;
revoke execute on function ops.admin_tokens_list(jsonb) from public, anon, authenticated;
grant execute on function ops.admin_tokens_list(jsonb) to mdf_web;

create function ops.admin_token_revoke(p_ctx jsonb, token_id uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_actor record;
  v_data jsonb;
  v_error jsonb;
  v_grant text;
begin
  perform ops._enter();
  select null::uuid as user_id, null::text as actor_kind, null::uuid as token_id, false as remote into v_actor;
  begin
    select * into v_actor from ops._actor(p_ctx);
    if v_actor.actor_kind <> 'session' or v_actor.role <> 'admin' then
      raise exception 'admin required' using errcode = '42501';
    end if;
    if v_actor.remote then raise exception 'remote access refused' using errcode = '42501'; end if;
    update public.agent_tokens t set revoked_at = coalesce(t.revoked_at, now())
      where t.id = token_id and t.owner_id = v_actor.user_id returning t.grant_id into v_grant;
    if not found then raise exception 'token not found'; end if;
    delete from public.oauth_store s where s.grant_id = v_grant
      or (s.model = 'Grant' and s.id_hash = encode(sha256(convert_to(v_grant, 'UTF8')), 'hex'));
    v_data := jsonb_build_object('id', token_id);
  exception when others then
    v_error := ops.map_error(SQLSTATE, SQLERRM);
    insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, error_code, remote)
      values (v_actor.user_id, coalesce(v_actor.actor_kind, 'unknown'), v_actor.token_id,
        'admin_token_revoke', coalesce(p_ctx->>'request_hash', ''), 'error', v_error->>'code', coalesce(v_actor.remote, false));
    return jsonb_build_object('ok', false, 'code', v_error->>'code',
      'message', case when v_error->>'code' = 'internal' then 'Internal error' else SQLERRM end,
      'details', jsonb_build_object('reason', v_error->'reason'));
  end;
  insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, remote)
    values (v_actor.user_id, v_actor.actor_kind, v_actor.token_id, 'admin_token_revoke',
      coalesce(p_ctx->>'request_hash', ''), 'ok', v_actor.remote);
  perform ops._enter();
  return jsonb_build_object('ok', true, 'data', v_data);
end;
$$;
alter function ops.admin_token_revoke(jsonb, uuid) owner to postgres;
revoke execute on function ops.admin_token_revoke(jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.admin_token_revoke(jsonb, uuid) to mdf_web;

create function ops.admin_flag_set(p_ctx jsonb, flag text, enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_actor record;
  v_data jsonb;
  v_error jsonb;

begin
  perform ops._enter();
  select null::uuid as user_id, null::text as actor_kind, null::uuid as token_id, false as remote into v_actor;
  begin
    select * into v_actor from ops._actor(p_ctx);
    if v_actor.actor_kind <> 'session' or v_actor.role <> 'admin' then
      raise exception 'admin required' using errcode = '42501';
    end if;
    if v_actor.remote then raise exception 'remote access refused' using errcode = '42501'; end if;
    if enabled is null then raise exception 'invalid flag input'; end if;
    update public.app_flags f set enabled = admin_flag_set.enabled, changed_by = v_actor.user_id, changed_at = now()
      where f.flag = admin_flag_set.flag;
    if not found then raise exception 'invalid flag'; end if;
    v_data := jsonb_build_object('flag', flag, 'enabled', enabled);
  exception when others then
    v_error := ops.map_error(SQLSTATE, SQLERRM);
    insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, error_code, remote)
      values (v_actor.user_id, coalesce(v_actor.actor_kind, 'unknown'), v_actor.token_id,
        'admin_flag_set', coalesce(p_ctx->>'request_hash', ''), 'error', v_error->>'code', coalesce(v_actor.remote, false));
    return jsonb_build_object('ok', false, 'code', v_error->>'code',
      'message', case when v_error->>'code' = 'internal' then 'Internal error' else SQLERRM end,
      'details', jsonb_build_object('reason', v_error->'reason'));
  end;
  insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, remote)
    values (v_actor.user_id, v_actor.actor_kind, v_actor.token_id, 'admin_flag_set',
      coalesce(p_ctx->>'request_hash', ''), 'ok', v_actor.remote);
  perform ops._enter();
  return jsonb_build_object('ok', true, 'data', v_data);
end;
$$;
alter function ops.admin_flag_set(jsonb, text, boolean) owner to postgres;
revoke execute on function ops.admin_flag_set(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function ops.admin_flag_set(jsonb, text, boolean) to mdf_web;

create function ops.admin_pairing_open(p_ctx jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_actor record;
  v_data jsonb;
  v_error jsonb;

begin
  perform ops._enter();
  select null::uuid as user_id, null::text as actor_kind, null::uuid as token_id, false as remote into v_actor;
  begin
    select * into v_actor from ops._actor(p_ctx);
    if v_actor.actor_kind <> 'session' or v_actor.role <> 'admin' then
      raise exception 'admin required' using errcode = '42501';
    end if;
    if v_actor.remote then raise exception 'remote access refused' using errcode = '42501'; end if;
    update public.oauth_pairing set open_until = now() + interval '10 minutes',
      client_id = null, client_name = null, redirect_host = null, registered_at = null, loopback_only = null where id
      returning to_jsonb(oauth_pairing) - 'id' into v_data;
  exception when others then
    v_error := ops.map_error(SQLSTATE, SQLERRM);
    insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, error_code, remote)
      values (v_actor.user_id, coalesce(v_actor.actor_kind, 'unknown'), v_actor.token_id,
        'admin_pairing_open', coalesce(p_ctx->>'request_hash', ''), 'error', v_error->>'code', coalesce(v_actor.remote, false));
    return jsonb_build_object('ok', false, 'code', v_error->>'code',
      'message', case when v_error->>'code' = 'internal' then 'Internal error' else SQLERRM end,
      'details', jsonb_build_object('reason', v_error->'reason'));
  end;
  insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, remote)
    values (v_actor.user_id, v_actor.actor_kind, v_actor.token_id, 'admin_pairing_open',
      coalesce(p_ctx->>'request_hash', ''), 'ok', v_actor.remote);
  perform ops._enter();
  return jsonb_build_object('ok', true, 'data', v_data);
end;
$$;
alter function ops.admin_pairing_open(jsonb) owner to postgres;
revoke execute on function ops.admin_pairing_open(jsonb) from public, anon, authenticated;
grant execute on function ops.admin_pairing_open(jsonb) to mdf_web;

create function ops.admin_pairing_status(p_ctx jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_actor record;
  v_data jsonb;
  v_error jsonb;

begin
  perform ops._enter();
  select null::uuid as user_id, null::text as actor_kind, null::uuid as token_id, false as remote into v_actor;
  begin
    select * into v_actor from ops._actor(p_ctx);
    if v_actor.actor_kind <> 'session' or v_actor.role <> 'admin' then
      raise exception 'admin required' using errcode = '42501';
    end if;
    if v_actor.remote then raise exception 'remote access refused' using errcode = '42501'; end if;
    select to_jsonb(p) - 'id' into v_data from public.oauth_pairing p where id;
  exception when others then
    v_error := ops.map_error(SQLSTATE, SQLERRM);
    insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, error_code, remote)
      values (v_actor.user_id, coalesce(v_actor.actor_kind, 'unknown'), v_actor.token_id,
        'admin_pairing_status', coalesce(p_ctx->>'request_hash', ''), 'error', v_error->>'code', coalesce(v_actor.remote, false));
    return jsonb_build_object('ok', false, 'code', v_error->>'code',
      'message', case when v_error->>'code' = 'internal' then 'Internal error' else SQLERRM end,
      'details', jsonb_build_object('reason', v_error->'reason'));
  end;
  insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, remote)
    values (v_actor.user_id, v_actor.actor_kind, v_actor.token_id, 'admin_pairing_status',
      coalesce(p_ctx->>'request_hash', ''), 'ok', v_actor.remote);
  perform ops._enter();
  return jsonb_build_object('ok', true, 'data', v_data);
end;
$$;
alter function ops.admin_pairing_status(jsonb) owner to postgres;
revoke execute on function ops.admin_pairing_status(jsonb) from public, anon, authenticated;
grant execute on function ops.admin_pairing_status(jsonb) to mdf_web;

create function ops.oauth_registration_claim(client_id text, client_name text, redirect_uris text[]) returns boolean
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_registration jsonb;
  v_loopback boolean;
  v_host text;
begin
  perform ops._enter();
  if client_id is null or client_id = '' or client_name is null or btrim(client_name) = ''
    or redirect_uris is null or cardinality(redirect_uris) = 0
    or exists (select 1 from unnest(redirect_uris) u where u is null or u !~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?/') then
    raise exception 'invalid registration input';
  end if;
  select bool_and(u ~* '^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?/') into v_loopback from unnest(redirect_uris) u;
  v_host := substring(redirect_uris[1] from '^https?://([^/:]+)');
  update public.oauth_pairing p set open_until = now(), client_id = oauth_registration_claim.client_id,
    client_name = left(oauth_registration_claim.client_name, 60), redirect_host = v_host,
    registered_at = now(), loopback_only = v_loopback
    where p.id and p.open_until > now()
    returning to_jsonb(p) - 'id' - 'open_until' into v_registration;
  if not found then return false; end if;
  -- Keep registration provenance per client when the singleton pairing window is reused.
  insert into public.oauth_store (model, id_hash, payload)
    values ('Client', encode(sha256(convert_to(client_id, 'UTF8')), 'hex'),
      jsonb_build_object('client_id', client_id, 'client_name', left(client_name, 60),
        'redirect_uris', redirect_uris, '_mdf_registration', v_registration))
    on conflict (model, id_hash) do nothing;
  if not found then raise exception 'invalid duplicate client registration'; end if;
  return true;
end;
$$;
alter function ops.oauth_registration_claim(text, text, text[]) owner to postgres;
revoke execute on function ops.oauth_registration_claim(text, text, text[]) from public, anon, authenticated;
grant execute on function ops.oauth_registration_claim(text, text, text[]) to mdf_auth;

create function ops.oauth_find(model text, id_hash text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_row public.oauth_store%rowtype;
begin
  perform ops._enter();
  select s.* into v_row from public.oauth_store s where s.model = oauth_find.model and s.id_hash = oauth_find.id_hash
    and (s.expires_at is null or s.expires_at > now());
  if not found then return null; end if;
  return (v_row.payload - 'jti' - '_mdf_registration') ||
    case when v_row.consumed_at is null then '{}'::jsonb
      else jsonb_build_object('consumed', floor(extract(epoch from v_row.consumed_at))) end;
end;
$$;
alter function ops.oauth_find(text, text) owner to postgres;
revoke execute on function ops.oauth_find(text, text) from public, anon, authenticated;
grant execute on function ops.oauth_find(text, text) to mdf_auth;

create function ops.oauth_find_by_uid(uid text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_model text;
  v_hash text;
begin
  perform ops._enter();
  select s.model, s.id_hash into v_model, v_hash from public.oauth_store s
    where s.uid = oauth_find_by_uid.uid and (s.expires_at is null or s.expires_at > now());
  return ops.oauth_find(v_model, v_hash);
end;
$$;
alter function ops.oauth_find_by_uid(text) owner to postgres;
revoke execute on function ops.oauth_find_by_uid(text) from public, anon, authenticated;
grant execute on function ops.oauth_find_by_uid(text) to mdf_auth;

create function ops.oauth_upsert(model text, id_hash text, payload jsonb, grant_id text, uid text, expires_at timestamptz) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_registration jsonb;
  v_scopes text[];
  v_limit interval;
  v_previous public.oauth_store%rowtype;
begin
  perform ops._enter();
  if model not in ('Client','Grant','Interaction','Session','AuthorizationCode','AccessToken','RefreshToken')
    or model is null or id_hash is null or id_hash !~ '^[0-9a-f]{64}$'
    or payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'invalid OAuth storage input';
  end if;
  select s.* into v_previous from public.oauth_store s where s.model = oauth_upsert.model and s.id_hash = oauth_upsert.id_hash for update;
  if model in ('AuthorizationCode','AccessToken','RefreshToken') then
    v_limit := case model when 'AccessToken' then interval '1 hour'
      when 'RefreshToken' then interval '30 days' else interval '10 minutes' end;
    v_scopes := regexp_split_to_array(btrim(coalesce(payload->>'scope', '')), '\s+');
    if expires_at is null or expires_at <= now() or expires_at > now() + v_limit
      or (payload ? 'grantId' and payload->>'grantId' is distinct from grant_id)
      or not exists (
        select 1 from public.agent_tokens t join public.oauth_consents c on c.token_id = t.id
        join public.profiles p on p.id = t.owner_id
        where t.grant_id = oauth_upsert.grant_id and t.kind = 'oauth'
          and t.revoked_at is null and t.expires_at > now() and p.role = 'admin'
          and c.used_at is not null and c.user_id = t.owner_id and c.client_id = t.oauth_client_id
          and c.client_id = payload->>'clientId' and v_scopes <@ c.scopes and v_scopes <@ t.scopes
      ) then raise exception 'consent required' using errcode = 'MDF03'; end if;
  elsif model = 'Client' then
    v_registration := v_previous.payload->'_mdf_registration';
    if v_registration is null or v_registration->>'client_id' is distinct from payload->>'client_id'
      or v_previous.payload->'redirect_uris' is distinct from payload->'redirect_uris' then
      raise exception 'consent registration required' using errcode = 'MDF03';
    end if;
  elsif model = 'Interaction' then
    if uid is null or uid = '' or expires_at is null or expires_at <= now()
      or (v_previous.flow_nonce_hash is not null and
        (v_previous.uid is distinct from uid or v_previous.payload->'params' is distinct from payload->'params')) then
      raise exception 'consent interaction required' using errcode = 'MDF03';
    end if;
  end if;
  insert into public.oauth_store (model, id_hash, payload, grant_id, uid, user_code, expires_at)
    values (model, id_hash, (payload - 'jti' - '_mdf_registration') ||
      case when model = 'Client' then jsonb_build_object('_mdf_registration', v_registration,
        'client_name', v_registration->>'client_name') else '{}'::jsonb end,
      grant_id, uid, payload->>'userCode', expires_at)
    on conflict on constraint oauth_store_pkey do update set payload = excluded.payload,
      grant_id = excluded.grant_id, uid = excluded.uid, user_code = excluded.user_code,
      expires_at = excluded.expires_at;
end;
$$;
alter function ops.oauth_upsert(text, text, jsonb, text, text, timestamptz) owner to postgres;
revoke execute on function ops.oauth_upsert(text, text, jsonb, text, text, timestamptz) from public, anon, authenticated;
grant execute on function ops.oauth_upsert(text, text, jsonb, text, text, timestamptz) to mdf_auth;

create function ops.oauth_consume(model text, id_hash text) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform ops._enter();
  update public.oauth_store s set consumed_at = coalesce(s.consumed_at, now())
    where s.model = oauth_consume.model and s.id_hash = oauth_consume.id_hash;
end;
$$;
alter function ops.oauth_consume(text, text) owner to postgres;
revoke execute on function ops.oauth_consume(text, text) from public, anon, authenticated;
grant execute on function ops.oauth_consume(text, text) to mdf_auth;

create function ops.oauth_destroy(model text, id_hash text) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform ops._enter();
  delete from public.oauth_store s where s.model = oauth_destroy.model and s.id_hash = oauth_destroy.id_hash;
end;
$$;
alter function ops.oauth_destroy(text, text) owner to postgres;
revoke execute on function ops.oauth_destroy(text, text) from public, anon, authenticated;
grant execute on function ops.oauth_destroy(text, text) to mdf_auth;

create function ops.oauth_revoke_by_grant(grant_id text) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform ops._enter();
  update public.agent_tokens t set revoked_at = coalesce(t.revoked_at, now()) where t.grant_id = oauth_revoke_by_grant.grant_id;
  delete from public.oauth_store s where s.grant_id = oauth_revoke_by_grant.grant_id
    or (s.model = 'Grant' and s.id_hash = encode(sha256(convert_to(oauth_revoke_by_grant.grant_id, 'UTF8')), 'hex'));
end;
$$;
alter function ops.oauth_revoke_by_grant(text) owner to postgres;
revoke execute on function ops.oauth_revoke_by_grant(text) from public, anon, authenticated;
grant execute on function ops.oauth_revoke_by_grant(text) to mdf_auth;

create function ops.oauth_flow_nonce_set(uid text, nonce_hash text) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform ops._enter();
  if nonce_hash is null or nonce_hash !~ '^[0-9a-f]{64}$' then raise exception 'consent nonce required' using errcode = 'MDF03'; end if;
  update public.oauth_store s set flow_nonce_hash = nonce_hash
    where s.model = 'Interaction' and s.uid = oauth_flow_nonce_set.uid and s.expires_at > now()
      and (s.flow_nonce_hash is null or s.flow_nonce_hash = nonce_hash);
  if not found then raise exception 'consent interaction required' using errcode = 'MDF03'; end if;
end;
$$;
alter function ops.oauth_flow_nonce_set(text, text) owner to postgres;
revoke execute on function ops.oauth_flow_nonce_set(text, text) from public, anon, authenticated;
grant execute on function ops.oauth_flow_nonce_set(text, text) to mdf_auth;

create function ops.oauth_consent_info(p_ctx jsonb, uid text, nonce text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_actor record;
  v_data jsonb;
  v_error jsonb;
  v_flow public.oauth_store%rowtype;
  v_client public.oauth_store%rowtype;
  v_registration jsonb;
begin
  perform ops._enter();
  select null::uuid as user_id, null::text as actor_kind, null::uuid as token_id, false as remote into v_actor;
  begin
    select * into v_actor from ops._actor(p_ctx);
    if v_actor.actor_kind <> 'session' or v_actor.role <> 'admin' then
      raise exception 'admin required' using errcode = '42501';
    end if;

    select s.* into v_flow from public.oauth_store s where s.model = 'Interaction' and s.uid = oauth_consent_info.uid
      and s.expires_at > now() and s.flow_nonce_hash = encode(sha256(convert_to(nonce, 'UTF8')), 'hex');
    if not found then raise exception 'consent nonce required' using errcode = 'MDF03'; end if;
    select s.* into v_client from public.oauth_store s where s.model = 'Client'
      and s.id_hash = encode(sha256(convert_to(v_flow.payload#>>'{params,client_id}', 'UTF8')), 'hex')
      and (s.expires_at is null or s.expires_at > now());
    v_registration := v_client.payload->'_mdf_registration';
    if v_registration is null or not (v_client.payload->'redirect_uris' ? (v_flow.payload#>>'{params,redirect_uri}')) then
      raise exception 'consent client required' using errcode = 'MDF03';
    end if;
    v_data := (v_registration - 'loopback_only') || jsonb_build_object('requested_scopes',
      regexp_split_to_array(btrim(coalesce(v_flow.payload#>>'{params,scope}', '')), '\s+'));
  exception when others then
    v_error := ops.map_error(SQLSTATE, SQLERRM);
    insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, error_code, remote)
      values (v_actor.user_id, coalesce(v_actor.actor_kind, 'unknown'), v_actor.token_id,
        'oauth_consent_info', coalesce(p_ctx->>'request_hash', ''), 'error', v_error->>'code', coalesce(v_actor.remote, false));
    return jsonb_build_object('ok', false, 'code', v_error->>'code',
      'message', case when v_error->>'code' = 'internal' then 'Internal error' else SQLERRM end,
      'details', jsonb_build_object('reason', v_error->'reason'));
  end;
  insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, remote)
    values (v_actor.user_id, v_actor.actor_kind, v_actor.token_id, 'oauth_consent_info',
      coalesce(p_ctx->>'request_hash', ''), 'ok', v_actor.remote);
  perform ops._enter();
  return jsonb_build_object('ok', true, 'data', v_data);
end;
$$;
alter function ops.oauth_consent_info(jsonb, text, text) owner to postgres;
revoke execute on function ops.oauth_consent_info(jsonb, text, text) from public, anon, authenticated;
grant execute on function ops.oauth_consent_info(jsonb, text, text) to mdf_web;

create function ops.oauth_consent(p_ctx jsonb, uid text, nonce text, scopes text[], test_mode boolean) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_actor record;
  v_data jsonb;
  v_error jsonb;
  v_info jsonb;
  v_registration jsonb;
  v_id uuid;
  v_client text;
begin
  perform ops._enter();
  select null::uuid as user_id, null::text as actor_kind, null::uuid as token_id, false as remote into v_actor;
  begin
    select * into v_actor from ops._actor(p_ctx);
    if v_actor.actor_kind <> 'session' or v_actor.role <> 'admin' then
      raise exception 'admin required' using errcode = '42501';
    end if;

    if not coalesce((select enabled from public.app_flags where flag = 'remote_mcp'), false) then
      raise exception 'remote access refused' using errcode = '42501';
    end if;
    -- Serialize reconnects for one owner, including two previously unbound flows.
    perform 1 from public.profiles where id = v_actor.user_id for update;
    v_info := ops.oauth_consent_info(p_ctx, uid, nonce);
    if not coalesce((v_info->>'ok')::boolean, false) then raise exception 'consent required' using errcode = 'MDF03'; end if;
    v_client := v_info#>>'{data,client_id}';
    select s.payload->'_mdf_registration' into v_registration from public.oauth_store s
      where s.model = 'Client' and s.id_hash = encode(sha256(convert_to(v_client, 'UTF8')), 'hex');
    if v_actor.remote and (v_registration->>'loopback_only')::boolean then
      raise exception 'remote access refused' using errcode = '42501';
    end if;
    if scopes is null or cardinality(scopes) = 0 or array_position(scopes, null) is not null
      or not scopes <@ array['read','create','spend'] or test_mode is null
      or not scopes <@ array(select jsonb_array_elements_text(v_info#>'{data,requested_scopes}')) then
      raise exception 'invalid consent scopes';
    end if;
    if exists (select 1 from public.oauth_consents c where c.uid = oauth_consent.uid) then
      raise exception 'consent already recorded';
    end if;
    with revoked as (
      update public.agent_tokens t set revoked_at = now()
        where t.owner_id = v_actor.user_id and t.oauth_client_id = v_client and t.revoked_at is null
        returning t.grant_id
    ) delete from public.oauth_store s using revoked r where s.grant_id = r.grant_id
      or (s.model = 'Grant' and s.id_hash = encode(sha256(convert_to(r.grant_id, 'UTF8')), 'hex'));
    insert into public.agent_tokens (owner_id, kind, name, oauth_client_id, scopes, remote, test_mode, expires_at)
      values (v_actor.user_id, 'oauth', v_registration->>'client_name', v_client, scopes, true, test_mode, now() + interval '90 days')
      returning id into v_id;
    insert into public.spend_caps (scope, key, period, "limit") values ('token', v_id::text, 'day', 1);
    insert into public.oauth_consents (uid, user_id, client_id, scopes, test_mode, flow_nonce_hash, token_id)
      values (uid, v_actor.user_id, v_client, scopes, test_mode, encode(sha256(convert_to(nonce, 'UTF8')), 'hex'), v_id);
    v_data := jsonb_build_object('token_id', v_id);
  exception when others then
    v_error := ops.map_error(SQLSTATE, SQLERRM);
    insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, error_code, remote)
      values (v_actor.user_id, coalesce(v_actor.actor_kind, 'unknown'), v_actor.token_id,
        'oauth_consent', coalesce(p_ctx->>'request_hash', ''), 'error', v_error->>'code', coalesce(v_actor.remote, false));
    return jsonb_build_object('ok', false, 'code', v_error->>'code',
      'message', case when v_error->>'code' = 'internal' then 'Internal error' else SQLERRM end,
      'details', jsonb_build_object('reason', v_error->'reason'));
  end;
  insert into public.audit_log (owner_id, actor_kind, token_id, operation, args_hash, result, remote)
    values (v_actor.user_id, v_actor.actor_kind, v_actor.token_id, 'oauth_consent',
      coalesce(p_ctx->>'request_hash', ''), 'ok', v_actor.remote);
  perform ops._enter();
  return jsonb_build_object('ok', true, 'data', v_data);
end;
$$;
alter function ops.oauth_consent(jsonb, text, text, text[], boolean) owner to postgres;
revoke execute on function ops.oauth_consent(jsonb, text, text, text[], boolean) from public, anon, authenticated;
grant execute on function ops.oauth_consent(jsonb, text, text, text[], boolean) to mdf_web;

create function ops.oauth_interaction_result(uid text, nonce text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_consent public.oauth_consents%rowtype;
begin
  perform ops._enter();
  update public.oauth_consents c set used_at = now()
    where c.uid = oauth_interaction_result.uid and c.used_at is null
      and c.flow_nonce_hash = encode(sha256(convert_to(nonce, 'UTF8')), 'hex')
      and exists (select 1 from public.oauth_store s where s.model = 'Interaction' and s.uid = c.uid
        and s.expires_at > now() and s.flow_nonce_hash = c.flow_nonce_hash)
      and exists (select 1 from public.agent_tokens t join public.profiles p on p.id = t.owner_id
        where t.id = c.token_id and t.revoked_at is null and t.expires_at > now() and p.role = 'admin')
    returning c.* into v_consent;
  if not found then raise exception 'consent nonce required' using errcode = 'MDF03'; end if;
  return jsonb_build_object('user_id', v_consent.user_id, 'client_id', v_consent.client_id,
    'scopes', v_consent.scopes, 'test_mode', v_consent.test_mode, 'token_id', v_consent.token_id);
end;
$$;
alter function ops.oauth_interaction_result(text, text) owner to postgres;
revoke execute on function ops.oauth_interaction_result(text, text) from public, anon, authenticated;
grant execute on function ops.oauth_interaction_result(text, text) to mdf_auth;

create function ops.oauth_bind_grant(uid text, grant_id text) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform ops._enter();
  if grant_id is null or grant_id = '' then raise exception 'consent grant required' using errcode = 'MDF03'; end if;
  update public.agent_tokens t set grant_id = oauth_bind_grant.grant_id
    from public.oauth_consents c where c.uid = oauth_bind_grant.uid and c.token_id = t.id
      and c.used_at is not null and t.grant_id is null and t.revoked_at is null and t.expires_at > now();
  if not found then raise exception 'consent grant required' using errcode = 'MDF03'; end if;
end;
$$;
alter function ops.oauth_bind_grant(text, text) owner to postgres;
revoke execute on function ops.oauth_bind_grant(text, text) from public, anon, authenticated;
grant execute on function ops.oauth_bind_grant(text, text) to mdf_auth;

create function ops.resolve_access_token(token_hash text, resource text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_token public.agent_tokens%rowtype;
  v_payload jsonb;
  v_scopes text[];
begin
  perform ops._enter();
  if not coalesce((select enabled from public.app_flags where flag = 'remote_mcp'), false) then
    raise exception 'authentication required' using errcode = 'MDF03';
  end if;
  select t.* into v_token from public.oauth_store s
    join public.agent_tokens t on t.grant_id = s.grant_id
    where s.model = 'AccessToken' and s.id_hash = resolve_access_token.token_hash
      and s.expires_at > now() and s.consumed_at is null
      and s.payload->>'aud' = resource and resource is not null
      and t.kind = 'oauth' and t.revoked_at is null and t.expires_at > now();
  if not found then raise exception 'authentication required' using errcode = 'MDF03'; end if;
  select s.payload into v_payload from public.oauth_store s where s.model = 'AccessToken' and s.id_hash = token_hash;
  if not exists (select 1 from public.profiles where id = v_token.owner_id and role = 'admin') then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.spend_caps where scope = 'token' and key = v_token.id::text
    and provider = '' and unit = 'usd' and period = 'day') then
    raise exception 'token cap required' using errcode = 'MDF06';
  end if;
  select coalesce(array_agg(distinct s), '{}'::text[]) into v_scopes
    from unnest(regexp_split_to_array(btrim(coalesce(v_payload->>'scope', '')), '\s+')) s where s = any(v_token.scopes);
  update public.agent_tokens set last_used_at = now() where id = v_token.id;
  return jsonb_build_object('user_id', v_token.owner_id, 'token_id', v_token.id,
    'scopes', v_scopes, 'test_mode', v_token.test_mode);
end;
$$;
alter function ops.resolve_access_token(text, text) owner to postgres;
revoke execute on function ops.resolve_access_token(text, text) from public, anon, authenticated;
grant execute on function ops.resolve_access_token(text, text) to mdf_web;

create or replace function ops._actor(p_ctx jsonb,
  out user_id uuid, out role text, out actor_kind text, out token_id uuid,
  out scopes text[], out test_mode boolean, out remote boolean) returns record
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_token public.agent_tokens%rowtype;
  v_access jsonb;
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
    if remote and (not v_token.remote or not coalesce((select enabled from public.app_flags where flag = 'remote_mcp'), false)) then
      raise exception 'remote access refused' using errcode = '42501';
    end if;
    user_id := v_token.owner_id;
    token_id := v_token.id;
    scopes := v_token.scopes;
    test_mode := v_token.test_mode;
  elsif actor_kind = 'oauth' then
    v_access := ops.resolve_access_token(p_ctx->>'access_token_hash', p_ctx->>'resource');
    user_id := (v_access->>'user_id')::uuid;
    token_id := (v_access->>'token_id')::uuid;
    scopes := array(select jsonb_array_elements_text(v_access->'scopes'));
    test_mode := (v_access->>'test_mode')::boolean;
  else
    raise exception 'authentication required';
  end if;
  select p.role into role from public.profiles p where p.id = user_id;
  if role is null then raise exception 'profile required'; end if;
  if actor_kind <> 'session' then
    if role <> 'admin' then raise exception 'admin required' using errcode = '42501'; end if;
    if not exists (select 1 from public.spend_caps c where c.scope = 'token' and c.key = token_id::text
      and c.provider = '' and c.unit = 'usd' and c.period = 'day') then
      raise exception 'token cap required' using errcode = 'MDF06';
    end if;
    update public.agent_tokens t set last_used_at = now() where t.id = token_id;
  end if;
exception when invalid_text_representation then
  raise exception 'authentication required';
end;
$$;
alter function ops._actor(jsonb) owner to postgres;
revoke execute on function ops._actor(jsonb) from public, anon, authenticated;
grant execute on function ops._actor(jsonb) to service_role;
