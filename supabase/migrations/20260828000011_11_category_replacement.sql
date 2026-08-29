-- =====================================================================
-- 11: Category replacement -- 9-group/35-category seed -> 11-group/
-- 57-category seed, migrated in place for every existing user.
--
-- Renumbered from a planned "10": version 20260828000010 is already
-- recorded on the remote as applied, under an earlier draft of this file
-- that only inserted missing categories (no update-in-place, renames,
-- dedup, or delete). That draft's effects are still on every existing
-- user's data -- extra groups and categories coexisting with the old
-- ones -- and this migration is written to converge to the correct
-- 57-category end state from that messier starting point, not just from
-- a pristine 35-category one.
--
-- One transaction, six steps, in order:
--   1. Seed the 11 category_groups for every user who doesn't have them
--      (by name -- never touches a group that already exists).
--   2. For each of the 57 target categories: UPDATE in place (groupid,
--      colour, is_active) if a category with that exact name+type
--      already exists for the user, else INSERT it. Updating rather
--      than replacing preserves the id, so nothing referencing it needs
--      remapping.
--   3. Remap the 12 renamed categories: every transactions/budgets/
--      recurring_transactions row pointing at the old category gets
--      repointed to its new equivalent (per-user, both same type).
--      recurring_transactions is included even though it wasn't named
--      explicitly -- it has the identical ON DELETE RESTRICT FK to
--      categories as the other two, so leaving it out would just move
--      the step-5 failure here instead of fixing it.
--   4. Merge remaining duplicates: any user with two-plus categories
--      sharing (name, type) -- e.g. Alice's duplicate "Interest" -- gets
--      everything repointed to the oldest (by created_at) and the rest
--      deleted.
--   5. Delete every category whose (name, type) isn't one of the 57.
--      Guarded: if anything is still referenced at this point, steps 3
--      or 4 missed a case, and this raises with the specifics instead
--      of either silently orphaning history or tripping a bare FK error.
--   6. Delete any category_groups row left with zero categories --
--      catches the old groups whose name has no equivalent in the new
--      11 (Food, Personal, Health): every category that used to live in
--      one either moved to a same-named-or-not new group in step 2a or
--      was deleted in step 5, so the old group row is always safe to
--      drop by the time this runs.
--
-- Net effect for every user, regardless of starting state: exactly 57
-- categories and 11 groups. See the accompanying message for the
-- reasoning and per-user counts.
--
-- Excludes Credit Card Payments, Savings, Retirement Contributions,
-- Securities Trades, Allocated Excess Cash, Cash Raised, Client Request --
-- those are transfers, not categories, and none of them appear below.
--
-- Colour comes from the 8 validated categorical slots in CLAUDE.md, never
-- an invented hex; 3 of the 11 groups reuse an earlier group's slot
-- (Financial reuses Income's blue, Business reuses Housing's orange,
-- Other reuses Food & Dining's aqua). category_groups has no colour
-- column, so this mapping only exists here, at seed/migrate time.
-- =====================================================================

begin;

create temporary table tmp_new_groups (
  name text primary key,
  sort_order int not null
);

insert into tmp_new_groups (name, sort_order) values
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
  ('Other',10);

create temporary table tmp_new_categories (
  group_name text not null,
  category_name text not null,
  category_type text not null,
  color text not null,
  is_active boolean not null,
  primary key (category_name, category_type)
);

insert into tmp_new_categories (group_name, category_name, category_type, color, is_active) values
  -- Income -- slot 1 blue #3987e5
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

  -- Housing -- slot 2 orange #d95926
  ('Housing','Rent','Expense','#d95926',true),
  ('Housing','Mortgages','Expense','#d95926',true),
  ('Housing','Home Improvement','Expense','#d95926',true),
  ('Housing','Home Maintenance','Expense','#d95926',true),
  ('Housing','Insurance','Expense','#d95926',true),

  -- Food & Dining -- slot 3 aqua #199e70
  ('Food & Dining','Groceries','Expense','#199e70',true),
  ('Food & Dining','Restaurants','Expense','#199e70',true),

  -- Transportation -- slot 4 yellow #c98500
  ('Transportation','Automotive','Expense','#c98500',true),
  ('Transportation','Gasoline/Fuel','Expense','#c98500',true),
  ('Transportation','Parking & Tolls','Expense','#c98500',true),
  ('Transportation','Public Transportation','Expense','#c98500',true),
  ('Transportation','Travel','Expense','#c98500',true),

  -- Bills & Utilities -- slot 5 magenta #d55181
  ('Bills & Utilities','Utilities','Expense','#d55181',true),
  ('Bills & Utilities','Telephone','Expense','#d55181',true),
  ('Bills & Utilities','Cable/Satellite','Expense','#d55181',true),
  ('Bills & Utilities','Online Services','Expense','#d55181',true),
  ('Bills & Utilities','Other Bills','Expense','#d55181',true),

  -- Shopping -- slot 6 green #008300
  ('Shopping','Clothing/Shoes','Expense','#008300',true),
  ('Shopping','Electronics','Expense','#008300',true),
  ('Shopping','General Merchandise','Expense','#008300',true),
  ('Shopping','Gifts','Expense','#008300',true),
  ('Shopping','Hobbies','Expense','#008300',true),

  -- Health & Personal -- slot 7 violet #9085e9
  ('Health & Personal','Healthcare/Medical','Expense','#9085e9',true),
  ('Health & Personal','Personal Care','Expense','#9085e9',true),
  ('Health & Personal','Child/Dependent','Expense','#9085e9',true),
  ('Health & Personal','Pets/Pet Care','Expense','#9085e9',true),
  ('Health & Personal','Education','Expense','#9085e9',true),

  -- Entertainment -- slot 8 red #e66767
  ('Entertainment','Entertainment','Expense','#e66767',true),
  ('Entertainment','Dues & Subscriptions','Expense','#e66767',true),

  -- Financial -- slot 1 reused, blue #3987e5
  ('Financial','Loans','Expense','#3987e5',true),
  ('Financial','Taxes','Expense','#3987e5',true),
  ('Financial','Service Charges/Fees','Expense','#3987e5',true),
  ('Financial','Charitable Giving','Expense','#3987e5',true),
  ('Financial','Advisory Fee','Expense','#3987e5',true),
  ('Financial','Checks','Expense','#3987e5',true),
  ('Financial','ATM/Cash','Expense','#3987e5',true),

  -- Business -- slot 2 reused, orange #d95926 -- inactive by default
  ('Business','Advertising','Expense','#d95926',false),
  ('Business','Business Miscellaneous','Expense','#d95926',false),
  ('Business','Office Maintenance','Expense','#d95926',false),
  ('Business','Office Supplies','Expense','#d95926',false),
  ('Business','Postage & Shipping','Expense','#d95926',false),
  ('Business','Printing','Expense','#d95926',false),
  ('Business','Wages Paid','Expense','#d95926',false),

  -- Other -- slot 3 reused, aqua #199e70
  ('Other','Other Expenses','Expense','#199e70',true);

create temporary table tmp_renames (
  old_name text not null,
  new_name text not null,
  category_type text not null,
  primary key (old_name, category_type)
);

insert into tmp_renames (old_name, new_name, category_type) values
  ('Salary','Paychecks/Salary','Income'),
  ('Car Maintenance','Automotive','Expense'),
  ('Clothing','Clothing/Shoes','Expense'),
  ('Gas','Gasoline/Fuel','Expense'),
  ('Rent / Mortgage','Rent','Expense'),
  ('Parking','Parking & Tolls','Expense'),
  ('Car Payment','Loans','Expense'),
  ('Home Insurance','Insurance','Expense'),
  ('Coffee','Restaurants','Expense'),
  ('Fitness','Personal Care','Expense'),
  ('Bonus','Other Income','Income'),
  ('Miscellaneous','Other Expenses','Expense');


-- =====================================================================
-- STEP 1 -- seed the 11 groups for every user missing any of them.
-- =====================================================================

insert into category_groups (userid, name, sort_order)
select p.id, g.name, g.sort_order
  from profiles p
  cross join tmp_new_groups g
 where not exists (
   select 1 from category_groups cg
    where cg.userid = p.id and cg.name = g.name
 );


-- =====================================================================
-- STEP 2a -- update existing categories in place (name+type match).
-- Preserves id, created_at, and anything referencing it.
-- =====================================================================

update categories c
   set groupid = cg.id,
       color = v.color,
       is_active = v.is_active
  from tmp_new_categories v, category_groups cg
 where c.category_name = v.category_name
   and c.category_type = v.category_type
   and cg.userid = c.userid
   and cg.name = v.group_name;


-- =====================================================================
-- STEP 2b -- insert the categories each user doesn't have yet.
-- =====================================================================

insert into categories (userid, groupid, category_name, category_type, color, is_active)
select p.id, cg.id, v.category_name, v.category_type, v.color, v.is_active
  from profiles p
  cross join tmp_new_categories v
  join category_groups cg
    on cg.userid = p.id and cg.name = v.group_name
 where not exists (
   select 1 from categories c
    where c.userid = p.id
      and c.category_name = v.category_name
      and c.category_type = v.category_type
 );


-- =====================================================================
-- STEP 3 -- remap the 12 renamed categories on every referencing table.
-- =====================================================================

create temporary table tmp_rename_remap as
select old_c.userid, old_c.id as old_id, new_c.id as new_id
  from tmp_renames r
  join categories old_c
    on old_c.category_name = r.old_name and old_c.category_type = r.category_type
  join categories new_c
    on new_c.userid = old_c.userid
   and new_c.category_name = r.new_name
   and new_c.category_type = r.category_type;

update transactions t
   set categoryid = m.new_id
  from tmp_rename_remap m
 where t.categoryid = m.old_id and t.userid = m.userid;

update budgets b
   set categoryid = m.new_id
  from tmp_rename_remap m
 where b.categoryid = m.old_id and b.userid = m.userid;

update recurring_transactions rt
   set categoryid = m.new_id
  from tmp_rename_remap m
 where rt.categoryid = m.old_id and rt.userid = m.userid;


-- =====================================================================
-- STEP 4 -- merge remaining duplicates (same name+type for one user).
-- Keeps the oldest row (by created_at, then id as a deterministic
-- tiebreak); repoints every reference to it; deletes the rest.
-- =====================================================================

create temporary table tmp_dup_remap as
with ranked as (
  select id, userid, category_name, category_type,
         row_number() over (
           partition by userid, category_name, category_type
           order by created_at asc, id asc
         ) as rn
    from categories
)
select dup.id as old_id, keep.id as new_id, dup.userid
  from ranked dup
  join ranked keep
    on keep.userid = dup.userid
   and keep.category_name = dup.category_name
   and keep.category_type = dup.category_type
   and keep.rn = 1
 where dup.rn > 1;

update transactions t
   set categoryid = m.new_id
  from tmp_dup_remap m
 where t.categoryid = m.old_id and t.userid = m.userid;

update budgets b
   set categoryid = m.new_id
  from tmp_dup_remap m
 where b.categoryid = m.old_id and b.userid = m.userid;

update recurring_transactions rt
   set categoryid = m.new_id
  from tmp_dup_remap m
 where rt.categoryid = m.old_id and rt.userid = m.userid;

delete from categories c
 using tmp_dup_remap m
 where c.id = m.old_id;


-- =====================================================================
-- STEP 5 -- delete every category not in the 57, guarded against
-- ON DELETE RESTRICT. A hit here means steps 3/4 missed a reference --
-- fail loudly with specifics rather than a bare FK error, and rather
-- than silently leaving the stray category behind.
-- =====================================================================

do $$
declare
  v_count int;
  v_details text;
begin
  select count(*), string_agg(
           format('categories.id=%s userid=%s "%s" (%s): %s reference(s)',
                  c.id, c.userid, c.category_name, c.category_type, ref.cnt),
           '; '
         )
    into v_count, v_details
    from categories c
    cross join lateral (
      select
        (select count(*) from transactions            t  where t.categoryid  = c.id) +
        (select count(*) from budgets                 b  where b.categoryid  = c.id) +
        (select count(*) from recurring_transactions   rt where rt.categoryid = c.id) as cnt
    ) ref
   where not exists (
     select 1 from tmp_new_categories v
      where v.category_name = c.category_name and v.category_type = c.category_type
   )
   and ref.cnt > 0;

  if v_count > 0 then
    raise exception
      'Refusing to delete % categories still referenced by transactions/budgets/recurring_transactions: %',
      v_count, v_details;
  end if;
end
$$;

delete from categories c
 where not exists (
   select 1 from tmp_new_categories v
    where v.category_name = c.category_name and v.category_type = c.category_type
 );

-- =====================================================================
-- STEP 6 -- delete category_groups left with no categories. Only old
-- groups whose name isn't one of the 11 can end up here (every target
-- group gets at least one category from tmp_new_categories), so this is
-- unconditional -- no guard needed, nothing else references groups.
-- =====================================================================

delete from category_groups cg
 where not exists (
   select 1 from categories c where c.groupid = cg.id
 );

drop table tmp_rename_remap, tmp_dup_remap, tmp_new_groups, tmp_new_categories, tmp_renames;


-- =====================================================================
-- STEP 7 -- rewrite seed_default_categories() so every new signup gets
-- the full 11-group/57-category set directly. Idempotent (NOT EXISTS
-- per row, no early-exit guard) so it's harmless to invoke more than
-- once, same reasoning as migration 09's version -- but this one starts
-- a fresh user at the full set instead of the old 9/35 baseline.
-- =====================================================================

create or replace function public.seed_default_categories(p_userid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
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
      ('Entertainment','Entertainment','Expense','#e66767',true),
      ('Entertainment','Dues & Subscriptions','Expense','#e66767',true),
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
$fn$;

comment on function public.seed_default_categories(uuid) is
  'Idempotently tops up a user''s category_groups/categories to the full 11-group/57-category set. Matches existing rows by (category_name, category_type); never updates, moves, or reactivates one.';

commit;


-- =====================================================================
-- Verify (run after commit)
-- =====================================================================

-- Every user should have exactly 11 groups and exactly 57 categories.
select
  (select count(*) from (
     select userid from category_groups group by userid having count(*) <> 11
   ) x) as users_not_at_11_groups,
  (select count(*) from (
     select userid from categories group by userid having count(*) <> 57
   ) y) as users_not_at_57_categories;

-- Per-user category count, for eyeballing.
select userid, count(*) as category_count
  from categories
 group by userid
 order by category_count desc;
