-- Cookie reads resolve identity themselves and remain usable after public RPC lockdown.

create function ops.my_remake(p_ctx jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; queue_position integer; r public.remakes; j public.jobs; failed public.jobs; ev public.job_events;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    if a.actor_kind <> 'session' then raise exception 'admin required'; end if;
  select rm.* into r from public.remakes rm join public.versions v on v.id = rm.version_id
  where rm.owner_id = a.user_id and rm.dismissed_at is null and v.owner_id=a.user_id and v.test_run=a.test_mode and v.trashed_at is null
  order by rm.created_at desc limit 1;
  if found then
  select * into j from public.jobs where version_id=r.version_id and owner_id=a.user_id and status in ('queued','running') order by created_at desc,id desc limit 1;
  if j.id is not null then
    select * into ev from public.job_events where job_id = j.id and owner_id=a.user_id order by at desc, id desc limit 1;
  end if;
  select * into failed from public.jobs
  where version_id = r.version_id and owner_id=a.user_id and status = 'failed' order by finished_at desc nulls last, id desc limit 1;
  select case when m.status = 'running' then 0 else 1 + (
      select count(*)::integer from public.jobs o left join public.versions v on v.id=o.version_id
      where o.id<>m.id and (v.id is null or v.trashed_at is null)
        and (o.status='running' or (o.status='queued' and (o.not_before is null or o.not_before<=now())
          and (o.created_at,o.id)<(m.created_at,m.id)))) end
      into queue_position from public.jobs m
      where m.id=j.id and m.owner_id=a.user_id and m.status in ('queued','running');
  data := jsonb_build_object(
    'remake', to_jsonb(r),
    'job', case when j.id is null then null else jsonb_build_object(
      'id', j.id, 'stage', j.stage, 'status', j.status, 'mode', j.payload->>'mode',
      'section', j.payload->>'section', 'progress', ev.progress, 'message', ev.message,
      'queuePosition', queue_position) end,
    'failedJob', case when failed.id is null then null else jsonb_build_object(
      'id', failed.id, 'stage', failed.stage, 'mode', failed.payload->>'mode', 'error', left(failed.error, 500)) end);
    end if;
  exception when others then
    err := ops.map_error(sqlstate,sqlerrm);
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'my_remake',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,'details',jsonb_build_object('reason',err->>'reason'));
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'my_remake',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.my_remake(jsonb) owner to postgres;
revoke execute on function ops.my_remake(jsonb) from public, anon, authenticated, service_role, mdf_auth;
grant execute on function ops.my_remake(jsonb) to mdf_web;

create function ops.lyrics_assist_state(p_ctx jsonb, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; queue_position integer; q public.lyric_requests; j public.jobs; ev public.job_events;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    if a.actor_kind <> 'session' then raise exception 'admin required'; end if;
  select * into q from public.lyric_requests where id = p_request and owner_id = a.user_id;
  if found then
  select * into j from public.jobs
  where owner_id = a.user_id and stage = 'lyrics_assist' and payload->>'request_id' = q.id::text
  order by created_at desc limit 1;
  if j.id is not null then
    select * into ev from public.job_events where job_id = j.id and owner_id=a.user_id order by at desc, id desc limit 1;
  end if;
  select case when m.status = 'running' then 0 else 1 + (
      select count(*)::integer from public.jobs o left join public.versions v on v.id=o.version_id
      where o.id<>m.id and (v.id is null or v.trashed_at is null)
        and (o.status='running' or (o.status='queued' and (o.not_before is null or o.not_before<=now())
          and (o.created_at,o.id)<(m.created_at,m.id)))) end
      into queue_position from public.jobs m
      where m.id=j.id and m.owner_id=a.user_id and m.status in ('queued','running');
  data := jsonb_build_object('id', q.id, 'mode', q.mode, 'status', j.status, 'progress', ev.progress,
    'message', ev.message, 'queuePosition', queue_position, 'result', q.result,
    'errorCode', q.error_code);
    end if;
  exception when others then
    err := ops.map_error(sqlstate,sqlerrm);
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'lyrics_assist_state',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,'details',jsonb_build_object('reason',err->>'reason'));
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'lyrics_assist_state',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.lyrics_assist_state(jsonb, uuid) owner to postgres;
revoke execute on function ops.lyrics_assist_state(jsonb, uuid) from public, anon, authenticated, service_role, mdf_auth;
grant execute on function ops.lyrics_assist_state(jsonb, uuid) to mdf_web;
