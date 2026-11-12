-- Every entry/settle/close takes the reservation lock before touching its entries or counters.
create function ops.spend_entry_open(p_reservation uuid,p_call_key text,p_provider text,p_model text,p_items_est jsonb)
returns uuid language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare r public.reservations%rowtype; entry_id uuid; usd numeric; dimension record;
begin
  select * into r from public.reservations where id=p_reservation for update;
  if not found then raise exception 'reservation not found'; end if;
  select id into entry_id from public.spend_entries where reservation_id=r.id and call_key=p_call_key;
  if found then return entry_id; end if;
  if r.state<>'open' then raise exception 'reservation already closed or ambiguous'; end if;
  if p_call_key is null or btrim(p_call_key)='' then raise exception 'invalid call key'; end if;
  usd := ops._price_items(p_provider,p_model,p_items_est);
  if not exists (select 1 from jsonb_array_elements(r.estimate) e where e->>'provider'=p_provider) then
    raise exception 'entry_beyond_reservation' using errcode='MDF07';
  end if;
  for dimension in
    select 'usd' unit,usd amount union all select key,value::numeric from jsonb_each_text(p_items_est)
  loop
    if dimension.amount + coalesce((select sum(case when dimension.unit='usd' then usd_est
      else coalesce((items_est->>dimension.unit)::numeric,0) end) from public.spend_entries
      where reservation_id=r.id and provider=p_provider),0)
      > coalesce((select sum(case when dimension.unit='usd' then (e->>'usd')::numeric
        else coalesce((e->'items'->>dimension.unit)::numeric,0) end)
        from jsonb_array_elements(r.estimate) e where e->>'provider'=p_provider),0) then
      raise exception 'entry_beyond_reservation' using errcode='MDF07';
    end if;
  end loop;
  insert into public.spend_entries(reservation_id,call_key,provider,model,items_est,usd_est)
    values(r.id,p_call_key,p_provider,p_model,p_items_est,usd) returning id into entry_id;
  return entry_id;
end;
$$;

-- Keep original windows: consume older charges first, with any excess in the last charged window.
create function ops._reconcile_spend(p_reservation uuid,p_close boolean) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare r public.reservations%rowtype; d record; c record; target numeric; remaining numeric;
  new_amount numeric; next_charges jsonb := '[]';
begin
  select * into r from public.reservations where id=p_reservation for update;
  for d in select scope,key,provider,unit,period,sum(amount) charged
    from jsonb_to_recordset(r.charges) as c(scope text,key text,provider text,unit text,period text,amount numeric)
    group by scope,key,provider,unit,period order by scope,key,provider,unit,period
  loop
    if p_close then
      select coalesce(sum(case when d.unit='usd' then case when state='settled' then usd else usd_est end
        else coalesce((case when state='settled' then items else items_est end->>d.unit)::numeric,0) end),0)
        into target from public.spend_entries where reservation_id=r.id and (d.provider='' or provider=d.provider);
    else
      select coalesce(sum(greatest(reserved,spent)),0) into target from (
        select e->>'provider' provider,sum(case when d.unit='usd' then (e->>'usd')::numeric
          else coalesce((e->'items'->>d.unit)::numeric,0) end) reserved
        from jsonb_array_elements(r.estimate) e where d.provider='' or e->>'provider'=d.provider
        group by e->>'provider'
      ) estimates left join lateral (
        select coalesce(sum(case when d.unit='usd' then usd else coalesce((items->>d.unit)::numeric,0) end),0) spent
        from public.spend_entries where reservation_id=r.id and state='settled' and provider=estimates.provider
      ) actual on true;
      target := greatest(target,d.charged);
    end if;
    remaining := ceil(target*10000)/10000;
    for c in select scope,key,provider,unit,period,window_start,sum(amount) charged,
        row_number() over(order by window_start desc) last_window
      from jsonb_to_recordset(r.charges) as c(scope text,key text,provider text,unit text,period text,window_start date,amount numeric)
      where (scope,key,provider,unit,period)=(d.scope,d.key,d.provider,d.unit,d.period)
      group by scope,key,provider,unit,period,window_start order by window_start
    loop
      new_amount := case when c.last_window=1 then remaining else least(remaining,c.charged) end;
      remaining := remaining-new_amount;
      perform 1 from public.spend_counters
        where (scope,key,provider,unit,period,window_start)=(c.scope,c.key,c.provider,c.unit,c.period,c.window_start) for update;
      update public.spend_counters set used=used+new_amount-c.charged
        where (scope,key,provider,unit,period,window_start)=(c.scope,c.key,c.provider,c.unit,c.period,c.window_start);
      next_charges := next_charges || jsonb_build_array(jsonb_build_object('scope',c.scope,'key',c.key,
        'provider',c.provider,'unit',c.unit,'period',c.period,'window_start',c.window_start,'amount',new_amount));
    end loop;
  end loop;
  update public.reservations set charges=next_charges where id=r.id;
end;
$$;

create function ops.settle_spend(p_entry uuid,p_items jsonb,p_usd numeric default null) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare e public.spend_entries%rowtype; r public.reservations%rowtype; actual numeric; item record;
begin
  select r0.* into r from public.reservations r0 join public.spend_entries e0 on e0.reservation_id=r0.id
    where e0.id=p_entry for update of r0;
  if not found then raise exception 'spend entry not found'; end if;
  select * into e from public.spend_entries where id=p_entry;
  if e.state='settled' then return; end if;
  if p_items is null or jsonb_typeof(p_items)<>'object' or p_items='{}'::jsonb then raise exception 'invalid spend items'; end if;
  for item in select value from jsonb_each(p_items) loop
    if jsonb_typeof(item.value)<>'number' or item.value::numeric<0 then raise exception 'invalid spend items'; end if;
  end loop;
  actual := coalesce(p_usd,ops._price_items(e.provider,e.model,p_items));
  if actual<0 or actual::text in ('NaN','Infinity','-Infinity') then raise exception 'invalid spend amount'; end if;
  update public.spend_entries set items=p_items,usd=actual,state='settled',settled_at=now(),
    over_estimate=actual>3*usd_est where id=e.id;
  -- A late response may arrive after close counted the open call at estimate.
  perform ops._reconcile_spend(r.id,r.state='closed');
end;
$$;

create function ops.mark_ambiguous(p_reservation uuid) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  perform 1 from public.reservations where id=p_reservation for update;
  if not found then raise exception 'reservation not found'; end if;
  update public.reservations set state='ambiguous' where id=p_reservation and state='open';
end;
$$;

create function ops.close_reservation(p_reservation uuid) returns void
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare r public.reservations%rowtype; submit_state text; task_id text; estimate jsonb;
begin
  select * into r from public.reservations where id=p_reservation for update;
  if not found or r.state<>'open' then return; end if;
  if exists(select 1 from public.jobs where id=r.job_id and status in ('queued','running')) then return; end if;
  if r.kie_submit_reserved then
    if r.section_edit_id is not null then
      select kie_submit_state,kie_task_id into submit_state,task_id from public.section_edits
        where id=r.section_edit_id;
    else
      select kie_submit_state,kie_task_id into submit_state,task_id from public.versions
        where id=r.version_id and kie_generation=r.kie_generation;
    end if;
    if submit_state='submitting' then
      perform ops.mark_ambiguous(r.id);
      return;
    end if;
    if submit_state='submitted' and task_id is not null
      and not exists(select 1 from public.spend_entries where reservation_id=r.id and provider='kie') then
      select e into estimate from jsonb_array_elements(r.estimate) e where e->>'provider'='kie' limit 1;
      insert into public.spend_entries(reservation_id,call_key,provider,model,items_est,usd_est,items,usd,state,settled_at)
        values(r.id,'kie:recovered-submit','kie',estimate->>'model',estimate->'items',(estimate->>'usd')::numeric,
          estimate->'items',(estimate->>'usd')::numeric,'settled',now());
    end if;
  end if;
  perform ops._reconcile_spend(r.id,true);
  update public.reservations set state='closed',closed_at=now() where id=r.id;
end;
$$;

create function ops.jobs_close_reservation() returns trigger
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
begin
  if new.status in ('done','failed','cancelled') and old.status is distinct from new.status then
    perform ops.close_reservation(id) from public.reservations where job_id=new.id;
  end if;
  return new;
end;
$$;
create trigger jobs_close_reservation after update of status on public.jobs
  for each row execute function ops.jobs_close_reservation();

create function ops.expire_reservations() returns integer
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare r record; closed integer := 0;
begin
  for r in select r0.id from public.reservations r0 where r0.state='open'
    and not exists(select 1 from public.jobs j where j.id=r0.job_id and j.status in ('queued','running'))
    order by r0.id for update of r0 skip locked
  loop
    perform ops.close_reservation(r.id);
    if exists(select 1 from public.reservations where id=r.id and state<>'open') then closed := closed+1; end if;
  end loop;
  return closed;
end;
$$;

create function ops.worker_enqueue(p_parent_job uuid,p_version uuid,p_stage text,p_idempotency_key text) returns uuid
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare parent public.jobs%rowtype; child public.jobs%rowtype;
begin
  select * into parent from public.jobs where id=p_parent_job;
  if not found then raise exception 'parent job not found'; end if;
  if not exists(select 1 from public.versions where id=p_version and owner_id=parent.owner_id) then
    raise exception 'owned version required';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key)='' then raise exception 'idempotency key required' using errcode='MDF01'; end if;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key,token_id,run_id,fake_providers,priority)
    values(parent.owner_id,p_version,p_stage,p_idempotency_key,parent.token_id,parent.run_id,parent.fake_providers,parent.priority)
    on conflict(idempotency_key) do nothing returning * into child;
  if not found then
    select * into child from public.jobs where idempotency_key=p_idempotency_key;
    if (child.owner_id,child.version_id,child.stage,child.token_id,child.run_id,child.fake_providers,child.priority)
      is distinct from (parent.owner_id,p_version,p_stage,parent.token_id,parent.run_id,parent.fake_providers,parent.priority) then
      raise exception 'invalid idempotency key reuse';
    end if;
    return child.id;
  end if;
  perform ops.reserve_job(child.id);
  return child.id;
exception when sqlstate 'MDF06' then
  raise exception 'cap_exceeded' using errcode='MDF02';
end;
$$;

create function ops.costs_get(p_ctx jsonb,p_from date default null,p_to date default null) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare a record; data jsonb; err jsonb; day date := ops._spend_window('day',now());
begin
  select null::uuid user_id,null::text actor_kind,null::uuid token_id,false remote into a;
  begin
    select * into a from ops._actor(p_ctx);
    if not ('read'=any(a.scopes)) then
      insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
        values(a.user_id,a.actor_kind,a.token_id,'costs_get',coalesce(p_ctx->>'request_hash',''),'error','forbidden_scope',a.remote);
      return jsonb_build_object('ok',false,'code','forbidden_scope','message','read scope required');
    end if;
    p_from := coalesce(p_from,day); p_to := coalesce(p_to,day);
    if p_to<p_from or p_to-p_from>30 then raise exception 'invalid date range'; end if;
    with entries as (
      select e.* from public.spend_entries e join public.reservations r on r.id=e.reservation_id
      where r.user_id=a.user_id and e.state='settled'
        and (e.settled_at at time zone 'Europe/Rome')::date between p_from and p_to
    ), providers as (
      select provider,sum(usd) usd from entries group by provider
    ), caps as (
      select scope,key,provider,unit,period,"limit" from public.spend_caps
        where (scope='global' and key='') or (scope='token' and key=a.token_id::text)
          or (scope='run' and key=p_ctx->>'run_id' and exists(select 1 from public.reservations where user_id=a.user_id and run_id::text=key))
      union all
      select scope,a.user_id::text,provider,unit,period,"limit" from (
        select distinct on(provider,unit,period) * from public.spend_caps
        where scope='user' and key in (a.user_id::text,'default:'||a.role)
        order by provider,unit,period,(key=a.user_id::text) desc
      ) selected
    )
    select jsonb_build_object('from',p_from,'to',p_to,
      'by_provider',coalesce((select jsonb_agg(jsonb_build_object('provider',p.provider,'usd',p.usd,
        'units',(select jsonb_object_agg(unit,amount) from (
          select i.key unit,sum(i.value::numeric) amount from entries e,jsonb_each_text(e.items) i
            where e.provider=p.provider group by i.key
        ) units)) order by p.provider) from providers p),'[]'::jsonb),
      'caps',coalesce((select jsonb_agg(jsonb_build_object('scope',c.scope,'provider',c.provider,
        'unit',c.unit,'period',c.period,'limit',c."limit",'used',coalesce(s.used,0))
        order by c.scope,c.provider,c.unit,c.period) from caps c left join public.spend_counters s
        on (s.scope,s.key,s.provider,s.unit,s.period,s.window_start)=
          (c.scope,c.key,c.provider,c.unit,c.period,ops._spend_window(c.period,now()))),'[]'::jsonb),
      'over_estimate',coalesce((select jsonb_agg(to_jsonb(e) order by e.settled_at,e.id) from entries e where over_estimate),'[]'::jsonb)) into data;
  exception when others then
    err := ops.map_error(sqlstate,sqlerrm);
    insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,error_code,remote)
      values(a.user_id,coalesce(a.actor_kind,'unknown'),a.token_id,'costs_get',coalesce(p_ctx->>'request_hash',''),'error',err->>'code',coalesce(a.remote,false));
    return jsonb_build_object('ok',false,'code',err->>'code',
      'message',case when err->>'code'='internal' then 'Internal error' else sqlerrm end,
      'details',jsonb_build_object('reason',err->>'reason'));
  end;
  insert into public.audit_log(owner_id,actor_kind,token_id,operation,args_hash,result,remote)
    values(a.user_id,a.actor_kind,a.token_id,'costs_get',coalesce(p_ctx->>'request_hash',''),'ok',a.remote);
  perform ops._enter();
  return jsonb_build_object('ok',true,'data',data);
end;
$$;

alter function ops.spend_entry_open(uuid,text,text,text,jsonb) owner to postgres;
revoke execute on function ops.spend_entry_open(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function ops.spend_entry_open(uuid,text,text,text,jsonb) to service_role;

alter function ops._reconcile_spend(uuid,boolean) owner to postgres;
revoke execute on function ops._reconcile_spend(uuid,boolean) from public,anon,authenticated;
grant execute on function ops._reconcile_spend(uuid,boolean) to service_role;

alter function ops.settle_spend(uuid,jsonb,numeric) owner to postgres;
revoke execute on function ops.settle_spend(uuid,jsonb,numeric) from public,anon,authenticated;
grant execute on function ops.settle_spend(uuid,jsonb,numeric) to service_role;

alter function ops.mark_ambiguous(uuid) owner to postgres;
revoke execute on function ops.mark_ambiguous(uuid) from public,anon,authenticated;
grant execute on function ops.mark_ambiguous(uuid) to service_role;

alter function ops.close_reservation(uuid) owner to postgres;
revoke execute on function ops.close_reservation(uuid) from public,anon,authenticated;
grant execute on function ops.close_reservation(uuid) to service_role;

alter function ops.jobs_close_reservation() owner to postgres;
revoke execute on function ops.jobs_close_reservation() from public,anon,authenticated;
grant execute on function ops.jobs_close_reservation() to service_role;

alter function ops.expire_reservations() owner to postgres;
revoke execute on function ops.expire_reservations() from public,anon,authenticated;
grant execute on function ops.expire_reservations() to service_role;

alter function ops.worker_enqueue(uuid,uuid,text,text) owner to postgres;
revoke execute on function ops.worker_enqueue(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function ops.worker_enqueue(uuid,uuid,text,text) to service_role;

alter function ops.costs_get(jsonb,date,date) owner to postgres;
revoke execute on function ops.costs_get(jsonb,date,date) from public,anon,authenticated;
grant execute on function ops.costs_get(jsonb,date,date) to mdf_web;
