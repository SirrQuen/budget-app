-- =====================================================================
-- Dev seed: a month of realistic activity for ONE test user. sorrel-dev
-- (jmuqtjbntiqmjmpenywl) ONLY -- never production. Check the link first:
--
--   npx supabase@latest projects list          # sorrel-dev must say linked
--   npx supabase@latest db query --linked -f docs/dev-seed.sql
--
-- Set the user id below. Refuses to run if that user already has accounts,
-- so it can't double a seed. Runs as postgres (RLS bypassed), so every row
-- sets userid explicitly, the same shapes lib/db writes:
--
--   3 accounts   Checking, Savings, a Credit Card (liability, negative)
--   ~5 weeks     paychecks, rent, groceries, dining, utilities, card
--                purchases, a checking->savings transfer, a card payment
--   3 schedules  biweekly paycheck, monthly rent, monthly savings transfer
--                -- unconfirmed, so they sit in the projection and queue
--   2 goals      "Japan trip" part-way; "Emergency fund" $50 short of its
--                target, so one $50 contribution completes it (placement D)
--
-- Dates are relative to the day it runs.
-- =====================================================================

do $$
declare
  u        constant uuid := '0bc925a0-3fcc-4d14-8355-b97f0cc8525a';
  chk      uuid := gen_random_uuid();
  sav      uuid := gen_random_uuid();
  card     uuid := gen_random_uuid();
  cat      jsonb;
  d0       date := current_date - 35;
  grp      uuid;
  japan    uuid := gen_random_uuid();
  ef       uuid := gen_random_uuid();
  next_fri date;
  next_1st date := (date_trunc('month', current_date) + interval '1 month')::date;
  i        int;
begin
  if exists (select 1 from public.accounts where userid = u) then
    raise exception 'user % already has accounts; not seeding twice', u;
  end if;

  select jsonb_object_agg(category_name, id) into cat
    from public.categories where userid = u and is_active;

  insert into public.accounts (id, userid, account_name, account_type, opening_balance, opening_date)
  values (chk,  u, 'Everyday Checking', 'Checking',    3200.00, d0),
         (sav,  u, 'Rainy Day Savings', 'Savings',     8000.00, d0),
         (card, u, 'Visa',              'Credit Card', -450.00, d0);

  -- Paychecks: every other Friday from the first Friday after d0.
  for i in 0..2 loop
    insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
    values (u, chk, (cat->>'Paychecks/Salary')::uuid, 2400.00, 'Income',
            d0 + ((5 - extract(isodow from d0)::int + 7) % 7) + 14 * i, 'Acme Co payroll');
  end loop;

  -- Rent on the 1st of the current month (inside the window).
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, chk, (cat->>'Rent')::uuid, 1450.00, 'Expense', date_trunc('month', current_date)::date, 'Rent');

  -- Weekly groceries, alternating checking and the card.
  for i in 0..4 loop
    insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
    values (u, case when i % 2 = 0 then chk else card end, (cat->>'Groceries')::uuid,
            (92 + i * 11.37)::numeric(12,2), 'Expense', d0 + 3 + 7 * i, 'Green Market');
  end loop;

  -- Dining, gas, utilities, a subscription.
  insert into public.transactions (userid, accountid, categoryid, amount, transaction_type, transaction_date, description)
  values (u, card, (cat->>'Restaurants')::uuid,         38.50, 'Expense', d0 + 6,  'Taqueria Luna'),
         (u, card, (cat->>'Restaurants')::uuid,         64.20, 'Expense', d0 + 19, 'Noodle Bar'),
         (u, chk,  (cat->>'Restaurants')::uuid,         22.75, 'Expense', current_date - 2, 'Corner Cafe'),
         (u, card, (cat->>'Gasoline/Fuel')::uuid,       48.10, 'Expense', d0 + 9,  'Shell'),
         (u, card, (cat->>'Gasoline/Fuel')::uuid,       51.35, 'Expense', d0 + 27, 'Shell'),
         (u, chk,  (cat->>'Utilities')::uuid,          118.42, 'Expense', d0 + 12, 'City Power & Light'),
         (u, card, (cat->>'Dues & Subscriptions')::uuid, 15.99, 'Expense', d0 + 15, 'Streaming service');

  -- Transfer checking -> savings: two legs, one group, no category.
  grp := gen_random_uuid();
  insert into public.transactions (userid, accountid, amount, transaction_type, transaction_date, description, transfer_group_id)
  values (u, chk, 300.00, 'Expense', d0 + 15, 'Transfer to Rainy Day Savings', grp),
         (u, sav, 300.00, 'Income',  d0 + 15, 'Transfer from Everyday Checking', grp);

  -- Card payment: checking -> card.
  grp := gen_random_uuid();
  insert into public.transactions (userid, accountid, amount, transaction_type, transaction_date, description, transfer_group_id)
  values (u, chk,  450.00, 'Expense', d0 + 20, 'Visa payment', grp),
         (u, card, 450.00, 'Income',  d0 + 20, 'Payment from Everyday Checking', grp);

  -- Schedules, unconfirmed. Next paycheck: the Friday after the last one.
  next_fri := d0 + ((5 - extract(isodow from d0)::int + 7) % 7) + 14 * 3;
  while next_fri <= current_date loop
    next_fri := next_fri + 14;
  end loop;

  insert into public.recurring_transactions
    (userid, accountid, categoryid, to_accountid, description, amount, frequency, interval_count,
     start_date, next_run_date, next_due_date, date_tolerance_days)
  values (u, chk, (cat->>'Paychecks/Salary')::uuid, null, 'Acme Co payroll', 2400.00, 'Biweekly', 1,
          d0, next_fri, next_fri, 2),
         (u, chk, (cat->>'Rent')::uuid, null, 'Rent', 1450.00, 'Monthly', 1,
          d0, next_1st, next_1st, 0),
         (u, chk, null, sav, 'Monthly savings', 300.00, 'Monthly', 1,
          d0, next_1st + 14, next_1st + 14, 0);

  -- Goals (manual).
  insert into public.goals (id, userid, goal_name, goal_type, target_amount, target_date, monthly_contribution, tracking_method)
  values (japan, u, 'Japan trip',     'Vacation',       3000.00, current_date + 180, 400.00, 'Manual'),
         (ef,    u, 'Emergency fund', 'Emergency Fund', 1000.00, current_date + 60,  200.00, 'Manual');

  insert into public.goal_contributions (goalid, userid, amount, date, funding_method)
  values (japan, u, 400.00, d0 + 2,  'manual'),
         (japan, u, 400.00, d0 + 16, 'manual'),
         (japan, u, 250.00, d0 + 30, 'manual'),
         (ef,    u, 500.00, d0 + 5,  'manual'),
         (ef,    u, 450.00, d0 + 25, 'manual');
end
$$;

select (select count(*) from public.accounts where userid = '0bc925a0-3fcc-4d14-8355-b97f0cc8525a') as accounts,
       (select count(*) from public.transactions where userid = '0bc925a0-3fcc-4d14-8355-b97f0cc8525a') as transactions,
       (select count(*) from public.recurring_transactions where userid = '0bc925a0-3fcc-4d14-8355-b97f0cc8525a') as schedules,
       (select count(*) from public.goals where userid = '0bc925a0-3fcc-4d14-8355-b97f0cc8525a') as goals;
