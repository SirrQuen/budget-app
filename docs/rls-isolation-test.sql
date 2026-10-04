-- =====================================================================
-- RLS isolation test
--
-- Run against the linked project after any migration that touches
-- grants, policies or functions:
--
--   npx supabase@latest db query --linked -f docs/rls-isolation-test.sql
--
-- Each check raises on failure, so a clean run returns no error. Nothing
-- here writes data.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 2d -- Function grants
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so a
-- SECURITY DEFINER function is callable by anon through /rest/v1/rpc/*
-- unless a migration revokes it. These grants were read once (Phase 7,
-- 2026-10-04); this makes them a check, so a later migration cannot
-- re-open one silently.
--
-- email_for_username matters most: re-granted, it turns any username
-- into an email address -- an email-harvesting primitive.
-- ---------------------------------------------------------------------
do $$
declare
  v_check record;
  v_failures text[] := '{}';
begin
  for v_check in
    select * from (values
      -- function signature,                                     role,            expected
      ('public.email_for_username(text)',                        'anon',          false),
      ('public.email_for_username(text)',                        'authenticated', false),
      ('public.seed_default_categories(uuid)',                   'anon',          false),
      ('public.seed_default_categories(uuid)',                   'authenticated', false),
      ('public.delete_own_account()',                            'anon',          false),
      ('public.delete_own_account()',                            'authenticated', true),
      -- Trigger functions: closed in migration 36 so nobody has to
      -- re-reason about them.
      ('public.handle_new_user()',                               'anon',          false),
      ('public.handle_new_user()',                               'authenticated', false),
      ('public.enforce_category_type()',                         'anon',          false),
      ('public.enforce_category_type()',                         'authenticated', false),
      ('public.enforce_recurring_variability_scope()',           'anon',          false),
      ('public.enforce_recurring_variability_scope()',           'authenticated', false)
    ) as t(fn, role, expected)
  loop
    if has_function_privilege(v_check.role, v_check.fn::regprocedure, 'execute')
       is distinct from v_check.expected then
      v_failures := v_failures || format('%s EXECUTE on %s: expected %s',
        v_check.role, v_check.fn, v_check.expected);
    end if;
  end loop;

  if cardinality(v_failures) > 0 then
    raise exception E'2d function grants FAILED:\n  %',
      array_to_string(v_failures, E'\n  ');
  end if;

  raise notice '2d function grants: ok';
end
$$;
