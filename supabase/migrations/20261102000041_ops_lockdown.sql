revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.my_playlists(), public.my_queue_positions(),
  public.my_section_queue(), public.my_stems_queue(), public.my_visualizer_queue(),
  public.playlist_membership(uuid[]) to authenticated;

revoke insert on public.jobs from authenticated;
revoke insert (idempotency_key, owner_id, payload, stage, version_id) on public.jobs from authenticated;
revoke update on public.jobs from authenticated;
revoke update (status) on public.jobs from authenticated;
drop policy "owners enqueue jobs" on public.jobs;
drop policy "owners cancel queued jobs" on public.jobs;

revoke insert on public.projects from authenticated;
revoke insert on public.versions from authenticated;
revoke insert (lang, lyric_pack, owner_id, project_id) on public.versions from authenticated;
drop function public.resolve_kie_submission(uuid, text);

alter policy "owners delete studio files" on storage.objects
using (
  bucket_id = 'uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);
