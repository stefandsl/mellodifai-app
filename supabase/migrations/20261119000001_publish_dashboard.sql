-- "Pubblica" (research/2026-11-19/publishing-design.md, YouTube only for now): one schedule per
-- video, one destination per platform, approval cards for agents, the owner's standing rules and a
-- veto window that stays open until the provider handoff starts (fix for the open M4 finding).
-- Lock order everywhere (veto, edits, approval, dispatch, recovery): the publish_schedules row
-- first, then its publish_destinations rows ordered by id.

create table public.publish_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('youtube','tiktok','instagram','facebook','linkedin','x','threads','pinterest','bluesky')),
  max_price_eur numeric(10,2) not null default 0 check (max_price_eur >= 0),
  require_veto_hours integer not null default 24 check (require_veto_hours between 1 and 168),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index publish_rules_owner on public.publish_rules(owner_id, platform);

create table public.publish_schedules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  version_id uuid not null references public.versions(id) on delete cascade,
  render_id uuid not null references public.renders(id) on delete cascade,
  slot_at timestamptz,
  state text not null default 'draft' check (state in ('draft','awaiting_approval','scheduled','publishing',
    'published','failed','held','vetoed','cancelled','rejected','expired')),
  revision integer not null default 1,
  created_via text not null check (created_via in ('session','pat','oauth')),
  token_id uuid references public.agent_tokens(id) on delete set null,
  vetoed_at timestamptz,
  vetoed_via text,
  held_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One open plan per video: the dashboard shows one video and its one plan.
create unique index publish_schedules_one_open on public.publish_schedules(version_id)
  where state in ('draft','awaiting_approval','scheduled','publishing','held');
create index publish_schedules_due on public.publish_schedules(slot_at) where state in ('scheduled','publishing');

create table public.publish_destinations (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.publish_schedules(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('youtube','tiktok','instagram','facebook','linkedin','x','threads','pinterest','bluesky')),
  provider text not null check (provider in ('native','postiz','blotato')),
  account_id text not null default 'default',
  draft jsonb not null default '{}'::jsonb check (jsonb_typeof(draft) = 'object'),
  state text not null default 'draft' check (state in ('draft','scheduled','claimed','intent_recorded',
    'handoff_started','published','failed','unknown','vetoed','cancelled')),
  claim_token uuid,
  claimed_by text,
  claim_expires_at timestamptz,
  attempt_id uuid,
  attempts integer not null default 0,
  intent_at timestamptz,
  handoff_at timestamptz,
  published_at timestamptz,
  external_id text,
  external_url text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, platform, account_id)
);
create index publish_destinations_claims on public.publish_destinations(claim_expires_at)
  where state in ('claimed','intent_recorded','handoff_started');

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  schedule_id uuid not null references public.publish_schedules(id) on delete cascade,
  op text not null check (op in ('publish_schedule')),
  payload_hash text not null,
  summary text not null,
  price_eur numeric(10,2) not null default 0 check (price_eur >= 0),
  public_effect boolean not null default true,
  platforms text[] not null,
  requested_via text not null check (requested_via in ('session','pat','oauth')),
  token_id uuid references public.agent_tokens(id) on delete set null,
  expires_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','approved','rejected','expired')),
  decided_at timestamptz,
  decided_via text check (decided_via in ('owner','rule','system')),
  rule_id uuid references public.publish_rules(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create unique index approval_requests_one_pending on public.approval_requests(schedule_id) where state = 'pending';
create index approval_requests_owner on public.approval_requests(owner_id, state);

create table public.publish_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  schedule_id uuid not null references public.publish_schedules(id) on delete cascade,
  destination_id uuid references public.publish_destinations(id) on delete cascade,
  kind text not null,
  actor text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default clock_timestamp()
);
create index publish_events_schedule on public.publish_events(schedule_id, at);

-- Clients reach these tables only through ops.
alter table public.publish_rules enable row level security;
alter table public.publish_schedules enable row level security;
alter table public.publish_destinations enable row level security;
alter table public.approval_requests enable row level security;
alter table public.publish_events enable row level security;
revoke all on public.publish_rules, public.publish_schedules, public.publish_destinations,
  public.approval_requests, public.publish_events from anon, authenticated;

-- History line of a schedule.
create function ops._publish_event(p_schedule uuid, p_destination uuid, p_kind text, p_actor text, p_detail jsonb)
returns void language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  insert into public.publish_events(owner_id,schedule_id,destination_id,kind,actor,detail)
    select s.owner_id,s.id,p_destination,p_kind,p_actor,coalesce(p_detail,'{}'::jsonb)
    from public.publish_schedules s where s.id=p_schedule;
end;
$$;

-- Hard limits of a draft, written from the YouTube Data API docs (checked 2026-11-19). The web
-- lint (packages/shared/src/publishing/lint.ts) repeats them and adds warnings that never block.
create function ops._publish_problems(p_platform text, p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  found jsonb := '[]'::jsonb;
  v_title text := coalesce(p_draft->>'title','');
  v_description text := coalesce(p_draft->>'description','');
  v_tags jsonb := coalesce(p_draft->'tags','[]'::jsonb);
  v_tag_chars integer;
begin
  if p_platform <> 'youtube' then
    return jsonb_build_array(jsonb_build_object('field','platform','code','platform_soon'));
  end if;
  if length(btrim(v_title)) = 0 then
    found := found || jsonb_build_object('field','title','code','required');
  elsif length(v_title) > 100 then
    found := found || jsonb_build_object('field','title','code','too_long','limit',100);
  end if;
  if v_title ~ '[<>]' then found := found || jsonb_build_object('field','title','code','angle_brackets'); end if;
  if length(v_description) > 5000 then
    found := found || jsonb_build_object('field','description','code','too_long','limit',5000);
  end if;
  if v_description ~ '[<>]' then found := found || jsonb_build_object('field','description','code','angle_brackets'); end if;
  if jsonb_typeof(v_tags) <> 'array' or exists (select 1 from jsonb_array_elements(v_tags) t where jsonb_typeof(t) <> 'string') then
    found := found || jsonb_build_object('field','tags','code','invalid');
  else
    -- YouTube counts a tag with a space as quoted (+2) and a comma between tags.
    select coalesce(sum(length(t) + case when t ~ ' ' then 2 else 0 end),0) + greatest(count(*)-1,0) into v_tag_chars
      from jsonb_array_elements_text(v_tags) t;
    if v_tag_chars > 500 then found := found || jsonb_build_object('field','tags','code','too_long','limit',500); end if;
  end if;
  if length(coalesce(p_draft->>'thumbnail_text','')) > 60 then
    found := found || jsonb_build_object('field','thumbnail_text','code','too_long','limit',60);
  end if;
  return found;
end;
$$;

-- Thumbnail text goes on the master's base thumbnail (the render's thumbnail_path, or
-- thumbnail-1280x720.png / thumbnail.png next to its preview, as the dashboard finds it). Text
-- without a base image blocks the approval with this problem instead of failing at the slot.
create function ops._publish_thumbnail_problems(p_schedule uuid, p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  if btrim(coalesce(p_draft->>'thumbnail_text','')) = '' or exists (
    select 1 from public.publish_schedules s join public.renders r on r.id=s.render_id
      join storage.objects o on o.bucket_id='previews' and o.name in (r.qa_results#>>'{assets,thumbnail_path}',
        regexp_replace(r.preview_path,'/[^/]*$','')||'/thumbnail-1280x720.png',
        regexp_replace(r.preview_path,'/[^/]*$','')||'/thumbnail.png')
    where s.id=p_schedule) then
    return '[]'::jsonb;
  end if;
  return jsonb_build_array(jsonb_build_object('field','thumbnail_text','code','no_base_image'));
end;
$$;

-- The chapter list the private upload adds (publicationDefaults in
-- packages/shared/src/publication-defaults.ts: the render's or the version's storyboard sections,
-- the first at 0:00, a section less than 10 s after the previous one skipped), or null when
-- YouTube would not accept it (fewer than 3 chapters).
create function ops._publish_chapters(p_schedule uuid) returns text
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_sections jsonb; sec record; v_last integer := -10; v_start integer; v_first boolean := true; v_lines text[] := '{}';
begin
  select coalesce(r.qa_results#>'{assets,storyboard_sections}', v.storyboard_sections) into v_sections
    from public.publish_schedules s join public.renders r on r.id=s.render_id join public.versions v on v.id=s.version_id
    where s.id=p_schedule;
  if jsonb_typeof(v_sections) is distinct from 'array' then return null; end if;
  for sec in select x->>'title' title, (x->>'start')::numeric start_at from jsonb_array_elements(v_sections) with ordinality e(x,n)
    where jsonb_typeof(x->'title')='string' and jsonb_typeof(x->'start')='number' and (x->>'start')::numeric >= 0
    order by (x->>'start')::numeric, n loop
    v_start := case when v_first then 0 else floor(sec.start_at)::integer end;
    v_first := false;
    if v_start - v_last < 10 then continue; end if;
    v_lines := v_lines || ((v_start / 60)::text || ':' || lpad((v_start % 60)::text, 2, '0') || ' ' || sec.title);
    v_last := v_start;
  end loop;
  if cardinality(v_lines) < 3 then return null; end if;
  return array_to_string(v_lines, E'\n');
end;
$$;

-- The description with the chapter list appended once, as publish/yt.py update does: unchanged
-- when it already holds that list or its own valid chapters (first at 0:00, at least 3, each at
-- least 10 s), or when the result would pass YouTube's 5000 characters.
create function ops._publish_with_chapters(p_description text, p_chapters text) returns text
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_line text; v_hit text[]; v_starts integer[] := '{}'; v_out text;
begin
  if p_chapters is null or position(p_chapters in p_description) > 0 then return p_description; end if;
  foreach v_line in array regexp_split_to_array(p_description || E'\n', E'\r?\n') loop
    v_hit := regexp_match(btrim(v_line), '^(?:(\d+):)?(\d+):([0-5]\d)\s+\S');
    if v_hit is not null then
      v_starts := v_starts || (coalesce(v_hit[1]::integer,0) * 3600 + v_hit[2]::integer * 60 + v_hit[3]::integer);
    else
      if cardinality(v_starts) >= 3 and v_starts[1] = 0 and not exists (select 1 from generate_subscripts(v_starts,1) i
        where i > 1 and v_starts[i] - v_starts[i-1] < 10) then
        return p_description;
      end if;
      v_starts := '{}';
    end if;
  end loop;
  v_out := case when btrim(p_description, E' \t\r\n') = '' then p_chapters
    else rtrim(p_description, E' \t\r\n') || E'\n\n' || p_chapters end;
  return case when length(v_out) > 5000 then p_description else v_out end;
end;
$$;

-- The frozen payload of an approval: render, slot and every destination draft.
create function ops._publish_hash(p_schedule uuid) returns text
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return (select md5(jsonb_build_object('render',s.render_id,'slot',s.slot_at,'destinations',coalesce((
      select jsonb_agg(jsonb_build_array(d.platform,d.account_id,d.provider,d.draft) order by d.platform,d.account_id)
      from public.publish_destinations d where d.schedule_id=s.id),'[]'::jsonb))::text)
    from public.publish_schedules s where s.id=p_schedule);
end;
$$;

-- The plan's real price in EUR: the native YouTube route is free; a provider without a known
-- per-post price (Postiz, Blotato) makes it unknown (null), and no card or rule can cover it.
create function ops._publish_price(p_schedule uuid) returns numeric
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return (select case when count(*) > 0 and bool_and(d.provider='native') then 0::numeric end
    from public.publish_destinations d where d.schedule_id=p_schedule);
end;
$$;

-- Only the four fields the dashboard edits, with their types; unknown keys are dropped.
create function ops._publish_draft_clean(p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_tags jsonb := coalesce(p_draft->'tags','[]'::jsonb);
begin
  if jsonb_typeof(p_draft) is distinct from 'object' then raise exception 'invalid draft'; end if;
  if (p_draft ? 'title' and jsonb_typeof(p_draft->'title') <> 'string')
    or (p_draft ? 'description' and jsonb_typeof(p_draft->'description') <> 'string')
    or (p_draft ? 'thumbnail_text' and jsonb_typeof(p_draft->'thumbnail_text') <> 'string')
    or jsonb_typeof(v_tags) <> 'array'
    or exists (select 1 from jsonb_array_elements(v_tags) t where jsonb_typeof(t) <> 'string')
    or jsonb_array_length(v_tags) > 100 then
    raise exception 'invalid draft';
  end if;
  return jsonb_build_object(
    'title',coalesce(p_draft->>'title',''),
    'description',coalesce(p_draft->>'description',''),
    'tags',coalesce((select jsonb_agg(btrim(t)) from jsonb_array_elements_text(v_tags) t where btrim(t) <> ''),'[]'::jsonb),
    'thumbnail_text',coalesce(p_draft->>'thumbnail_text',''));
end;
$$;

-- What every operation answers: the schedule, its destinations with problems, the approval card,
-- the private upload and the history.
create function ops._publish_view(p_schedule uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare s public.publish_schedules; v public.versions; ap public.approval_requests; pub public.publications; r public.renders;
begin
  select * into s from public.publish_schedules where id=p_schedule;
  if not found then raise exception 'owned schedule required'; end if;
  select * into v from public.versions where id=s.version_id;
  select * into r from public.renders where id=s.render_id;
  select * into ap from public.approval_requests where schedule_id=s.id order by state='pending' desc,created_at desc,id desc limit 1;
  select p.* into pub from public.publications p join public.renders pr on pr.id=p.render_id
    where pr.version_id=s.version_id and pr.render_attempt=r.render_attempt and p.upload_state in ('uploading','uploaded')
    order by p.created_at desc,p.id desc limit 1;
  return jsonb_build_object(
    'schedule_id',s.id,'version_id',s.version_id,'project_id',v.project_id,'render_id',s.render_id,
    'lang',v.lang,'state',s.state,'revision',s.revision,'slot_at',s.slot_at,
    -- The veto stays valid until a provider handoff starts, also after a delayed slot.
    'veto_deadline_at',s.slot_at,
    'veto_open',s.state in ('draft','awaiting_approval','scheduled','publishing','held')
      and not exists (select 1 from public.publish_destinations d where d.schedule_id=s.id
        and d.state in ('handoff_started','published','unknown','failed')),
    'held_reason',s.held_reason,'price_eur',ops._publish_price(s.id),
    'created_via',s.created_via,'vetoed_at',s.vetoed_at,
    'media',case when pub.id is null then null else jsonb_build_object('state',pub.upload_state,
      'video_id',pub.youtube_video_id,'privacy',coalesce(pub.privacy_applied,pub.privacy)) end,
    'approval',case when ap.id is null then null else jsonb_build_object('approval_id',ap.id,'state',ap.state,
      'summary',ap.summary,'price_eur',ap.price_eur,'platforms',to_jsonb(ap.platforms),'requested_via',ap.requested_via,
      'expires_at',ap.expires_at,'decided_at',ap.decided_at,'decided_via',ap.decided_via) end,
    'destinations',coalesce((select jsonb_agg(jsonb_build_object('destination_id',d.id,'platform',d.platform,
        'provider',d.provider,'account_id',d.account_id,'state',d.state,'draft',d.draft,
        'problems',ops._publish_problems(d.platform,d.draft) || ops._publish_thumbnail_problems(s.id,d.draft),'external_url',d.external_url,
        'published_at',d.published_at,'error',d.error) order by d.platform,d.account_id)
      from public.publish_destinations d where d.schedule_id=s.id),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('at',e.at,'kind',e.kind,'actor',e.actor,'detail',e.detail) order by e.at,e.id)
      from (select * from public.publish_events where schedule_id=s.id order by at desc,id desc limit 50) e),'[]'::jsonb),
    'created_at',s.created_at,'updated_at',s.updated_at);
end;
$$;

-- Approved: the schedule waits for its slot and the media goes up PRIVATE through the existing
-- publish job (apps/worker/src/stages/publish.ts). Needs the owner's claims (set by ops._publish_run).
create function ops._publish_activate(p_schedule uuid, p_actor text) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare s public.publish_schedules; d public.publish_destinations; r public.renders;
begin
  select * into s from public.publish_schedules where id=p_schedule;
  select * into r from public.renders where id=s.render_id;
  update public.publish_schedules set state='scheduled',held_reason=null,updated_at=now() where id=s.id;
  update public.publish_destinations set state='scheduled',updated_at=now() where schedule_id=s.id and state='draft';
  perform ops._publish_event(s.id,null,'scheduled',p_actor,jsonb_build_object('slot_at',s.slot_at));
  select * into d from public.publish_destinations where schedule_id=s.id and platform='youtube' and provider='native' order by id limit 1;
  if d.id is not null and not exists (
    select 1 from public.publications p join public.renders pr on pr.id=p.render_id
    where pr.version_id=s.version_id and pr.render_attempt=r.render_attempt and p.upload_state in ('uploading','uploaded')
  ) then
    -- The approved description already holds the chapter list: the stage adds none.
    perform public.enqueue_publish(s.render_id,jsonb_build_object('title',d.draft->>'title',
      'description',d.draft->>'description','chapters','',
      'tags',coalesce((select string_agg(t,',') from jsonb_array_elements_text(d.draft->'tags') t),'')));
    perform ops._publish_event(s.id,d.id,'private_upload_queued',p_actor,'{}'::jsonb);
  end if;
end;
$$;

-- The logic of every token and owner operation. The caller (ops._publish_run) has resolved the
-- actor, checked role, scope, session locality and idempotency and set the owner's claims.
create function ops._publish_do(p_actor jsonb, p_op text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  uid uuid := (p_actor->>'user_id')::uuid;
  v_kind text := p_actor->>'kind';
  test boolean := coalesce((p_actor->>'test_mode')::boolean,false);
  s public.publish_schedules; d public.publish_destinations; v public.versions; r public.renders;
  ap public.approval_requests; rl public.publish_rules;
  v_platform text; v_slot timestamptz; v_draft jsonb; v_sid uuid; v_hash text; v_missing integer;
  v_blocked_at timestamptz; v_price numeric; v_chapters text;
begin
  -- Owner settings: standing rules and the pending approval cards.
  if p_op = 'publish_rules_list' then
    return jsonb_build_object(
      'rules',coalesce((select jsonb_agg(jsonb_build_object('rule_id',x.id,'platform',x.platform,'max_price_eur',x.max_price_eur,
        'require_veto_hours',x.require_veto_hours,'active',x.active,'created_at',x.created_at) order by x.platform,x.created_at)
        from public.publish_rules x where x.owner_id=uid),'[]'::jsonb),
      'approvals',coalesce((select jsonb_agg(ops._publish_view(a2.schedule_id) order by a2.created_at)
        from public.approval_requests a2 join public.publish_schedules s2 on s2.id=a2.schedule_id
        join public.versions v2 on v2.id=s2.version_id
        where a2.owner_id=uid and a2.state='pending' and a2.expires_at>now() and v2.test_run=test),'[]'::jsonb));
  elsif p_op = 'publish_rule_save' then
    v_platform := p_args#>>'{rule,platform}';
    if v_platform is null or v_platform not in ('youtube','tiktok','instagram','facebook','linkedin','x','threads','pinterest','bluesky') then
      raise exception 'invalid platform';
    end if;
    if jsonb_typeof(p_args#>'{rule,max_price_eur}') is distinct from 'number' or (p_args#>>'{rule,max_price_eur}')::numeric < 0
      or jsonb_typeof(p_args#>'{rule,require_veto_hours}') is distinct from 'number'
      or (p_args#>>'{rule,require_veto_hours}')::numeric not between 1 and 168
      or (p_args#>>'{rule,require_veto_hours}')::numeric <> trunc((p_args#>>'{rule,require_veto_hours}')::numeric)
      or jsonb_typeof(p_args#>'{rule,active}') is distinct from 'boolean' then
      raise exception 'invalid rule';
    end if;
    if p_args#>>'{rule,rule_id}' is not null then
      update public.publish_rules set platform=v_platform,max_price_eur=(p_args#>>'{rule,max_price_eur}')::numeric,
        require_veto_hours=(p_args#>>'{rule,require_veto_hours}')::integer,active=(p_args#>>'{rule,active}')::boolean,updated_at=now()
        where id=(p_args#>>'{rule,rule_id}')::uuid and owner_id=uid returning * into rl;
      if not found then raise exception 'owned rule required'; end if;
    else
      insert into public.publish_rules(owner_id,platform,max_price_eur,require_veto_hours,active)
        values(uid,v_platform,(p_args#>>'{rule,max_price_eur}')::numeric,(p_args#>>'{rule,require_veto_hours}')::integer,
          (p_args#>>'{rule,active}')::boolean) returning * into rl;
    end if;
    return jsonb_build_object('rule_id',rl.id);
  elsif p_op = 'publish_rule_delete' then
    delete from public.publish_rules where id=(p_args->>'rule_id')::uuid and owner_id=uid;
    if not found then raise exception 'owned rule required'; end if;
    return jsonb_build_object('rule_id',p_args->>'rule_id');
  elsif p_op = 'publish_status' then
    select * into v from public.versions where id=(p_args->>'version_id')::uuid and owner_id=uid and test_run=test;
    if not found then raise exception 'owned version required'; end if;
    return jsonb_build_object('version_id',v.id,'schedules',coalesce((select jsonb_agg(ops._publish_view(x.id) order by x.created_at desc,x.id)
      from (select id,created_at from public.publish_schedules where version_id=v.id and owner_id=uid
        order by created_at desc,id desc limit 20) x),'[]'::jsonb),
      -- Read-only: uploads the old flow scheduled with a YouTube publishAt (docs/agents-publishing.md).
      'legacy',coalesce((select jsonb_agg(jsonb_build_object('publication_id',p.id,'video_id',p.youtube_video_id,
          'privacy',p.privacy,'publish_at',p.publish_at,'upload_state',p.upload_state) order by p.created_at desc,p.id)
        from public.publications p join public.renders pr on pr.id=p.render_id
        where pr.version_id=v.id and p.owner_id=uid and (p.privacy='scheduled' or p.publish_at is not null)),'[]'::jsonb));
  elsif p_op = 'publish_plan' then
    select * into v from public.versions where id=(p_args->>'version_id')::uuid and owner_id=uid and test_run=test for update;
    if not found then raise exception 'owned version required'; end if;
    if v.status not in ('approved','publishing','published') or v.trashed_at is not null then raise exception 'approved video required'; end if;
    select * into r from public.renders where version_id=v.id and owner_id=uid and kind='master'
      and render_attempt=v.render_attempt and approved_at is not null and path is not null
      order by created_at desc,id desc limit 1;
    if not found then raise exception 'approved video required'; end if;
    if jsonb_typeof(p_args->'platforms') is distinct from 'array' or jsonb_array_length(p_args->'platforms') = 0 then
      raise exception 'invalid platform';
    end if;
    for v_platform in select jsonb_array_elements_text(p_args->'platforms') loop
      if v_platform not in ('youtube','tiktok','instagram','facebook','linkedin','x','threads','pinterest','bluesky') then
        raise exception 'invalid platform';
      end if;
      -- Owner decision 2026-11-19: YouTube only for now; the other platforms come later.
      if v_platform <> 'youtube' then raise exception 'platform must be youtube for now'; end if;
    end loop;
    if exists (select 1 from public.publish_schedules where version_id=v.id
      and state in ('draft','awaiting_approval','scheduled','publishing','held')) then
      raise exception 'a publish plan is already open';
    end if;
    -- The old flow (admin_confirm_publication) may have scheduled the video with a YouTube
    -- publishAt or made it public: YouTube's own clock owns it, the app never plans it again.
    -- Only the current render attempt counts: an older video is another upload.
    if exists (select 1 from public.publications p join public.renders pr on pr.id=p.render_id
      where pr.version_id=v.id and pr.render_attempt=v.render_attempt and (p.privacy in ('scheduled','public') or p.privacy_applied in ('scheduled','public')
        or p.publish_at is not null)) then
      raise exception 'video already scheduled or public on YouTube';
    end if;
    v_draft := ops._publish_draft_clean(coalesce(p_args->'draft','{}'::jsonb));
    if v_draft->>'title' = '' then
      v_draft := jsonb_set(v_draft,'{title}',to_jsonb(left(coalesce(nullif(btrim(v.display_title),''),
        nullif(btrim(v.lyric_pack->>'title'),''),'Senza titolo'),100)));
    end if;
    insert into public.publish_schedules(owner_id,version_id,render_id,created_via,token_id)
      values(uid,v.id,r.id,v_kind,(p_actor->>'token_id')::uuid) returning * into s;
    insert into public.publish_destinations(schedule_id,owner_id,platform,provider,draft)
      values(s.id,uid,'youtube','native',v_draft);
    perform ops._publish_event(s.id,null,'planned',v_kind,jsonb_build_object('platforms',p_args->'platforms'));
    return ops._publish_view(s.id);
  end if;

  if p_op = 'publish_approval_decide' then
    select a.schedule_id into v_sid from public.approval_requests a where a.id=(p_args->>'approval_id')::uuid and a.owner_id=uid;
  else
    v_sid := (p_args->>'schedule_id')::uuid;
  end if;
  if p_op = 'publish_preview' then
    perform 1 from public.publish_schedules x join public.versions vv on vv.id=x.version_id
      where x.id=v_sid and x.owner_id=uid and vv.test_run=test;
    if not found then raise exception 'owned schedule required'; end if;
    return ops._publish_view(v_sid);
  end if;
  -- Lock order: the schedule row first, then its destinations ordered by id.
  select * into s from public.publish_schedules where id=v_sid and owner_id=uid for update;
  if not found or not exists (select 1 from public.versions where id=s.version_id and test_run=test) then
    raise exception 'owned schedule required';
  end if;
  perform 1 from public.publish_destinations where schedule_id=s.id order by id for update;

  if p_op in ('publish_draft_edit','publish_schedule') then
    if s.state not in ('draft','awaiting_approval','rejected','expired') then
      raise exception 'a draft state is required';
    end if;
    -- A closed plan reopens as a draft only while no other plan of the video is open.
    if s.state in ('rejected','expired') and exists (select 1 from public.publish_schedules x where x.version_id=s.version_id
      and x.id<>s.id and x.state in ('draft','awaiting_approval','scheduled','publishing','held')) then
      raise exception 'a publish plan is already open';
    end if;
    if p_op = 'publish_draft_edit' then
      v_platform := coalesce(p_args->>'platform','youtube');
      select * into d from public.publish_destinations where schedule_id=s.id and platform=v_platform order by id limit 1;
      if not found then raise exception 'owned destination required'; end if;
      -- A partial edit: only the given fields change, each validated.
      v_draft := coalesce(p_args->'draft','{}'::jsonb);
      v_draft := ops._publish_draft_clean(d.draft || coalesce((select jsonb_object_agg(e.key,e.value)
        from jsonb_each(ops._publish_draft_clean(v_draft)) e where v_draft ? e.key),'{}'::jsonb));
      update public.publish_destinations set draft=v_draft,updated_at=now() where id=d.id;
      perform ops._publish_event(s.id,d.id,'draft_edited',v_kind,'{}'::jsonb);
    else
      v_slot := (p_args->>'slot_at')::timestamptz;
      if v_slot is null or v_slot <= now() + interval '1 minute' then raise exception 'invalid slot'; end if;
      update public.publish_schedules set slot_at=v_slot where id=s.id;
      perform ops._publish_event(s.id,null,'slot_set',v_kind,jsonb_build_object('slot_at',v_slot));
    end if;
    -- Any change invalidates a pending approval: the card froze the old payload.
    update public.approval_requests set state='expired',decided_at=now(),decided_via='system'
      where schedule_id=s.id and state='pending';
    if found then perform ops._publish_event(s.id,null,'approval_invalidated','system','{}'::jsonb); end if;
    update public.publish_schedules set state='draft',revision=revision+1,updated_at=now() where id=s.id;
  elsif p_op = 'publish_request_approval' then
    if s.state in ('awaiting_approval','scheduled','publishing') then return ops._publish_view(s.id); end if;
    if s.state <> 'draft' then raise exception 'a draft is required'; end if;
    if s.slot_at is null or s.slot_at <= now() then raise exception 'invalid slot'; end if;
    -- The chapter list joins the description before the card freezes the payload, so the public
    -- description is the one the owner approves.
    v_chapters := ops._publish_chapters(s.id);
    if v_chapters is not null then
      update public.publish_destinations x set draft=jsonb_set(x.draft,'{description}',
          to_jsonb(ops._publish_with_chapters(coalesce(x.draft->>'description',''),v_chapters))),updated_at=now()
        where x.schedule_id=s.id and x.platform='youtube'
          and ops._publish_with_chapters(coalesce(x.draft->>'description',''),v_chapters) is distinct from coalesce(x.draft->>'description','');
      if found then perform ops._publish_event(s.id,null,'chapters_added','system','{}'::jsonb); end if;
    end if;
    if exists (select 1 from public.publish_destinations x where x.schedule_id=s.id
      and jsonb_array_length(ops._publish_problems(x.platform,x.draft) || ops._publish_thumbnail_problems(s.id,x.draft)) > 0) then
      raise exception 'invalid draft';
    end if;
    v_hash := ops._publish_hash(s.id);
    v_price := ops._publish_price(s.id);
    if v_price is null then raise exception 'price unknown' using errcode='MDF05'; end if;
    if v_kind = 'session' then
      -- The owner himself in the app (local admin session): his request is his yes.
      insert into public.approval_requests(owner_id,schedule_id,op,payload_hash,summary,price_eur,platforms,requested_via,expires_at,state,decided_at,decided_via)
        values(uid,s.id,'publish_schedule',v_hash,ops._publish_summary(s.id),v_price,
          array(select platform from public.publish_destinations where schedule_id=s.id order by platform),
          v_kind,s.slot_at,'approved',now(),'owner');
      perform ops._publish_event(s.id,null,'approved','owner','{}'::jsonb);
      perform ops._publish_activate(s.id,'owner');
    else
      -- A video with a vetoed or rejected plan always needs the owner's card until the owner says
      -- yes again (an 'approved' event by the owner after the last veto or rejection).
      select max(e.at) into v_blocked_at from public.publish_events e join public.publish_schedules x on x.id=e.schedule_id
        where x.version_id=s.version_id and e.kind in ('vetoed','rejected');
      -- A standing rule must cover every destination: platform, the plan's price within the cap and
      -- a slot that leaves at least the rule's veto window.
      select count(*) into v_missing from public.publish_destinations x where x.schedule_id=s.id
        and not exists (select 1 from public.publish_rules y where y.owner_id=uid and y.active and y.platform=x.platform
          and y.max_price_eur >= v_price and s.slot_at >= now() + make_interval(hours => y.require_veto_hours));
      if v_blocked_at is not null and not exists (select 1 from public.publish_events e join public.publish_schedules x on x.id=e.schedule_id
        where x.version_id=s.version_id and e.kind='approved' and e.actor='owner' and e.at > v_blocked_at) then
        v_missing := v_missing + 1;
      else
        v_blocked_at := null;
      end if;
      if v_missing = 0 then
        select y.* into rl from public.publish_rules y join public.publish_destinations x on x.platform=y.platform
          where x.schedule_id=s.id and y.owner_id=uid and y.active and y.max_price_eur >= v_price
            and s.slot_at >= now() + make_interval(hours => y.require_veto_hours)
          order by y.require_veto_hours desc,y.id limit 1;
        insert into public.approval_requests(owner_id,schedule_id,op,payload_hash,summary,price_eur,platforms,requested_via,token_id,expires_at,state,decided_at,decided_via,rule_id)
          values(uid,s.id,'publish_schedule',v_hash,ops._publish_summary(s.id),v_price,
            array(select platform from public.publish_destinations where schedule_id=s.id order by platform),
            v_kind,(p_actor->>'token_id')::uuid,s.slot_at,'approved',now(),'rule',rl.id);
        perform ops._publish_event(s.id,null,'approved_by_rule','rule',jsonb_build_object('rule_id',rl.id));
        perform ops._publish_activate(s.id,'rule');
      else
        insert into public.approval_requests(owner_id,schedule_id,op,payload_hash,summary,price_eur,platforms,requested_via,token_id,expires_at)
          values(uid,s.id,'publish_schedule',v_hash,ops._publish_summary(s.id),v_price,
            array(select platform from public.publish_destinations where schedule_id=s.id order by platform),
            v_kind,(p_actor->>'token_id')::uuid,s.slot_at);
        update public.publish_schedules set state='awaiting_approval',updated_at=now() where id=s.id;
        perform ops._publish_event(s.id,null,'approval_requested',v_kind,
          case when v_blocked_at is not null then jsonb_build_object('reason','after_veto_or_rejection') else '{}'::jsonb end);
      end if;
    end if;
  elsif p_op = 'publish_approval_decide' then
    select * into ap from public.approval_requests where id=(p_args->>'approval_id')::uuid and owner_id=uid for update;
    if ap.state <> 'pending' then raise exception 'approval already decided'; end if;
    if p_args->>'decision' not in ('approve','reject') then raise exception 'invalid decision'; end if;
    if ap.expires_at <= now() or s.slot_at is null or s.slot_at <= now() or ap.payload_hash <> ops._publish_hash(s.id) then
      -- Too late or the payload changed: the card dies with zero external calls.
      update public.approval_requests set state='expired',decided_at=now(),decided_via='system' where id=ap.id;
      update public.publish_schedules set state='expired',updated_at=now() where id=s.id;
      perform ops._publish_event(s.id,null,'approval_expired','system','{}'::jsonb);
    elsif p_args->>'decision' = 'approve' then
      update public.approval_requests set state='approved',decided_at=now(),decided_via='owner' where id=ap.id;
      perform ops._publish_event(s.id,null,'approved','owner','{}'::jsonb);
      perform ops._publish_activate(s.id,'owner');
    else
      update public.approval_requests set state='rejected',decided_at=now(),decided_via='owner' where id=ap.id;
      update public.publish_schedules set state='rejected',updated_at=now() where id=s.id;
      perform ops._publish_event(s.id,null,'rejected','owner','{}'::jsonb);
    end if;
  elsif p_op = 'publish_veto' then
    if s.state = 'vetoed' then return ops._publish_view(s.id); end if;
    -- The veto wins in every state before the handoff (claimed and intent_recorded included).
    if exists (select 1 from public.publish_destinations x where x.schedule_id=s.id
      and x.state in ('handoff_started','published','unknown','failed')) then
      raise exception 'publish already handed off';
    end if;
    if s.state not in ('draft','awaiting_approval','scheduled','publishing','held') then
      raise exception 'schedule already closed';
    end if;
    update public.publish_destinations set state='vetoed',claim_token=null,claim_expires_at=null,updated_at=now()
      where schedule_id=s.id and state not in ('cancelled');
    update public.approval_requests set state='expired',decided_at=now(),decided_via='system' where schedule_id=s.id and state='pending';
    update public.publish_schedules set state='vetoed',vetoed_at=now(),vetoed_via=v_kind,updated_at=now() where id=s.id;
    perform ops._publish_event(s.id,null,'vetoed',v_kind,'{}'::jsonb);
  elsif p_op = 'publish_reopen' then
    -- The owner sends a held plan back to draft: the old card expires, a new yes is needed.
    if s.state <> 'held' then raise exception 'a held plan is required'; end if;
    if exists (select 1 from public.publish_destinations x where x.schedule_id=s.id
      and x.state in ('handoff_started','published','unknown','failed')) then
      raise exception 'publish already handed off';
    end if;
    update public.publish_destinations set state='draft',claim_token=null,claimed_by=null,claim_expires_at=null,error=null,updated_at=now()
      where schedule_id=s.id and state in ('scheduled','claimed','intent_recorded');
    update public.approval_requests set state='expired',decided_at=now(),decided_via='system'
      where schedule_id=s.id and state in ('pending','approved');
    update public.publish_schedules set state='draft',held_reason=null,revision=revision+1,updated_at=now() where id=s.id;
    perform ops._publish_event(s.id,null,'reopened',v_kind,'{}'::jsonb);
  elsif p_op = 'publish_cancel' then
    if s.state = 'cancelled' then return ops._publish_view(s.id); end if;
    if s.state in ('scheduled','publishing') then raise exception 'a veto is required'; end if;
    if s.state in ('published','failed') then raise exception 'schedule already closed'; end if;
    update public.publish_destinations set state='cancelled',claim_token=null,claim_expires_at=null,updated_at=now()
      where schedule_id=s.id and state in ('draft','scheduled','vetoed');
    update public.approval_requests set state='expired',decided_at=now(),decided_via='system' where schedule_id=s.id and state='pending';
    update public.publish_schedules set state='cancelled',updated_at=now() where id=s.id;
    perform ops._publish_event(s.id,null,'cancelled',v_kind,'{}'::jsonb);
  else
    raise exception 'invalid operation';
  end if;
  return ops._publish_view(s.id);
end;
$$;

-- The one-line text of an approval card, in Italian like the dashboard; the card shows price_eur.
create function ops._publish_summary(p_schedule uuid) returns text
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return (select string_agg(
      case d.platform when 'youtube' then 'YouTube' else d.platform end || ': "' || left(coalesce(d.draft->>'title',''),100) || '"',
      '; ' order by d.platform)
    || ' diventa pubblico il ' || to_char(s.slot_at at time zone 'Europe/Rome','DD/MM/YYYY HH24:MI') || ' (ora di Roma).'
    from public.publish_schedules s join public.publish_destinations d on d.schedule_id=s.id
    where s.id=p_schedule group by s.slot_at);
end;
$$;

-- The M1 wrapper (actor, role, scope, local session, idempotency, audit, error envelope) once for
-- every publishing operation. p_scope 'owner' means: the owner's local admin session only.
create function ops._publish_run(p_ctx jsonb, p_op text, p_args jsonb, p_scope text, p_mutating boolean) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; detail text; v_actor_key text; idem public.idempotency_keys%rowtype; ids jsonb; jid uuid;
begin
  perform ops._enter();
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    v_actor_key := a.actor_kind||':'||coalesce(a.token_id,a.user_id)::text;
    if a.role <> 'admin' then raise exception 'admin required'; end if;
    if a.actor_kind = 'session' then
      if a.remote then raise exception 'admin required'; end if;
    elsif p_scope = 'owner' or not (p_scope = any(a.scopes)) then
      -- Agents can never approve, and never write the owner's standing rules.
      raise exception 'admin required';
    end if;
    if p_mutating and a.actor_kind <> 'session' and coalesce(length(p_ctx->>'idempotency_key'),0)=0 then
      raise exception 'idempotency key required' using errcode='MDF01';
    end if;
    if p_mutating and p_ctx ? 'idempotency_key' then
      if length(p_ctx->>'idempotency_key') not between 8 and 100 or coalesce(p_ctx->>'request_hash','')='' then raise exception 'invalid idempotency input'; end if;
      insert into public.idempotency_keys(actor_key,key,request_hash,state) values(v_actor_key,p_ctx->>'idempotency_key',p_ctx->>'request_hash','in_flight') on conflict do nothing;
      select * into idem from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' for update;
      if found then
        if idem.request_hash <> p_ctx->>'request_hash' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,p_op,coalesce(p_ctx->>'request_hash',''),'error','idempotency_mismatch',a.remote);
          perform ops._enter();
          return jsonb_build_object('ok',false,'code','idempotency_mismatch','message','Idempotency key used for another request');
        end if;
        if idem.state='done' then
          insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote) values(a.user_id,a.actor_kind,a.token_id,p_op,coalesce(p_ctx->>'request_hash',''),'ok',null,a.remote);
          perform ops._enter(); return idem.response;
        end if;
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',a.user_id::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated')::text,true);
    if auth.uid() is distinct from a.user_id then raise exception 'claim required' using errcode='MDF03'; end if;
    perform set_config('mdf.job_ctx',jsonb_build_object('token_id',a.token_id,'run_id',p_ctx->>'run_id','fake_providers',a.test_mode)::text,true);
    data := ops._publish_do(jsonb_build_object('user_id',a.user_id,'kind',a.actor_kind,'token_id',a.token_id,'test_mode',a.test_mode),p_op,p_args);
    ids := coalesce(nullif(current_setting('mdf.job_ids',true),''),'[]')::jsonb;
    for jid in select jobs.id from public.jobs jobs where jobs.owner_id=a.user_id and jobs.status='queued'
      and jobs.id in (select value::uuid from jsonb_array_elements_text(ids)) loop
      perform ops.reserve_job(jid);
    end loop;
    if p_mutating then
      update public.idempotency_keys i set state='done',response=jsonb_build_object('ok',true,'data',data)
        where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash';
    end if;
  exception when others then
    get stacked diagnostics detail = pg_exception_detail;
    err := ops.map_error(sqlstate,sqlerrm);
    delete from public.idempotency_keys i where i.actor_key=v_actor_key and i.key=p_ctx->>'idempotency_key' and i.request_hash=p_ctx->>'request_hash' and i.state='in_flight';
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,p_op,coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    perform ops._enter();
    return jsonb_build_object('ok',false,'code',err->>'code','message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason') || case when detail like '{%' then detail::jsonb else '{}'::jsonb end);
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,p_op,coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;

-- Token and owner operations (HTTP, MCP, CLI and the dashboard). Approval and standing rules are
-- 'owner' only: no agent token can call them.
create function ops.publish_plan(p_ctx jsonb, p_version uuid, p_platforms jsonb, p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return ops._publish_run(p_ctx,'publish_plan',jsonb_build_object('version_id',p_version,'platforms',p_platforms,'draft',p_draft),'create',true);
end;
$$;
create function ops.publish_draft_edit(p_ctx jsonb, p_schedule uuid, p_platform text, p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return ops._publish_run(p_ctx,'publish_draft_edit',jsonb_build_object('schedule_id',p_schedule,'platform',p_platform,'draft',p_draft),'create',true);
end;
$$;
create function ops.publish_schedule(p_ctx jsonb, p_schedule uuid, p_slot_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return ops._publish_run(p_ctx,'publish_schedule',jsonb_build_object('schedule_id',p_schedule,'slot_at',p_slot_at),'create',true);
end;
$$;
create function ops.publish_preview(p_ctx jsonb, p_schedule uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return ops._publish_run(p_ctx,'publish_preview',jsonb_build_object('schedule_id',p_schedule),'read',false);
end;
$$;
create function ops.publish_request_approval(p_ctx jsonb, p_schedule uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return ops._publish_run(p_ctx,'publish_request_approval',jsonb_build_object('schedule_id',p_schedule),'spend',true);
end;
$$;
create function ops.publish_veto(p_ctx jsonb, p_schedule uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return ops._publish_run(p_ctx,'publish_veto',jsonb_build_object('schedule_id',p_schedule),'create',true);
end;
$$;
create function ops.publish_cancel(p_ctx jsonb, p_schedule uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return ops._publish_run(p_ctx,'publish_cancel',jsonb_build_object('schedule_id',p_schedule),'create',true);
end;
$$;
create function ops.publish_reopen(p_ctx jsonb, p_schedule uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return ops._publish_run(p_ctx,'publish_reopen',jsonb_build_object('schedule_id',p_schedule),'owner',true);
end;
$$;
create function ops.publish_status(p_ctx jsonb, p_version uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return ops._publish_run(p_ctx,'publish_status',jsonb_build_object('version_id',p_version),'read',false);
end;
$$;
create function ops.publish_approval_decide(p_ctx jsonb, p_approval uuid, p_decision text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return ops._publish_run(p_ctx,'publish_approval_decide',jsonb_build_object('approval_id',p_approval,'decision',p_decision),'owner',true);
end;
$$;
create function ops.publish_rules_list(p_ctx jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return ops._publish_run(p_ctx,'publish_rules_list','{}'::jsonb,'owner',false);
end;
$$;
create function ops.publish_rule_save(p_ctx jsonb, p_rule jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return ops._publish_run(p_ctx,'publish_rule_save',jsonb_build_object('rule',p_rule),'owner',true);
end;
$$;
create function ops.publish_rule_delete(p_ctx jsonb, p_rule uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  return ops._publish_run(p_ctx,'publish_rule_delete',jsonb_build_object('rule_id',p_rule),'owner',true);
end;
$$;

-- Slot worker (apps/worker/src/publishing/dispatcher.ts), service role only. Per destination:
-- scheduled -> claimed -> intent_recorded -> handoff_started -> published | failed | unknown.
-- claimed and intent_recorded are internal: a veto still wins in both. handoff_started is a
-- compare-and-set in its own short transaction right before the provider call; only after it
-- commits does a veto answer conflict.

-- Recovery after a crash or a lost lease, run before every claim.
create function ops.publish_dispatch_recover(p_worker text) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_sid uuid; d public.publish_destinations; out jsonb := '[]'::jsonb; v_token uuid;
  v_owner uuid := (select w.owner_id from public.workers w where w.id=p_worker);
begin
  -- A worker publishes only for its own owner (public.workers.owner_id).
  if v_owner is null then raise exception 'invalid worker'; end if;
  -- A pending card whose slot came: zero external calls, the plan expires. Only this worker's owner.
  for v_sid in select a.schedule_id from public.approval_requests a where a.owner_id=v_owner and a.state='pending'
    and a.expires_at<=now() order by a.schedule_id loop
    perform 1 from public.publish_schedules where id=v_sid for update;
    perform 1 from public.publish_destinations where schedule_id=v_sid order by id for update;
    update public.approval_requests set state='expired',decided_at=now(),decided_via='system' where schedule_id=v_sid and state='pending';
    update public.publish_schedules set state='expired',updated_at=now() where id=v_sid and state='awaiting_approval';
    perform ops._publish_event(v_sid,null,'approval_expired','system','{}'::jsonb);
  end loop;
  for v_sid in select distinct x.schedule_id from public.publish_destinations x where x.owner_id=v_owner
    and x.state in ('claimed','intent_recorded','handoff_started') and x.claim_expires_at<=now() order by x.schedule_id loop
    perform 1 from public.publish_schedules where id=v_sid for update;
    for d in select * from public.publish_destinations where schedule_id=v_sid order by id for update loop
      if d.claim_expires_at is null or d.claim_expires_at > now() then continue; end if;
      if d.state in ('claimed','intent_recorded') then
        -- No provider call happened: back to scheduled; gate, veto and approval are checked again.
        update public.publish_destinations set state='scheduled',claim_token=null,claimed_by=null,claim_expires_at=null,updated_at=now() where id=d.id;
        perform ops._publish_event(v_sid,d.id,'claim_released','system',jsonb_build_object('from',d.state));
      elsif d.state = 'handoff_started' then
        -- The provider call may have happened: only its status decides, never a blind retry.
        v_token := gen_random_uuid();
        update public.publish_destinations set claim_token=v_token,claimed_by=p_worker,claim_expires_at=now()+interval '15 minutes',updated_at=now() where id=d.id;
        perform ops._publish_event(v_sid,d.id,'status_check','system','{}'::jsonb);
        out := out || jsonb_build_object('destination_id',d.id,'schedule_id',v_sid,'claim_token',v_token,'platform',d.platform,
          'provider',d.provider,'attempt_id',d.attempt_id,'external_id',d.external_id);
      end if;
    end loop;
  end loop;
  return out;
end;
$$;

-- Claims due destinations. A slot missed by more than six hours (worker down) is held, never
-- published late; the private media must be uploaded.
create function ops.publish_dispatch_claim(p_worker text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare s public.publish_schedules; d public.publish_destinations; r public.renders; pub public.publications; out jsonb := '[]'::jsonb; v_token uuid;
  v_owner uuid := (select w.owner_id from public.workers w where w.id=p_worker); v_path text;
begin
  if v_owner is null then raise exception 'invalid worker'; end if;
  for s in select * from public.publish_schedules where owner_id=v_owner and state in ('scheduled','publishing') and slot_at<=now()
    order by slot_at,id limit greatest(coalesce(p_limit,5),1) for update skip locked loop
    perform 1 from public.publish_destinations where schedule_id=s.id order by id for update;
    if s.slot_at < now() - interval '6 hours' and not exists (select 1 from public.publish_destinations
      where schedule_id=s.id and state in ('claimed','intent_recorded','handoff_started','published','unknown')) then
      update public.publish_schedules set state='held',held_reason='missed_slot',updated_at=now() where id=s.id;
      perform ops._publish_event(s.id,null,'held','system',jsonb_build_object('reason','missed_slot'));
      continue;
    end if;
    select * into r from public.renders where id=s.render_id;
    select p.* into pub from public.publications p join public.renders pr on pr.id=p.render_id
      where pr.version_id=s.version_id and pr.render_attempt=r.render_attempt and p.upload_state='uploaded'
        and p.youtube_video_id is not null
      order by p.created_at desc,p.id desc limit 1;
    -- The uploaded render's file: the worker finds the base thumbnail next to it (stages/publish.ts).
    v_path := (select pr.path from public.renders pr where pr.id=pub.render_id);
    for d in select * from public.publish_destinations where schedule_id=s.id and state='scheduled' order by id loop
      if d.platform='youtube' and d.provider='native' and pub.id is null then continue; end if;
      v_token := gen_random_uuid();
      update public.publish_destinations set state='claimed',claim_token=v_token,claimed_by=p_worker,
        claim_expires_at=now()+interval '5 minutes',attempt_id=gen_random_uuid(),attempts=attempts+1,
        external_id=case when d.platform='youtube' and d.provider='native' then pub.youtube_video_id else external_id end,
        error=null,updated_at=now()
        where id=d.id returning * into d;
      perform ops._publish_event(s.id,d.id,'claimed','system',jsonb_build_object('attempt_id',d.attempt_id));
      out := out || jsonb_build_object('destination_id',d.id,'schedule_id',s.id,'claim_token',v_token,'attempt_id',d.attempt_id,
        'platform',d.platform,'provider',d.provider,'draft',d.draft,'external_id',d.external_id,'render_path',v_path);
    end loop;
  end loop;
  return out;
end;
$$;

-- claimed -> intent_recorded, after the worker checked its own health. Rechecks veto and approval.
create function ops.publish_dispatch_intent(p_destination uuid, p_token uuid) returns boolean
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare s public.publish_schedules; d public.publish_destinations; v public.versions;
begin
  select * into s from public.publish_schedules where id=(select schedule_id from public.publish_destinations where id=p_destination) for update;
  if not found then return false; end if;
  perform 1 from public.publish_destinations where schedule_id=s.id order by id for update;
  select * into d from public.publish_destinations where id=p_destination;
  if d.state<>'claimed' or d.claim_token is distinct from p_token or d.claim_expires_at<=now()
    or s.state not in ('scheduled','publishing') then
    return false;
  end if;
  select * into v from public.versions where id=s.version_id;
  -- A rule's yes holds only while that rule still exists and is active.
  if v.trashed_at is not null or not exists (select 1 from public.approval_requests a where a.schedule_id=s.id
    and a.state='approved' and a.payload_hash=ops._publish_hash(s.id)
    and (a.decided_via is distinct from 'rule' or exists (select 1 from public.publish_rules y
      where y.id=a.rule_id and y.owner_id=s.owner_id and y.active))) then
    -- Fail closed: the gate no longer holds, nothing goes public.
    update public.publish_destinations set state='scheduled',claim_token=null,claimed_by=null,claim_expires_at=null,updated_at=now() where id=d.id;
    update public.publish_schedules set state='held',held_reason='gate_failed',updated_at=now() where id=s.id;
    perform ops._publish_event(s.id,d.id,'held','system',jsonb_build_object('reason','gate_failed'));
    return false;
  end if;
  update public.publish_destinations set state='intent_recorded',intent_at=now(),updated_at=now() where id=d.id;
  perform ops._publish_event(s.id,d.id,'intent_recorded','system',jsonb_build_object('attempt_id',d.attempt_id));
  return true;
end;
$$;

-- claimed -> held, before the intent: the worker found a reason it cannot publish (the base
-- thumbnail for the approved text is missing on this PC). The owner sees the reason; nothing
-- is retried until the owner sends the plan back to draft.
create function ops.publish_dispatch_hold(p_destination uuid, p_token uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare s public.publish_schedules; d public.publish_destinations;
begin
  if p_reason is null or p_reason not in ('thumbnail_missing') then raise exception 'invalid reason'; end if;
  select * into s from public.publish_schedules where id=(select schedule_id from public.publish_destinations where id=p_destination) for update;
  if not found then return false; end if;
  perform 1 from public.publish_destinations where schedule_id=s.id order by id for update;
  select * into d from public.publish_destinations where id=p_destination;
  if d.state<>'claimed' or d.claim_token is distinct from p_token or s.state not in ('scheduled','publishing') then
    return false;
  end if;
  update public.publish_destinations set state='scheduled',claim_token=null,claimed_by=null,claim_expires_at=null,updated_at=now() where id=d.id;
  update public.publish_schedules set state='held',held_reason=p_reason,updated_at=now() where id=s.id;
  perform ops._publish_event(s.id,d.id,'held','system',jsonb_build_object('reason',p_reason));
  return true;
end;
$$;

-- intent_recorded -> handoff_started: the last moment a veto can win.
create function ops.publish_dispatch_handoff(p_destination uuid, p_token uuid) returns boolean
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare s public.publish_schedules; d public.publish_destinations;
begin
  select * into s from public.publish_schedules where id=(select schedule_id from public.publish_destinations where id=p_destination) for update;
  if not found then return false; end if;
  perform 1 from public.publish_destinations where schedule_id=s.id order by id for update;
  select * into d from public.publish_destinations where id=p_destination;
  if d.state<>'intent_recorded' or d.claim_token is distinct from p_token or d.claim_expires_at<=now()
    or s.state not in ('scheduled','publishing') then
    return false;
  end if;
  update public.publish_destinations set state='handoff_started',handoff_at=now(),claim_expires_at=now()+interval '15 minutes',updated_at=now() where id=d.id;
  update public.publish_schedules set state='publishing',updated_at=now() where id=s.id;
  perform ops._publish_event(s.id,d.id,'handoff_started','system',jsonb_build_object('attempt_id',d.attempt_id));
  return true;
end;
$$;

-- The provider's answer. definitely_not_accepted is the only outcome that allows a new attempt.
-- p_error is a short code (apps/worker/src/publishing/dispatcher.ts); anything else, such as raw
-- engine or provider text, is stored as 'provider_error' and never shown.
create function ops.publish_dispatch_finish(p_destination uuid, p_token uuid, p_outcome text, p_external_url text, p_error text) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare s public.publish_schedules; d public.publish_destinations; r public.renders;
  v_error text := case when p_error is null then null when p_error ~ '^[a-z][a-z0-9_]{0,63}$' then p_error else 'provider_error' end;
begin
  select * into s from public.publish_schedules where id=(select schedule_id from public.publish_destinations where id=p_destination) for update;
  if not found then raise exception 'owned destination required'; end if;
  perform 1 from public.publish_destinations where schedule_id=s.id order by id for update;
  select * into d from public.publish_destinations where id=p_destination;
  if d.state<>'handoff_started' or d.claim_token is distinct from p_token then raise exception 'current claim required'; end if;
  if p_outcome = 'published' then
    update public.publish_destinations set state='published',published_at=now(),external_url=p_external_url,error=null,
      claim_token=null,claim_expires_at=null,updated_at=now() where id=d.id;
    select * into r from public.renders where id=s.render_id;
    update public.publications p set privacy='public',privacy_applied='public',updated_at=now()
      from public.renders pr where pr.id=p.render_id and pr.version_id=s.version_id and pr.render_attempt=r.render_attempt
        and p.upload_state='uploaded' and p.youtube_video_id=d.external_id;
    update public.versions set status='published' where id=s.version_id and status in ('approved','publishing');
  elsif p_outcome = 'definitely_not_accepted' and d.attempts >= 3 then
    -- Refused three times (expired login, removed video...): stop and show the owner.
    update public.publish_destinations set state='failed',error=v_error,claim_token=null,claim_expires_at=null,updated_at=now() where id=d.id;
  elsif p_outcome = 'definitely_not_accepted' then
    update public.publish_destinations set state='scheduled',error=v_error,claim_token=null,claimed_by=null,
      claim_expires_at=null,updated_at=now() where id=d.id;
  elsif p_outcome = 'failed' then
    update public.publish_destinations set state='failed',error=v_error,claim_token=null,claim_expires_at=null,updated_at=now() where id=d.id;
  elsif p_outcome = 'unknown' then
    update public.publish_destinations set state='unknown',error=v_error,claim_token=null,claim_expires_at=null,updated_at=now() where id=d.id;
  else
    raise exception 'invalid outcome';
  end if;
  perform ops._publish_event(s.id,d.id,p_outcome,'system',jsonb_strip_nulls(jsonb_build_object('url',p_external_url,'error',v_error)));
  -- Roll the destinations up into the schedule.
  if not exists (select 1 from public.publish_destinations where schedule_id=s.id and state not in ('published','cancelled')) then
    update public.publish_schedules set state='published',updated_at=now() where id=s.id;
  elsif exists (select 1 from public.publish_destinations where schedule_id=s.id and state='unknown') then
    -- Needs the owner's check in YouTube Studio; never retried automatically.
    update public.publish_schedules set state='held',held_reason='status_unknown',updated_at=now() where id=s.id;
  elsif not exists (select 1 from public.publish_destinations where schedule_id=s.id
      and state in ('scheduled','claimed','intent_recorded','handoff_started')) then
    update public.publish_schedules set state='failed',updated_at=now() where id=s.id;
  end if;
end;
$$;

-- The old flow (confirm_publication, admin_confirm_publication) cannot change a video's privacy
-- while a Pubblica plan of that video is open: the two clocks would race. Making an older render
-- attempt's upload private again stays possible (the plan publishes another upload).
create function ops._publish_guard_publication() returns trigger
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  if new.confirmed_at is distinct from old.confirmed_at and exists (
    select 1 from public.renders pr join public.publish_schedules s on s.version_id=pr.version_id
      join public.renders sr on sr.id=s.render_id
    where pr.id=new.render_id and s.state in ('draft','awaiting_approval','scheduled','publishing','held')
      and (sr.render_attempt=pr.render_attempt or new.privacy<>'private' or new.publish_at is not null)) then
    raise exception 'a publish plan is already open';
  end if;
  return new;
end;
$$;
create trigger publications_publish_plan_guard before update on public.publications
  for each row execute function ops._publish_guard_publication();

-- Owner postgres, empty search path, exactly one role grant each (ops_core test).
do $grants$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='ops' and (p.proname like '\_publish\_%' or p.proname like 'publish\_%') loop
    execute pg_catalog.format('alter function %s owner to postgres', f);
    execute pg_catalog.format('revoke execute on function %s from public, anon, authenticated, service_role, mdf_web, mdf_auth', f);
  end loop;
end
$grants$;
grant execute on function ops._publish_event(uuid, uuid, text, text, jsonb), ops._publish_problems(text, jsonb),
  ops._publish_hash(uuid), ops._publish_price(uuid), ops._publish_guard_publication(), ops._publish_draft_clean(jsonb), ops._publish_view(uuid), ops._publish_activate(uuid, text),
  ops._publish_do(jsonb, text, jsonb), ops._publish_summary(uuid), ops._publish_run(jsonb, text, jsonb, text, boolean),
  ops._publish_thumbnail_problems(uuid, jsonb), ops.publish_dispatch_hold(uuid, uuid, text),
  ops._publish_chapters(uuid), ops._publish_with_chapters(text, text),
  ops.publish_dispatch_recover(text), ops.publish_dispatch_claim(text, integer), ops.publish_dispatch_intent(uuid, uuid),
  ops.publish_dispatch_handoff(uuid, uuid), ops.publish_dispatch_finish(uuid, uuid, text, text, text) to service_role;
grant execute on function ops.publish_plan(jsonb, uuid, jsonb, jsonb), ops.publish_draft_edit(jsonb, uuid, text, jsonb),
  ops.publish_schedule(jsonb, uuid, timestamptz), ops.publish_preview(jsonb, uuid), ops.publish_request_approval(jsonb, uuid),
  ops.publish_veto(jsonb, uuid), ops.publish_cancel(jsonb, uuid), ops.publish_status(jsonb, uuid),
  ops.publish_approval_decide(jsonb, uuid, text), ops.publish_reopen(jsonb, uuid), ops.publish_rules_list(jsonb), ops.publish_rule_save(jsonb, jsonb),
  ops.publish_rule_delete(jsonb, uuid) to mdf_web;
