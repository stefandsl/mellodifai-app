-- Count committed reservation rows, not requests. A refused batch rolls back in its ops wrapper.
create index reservations_token_created on public.reservations (token_id, created_at desc);

create or replace function ops.reserve_job(p_job uuid) returns uuid
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare j public.jobs%rowtype; r public.reservations%rowtype; rule record;
  estimate jsonb := '[]'; charges jsonb; usd numeric; generation integer; kie boolean := false;
  rate_key text; checked_at timestamptz; oldest timestamptz; used integer;
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
  -- Serialize only the hourly reservation check, before taking spend-counter locks.
  rate_key := case when j.token_id is null then 'user:' || j.owner_id::text
    else 'token:' || j.token_id::text end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reservation-rate:' || rate_key, 0));
  checked_at := clock_timestamp();
  select count(*), min(created_at) into used, oldest from public.reservations
    where created_at > checked_at - interval '1 hour'
      and ((j.token_id is not null and token_id=j.token_id)
        or (j.token_id is null and token_id is null and user_id=j.owner_id));
  if used >= 20 then
    raise exception 'reservation rate limit exceeded' using errcode='54000',
      detail=jsonb_build_object('retry_after',greatest(1,ceil(extract(epoch from oldest + interval '1 hour' - checked_at)))::integer)::text;
  end if;
  charges := ops._charge_spend(j.owner_id,j.token_id,j.run_id,estimate);
  select generation_count into generation from public.versions where id=j.version_id;
  insert into public.reservations (job_id,user_id,token_id,run_id,version_id,estimate,charges,
    kie_submit_reserved,kie_generation,section_edit_id,created_at)
    values(j.id,j.owner_id,j.token_id,j.run_id,j.version_id,estimate,charges,kie,
      case when kie and j.stage='generate_song' then generation end,
      case when j.stage='replace_section' then (j.payload->>'edit_id')::uuid end,checked_at)
    returning id into r.id;
  return r.id;
end;
$$;
alter function ops.reserve_job(uuid) owner to postgres;
revoke execute on function ops.reserve_job(uuid) from public, anon, authenticated;
grant execute on function ops.reserve_job(uuid) to service_role;

create or replace function ops.map_error(sqlstate text, message text) returns jsonb
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
        when message in ('daily remake limit reached','daily lyrics limit reached','reservation rate limit exceeded') then 'rate_limited'
        when message in ('nothing to save','unknown line','unknown section','lyrics required','a title, a brief or a style is needed') then 'validation'
        when message in ('conflict: the lyrics changed meanwhile','wait for the running step','originality gate not passed','lyrics differ from the reviewed ones','remake still running') then 'conflict'
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
