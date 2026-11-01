-- Playlists (feature-parity-plan T10): owner-scoped playlists with ordered songs, plus the time a
-- song was liked so the "Mi piace" system playlist can list the newest like first.
-- The authenticated role can only SELECT the new tables (RLS: the owner's rows); every write goes
-- through a security definer RPC that checks the owner, like the library RPCs of T7.

alter table public.versions add column liked_at timestamptz;
update public.versions set liked_at = updated_at where liked;

create or replace function public.set_reaction(p_version uuid, p_reaction text) returns void
language plpgsql security definer set search_path='' as $$
declare v public.versions := public.web_version(p_version);
begin
  if p_reaction is null or p_reaction not in ('like','dislike','none') then raise exception 'invalid reaction'; end if;
  update public.versions set liked=(p_reaction='like'),disliked=(p_reaction='dislike'),
    liked_at=case when p_reaction='like' then coalesce(case when v.liked then v.liked_at end, now()) else null end
  where id=v.id;
end; $$;

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index playlists_owner_idx on public.playlists (owner_id, created_at);

-- position is 1..n and dense (the RPCs renumber), but it is not unique so a reorder is one update.
create table public.playlist_items (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  version_id uuid not null references public.versions(id) on delete cascade,
  position integer not null check (position >= 1),
  added_at timestamptz not null default now(),
  primary key (playlist_id, version_id)
);
create index playlist_items_order_idx on public.playlist_items (playlist_id, position);
create index playlist_items_version_idx on public.playlist_items (version_id);

alter table public.playlists enable row level security;
alter table public.playlist_items enable row level security;
revoke all on table public.playlists, public.playlist_items from anon, authenticated;
grant select on public.playlists, public.playlist_items to authenticated;
create policy "owners read playlists" on public.playlists for select to authenticated
  using (owner_id = auth.uid());
create policy "owners read playlist items" on public.playlist_items for select to authenticated
  using (exists (select 1 from public.playlists p where p.id = playlist_id and p.owner_id = auth.uid()));

-- The caller's playlist, locked for the rest of the transaction.
create function public.owned_playlist(p_playlist uuid) returns public.playlists
language plpgsql security definer set search_path='' as $$
declare p public.playlists;
begin
  select * into p from public.playlists where id = p_playlist and owner_id = auth.uid() for update;
  if not found then raise exception 'owned playlist required'; end if;
  return p;
end; $$;

-- Positions back to 1..n in the current order.
create function public.renumber_playlist(p_playlist uuid) returns void
language sql security definer set search_path='' as $$
  update public.playlist_items i set position = r.rn
  from (select version_id, row_number() over (order by position, added_at, version_id)::integer rn
        from public.playlist_items where playlist_id = p_playlist) r
  where i.playlist_id = p_playlist and i.version_id = r.version_id and i.position <> r.rn;
$$;

create function public.create_playlist(p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare t text := btrim(coalesce(p_name,'')); new_id uuid;
begin
  if not exists(select 1 from public.profiles where id = auth.uid()) then raise exception 'profile required'; end if;
  if length(t) not between 1 and 100 then raise exception 'invalid name'; end if;
  -- Serialise the count check per owner.
  perform 1 from public.profiles where id = auth.uid() for update;
  if (select count(*) from public.playlists where owner_id = auth.uid()) >= 100 then
    raise exception 'too many playlists';
  end if;
  insert into public.playlists (owner_id, name) values (auth.uid(), t) returning id into new_id;
  return new_id;
end; $$;

create function public.rename_playlist(p_playlist uuid, p_name text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.playlists := public.owned_playlist(p_playlist); t text := btrim(coalesce(p_name,''));
begin
  if length(t) not between 1 and 100 then raise exception 'invalid name'; end if;
  update public.playlists set name = t, updated_at = now() where id = p.id;
end; $$;

-- Deletes the playlist and its entries; the songs themselves are untouched.
create function public.delete_playlist(p_playlist uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.playlists := public.owned_playlist(p_playlist);
begin
  delete from public.playlists where id = p.id;
end; $$;

-- Appends songs in the given order. Songs already in the list, songs the caller does not own and
-- songs in the trash are skipped. Returns how many were added.
create function public.add_to_playlist(p_playlist uuid, p_versions uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare p public.playlists := public.owned_playlist(p_playlist); base integer; n integer;
begin
  if p_versions is null or cardinality(p_versions) not between 1 and 500 then raise exception 'invalid versions'; end if;
  select coalesce(max(position), 0) into base from public.playlist_items where playlist_id = p.id;
  with wanted as (
    select t.v, min(t.n) n from unnest(p_versions) with ordinality as t(v, n) group by t.v
  ), ok as (
    select w.v, w.n from wanted w join public.versions ver on ver.id = w.v
    where ver.owner_id = auth.uid() and ver.trashed_at is null
      and not exists (select 1 from public.playlist_items i where i.playlist_id = p.id and i.version_id = w.v)
  )
  insert into public.playlist_items (playlist_id, version_id, position)
  select p.id, ok.v, base + (row_number() over (order by ok.n))::integer from ok;
  get diagnostics n = row_count;
  update public.playlists set updated_at = now() where id = p.id;
  return n;
end; $$;

-- Returns how many entries were removed; ids that are not in the list do not count.
create function public.remove_from_playlist(p_playlist uuid, p_versions uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare p public.playlists := public.owned_playlist(p_playlist); n integer;
begin
  if p_versions is null or cardinality(p_versions) not between 1 and 500 then raise exception 'invalid versions'; end if;
  delete from public.playlist_items where playlist_id = p.id and version_id = any(p_versions);
  get diagnostics n = row_count;
  perform public.renumber_playlist(p.id);
  update public.playlists set updated_at = now() where id = p.id;
  return n;
end; $$;

-- The given songs move to the front in the given order; songs not listed keep their relative
-- order after them, and ids that are not in the playlist are ignored. A stale list therefore
-- never loses songs that were added meanwhile.
create function public.reorder_playlist(p_playlist uuid, p_versions uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare p public.playlists := public.owned_playlist(p_playlist);
begin
  if p_versions is null or cardinality(p_versions) not between 1 and 1000 then raise exception 'invalid versions'; end if;
  with given as (
    select t.v, min(t.n) n from unnest(p_versions) with ordinality as t(v, n) group by t.v
  ), ranked as (
    select i.version_id,
      (row_number() over (order by (g.n is null), g.n, i.position, i.added_at, i.version_id))::integer rn
    from public.playlist_items i left join given g on g.v = i.version_id
    where i.playlist_id = p.id
  )
  update public.playlist_items i set position = r.rn
  from ranked r where i.playlist_id = p.id and i.version_id = r.version_id;
  update public.playlists set updated_at = now() where id = p.id;
end; $$;

-- The caller's playlists with how many songs each shows (songs in the trash are hidden).
create function public.my_playlists() returns table(id uuid, name text, created_at timestamptz, updated_at timestamptz, song_count integer)
language sql stable security definer set search_path='' as $$
  select p.id, p.name, p.created_at, p.updated_at,
    (select count(*)::integer from public.playlist_items i join public.versions v on v.id = i.version_id
     where i.playlist_id = p.id and v.trashed_at is null)
  from public.playlists p where p.owner_id = auth.uid() order by p.created_at, p.id;
$$;

-- For each of the caller's playlists, how many of the given songs it already holds.
create function public.playlist_membership(p_versions uuid[]) returns table(playlist_id uuid, n integer)
language sql stable security definer set search_path='' as $$
  select p.id, (select count(*)::integer from public.playlist_items i
                where i.playlist_id = p.id and i.version_id = any(p_versions))
  from public.playlists p where p.owner_id = auth.uid() order by p.created_at, p.id;
$$;

revoke all on function public.owned_playlist(uuid), public.renumber_playlist(uuid) from public, anon, authenticated;
revoke all on function public.create_playlist(text), public.rename_playlist(uuid,text), public.delete_playlist(uuid),
  public.add_to_playlist(uuid,uuid[]), public.remove_from_playlist(uuid,uuid[]), public.reorder_playlist(uuid,uuid[]),
  public.my_playlists(), public.playlist_membership(uuid[]) from public, anon;
grant execute on function public.create_playlist(text), public.rename_playlist(uuid,text), public.delete_playlist(uuid),
  public.add_to_playlist(uuid,uuid[]), public.remove_from_playlist(uuid,uuid[]), public.reorder_playlist(uuid,uuid[]),
  public.my_playlists(), public.playlist_membership(uuid[]) to authenticated;
