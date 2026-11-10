-- Every view in public: security_invoker set, and the ACL the baseline
-- views carry (CLAUDE.md, "Any migration that creates a view"). Read-only.
-- Run after any migration that creates or recreates a view, on each
-- project it reached:
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf --read-only -f docs/view-acl-check.sql   # sorrel-dev
--   npx supabase db query --remote=ybdwqyihvbokowocvlgq --read-only -f docs/view-acl-check.sql   # production
--
-- One row per view, failures first. views_checked is the total, so the
-- report shows it covered every view, not just the ones expected to change.
-- Clean only when views_failed is 0.

with v as (
  select c.relname                                                   as view,
         coalesce('security_invoker=true' = any (c.reloptions), false) as security_invoker,
         c.relacl::text                                              as acl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('v', 'm')
)
select view,
       security_invoker,
       acl,
       security_invoker
         and acl = '{postgres=arwdDxtm/postgres,authenticated=rDxtm/postgres,service_role=Dxtm/postgres}'
                                                                     as pass,
       count(*) over ()                                              as views_checked,
       count(*) filter (where not (security_invoker
         and acl = '{postgres=arwdDxtm/postgres,authenticated=rDxtm/postgres,service_role=Dxtm/postgres}')) over ()
                                                                     as views_failed
  from v
 order by pass, view;
