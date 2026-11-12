-- A kept rewrite is take 3 or later when both generated originals are retained.
alter table public.takes drop constraint takes_number_check;
alter table public.takes add constraint takes_number_check check (take_number > 0);

-- Every newly generated take keeps the words used for its generation.
create function public.snapshot_inserted_take_lyrics() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.lyrics is null then
    select lyric_pack->>'lyrics' into new.lyrics from public.versions
      where id = new.version_id and owner_id = new.owner_id;
  end if;
  return new;
end;
$$;
revoke all on function public.snapshot_inserted_take_lyrics() from public, anon, authenticated;
create trigger snapshot_inserted_take_lyrics before insert on public.takes
for each row execute function public.snapshot_inserted_take_lyrics();

-- Repair legacy null snapshots before changing a version. The earliest rewrite
-- records the original generation's lyrics, even if the version is already rewritten.
create function public.preserve_selected_take_lyrics() returns trigger
language plpgsql set search_path = '' as $$
declare original_lyrics text; selected_lyrics text;
begin
  if old.lyric_pack is distinct from new.lyric_pack
    or old.chosen_take_id is distinct from new.chosen_take_id then
    select e.old_lyrics into original_lyrics from public.section_edits e
      join public.takes src on src.id = e.take_id
      where e.version_id = old.id and src.generation = old.generation_count
      order by e.created_at, e.id limit 1;
    update public.takes set lyrics = coalesce(original_lyrics, old.lyric_pack->>'lyrics')
      where version_id = old.id and generation = old.generation_count and lyrics is null;
    if new.chosen_take_id is not null
      and old.chosen_take_id is distinct from new.chosen_take_id then
      select lyrics into selected_lyrics from public.takes
        where id = new.chosen_take_id and version_id = new.id
          and generation = new.generation_count and owner_id = new.owner_id;
      if selected_lyrics is not null and new.lyric_pack is not null then
        new.lyric_pack := jsonb_set(new.lyric_pack, '{lyrics}', to_jsonb(selected_lyrics));
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_selected_take_lyrics() from public, anon, authenticated;
create trigger preserve_selected_take_lyrics before update of lyric_pack, chosen_take_id on public.versions
for each row execute function public.preserve_selected_take_lyrics();
