-- A render whose QA failed is never published through "Pubblica" (PIANO-UNIFICATO R29, M3:
-- "a quality decision per render before publication"; M3 plan task 9: "neither enqueue nor schedule
-- treats an approval override as passing reports"). Until now only public.approve_video read the
-- QA result, and the local admin override (renders.override_reason) approved a failed render:
-- that render could get a plan, an approval card (owner, agent or standing rule) and a handoff.
--
-- The rule, in one place (ops._publish_qa_failed): the QA failed when the render has at least one
-- gate whose "pass" is not true, exactly as public.approve_video decides it. A render with no QA
-- result (no "gates" array, or an empty one: a render made before the QA stage, or a legacy import,
-- which stores {"gates": [], "imported": true}) has not failed. It is not blocked here, because
-- public.approve_video already refuses to approve a current render without a QA result; an approved
-- render without one can only be an old one, and an old approved render keeps its approval.
--
-- Two places use the rule:
-- 1. ops._publish_thumbnail_problems (called before any card is made and by every view) reports
--    {"field": "render", "code": "qa_failed"}: publish_request_approval answers "invalid draft", so
--    no approval_requests row is written for the owner, an agent or a rule, and the dashboard and
--    publish_preview show why.
-- 2. ops.publish_dispatch_intent holds the plan with held_reason 'qa_failed' before the intent, so a
--    card approved earlier (before this migration, or before the QA result changed) never reaches
--    the handoff: the video stays private and nothing is retried until the owner acts.
--
-- Additive: one new function, two replaced in place (create or replace keeps owner and grants), no
-- table, column or data change. Existing approvals, plans and renders are not touched.

create function ops._publish_qa_failed(p_render uuid) returns boolean
language sql stable security definer set search_path = '' set timezone = 'UTC' as $$
  select exists (
    select 1 from public.renders r
      cross join lateral jsonb_array_elements(case when jsonb_typeof(r.qa_results->'gates')='array'
        then r.qa_results->'gates' else '[]'::jsonb end) g
    where r.id=p_render and (g->>'pass') is distinct from 'true');
$$;
-- Owner postgres, empty search path, exactly one role grant (ops_acl test), as its siblings.
alter function ops._publish_qa_failed(uuid) owner to postgres;
revoke execute on function ops._publish_qa_failed(uuid) from public, anon, authenticated, service_role, mdf_web, mdf_auth;
grant execute on function ops._publish_qa_failed(uuid) to service_role;

-- Problems of a plan that depend on its render and not only on the draft text: the failed QA, a
-- cover that is not a candidate, thumbnail text without a base image.
create or replace function ops._publish_thumbnail_problems(p_schedule uuid, p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare found jsonb := '[]'::jsonb;
begin
  if ops._publish_qa_failed((select s.render_id from public.publish_schedules s where s.id=p_schedule)) then
    found := jsonb_build_array(jsonb_build_object('field','render','code','qa_failed'));
  end if;
  if coalesce(p_draft->>'cover','') <> '' and not exists (
    select 1 from public.publish_schedules s join public.renders r on r.id=s.render_id
      cross join lateral jsonb_array_elements(case when jsonb_typeof(r.qa_results#>'{assets,cover_candidates}')='array'
        then r.qa_results#>'{assets,cover_candidates}' else '[]'::jsonb end) c
      join storage.objects o on o.bucket_id='previews' and o.name=c->>'path'
    where s.id=p_schedule and c->>'id'=p_draft->>'cover') then
    found := found || jsonb_build_array(jsonb_build_object('field','cover','code','not_a_candidate'));
  end if;
  if btrim(coalesce(p_draft->>'thumbnail_text','')) = '' or exists (
    select 1 from public.publish_schedules s join public.renders r on r.id=s.render_id
      join storage.objects o on o.bucket_id='previews' and o.name in (r.qa_results#>>'{assets,thumbnail_path}',
        regexp_replace(r.preview_path,'/[^/]*$','')||'/thumbnail-1280x720.png',
        regexp_replace(r.preview_path,'/[^/]*$','')||'/thumbnail.png')
    where s.id=p_schedule) then
    return found;
  end if;
  return found || jsonb_build_array(jsonb_build_object('field','thumbnail_text','code','no_base_image'));
end;
$$;

-- claimed -> intent_recorded, after the worker checked its own health. Rechecks veto, approval and
-- the render's QA result.
create or replace function ops.publish_dispatch_intent(p_destination uuid, p_token uuid) returns boolean
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare s public.publish_schedules; d public.publish_destinations; v public.versions; v_reason text;
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
    v_reason := 'gate_failed';
  elsif ops._publish_qa_failed(s.render_id) then
    v_reason := 'qa_failed';
  end if;
  if v_reason is not null then
    -- Fail closed: the gate no longer holds, nothing goes public.
    update public.publish_destinations set state='scheduled',claim_token=null,claimed_by=null,claim_expires_at=null,updated_at=now() where id=d.id;
    update public.publish_schedules set state='held',held_reason=v_reason,updated_at=now() where id=s.id;
    perform ops._publish_event(s.id,d.id,'held','system',jsonb_build_object('reason',v_reason));
    return false;
  end if;
  update public.publish_destinations set state='intent_recorded',intent_at=now(),updated_at=now() where id=d.id;
  perform ops._publish_event(s.id,d.id,'intent_recorded','system',jsonb_build_object('attempt_id',d.attempt_id));
  return true;
end;
$$;
