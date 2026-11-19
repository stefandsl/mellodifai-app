-- R31: the owner chooses the song's video while he approves its lyrics, before a take is picked.
-- Clients cannot update projects since the lockdown, so the choice goes through ops, local
-- session only. It writes projects.song_settings.video, which take_pick reads.
create function ops.song_video_set(p_ctx jsonb, p_version uuid, p_video text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; v_actor_key text; owned_version public.versions%rowtype; idem public.idempotency_keys%rowtype;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    if a.actor_kind <> 'session' or a.remote then raise exception 'local session required'; end if;
    if not ('create'=any(a.scopes)) then raise exception 'admin required'; end if;
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    select * into owned_version from public.versions where id=p_version and owner_id=a.user_id for update;
    if not found then raise exception 'owned version required'; end if;
    if owned_version.test_run <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'song_video_set',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'song_video_set',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    if p_video is null or p_video not in ('lyric','off','visualizer') then raise exception 'invalid video choice'; end if;
    -- After the take is picked the choice is made: audio_ready offers video_make instead.
    if owned_version.status not in ('drafting','lyrics_review','song_queued','takes_review') then
      raise exception 'the take is already chosen';
    end if;
    update public.projects p
      set song_settings = coalesce(p.song_settings, '{}'::jsonb) || jsonb_build_object('video', p_video)
      where p.id = owned_version.project_id and p.owner_id = a.user_id;
    data := jsonb_build_object('version_id', owned_version.id, 'video', p_video);
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'song_video_set',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,'details',jsonb_build_object('reason',err->>'reason'));
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'song_video_set',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.song_video_set(jsonb, uuid, text) owner to postgres;
revoke execute on function ops.song_video_set(jsonb, uuid, text) from public, anon, authenticated, service_role, mdf_auth;
grant execute on function ops.song_video_set(jsonb, uuid, text) to mdf_web;
