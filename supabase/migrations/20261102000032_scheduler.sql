create function ops.claim_scheduled_task(p_worker text) returns text
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_name text;
begin
  perform ops._enter();
  if p_worker is null or btrim(p_worker) = '' then
    raise exception 'worker required' using errcode = 'MDF03';
  end if;
  select name into v_name from public.scheduled_tasks
    where next_run_at <= now()
      and (running_by is null or started_at < now() - interval '10 minutes')
    order by next_run_at, name
    for update skip locked limit 1;
  if v_name is not null then
    update public.scheduled_tasks set running_by = p_worker, started_at = now()
      where name = v_name;
  end if;
  return v_name;
end;
$$;

create function ops.finish_scheduled_task(p_name text, p_worker text, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform ops._enter();
  update public.scheduled_tasks
    set running_by = null,
      last_ok_at = case when p_ok then now() else last_ok_at end,
      last_error = case when p_ok then null else p_error end,
      next_run_at = case when interval_s is not null then now() + interval_s * interval '1 second'
        else ((now() at time zone 'Europe/Rome')::date + 1 + daily_at) at time zone 'Europe/Rome' end
    where name = p_name and running_by = p_worker;
end;
$$;

create function ops.purge_idempotency() returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform ops._enter();
  delete from public.idempotency_keys where created_at < now() - interval '24 hours';
end;
$$;

create function ops.purge_oauth() returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform ops._enter();
  delete from public.oauth_store
    where expires_at < now() - interval '1 hour' or consumed_at < now() - interval '1 hour';
  -- Lock tokens before deciding that a consent never bound, serializing with grant binding.
  perform t.id from public.agent_tokens t join public.oauth_consents c on c.token_id = t.id
    where c.created_at < now() - interval '1 day' and t.grant_id is null
    order by t.id for update of t;
  with abandoned as (
    delete from public.oauth_consents c
      where c.created_at < now() - interval '1 day'
        and not exists (select 1 from public.agent_tokens t where t.id = c.token_id and t.grant_id is not null)
      returning c.token_id
  )
  update public.agent_tokens t set revoked_at = coalesce(t.revoked_at, now())
    from abandoned a where t.id = a.token_id;
end;
$$;

create function ops.purge_audit() returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform ops._enter();
  delete from public.audit_log where at < now() - interval '180 days';
end;
$$;

create function ops.purge_test_runs() returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform ops._enter();
  update public.jobs j set status = 'cancelled', finished_at = now(), heartbeat_at = null
    from public.versions v where j.version_id = v.id
      and v.test_run and v.created_at < now() - interval '7 days'
      and j.status in ('queued', 'running');
  update public.versions set trashed_at = now()
    where test_run and created_at < now() - interval '7 days' and trashed_at is null;
end;
$$;

alter function ops.claim_scheduled_task(text) owner to postgres;
revoke execute on function ops.claim_scheduled_task(text) from public, anon, authenticated;
grant execute on function ops.claim_scheduled_task(text) to service_role;

alter function ops.finish_scheduled_task(text,text,boolean,text) owner to postgres;
revoke execute on function ops.finish_scheduled_task(text,text,boolean,text) from public, anon, authenticated;
grant execute on function ops.finish_scheduled_task(text,text,boolean,text) to service_role;

alter function ops.purge_idempotency() owner to postgres;
revoke execute on function ops.purge_idempotency() from public, anon, authenticated;
grant execute on function ops.purge_idempotency() to service_role;

alter function ops.purge_oauth() owner to postgres;
revoke execute on function ops.purge_oauth() from public, anon, authenticated;
grant execute on function ops.purge_oauth() to service_role;

alter function ops.purge_audit() owner to postgres;
revoke execute on function ops.purge_audit() from public, anon, authenticated;
grant execute on function ops.purge_audit() to service_role;

alter function ops.purge_test_runs() owner to postgres;
revoke execute on function ops.purge_test_runs() from public, anon, authenticated;
grant execute on function ops.purge_test_runs() to service_role;

insert into public.scheduled_tasks (name, interval_s, next_run_at) values
  ('expire_reservations', 300, now()),
  ('purge_idempotency', 3600, now()),
  ('purge_oauth', 3600, now())
on conflict do nothing;
insert into public.scheduled_tasks (name, daily_at, next_run_at)
  select name, daily_at, ((now() at time zone 'Europe/Rome')::date + 1 + daily_at) at time zone 'Europe/Rome'
  from (values ('purge_audit', time '03:30'), ('purge_test_runs', time '03:45')) as tasks(name, daily_at)
on conflict do nothing;
