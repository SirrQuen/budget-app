-- Every view in public: security_invoker set, and the ACL it must carry
-- (CLAUDE.md, "Any migration that creates a view"). Read-only. Run after
-- any migration that creates or recreates a view, on each project it
-- reached:
--
--   npx supabase db query --remote=tztbebdzlezlhvsbylsf --read-only -f docs/view-acl-check.sql   # sorrel-dev
--   npx supabase db query --remote=ybdwqyihvbokowocvlgq --read-only -f docs/view-acl-check.sql   # production
--
-- One row per view, failures first. views_checked is the total, so the
-- report shows it covered every view, not just the ones expected to change.
-- Clean only when views_failed is 0.
--
-- Two kinds of view, each with exactly one right ACL:
--   user-data views   the baseline (migration 57's grant block):
--                     authenticated reads, RLS scopes the rows.
--   operator-only     the owner and nobody else -- no API role at all.
--                     Named here one by one; a view is never operator-only
--                     by default. Today: beta_applications_readable
--                     (migration 78), over the operator-only
--                     beta_applications table.

with operator_only(view) as (
  values ('beta_applications_readable')
),
v as (
  select c.relname                                                   as view,
         coalesce('security_invoker=true' = any (c.reloptions), false) as security_invoker,
         c.relacl::text                                              as acl,
         case when c.relname in (select view from operator_only)
              then '{postgres=arwdDxtm/postgres}'
              else '{postgres=arwdDxtm/postgres,authenticated=rDxtm/postgres,service_role=Dxtm/postgres}'
         end                                                         as expected_acl,
         case when c.relname in (select view from operator_only)
              then 'operator-only' else 'user data' end              as kind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('v', 'm')
)
select view,
       kind,
       security_invoker,
       acl,
       security_invoker and acl = expected_acl                       as pass,
       count(*) over ()                                              as views_checked,
       count(*) filter (where not (security_invoker and acl = expected_acl)) over ()
                                                                     as views_failed,
       -- A named operator-only view that doesn't exist is a failure too:
       -- the list must not outlive the view.
       (select count(*) from operator_only o
         where not exists (select 1 from v where v.view = o.view))   as operator_only_missing
  from v
 order by pass, view;
