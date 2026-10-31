insert into public.admin_allowlist (email)
values ('admin@mellodifai.local')
on conflict (email) do nothing;
