import { listRecurring, listRecurringAmounts } from "@/lib/db/recurring";
import { listAccounts } from "@/lib/db/accounts";
import { listCategoriesForType } from "@/lib/db/categories";
import { getBankHolidays } from "@/lib/db/holidays";
import { getToday } from "@/lib/db/settings";
import { getConfirmationQueue } from "@/lib/db/dashboard";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/LoadError";
import { RepeatIcon } from "@/components/ui/icons";
import { CreateRecurringForm } from "./CreateRecurringForm";
import { RecurringRow } from "./RecurringRow";
import { ConfirmationQueue } from "./ConfirmationQueue";
import type { TransactionAccountOption } from "../transactions/AddTransactionForm";

// Name, schedule, next due, amount, actions -- identical on every row on
// this screen, same reasoning as ACCOUNT_ROW_GRID in the accounts screen.
// One flat list here (no type-groups to subgrid across), so RecurringRow's
// <li> subgrids straight off this <ul>.
// Container-query breakpoints (@4xl), not viewport ones: the grid switches
// on when the list itself is ~56rem wide, so the sidebar and browser zoom
// can't squeeze the name column to a few letters. The @container is the
// <div> wrapping the <ul> below.
const RECURRING_ROW_GRID =
  "@4xl:grid @4xl:grid-cols-[minmax(0,min(28rem,1fr))_auto_auto_max-content_max-content] @4xl:gap-x-4 @4xl:px-4";

function RecurringLoadError({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Recurring"
        description="Bills and paychecks that repeat. When one comes due, you confirm what happened."
      />
      <LoadError message={message} />
    </div>
  );
}

export default async function RecurringPage() {
  const [
    recurringResult,
    accountsResult,
    amountsResult,
    incomeCategoriesResult,
    expenseCategoriesResult,
    holidaysResult,
    confirmationResult,
  ] = await Promise.all([
    listRecurring(),
    listAccounts({ is_active: true }),
    listRecurringAmounts(),
    listCategoriesForType("Income"),
    listCategoriesForType("Expense"),
    getBankHolidays(),
    getConfirmationQueue(),
  ]);

  // RecurringForm's live timing preview degrades to "weekend-aware only"
  // (no holidays) if this fails to load -- what actually gets saved is
  // still resolved authoritatively server-side (lib/db/recurring.ts), so a
  // failed read here is a preview inconvenience, not a correctness issue.
  const holidays = holidaysResult.data ? Array.from(holidaysResult.data) : [];

  // A failed read is an error state, never an empty list or a zero
  // (docs/phase-7-findings.md, "a failed read renders as a plausible
  // zero"). A failed amounts read would show no figure, or a wrong one; a failed accounts read would hide "Add schedule"; a failed
  // categories read would leave the pickers empty. Holidays above is the
  // one documented exception.
  if (
    recurringResult.error !== null ||
    accountsResult.error !== null ||
    amountsResult.error !== null ||
    incomeCategoriesResult.error !== null ||
    expenseCategoriesResult.error !== null ||
    confirmationResult.error !== null
  ) {
    return (
      <RecurringLoadError
        message={
          recurringResult.error ??
          accountsResult.error ??
          amountsResult.error ??
          incomeCategoriesResult.error ??
          expenseCategoriesResult.error ??
          confirmationResult.error ??
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

  // Every row's amount and its label come from v_recurring_amounts --
  // paused schedules included -- the same view the dashboard's figures come
  // through, so the two pages can't disagree (migration 59).
  const amounts = amountsResult.data;

  const today = await getToday();

  // Nothing to manage and no account to schedule against yet -- same
  // narrowing AccountsPage/GoalsPage use for a brand-new list.
  if (schedules.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Recurring"
          description="Bills and paychecks that repeat. When one comes due, you confirm what happened."
        />
        <EmptyState
          icon={<RepeatIcon className="h-10 w-10" />}
          heading="Set up a repeating bill or paycheck"
          message="Rent, a subscription, your paycheck -- set it up once. When its date comes, one tap confirms it and it goes in your transactions."
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
        description="Bills and paychecks that repeat. When one comes due, you confirm what happened."
      />

      <CreateRecurringForm
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        accounts={accounts}
        holidays={holidays}
      />

      <ConfirmationQueue items={confirmationResult.data} />

      {/* Paused schedules stay in this one list, dimmed and badged, rather
          than dropping out of sight behind a toggle (AccountsPage hides
          archived accounts this way -- a paused schedule is meant to be
          easy to find again and resume). */}
      <div className="@container">
      <ul
        className={`divide-y divide-gridline rounded-2xl border border-hairline bg-surface ${RECURRING_ROW_GRID}`}
      >
        {schedules.map((recurring) => {
          const shown = amounts.get(recurring.id);
          if (!shown) return null;
          return (
            <RecurringRow
              key={recurring.id}
              recurring={recurring}
              incomeCategories={incomeCategories}
              expenseCategories={expenseCategories}
              accounts={accounts}
              holidays={holidays}
              amount={shown}
              today={today}
            />
          );
        })}
      </ul>
      </div>
    </div>
  );
}
