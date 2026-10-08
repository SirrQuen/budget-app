-- =====================================================================
-- Baseline: the production schema, 2026-10-08
--
-- Replaces migrations 01-43, which never rebuilt from zero: 01 assumed a
-- hand-built EverNest schema that no migration created. They are kept in
-- supabase/migrations/_archive/ (the CLI ignores subdirectories). See
-- docs/phase-7-findings.md, "The migrations have never rebuilt the
-- database".
--
-- Generated from production, not written by hand:
--   pg_dump --schema-only --no-owner -n public            (ACLs kept)
--   pg_dump --data-only -t public.bank_holidays
-- taken 2026-10-08 01:23 EDT. Edits to the dump output, and only these:
--   * removed the \restrict / \unrestrict psql meta-commands;
--   * removed CREATE SCHEMA public and its COMMENT -- every Supabase
--     project already has them;
--   * removed ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin -- the
--     platform's own defaults, settable only by supabase_admin;
--   * inserted, before the first ACL, a reset of the privileges this
--     database's defaults hand out at CREATE (see the comment there);
--   * appended, at the end, the three things a -n public schema dump
--     cannot carry, each read from production on 2026-10-08.
--
-- What no dump can carry (auth settings, redirect URLs, templates, ...)
-- is in docs/supabase-config.md.
--
-- Production's migration history is reconciled to this file by hand,
-- once; it is never pushed there. Everything after it is an ordinary
-- migration.
-- =====================================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: add_business_days(date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_business_days(anchor date, n integer) RETURNS date
    LANGUAGE plpgsql STABLE
    AS $$
declare
  result date := anchor;
  remaining integer := n;
begin
  if n < 0 then
    raise exception 'add_business_days: n must be >= 0, got %', n;
  end if;

  while remaining > 0 loop
    result := result + 1;
    if public.is_business_day(result) then
      remaining := remaining - 1;
    end if;
  end loop;

  return result;
end;
$$;


--
-- Name: apply_user_timezone(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_user_timezone() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  tz text;
begin
  if auth.uid() is null then
    return;
  end if;

  -- RLS scopes settings to the caller's one row.
  select s.timezone into tz from public.settings s;

  if tz is not null then
    perform set_config('timezone', tz, true);
  end if;
exception when others then
  -- Unknown zone name, or settings unreadable: stay on UTC.
  return;
end;
$$;


--
-- Name: FUNCTION apply_user_timezone(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.apply_user_timezone() IS 'PostgREST db_pre_request: sets TimeZone for the request transaction to settings.timezone, so current_date is the user''s day.';


--
-- Name: category_spend_between(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.category_spend_between(p_from date, p_to date) RETURNS TABLE(group_id uuid, group_name text, group_sort_order integer, category_id uuid, category_name text, total_spend numeric)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select
    cg.id,
    cg.name,
    cg.sort_order,
    c.id,
    c.category_name,
    coalesce(sum(t.amount), 0)
  from transactions t
  join categories c on c.id = t.categoryid
  join category_groups cg on cg.id = c.groupid
  where t.transaction_type = 'Expense'
    and t.transfer_group_id is null
    and c.is_active
    and t.transaction_date between p_from and p_to
  group by cg.id, cg.name, cg.sort_order, c.id, c.category_name;
$$;


--
-- Name: FUNCTION category_spend_between(p_from date, p_to date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.category_spend_between(p_from date, p_to date) IS 'Per-category Expense total between two dates, inclusive. Mirrors v_category_spending''s filters (positive amounts, no transfer legs, active categories only) for spans that do not align to month boundaries. Call twice -- selected window and preceding window -- for the dashboard category-movement comparison.';


--
-- Name: delete_own_account(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_own_account() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'delete_own_account: no authenticated user';
  end if;

  -- children -> parents, so no ON DELETE RESTRICT FK is ever checked with
  -- its referencing rows still present (see 14 for the full reasoning).
  delete from public.goal_contributions
   where goalid in (select id from public.goals where userid = v_uid);

  delete from public.transactions            where userid = v_uid;
  delete from public.recurring_transactions  where userid = v_uid;
  delete from public.investments             where userid = v_uid;
  delete from public.budgets                 where userid = v_uid;
  delete from public.goals                   where userid = v_uid;
  delete from public.accounts                where userid = v_uid;
  delete from public.categories              where userid = v_uid;
  delete from public.category_groups         where userid = v_uid;
  delete from public.notifications           where userid = v_uid;
  delete from public.settings                where userid = v_uid;
  delete from public.subscriptions           where userid = v_uid;

  -- PKCE flow scratch rows -- no FK to auth.users, so not covered by the
  -- cascade below.
  delete from auth.flow_state where user_id = v_uid;

  -- The account itself. `id = v_uid` only -- never a passed-in id. Cascades
  -- to public.profiles (childless by now) and to auth.identities /
  -- auth.sessions / auth.one_time_tokens / auth.mfa_factors / the rest.
  delete from auth.users where id = v_uid;
end;
$$;


--
-- Name: FUNCTION delete_own_account(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.delete_own_account() IS 'Permanently deletes the calling user (auth.uid()): every owned row in public.*, their auth.flow_state rows, then their auth.users row, which cascades to profiles and the rest of auth.*. Irreversible, no backup. Takes no argument by design -- a caller can only delete themselves.';


--
-- Name: email_for_username(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.email_for_username(p_username text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select u.email
    from public.profiles p
    join auth.users u on u.id = p.id
   where lower(p.username) = lower(p_username)
   limit 1;
$$;


--
-- Name: enforce_category_type(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_category_type() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_type text;
begin
  if new.categoryid is null then
    return new;
  end if;

  -- Scoped to the row's owner: another user's category must look the same
  -- as a nonexistent one (see migration 38).
  select category_type into v_type
    from public.categories
   where id = new.categoryid
     and userid = new.userid;

  if v_type is not null and v_type <> new.transaction_type then
    raise exception
      'Category is % but transaction is % (category %)',
      v_type, new.transaction_type, new.categoryid
      using errcode = '23514';
  end if;

  return new;
end;
$$;


--
-- Name: enforce_recurring_variability_scope(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_recurring_variability_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare v_type text;
begin
  if new.amount_is_variable or new.date_tolerance_days > 0 or new.requires_confirmation then
    -- Scoped to the row's owner: another user's category must look the
    -- same as a nonexistent one (see migration 38).
    select category_type into v_type
      from public.categories
     where id = new.categoryid
       and userid = new.userid;

    -- Only checked when NOT a transfer -- a transfer template's own
    -- rectx_variable_requires_statement_day/rectx_transfer_accounts_differ
    -- already cover it, and it has no categoryid to look up (v_type would
    -- be null, wrongly failing the checks below otherwise).
    if new.amount_is_variable and new.to_accountid is null
       and v_type is distinct from 'Income' and v_type is distinct from 'Expense' then
      raise exception
        '"Amount changes each time" is only available for a transfer, an Income schedule, or an Expense schedule (category %)',
        new.categoryid
        using errcode = '23514';
    end if;

    if new.date_tolerance_days > 0
       and v_type is distinct from 'Income' and v_type is distinct from 'Expense' then
      raise exception
        'A variable date is only available for an Income or Expense schedule (category %)',
        new.categoryid
        using errcode = '23514';
    end if;

    if new.requires_confirmation and v_type is distinct from 'Income' then
      raise exception
        'Confirmation is only required for an Income schedule (category %)',
        new.categoryid
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;


--
-- Name: estimate_expense_amount(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estimate_expense_amount(p_recurring_id uuid, p_fallback_amount numeric) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (
      select round(avg(t.amount), 2)
      from (
        select amount
        from transactions
        where recurringid = p_recurring_id and transaction_type = 'Expense'
        order by transaction_date desc, created_at desc
        limit 3
      ) t
      having count(*) >= 3
    ),
    p_fallback_amount
  );
$$;


--
-- Name: FUNCTION estimate_expense_amount(p_recurring_id uuid, p_fallback_amount numeric); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.estimate_expense_amount(p_recurring_id uuid, p_fallback_amount numeric) IS 'Mean of the last three generated Expense transactions linked by recurringid; falls back to p_fallback_amount (the schedule''s stored amount) with fewer than three. Always an estimate for a variable-amount Expense schedule -- see CLAUDE.md "Recurring transactions".';


--
-- Name: estimate_income_amount(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estimate_income_amount(p_recurring_id uuid, p_fallback_amount numeric) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (
      select round(avg(t.amount), 2)
      from (
        select amount
        from transactions
        where recurringid = p_recurring_id and transaction_type = 'Income'
        order by transaction_date desc, created_at desc
        limit 3
      ) t
      having count(*) >= 3
    ),
    p_fallback_amount
  );
$$;


--
-- Name: FUNCTION estimate_income_amount(p_recurring_id uuid, p_fallback_amount numeric); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.estimate_income_amount(p_recurring_id uuid, p_fallback_amount numeric) IS 'Mean of the last three confirmed Income transactions linked by recurringid; falls back to p_fallback_amount (the schedule''s stored amount) with fewer than three. Always an estimate for a variable-amount Income schedule -- see CLAUDE.md "Display".';


--
-- Name: estimate_income_amount_low(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.estimate_income_amount_low(p_recurring_id uuid, p_fallback_amount numeric) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select case
    when count(*) >= 3 then min(t.amount)
    else least(p_fallback_amount, coalesce(min(t.amount), p_fallback_amount))
  end
  from (
    select amount
    from transactions
    where recurringid = p_recurring_id and transaction_type = 'Income'
    order by transaction_date desc, created_at desc
    limit 3
  ) t;
$$;


--
-- Name: FUNCTION estimate_income_amount_low(p_recurring_id uuid, p_fallback_amount numeric); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.estimate_income_amount_low(p_recurring_id uuid, p_fallback_amount numeric) IS 'Low estimate for a variable-amount Income schedule: min of the last three confirmed Income transactions linked by recurringid, or least(stated amount, anything confirmed) with fewer than three. Read by the safe-to-spend projection, which counts income at its low estimate.';


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.profiles (id, first_name, last_name, username, phone, preferred_name, lastlogin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name',  ''),
    nullif(new.raw_user_meta_data ->> 'username', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'phone', ''), new.phone),
    nullif(btrim(new.raw_user_meta_data ->> 'preferred_name'), ''),
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
$$;


--
-- Name: is_business_day(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_business_day(d date) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select extract(isodow from d) < 6
     and not exists (select 1 from public.bank_holidays h where h.date = d);
$$;


--
-- Name: record_login(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_login() RETURNS TABLE(first_name text, last_name text, preferred_name text, previous_login_at timestamp with time zone)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_first_name text;
  v_last_name text;
  v_preferred_name text;
  v_prev timestamptz;
begin
  select p.first_name, p.last_name, p.preferred_name, p.lastlogin
    into v_first_name, v_last_name, v_preferred_name, v_prev
  from public.profiles p
  where p.id = v_uid;

  if not found then
    return;
  end if;

  update public.profiles
     set lastlogin = now()
   where id = v_uid;

  first_name := v_first_name;
  last_name := v_last_name;
  preferred_name := v_preferred_name;
  previous_login_at := v_prev;
  return next;
end;
$$;


--
-- Name: FUNCTION record_login(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.record_login() IS 'Stamps profiles.lastlogin = now() for the current user and returns the name fields plus the PRIOR lastlogin (null before any authenticated request), in one round trip.';


--
-- Name: resolve_recurring_due_date(date, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_recurring_due_date(anchor date, offset_days integer, rule text) RETURNS date
    LANGUAGE plpgsql STABLE
    AS $$
declare
  d date := anchor;
begin
  if offset_days > 0 then
    return public.add_business_days(anchor, offset_days);
  end if;

  if public.is_business_day(anchor) then
    return anchor;
  end if;

  if rule = 'before' then
    while not public.is_business_day(d) loop
      d := d - 1;
    end loop;
  elsif rule = 'after' then
    while not public.is_business_day(d) loop
      d := d + 1;
    end loop;
  end if;
  -- rule = 'none' (or anything unrecognised): d stays anchor, unshifted.

  return d;
end;
$$;


--
-- Name: seed_default_categories(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_categories(p_userid uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.category_groups (userid, name, sort_order)
  select p_userid, v.name, v.sort_order
    from (values
      ('Income',0),
      ('Housing',1),
      ('Food & Dining',2),
      ('Transportation',3),
      ('Bills & Utilities',4),
      ('Shopping',5),
      ('Health & Personal',6),
      ('Entertainment',7),
      ('Financial',8),
      ('Business',9),
      ('Other',10)
    ) as v(name, sort_order)
   where not exists (
     select 1 from public.category_groups cg
      where cg.userid = p_userid and cg.name = v.name
   );

  insert into public.categories (userid, groupid, category_name, category_type, color, is_active)
  select p_userid, g.id, v.category_name, v.category_type, v.color, v.is_active
    from (values
      ('Income','Consulting','Income','#3987e5',true),
      ('Income','Deposits','Income','#3987e5',true),
      ('Income','Dividends Received','Income','#3987e5',true),
      ('Income','Dividends Received (tax-advantaged)','Income','#3987e5',true),
      ('Income','Interest','Income','#3987e5',true),
      ('Income','Investment Income','Income','#3987e5',true),
      ('Income','Other Income','Income','#3987e5',true),
      ('Income','Paychecks/Salary','Income','#3987e5',true),
      ('Income','Refunds & Reimbursements','Income','#3987e5',true),
      ('Income','Retirement Income','Income','#3987e5',true),
      ('Income','Rewards','Income','#3987e5',true),
      ('Income','Sales','Income','#3987e5',true),
      ('Income','Services','Income','#3987e5',true),
      ('Housing','Rent','Expense','#d95926',true),
      ('Housing','Mortgages','Expense','#d95926',true),
      ('Housing','Home Improvement','Expense','#d95926',true),
      ('Housing','Home Maintenance','Expense','#d95926',true),
      ('Housing','Insurance','Expense','#d95926',true),
      ('Food & Dining','Groceries','Expense','#199e70',true),
      ('Food & Dining','Restaurants','Expense','#199e70',true),
      ('Transportation','Automotive','Expense','#c98500',true),
      ('Transportation','Gasoline/Fuel','Expense','#c98500',true),
      ('Transportation','Parking & Tolls','Expense','#c98500',true),
      ('Transportation','Public Transportation','Expense','#c98500',true),
      ('Transportation','Travel','Expense','#c98500',true),
      ('Bills & Utilities','Utilities','Expense','#d55181',true),
      ('Bills & Utilities','Telephone','Expense','#d55181',true),
      ('Bills & Utilities','Cable/Satellite','Expense','#d55181',true),
      ('Bills & Utilities','Online Services','Expense','#d55181',true),
      ('Bills & Utilities','Other Bills','Expense','#d55181',true),
      ('Shopping','Clothing/Shoes','Expense','#008300',true),
      ('Shopping','Electronics','Expense','#008300',true),
      ('Shopping','General Merchandise','Expense','#008300',true),
      ('Shopping','Gifts','Expense','#008300',true),
      ('Shopping','Hobbies','Expense','#008300',true),
      ('Health & Personal','Healthcare/Medical','Expense','#9085e9',true),
      ('Health & Personal','Personal Care','Expense','#9085e9',true),
      ('Health & Personal','Child/Dependent','Expense','#9085e9',true),
      ('Health & Personal','Pets/Pet Care','Expense','#9085e9',true),
      ('Health & Personal','Education','Expense','#9085e9',true),
      ('Entertainment','Entertainment','Expense','#c98500',true),
      ('Entertainment','Dues & Subscriptions','Expense','#c98500',true),
      ('Financial','Loans','Expense','#3987e5',true),
      ('Financial','Taxes','Expense','#3987e5',true),
      ('Financial','Service Charges/Fees','Expense','#3987e5',true),
      ('Financial','Charitable Giving','Expense','#3987e5',true),
      ('Financial','Advisory Fee','Expense','#3987e5',true),
      ('Financial','Checks','Expense','#3987e5',true),
      ('Financial','ATM/Cash','Expense','#3987e5',true),
      ('Business','Advertising','Expense','#d95926',false),
      ('Business','Business Miscellaneous','Expense','#d95926',false),
      ('Business','Office Maintenance','Expense','#d95926',false),
      ('Business','Office Supplies','Expense','#d95926',false),
      ('Business','Postage & Shipping','Expense','#d95926',false),
      ('Business','Printing','Expense','#d95926',false),
      ('Business','Wages Paid','Expense','#d95926',false),
      ('Other','Other Expenses','Expense','#199e70',true)
    ) as v(group_name, category_name, category_type, color, is_active)
    join public.category_groups g on g.userid = p_userid and g.name = v.group_name
   where not exists (
     select 1 from public.categories c
      where c.userid = p_userid
        and c.category_name = v.category_name
        and c.category_type = v.category_type
   );
end;
$$;


--
-- Name: FUNCTION seed_default_categories(p_userid uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_categories(p_userid uuid) IS 'Idempotently tops up a user''s category_groups/categories to the full 11-group/57-category set. Matches existing rows by (category_name, category_type); never updates, moves, or reactivates one. Seeds no category on red (slot 8).';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: signed_amount(numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.signed_amount(p_amount numeric, p_type text) RETURNS numeric
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select case p_type
           when 'Income' then p_amount
           else -p_amount
         end;
$$;


--
-- Name: FUNCTION signed_amount(p_amount numeric, p_type text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.signed_amount(p_amount numeric, p_type text) IS 'Signs a transaction amount by type. Income positive, everything else negative.';


--
-- Name: suggested_safe_to_spend_cushion(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.suggested_safe_to_spend_cushion() RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  with history as (
    select current_date - min(transaction_date) as days
    from transactions
  ),
  span as (
    select least(days, 90) as days
    from history
    where days >= 60
  )
  select coalesce(
    (
      select round(
        coalesce(
          (
            select sum(t.amount)
            from transactions t
            join accounts a on a.id = t.accountid
            where t.transaction_type = 'Expense'
              and t.recurringid is null
              and a.account_type in ('Checking', 'Savings')
              -- A transfer's Expense leg counts only when its Income leg
              -- lands outside Checking/Savings.
              and not exists (
                select 1
                from transactions leg
                join accounts la on la.id = leg.accountid
                where t.transfer_group_id is not null
                  and leg.transfer_group_id = t.transfer_group_id
                  and leg.transaction_type = 'Income'
                  and la.account_type in ('Checking', 'Savings')
              )
              and t.transaction_date > current_date - span.days
              and t.transaction_date <= current_date
          ),
          0
        ) / span.days * 7 / 25
      ) * 25
      from span
    ),
    200
  );
$$;


--
-- Name: FUNCTION suggested_safe_to_spend_cushion(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.suggested_safe_to_spend_cushion() IS 'Default safe-to-spend cushion: seven days of average daily non-recurring spend that leaves Checking/Savings (Expenses from those accounts, and transfers out of the set -- never card spending, which arrives later inside the card payment), trailing 90 days or all history if shorter, rounded to the nearest $25, once there are 60+ days of history; $200 otherwise. settings.safe_to_spend_cushion overrides it when non-null.';


--
-- Name: username_is_available(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.username_is_available(p_username text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select not exists (
    select 1 from public.profiles
     where lower(username) = lower(p_username)
  );
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    userid uuid NOT NULL,
    account_name text NOT NULL,
    institution text,
    account_type text NOT NULL,
    color text DEFAULT '#3B82F6'::text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    opening_balance numeric(12,2) DEFAULT 0.00 NOT NULL,
    account_icon text DEFAULT 'wallet'::text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    opening_date date DEFAULT CURRENT_DATE NOT NULL,
    CONSTRAINT accounts_account_type_check CHECK ((account_type = ANY (ARRAY['Checking'::text, 'Savings'::text, 'Credit Card'::text, 'Loan'::text, 'Investment'::text, 'Cash'::text]))),
    CONSTRAINT accounts_color_hex CHECK (((color IS NULL) OR (color ~* '^#[0-9A-F]{6}$'::text))),
    CONSTRAINT accounts_liability_sign CHECK (((account_type <> ALL (ARRAY['Credit Card'::text, 'Loan'::text])) OR (opening_balance <= (0)::numeric)))
);


--
-- Name: bank_holidays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_holidays (
    date date NOT NULL,
    label text NOT NULL
);


--
-- Name: budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    userid uuid NOT NULL,
    categoryid uuid NOT NULL,
    budget_amount numeric(12,2) DEFAULT 0.00 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    budget_month date NOT NULL,
    CONSTRAINT budgets_amount_nonneg CHECK ((budget_amount >= (0)::numeric)),
    CONSTRAINT budgets_budget_amount_check CHECK ((budget_amount >= (0)::numeric)),
    CONSTRAINT budgets_month_is_first CHECK ((budget_month = (date_trunc('month'::text, (budget_month)::timestamp with time zone))::date)),
    CONSTRAINT budgets_month_is_first_of_month CHECK ((budget_month = (date_trunc('month'::text, (budget_month)::timestamp with time zone))::date))
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    userid uuid NOT NULL,
    groupid uuid NOT NULL,
    category_name text NOT NULL,
    icon text DEFAULT 'circle'::text,
    color text DEFAULT '#9CA3AF'::text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category_type text DEFAULT 'Expense'::text NOT NULL,
    CONSTRAINT categories_category_type_check CHECK ((category_type = ANY (ARRAY['Income'::text, 'Expense'::text]))),
    CONSTRAINT categories_color_hex CHECK (((color IS NULL) OR (color ~* '^#[0-9A-F]{6}$'::text)))
);


--
-- Name: category_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.category_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    userid uuid NOT NULL,
    name text NOT NULL,
    sort_order smallint DEFAULT '0'::smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: goal_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goal_contributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    goalid uuid NOT NULL,
    transactionid uuid,
    amount numeric DEFAULT 0.00 NOT NULL,
    date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    funding_method text DEFAULT 'Manual'::text NOT NULL,
    CONSTRAINT goal_contrib_amount_positive CHECK ((amount > (0)::numeric)),
    CONSTRAINT goal_contributions_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT goal_contributions_funding_method_check CHECK ((((funding_method = 'manual'::text) AND (transactionid IS NULL)) OR ((funding_method = 'transaction'::text) AND (transactionid IS NOT NULL))))
);


--
-- Name: goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    userid uuid NOT NULL,
    goal_name text NOT NULL,
    goal_type text NOT NULL,
    target_amount numeric NOT NULL,
    monthly_contribution numeric,
    target_date date,
    status text DEFAULT 'Active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    accountid uuid,
    tracking_method text DEFAULT 'Manual'::text NOT NULL,
    CONSTRAINT goals_goal_type_check CHECK ((goal_type = ANY (ARRAY['Home'::text, 'Car'::text, 'Vacation'::text, 'Education'::text, 'Wedding'::text, 'Baby'::text, 'Emergency Fund'::text, 'Retirement'::text, 'Debt Payoff'::text, 'Custom'::text]))),
    CONSTRAINT goals_monthly_nonneg CHECK (((monthly_contribution IS NULL) OR (monthly_contribution >= (0)::numeric))),
    CONSTRAINT goals_status_check CHECK ((status = ANY (ARRAY['Active'::text, 'Paused'::text, 'Completed'::text, 'Cancelled'::text]))),
    CONSTRAINT goals_target_amount_check CHECK ((target_amount > (0)::numeric)),
    CONSTRAINT goals_target_positive CHECK ((target_amount > (0)::numeric)),
    CONSTRAINT goals_tracking_method_check CHECK ((tracking_method = ANY (ARRAY['LinkedAccount'::text, 'TaggedTransactions'::text, 'Manual'::text])))
);


--
-- Name: investments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    userid uuid NOT NULL,
    accountid uuid NOT NULL,
    ticker text NOT NULL,
    shares numeric(15,6) DEFAULT '0'::numeric NOT NULL,
    average_cost numeric DEFAULT 0.00 NOT NULL,
    current_price numeric,
    asset_type text DEFAULT 'Stock'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT investments_asset_type_check CHECK ((asset_type = ANY (ARRAY['Stock'::text, 'ETF'::text, 'Crypto'::text, 'Bond'::text, 'Mutual Fund'::text, 'Other'::text]))),
    CONSTRAINT investments_average_cost_check CHECK ((average_cost >= (0)::numeric)),
    CONSTRAINT investments_current_price_check CHECK (((current_price IS NULL) OR (current_price >= (0)::numeric))),
    CONSTRAINT investments_numeric_sane CHECK (((shares >= (0)::numeric) AND (average_cost >= (0)::numeric) AND ((current_price IS NULL) OR (current_price >= (0)::numeric)))),
    CONSTRAINT investments_shares_check CHECK ((shares >= (0)::numeric))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    userid uuid NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    body text,
    notification_type text NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    lastlogin timestamp with time zone,
    subscription_plan text DEFAULT 'Free'::text,
    subscription_status text DEFAULT 'Active'::text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    username text,
    phone text,
    preferred_name text,
    CONSTRAINT profiles_phone_format CHECK (((phone IS NULL) OR (phone ~ '^\+?[0-9 ()\-]{7,20}$'::text))),
    CONSTRAINT profiles_preferred_name_length CHECK (((preferred_name IS NULL) OR ((char_length(btrim(preferred_name)) >= 1) AND (char_length(btrim(preferred_name)) <= 30)))),
    CONSTRAINT profiles_subscription_plan_check CHECK (((subscription_plan IS NULL) OR (subscription_plan = ANY (ARRAY['Free'::text, 'Pro'::text, 'Premium'::text])))),
    CONSTRAINT profiles_subscription_status_check CHECK (((subscription_status IS NULL) OR (subscription_status = ANY (ARRAY['Active'::text, 'Trialing'::text, 'PastDue'::text, 'Canceled'::text, 'Incomplete'::text])))),
    CONSTRAINT profiles_username_format CHECK (((username IS NULL) OR (username ~ '^[A-Za-z0-9_]{3,30}$'::text)))
);


--
-- Name: recurring_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recurring_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    userid uuid NOT NULL,
    accountid uuid NOT NULL,
    categoryid uuid,
    description text NOT NULL,
    amount numeric NOT NULL,
    frequency text DEFAULT 'Monthly'::text NOT NULL,
    next_run_date date NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    start_date date DEFAULT CURRENT_DATE,
    end_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    interval_count integer DEFAULT 1 NOT NULL,
    occurrence_limit integer,
    to_accountid uuid,
    amount_is_variable boolean DEFAULT false NOT NULL,
    statement_day smallint,
    next_amount numeric,
    next_amount_confirmed_at timestamp with time zone,
    business_day_offset smallint DEFAULT 0 NOT NULL,
    non_business_day_rule text DEFAULT 'none'::text NOT NULL,
    next_due_date date NOT NULL,
    date_tolerance_days smallint DEFAULT 0 NOT NULL,
    requires_confirmation boolean DEFAULT false NOT NULL,
    CONSTRAINT rectx_business_day_offset_range CHECK (((business_day_offset >= 0) AND (business_day_offset <= 10))),
    CONSTRAINT rectx_category_required CHECK (((to_accountid IS NOT NULL) OR (categoryid IS NOT NULL))),
    CONSTRAINT rectx_date_order CHECK (((end_date IS NULL) OR (start_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT rectx_date_tolerance_range CHECK (((date_tolerance_days >= 0) AND (date_tolerance_days <= 14))),
    CONSTRAINT rectx_frequency_check CHECK ((frequency = ANY (ARRAY['Daily'::text, 'Weekly'::text, 'Biweekly'::text, 'Monthly'::text, 'Quarterly'::text, 'Yearly'::text]))),
    CONSTRAINT rectx_interval_count_positive CHECK ((interval_count >= 1)),
    CONSTRAINT rectx_next_amount_confirmed_together CHECK (((next_amount IS NULL) = (next_amount_confirmed_at IS NULL))),
    CONSTRAINT rectx_next_amount_nonnegative CHECK (((next_amount IS NULL) OR (next_amount >= (0)::numeric))),
    CONSTRAINT rectx_next_amount_requires_variable CHECK (((next_amount IS NULL) OR amount_is_variable)),
    CONSTRAINT rectx_non_business_day_rule_valid CHECK ((non_business_day_rule = ANY (ARRAY['none'::text, 'before'::text, 'after'::text]))),
    CONSTRAINT rectx_occurrence_limit_positive CHECK (((occurrence_limit IS NULL) OR (occurrence_limit > 0))),
    CONSTRAINT rectx_statement_day_range CHECK (((statement_day IS NULL) OR ((statement_day >= 1) AND (statement_day <= 31)))),
    CONSTRAINT rectx_transfer_accounts_differ CHECK (((to_accountid IS NULL) OR (to_accountid <> accountid))),
    CONSTRAINT rectx_variable_requires_statement_day CHECK (((NOT amount_is_variable) OR (to_accountid IS NULL) OR (statement_day IS NOT NULL))),
    CONSTRAINT recurring_nbd_rule_valid CHECK ((non_business_day_rule = ANY (ARRAY['none'::text, 'forward'::text, 'backward'::text]))),
    CONSTRAINT recurring_next_amount_nonneg CHECK (((next_amount IS NULL) OR (next_amount >= (0)::numeric))),
    CONSTRAINT recurring_statement_day_range CHECK (((statement_day IS NULL) OR ((statement_day >= 1) AND (statement_day <= 31)))),
    CONSTRAINT recurring_tolerance_range CHECK (((date_tolerance_days >= 0) AND (date_tolerance_days <= 14))),
    CONSTRAINT recurring_transactions_check CHECK (((end_date IS NULL) OR (end_date >= start_date)))
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    userid uuid NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    theme text DEFAULT 'system'::text NOT NULL,
    default_budget_month smallint,
    notifications_enabled boolean DEFAULT true NOT NULL,
    date_format text DEFAULT 'MM/DD/YYYY'::text NOT NULL,
    week_start smallint DEFAULT '0'::smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    safe_to_spend_window text,
    safe_to_spend_cushion numeric(12,2),
    timezone text,
    CONSTRAINT settings_budget_month_range CHECK (((default_budget_month IS NULL) OR ((default_budget_month >= 1) AND (default_budget_month <= 12)))),
    CONSTRAINT settings_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT settings_currency_format CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT settings_default_budget_month_check CHECK (((default_budget_month IS NULL) OR ((default_budget_month >= 1) AND (default_budget_month <= 12)))),
    CONSTRAINT settings_safe_to_spend_cushion_nonnegative CHECK (((safe_to_spend_cushion IS NULL) OR (safe_to_spend_cushion >= (0)::numeric))),
    CONSTRAINT settings_safe_to_spend_window_valid CHECK ((safe_to_spend_window = ANY (ARRAY['next_payday'::text, 'end_of_month'::text, 'next_30_days'::text]))),
    CONSTRAINT settings_timezone_length CHECK (((timezone IS NULL) OR ((char_length(timezone) >= 1) AND (char_length(timezone) <= 64)))),
    CONSTRAINT settings_week_start_check CHECK (((week_start >= 0) AND (week_start <= 6))),
    CONSTRAINT settings_week_start_range CHECK (((week_start >= 0) AND (week_start <= 6)))
);


--
-- Name: COLUMN settings.notifications_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.notifications_enabled IS '[SENSITIVE]';


--
-- Name: COLUMN settings.timezone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.timezone IS 'IANA zone for the user''s calendar day. Applied per request by apply_user_timezone(); null = UTC.';


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    userid uuid NOT NULL,
    stripe_customer_id text NOT NULL,
    stripe_subscription_id text NOT NULL,
    plan text DEFAULT 'Free'::text NOT NULL,
    status text DEFAULT 'Active'::text NOT NULL,
    renewal_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_plan_check CHECK ((plan = ANY (ARRAY['Free'::text, 'Pro'::text, 'Premium'::text]))),
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['Active'::text, 'Trialing'::text, 'PastDue'::text, 'Canceled'::text, 'Incomplete'::text])))
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    userid uuid NOT NULL,
    accountid uuid NOT NULL,
    categoryid uuid,
    goalid uuid,
    transaction_date date DEFAULT CURRENT_DATE NOT NULL,
    description text NOT NULL,
    merchant text,
    amount numeric(12,2) DEFAULT 0.00 NOT NULL,
    transaction_type text DEFAULT 'Expense'::text NOT NULL,
    notes text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_method text,
    recurringid uuid,
    transfer_group_id uuid,
    idempotency_key uuid,
    is_estimated boolean DEFAULT false NOT NULL,
    CONSTRAINT transactions_amount_nonneg CHECK ((amount >= (0)::numeric)),
    CONSTRAINT transactions_category_required CHECK (((transfer_group_id IS NOT NULL) OR (categoryid IS NOT NULL))),
    CONSTRAINT transactions_type_check CHECK ((transaction_type = ANY (ARRAY['Income'::text, 'Expense'::text])))
);


--
-- Name: COLUMN transactions.is_estimated; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.is_estimated IS 'True for a transaction generateDueOccurrences posted from a variable-amount Expense schedule''s live estimate (never Income or a card payment, which only ever post a confirmed amount) -- CLAUDE.md "Recurring transactions": auto-created outflows are visibly marked, freely editable, never gated on confirmation. Cleared back to false the moment a user edits the row (updateTransactionAction) -- an edited amount is a known figure, not a guess anymore.';


--
-- Name: v_account_balances; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_account_balances WITH (security_invoker='true') AS
 SELECT a.id AS account_id,
    a.userid,
    a.account_name,
    a.account_type,
    a.institution,
    a.color,
    a.account_icon,
    a.is_active,
    a.opening_balance,
    (a.opening_balance + COALESCE(t.delta, (0)::numeric)) AS balance,
    COALESCE(t.transaction_count, (0)::bigint) AS transaction_count,
    t.first_transaction_date,
    t.last_transaction_date
   FROM (public.accounts a
     LEFT JOIN LATERAL ( SELECT sum(public.signed_amount(tr.amount, tr.transaction_type)) AS delta,
            count(*) AS transaction_count,
            min(tr.transaction_date) AS first_transaction_date,
            max(tr.transaction_date) AS last_transaction_date
           FROM public.transactions tr
          WHERE ((tr.accountid = a.id) AND (tr.transaction_date >= a.opening_date))) t ON (true));


--
-- Name: v_budget_vs_actual; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_budget_vs_actual WITH (security_invoker='true') AS
 SELECT b.id AS budget_id,
    b.userid,
    b.budget_month,
    c.id AS category_id,
    c.category_name,
    c.icon AS category_icon,
    c.color AS category_color,
    cg.id AS group_id,
    cg.name AS group_name,
    b.budget_amount,
    COALESCE(s.actual_spend, (0)::numeric) AS actual_spend,
    (b.budget_amount - COALESCE(s.actual_spend, (0)::numeric)) AS remaining,
        CASE
            WHEN (b.budget_amount > (0)::numeric) THEN round(((COALESCE(s.actual_spend, (0)::numeric) / b.budget_amount) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS pct_used,
    (COALESCE(s.actual_spend, (0)::numeric) > b.budget_amount) AS is_over_budget,
    COALESCE(s.transaction_count, (0)::bigint) AS transaction_count,
        CASE
            WHEN ((b.budget_amount = (0)::numeric) AND (COALESCE(s.actual_spend, (0)::numeric) = (0)::numeric)) THEN 'Unbudgeted'::text
            WHEN (b.budget_amount = (0)::numeric) THEN 'Over'::text
            WHEN (r.ratio >= 1.0) THEN 'Over'::text
            WHEN (r.ratio >= 0.8) THEN 'Near Limit'::text
            ELSE 'On Track'::text
        END AS status,
        CASE
            WHEN ((b.budget_amount = (0)::numeric) AND (COALESCE(s.actual_spend, (0)::numeric) = (0)::numeric)) THEN 0
            WHEN (b.budget_amount = (0)::numeric) THEN 3
            WHEN (r.ratio >= 1.0) THEN 3
            WHEN (r.ratio >= 0.8) THEN 2
            ELSE 1
        END AS status_rank
   FROM ((((public.budgets b
     JOIN public.categories c ON ((c.id = b.categoryid)))
     JOIN public.category_groups cg ON ((cg.id = c.groupid)))
     LEFT JOIN LATERAL ( SELECT sum(t.amount) AS actual_spend,
            count(*) AS transaction_count
           FROM public.transactions t
          WHERE ((t.categoryid = b.categoryid) AND (t.transaction_type = 'Expense'::text) AND (t.transaction_date >= b.budget_month) AND (t.transaction_date < (b.budget_month + '1 mon'::interval)) AND (t.transfer_group_id IS NULL))) s ON (true))
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN (b.budget_amount > (0)::numeric) THEN (COALESCE(s.actual_spend, (0)::numeric) / b.budget_amount)
                    ELSE NULL::numeric
                END AS ratio) r ON (true));


--
-- Name: v_category_activity; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_category_activity WITH (security_invoker='true') AS
 SELECT c.userid,
    c.id AS category_id,
    COALESCE(cur.month_total, (0)::numeric) AS current_month_total,
    COALESCE(life.transaction_count, (0)::bigint) AS lifetime_transaction_count,
    life.last_transaction_date
   FROM ((public.categories c
     LEFT JOIN LATERAL ( SELECT sum(t.amount) AS month_total
           FROM public.transactions t
          WHERE ((t.categoryid = c.id) AND (t.transaction_date >= (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date) AND (t.transaction_date < ((date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon'::interval))::date))) cur ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) AS transaction_count,
            max(t.transaction_date) AS last_transaction_date
           FROM public.transactions t
          WHERE (t.categoryid = c.id)) life ON (true));


--
-- Name: v_category_spending; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_category_spending WITH (security_invoker='true') AS
 SELECT t.userid,
    (date_trunc('month'::text, (t.transaction_date)::timestamp with time zone))::date AS month,
    cg.id AS group_id,
    cg.name AS group_name,
    cg.sort_order AS group_sort_order,
    c.id AS category_id,
    c.category_name,
    c.icon AS category_icon,
    c.color AS category_color,
    sum(t.amount) AS total_spend,
    count(*) AS transaction_count,
    round(avg(t.amount), 2) AS avg_transaction,
    max(t.amount) AS largest_transaction,
    round((((100)::numeric * sum(t.amount)) / NULLIF(sum(sum(t.amount)) OVER (PARTITION BY t.userid, (date_trunc('month'::text, (t.transaction_date)::timestamp with time zone))), (0)::numeric)), 1) AS pct_of_month
   FROM ((public.transactions t
     JOIN public.categories c ON ((c.id = t.categoryid)))
     JOIN public.category_groups cg ON ((cg.id = c.groupid)))
  WHERE ((t.transaction_type = 'Expense'::text) AND (t.transfer_group_id IS NULL))
  GROUP BY t.userid, (date_trunc('month'::text, (t.transaction_date)::timestamp with time zone)), cg.id, cg.name, cg.sort_order, c.id, c.category_name, c.icon, c.color;


--
-- Name: v_daily_cashflow; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_daily_cashflow WITH (security_invoker='true') AS
 SELECT userid,
    transaction_date AS day,
    COALESCE(sum(amount) FILTER (WHERE (transaction_type = 'Income'::text)), (0)::numeric) AS income,
    COALESCE(sum(amount) FILTER (WHERE (transaction_type = 'Expense'::text)), (0)::numeric) AS expenses,
    (COALESCE(sum(amount) FILTER (WHERE (transaction_type = 'Income'::text)), (0)::numeric) - COALESCE(sum(amount) FILTER (WHERE (transaction_type = 'Expense'::text)), (0)::numeric)) AS net_cashflow,
    count(*) AS transaction_count,
    sum((COALESCE(sum(amount) FILTER (WHERE (transaction_type = 'Income'::text)), (0)::numeric) - COALESCE(sum(amount) FILTER (WHERE (transaction_type = 'Expense'::text)), (0)::numeric))) OVER (PARTITION BY userid ORDER BY transaction_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_net
   FROM public.transactions t
  WHERE (transfer_group_id IS NULL)
  GROUP BY userid, transaction_date;


--
-- Name: v_net_worth; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_net_worth WITH (security_invoker='true') AS
 SELECT userid,
    COALESCE(sum(balance) FILTER (WHERE (account_type = ANY (ARRAY['Checking'::text, 'Savings'::text, 'Investment'::text, 'Cash'::text]))), (0)::numeric) AS total_assets,
    COALESCE((- sum(balance) FILTER (WHERE (account_type = ANY (ARRAY['Credit Card'::text, 'Loan'::text])))), (0)::numeric) AS total_liabilities,
    COALESCE(sum(balance), (0)::numeric) AS net_worth,
    count(*) AS account_count
   FROM public.v_account_balances b
  WHERE is_active
  GROUP BY userid;


--
-- Name: v_dashboard_kpis; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_dashboard_kpis WITH (security_invoker='true') AS
 SELECT p.id AS userid,
    (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date AS period_month,
    COALESCE(bal.cash_balance, (0)::numeric) AS cash_balance,
    COALESCE(bal.investment_balance, (0)::numeric) AS investment_balance,
    COALESCE(nw.total_assets, (0)::numeric) AS total_assets,
    COALESCE(nw.total_liabilities, (0)::numeric) AS total_liabilities,
    COALESCE(nw.net_worth, (0)::numeric) AS net_worth,
    COALESCE(cf.income, (0)::numeric) AS total_earned,
    COALESCE(cf.expenses, (0)::numeric) AS total_spent,
    (COALESCE(cf.income, (0)::numeric) - COALESCE(cf.expenses, (0)::numeric)) AS net_cashflow,
        CASE
            WHEN (COALESCE(cf.income, (0)::numeric) > (0)::numeric) THEN round((((cf.income - cf.expenses) / cf.income) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS savings_rate_pct,
    COALESCE(cf.transaction_count, (0)::bigint) AS transaction_count
   FROM (((public.profiles p
     LEFT JOIN LATERAL ( SELECT n.total_assets,
            n.total_liabilities,
            n.net_worth
           FROM public.v_net_worth n
          WHERE (n.userid = p.id)) nw ON (true))
     LEFT JOIN LATERAL ( SELECT sum(b.balance) FILTER (WHERE (b.account_type = ANY (ARRAY['Checking'::text, 'Savings'::text, 'Cash'::text]))) AS cash_balance,
            sum(b.balance) FILTER (WHERE (b.account_type = 'Investment'::text)) AS investment_balance
           FROM public.v_account_balances b
          WHERE ((b.userid = p.id) AND b.is_active)) bal ON (true))
     LEFT JOIN LATERAL ( SELECT sum(t.amount) FILTER (WHERE (t.transaction_type = 'Income'::text)) AS income,
            sum(t.amount) FILTER (WHERE (t.transaction_type = 'Expense'::text)) AS expenses,
            count(*) AS transaction_count
           FROM public.transactions t
          WHERE ((t.userid = p.id) AND (t.transaction_date >= (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date) AND (t.transaction_date < ((date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon'::interval))::date) AND (t.transfer_group_id IS NULL))) cf ON (true));


--
-- Name: v_goal_progress; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_goal_progress WITH (security_invoker='true') AS
 SELECT g.id AS goal_id,
    g.userid,
    g.goal_name,
    g.goal_type,
    g.status,
    g.tracking_method,
    g.accountid,
    g.target_amount,
    g.target_date,
    g.monthly_contribution,
    COALESCE(c.contributed, (0)::numeric) AS contributed_amount,
    GREATEST((g.target_amount - COALESCE(c.contributed, (0)::numeric)), (0)::numeric) AS remaining_amount,
    round((LEAST((COALESCE(c.contributed, (0)::numeric) / NULLIF(g.target_amount, (0)::numeric)), (1)::numeric) * (100)::numeric), 1) AS pct_complete,
    COALESCE(c.contribution_count, (0)::bigint) AS contribution_count,
    c.last_contribution_date,
        CASE
            WHEN (COALESCE(c.contributed, (0)::numeric) >= g.target_amount) THEN CURRENT_DATE
            WHEN (g.monthly_contribution > (0)::numeric) THEN ((CURRENT_DATE + ((ceil(((g.target_amount - COALESCE(c.contributed, (0)::numeric)) / g.monthly_contribution)))::double precision * '1 mon'::interval)))::date
            ELSE NULL::date
        END AS projected_completion_date,
        CASE
            WHEN (g.target_date IS NULL) THEN NULL::boolean
            WHEN (COALESCE(c.contributed, (0)::numeric) >= g.target_amount) THEN true
            WHEN (g.monthly_contribution > (0)::numeric) THEN (((CURRENT_DATE + ((ceil(((g.target_amount - COALESCE(c.contributed, (0)::numeric)) / g.monthly_contribution)))::double precision * '1 mon'::interval)))::date <= g.target_date)
            ELSE false
        END AS is_on_track
   FROM (public.goals g
     LEFT JOIN LATERAL ( SELECT sum(gc.amount) AS contributed,
            count(*) AS contribution_count,
            max(gc.date) AS last_contribution_date
           FROM public.goal_contributions gc
          WHERE (gc.goalid = g.id)) c ON (true));


--
-- Name: v_goals_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_goals_summary WITH (security_invoker='true') AS
 SELECT g.userid,
    count(*) AS total_goals,
    count(*) FILTER (WHERE (g.status = 'Active'::text)) AS active_goals,
    count(*) FILTER (WHERE (g.status = 'Completed'::text)) AS completed_goals,
    count(*) FILTER (WHERE ((g.status = 'Active'::text) AND g.is_on_track)) AS goals_on_track,
    count(*) FILTER (WHERE ((g.status = 'Active'::text) AND (g.is_on_track IS FALSE))) AS goals_off_track,
    COALESCE(sum(g.target_amount) FILTER (WHERE (g.status = 'Active'::text)), (0)::numeric) AS total_target,
    COALESCE(sum(g.contributed_amount) FILTER (WHERE (g.status = 'Active'::text)), (0)::numeric) AS total_saved,
    COALESCE(sum(g.remaining_amount) FILTER (WHERE (g.status = 'Active'::text)), (0)::numeric) AS total_remaining,
    COALESCE(sum(g.monthly_contribution) FILTER (WHERE (g.status = 'Active'::text)), (0)::numeric) AS planned_monthly_contribution,
    COALESCE(m.contributed_this_month, (0)::numeric) AS contributed_this_month,
        CASE
            WHEN (sum(g.target_amount) FILTER (WHERE (g.status = 'Active'::text)) > (0)::numeric) THEN round(((sum(g.contributed_amount) FILTER (WHERE (g.status = 'Active'::text)) / sum(g.target_amount) FILTER (WHERE (g.status = 'Active'::text))) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS overall_pct_complete
   FROM (public.v_goal_progress g
     LEFT JOIN LATERAL ( SELECT sum(gc.amount) AS contributed_this_month
           FROM (public.goal_contributions gc
             JOIN public.goals g2 ON ((g2.id = gc.goalid)))
          WHERE ((g2.userid = g.userid) AND (gc.date >= (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date) AND (gc.date < ((date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone) + '1 mon'::interval))::date))) m ON (true))
  GROUP BY g.userid, m.contributed_this_month;


--
-- Name: v_investment_holdings; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_investment_holdings WITH (security_invoker='true') AS
 SELECT i.id AS investment_id,
    i.userid,
    i.accountid,
    a.account_name,
    i.ticker,
    i.asset_type,
    i.shares,
    i.average_cost,
    i.current_price,
    (i.current_price IS NULL) AS price_is_stale,
    (i.shares > (0)::numeric) AS is_open,
    round((i.shares * i.average_cost), 2) AS cost_basis,
    round((i.shares * COALESCE(i.current_price, i.average_cost)), 2) AS market_value,
    round((i.shares * (COALESCE(i.current_price, i.average_cost) - i.average_cost)), 2) AS unrealized_gain_loss,
        CASE
            WHEN (i.average_cost > (0)::numeric) THEN round((((COALESCE(i.current_price, i.average_cost) - i.average_cost) / i.average_cost) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS unrealized_pct
   FROM (public.investments i
     JOIN public.accounts a ON ((a.id = i.accountid)));


--
-- Name: v_upcoming_recurring; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_upcoming_recurring WITH (security_invoker='true') AS
 SELECT r.id AS recurring_id,
    r.userid,
    r.description,
        CASE
            WHEN (NOT r.amount_is_variable) THEN r.amount
            WHEN ((r.to_accountid IS NOT NULL) AND (r.next_amount_confirmed_at IS NOT NULL)) THEN r.next_amount
            WHEN (r.to_accountid IS NOT NULL) THEN GREATEST((- cb.balance), (0)::numeric)
            WHEN (c.category_type = 'Expense'::text) THEN public.estimate_expense_amount(r.id, r.amount)
            ELSE public.estimate_income_amount(r.id, r.amount)
        END AS amount,
    r.frequency,
    r.next_run_date,
    r.start_date,
    r.end_date,
    r.accountid,
    a.account_name,
    a.color AS account_color,
    r.categoryid,
    c.category_name,
    c.icon AS category_icon,
    c.color AS category_color,
    (r.next_due_date - CURRENT_DATE) AS days_until,
    (r.next_due_date < CURRENT_DATE) AS is_overdue,
    r.interval_count,
    r.occurrence_limit,
    r.to_accountid,
    ta.account_name AS to_account_name,
    c.category_type,
    r.amount_is_variable,
    r.statement_day,
    r.next_amount,
    r.next_amount_confirmed_at,
    (r.amount_is_variable AND ((r.to_accountid IS NULL) OR (r.next_amount_confirmed_at IS NULL))) AS is_estimated_amount,
    r.next_due_date,
    a.account_type,
    ta.account_type AS to_account_type,
    r.date_tolerance_days,
    r.requires_confirmation,
        CASE
            WHEN (r.amount_is_variable AND (r.to_accountid IS NULL) AND (c.category_type = 'Income'::text)) THEN public.estimate_income_amount_low(r.id, r.amount)
            ELSE NULL::numeric
        END AS amount_low,
    r.business_day_offset,
    r.non_business_day_rule,
        CASE
            WHEN (r.occurrence_limit IS NOT NULL) THEN (r.occurrence_limit - ( SELECT count(*) AS count
               FROM public.transactions t
              WHERE (t.recurringid = r.id)))
            ELSE NULL::bigint
        END AS occurrences_remaining,
        CASE
            WHEN (r.amount_is_variable AND (r.to_accountid IS NOT NULL)) THEN GREATEST((- cb.balance), (0)::numeric)
            ELSE NULL::numeric
        END AS card_balance_owed
   FROM ((((public.recurring_transactions r
     JOIN public.accounts a ON ((a.id = r.accountid)))
     LEFT JOIN public.categories c ON ((c.id = r.categoryid)))
     LEFT JOIN public.accounts ta ON ((ta.id = r.to_accountid)))
     LEFT JOIN public.v_account_balances cb ON ((cb.account_id = r.to_accountid)))
  WHERE (r.is_active AND ((r.end_date IS NULL) OR (r.end_date >= CURRENT_DATE)) AND ((r.occurrence_limit IS NULL) OR (( SELECT count(*) AS count
           FROM public.transactions t
          WHERE (t.recurringid = r.id)) < r.occurrence_limit)));


--
-- Name: v_integrity_issues; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_integrity_issues WITH (security_invoker='true') AS
 SELECT 'contribution_amount_mismatch'::text AS issue_type,
    'medium'::text AS severity,
    'goal_contributions'::text AS table_name,
    gc.id AS record_id,
    t.userid,
    format('contribution %s vs transaction %s'::text, gc.amount, t.amount) AS detail
   FROM (public.goal_contributions gc
     JOIN public.transactions t ON ((t.id = gc.transactionid)))
  WHERE (gc.amount IS DISTINCT FROM t.amount)
UNION ALL
 SELECT 'missing_price'::text AS issue_type,
    'low'::text AS severity,
    'investments'::text AS table_name,
    i.investment_id AS record_id,
    i.userid,
    format('%s (%s): %s shares held, no current_price'::text, i.ticker, i.asset_type, i.shares) AS detail
   FROM public.v_investment_holdings i
  WHERE (i.price_is_stale AND i.is_open)
UNION ALL
 SELECT 'recurring_overdue'::text AS issue_type,
    'medium'::text AS severity,
    'recurring_transactions'::text AS table_name,
    r.recurring_id AS record_id,
    r.userid,
    format('%s was due %s (%s days ago)'::text, r.description, r.next_run_date, abs(r.days_until)) AS detail
   FROM public.v_upcoming_recurring r
  WHERE r.is_overdue
UNION ALL
 SELECT 'transfer_leg_mismatch'::text AS issue_type,
    'high'::text AS severity,
    'transactions'::text AS table_name,
    tg.transfer_group_id AS record_id,
    tg.userid,
    format('transfer_group %s: %s leg(s), %s distinct amount(s), %s distinct type(s)'::text, tg.transfer_group_id, tg.leg_count, tg.distinct_amounts, tg.distinct_types) AS detail
   FROM ( SELECT transactions.transfer_group_id,
            transactions.userid,
            count(*) AS leg_count,
            count(DISTINCT transactions.amount) AS distinct_amounts,
            count(DISTINCT transactions.transaction_type) AS distinct_types
           FROM public.transactions
          WHERE (transactions.transfer_group_id IS NOT NULL)
          GROUP BY transactions.transfer_group_id, transactions.userid) tg
  WHERE ((tg.leg_count <> 2) OR (tg.distinct_amounts <> 1) OR (tg.distinct_types <> 2))
UNION ALL
 SELECT 'recurring_due_date_stale'::text AS issue_type,
    'low'::text AS severity,
    'recurring_transactions'::text AS table_name,
    r.id AS record_id,
    r.userid,
    format('stored next_due_date %s, recomputed %s'::text, r.next_due_date, public.resolve_recurring_due_date(r.next_run_date, (r.business_day_offset)::integer, r.non_business_day_rule)) AS detail
   FROM public.recurring_transactions r
  WHERE (r.is_active AND (r.next_due_date IS DISTINCT FROM public.resolve_recurring_due_date(r.next_run_date, (r.business_day_offset)::integer, r.non_business_day_rule)));


--
-- Name: v_monthly_cashflow; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_monthly_cashflow WITH (security_invoker='true') AS
 SELECT userid,
    (date_trunc('month'::text, (transaction_date)::timestamp with time zone))::date AS month,
    COALESCE(sum(amount) FILTER (WHERE (transaction_type = 'Income'::text)), (0)::numeric) AS income,
    COALESCE(sum(amount) FILTER (WHERE (transaction_type = 'Expense'::text)), (0)::numeric) AS expenses,
    (COALESCE(sum(amount) FILTER (WHERE (transaction_type = 'Income'::text)), (0)::numeric) - COALESCE(sum(amount) FILTER (WHERE (transaction_type = 'Expense'::text)), (0)::numeric)) AS net_cashflow,
        CASE
            WHEN (COALESCE(sum(amount) FILTER (WHERE (transaction_type = 'Income'::text)), (0)::numeric) > (0)::numeric) THEN round((((COALESCE(sum(amount) FILTER (WHERE (transaction_type = 'Income'::text)), (0)::numeric) - COALESCE(sum(amount) FILTER (WHERE (transaction_type = 'Expense'::text)), (0)::numeric)) / sum(amount) FILTER (WHERE (transaction_type = 'Income'::text))) * (100)::numeric), 1)
            ELSE NULL::numeric
        END AS savings_rate_pct,
    count(*) FILTER (WHERE (transaction_type = 'Income'::text)) AS income_count,
    count(*) FILTER (WHERE (transaction_type = 'Expense'::text)) AS expense_count
   FROM public.transactions t
  WHERE (transfer_group_id IS NULL)
  GROUP BY userid, ((date_trunc('month'::text, (transaction_date)::timestamp with time zone))::date);


--
-- Name: v_portfolio_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_portfolio_summary WITH (security_invoker='true') AS
 SELECT userid,
    accountid,
    account_name,
    count(*) AS holding_count,
    count(*) FILTER (WHERE price_is_stale) AS stale_price_count,
    sum(cost_basis) AS total_cost_basis,
    sum(market_value) AS total_market_value,
    sum(unrealized_gain_loss) AS total_unrealized_gain_loss,
        CASE
            WHEN (sum(cost_basis) > (0)::numeric) THEN round(((sum(unrealized_gain_loss) / sum(cost_basis)) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS total_return_pct,
    round((((100)::numeric * sum(market_value)) / NULLIF(sum(sum(market_value)) OVER (PARTITION BY userid), (0)::numeric)), 1) AS pct_of_portfolio
   FROM public.v_investment_holdings h
  WHERE is_open
  GROUP BY userid, accountid, account_name;


--
-- Name: profiles Users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT "Users_pkey" PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: bank_holidays bank_holidays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_holidays
    ADD CONSTRAINT bank_holidays_pkey PRIMARY KEY (date);


--
-- Name: budgets budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_pkey PRIMARY KEY (id);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: category_groups category_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_groups
    ADD CONSTRAINT category_groups_pkey PRIMARY KEY (id);


--
-- Name: goal_contributions goal_contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_contributions
    ADD CONSTRAINT goal_contributions_pkey PRIMARY KEY (id);


--
-- Name: goals goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_pkey PRIMARY KEY (id);


--
-- Name: investments investments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investments
    ADD CONSTRAINT investments_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: recurring_transactions recurring_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: settings settings_theme_valid; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.settings
    ADD CONSTRAINT settings_theme_valid CHECK ((theme = ANY (ARRAY['light'::text, 'dark'::text, 'system'::text]))) NOT VALID;


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: idx_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_id ON public.transactions USING btree (accountid);


--
-- Name: idx_accounts_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_type ON public.accounts USING btree (account_type);


--
-- Name: idx_accounts_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_user_id ON public.accounts USING btree (userid);


--
-- Name: idx_accounts_userid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_userid ON public.accounts USING btree (userid);


--
-- Name: idx_bud_cat_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bud_cat_id ON public.budgets USING btree (categoryid);


--
-- Name: idx_bud_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bud_month ON public.budgets USING btree (budget_month);


--
-- Name: idx_bud_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bud_user_id ON public.budgets USING btree (userid);


--
-- Name: idx_budgets_categoryid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budgets_categoryid ON public.budgets USING btree (categoryid);


--
-- Name: idx_budgets_userid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budgets_userid ON public.budgets USING btree (userid);


--
-- Name: idx_cat_groups_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cat_groups_user_id ON public.category_groups USING btree (userid);


--
-- Name: idx_categories_groupid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_groupid ON public.categories USING btree (groupid);


--
-- Name: idx_categories_userid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_userid ON public.categories USING btree (userid);


--
-- Name: idx_category_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_category_group_id ON public.categories USING btree (groupid);


--
-- Name: idx_category_groups_userid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_category_groups_userid ON public.category_groups USING btree (userid);


--
-- Name: idx_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_category_id ON public.transactions USING btree (categoryid);


--
-- Name: idx_category_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_category_user_id ON public.categories USING btree (userid);


--
-- Name: idx_goal_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_account_id ON public.goals USING btree (accountid);


--
-- Name: idx_goal_contrib_goalid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_contrib_goalid ON public.goal_contributions USING btree (goalid);


--
-- Name: idx_goal_contrib_txid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_contrib_txid ON public.goal_contributions USING btree (transactionid) WHERE (transactionid IS NOT NULL);


--
-- Name: idx_goal_contribution_amount; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_contribution_amount ON public.goal_contributions USING btree (amount);


--
-- Name: idx_goal_contribution_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_contribution_date ON public.goal_contributions USING btree (date);


--
-- Name: idx_goal_contribution_goal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_contribution_goal_id ON public.goal_contributions USING btree (goalid);


--
-- Name: idx_goal_contribution_transaction_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_contribution_transaction_id ON public.goal_contributions USING btree (transactionid);


--
-- Name: idx_goal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_id ON public.transactions USING btree (goalid);


--
-- Name: idx_goal_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goal_user_id ON public.goals USING btree (userid);


--
-- Name: idx_goals_accountid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goals_accountid ON public.goals USING btree (accountid) WHERE (accountid IS NOT NULL);


--
-- Name: idx_goals_userid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_goals_userid ON public.goals USING btree (userid);


--
-- Name: idx_investment_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_investment_account_id ON public.investments USING btree (accountid);


--
-- Name: idx_investment_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_investment_user_id ON public.investments USING btree (userid);


--
-- Name: idx_investments_accountid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_investments_accountid ON public.investments USING btree (accountid);


--
-- Name: idx_investments_userid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_investments_userid ON public.investments USING btree (userid);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (userid, created_at DESC) WHERE (NOT is_read);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (userid);


--
-- Name: idx_notifications_userid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_userid ON public.notifications USING btree (userid);


--
-- Name: idx_rectx_accountid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rectx_accountid ON public.recurring_transactions USING btree (accountid);


--
-- Name: idx_rectx_categoryid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rectx_categoryid ON public.recurring_transactions USING btree (categoryid);


--
-- Name: idx_rectx_next_run_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rectx_next_run_active ON public.recurring_transactions USING btree (next_run_date) WHERE is_active;


--
-- Name: idx_rectx_userid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rectx_userid ON public.recurring_transactions USING btree (userid);


--
-- Name: idx_recurring_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_account_id ON public.recurring_transactions USING btree (accountid);


--
-- Name: idx_recurring_amount; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_amount ON public.recurring_transactions USING btree (amount);


--
-- Name: idx_recurring_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_category_id ON public.recurring_transactions USING btree (categoryid);


--
-- Name: idx_recurring_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recurring_user_id ON public.recurring_transactions USING btree (userid);


--
-- Name: idx_setting_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_setting_user_id ON public.settings USING btree (userid);


--
-- Name: idx_settings_userid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settings_userid ON public.settings USING btree (userid);


--
-- Name: idx_subscription_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_user_id ON public.subscriptions USING btree (userid);


--
-- Name: idx_subscriptions_userid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_userid ON public.subscriptions USING btree (userid);


--
-- Name: idx_transactions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_date ON public.transactions USING btree (transaction_date);


--
-- Name: idx_transactions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_user_id ON public.transactions USING btree (userid);


--
-- Name: idx_tx_account_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_account_date ON public.transactions USING btree (accountid, transaction_date);


--
-- Name: idx_tx_category_date_expense; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_category_date_expense ON public.transactions USING btree (categoryid, transaction_date) WHERE (transaction_type = 'Expense'::text);


--
-- Name: idx_tx_categoryid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_categoryid ON public.transactions USING btree (categoryid);


--
-- Name: idx_tx_goalid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_goalid ON public.transactions USING btree (goalid) WHERE (goalid IS NOT NULL);


--
-- Name: idx_tx_recurringid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_recurringid ON public.transactions USING btree (recurringid) WHERE (recurringid IS NOT NULL);


--
-- Name: idx_tx_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tx_user_date ON public.transactions USING btree (userid, transaction_date);


--
-- Name: profiles_username_lower_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_username_lower_key ON public.profiles USING btree (lower(username));


--
-- Name: recurring_tx_no_double_post; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX recurring_tx_no_double_post ON public.transactions USING btree (recurringid, transaction_date, transaction_type) WHERE (recurringid IS NOT NULL);


--
-- Name: transactions_transfer_group_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_transfer_group_idx ON public.transactions USING btree (transfer_group_id) WHERE (transfer_group_id IS NOT NULL);


--
-- Name: transactions_userid_idempotency_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX transactions_userid_idempotency_key_key ON public.transactions USING btree (userid, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: accounts trg_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: goals trg_goals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_goals_updated_at BEFORE UPDATE ON public.goals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles trg_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: recurring_transactions trg_recurring_variability_scope; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recurring_variability_scope BEFORE INSERT OR UPDATE OF amount_is_variable, date_tolerance_days, requires_confirmation, categoryid, to_accountid ON public.recurring_transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_recurring_variability_scope();


--
-- Name: settings trg_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: transactions trg_transactions_category_type; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_transactions_category_type BEFORE INSERT OR UPDATE OF categoryid, transaction_type ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_category_type();


--
-- Name: transactions trg_transactions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_transactions_updated_at BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: accounts accounts_userid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_userid_fkey FOREIGN KEY (userid) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: budgets budgets_categoryid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_categoryid_fkey FOREIGN KEY (categoryid) REFERENCES public.categories(id) ON DELETE CASCADE;


--
-- Name: budgets budgets_userid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_userid_fkey FOREIGN KEY (userid) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: categories categories_groupid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_groupid_fkey FOREIGN KEY (groupid) REFERENCES public.category_groups(id) ON DELETE RESTRICT;


--
-- Name: categories categories_userid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_userid_fkey FOREIGN KEY (userid) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: category_groups category_groups_userid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.category_groups
    ADD CONSTRAINT category_groups_userid_fkey FOREIGN KEY (userid) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: goal_contributions goal_contributions_goalid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_contributions
    ADD CONSTRAINT goal_contributions_goalid_fkey FOREIGN KEY (goalid) REFERENCES public.goals(id) ON DELETE CASCADE;


--
-- Name: goal_contributions goal_contributions_transactionid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goal_contributions
    ADD CONSTRAINT goal_contributions_transactionid_fkey FOREIGN KEY (transactionid) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: goals goals_accountid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_accountid_fkey FOREIGN KEY (accountid) REFERENCES public.accounts(id) ON DELETE SET NULL;


--
-- Name: goals goals_userid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_userid_fkey FOREIGN KEY (userid) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: investments investments_accountid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investments
    ADD CONSTRAINT investments_accountid_fkey FOREIGN KEY (accountid) REFERENCES public.accounts(id) ON DELETE RESTRICT;


--
-- Name: investments investments_userid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investments
    ADD CONSTRAINT investments_userid_fkey FOREIGN KEY (userid) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_userid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_userid_fkey FOREIGN KEY (userid) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: recurring_transactions recurring_transactions_accountid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_accountid_fkey FOREIGN KEY (accountid) REFERENCES public.accounts(id) ON DELETE RESTRICT;


--
-- Name: recurring_transactions recurring_transactions_categoryid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_categoryid_fkey FOREIGN KEY (categoryid) REFERENCES public.categories(id) ON DELETE RESTRICT;


--
-- Name: recurring_transactions recurring_transactions_to_accountid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_to_accountid_fkey FOREIGN KEY (to_accountid) REFERENCES public.accounts(id) ON DELETE RESTRICT;


--
-- Name: recurring_transactions recurring_transactions_userid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recurring_transactions
    ADD CONSTRAINT recurring_transactions_userid_fkey FOREIGN KEY (userid) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: settings settings_userid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_userid_fkey FOREIGN KEY (userid) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_userid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_userid_fkey FOREIGN KEY (userid) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_accountid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_accountid_fkey FOREIGN KEY (accountid) REFERENCES public.accounts(id) ON DELETE RESTRICT;


--
-- Name: transactions transactions_categoryid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_categoryid_fkey FOREIGN KEY (categoryid) REFERENCES public.categories(id) ON DELETE RESTRICT;


--
-- Name: transactions transactions_goalid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_goalid_fkey FOREIGN KEY (goalid) REFERENCES public.goals(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_recurringid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_recurringid_fkey FOREIGN KEY (recurringid) REFERENCES public.recurring_transactions(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_userid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_userid_fkey FOREIGN KEY (userid) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: accounts accounts_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_delete_own ON public.accounts FOR DELETE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: accounts accounts_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_insert_own ON public.accounts FOR INSERT TO authenticated WITH CHECK ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: accounts accounts_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_select_own ON public.accounts FOR SELECT TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: accounts accounts_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_update_own ON public.accounts FOR UPDATE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid))) WITH CHECK ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: bank_holidays; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_holidays ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_holidays bank_holidays_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bank_holidays_select_authenticated ON public.bank_holidays FOR SELECT TO authenticated USING (true);


--
-- Name: budgets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

--
-- Name: budgets budgets_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY budgets_delete_own ON public.budgets FOR DELETE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: budgets budgets_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY budgets_insert_own ON public.budgets FOR INSERT TO authenticated WITH CHECK (((userid = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.categories c
  WHERE ((c.id = budgets.categoryid) AND (c.userid = ( SELECT auth.uid() AS uid)))))));


--
-- Name: budgets budgets_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY budgets_select_own ON public.budgets FOR SELECT TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: budgets budgets_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY budgets_update_own ON public.budgets FOR UPDATE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid))) WITH CHECK (((userid = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.categories c
  WHERE ((c.id = budgets.categoryid) AND (c.userid = ( SELECT auth.uid() AS uid)))))));


--
-- Name: categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

--
-- Name: categories categories_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_delete_own ON public.categories FOR DELETE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: categories categories_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_insert_own ON public.categories FOR INSERT TO authenticated WITH CHECK (((userid = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.category_groups g
  WHERE ((g.id = categories.groupid) AND (g.userid = ( SELECT auth.uid() AS uid)))))));


--
-- Name: categories categories_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_select_own ON public.categories FOR SELECT TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: categories categories_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY categories_update_own ON public.categories FOR UPDATE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid))) WITH CHECK (((userid = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.category_groups g
  WHERE ((g.id = categories.groupid) AND (g.userid = ( SELECT auth.uid() AS uid)))))));


--
-- Name: category_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.category_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: category_groups category_groups_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY category_groups_delete_own ON public.category_groups FOR DELETE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: category_groups category_groups_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY category_groups_insert_own ON public.category_groups FOR INSERT TO authenticated WITH CHECK ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: category_groups category_groups_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY category_groups_select_own ON public.category_groups FOR SELECT TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: category_groups category_groups_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY category_groups_update_own ON public.category_groups FOR UPDATE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid))) WITH CHECK ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: goal_contributions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.goal_contributions ENABLE ROW LEVEL SECURITY;

--
-- Name: goal_contributions goal_contributions_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goal_contributions_delete_own ON public.goal_contributions FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.goals g
  WHERE ((g.id = goal_contributions.goalid) AND (g.userid = ( SELECT auth.uid() AS uid))))));


--
-- Name: goal_contributions goal_contributions_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goal_contributions_insert_own ON public.goal_contributions FOR INSERT TO authenticated WITH CHECK (((EXISTS ( SELECT 1
   FROM public.goals g
  WHERE ((g.id = goal_contributions.goalid) AND (g.userid = ( SELECT auth.uid() AS uid))))) AND ((transactionid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.transactions t
  WHERE ((t.id = goal_contributions.transactionid) AND (t.userid = ( SELECT auth.uid() AS uid))))))));


--
-- Name: goal_contributions goal_contributions_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goal_contributions_select_own ON public.goal_contributions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.goals g
  WHERE ((g.id = goal_contributions.goalid) AND (g.userid = ( SELECT auth.uid() AS uid))))));


--
-- Name: goal_contributions goal_contributions_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goal_contributions_update_own ON public.goal_contributions FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.goals g
  WHERE ((g.id = goal_contributions.goalid) AND (g.userid = ( SELECT auth.uid() AS uid)))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.goals g
  WHERE ((g.id = goal_contributions.goalid) AND (g.userid = ( SELECT auth.uid() AS uid))))) AND ((transactionid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.transactions t
  WHERE ((t.id = goal_contributions.transactionid) AND (t.userid = ( SELECT auth.uid() AS uid))))))));


--
-- Name: goals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

--
-- Name: goals goals_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goals_delete_own ON public.goals FOR DELETE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: goals goals_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goals_insert_own ON public.goals FOR INSERT TO authenticated WITH CHECK (((userid = ( SELECT auth.uid() AS uid)) AND ((accountid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.accounts a
  WHERE ((a.id = goals.accountid) AND (a.userid = ( SELECT auth.uid() AS uid))))))));


--
-- Name: goals goals_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goals_select_own ON public.goals FOR SELECT TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: goals goals_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY goals_update_own ON public.goals FOR UPDATE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid))) WITH CHECK (((userid = ( SELECT auth.uid() AS uid)) AND ((accountid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.accounts a
  WHERE ((a.id = goals.accountid) AND (a.userid = ( SELECT auth.uid() AS uid))))))));


--
-- Name: investments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;

--
-- Name: investments investments_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY investments_delete_own ON public.investments FOR DELETE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: investments investments_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY investments_insert_own ON public.investments FOR INSERT TO authenticated WITH CHECK (((userid = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.accounts a
  WHERE ((a.id = investments.accountid) AND (a.userid = ( SELECT auth.uid() AS uid)))))));


--
-- Name: investments investments_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY investments_select_own ON public.investments FOR SELECT TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: investments investments_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY investments_update_own ON public.investments FOR UPDATE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid))) WITH CHECK (((userid = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.accounts a
  WHERE ((a.id = investments.accountid) AND (a.userid = ( SELECT auth.uid() AS uid)))))));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_delete_own ON public.notifications FOR DELETE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: notifications notifications_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: notifications notifications_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid))) WITH CHECK ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles profiles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: recurring_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recurring_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: recurring_transactions recurring_transactions_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_transactions_delete_own ON public.recurring_transactions FOR DELETE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: recurring_transactions recurring_transactions_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_transactions_insert_own ON public.recurring_transactions FOR INSERT TO authenticated WITH CHECK (((userid = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.accounts a
  WHERE ((a.id = recurring_transactions.accountid) AND (a.userid = ( SELECT auth.uid() AS uid))))) AND ((to_accountid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.accounts a
  WHERE ((a.id = recurring_transactions.to_accountid) AND (a.userid = ( SELECT auth.uid() AS uid)))))) AND ((categoryid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.categories c
  WHERE ((c.id = recurring_transactions.categoryid) AND (c.userid = ( SELECT auth.uid() AS uid))))))));


--
-- Name: recurring_transactions recurring_transactions_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_transactions_select_own ON public.recurring_transactions FOR SELECT TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: recurring_transactions recurring_transactions_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recurring_transactions_update_own ON public.recurring_transactions FOR UPDATE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid))) WITH CHECK (((userid = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.accounts a
  WHERE ((a.id = recurring_transactions.accountid) AND (a.userid = ( SELECT auth.uid() AS uid))))) AND ((to_accountid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.accounts a
  WHERE ((a.id = recurring_transactions.to_accountid) AND (a.userid = ( SELECT auth.uid() AS uid)))))) AND ((categoryid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.categories c
  WHERE ((c.id = recurring_transactions.categoryid) AND (c.userid = ( SELECT auth.uid() AS uid))))))));


--
-- Name: settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

--
-- Name: settings settings_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_delete_own ON public.settings FOR DELETE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: settings settings_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_insert_own ON public.settings FOR INSERT TO authenticated WITH CHECK ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: settings settings_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_select_own ON public.settings FOR SELECT TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: settings settings_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_update_own ON public.settings FOR UPDATE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid))) WITH CHECK ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions subscriptions_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_select_own ON public.subscriptions FOR SELECT TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions transactions_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transactions_delete_own ON public.transactions FOR DELETE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: transactions transactions_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transactions_insert_own ON public.transactions FOR INSERT TO authenticated WITH CHECK (((userid = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.accounts a
  WHERE ((a.id = transactions.accountid) AND (a.userid = ( SELECT auth.uid() AS uid))))) AND ((categoryid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.categories c
  WHERE ((c.id = transactions.categoryid) AND (c.userid = ( SELECT auth.uid() AS uid)))))) AND ((goalid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.goals g
  WHERE ((g.id = transactions.goalid) AND (g.userid = ( SELECT auth.uid() AS uid)))))) AND ((recurringid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.recurring_transactions r
  WHERE ((r.id = transactions.recurringid) AND (r.userid = ( SELECT auth.uid() AS uid))))))));


--
-- Name: transactions transactions_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transactions_select_own ON public.transactions FOR SELECT TO authenticated USING ((userid = ( SELECT auth.uid() AS uid)));


--
-- Name: transactions transactions_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transactions_update_own ON public.transactions FOR UPDATE TO authenticated USING ((userid = ( SELECT auth.uid() AS uid))) WITH CHECK (((userid = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.accounts a
  WHERE ((a.id = transactions.accountid) AND (a.userid = ( SELECT auth.uid() AS uid))))) AND ((categoryid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.categories c
  WHERE ((c.id = transactions.categoryid) AND (c.userid = ( SELECT auth.uid() AS uid)))))) AND ((goalid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.goals g
  WHERE ((g.id = transactions.goalid) AND (g.userid = ( SELECT auth.uid() AS uid)))))) AND ((recurringid IS NULL) OR (EXISTS ( SELECT 1
   FROM public.recurring_transactions r
  WHERE ((r.id = transactions.recurringid) AND (r.userid = ( SELECT auth.uid() AS uid))))))));


-- =====================================================================
-- Reset to pg_dump's ACL assumption (added; not dump output)
--
-- pg_dump writes every ACL below relative to an owner-only default. This
-- database's default privileges granted more when the objects above were
-- created, so take those back first; the GRANTs that follow are then the
-- complete, exact set production has. PUBLIC is left alone: functions
-- keep their default EXECUTE, and the dump revokes it where production
-- does.
-- =====================================================================

revoke all on all tables    in schema public from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
revoke all on all functions in schema public from anon, authenticated, service_role;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION add_business_days(anchor date, n integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.add_business_days(anchor date, n integer) TO authenticated;


--
-- Name: FUNCTION apply_user_timezone(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.apply_user_timezone() TO anon;
GRANT ALL ON FUNCTION public.apply_user_timezone() TO authenticated;


--
-- Name: FUNCTION category_spend_between(p_from date, p_to date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.category_spend_between(p_from date, p_to date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.category_spend_between(p_from date, p_to date) TO authenticated;


--
-- Name: FUNCTION delete_own_account(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_own_account() TO authenticated;


--
-- Name: FUNCTION email_for_username(p_username text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.email_for_username(p_username text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.email_for_username(p_username text) TO service_role;


--
-- Name: FUNCTION enforce_category_type(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_category_type() FROM PUBLIC;


--
-- Name: FUNCTION enforce_recurring_variability_scope(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_recurring_variability_scope() FROM PUBLIC;


--
-- Name: FUNCTION estimate_expense_amount(p_recurring_id uuid, p_fallback_amount numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estimate_expense_amount(p_recurring_id uuid, p_fallback_amount numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estimate_expense_amount(p_recurring_id uuid, p_fallback_amount numeric) TO authenticated;


--
-- Name: FUNCTION estimate_income_amount(p_recurring_id uuid, p_fallback_amount numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estimate_income_amount(p_recurring_id uuid, p_fallback_amount numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estimate_income_amount(p_recurring_id uuid, p_fallback_amount numeric) TO authenticated;


--
-- Name: FUNCTION estimate_income_amount_low(p_recurring_id uuid, p_fallback_amount numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.estimate_income_amount_low(p_recurring_id uuid, p_fallback_amount numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.estimate_income_amount_low(p_recurring_id uuid, p_fallback_amount numeric) TO authenticated;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;


--
-- Name: FUNCTION is_business_day(d date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_business_day(d date) TO authenticated;


--
-- Name: FUNCTION record_login(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_login() FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_login() TO authenticated;


--
-- Name: FUNCTION resolve_recurring_due_date(anchor date, offset_days integer, rule text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.resolve_recurring_due_date(anchor date, offset_days integer, rule text) TO authenticated;


--
-- Name: FUNCTION seed_default_categories(p_userid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.seed_default_categories(p_userid uuid) FROM PUBLIC;


--
-- Name: FUNCTION suggested_safe_to_spend_cushion(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.suggested_safe_to_spend_cushion() FROM PUBLIC;
GRANT ALL ON FUNCTION public.suggested_safe_to_spend_cushion() TO authenticated;


--
-- Name: FUNCTION username_is_available(p_username text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.username_is_available(p_username text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.username_is_available(p_username text) TO anon;
GRANT ALL ON FUNCTION public.username_is_available(p_username text) TO authenticated;


--
-- Name: TABLE accounts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.accounts TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.accounts TO service_role;


--
-- Name: TABLE bank_holidays; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.bank_holidays TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.bank_holidays TO service_role;


--
-- Name: TABLE budgets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.budgets TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.budgets TO service_role;


--
-- Name: TABLE categories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.categories TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.categories TO service_role;


--
-- Name: TABLE category_groups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.category_groups TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.category_groups TO service_role;


--
-- Name: TABLE goal_contributions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.goal_contributions TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.goal_contributions TO service_role;


--
-- Name: TABLE goals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.goals TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.goals TO service_role;


--
-- Name: TABLE investments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.investments TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.investments TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.notifications TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.profiles TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.profiles TO service_role;


--
-- Name: COLUMN profiles.first_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(first_name) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.last_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(last_name) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.lastlogin; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(lastlogin) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(updated_at) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.username; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(username) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.phone; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(phone) ON TABLE public.profiles TO authenticated;


--
-- Name: COLUMN profiles.preferred_name; Type: ACL; Schema: public; Owner: -
--

GRANT UPDATE(preferred_name) ON TABLE public.profiles TO authenticated;


--
-- Name: TABLE recurring_transactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.recurring_transactions TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.recurring_transactions TO service_role;


--
-- Name: TABLE settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.settings TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.settings TO service_role;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.subscriptions TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.subscriptions TO service_role;


--
-- Name: TABLE transactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.transactions TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.transactions TO service_role;


--
-- Name: TABLE v_account_balances; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_account_balances TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_account_balances TO service_role;


--
-- Name: TABLE v_budget_vs_actual; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_budget_vs_actual TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_budget_vs_actual TO service_role;


--
-- Name: TABLE v_category_activity; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_category_activity TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_category_activity TO service_role;


--
-- Name: TABLE v_category_spending; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_category_spending TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_category_spending TO service_role;


--
-- Name: TABLE v_daily_cashflow; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_daily_cashflow TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_daily_cashflow TO service_role;


--
-- Name: TABLE v_net_worth; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_net_worth TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_net_worth TO service_role;


--
-- Name: TABLE v_dashboard_kpis; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_dashboard_kpis TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_dashboard_kpis TO service_role;


--
-- Name: TABLE v_goal_progress; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_goal_progress TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_goal_progress TO service_role;


--
-- Name: TABLE v_goals_summary; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_goals_summary TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_goals_summary TO service_role;


--
-- Name: TABLE v_investment_holdings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_investment_holdings TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_investment_holdings TO service_role;


--
-- Name: TABLE v_upcoming_recurring; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_upcoming_recurring TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_upcoming_recurring TO service_role;


--
-- Name: TABLE v_integrity_issues; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_integrity_issues TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_integrity_issues TO service_role;


--
-- Name: TABLE v_monthly_cashflow; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_monthly_cashflow TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_monthly_cashflow TO service_role;


--
-- Name: TABLE v_portfolio_summary; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_portfolio_summary TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.v_portfolio_summary TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--


-- =====================================================================
-- Outside the public schema dump -- copied from production 2026-10-08
-- =====================================================================

-- The only non-internal trigger on auth.users in production
-- (pg_get_triggerdef). Schema-qualified here: the dump runs with an
-- empty search_path; the trigger binds the same function either way.
drop trigger if exists on_auth_user_created on auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- PostgREST pre-request hook: "today" is the user's calendar day
-- (production pg_db_role_setting for authenticator).
alter role authenticator set pgrst.db_pre_request = 'public.apply_user_timezone';
notify pgrst, 'reload config';

-- Reference data lib/businessDays.ts reads (production, 101 rows).
insert into public.bank_holidays (date, label) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-01-19', 'Martin Luther King Jr. Day'),
  ('2026-02-16', 'Washington''s Birthday'),
  ('2026-05-25', 'Memorial Day'),
  ('2026-06-19', 'Juneteenth National Independence Day'),
  ('2026-09-07', 'Labor Day'),
  ('2026-10-12', 'Columbus Day'),
  ('2026-11-11', 'Veterans Day'),
  ('2026-11-26', 'Thanksgiving Day'),
  ('2026-12-25', 'Christmas Day'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-01-18', 'Martin Luther King Jr. Day'),
  ('2027-02-15', 'Washington''s Birthday'),
  ('2027-05-31', 'Memorial Day'),
  ('2027-07-05', 'Independence Day'),
  ('2027-09-06', 'Labor Day'),
  ('2027-10-11', 'Columbus Day'),
  ('2027-11-11', 'Veterans Day'),
  ('2027-11-25', 'Thanksgiving Day'),
  ('2028-01-17', 'Martin Luther King Jr. Day'),
  ('2028-02-21', 'Washington''s Birthday'),
  ('2028-05-29', 'Memorial Day'),
  ('2028-06-19', 'Juneteenth National Independence Day'),
  ('2028-07-04', 'Independence Day'),
  ('2028-09-04', 'Labor Day'),
  ('2028-10-09', 'Columbus Day'),
  ('2028-11-23', 'Thanksgiving Day'),
  ('2028-12-25', 'Christmas Day'),
  ('2029-01-01', 'New Year''s Day'),
  ('2029-01-15', 'Martin Luther King Jr. Day'),
  ('2029-02-19', 'Washington''s Birthday'),
  ('2029-05-28', 'Memorial Day'),
  ('2029-06-19', 'Juneteenth National Independence Day'),
  ('2029-07-04', 'Independence Day'),
  ('2029-09-03', 'Labor Day'),
  ('2029-10-08', 'Columbus Day'),
  ('2029-11-12', 'Veterans Day'),
  ('2029-11-22', 'Thanksgiving Day'),
  ('2029-12-25', 'Christmas Day'),
  ('2030-01-01', 'New Year''s Day'),
  ('2030-01-21', 'Martin Luther King Jr. Day'),
  ('2030-02-18', 'Washington''s Birthday'),
  ('2030-05-27', 'Memorial Day'),
  ('2030-06-19', 'Juneteenth National Independence Day'),
  ('2030-07-04', 'Independence Day'),
  ('2030-09-02', 'Labor Day'),
  ('2030-10-14', 'Columbus Day'),
  ('2030-11-11', 'Veterans Day'),
  ('2030-11-28', 'Thanksgiving Day'),
  ('2030-12-25', 'Christmas Day'),
  ('2031-01-01', 'New Year''s Day'),
  ('2031-01-20', 'Martin Luther King Jr. Day'),
  ('2031-02-17', 'Washington''s Birthday'),
  ('2031-05-26', 'Memorial Day'),
  ('2031-06-19', 'Juneteenth National Independence Day'),
  ('2031-07-04', 'Independence Day'),
  ('2031-09-01', 'Labor Day'),
  ('2031-10-13', 'Columbus Day'),
  ('2031-11-11', 'Veterans Day'),
  ('2031-11-27', 'Thanksgiving Day'),
  ('2031-12-25', 'Christmas Day'),
  ('2032-01-01', 'New Year''s Day'),
  ('2032-01-19', 'Martin Luther King Jr. Day'),
  ('2032-02-16', 'Washington''s Birthday'),
  ('2032-05-31', 'Memorial Day'),
  ('2032-07-05', 'Independence Day'),
  ('2032-09-06', 'Labor Day'),
  ('2032-10-11', 'Columbus Day'),
  ('2032-11-11', 'Veterans Day'),
  ('2032-11-25', 'Thanksgiving Day'),
  ('2033-01-17', 'Martin Luther King Jr. Day'),
  ('2033-02-21', 'Washington''s Birthday'),
  ('2033-05-30', 'Memorial Day'),
  ('2033-06-20', 'Juneteenth National Independence Day'),
  ('2033-07-04', 'Independence Day'),
  ('2033-09-05', 'Labor Day'),
  ('2033-10-10', 'Columbus Day'),
  ('2033-11-11', 'Veterans Day'),
  ('2033-11-24', 'Thanksgiving Day'),
  ('2033-12-26', 'Christmas Day'),
  ('2034-01-02', 'New Year''s Day'),
  ('2034-01-16', 'Martin Luther King Jr. Day'),
  ('2034-02-20', 'Washington''s Birthday'),
  ('2034-05-29', 'Memorial Day'),
  ('2034-06-19', 'Juneteenth National Independence Day'),
  ('2034-07-04', 'Independence Day'),
  ('2034-09-04', 'Labor Day'),
  ('2034-10-09', 'Columbus Day'),
  ('2034-11-23', 'Thanksgiving Day'),
  ('2034-12-25', 'Christmas Day'),
  ('2035-01-01', 'New Year''s Day'),
  ('2035-01-15', 'Martin Luther King Jr. Day'),
  ('2035-02-19', 'Washington''s Birthday'),
  ('2035-05-28', 'Memorial Day'),
  ('2035-06-19', 'Juneteenth National Independence Day'),
  ('2035-07-04', 'Independence Day'),
  ('2035-09-03', 'Labor Day'),
  ('2035-10-08', 'Columbus Day'),
  ('2035-11-12', 'Veterans Day'),
  ('2035-11-22', 'Thanksgiving Day'),
  ('2035-12-25', 'Christmas Day');

-- The dump's session settings (empty search_path, row_security off, ...)
-- must not leak into migrations applied after this one.
reset all;
