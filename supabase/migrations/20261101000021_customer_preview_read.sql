-- Song previews are stored as previews/<owner>/<project>/<lang>/<file>: the owner is the second
-- folder, not the first (which is always "previews"), so customers could never read their own
-- songs. Admins were unaffected.
drop policy "preview owners and admins can read" on storage.objects;
create policy "preview owners and admins can read"
on storage.objects for select to authenticated
using (
  bucket_id = 'previews'
  and exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and (
        role = 'admin'
        or (role = 'customer' and (storage.foldername(name))[2] = (select auth.uid())::text)
      )
  )
);
