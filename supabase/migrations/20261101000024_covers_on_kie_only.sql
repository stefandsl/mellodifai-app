-- T12: no local engine starts from audio. ACE-Step's whole-song audio-to-audio came out as
-- saturated noise in the end-to-end test (the one-minute feasibility excerpt had worked), and
-- ComfyUI's ReferenceTimbreAudio sang no words, so the studio offers covers, references and
-- extensions on kie only (shared sourceModesFor) and create_song refuses the rest.
create or replace function public.create_song(
  p_prompt text,
  p_lyrics text,
  p_languages text[],
  p_style text,
  p_vocal_gender text,
  p_settings jsonb
) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid; vid uuid; lang_code text; topic text; engine text; src jsonb; mode text; song_source jsonb;
  from_version uuid;
begin
  if not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'profile required'; end if;
  topic := btrim(coalesce(nullif(btrim(p_prompt),''), nullif(btrim(p_settings->>'title'),''), ''));
  if length(topic) not between 1 and 500 then raise exception 'prompt or title required'; end if;
  if length(coalesce(p_lyrics,'')) > 5000 or length(coalesce(p_style,'')) > 1000 then raise exception 'too long'; end if;
  if p_vocal_gender is not null and p_vocal_gender not in ('m','f') then raise exception 'invalid vocal gender'; end if;
  if coalesce(cardinality(p_languages),0)=0 then raise exception 'language required'; end if;
  if exists(select 1 from unnest(p_languages) l where l is null or l not in ('it','ru','ro','ja','en','es','de','zh','pt','ko','fr')) then raise exception 'invalid language'; end if;
  if p_settings is null or jsonb_typeof(p_settings)<>'object' then raise exception 'invalid settings'; end if;
  engine := coalesce(p_settings->>'engine', 'kie');
  if engine not in ('kie','ace-step','yue2') then raise exception 'invalid engine'; end if;
  if engine<>'kie' and not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then
    raise exception 'local engines are admin only';
  end if;
  src := p_settings->'source';
  if src is not null and jsonb_typeof(src) <> 'null' then
    if jsonb_typeof(src) <> 'object' then raise exception 'invalid source'; end if;
    mode := src->>'mode';
    if mode is null or mode not in ('cover', 'reference', 'extend') then raise exception 'invalid source mode'; end if;
    if engine <> 'kie' then
      raise exception 'this engine cannot start from audio in this way';
    end if;
    if (src ? 'upload') = (src ? 'takeId') then raise exception 'an upload or a take, not both'; end if;
    if src ? 'upload' then
      if not public.audio_upload_ok(src->>'upload') then raise exception 'uploaded audio required'; end if;
    else
      select t.version_id into from_version from public.takes t
      where t.id::text = src->>'takeId' and t.owner_id = auth.uid() and t.audio_preview_path is not null;
      if not found then raise exception 'source take required'; end if;
    end if;
    song_source := jsonb_strip_nulls(jsonb_build_object('kind', mode, 'licence', 'own',
      'title', nullif(left(btrim(coalesce(src->>'title', '')), 200), ''),
      'versionId', from_version::text, 'upload', src->>'upload'));
  end if;
  insert into public.projects(owner_id,topic,brief,style,vocal_gender,theme,song_settings,source)
    values(auth.uid(),topic,nullif(btrim(coalesce(p_lyrics,'')),''),nullif(btrim(coalesce(p_style,'')),''),p_vocal_gender,'vbp',p_settings,song_source)
    returning id into pid;
  for lang_code in select distinct unnest(p_languages) loop
    insert into public.versions(owner_id,project_id,lang) values(auth.uid(),pid,lang_code) returning id into vid;
    insert into public.jobs(owner_id,version_id,stage,idempotency_key)
      values(auth.uid(),vid,'draft_lyrics','draft_lyrics:'||vid||':1');
  end loop;
  return pid;
end; $$;
