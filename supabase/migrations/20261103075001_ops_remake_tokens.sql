-- Agent tokens may drive a remake (design 7.3b). A cookie session keeps its rule: local only. A PAT
-- or OAuth actor that ops._actor admitted needs the scope of the operation (spend for the calls
-- that queue paid work, create for cancel and dismiss) and an idempotency key. The six wrappers
-- that take a remake keep their test rule: the version's test_run must equal the actor's test
-- mode. Every body is the one of migration 20261102000038 with only the guard changed.

create or replace function ops.remake_start(p_ctx jsonb, p_url text, p_video_id text, p_lang text, p_country text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind = 'session' then
      if a.remote then raise exception 'admin required'; end if;
    else
      if not ('spend'=any(a.scopes)) then raise exception 'admin required'; end if;
      if coalesce(length(p_ctx->>'idempotency_key'),0)=0 then raise exception 'idempotency key required' using errcode='MDF01'; end if;
    end if;

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


create or replace function ops.remake_edit(p_ctx jsonb, p_remake uuid, p_revision integer, p_lines jsonb, p_title text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind = 'session' then
      if a.remote then raise exception 'admin required'; end if;
    else
      if not ('spend'=any(a.scopes)) then raise exception 'admin required'; end if;
      if coalesce(length(p_ctx->>'idempotency_key'),0)=0 then raise exception 'idempotency key required' using errcode='MDF01'; end if;
    end if;
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


create or replace function ops.remake_regenerate_section(p_ctx jsonb, p_remake uuid, p_revision integer, p_section text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind = 'session' then
      if a.remote then raise exception 'admin required'; end if;
    else
      if not ('spend'=any(a.scopes)) then raise exception 'admin required'; end if;
      if coalesce(length(p_ctx->>'idempotency_key'),0)=0 then raise exception 'idempotency key required' using errcode='MDF01'; end if;
    end if;
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


create or replace function ops.remake_accept(p_ctx jsonb, p_remake uuid, p_revision integer, p_pack jsonb, p_settings jsonb, p_vocal_gender text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind = 'session' then
      if a.remote then raise exception 'admin required'; end if;
    else
      if not ('spend'=any(a.scopes)) then raise exception 'admin required'; end if;
      if coalesce(length(p_ctx->>'idempotency_key'),0)=0 then raise exception 'idempotency key required' using errcode='MDF01'; end if;
    end if;
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


create or replace function ops.remake_cancel(p_ctx jsonb, p_remake uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind = 'session' then
      if a.remote then raise exception 'admin required'; end if;
    else
      if not ('create'=any(a.scopes)) then raise exception 'admin required'; end if;
      if coalesce(length(p_ctx->>'idempotency_key'),0)=0 then raise exception 'idempotency key required' using errcode='MDF01'; end if;
    end if;
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


create or replace function ops.remake_dismiss(p_ctx jsonb, p_remake uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind = 'session' then
      if a.remote then raise exception 'admin required'; end if;
    else
      if not ('create'=any(a.scopes)) then raise exception 'admin required'; end if;
      if coalesce(length(p_ctx->>'idempotency_key'),0)=0 then raise exception 'idempotency key required' using errcode='MDF01'; end if;
    end if;
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


create or replace function ops.remake_retry(p_ctx jsonb, p_remake uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; action_error text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.actor_kind = 'session' then
      if a.remote then raise exception 'admin required'; end if;
    else
      if not ('spend'=any(a.scopes)) then raise exception 'admin required'; end if;
      if coalesce(length(p_ctx->>'idempotency_key'),0)=0 then raise exception 'idempotency key required' using errcode='MDF01'; end if;
    end if;
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


-- Agent reads for remakes (design 7.3b): any actor with the read scope, its own rows only and
-- only the remakes of its test mode; anything else reads as not found. The source text stays
-- out: no source line, no literal translation, and the phrase gate's detail without the source
-- line it quotes. What remains of the source video (title, analysis, errors, the rewrite itself)
-- is data for the agent, never instructions: the answer says untrusted.

create or replace function ops.remake_get(p_ctx jsonb, p_remake uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; r public.remakes; j public.jobs; failed public.jobs; ev public.job_events; v_lyrics jsonb; v_gate boolean; v_trashed boolean;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    if not ('read'=any(a.scopes)) then raise exception 'admin required'; end if;
    -- A cancelled remake stays readable although its song left the library.
    select rm.* into r from public.remakes rm join public.versions v on v.id=rm.version_id
      where rm.id=p_remake and rm.owner_id=a.user_id and v.owner_id=a.user_id and v.test_run=a.test_mode;
    if not found then raise exception 'owned remake required'; end if;
    v_trashed := exists(select 1 from public.versions v where v.id=r.version_id and v.trashed_at is not null);
    select * into j from public.jobs where version_id=r.version_id and owner_id=a.user_id and status in ('queued','running') order by created_at desc,id desc limit 1;
    if j.id is not null then
      select * into ev from public.job_events where job_id=j.id and owner_id=a.user_id order by at desc,id desc limit 1;
    end if;
    select * into failed from public.jobs where version_id=r.version_id and owner_id=a.user_id and status='failed' order by finished_at desc nulls last,id desc limit 1;
    if r.lyrics is not null then
      v_lyrics := r.lyrics - 'literalTranslation';
      if jsonb_typeof(v_lyrics->'sections')='array' then
        v_lyrics := jsonb_set(v_lyrics,'{sections}',coalesce((
          select jsonb_agg(case when jsonb_typeof(s->'lines')='array' then jsonb_set(s,'{lines}',coalesce((
              select jsonb_agg(case when jsonb_typeof(l)='object' then l - 'source' else l end order by l_ord)
              from jsonb_array_elements(s->'lines') with ordinality as lines(l,l_ord)),'[]'::jsonb)) else s end order by s_ord)
          from jsonb_array_elements(v_lyrics->'sections') with ordinality as sections(s,s_ord)),'[]'::jsonb));
      end if;
      if jsonb_typeof(v_lyrics#>'{originality,phrase,detail}')='string' then
        v_lyrics := jsonb_set(v_lyrics,'{originality,phrase,detail}',
          to_jsonb(regexp_replace(v_lyrics#>>'{originality,phrase,detail}',' with ".*"$',' with a source line')));
      end if;
    end if;
    v_gate := public.remake_gate_ok(r.lyrics);
    data := jsonb_build_object('remake_id',r.id,'project_id',r.project_id,'version_id',r.version_id,
      'stage',r.stage,'lang',r.lang,'country',r.country,'video_id',r.video_id,'url',r.url,
      'error_code',r.error_code,
      'error',case when r.error is null then null else left(regexp_replace(regexp_replace(r.error,
        '(https?://|postgres(ql)?://)[^[:space:]]+','[redacted]','gi'),
        '(bearer[[:space:]]+|[a-z_]*(key|token|password|secret)[[:space:]]*[:=][[:space:]]*)[^[:space:],;]+','[redacted]','gi'),300) end,
      'revision',r.revision,'pending',r.pending is not null,'gate_ok',v_gate,
      'accept_ready',r.stage='review' and r.pending is null and j.id is null and v_gate and not v_trashed,
      'analysis',r.analysis,'lyrics',v_lyrics,
      'lyrics_text',case when r.lyrics is null then null else public.remake_lyrics_text(r.lyrics) end,
      'cost',r.cost,
      'active_job',case when j.id is null then null else jsonb_build_object('job_id',j.id,'stage',j.stage,'status',j.status,
        'mode',j.payload->>'mode','progress',ev.progress,'message',left(ev.message,300)) end,
      'failed_job',case when failed.id is null then null else jsonb_build_object('job_id',failed.id,'stage',failed.stage,
        'error',case when failed.error is null then null else left(regexp_replace(regexp_replace(failed.error,
          '(https?://|postgres(ql)?://)[^[:space:]]+','[redacted]','gi'),
          '(bearer[[:space:]]+|[a-z_]*(key|token|password|secret)[[:space:]]*[:=][[:space:]]*)[^[:space:],;]+','[redacted]','gi'),300) end) end,
      'untrusted',true,'created_at',r.created_at,'updated_at',r.updated_at);
  exception when others then
    err := ops.map_error(sqlstate,sqlerrm);
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'remake_get',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,'details',jsonb_build_object('reason',err->>'reason'));
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'remake_get',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.remake_get(jsonb, uuid) owner to postgres;
revoke execute on function ops.remake_get(jsonb, uuid) from public, anon, authenticated, service_role, mdf_auth;
grant execute on function ops.remake_get(jsonb, uuid) to mdf_web;


create or replace function ops.remakes_list(p_ctx jsonb, p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    if not ('read'=any(a.scopes)) then raise exception 'admin required'; end if;
    -- Newest first; dismissed remakes and trashed songs are left out, like the create panel does.
    select jsonb_build_object('remakes',coalesce(jsonb_agg(x.item order by x.created_at desc,x.id desc),'[]'::jsonb)) into data
      from (select rm.created_at,rm.id,jsonb_build_object('remake_id',rm.id,'project_id',rm.project_id,'version_id',rm.version_id,
          'stage',rm.stage,'lang',rm.lang,'title',rm.lyrics->>'title','error_code',rm.error_code,
          'created_at',rm.created_at,'updated_at',rm.updated_at) as item
        from public.remakes rm join public.versions v on v.id=rm.version_id
        where rm.owner_id=a.user_id and v.owner_id=a.user_id and v.test_run=a.test_mode
          and rm.dismissed_at is null and v.trashed_at is null
        order by rm.created_at desc,rm.id desc
        limit least(greatest(coalesce(p_limit,20),1),100)) x;
  exception when others then
    err := ops.map_error(sqlstate,sqlerrm);
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'remakes_list',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,'details',jsonb_build_object('reason',err->>'reason'));
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'remakes_list',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.remakes_list(jsonb, integer) owner to postgres;
revoke execute on function ops.remakes_list(jsonb, integer) from public, anon, authenticated, service_role, mdf_auth;
grant execute on function ops.remakes_list(jsonb, integer) to mdf_web;
