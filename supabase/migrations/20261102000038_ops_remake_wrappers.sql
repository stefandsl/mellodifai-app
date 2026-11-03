-- Map the newly reachable remake and lyric refusals using the frozen error codes.
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
        when message in ('daily remake limit reached','daily lyrics limit reached') then 'rate_limited'
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

-- Local cookie operations for remakes and lyric assistance.

create function ops.remake_start(p_ctx jsonb, p_url text, p_video_id text, p_lang text, p_country text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind <> 'session' or a.remote then raise exception 'admin required'; end if;

    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_start',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_start',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    data := jsonb_build_object('id',public.remake_start(p_url,p_video_id,p_lang,p_country));
    ids := coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb;
    for jid in select jobs.id from public.jobs jobs where jobs.owner_id=a.user_id and jobs.id in (select value::uuid from jsonb_array_elements_text(ids)) loop
      perform ops.reserve_job(jid);
    end loop;
    select jsonb_build_object('jobs',coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'version_id',j.version_id,'stage',j.stage) order by j.created_at,j.id),'[]'::jsonb)) || coalesce(data,'{}'::jsonb)
      into data from public.jobs j where j.owner_id=a.user_id and j.id in (select value::uuid from jsonb_array_elements_text(ids));
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    action_error := case
      when sqlerrm = 'invalid youtube link' then 'invalidUrl'
      when sqlerrm in ('a remake is already running','a lyrics request is already running') then 'busy'
      when sqlerrm in ('daily remake limit reached','daily lyrics limit reached') then 'limit'
      when sqlerrm in ('conflict: the lyrics changed meanwhile','lyrics differ from the reviewed ones') then 'conflict'
      when sqlerrm = 'originality gate not passed' then 'gate'
      when sqlerrm = 'wait for the running step' then 'wait'
      when sqlerrm in ('remake review required','remake still running','failed remake required') then 'notReady'
      else null end;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'remake_start',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_strip_nulls(jsonb_build_object('reason',err->>'reason','action_error',action_error)) || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'remake_start',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.remake_start(jsonb, text, text, text, text) owner to postgres;
revoke execute on function ops.remake_start(jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function ops.remake_start(jsonb, text, text, text, text) to mdf_web;


create function ops.remake_edit(p_ctx jsonb, p_remake uuid, p_revision integer, p_lines jsonb, p_title text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind <> 'session' or a.remote then raise exception 'admin required'; end if;
    select v.* into owned_version from public.versions v join public.remakes r on r.version_id=v.id where r.id=p_remake and r.owner_id=a.user_id and v.owner_id=a.user_id for update of v;
    if not found then raise exception 'owned remake required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_edit',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_edit',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    data := jsonb_build_object('revision',public.remake_edit(p_remake,p_revision,p_lines,p_title));
    ids := coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb;
    for jid in select jobs.id from public.jobs jobs where jobs.owner_id=a.user_id and jobs.id in (select value::uuid from jsonb_array_elements_text(ids)) loop
      perform ops.reserve_job(jid);
    end loop;
    select jsonb_build_object('jobs',coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'version_id',j.version_id,'stage',j.stage) order by j.created_at,j.id),'[]'::jsonb)) || coalesce(data,'{}'::jsonb)
      into data from public.jobs j where j.owner_id=a.user_id and j.id in (select value::uuid from jsonb_array_elements_text(ids));
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    action_error := case
      when sqlerrm = 'invalid youtube link' then 'invalidUrl'
      when sqlerrm in ('a remake is already running','a lyrics request is already running') then 'busy'
      when sqlerrm in ('daily remake limit reached','daily lyrics limit reached') then 'limit'
      when sqlerrm in ('conflict: the lyrics changed meanwhile','lyrics differ from the reviewed ones') then 'conflict'
      when sqlerrm = 'originality gate not passed' then 'gate'
      when sqlerrm = 'wait for the running step' then 'wait'
      when sqlerrm in ('remake review required','remake still running','failed remake required') then 'notReady'
      else null end;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'remake_edit',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_strip_nulls(jsonb_build_object('reason',err->>'reason','action_error',action_error)) || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'remake_edit',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.remake_edit(jsonb, uuid, integer, jsonb, text) owner to postgres;
revoke execute on function ops.remake_edit(jsonb, uuid, integer, jsonb, text) from public, anon, authenticated;
grant execute on function ops.remake_edit(jsonb, uuid, integer, jsonb, text) to mdf_web;


create function ops.remake_regenerate_section(p_ctx jsonb, p_remake uuid, p_revision integer, p_section text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind <> 'session' or a.remote then raise exception 'admin required'; end if;
    select v.* into owned_version from public.versions v join public.remakes r on r.version_id=v.id where r.id=p_remake and r.owner_id=a.user_id and v.owner_id=a.user_id for update of v;
    if not found then raise exception 'owned remake required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_regenerate_section',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_regenerate_section',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.remake_regenerate_section(p_remake,p_revision,p_section);
    ids := coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb;
    for jid in select jobs.id from public.jobs jobs where jobs.owner_id=a.user_id and jobs.id in (select value::uuid from jsonb_array_elements_text(ids)) loop
      perform ops.reserve_job(jid);
    end loop;
    select jsonb_build_object('jobs',coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'version_id',j.version_id,'stage',j.stage) order by j.created_at,j.id),'[]'::jsonb)) || coalesce(data,'{}'::jsonb)
      into data from public.jobs j where j.owner_id=a.user_id and j.id in (select value::uuid from jsonb_array_elements_text(ids));
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    action_error := case
      when sqlerrm = 'invalid youtube link' then 'invalidUrl'
      when sqlerrm in ('a remake is already running','a lyrics request is already running') then 'busy'
      when sqlerrm in ('daily remake limit reached','daily lyrics limit reached') then 'limit'
      when sqlerrm in ('conflict: the lyrics changed meanwhile','lyrics differ from the reviewed ones') then 'conflict'
      when sqlerrm = 'originality gate not passed' then 'gate'
      when sqlerrm = 'wait for the running step' then 'wait'
      when sqlerrm in ('remake review required','remake still running','failed remake required') then 'notReady'
      else null end;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'remake_regenerate_section',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_strip_nulls(jsonb_build_object('reason',err->>'reason','action_error',action_error)) || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'remake_regenerate_section',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.remake_regenerate_section(jsonb, uuid, integer, text) owner to postgres;
revoke execute on function ops.remake_regenerate_section(jsonb, uuid, integer, text) from public, anon, authenticated;
grant execute on function ops.remake_regenerate_section(jsonb, uuid, integer, text) to mdf_web;


create function ops.remake_accept(p_ctx jsonb, p_remake uuid, p_revision integer, p_pack jsonb, p_settings jsonb, p_vocal_gender text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind <> 'session' or a.remote then raise exception 'admin required'; end if;
    select v.* into owned_version from public.versions v join public.remakes r on r.version_id=v.id where r.id=p_remake and r.owner_id=a.user_id and v.owner_id=a.user_id for update of v;
    if not found then raise exception 'owned remake required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_accept',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_accept',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    data := jsonb_build_object('id',public.remake_accept(p_remake,p_revision,p_pack,p_settings,p_vocal_gender));
    ids := coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb;
    for jid in select jobs.id from public.jobs jobs where jobs.owner_id=a.user_id and jobs.id in (select value::uuid from jsonb_array_elements_text(ids)) loop
      perform ops.reserve_job(jid);
    end loop;
    select jsonb_build_object('jobs',coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'version_id',j.version_id,'stage',j.stage) order by j.created_at,j.id),'[]'::jsonb)) || coalesce(data,'{}'::jsonb)
      into data from public.jobs j where j.owner_id=a.user_id and j.id in (select value::uuid from jsonb_array_elements_text(ids));
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    action_error := case
      when sqlerrm = 'invalid youtube link' then 'invalidUrl'
      when sqlerrm in ('a remake is already running','a lyrics request is already running') then 'busy'
      when sqlerrm in ('daily remake limit reached','daily lyrics limit reached') then 'limit'
      when sqlerrm in ('conflict: the lyrics changed meanwhile','lyrics differ from the reviewed ones') then 'conflict'
      when sqlerrm = 'originality gate not passed' then 'gate'
      when sqlerrm = 'wait for the running step' then 'wait'
      when sqlerrm in ('remake review required','remake still running','failed remake required') then 'notReady'
      else null end;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'remake_accept',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_strip_nulls(jsonb_build_object('reason',err->>'reason','action_error',action_error)) || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'remake_accept',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.remake_accept(jsonb, uuid, integer, jsonb, jsonb, text) owner to postgres;
revoke execute on function ops.remake_accept(jsonb, uuid, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function ops.remake_accept(jsonb, uuid, integer, jsonb, jsonb, text) to mdf_web;


create function ops.remake_cancel(p_ctx jsonb, p_remake uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind <> 'session' or a.remote then raise exception 'admin required'; end if;
    select v.* into owned_version from public.versions v join public.remakes r on r.version_id=v.id where r.id=p_remake and r.owner_id=a.user_id and v.owner_id=a.user_id for update of v;
    if not found then raise exception 'owned remake required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_cancel',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_cancel',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.remake_cancel(p_remake);
    ids := coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb;
    for jid in select jobs.id from public.jobs jobs where jobs.owner_id=a.user_id and jobs.id in (select value::uuid from jsonb_array_elements_text(ids)) loop
      perform ops.reserve_job(jid);
    end loop;
    select jsonb_build_object('jobs',coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'version_id',j.version_id,'stage',j.stage) order by j.created_at,j.id),'[]'::jsonb)) || coalesce(data,'{}'::jsonb)
      into data from public.jobs j where j.owner_id=a.user_id and j.id in (select value::uuid from jsonb_array_elements_text(ids));
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    action_error := case
      when sqlerrm = 'invalid youtube link' then 'invalidUrl'
      when sqlerrm in ('a remake is already running','a lyrics request is already running') then 'busy'
      when sqlerrm in ('daily remake limit reached','daily lyrics limit reached') then 'limit'
      when sqlerrm in ('conflict: the lyrics changed meanwhile','lyrics differ from the reviewed ones') then 'conflict'
      when sqlerrm = 'originality gate not passed' then 'gate'
      when sqlerrm = 'wait for the running step' then 'wait'
      when sqlerrm in ('remake review required','remake still running','failed remake required') then 'notReady'
      else null end;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'remake_cancel',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_strip_nulls(jsonb_build_object('reason',err->>'reason','action_error',action_error)) || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'remake_cancel',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.remake_cancel(jsonb, uuid) owner to postgres;
revoke execute on function ops.remake_cancel(jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.remake_cancel(jsonb, uuid) to mdf_web;


create function ops.remake_dismiss(p_ctx jsonb, p_remake uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind <> 'session' or a.remote then raise exception 'admin required'; end if;
    select v.* into owned_version from public.versions v join public.remakes r on r.version_id=v.id where r.id=p_remake and r.owner_id=a.user_id and v.owner_id=a.user_id for update of v;
    if not found then raise exception 'owned remake required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_dismiss',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_dismiss',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.remake_dismiss(p_remake);
    ids := coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb;
    for jid in select jobs.id from public.jobs jobs where jobs.owner_id=a.user_id and jobs.id in (select value::uuid from jsonb_array_elements_text(ids)) loop
      perform ops.reserve_job(jid);
    end loop;
    select jsonb_build_object('jobs',coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'version_id',j.version_id,'stage',j.stage) order by j.created_at,j.id),'[]'::jsonb)) || coalesce(data,'{}'::jsonb)
      into data from public.jobs j where j.owner_id=a.user_id and j.id in (select value::uuid from jsonb_array_elements_text(ids));
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    action_error := case
      when sqlerrm = 'invalid youtube link' then 'invalidUrl'
      when sqlerrm in ('a remake is already running','a lyrics request is already running') then 'busy'
      when sqlerrm in ('daily remake limit reached','daily lyrics limit reached') then 'limit'
      when sqlerrm in ('conflict: the lyrics changed meanwhile','lyrics differ from the reviewed ones') then 'conflict'
      when sqlerrm = 'originality gate not passed' then 'gate'
      when sqlerrm = 'wait for the running step' then 'wait'
      when sqlerrm in ('remake review required','remake still running','failed remake required') then 'notReady'
      else null end;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'remake_dismiss',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_strip_nulls(jsonb_build_object('reason',err->>'reason','action_error',action_error)) || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'remake_dismiss',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.remake_dismiss(jsonb, uuid) owner to postgres;
revoke execute on function ops.remake_dismiss(jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.remake_dismiss(jsonb, uuid) to mdf_web;


create function ops.remake_retry(p_ctx jsonb, p_remake uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind <> 'session' or a.remote then raise exception 'admin required'; end if;
    select v.* into owned_version from public.versions v join public.remakes r on r.version_id=v.id where r.id=p_remake and r.owner_id=a.user_id and v.owner_id=a.user_id for update of v;
    if not found then raise exception 'owned remake required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_retry',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'remake_retry',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.remake_retry(p_remake);
    ids := coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb;
    for jid in select jobs.id from public.jobs jobs where jobs.owner_id=a.user_id and jobs.id in (select value::uuid from jsonb_array_elements_text(ids)) loop
      perform ops.reserve_job(jid);
    end loop;
    select jsonb_build_object('jobs',coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'version_id',j.version_id,'stage',j.stage) order by j.created_at,j.id),'[]'::jsonb)) || coalesce(data,'{}'::jsonb)
      into data from public.jobs j where j.owner_id=a.user_id and j.id in (select value::uuid from jsonb_array_elements_text(ids));
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    action_error := case
      when sqlerrm = 'invalid youtube link' then 'invalidUrl'
      when sqlerrm in ('a remake is already running','a lyrics request is already running') then 'busy'
      when sqlerrm in ('daily remake limit reached','daily lyrics limit reached') then 'limit'
      when sqlerrm in ('conflict: the lyrics changed meanwhile','lyrics differ from the reviewed ones') then 'conflict'
      when sqlerrm = 'originality gate not passed' then 'gate'
      when sqlerrm = 'wait for the running step' then 'wait'
      when sqlerrm in ('remake review required','remake still running','failed remake required') then 'notReady'
      else null end;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'remake_retry',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_strip_nulls(jsonb_build_object('reason',err->>'reason','action_error',action_error)) || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'remake_retry',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.remake_retry(jsonb, uuid) owner to postgres;
revoke execute on function ops.remake_retry(jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.remake_retry(jsonb, uuid) to mdf_web;


create function ops.lyrics_assist_request(p_ctx jsonb, p_mode text, p_lang text, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind <> 'session' or a.remote then raise exception 'admin required'; end if;

    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'lyrics_assist_request',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'lyrics_assist_request',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    data := jsonb_build_object('id',public.lyrics_assist_request(p_mode,p_lang,p_input));
    ids := coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb;
    for jid in select jobs.id from public.jobs jobs where jobs.owner_id=a.user_id and jobs.id in (select value::uuid from jsonb_array_elements_text(ids)) loop
      perform ops.reserve_job(jid);
    end loop;
    select jsonb_build_object('jobs',coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'version_id',j.version_id,'stage',j.stage) order by j.created_at,j.id),'[]'::jsonb)) || coalesce(data,'{}'::jsonb)
      into data from public.jobs j where j.owner_id=a.user_id and j.id in (select value::uuid from jsonb_array_elements_text(ids));
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    action_error := case
      when sqlerrm = 'invalid youtube link' then 'invalidUrl'
      when sqlerrm in ('a remake is already running','a lyrics request is already running') then 'busy'
      when sqlerrm in ('daily remake limit reached','daily lyrics limit reached') then 'limit'
      when sqlerrm in ('conflict: the lyrics changed meanwhile','lyrics differ from the reviewed ones') then 'conflict'
      when sqlerrm = 'originality gate not passed' then 'gate'
      when sqlerrm = 'wait for the running step' then 'wait'
      when sqlerrm in ('remake review required','remake still running','failed remake required') then 'notReady'
      else null end;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'lyrics_assist_request',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_strip_nulls(jsonb_build_object('reason',err->>'reason','action_error',action_error)) || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'lyrics_assist_request',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.lyrics_assist_request(jsonb, text, text, jsonb) owner to postgres;
revoke execute on function ops.lyrics_assist_request(jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function ops.lyrics_assist_request(jsonb, text, text, jsonb) to mdf_web;


create function ops.lyrics_assist_cancel(p_ctx jsonb, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind <> 'session' or a.remote then raise exception 'admin required'; end if;
    if not exists(select 1 from public.lyric_requests where id=p_request and owner_id=a.user_id) then raise exception 'owned request required'; end if;
    if exists(select 1 from public.jobs where owner_id=a.user_id and payload->>'request_id'=p_request::text and fake_providers <> a.test_mode) then raise exception 'test rule required' using errcode='MDF04'; end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'lyrics_assist_cancel',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'lyrics_assist_cancel',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.lyrics_assist_cancel(p_request);
    ids := coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb;
    for jid in select jobs.id from public.jobs jobs where jobs.owner_id=a.user_id and jobs.id in (select value::uuid from jsonb_array_elements_text(ids)) loop
      perform ops.reserve_job(jid);
    end loop;
    select jsonb_build_object('jobs',coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'version_id',j.version_id,'stage',j.stage) order by j.created_at,j.id),'[]'::jsonb)) || coalesce(data,'{}'::jsonb)
      into data from public.jobs j where j.owner_id=a.user_id and j.id in (select value::uuid from jsonb_array_elements_text(ids));
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    action_error := case
      when sqlerrm = 'invalid youtube link' then 'invalidUrl'
      when sqlerrm in ('a remake is already running','a lyrics request is already running') then 'busy'
      when sqlerrm in ('daily remake limit reached','daily lyrics limit reached') then 'limit'
      when sqlerrm in ('conflict: the lyrics changed meanwhile','lyrics differ from the reviewed ones') then 'conflict'
      when sqlerrm = 'originality gate not passed' then 'gate'
      when sqlerrm = 'wait for the running step' then 'wait'
      when sqlerrm in ('remake review required','remake still running','failed remake required') then 'notReady'
      else null end;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'lyrics_assist_cancel',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_strip_nulls(jsonb_build_object('reason',err->>'reason','action_error',action_error)) || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'lyrics_assist_cancel',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.lyrics_assist_cancel(jsonb, uuid) owner to postgres;
revoke execute on function ops.lyrics_assist_cancel(jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.lyrics_assist_cancel(jsonb, uuid) to mdf_web;
