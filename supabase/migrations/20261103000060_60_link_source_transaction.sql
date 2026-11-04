-- Migration 60: "Make recurring" -- the source transaction IS the first
-- occurrence.
--
-- Before this, making a transaction recurring created a schedule that knew
-- nothing about the row it was made from. The schedule's first date was
-- typically the source's own date, so the confirmation queue asked for an
-- occurrence that was already in the ledger, and "It landed" wrote it a
-- second time: recurring_tx_no_double_post couldn't see the pair, because
-- the source carried no recurringid. The source's amount was also thrown
-- away as history for the estimate.
--
-- link_transaction_to_schedule() sets the new schedule's recurringid on the
-- source -- one row, or both legs of a transfer. It is a function rather
-- than a client UPDATE because a transfer leg can only be written with the
-- transfer gate open (trg_transactions_transfer_pair, migration 59), and
-- the pair must be linked together or not at all.
--
-- Once linked, the source:
--   - counts as an occurrence: v_upcoming_recurring's occurrence count, and
--     so occurrence_limit, include it;
--   - feeds the estimate when is_estimated is false (a hand-entered row
--     always is), since every estimate reads rows by recurringid;
--   - shows the recurring icon and stops offering "Make recurring".
--
-- Shape check: the source must be the same kind of thing the schedule is.
-- A category schedule takes a non-transfer row on its account whose type
-- is the schedule's category type; a transfer schedule takes a transfer
-- whose Expense leg is on its from account and Income leg on its to
-- account. A source that doesn't match -- the person changed the account
-- or the type in the form -- isn't this schedule's occurrence, and the
-- function returns false without linking. Category within the type may
-- differ: recategorising doesn't make it a different bill.

create function public.link_transaction_to_schedule(
  p_transaction_id uuid,
  p_recurring_id   uuid
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_sched    public.recurring_transactions%rowtype;
  v_tx       public.transactions%rowtype;
  v_cat_type text;
  v_matches  boolean;
begin
  if v_uid is null then
    raise exception 'link_transaction_to_schedule: no authenticated user';
  end if;

  select * into v_sched
    from public.recurring_transactions
   where id = p_recurring_id and userid = v_uid;
  if not found then
    raise exception 'link_transaction_to_schedule: schedule not found' using errcode = 'P0002';
  end if;

  select * into v_tx
    from public.transactions
   where id = p_transaction_id and userid = v_uid;
  if not found then
    raise exception 'link_transaction_to_schedule: transaction not found' using errcode = 'P0002';
  end if;

  if v_tx.transfer_group_id is null then
    if v_sched.to_accountid is not null then
      return false;
    end if;
    if v_tx.recurringid is not null then
      raise exception 'That transaction already belongs to a schedule.' using errcode = '23514';
    end if;
    select category_type into v_cat_type from public.categories where id = v_sched.categoryid;
    if v_tx.accountid <> v_sched.accountid or v_tx.transaction_type is distinct from v_cat_type then
      return false;
    end if;

    update public.transactions
       set recurringid = p_recurring_id
     where id = v_tx.id and userid = v_uid;
    return true;
  end if;

  -- A transfer: both legs, together.
  if v_sched.to_accountid is null then
    return false;
  end if;
  if exists (select 1 from public.transactions
              where transfer_group_id = v_tx.transfer_group_id and userid = v_uid
                and recurringid is not null) then
    raise exception 'That transfer already belongs to a schedule.' using errcode = '23514';
  end if;
  select count(*) = 2
         and bool_and(case transaction_type
                        when 'Expense' then accountid = v_sched.accountid
                        when 'Income'  then accountid = v_sched.to_accountid
                      end)
         and count(distinct transaction_type) = 2
    into v_matches
    from public.transactions
   where transfer_group_id = v_tx.transfer_group_id and userid = v_uid;
  if not coalesce(v_matches, false) then
    return false;
  end if;

  perform set_config('sorrel.transfer_edit', 'on', true);
  update public.transactions
     set recurringid = p_recurring_id
   where transfer_group_id = v_tx.transfer_group_id and userid = v_uid;
  perform set_config('sorrel.transfer_edit', '', true);
  return true;
end;
$$;

comment on function public.link_transaction_to_schedule(uuid, uuid) is
  '"Make recurring": sets the new schedule''s recurringid on the transaction it was made from -- one row, or both legs of a transfer -- so the source is the schedule''s first occurrence: counted, estimated from, and visible to recurring_tx_no_double_post. Returns false without writing when the source isn''t the schedule''s kind of thing (different account or direction). SECURITY DEFINER, scoped to auth.uid() (migration 60).';

revoke all on function public.link_transaction_to_schedule(uuid, uuid) from public, anon;
grant execute on function public.link_transaction_to_schedule(uuid, uuid) to authenticated;
