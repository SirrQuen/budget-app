import { listRecurring } from "@/lib/db/recurring";
import { listAccounts, listAccountBalances } from "@/lib/db/accounts";
import { listCategoriesForType } from "@/lib/db/categories";
import { estimateCardPaymentDue } from "@/lib/accountOptions";
import { todayISO } from "@/lib/date";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { RepeatIcon } from "@/components/ui/icons";
import { CreateRecurringForm } from "./CreateRecurringForm";
import { RecurringRow } from "./RecurringRow";
import type { TransactionAccountOption } from "../transactions/AddTransactionForm";

export default async function RecurringPage() {
  const [recurringResult, accountsResult, balancesResult, incomeCategoriesResult, expenseCategoriesResult] =
    await Promise.all([
      listRecurring(),
      listAccounts({ is_active: true }),
      listAccountBalances(),
      listCategoriesForType("Income"),
      listCategoriesForType("Expense"),
    ]);

  if (recurringResult.error !== null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Recurring"
          description="Bills and paychecks that repeat -- posted automatically on their due date."
        />
        <ErrorMessage severity="critical" message={recurringResult.error} />
      </div>
    );
  }

  const accounts: TransactionAccountOption[] = (accountsResult.data ?? []).map((a) => ({
    id: a.id,
    account_name: a.account_name,
    is_active: a.is_active,
    opening_date: a.opening_date,
    account_type: a.account_type,
  }));
  const incomeCategories = incomeCategoriesResult.data ?? [];
  const expenseCategories = expenseCategoriesResult.data ?? [];
  const schedules = recurringResult.data;

  // For a variable schedule with no confirmed next_amount, this is the same
  // live estimate v_upcoming_recurring computes in SQL -- read here from a
  // balance already fetched via listAccountBalances rather than a second
  // per-row round trip, since this page (unlike the dashboard) reads the
  // raw recurring_transactions table, not that view.
  const cardBalanceByAccountId = new Map(
    (balancesResult.data ?? []).map((b) => [b.account_id, b.balance ?? 0]),
  );
  const today = todayISO();

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
      />

      {/* Paused schedules stay in this one list, dimmed and badged, rather
          than dropping out of sight behind a toggle (AccountsPage hides
          archived accounts this way -- a paused schedule is meant to be
          easy to find again and resume). */}
      <ul className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
        {schedules.map((recurring) => {
          // Only meaningful when amount_is_variable and unconfirmed --
          // RecurringRow ignores it otherwise. listAccountBalances() above
          // was called with no is_active filter, so this covers an
          // archived destination account too.
          const cardBalance = recurring.to_accountid
            ? (cardBalanceByAccountId.get(recurring.to_accountid) ?? 0)
            : 0;
          return (
            <RecurringRow
              key={recurring.id}
              recurring={recurring}
              incomeCategories={incomeCategories}
              expenseCategories={expenseCategories}
              accounts={accounts}
              estimatedAmount={estimateCardPaymentDue(cardBalance)}
              today={today}
            />
          );
        })}
      </ul>
    </div>
  );
}
