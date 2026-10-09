import { listRecurring, estimateIncomeAmount, estimateExpenseAmount } from "@/lib/db/recurring";
import { listAccounts, listAccountBalances } from "@/lib/db/accounts";
import { listCategoriesForType } from "@/lib/db/categories";
import { getBankHolidays } from "@/lib/db/holidays";
import { estimateCardPaymentDue } from "@/lib/accountOptions";
import { getToday } from "@/lib/db/settings";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/LoadError";
import { RepeatIcon } from "@/components/ui/icons";
import { CreateRecurringForm } from "./CreateRecurringForm";
import { RecurringRow } from "./RecurringRow";
import type { TransactionAccountOption } from "../transactions/AddTransactionForm";

// Name, schedule, next due, amount, actions -- identical on every row on
// this screen, same reasoning as ACCOUNT_ROW_GRID in the accounts screen.
// One flat list here (no type-groups to subgrid across), so RecurringRow's
// <li> subgrids straight off this <ul>.
const RECURRING_ROW_GRID =
  "sm:grid sm:grid-cols-[minmax(0,min(28rem,1fr))_auto_auto_max-content_max-content] sm:gap-x-4 sm:px-4";

function RecurringLoadError({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Recurring"
        description="Bills and paychecks that repeat -- posted automatically on their due date."
      />
      <LoadError message={message} />
    </div>
  );
}

export default async function RecurringPage() {
  const [
    recurringResult,
    accountsResult,
    balancesResult,
    incomeCategoriesResult,
    expenseCategoriesResult,
    holidaysResult,
  ] = await Promise.all([
    listRecurring(),
    listAccounts({ is_active: true }),
    listAccountBalances(),
    listCategoriesForType("Income"),
    listCategoriesForType("Expense"),
    getBankHolidays(),
  ]);

  // RecurringForm's live timing preview degrades to "weekend-aware only"
  // (no holidays) if this fails to load -- what actually gets saved is
  // still resolved authoritatively server-side (lib/db/recurring.ts), so a
  // failed read here is a preview inconvenience, not a correctness issue.
  const holidays = holidaysResult.data ? Array.from(holidaysResult.data) : [];

  // A failed read is an error state, never an empty list or a zero
  // (docs/phase-7-findings.md, "a failed read renders as a plausible
  // zero"). A failed balances read would show $0 as a card payment's
  // estimate; a failed accounts read would hide "Add schedule"; a failed
  // categories read would leave the pickers empty. Holidays above is the
  // one documented exception.
  if (
    recurringResult.error !== null ||
    accountsResult.error !== null ||
    balancesResult.error !== null ||
    incomeCategoriesResult.error !== null ||
    expenseCategoriesResult.error !== null
  ) {
    return (
      <RecurringLoadError
        message={
          recurringResult.error ??
          accountsResult.error ??
          balancesResult.error ??
          incomeCategoriesResult.error ??
          expenseCategoriesResult.error ??
          "We couldn't load your recurring transactions. Refresh the page to try again."
        }
      />
    );
  }

  const accounts: TransactionAccountOption[] = accountsResult.data.map((a) => ({
    id: a.id,
    account_name: a.account_name,
    is_active: a.is_active,
    opening_date: a.opening_date,
    account_type: a.account_type,
  }));
  const incomeCategories = incomeCategoriesResult.data;
  const expenseCategories = expenseCategoriesResult.data;
  const schedules = recurringResult.data;

  // For a variable schedule with no confirmed next_amount, this is the same
  // live estimate v_upcoming_recurring computes in SQL -- read here from a
  // balance already fetched via listAccountBalances rather than a second
  // per-row round trip, since this page (unlike the dashboard) reads the
  // raw recurring_transactions table, not that view.
  const cardBalanceByAccountId = new Map(
    balancesResult.data.map((b) => [b.account_id, b.balance ?? 0]),
  );

  // Same idea for a variable-amount Income or Expense schedule --
  // estimate_income_amount/estimate_expense_amount (called via .rpc(),
  // never aggregated in JS -- CLAUDE.md) independent of is_active, same
  // reason cardBalanceByAccountId above doesn't depend on
  // v_upcoming_recurring either: a paused schedule still needs an estimate.
  // Split by category_type -- each function only ever means one direction's
  // transactions, so calling the wrong one on the other's recurringid would
  // silently return the fallback instead of a real average.
  const variableCategorySchedules = schedules.filter(
    (r) => r.amount_is_variable && r.to_accountid === null,
  );
  const categoryEstimateResults = await Promise.all(
    variableCategorySchedules.map(async (r) => {
      const result =
        r.category_type === "Expense"
          ? await estimateExpenseAmount(r.id, Number(r.amount))
          : await estimateIncomeAmount(r.id, Number(r.amount));
      return [r.id, result] as const;
    }),
  );
  // Falling back to the stored amount on a FAILED estimate would show a
  // believable figure that isn't the estimate. The SQL functions already
  // apply the fallback when there's no history; an error is an error.
  const categoryEstimateById = new Map<string, number>();
  for (const [id, result] of categoryEstimateResults) {
    if (result.error !== null) return <RecurringLoadError message={result.error} />;
    categoryEstimateById.set(id, result.data);
  }

  const today = await getToday();

  // Nothing to manage and no account to schedule against yet -- same
  // narrowing AccountsPage/GoalsPage use for a brand-new list.
  if (schedules.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Recurring"
          description="Bills and paychecks that repeat -- posted automatically on their due date."
        />
        <EmptyState
          icon={<RepeatIcon className="h-10 w-10" />}
          heading="Put a repeating bill on autopilot"
          message="Rent, a subscription, your paycheck -- set it up once and it posts itself on the due date, no confirmation needed."
          action={
            accounts.length > 0 ? (
              <CreateRecurringForm
                incomeCategories={incomeCategories}
                expenseCategories={expenseCategories}
                accounts={accounts}
                holidays={holidays}
                label="Add your first schedule"
              />
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Recurring"
        description="Bills and paychecks that repeat -- posted automatically on their due date."
      />

      <CreateRecurringForm
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        accounts={accounts}
        holidays={holidays}
      />

      {/* Paused schedules stay in this one list, dimmed and badged, rather
          than dropping out of sight behind a toggle (AccountsPage hides
          archived accounts this way -- a paused schedule is meant to be
          easy to find again and resume). */}
      <ul
        className={`divide-y divide-gridline rounded-2xl border border-hairline bg-surface ${RECURRING_ROW_GRID}`}
      >
        {schedules.map((recurring) => {
          // Only meaningful when amount_is_variable and unconfirmed --
          // RecurringRow ignores it otherwise. listAccountBalances() above
          // was called with no is_active filter, so this covers an
          // archived destination account too.
          const cardBalance = recurring.to_accountid
            ? (cardBalanceByAccountId.get(recurring.to_accountid) ?? 0)
            : 0;
          const estimatedAmount = recurring.to_accountid
            ? estimateCardPaymentDue(cardBalance)
            : (categoryEstimateById.get(recurring.id) ?? Number(recurring.amount));
          return (
            <RecurringRow
              key={recurring.id}
              recurring={recurring}
              incomeCategories={incomeCategories}
              expenseCategories={expenseCategories}
              accounts={accounts}
              holidays={holidays}
              estimatedAmount={estimatedAmount}
              today={today}
            />
          );
        })}
      </ul>
    </div>
  );
}
