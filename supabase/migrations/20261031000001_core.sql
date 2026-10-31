create table public.admin_allowlist (
  email text primary key
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null check (role in ('admin', 'customer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.create_allowlisted_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null and exists (
    select 1
    from public.admin_allowlist
    where lower(email) = lower(new.email)
  ) then
    insert into public.profiles (id, email, role)
    values (new.id, new.email, 'admin')
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

create trigger create_allowlisted_profile_after_user_insert
after insert on auth.users
for each row execute function public.create_allowlisted_profile();

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  topic text not null,
  brief text,
  style text,
  theme text not null default 'general' check (theme in ('vbp', 'general')),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  project_id uuid not null,
  lang text not null check (lang in ('it', 'ru', 'ro', 'ja', 'en', 'es', 'de', 'zh', 'pt', 'ko', 'fr')),
  lyric_pack jsonb,
  chosen_take_id uuid,
  timing_path text,
  storyboard_path text,
  status text not null default 'drafting' check (status in ('drafting', 'lyrics_review', 'song_queued', 'takes_review', 'producing', 'video_review', 'approved', 'publishing', 'published', 'failed')),
  qa_flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (project_id, lang),
  foreign key (project_id, owner_id) references public.projects(id, owner_id) on delete cascade
);

create table public.takes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  version_id uuid not null,
  kie_task_id text,
  audio_preview_path text,
  scores jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (version_id, owner_id) references public.versions(id, owner_id) on delete cascade
);

alter table public.versions
  add constraint versions_chosen_take_id_fkey
  foreign key (chosen_take_id, owner_id) references public.takes(id, owner_id) on delete restrict;

create table public.renders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  version_id uuid not null,
  kind text not null check (kind in ('master', 'hook')),
  path text,
  preview_path text,
  qa_results jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (version_id, owner_id) references public.versions(id, owner_id) on delete cascade
);

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  render_id uuid not null,
  youtube_video_id text,
  privacy text not null default 'private' check (privacy in ('private', 'public', 'unlisted', 'scheduled')),
  metadata jsonb not null default '{}'::jsonb,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (render_id, owner_id) references public.renders(id, owner_id) on delete cascade
);

create table public.workers (
  id text primary key,
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kie_balance integer,
  youtube_uploads_today integer not null default 0,
  youtube_quota_day date,
  last_seen timestamptz,
  busy_job_id uuid,
  engine_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
for each row execute function public.set_updated_at();
create trigger versions_set_updated_at before update on public.versions
for each row execute function public.set_updated_at();
create trigger takes_set_updated_at before update on public.takes
for each row execute function public.set_updated_at();
create trigger renders_set_updated_at before update on public.renders
for each row execute function public.set_updated_at();
create trigger publications_set_updated_at before update on public.publications
for each row execute function public.set_updated_at();
create trigger workers_set_updated_at before update on public.workers
for each row execute function public.set_updated_at();

alter table public.admin_allowlist enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.versions enable row level security;
alter table public.takes enable row level security;
alter table public.renders enable row level security;
alter table public.publications enable row level security;
alter table public.workers enable row level security;

revoke all on table public.admin_allowlist, public.profiles, public.projects, public.versions, public.takes, public.renders, public.publications, public.workers from anon, authenticated;

create policy "profiles are visible to their owner"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "projects are accessible to their profiled owner"
on public.projects for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);

create policy "versions are accessible to their profiled owner"
on public.versions for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);

create policy "takes are accessible to their profiled owner"
on public.takes for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);

create policy "renders are accessible to their profiled owner"
on public.renders for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);

create policy "publications are accessible to their profiled owner"
on public.publications for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);

create policy "workers are accessible to their profiled owner"
on public.workers for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('admin', 'customer'))
);

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.projects, public.versions, public.takes, public.renders, public.publications, public.workers to authenticated;
revoke all on function public.create_allowlisted_profile() from public;

insert into storage.buckets (id, name, public, file_size_limit)
values ('previews', 'previews', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

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
        or (role = 'customer' and (storage.foldername(name))[1] = (select auth.uid())::text)
      )
  )
);
