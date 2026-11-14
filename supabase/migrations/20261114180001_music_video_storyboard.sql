-- The music-video storyboard (rung 2b): one project per song version, its scenes (song
-- sections), shots (cut-plan segments), elements (characters, locations, props with reference
-- assets) and takes (draft or final generations of one shot). Data model after Parallax's
-- Cinema studio (github.com/nickvasilescu/parallax, MIT; no code copied).
-- Owners read their rows. The worker writes with the service role (public.mv_save_plan and
-- takes); clients write only through the ops.music_video_* functions.

create table public.mv_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  version_id uuid not null unique,
  title text not null check (length(title) between 1 and 200),
  language text not null check (length(language) between 1 and 40),
  genre text not null check (length(genre) between 1 and 80),
  aspect text not null default '16:9' check (aspect in ('16:9', '9:16', '1:1')),
  fps integer not null check (fps > 0),
  frames integer not null check (frames > 0),
  look jsonb not null default '{"style": "", "grade": "", "lighting": ""}'::jsonb
    check (jsonb_typeof(look) = 'object'),
  cut_plan jsonb not null check (jsonb_typeof(cut_plan) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (version_id, owner_id) references public.versions(id, owner_id) on delete cascade
);

create table public.mv_scenes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  project_id uuid not null,
  position integer not null check (position >= 0),
  section text not null check (length(section) <= 80),
  section_kind text not null
    check (section_kind in ('intro', 'verse', 'prechorus', 'chorus', 'bridge', 'outro', 'other')),
  start_frame integer not null check (start_frame >= 0),
  end_frame integer not null,
  check (end_frame > start_frame),
  unique (project_id, position),
  unique (id, project_id),
  foreign key (project_id, owner_id) references public.mv_projects(id, owner_id) on delete cascade
);

create table public.mv_elements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  project_id uuid not null,
  key text not null check (key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  kind text not null check (kind in ('character', 'location', 'prop')),
  name text not null check (length(name) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  ref_asset_ids text[] not null default '{}'
    check (cardinality(ref_asset_ids) <= 8 and array_position(ref_asset_ids, null) is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, key),
  unique (id, project_id),
  foreign key (project_id, owner_id) references public.mv_projects(id, owner_id) on delete cascade
);

create table public.mv_shots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  project_id uuid not null,
  scene_id uuid not null,
  position integer not null check (position >= 0),
  segment integer not null check (segment >= 0),
  start_frame integer not null check (start_frame >= 0),
  end_frame integer not null,
  kind text not null check (kind in ('lipsync-single', 'burst', 'instrumental-broll')),
  size text not null
    check (size in ('extreme-close-up', 'close-up', 'medium-close-up', 'medium', 'wide', 'extreme-wide')),
  angle text not null check (angle in ('eye-level', 'low', 'high', 'overhead')),
  movement text not null
    check (movement in ('static', 'push-in', 'pull-out', 'dolly', 'orbit', 'handheld', 'crane')),
  lens text not null check (lens in ('24mm', '35mm', '50mm', '85mm', '135mm')),
  burst text[] not null default '{}'
    check (burst <@ array['close-up', 'medium', 'wide', 'overhead', 'orbit', 'dolly']),
  mood text not null default '' check (length(mood) <= 200),
  lyrics text not null default '' check (length(lyrics) <= 2000),
  energy numeric(4, 3) not null default 0.5 check (energy between 0 and 1),
  cast_ids uuid[] not null default '{}'
    check (cardinality(cast_ids) <= 12 and array_position(cast_ids, null) is null),
  location_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_frame > start_frame),
  unique (project_id, position),
  unique (id, owner_id),
  foreign key (project_id, owner_id) references public.mv_projects(id, owner_id) on delete cascade,
  foreign key (scene_id, project_id) references public.mv_scenes(id, project_id) on delete cascade,
  foreign key (location_id, project_id) references public.mv_elements(id, project_id)
);

create table public.mv_takes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  shot_id uuid not null,
  phase text not null check (phase in ('draft', 'final')),
  model text not null check (length(model) between 1 and 120),
  prompt text check (length(prompt) <= 8000),
  refs text[] not null default '{}' check (array_position(refs, null) is null),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  cost_credits numeric(12, 2) not null check (cost_credits >= 0),
  gates jsonb,
  status text not null default 'quoted'
    check (status in ('quoted', 'queued', 'running', 'done', 'failed', 'cancelled')),
  chosen boolean not null default false,
  -- clock_timestamp keeps takes made in one transaction in order.
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  check (not chosen or status = 'done'),
  foreign key (shot_id, owner_id) references public.mv_shots(id, owner_id) on delete cascade
);
create unique index mv_takes_one_chosen on public.mv_takes (shot_id) where chosen;
create index mv_takes_shot_idx on public.mv_takes (shot_id, created_at);
create index mv_shots_scene_idx on public.mv_shots (scene_id, position);

do $tables$
declare t text;
begin
  foreach t in array array['mv_projects', 'mv_scenes', 'mv_elements', 'mv_shots', 'mv_takes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format($p$create policy "owners read %s" on public.%I for select to authenticated
      using (owner_id = (select auth.uid()) and exists (
        select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer')))$p$, t, t);
  end loop;
end
$tables$;
create trigger mv_projects_updated_at before update on public.mv_projects
for each row execute function public.set_updated_at();
create trigger mv_elements_updated_at before update on public.mv_elements
for each row execute function public.set_updated_at();
create trigger mv_shots_updated_at before update on public.mv_shots
for each row execute function public.set_updated_at();
create trigger mv_takes_updated_at before update on public.mv_takes
for each row execute function public.set_updated_at();

-- The worker's write of a song version's plan (rung 1). Elements are added by key and never
-- overwritten, so edits survive a new plan; scenes and shots are replaced while no take exists.
create function public.mv_save_plan(p_version uuid, p_plan jsonb) returns uuid
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v public.versions; pid uuid; shot jsonb; v_scene uuid; v_cast uuid[]; v_loc uuid; wanted integer;
begin
  select * into v from public.versions where id = p_version for update;
  if not found then raise exception 'version not found'; end if;
  if jsonb_typeof(p_plan->'project') is distinct from 'object' or jsonb_typeof(p_plan->'elements') is distinct from 'array'
     or jsonb_typeof(p_plan->'scenes') is distinct from 'array' or jsonb_typeof(p_plan->'shots') is distinct from 'array' then
    raise exception 'invalid plan';
  end if;
  select id into pid from public.mv_projects where version_id = p_version for update;
  if found then
    if exists (select 1 from public.mv_takes t join public.mv_shots s on s.id = t.shot_id where s.project_id = pid) then
      raise exception 'the storyboard already has takes';
    end if;
    delete from public.mv_scenes where project_id = pid;
    update public.mv_projects set title = p_plan#>>'{project,title}', language = p_plan#>>'{project,language}',
      genre = p_plan#>>'{project,genre}', aspect = p_plan#>>'{project,aspect}',
      fps = (p_plan#>>'{project,fps}')::integer, frames = (p_plan#>>'{project,frames}')::integer,
      look = p_plan#>'{project,look}', cut_plan = p_plan#>'{project,cut_plan}'
    where id = pid;
  else
    insert into public.mv_projects (owner_id, version_id, title, language, genre, aspect, fps, frames, look, cut_plan)
    values (v.owner_id, v.id, p_plan#>>'{project,title}', p_plan#>>'{project,language}', p_plan#>>'{project,genre}',
      p_plan#>>'{project,aspect}', (p_plan#>>'{project,fps}')::integer, (p_plan#>>'{project,frames}')::integer,
      p_plan#>'{project,look}', p_plan#>'{project,cut_plan}')
    returning id into pid;
  end if;
  insert into public.mv_elements (owner_id, project_id, key, kind, name, description, ref_asset_ids)
  select v.owner_id, pid, e->>'key', e->>'kind', e->>'name', coalesce(e->>'description', ''),
    coalesce(array(select jsonb_array_elements_text(e->'ref_asset_ids')), '{}')
  from jsonb_array_elements(p_plan->'elements') e
  on conflict (project_id, key) do nothing;
  insert into public.mv_scenes (owner_id, project_id, position, section, section_kind, start_frame, end_frame)
  select v.owner_id, pid, (s->>'position')::integer, s->>'section', s->>'section_kind',
    (s->>'start_frame')::integer, (s->>'end_frame')::integer
  from jsonb_array_elements(p_plan->'scenes') s;
  for shot in select value from jsonb_array_elements(p_plan->'shots') loop
    select id into v_scene from public.mv_scenes where project_id = pid and position = (shot->>'scene_position')::integer;
    if not found then raise exception 'invalid plan: shot % has no scene', shot->>'position'; end if;
    wanted := jsonb_array_length(coalesce(shot->'cast_keys', '[]'::jsonb));
    select coalesce(array_agg(el.id order by k.n), '{}') into v_cast
    from jsonb_array_elements_text(coalesce(shot->'cast_keys', '[]'::jsonb)) with ordinality k(key, n)
    join public.mv_elements el on el.project_id = pid and el.key = k.key and el.kind in ('character', 'prop');
    if cardinality(v_cast) <> wanted then raise exception 'invalid plan: bad cast in shot %', shot->>'position'; end if;
    v_loc := null;
    if coalesce(shot->>'location_key', '') <> '' then
      select id into v_loc from public.mv_elements where project_id = pid and key = shot->>'location_key' and kind = 'location';
      if not found then raise exception 'invalid plan: bad location in shot %', shot->>'position'; end if;
    end if;
    insert into public.mv_shots (owner_id, project_id, scene_id, position, segment, start_frame, end_frame, kind,
      size, angle, movement, lens, burst, mood, lyrics, energy, cast_ids, location_id)
    values (v.owner_id, pid, v_scene, (shot->>'position')::integer, (shot->>'segment')::integer,
      (shot->>'start_frame')::integer, (shot->>'end_frame')::integer, shot->>'kind', shot->>'size', shot->>'angle',
      shot->>'movement', shot->>'lens', coalesce(array(select jsonb_array_elements_text(shot->'burst')), '{}'),
      coalesce(shot->>'mood', ''), coalesce(shot->>'lyrics', ''), (shot->>'energy')::numeric, v_cast, v_loc);
  end loop;
  return pid;
end;
$$;
alter function public.mv_save_plan(uuid, jsonb) owner to postgres;
revoke execute on function public.mv_save_plan(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mv_save_plan(uuid, jsonb) to service_role;

-- The storyboard of one song version as one JSON document (null before the plan exists).
create function public.mv_storyboard_json(p_version uuid) returns jsonb
language sql stable security definer set search_path = '' set timezone = 'UTC' as $$
  select jsonb_build_object(
    'project', to_jsonb(p),
    'elements', coalesce((select jsonb_agg(to_jsonb(e) - 'owner_id' - 'created_at' order by e.key collate "C")
      from public.mv_elements e where e.project_id = p.id), '[]'::jsonb),
    'scenes', coalesce((select jsonb_agg((to_jsonb(sc) - 'owner_id') || jsonb_build_object('shots',
        coalesce((select jsonb_agg((to_jsonb(sh) - 'owner_id' - 'created_at') || jsonb_build_object('takes',
            coalesce((select jsonb_agg(to_jsonb(t) - 'owner_id' - 'updated_at' order by t.created_at, t.id)
              from public.mv_takes t where t.shot_id = sh.id), '[]'::jsonb)) order by sh.position)
          from public.mv_shots sh where sh.scene_id = sc.id), '[]'::jsonb)) order by sc.position)
      from public.mv_scenes sc where sc.project_id = p.id), '[]'::jsonb))
  from public.mv_projects p where p.version_id = p_version;
$$;
alter function public.mv_storyboard_json(uuid) owner to postgres;
revoke execute on function public.mv_storyboard_json(uuid) from public, anon, authenticated;
grant execute on function public.mv_storyboard_json(uuid) to service_role;

-- Agent operations (scope read for the storyboard, create for the writes). Requesting a take
-- only quotes it: nothing is queued or reserved until the approval step (F4) starts it.

create function ops.music_video_storyboard(p_ctx jsonb, p_version uuid) returns jsonb
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
    data := public.mv_storyboard_json(p_version);
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


create function ops.music_video_element_update(p_ctx jsonb, p_element uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; v_actor_key text; idem public.idempotency_keys%rowtype; el record; v_test boolean;
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
    select e.*, v.test_run into el from public.mv_elements e
      join public.mv_projects p on p.id=e.project_id join public.versions v on v.id=p.version_id
      where e.id=p_element and e.owner_id=a.user_id and v.owner_id=a.user_id for update of e;
    if not found then raise exception 'owned music video element required'; end if;
    v_test := el.test_run;
    if v_test <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'music_video_element_update',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'music_video_element_update',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    if jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb then raise exception 'nothing to save'; end if;
    if exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('name','description','ref_asset_ids')) then
      raise exception 'invalid patch field';
    end if;
    if p_patch ? 'name' and (jsonb_typeof(p_patch->'name') <> 'string' or length(btrim(p_patch->>'name')) not between 1 and 120) then
      raise exception 'invalid name';
    end if;
    if p_patch ? 'description' and (jsonb_typeof(p_patch->'description') <> 'string' or length(btrim(p_patch->>'description')) > 1000) then
      raise exception 'invalid description';
    end if;
    -- References are storage paths in the owner's own folder.
    if p_patch ? 'ref_asset_ids' and (jsonb_typeof(p_patch->'ref_asset_ids') <> 'array'
        or jsonb_array_length(p_patch->'ref_asset_ids') > 8
        or exists (select 1 from jsonb_array_elements(p_patch->'ref_asset_ids') r
          where jsonb_typeof(r) <> 'string' or length(r#>>'{}') > 300 or strpos(r#>>'{}', '..') > 0
            or left(r#>>'{}', 37) <> a.user_id::text || '/' or length(r#>>'{}') < 38)) then
      raise exception 'invalid reference assets';
    end if;
    update public.mv_elements e set
      name = case when p_patch ? 'name' then btrim(p_patch->>'name') else e.name end,
      description = case when p_patch ? 'description' then btrim(p_patch->>'description') else e.description end,
      ref_asset_ids = case when p_patch ? 'ref_asset_ids' then array(select jsonb_array_elements_text(p_patch->'ref_asset_ids')) else e.ref_asset_ids end
    where e.id = p_element
    returning jsonb_build_object('element', to_jsonb(e) - 'owner_id' - 'created_at') into data;
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'music_video_element_update',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,'details',jsonb_build_object('reason',err->>'reason'));
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'music_video_element_update',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.music_video_element_update(jsonb, uuid, jsonb) owner to postgres;
revoke execute on function ops.music_video_element_update(jsonb, uuid, jsonb) from public, anon, authenticated, service_role, mdf_auth;
grant execute on function ops.music_video_element_update(jsonb, uuid, jsonb) to mdf_web;


create function ops.music_video_shot_update(p_ctx jsonb, p_shot uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; v_actor_key text; idem public.idempotency_keys%rowtype; sh record; v_test boolean; v_cast uuid[];
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
    select s.*, v.test_run into sh from public.mv_shots s
      join public.mv_projects p on p.id=s.project_id join public.versions v on v.id=p.version_id
      where s.id=p_shot and s.owner_id=a.user_id and v.owner_id=a.user_id for update of s;
    if not found then raise exception 'owned music video shot required'; end if;
    v_test := sh.test_run;
    if v_test <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'music_video_shot_update',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'music_video_shot_update',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    if jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb then raise exception 'nothing to save'; end if;
    if exists (select 1 from jsonb_object_keys(p_patch) k
        where k not in ('size','angle','movement','lens','mood','cast_ids','location_id')) then
      raise exception 'invalid patch field';
    end if;
    if p_patch ? 'size' and coalesce(p_patch->>'size','') not in ('extreme-close-up','close-up','medium-close-up','medium','wide','extreme-wide') then
      raise exception 'invalid size';
    end if;
    if p_patch ? 'angle' and coalesce(p_patch->>'angle','') not in ('eye-level','low','high','overhead') then
      raise exception 'invalid angle';
    end if;
    if p_patch ? 'movement' and coalesce(p_patch->>'movement','') not in ('static','push-in','pull-out','dolly','orbit','handheld','crane') then
      raise exception 'invalid movement';
    end if;
    if p_patch ? 'lens' and coalesce(p_patch->>'lens','') not in ('24mm','35mm','50mm','85mm','135mm') then
      raise exception 'invalid lens';
    end if;
    if p_patch ? 'mood' and (jsonb_typeof(p_patch->'mood') <> 'string' or length(btrim(p_patch->>'mood')) > 200) then
      raise exception 'invalid mood';
    end if;
    if p_patch ? 'cast_ids' then
      if jsonb_typeof(p_patch->'cast_ids') <> 'array' or jsonb_array_length(p_patch->'cast_ids') > 12
          or exists (select 1 from jsonb_array_elements(p_patch->'cast_ids') c
            where jsonb_typeof(c) <> 'string' or (c#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'invalid cast';
      end if;
      select coalesce(array_agg(c.id::uuid order by c.n), '{}') into v_cast
        from jsonb_array_elements_text(p_patch->'cast_ids') with ordinality c(id, n);
      if (select count(distinct e.id) from public.mv_elements e
          where e.id = any(v_cast) and e.project_id = sh.project_id and e.kind in ('character','prop')) <> cardinality(v_cast) then
        raise exception 'invalid cast';
      end if;
    end if;
    if p_patch ? 'location_id' and jsonb_typeof(p_patch->'location_id') <> 'null' then
      if jsonb_typeof(p_patch->'location_id') <> 'string'
          or (p_patch->>'location_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or not exists (select 1 from public.mv_elements e where e.id = (p_patch->>'location_id')::uuid
            and e.project_id = sh.project_id and e.kind = 'location') then
        raise exception 'invalid location';
      end if;
    end if;
    if exists (select 1 from public.mv_takes t where t.shot_id = p_shot and t.status in ('queued','running')) then
      raise exception 'wait for the running step';
    end if;
    update public.mv_shots s set
      size = coalesce(p_patch->>'size', s.size),
      angle = coalesce(p_patch->>'angle', s.angle),
      movement = coalesce(p_patch->>'movement', s.movement),
      lens = coalesce(p_patch->>'lens', s.lens),
      mood = case when p_patch ? 'mood' then btrim(p_patch->>'mood') else s.mood end,
      cast_ids = case when p_patch ? 'cast_ids' then v_cast else s.cast_ids end,
      location_id = case when p_patch ? 'location_id' then (p_patch->>'location_id')::uuid else s.location_id end
    where s.id = p_shot
    returning jsonb_build_object('shot', to_jsonb(s) - 'owner_id' - 'created_at') into data;
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'music_video_shot_update',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,'details',jsonb_build_object('reason',err->>'reason'));
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'music_video_shot_update',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.music_video_shot_update(jsonb, uuid, jsonb) owner to postgres;
revoke execute on function ops.music_video_shot_update(jsonb, uuid, jsonb) from public, anon, authenticated, service_role, mdf_auth;
grant execute on function ops.music_video_shot_update(jsonb, uuid, jsonb) to mdf_web;


create function ops.music_video_take_request(p_ctx jsonb, p_shot uuid, p_phase text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; v_actor_key text; idem public.idempotency_keys%rowtype; sh record; v_test boolean; v_segment numeric; v_seconds integer; v_credits integer; v_model text; v_take uuid;
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
    select s.*, v.test_run, p.fps into sh from public.mv_shots s
      join public.mv_projects p on p.id=s.project_id join public.versions v on v.id=p.version_id
      where s.id=p_shot and s.owner_id=a.user_id and v.owner_id=a.user_id for update of s;
    if not found then raise exception 'owned music video shot required'; end if;
    v_test := sh.test_run;
    if v_test <> a.test_mode then raise exception 'test rule required' using errcode='MDF04'; end if;
    if p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'music_video_take_request',coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,'music_video_take_request',coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    if p_phase is null or p_phase not in ('draft','final') then raise exception 'invalid phase'; end if;
    if p_phase = 'final' and not exists (select 1 from public.mv_takes t
        where t.shot_id = p_shot and t.phase = 'draft' and t.status = 'done') then
      raise exception 'a finished draft of the shot required';
    end if;
    v_segment := (sh.end_frame - sh.start_frame)::numeric / sh.fps;
    v_seconds := greatest(4, ceil(v_segment - 0.000001))::integer;
    if v_seconds > 30 then raise exception 'invalid shot length: at most 30 s'; end if;
    v_credits := case p_phase when 'draft' then 17 else 95 end * (ceil(v_segment)::integer + v_seconds);
    v_model := case p_phase when 'draft' then 'bytedance/seedance-2-5' else 'bytedance/seedance-2-5-draft' end;
    -- One open quote per shot and phase: asking again refreshes it.
    update public.mv_takes t set model = v_model, cost_credits = v_credits,
        params = jsonb_build_object('seconds', v_seconds, 'resolution', case p_phase when 'draft' then '480p' else '1080p' end)
      where t.id = (select q.id from public.mv_takes q where q.shot_id = p_shot and q.phase = p_phase and q.status = 'quoted'
        order by q.created_at desc, q.id limit 1)
      returning t.id into v_take;
    if v_take is null then
      insert into public.mv_takes (owner_id, shot_id, phase, model, cost_credits, params, status)
      values (a.user_id, p_shot, p_phase, v_model, v_credits,
        jsonb_build_object('seconds', v_seconds, 'resolution', case p_phase when 'draft' then '480p' else '1080p' end), 'quoted')
      returning id into v_take;
    end if;
    data := jsonb_build_object('take_id', v_take, 'shot_id', p_shot, 'phase', p_phase, 'model', v_model,
      'status', 'quoted', 'price', jsonb_build_object('credits', v_credits, 'seconds', v_seconds));
    update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
      where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
  exception when others then
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'music_video_take_request',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,'details',jsonb_build_object('reason',err->>'reason'));
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'music_video_take_request',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;
alter function ops.music_video_take_request(jsonb, uuid, text) owner to postgres;
revoke execute on function ops.music_video_take_request(jsonb, uuid, text) from public, anon, authenticated, service_role, mdf_auth;
grant execute on function ops.music_video_take_request(jsonb, uuid, text) to mdf_web;
