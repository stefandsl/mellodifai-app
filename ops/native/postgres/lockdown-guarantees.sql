-- Guarantees of supabase/migrations/20261103080001_ops_alignment_lockdown.sql.
-- The native migration runner executes this block after the lockdown and after
-- every later migration, in that migration's own transaction: a migration that
-- breaks one of them fails and is rolled back with no ledger row. Changing a
-- guarantee is a reviewed change to this file, never a side effect.
do $guarantees$
declare
  broken text[] := '{}';
  allowed constant text[] := array[
    'public.my_playlists()',
    'public.my_queue_positions()',
    'public.my_section_queue()',
    'public.my_stems_queue()',
    'public.my_visualizer_queue()',
    'public.playlist_membership(uuid[])'
  ];
  alignment regprocedure := to_regprocedure('ops.lyric_alignment_request(jsonb, uuid, uuid)');
  item record;
  qual text;
  saved_path text := pg_catalog.current_setting('search_path');
begin
  -- Deparsed expressions below must not depend on the caller's search path.
  perform pg_catalog.set_config('search_path', 'pg_catalog', true);
  -- 1. The studio write stays behind ops: owner postgres, security definer,
  --    empty search path, executable by mdf_web only among client roles.
  if alignment is null then
    broken := broken || 'ops.lyric_alignment_request(jsonb, uuid, uuid) is missing'::text;
  else
    select p.prosecdef, p.proowner::regrole::text as owner, p.proconfig into item
    from pg_catalog.pg_proc p where p.oid = alignment;
    if not item.prosecdef or item.owner <> 'postgres'
       or not ('search_path=""' = any(coalesce(item.proconfig, '{}'))) then
      broken := broken || 'ops.lyric_alignment_request lost its owner, security definer or empty search_path'::text;
    end if;
    if exists (select 1 from pg_catalog.aclexplode((select coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner)) from pg_catalog.pg_proc p where p.oid = alignment)) a
               where a.privilege_type = 'EXECUTE' and a.grantee = 0)
       or pg_catalog.has_function_privilege('anon', alignment, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', alignment, 'EXECUTE') then
      broken := broken || 'ops.lyric_alignment_request is executable by public, anon or authenticated'::text;
    end if;
    if not pg_catalog.has_function_privilege('mdf_web', alignment, 'EXECUTE') then
      broken := broken || 'ops.lyric_alignment_request is not executable by mdf_web'::text;
    end if;
  end if;

  -- 2. No function in schema public is executable by PUBLIC or anon, and
  --    authenticated may execute only the six reviewed read functions.
  for item in
    select p.oid::regprocedure as fn,
      'public.' || pg_catalog.format('%s(%s)', p.proname, pg_catalog.oidvectortypes(p.proargtypes)) as name
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
  loop
    if exists (select 1 from pg_catalog.aclexplode((select coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner)) from pg_catalog.pg_proc p where p.oid = item.fn)) a
               where a.privilege_type = 'EXECUTE' and a.grantee = 0) then
      broken := broken || (item.name || ' is executable by PUBLIC');
    end if;
    if pg_catalog.has_function_privilege('anon', item.fn, 'EXECUTE') then
      broken := broken || (item.name || ' is executable by anon');
    end if;
    if pg_catalog.has_function_privilege('authenticated', item.fn, 'EXECUTE')
       and not (item.name = any(allowed)) then
      broken := broken || (item.name || ' is executable by authenticated');
    end if;
  end loop;

  -- 3. No direct client writes on jobs, projects and versions, whole table or
  --    any column, and the dropped job policies stay dropped.
  if pg_catalog.has_any_column_privilege('authenticated', 'public.jobs', 'INSERT') then
    broken := broken || 'authenticated may insert into public.jobs'::text;
  end if;
  if pg_catalog.has_any_column_privilege('authenticated', 'public.jobs', 'UPDATE') then
    broken := broken || 'authenticated may update public.jobs'::text;
  end if;
  if pg_catalog.has_any_column_privilege('authenticated', 'public.projects', 'INSERT') then
    broken := broken || 'authenticated may insert into public.projects'::text;
  end if;
  if pg_catalog.has_any_column_privilege('authenticated', 'public.versions', 'INSERT') then
    broken := broken || 'authenticated may insert into public.versions'::text;
  end if;
  if exists (select 1 from pg_catalog.pg_policy
             where polrelid = 'public.jobs'::regclass
               and polname in ('owners enqueue jobs', 'owners cancel queued jobs')) then
    broken := broken || 'a dropped client policy on public.jobs exists again'::text;
  end if;
  if to_regprocedure('public.resolve_kie_submission(uuid, text)') is not null then
    broken := broken || 'public.resolve_kie_submission(uuid, text) exists again'::text;
  end if;

  -- 4. Studio file deletes keep the uploads owner and profile role check.
  select pg_catalog.pg_get_expr(polqual, polrelid) into qual
  from pg_catalog.pg_policy
  where polrelid = 'storage.objects'::regclass
    and polname = 'owners delete studio files'
    and polcmd = 'd'
    and polpermissive
    and polroles = array['authenticated'::regrole::oid]
    and polwithcheck is null;
  if qual is null
     or pg_catalog.regexp_replace(qual, '\s+', ' ', 'g')
        <> '((bucket_id = ''uploads''::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text) AND (EXISTS ( SELECT 1 FROM public.profiles WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (profiles.role = ANY (ARRAY[''admin''::text, ''customer''::text]))))))' then
    broken := broken || 'storage policy "owners delete studio files" no longer matches the lockdown'::text;
  end if;

  perform pg_catalog.set_config('search_path', saved_path, true);
  if pg_catalog.cardinality(broken) > 0 then
    raise exception 'Lockdown guarantee broken: %', pg_catalog.array_to_string(broken, '; ')
      using errcode = 'MDFLK';
  end if;
end
$guarantees$;
