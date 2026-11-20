-- Three cover candidates per video (PIANO-UNIFICATO M2b, Videohub idea 6). The art stage stores
-- them in the master render's qa_results.assets.cover_candidates (apps/worker/src/stages/art.ts).
-- The owner picks one in "Pubblica": the pick is the draft's "cover" field, so the approval hash
-- (ops._publish_hash covers every destination draft) covers it and any change of pick expires a
-- pending card. An agent can list the candidates (publish_preview, publish_status) and propose one
-- (publish_draft_edit); only the owner approves. Additive: four functions replaced in place, no
-- table, column or grant changes (create or replace keeps owner and grants).

create or replace function ops._publish_draft_clean(p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare v_tags jsonb := coalesce(p_draft->'tags','[]'::jsonb);
begin
  if jsonb_typeof(p_draft) is distinct from 'object' then raise exception 'invalid draft'; end if;
  if (p_draft ? 'title' and jsonb_typeof(p_draft->'title') <> 'string')
    or (p_draft ? 'description' and jsonb_typeof(p_draft->'description') <> 'string')
    or (p_draft ? 'thumbnail_text' and jsonb_typeof(p_draft->'thumbnail_text') <> 'string')
    or (p_draft ? 'cover' and (jsonb_typeof(p_draft->'cover') <> 'string' or p_draft->>'cover' !~ '^(cover-[1-3])?$'))
    or jsonb_typeof(v_tags) <> 'array'
    or exists (select 1 from jsonb_array_elements(v_tags) t where jsonb_typeof(t) <> 'string')
    or jsonb_array_length(v_tags) > 100 then
    raise exception 'invalid draft';
  end if;
  return jsonb_build_object(
    'title',coalesce(p_draft->>'title',''),
    'description',coalesce(p_draft->>'description',''),
    'tags',coalesce((select jsonb_agg(btrim(t)) from jsonb_array_elements_text(v_tags) t where btrim(t) <> ''),'[]'::jsonb),
    'thumbnail_text',coalesce(p_draft->>'thumbnail_text',''),
    'cover',coalesce(p_draft->>'cover',''));
end;
$$;

create or replace function ops._publish_thumbnail_problems(p_schedule uuid, p_draft jsonb) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare found jsonb := '[]'::jsonb;
begin
  if coalesce(p_draft->>'cover','') <> '' and not exists (
    select 1 from public.publish_schedules s join public.renders r on r.id=s.render_id
      cross join lateral jsonb_array_elements(case when jsonb_typeof(r.qa_results#>'{assets,cover_candidates}')='array'
        then r.qa_results#>'{assets,cover_candidates}' else '[]'::jsonb end) c
      join storage.objects o on o.bucket_id='previews' and o.name=c->>'path'
    where s.id=p_schedule and c->>'id'=p_draft->>'cover') then
    found := jsonb_build_array(jsonb_build_object('field','cover','code','not_a_candidate'));
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

create or replace function ops._publish_view(p_schedule uuid) returns jsonb
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
    'covers',coalesce((select jsonb_agg(jsonb_build_object('id',c->>'id','path',c->>'path','frame_sec',c->'frame_sec',
        'lyric_free',c->'lyric_free','fonts',coalesce(c->'fonts','[]'::jsonb),'phone',c->'phone','source',c->'source') order by c->>'id')
      from jsonb_array_elements(case when jsonb_typeof(r.qa_results#>'{assets,cover_candidates}')='array'
        then r.qa_results#>'{assets,cover_candidates}' else '[]'::jsonb end) c
      where jsonb_typeof(c)='object' and c->>'id' ~ '^cover-[1-3]$' and jsonb_typeof(c->'path')='string'),'[]'::jsonb),
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

create or replace function ops._publish_activate(p_schedule uuid, p_actor text) returns void
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
      'tags',coalesce((select string_agg(t,',') from jsonb_array_elements_text(d.draft->'tags') t),''),
      'cover',coalesce(d.draft->>'cover','')));
    perform ops._publish_event(s.id,d.id,'private_upload_queued',p_actor,'{}'::jsonb);
  end if;
end;
$$;
