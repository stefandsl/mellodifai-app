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
