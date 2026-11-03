-- A changed audio take needs a new video review, including after publication.
-- Existing publications remain attached to their original render.
create function public.invalidate_take_assets() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.chosen_take_id is distinct from new.chosen_take_id
    and new.chosen_take_id is not null
    and old.status in ('video_review', 'approved', 'published')
    and new.status = old.status
    and exists (select 1 from public.renders where version_id = old.id
      and render_attempt = old.render_attempt and kind = 'master') then
    new.render_attempt := old.render_attempt + 1;
    new.status := 'producing';
    new.storyboard_path := null;
    new.storyboard_sections := null;
    insert into public.jobs(owner_id, version_id, stage, idempotency_key)
      values(new.owner_id, new.id, 'timing', 'timing:' || new.id || ':' || new.render_attempt);
  end if;
  return new;
end;
$$;
revoke all on function public.invalidate_take_assets() from public, anon, authenticated;
create trigger invalidate_take_assets before update of chosen_take_id on public.versions
for each row execute function public.invalidate_take_assets();
