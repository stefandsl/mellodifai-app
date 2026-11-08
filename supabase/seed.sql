insert into public.admin_allowlist (email, role)
values ('admin@mellodifai.local', 'admin')
on conflict (email) do nothing;
