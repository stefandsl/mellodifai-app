-- The free music-video plan (F3 rung 1) as an on-demand job stage: cut plan, shot list and
-- storyboard of a song whose lyric video was rendered, so its timing exists. It leaves the song
-- status alone. Owners (local session) and agent tokens with the create scope request it.
do $$
declare definition text;
begin
  select pg_get_constraintdef(c.oid) into definition from pg_constraint c
  where c.conrelid = 'public.jobs'::regclass and c.conname = 'jobs_stage_check';
  if definition is null then raise exception 'jobs_stage_check missing'; end if;
  execute 'alter table public.jobs drop constraint jobs_stage_check';
  execute format('alter table public.jobs add constraint jobs_stage_check check ((%s) or stage = %L)',
    substring(definition from 8 for length(definition) - 8), 'music_video_plan');
end; $$;

-- The same statuses as MUSIC_VIDEO_PLAN_STATUSES (packages/shared/src/status.ts).
create function public.request_music_video_plan(p_version uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version); job_id uuid; job_key text;
begin
  if v.status not in ('video_review','approved','publishing','published') then
    raise exception 'rendered video required';
  end if;
  if exists (select 1 from public.mv_takes t join public.mv_shots s on s.id = t.shot_id
      join public.mv_projects p on p.id = s.project_id where p.version_id = v.id) then
    raise exception 'the storyboard already has takes';
  end if;
  -- One plan per render: a new render may plan again.
  job_key := 'music_video_plan:' || v.id || ':' || coalesce(v.render_attempt, 1);
  insert into public.jobs(owner_id,version_id,stage,idempotency_key,payload)
  values (auth.uid(),v.id,'music_video_plan',job_key,'{}'::jsonb)
  on conflict (idempotency_key) do update
    set status='queued', attempts=0, error=null, result=null, worker_id=null,
        heartbeat_at=null, started_at=null, finished_at=null, not_before=null
    where public.jobs.status in ('failed','cancelled')
  returning id into job_id;
  if job_id is null then select id into job_id from public.jobs where idempotency_key=job_key; end if;
  return job_id;
end; $$;
alter function public.request_music_video_plan(uuid) owner to postgres;
revoke all on function public.request_music_video_plan(uuid) from public, anon, authenticated;

create function ops.music_video_plan_request(p_ctx jsonb, p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype; jid uuid;
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
    select * into owned_version from public.versions where id=p_version and owner_id=a.user_id for update;
    if not found then raise exception 'owned version required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'music_video_plan_request',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'music_video_plan_request',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    jid := public.request_music_video_plan(p_version);
    if exists (select 1 from public.jobs where id=jid and status='queued') then
      perform ops.reserve_job(jid);
    end if;
    select jsonb_build_object('jobs',jsonb_build_array(jsonb_build_object('job_id',j.id,'version_id',j.version_id,'stage',j.stage)))
      into data from public.jobs j where j.owner_id=a.user_id and j.id=jid;
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'music_video_plan_request',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'music_video_plan_request',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.music_video_plan_request(jsonb, uuid) owner to postgres;
revoke execute on function ops.music_video_plan_request(jsonb, uuid) from public, anon, authenticated, service_role, mdf_auth;
grant execute on function ops.music_video_plan_request(jsonb, uuid) to mdf_web;

-- The storyboard read answers an object, {"storyboard": <storyboard or null>}, like every other
-- operation, so MCP can return it as structured content.
create or replace function ops.music_video_storyboard(p_ctx jsonb, p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    if a.actor_kind = 'session' and a.remote then raise exception 'admin required'; end if;
    if not ('read'=any(a.scopes)) then raise exception 'admin required'; end if;
    if not exists (select 1 from public.versions v where v.id=p_version and v.owner_id=a.user_id and v.test_run=a.test_mode) then
      raise exception 'owned version required';
    end if;
    data := jsonb_build_object('storyboard', public.mv_storyboard_json(p_version));
  exception when others then
    err := ops.map_error(sqlstate,sqlerrm);
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'music_video_storyboard',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,'details',jsonb_build_object('reason',err->>'reason'));
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'music_video_storyboard',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.music_video_storyboard(jsonb, uuid) owner to postgres;
revoke execute on function ops.music_video_storyboard(jsonb, uuid) from public, anon, authenticated, service_role, mdf_auth;
grant execute on function ops.music_video_storyboard(jsonb, uuid) to mdf_web;

