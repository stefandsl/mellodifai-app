-- MCP discovery authenticates PATs before dispatch, without requiring an operation scope.
create function ops.resolve_pat(p_ctx jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  v_actor record;
begin
  if p_ctx->>'actor_kind' is distinct from 'pat' then
    raise exception 'authentication required';
  end if;
  select * into v_actor from ops._actor(p_ctx);
  return jsonb_build_object('user_id', v_actor.user_id, 'token_id', v_actor.token_id);
end;
$$;
alter function ops.resolve_pat(jsonb) owner to postgres;
revoke execute on function ops.resolve_pat(jsonb) from public, anon, authenticated, mdf_auth, service_role;
grant execute on function ops.resolve_pat(jsonb) to mdf_web;
