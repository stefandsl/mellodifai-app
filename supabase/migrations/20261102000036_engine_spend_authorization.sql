create function ops.spend_entries_authorize(p_entries uuid[], p_providers text[])
returns boolean
language sql stable security definer
set search_path = ''
set timezone = 'UTC'
as $$
  select coalesce(cardinality(p_entries) > 0 and cardinality(p_providers) > 0
    and not exists (
      select 1 from unnest(p_entries) as requested(id)
      where not exists (
        select 1 from public.spend_entries e
        join public.reservations r on r.id = e.reservation_id
        where e.id = requested.id and e.state = 'open' and r.state = 'open'
          and e.provider = any(p_providers)
      )
    )
    and not exists (
      select 1 from unnest(p_providers) as requested(provider)
      where not exists (
        select 1 from public.spend_entries e
        where e.id = any(p_entries) and e.provider = requested.provider
      )
    ), false);
$$;
alter function ops.spend_entries_authorize(uuid[], text[]) owner to postgres;
revoke execute on function ops.spend_entries_authorize(uuid[], text[]) from public, anon, authenticated;
grant execute on function ops.spend_entries_authorize(uuid[], text[]) to service_role;
