-- =====================================================================
-- 43: No red by default in the category seed.
--
-- CLAUDE.md: "Red never describes the user's money." Category slot 8 (red)
-- stays in the colour picker -- a user choosing it for their own category
-- is their call -- but it must not be a default. Migration 11 seeded both
-- Entertainment categories on slot 8. This moves them to slot 4 (yellow
-- #c98500), continuing migration 11's reuse order (slots 1, 2, 3 already
-- reused for Financial, Business, Other).
--
-- Function body is migration 11's verbatim except those two rows.
-- CREATE OR REPLACE keeps the owner and the grants (migration 36's revoke
-- still applies).
--
-- Scope: NEW signups only. Existing users' categories are untouched --
-- a stored red can't be told apart from a red the user chose.
-- =====================================================================

begin;

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
$fn$;

comment on function public.seed_default_categories(uuid) is
  'Idempotently tops up a user''s category_groups/categories to the full 11-group/57-category set. Matches existing rows by (category_name, category_type); never updates, moves, or reactivates one. Seeds no category on red (slot 8).';

commit;
