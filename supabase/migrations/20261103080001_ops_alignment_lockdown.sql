-- Keep the merged studio writes behind ops, then reassert the final ACL.
create function ops.lyric_alignment_request(p_ctx jsonb, p_version uuid, p_take uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; owned_version public.versions%rowtype; owned_job public.jobs%rowtype; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    if a.actor_kind <> 'session' or a.remote then raise exception 'local session required'; end if;
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
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'lyric_alignment_request',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'lyric_alignment_request',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    jid := public.request_lyric_alignment(p_version,p_take);
    ids := jsonb_build_array(jid);
    if exists (select 1 from public.jobs where id=jid and status='queued') then
      perform ops.reserve_job(jid);
    end if;
    select jsonb_build_object('jobs',coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'version_id',j.version_id,'stage',j.stage) order by j.created_at,j.id),'[]'::jsonb),'job_id',jid) || coalesce(data,'{}'::jsonb)
      into data from public.jobs j where j.owner_id=a.user_id and j.id in (select value::uuid from jsonb_array_elements_text(ids));
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'lyric_alignment_request',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when sqlstate='MDF02' and sqlerrm like 'cap_exceeded:%' then jsonb_build_object('scope',split_part(sqlerrm,':',2),'provider',split_part(sqlerrm,':',3),'unit',split_part(sqlerrm,':',4),'period',split_part(sqlerrm,':',5)) else '{}'::jsonb end || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'lyric_alignment_request',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.lyric_alignment_request(jsonb, uuid, uuid) owner to postgres;
revoke execute on function ops.lyric_alignment_request(jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function ops.lyric_alignment_request(jsonb, uuid, uuid) to mdf_web;


revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_playlists(), public.my_queue_positions(),
  public.my_section_queue(), public.my_stems_queue(), public.my_visualizer_queue(),
  public.playlist_membership(uuid[]) to authenticated;

revoke insert on public.jobs from authenticated;
revoke insert (idempotency_key, owner_id, payload, stage, version_id) on public.jobs from authenticated;
revoke update on public.jobs from authenticated;
revoke update (status) on public.jobs from authenticated;
drop policy if exists "owners enqueue jobs" on public.jobs;
drop policy if exists "owners cancel queued jobs" on public.jobs;

revoke insert on public.projects from authenticated;
revoke insert on public.versions from authenticated;
revoke insert (lang, lyric_pack, owner_id, project_id) on public.versions from authenticated;
drop function if exists public.resolve_kie_submission(uuid, text);

alter policy "owners delete studio files" on storage.objects
using (
  bucket_id = 'uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);
