-- =====================================================================
-- Migration 61: BEFORE/AFTER evidence that no schedule amount changed
--
--   npx supabase db query --remote=ybdwqyihvbokowocvlgq --read-only -f docs/recurring-amount-scale-checksum.sql
--
-- Run before the push and again after. Every column of the two rows must
-- match.
--
-- Scale-independent on purpose. The cast turns 1850 into 1850.00: the
-- same value, different text. trim_scale() drops trailing zeros, so both
-- render 1850 -- but a value that actually changed (12.345 rounded to
-- 12.35) still renders differently and moves the checksum. The sums are
-- exact numeric, compared the same way.
-- =====================================================================

select
  'amount'                                                   as col,
  count(*)                                                   as rows,
  count(amount)                                              as non_null,
  trim_scale(sum(amount))::text                              as sum,
  md5(string_agg(id::text || ':' || coalesce(trim_scale(amount)::text, 'null'), ',' order by id))
                                                             as checksum
from public.recurring_transactions
union all
select
  'next_amount',
  count(*),
  count(next_amount),
  trim_scale(sum(next_amount))::text,
  md5(string_agg(id::text || ':' || coalesce(trim_scale(next_amount)::text, 'null'), ',' order by id))
from public.recurring_transactions
order by col;
