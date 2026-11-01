-- Every admin sees the render PC's status (online, kie balance, local engines), not only the
-- admin who owns the worker row; otherwise a second admin sees the PC offline and loses the
-- local engines. Customers still see only their own workers. Column grants are unchanged.
create policy "admins read workers" on public.workers for select to authenticated
using (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));
