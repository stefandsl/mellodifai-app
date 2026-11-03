-- Token operations: resolve identity before touching actor-owned rows.

create function ops.jobs_stamp_ctx() returns trigger
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare ctx jsonb;
begin
  if nullif(current_setting('mdf.job_ctx',true),'') is null then return new; end if;
  ctx := current_setting('mdf.job_ctx',true)::jsonb;
  new.fake_providers := new.fake_providers or coalesce((ctx->>'fake_providers')::boolean,false) or (tg_op='UPDATE' and old.fake_providers);
  new.token_id := coalesce((ctx->>'token_id')::uuid,new.token_id,case when tg_op='UPDATE' then old.token_id end);
  new.run_id := coalesce((ctx->>'run_id')::uuid,new.run_id);
  if new.status='queued' then
    perform set_config('mdf.job_ids', (coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb || to_jsonb(new.id))::text,true);
  end if;
  return new;
end;
$$;
alter function ops.jobs_stamp_ctx() owner to postgres;
revoke execute on function ops.jobs_stamp_ctx() from public, anon, authenticated;
grant execute on function ops.jobs_stamp_ctx() to service_role;

create trigger jobs_stamp_ctx before insert or update on public.jobs for each row execute function ops.jobs_stamp_ctx();

create function ops.versions_mark_test_run() returns trigger
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$

begin
  if nullif(current_setting('mdf.job_ctx',true),'') is not null then
    new.test_run := coalesce((current_setting('mdf.job_ctx',true)::jsonb->>'fake_providers')::boolean,false);
  end if;
  return new;
end;
$$;
alter function ops.versions_mark_test_run() owner to postgres;
revoke execute on function ops.versions_mark_test_run() from public, anon, authenticated;
grant execute on function ops.versions_mark_test_run() to service_role;

create trigger versions_mark_test_run before insert on public.versions for each row execute function ops.versions_mark_test_run();

create function ops.songs_list(p_ctx jsonb, p_cursor text default null, p_limit integer default 20, p_status text default null, p_include_trashed boolean default false) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid; cursor_data jsonb; cursor_at timestamptz; cursor_id uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('read'=any(a.scopes)) then raise exception 'admin required'; end if;

    if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid limit'; end if;
    if p_cursor is not null then
      begin
        cursor_data := convert_from(decode(p_cursor,'base64'),'UTF8')::jsonb;
        cursor_at := (cursor_data->>0)::timestamptz; cursor_id := (cursor_data->>1)::uuid;
        if cursor_at is null or cursor_id is null then raise exception 'invalid cursor'; end if;
      exception when others then raise exception 'invalid cursor'; end;
    end if;
    with page as (
      select v.*,p.topic from public.versions v join public.projects p on p.id=v.project_id and p.owner_id=a.user_id
      where v.owner_id=a.user_id and v.test_run=a.test_mode and (p_include_trashed or v.trashed_at is null)
        and (p_status is null or v.status=p_status) and (p_cursor is null or (v.updated_at,v.id)<(cursor_at,cursor_id))
      order by v.updated_at desc,v.id desc limit p_limit+1
    ), chosen as (select * from page order by updated_at desc,id desc limit p_limit)
    select jsonb_build_object('songs',coalesce((select jsonb_agg(jsonb_build_object('version_id',v.id,'project_id',v.project_id,'lang',v.lang,'status',v.status,
      'created_at',v.created_at,'updated_at',v.updated_at,'test_run',v.test_run,
      'title',coalesce(v.display_title,v.lyric_pack->>'title',p.topic),
      'take_count',(select count(*) from public.takes t where t.version_id=v.id and t.owner_id=a.user_id and t.generation=v.generation_count),
      'has_chosen_take',v.chosen_take_id is not null,'trashed',v.trashed_at is not null) order by v.updated_at desc,v.id desc) from chosen v cross join lateral (select v.topic) p),'[]'::jsonb),
      'next_cursor',case when (select count(*) from page)>p_limit then
        (select replace(encode(convert_to(jsonb_build_array(updated_at,id)::text,'UTF8'),'base64'),E'\n','') from chosen order by updated_at,id limit 1) else null end) into data;
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    err := ops.map_error(sqlstate,sqlerrm);
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'songs_list',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'songs_list',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.songs_list(jsonb, text, integer, text, boolean) owner to postgres;
revoke execute on function ops.songs_list(jsonb, text, integer, text, boolean) from public, anon, authenticated;
grant execute on function ops.songs_list(jsonb, text, integer, text, boolean) to mdf_web;

create function ops.song_get(p_ctx jsonb, p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('read'=any(a.scopes)) then raise exception 'admin required'; end if;
    select * into owned_version from public.versions where id=p_version and owner_id=a.user_id and trashed_at is null for update;
    if not found then raise exception 'owned version required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    select jsonb_build_object('version_id',v.id,'project_id',v.project_id,'lang',v.lang,'status',v.status,
      'created_at',v.created_at,'updated_at',v.updated_at,'test_run',v.test_run,
      'title',coalesce(v.display_title,v.lyric_pack->>'title',p.topic),
      'take_count',(select count(*) from public.takes t where t.version_id=v.id and t.owner_id=a.user_id and t.generation=v.generation_count),
      'has_chosen_take',v.chosen_take_id is not null,'trashed',v.trashed_at is not null) || jsonb_build_object('lyrics',v.lyric_pack,
      'takes',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'generation',t.generation,'take_number',t.take_number,'engine',t.engine,'chosen',coalesce(t.id=v.chosen_take_id,false)) order by t.generation,t.take_number) from public.takes t where t.version_id=v.id and t.owner_id=a.user_id),'[]'::jsonb),
      'renders',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'render_attempt',r.render_attempt,'approved',r.approved_at is not null,
        'qa_passed',case when jsonb_typeof(r.qa_results->'gates')='array' then jsonb_array_length(r.qa_results->'gates')>0 and not exists(select 1 from jsonb_array_elements(r.qa_results->'gates') g where g->>'pass' is distinct from 'true') else false end) order by r.created_at,r.id) from public.renders r where r.version_id=v.id and r.owner_id=a.user_id),'[]'::jsonb),
      'active_jobs',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'version_id',j.version_id,'stage',j.stage,'status',j.status,
        'attempts',j.attempts,'created_at',j.created_at,'started_at',j.started_at,'finished_at',j.finished_at,
        'progress',(select e.progress/100 from public.job_events e where e.job_id=j.id and e.owner_id=a.user_id order by e.id desc limit 1),
        'error',case when j.error is null then null else left(regexp_replace(regexp_replace(j.error,
          '(https?://|postgres(ql)?://)[^[:space:]]+','[redacted]','gi'),
          '(bearer[[:space:]]+|[a-z_]*(key|token|password|secret)[[:space:]]*[:=][[:space:]]*)[^[:space:],;]+','[redacted]','gi'),300) end) order by j.created_at,j.id) from public.jobs j where j.version_id=v.id and j.owner_id=a.user_id and j.status in ('queued','running')),'[]'::jsonb),
      'lyric_jury',case when v.lyric_jury is null then null else jsonb_build_object('available',v.lyric_jury->'available','passed',v.lyric_jury->'passed','scores',v.lyric_jury->'scores') end,
      'cost_usd',coalesce((select sum(e.usd) from public.spend_entries e join public.reservations r on r.id=e.reservation_id where r.version_id=v.id and r.user_id=a.user_id and e.state='settled'),0))
      into data from public.versions v join public.projects p on p.id=v.project_id and p.owner_id=a.user_id where v.id=p_version and v.owner_id=a.user_id;
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    err := ops.map_error(sqlstate,sqlerrm);
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'song_get',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'song_get',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.song_get(jsonb, uuid) owner to postgres;
revoke execute on function ops.song_get(jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.song_get(jsonb, uuid) to mdf_web;

create function ops.job_status(p_ctx jsonb, p_job uuid, p_events_after bigint default null) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('read'=any(a.scopes)) then raise exception 'admin required'; end if;
    select * into owned_job from public.jobs where id=p_job and owner_id=a.user_id for update;
    if not found then raise exception 'job not found'; end if;
    select * into owned_version from public.versions where id=owned_job.version_id and owner_id=a.user_id for update;
    if found and owned_version.trashed_at is not null then raise exception 'owned version required'; end if;
    if found and owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    select jsonb_build_object('job',jsonb_build_object('id',j.id,'version_id',j.version_id,'stage',j.stage,'status',j.status,
        'attempts',j.attempts,'created_at',j.created_at,'started_at',j.started_at,'finished_at',j.finished_at,
        'progress',(select e.progress/100 from public.job_events e where e.job_id=j.id and e.owner_id=a.user_id order by e.id desc limit 1),
        'error',case when j.error is null then null else left(regexp_replace(regexp_replace(j.error,
          '(https?://|postgres(ql)?://)[^[:space:]]+','[redacted]','gi'),
          '(bearer[[:space:]]+|[a-z_]*(key|token|password|secret)[[:space:]]*[:=][[:space:]]*)[^[:space:],;]+','[redacted]','gi'),300) end),'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'at',e.at,'level',e.level,'message',left(e.message,300),'progress',e.progress) order by e.id)
      from public.job_events e where e.job_id=j.id and e.owner_id=a.user_id and (p_events_after is null or e.id>p_events_after)),'[]'::jsonb)) into data from public.jobs j where j.id=p_job and j.owner_id=a.user_id;
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    err := ops.map_error(sqlstate,sqlerrm);
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'job_status',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'job_status',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.job_status(jsonb, uuid, bigint) owner to postgres;
revoke execute on function ops.job_status(jsonb, uuid, bigint) from public, anon, authenticated;
grant execute on function ops.job_status(jsonb, uuid, bigint) to mdf_web;

create function ops.song_create(p_ctx jsonb, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid; pid uuid; first_pid uuid; song_count integer; song_index integer; settings jsonb; prompt text;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('spend'=any(a.scopes)) then raise exception 'admin required'; end if;

    if a.actor_kind <> 'session' and coalesce(length(p_ctx->>'idempotency_key'),0)=0 then
      raise exception 'idempotency key required' using errcode='MDF01';
    end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'song_create',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'song_create',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'invalid song input'; end if;
    if a.actor_kind<>'session' and p_input->'settings'->'source' ? 'upload' then raise exception 'invalid upload source'; end if;
    if p_input->'settings'->'source' ? 'takeId' then
      select ver.* into owned_version from public.takes t join public.versions ver on ver.id=t.version_id
        where t.id=(p_input->'settings'->'source'->>'takeId')::uuid and t.owner_id=a.user_id and ver.owner_id=a.user_id;
      if not found then raise exception 'source take required'; end if;
      if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    end if;
    song_count := coalesce((p_input->>'count')::integer,1);
    if song_count not between 1 and 4 or p_input->>'mode' is null or p_input->>'mode' not in ('simple','advanced') then raise exception 'invalid song input'; end if;
    prompt := p_input->>'prompt';
    if p_input->>'mode'='advanced' and coalesce(prompt,'')='' then
      prompt := coalesce(nullif(p_input->'settings'->>'title',''),
        (select btrim(line) from regexp_split_to_table(p_input->>'lyrics',E'\n') line where btrim(line)<>'' and btrim(line) !~ '^\[.*\]$' limit 1),
        nullif(left(p_input->>'styles',250),''),p_input->'settings'->'source'->>'title');
    end if;
    for song_index in 0..song_count-1 loop
      settings := p_input->'settings';
      if settings ? 'seed' then settings := jsonb_set(settings,'{seed}',to_jsonb(least(281474976710654,(settings->>'seed')::bigint+2*song_index))); end if;
      pid := public.create_song(prompt,case when p_input->>'mode'='simple' then '' else p_input->>'lyrics' end,
        array(select jsonb_array_elements_text(p_input->'languages')),
        case when p_input->>'mode'='simple' then '' else p_input->>'styles' end,p_input->>'vocalGender',settings);
      first_pid := coalesce(first_pid,pid);
    end loop;
    data := jsonb_build_object('project_id',first_pid);
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
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'song_create',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'song_create',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.song_create(jsonb, jsonb) owner to postgres;
revoke execute on function ops.song_create(jsonb, jsonb) from public, anon, authenticated;
grant execute on function ops.song_create(jsonb, jsonb) to mdf_web;

create function ops.lyrics_approve(p_ctx jsonb, p_version uuid, p_lyric_pack jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('spend'=any(a.scopes)) then raise exception 'admin required'; end if;
    select * into owned_version from public.versions where id=p_version and owner_id=a.user_id for update;
    if not found then raise exception 'owned version required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if a.actor_kind <> 'session' and coalesce(length(p_ctx->>'idempotency_key'),0)=0 then
      raise exception 'idempotency key required' using errcode='MDF01';
    end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'lyrics_approve',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'lyrics_approve',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.approve_lyrics(p_version,p_lyric_pack);
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
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'lyrics_approve',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'lyrics_approve',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.lyrics_approve(jsonb, uuid, jsonb) owner to postgres;
revoke execute on function ops.lyrics_approve(jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function ops.lyrics_approve(jsonb, uuid, jsonb) to mdf_web;

create function ops.lyrics_back(p_ctx jsonb, p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('create'=any(a.scopes)) then raise exception 'admin required'; end if;
    select * into owned_version from public.versions where id=p_version and owner_id=a.user_id for update;
    if not found then raise exception 'owned version required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if a.actor_kind <> 'session' and coalesce(length(p_ctx->>'idempotency_key'),0)=0 then
      raise exception 'idempotency key required' using errcode='MDF01';
    end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'lyrics_back',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'lyrics_back',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.back_to_lyrics(p_version);
    select jsonb_build_object('version_id',id,'status',status) into data from public.versions where id=p_version and owner_id=a.user_id;
    ids := coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb;
    for jid in select jobs.id from public.jobs jobs where jobs.owner_id=a.user_id and jobs.id in (select value::uuid from jsonb_array_elements_text(ids)) loop
      perform ops.reserve_job(jid);
    end loop;
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'lyrics_back',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'lyrics_back',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.lyrics_back(jsonb, uuid) owner to postgres;
revoke execute on function ops.lyrics_back(jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.lyrics_back(jsonb, uuid) to mdf_web;

create function ops.song_generate_again(p_ctx jsonb, p_version uuid, p_generation integer) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('spend'=any(a.scopes)) then raise exception 'admin required'; end if;
    select * into owned_version from public.versions where id=p_version and owner_id=a.user_id for update;
    if not found then raise exception 'owned version required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if a.actor_kind <> 'session' and coalesce(length(p_ctx->>'idempotency_key'),0)=0 then
      raise exception 'idempotency key required' using errcode='MDF01';
    end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'song_generate_again',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'song_generate_again',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.generate_again(p_version,p_generation);
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
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'song_generate_again',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'song_generate_again',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.song_generate_again(jsonb, uuid, integer) owner to postgres;
revoke execute on function ops.song_generate_again(jsonb, uuid, integer) from public, anon, authenticated;
grant execute on function ops.song_generate_again(jsonb, uuid, integer) to mdf_web;

create function ops.take_pick(p_ctx jsonb, p_version uuid, p_take uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('create'=any(a.scopes)) then raise exception 'admin required'; end if;
    select * into owned_version from public.versions where id=p_version and owner_id=a.user_id for update;
    if not found then raise exception 'owned version required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if a.actor_kind <> 'session' and coalesce(length(p_ctx->>'idempotency_key'),0)=0 then
      raise exception 'idempotency key required' using errcode='MDF01';
    end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'take_pick',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'take_pick',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.pick_take(p_version,p_take);
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
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'take_pick',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'take_pick',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.take_pick(jsonb, uuid, uuid) owner to postgres;
revoke execute on function ops.take_pick(jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function ops.take_pick(jsonb, uuid, uuid) to mdf_web;

create function ops.video_make(p_ctx jsonb, p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('create'=any(a.scopes)) then raise exception 'admin required'; end if;
    select * into owned_version from public.versions where id=p_version and owner_id=a.user_id for update;
    if not found then raise exception 'owned version required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if a.actor_kind <> 'session' and coalesce(length(p_ctx->>'idempotency_key'),0)=0 then
      raise exception 'idempotency key required' using errcode='MDF01';
    end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'video_make',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'video_make',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.make_video(p_version);
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
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'video_make',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'video_make',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.video_make(jsonb, uuid) owner to postgres;
revoke execute on function ops.video_make(jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.video_make(jsonb, uuid) to mdf_web;

create function ops.video_rerender(p_ctx jsonb, p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('create'=any(a.scopes)) then raise exception 'admin required'; end if;
    select * into owned_version from public.versions where id=p_version and owner_id=a.user_id for update;
    if not found then raise exception 'owned version required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if a.actor_kind <> 'session' and coalesce(length(p_ctx->>'idempotency_key'),0)=0 then
      raise exception 'idempotency key required' using errcode='MDF01';
    end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'video_rerender',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'video_rerender',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.render_again(p_version);
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
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'video_rerender',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'video_rerender',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.video_rerender(jsonb, uuid) owner to postgres;
revoke execute on function ops.video_rerender(jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.video_rerender(jsonb, uuid) to mdf_web;

create function ops.video_approve(p_ctx jsonb, p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('create'=any(a.scopes)) then raise exception 'admin required'; end if;
    select * into owned_version from public.versions where id=p_version and owner_id=a.user_id for update;
    if not found then raise exception 'owned version required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if a.actor_kind <> 'session' and coalesce(length(p_ctx->>'idempotency_key'),0)=0 then
      raise exception 'idempotency key required' using errcode='MDF01';
    end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'video_approve',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'video_approve',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.approve_video(p_version,null);
    select jsonb_build_object('version_id',id,'status',status) into data from public.versions where id=p_version and owner_id=a.user_id;
    ids := coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb;
    for jid in select jobs.id from public.jobs jobs where jobs.owner_id=a.user_id and jobs.id in (select value::uuid from jsonb_array_elements_text(ids)) loop
      perform ops.reserve_job(jid);
    end loop;
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'video_approve',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'video_approve',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.video_approve(jsonb, uuid) owner to postgres;
revoke execute on function ops.video_approve(jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.video_approve(jsonb, uuid) to mdf_web;

create function ops.stems_request(p_ctx jsonb, p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('create'=any(a.scopes)) then raise exception 'admin required'; end if;
    select * into owned_version from public.versions where id=p_version and owner_id=a.user_id for update;
    if not found then raise exception 'owned version required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if a.actor_kind <> 'session' and coalesce(length(p_ctx->>'idempotency_key'),0)=0 then
      raise exception 'idempotency key required' using errcode='MDF01';
    end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'stems_request',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'stems_request',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.request_stems(p_version);
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
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'stems_request',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'stems_request',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.stems_request(jsonb, uuid) owner to postgres;
revoke execute on function ops.stems_request(jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.stems_request(jsonb, uuid) to mdf_web;

create function ops.visualizer_request(p_ctx jsonb, p_version uuid, p_params jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('create'=any(a.scopes)) then raise exception 'admin required'; end if;
    select * into owned_version from public.versions where id=p_version and owner_id=a.user_id for update;
    if not found then raise exception 'owned version required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if a.actor_kind <> 'session' and coalesce(length(p_ctx->>'idempotency_key'),0)=0 then
      raise exception 'idempotency key required' using errcode='MDF01';
    end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'visualizer_request',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'visualizer_request',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.request_visualizer(p_version,p_params);
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
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'visualizer_request',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'visualizer_request',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.visualizer_request(jsonb, uuid, jsonb) owner to postgres;
revoke execute on function ops.visualizer_request(jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function ops.visualizer_request(jsonb, uuid, jsonb) to mdf_web;

create function ops.stage_retry(p_ctx jsonb, p_job uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('create'=any(a.scopes)) then raise exception 'admin required'; end if;
    select * into owned_job from public.jobs where id=p_job and owner_id=a.user_id for update;
    if not found then raise exception 'job not found'; end if;
    select * into owned_version from public.versions where id=owned_job.version_id and owner_id=a.user_id for update;
    if found and owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if owned_job.stage in ('publish','set_privacy') and (a.actor_kind<>'session' or a.role<>'admin' or a.remote) then raise exception 'admin required'; end if;
    if owned_job.stage in ('draft_lyrics','generate_song','replace_section','import_audio','timing','lyrics_assist') and not ('spend'=any(a.scopes)) then raise exception 'admin required'; end if;
    if a.actor_kind <> 'session' and coalesce(length(p_ctx->>'idempotency_key'),0)=0 then
      raise exception 'idempotency key required' using errcode='MDF01';
    end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'stage_retry',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'stage_retry',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    perform public.retry_stage(owned_job.version_id,p_job);
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
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'stage_retry',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'stage_retry',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.stage_retry(jsonb, uuid) owner to postgres;
revoke execute on function ops.stage_retry(jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.stage_retry(jsonb, uuid) to mdf_web;

create function ops.job_cancel(p_ctx jsonb, p_job uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if not ('create'=any(a.scopes)) then raise exception 'admin required'; end if;
    select * into owned_job from public.jobs where id=p_job and owner_id=a.user_id for update;
    if not found then raise exception 'job not found'; end if;
    select * into owned_version from public.versions where id=owned_job.version_id and owner_id=a.user_id for update;
    if found and owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if a.actor_kind <> 'session' and coalesce(length(p_ctx->>'idempotency_key'),0)=0 then
      raise exception 'idempotency key required' using errcode='MDF01';
    end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'job_cancel',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'job_cancel',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    if owned_job.status not in ('queued','running') then raise exception 'active job required'; end if;
    update public.jobs set status='cancelled',finished_at=now() where id=p_job and owner_id=a.user_id;
    select jsonb_build_object('job',jsonb_build_object('id',j.id,'version_id',j.version_id,'stage',j.stage,'status',j.status,
        'attempts',j.attempts,'created_at',j.created_at,'started_at',j.started_at,'finished_at',j.finished_at,
        'progress',(select e.progress/100 from public.job_events e where e.job_id=j.id and e.owner_id=a.user_id order by e.id desc limit 1),
        'error',case when j.error is null then null else left(regexp_replace(regexp_replace(j.error,
          '(https?://|postgres(ql)?://)[^[:space:]]+','[redacted]','gi'),
          '(bearer[[:space:]]+|[a-z_]*(key|token|password|secret)[[:space:]]*[:=][[:space:]]*)[^[:space:],;]+','[redacted]','gi'),300) end)) into data from public.jobs j where j.id=p_job and j.owner_id=a.user_id;
    ids := coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb;
    for jid in select jobs.id from public.jobs jobs where jobs.owner_id=a.user_id and jobs.id in (select value::uuid from jsonb_array_elements_text(ids)) loop
      perform ops.reserve_job(jid);
    end loop;
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'job_cancel',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'job_cancel',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.job_cancel(jsonb, uuid) owner to postgres;
revoke execute on function ops.job_cancel(jsonb, uuid) from public, anon, authenticated;
grant execute on function ops.job_cancel(jsonb, uuid) to mdf_web;
