import { requireUser } from "@/lib/auth/dal";
import { recordLogin } from "@/lib/db/profile";
import { listAccounts } from "@/lib/db/accounts";
import { listCategoriesForType } from "@/lib/db/categories";
import { getMostRecentTransactionAccountId } from "@/lib/db/transactions";
import { generateDueOccurrences } from "@/lib/db/recurring";
import { getTheme } from "@/lib/db/settings";
import { AppShell } from "@/components/app-shell/AppShell";
import { identityName } from "@/lib/displayName";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Every authenticated route runs this layout -- lazy catch-up (see
  // CLAUDE.md "Recurring transactions") belongs here, not just on
  // /dashboard, or a schedule goes stale for anyone who always lands
  // straight on /transactions. Must finish before
  // getMostRecentTransactionAccountId() below, which reads transactions
  // and would otherwise race its inserts. cache()d (like
  // recordLogin), so DashboardPage's own call for the created list, to
  // build its banner, is free -- both resolve to this one run.
  await generateDueOccurrences();

  const [user, loginResult, accountsResult, incomeCategoriesResult, expenseCategoriesResult, recentAccountResult, theme] =
    await Promise.all([
      requireUser(),
      // Every authenticated route runs this layout, including the
      // email-confirmation redirect straight into /dashboard that never
      // touches lib/auth/actions.ts login() -- so the lastlogin
      // stamp has to happen here, not there. recordLogin is request-cached,
      // so DashboardPage re-reading it is free. It also carries the name
      // fields for the sidebar.
      recordLogin(),
      listAccounts({ is_active: true }),
      listCategoriesForType("Income"),
      listCategoriesForType("Expense"),
      getMostRecentTransactionAccountId(),
      // Never rejects and never surfaces an error -- an unreadable settings
      // row resolves to "system" rather than failing every authenticated
      // route. See lib/db/settings.ts.
      getTheme(),
    ]);

  // A load failure here just means no quick-add bar for this request, not a
  // broken page.
  const quickAdd =
    accountsResult.data && incomeCategoriesResult.data && expenseCategoriesResult.data
      ? {
          accounts: accountsResult.data,
          incomeCategories: incomeCategoriesResult.data,
          expenseCategories: expenseCategoriesResult.data,
          defaultAccountId: recentAccountResult.data ?? null,
        }
      : null;

  // A failed profile read degrades to the email's local part, then
  // "Your account" -- never the full address, never blank.
  const accountName = identityName({ ...loginResult.data, email: user.email });

  return (
    <ThemeProvider stored={theme}>
      <AppShell accountName={accountName} quickAdd={quickAdd}>
        {children}
      </AppShell>
    </ThemeProvider>
  );
}
