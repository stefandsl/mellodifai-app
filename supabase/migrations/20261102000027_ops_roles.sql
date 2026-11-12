do $$
begin
  if exists (
    select 1 from public.admin_allowlist group by lower(email) having count(*) > 1
  ) then
    raise exception 'Allowlist emails differing only by case must be resolved before migration';
  end if;
end;
$$;

create unique index admin_allowlist_email_lower on public.admin_allowlist (lower(email));
alter table public.admin_allowlist add column role text not null default 'customer'
  check (role in ('admin', 'customer'));
update public.admin_allowlist a set role = p.role
  from public.profiles p where lower(p.email) = lower(a.email);

create or replace function public.create_allowlisted_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $$
begin
  if new.email_confirmed_at is not null and new.email is not null then
    insert into public.profiles (id, email, role)
      select new.id, new.email, a.role
      from public.admin_allowlist a where lower(a.email) = lower(new.email)
      on conflict (id) do nothing;
  end if;
  return new;
end;
$$;
alter function public.create_allowlisted_profile() owner to postgres;
