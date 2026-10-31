-- Audio-only songs: after picking a take the admin can keep just the audio and make the
-- video later (or never).
alter table public.versions drop constraint versions_status_check;
alter table public.versions add constraint versions_status_check check (status in (
  'drafting', 'lyrics_review', 'song_queued', 'takes_review', 'audio_ready', 'producing',
  'video_review', 'approved', 'publishing', 'published', 'failed'));

-- Same checks as pick_take, but the song stops at audio_ready instead of starting the video.
create function public.keep_audio(p_version uuid, p_take uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version);
begin
  if v.status<>'takes_review' then raise exception 'takes review required'; end if;
  if not exists(select 1 from public.takes where id=p_take and version_id=v.id and owner_id=auth.uid() and generation=v.generation_count) then raise exception 'current take required'; end if;
  update public.versions set chosen_take_id=p_take,status='audio_ready' where id=v.id;
end; $$;

-- Starts the video pipeline for an audio-only song, exactly as pick_take would have.
create function public.make_video(p_version uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version);
begin
  if v.status<>'audio_ready' then raise exception 'audio-only song required'; end if;
  if v.chosen_take_id is null then raise exception 'chosen take required'; end if;
  update public.versions set status='producing' where id=v.id;
  insert into public.jobs(owner_id,version_id,stage,idempotency_key) values(auth.uid(),v.id,'timing','timing:'||v.id||':'||v.render_attempt);
end; $$;

revoke all on function public.keep_audio(uuid,uuid), public.make_video(uuid) from public, anon;
grant execute on function public.keep_audio(uuid,uuid), public.make_video(uuid) to authenticated;
