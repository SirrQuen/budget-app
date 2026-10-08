-- =====================================================================
-- 09: lastlogin stays NULL until an actual login
--
-- handle_new_user() was setting lastlogin = now() at account creation,
-- so the column was never NULL by the time a user first logged in --
-- any "is this their first sign-in" check against it was dead code.
-- lastlogin should mean last login, not signup time.
--
-- No backfill: existing profiles already have a real lastlogin value
-- (either from an actual prior login, or from this same now()-at-signup
-- bug) and have genuinely been through a login flow, so their history
-- is left as-is.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.profiles (id, first_name, last_name, username, phone, lastlogin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name',  ''),
    nullif(new.raw_user_meta_data ->> 'username', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'phone', ''), new.phone),
    null
  );

  insert into public.settings (userid) values (new.id);

  begin
    perform public.seed_default_categories(new.id);
  exception when others then
    raise warning 'seed_default_categories failed for user %: %', new.id, sqlerrm;
  end;

  return new;
end;
$fn$;
