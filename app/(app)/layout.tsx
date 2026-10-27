import { Suspense } from "react";
import { cookies } from "next/headers";
import { getSessionId, requireUser } from "@/lib/auth/dal";
import { recordLogin } from "@/lib/db/profile";
import { listAccounts } from "@/lib/db/accounts";
import { listCategoriesForType } from "@/lib/db/categories";
import { getMostRecentTransactionAccountId } from "@/lib/db/transactions";
import { getTheme, getTimeZone, getToday } from "@/lib/db/settings";
import { AppShell } from "@/components/app-shell/AppShell";
import { identityName } from "@/lib/displayName";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { TodayProvider } from "@/components/TodayProvider";
import { WelcomeBloom } from "@/components/WelcomeBloom";
import { SessionFlags } from "@/components/SessionFlags";
import { SorrelLoader } from "@/components/SorrelLoader";
import { SIGNED_IN_COOKIE } from "@/lib/auth/signedInFlag";
import { WELCOME_COOKIE, parseWelcomeReason } from "@/lib/welcome";

// The two one-shot sign-in cookies are read here, on the server, before any
// of the app's data: the welcome overlay renders straight away -- in the
// initial HTML of a full load, in the first commit of a client navigation
// -- while the frame below streams in behind it. Nothing about the overlay
// waits on hydration or on these reads. SessionFlags deletes both cookies
// as the layout mounts.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const welcome = parseWelcomeReason(jar.get(WELCOME_COOKIE)?.value);
  const signedIn = jar.get(SIGNED_IN_COOKIE)?.value === "1";

  return (
    <>
      <SessionFlags signedIn={signedIn} welcoming={welcome !== null} />
      <WelcomeBloom reason={welcome} />
      {/* What the root app/loading.tsx used to show while this layout
          awaited its reads. That boundary sat ABOVE this layout, so a slow
          first render painted the loader before the overlay; it's gone,
          and this one sits under the overlay instead. */}
      <Suspense fallback={<SorrelLoader className="min-h-dvh flex-1" />}>
        <AppFrame>{children}</AppFrame>
      </Suspense>
    </>
  );
}

async function AppFrame({ children }: { children: React.ReactNode }) {
  const [user, loginResult, accountsResult, incomeCategoriesResult, expenseCategoriesResult, recentAccountResult, theme, timeZone, today, sessionId] =
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
      getTimeZone(),
      getToday(),
      // Keys the idle sign-out's shared activity clock (components/
      // IdleTimeout.tsx). Read-only.
      getSessionId(),
    ]);

  // A load failure here just means no quick-add bar for this request, not a
  // broken page. Deliberate, and not a plausible zero: no figure is shown,
  // and the page underneath reports its own failed reads, which share the
  // cause. A failed recent-account read only loses the pre-selected account.
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
      <TodayProvider today={today} timeZone={timeZone}>
        <AppShell accountName={accountName} quickAdd={quickAdd} sessionId={sessionId}>
          {children}
        </AppShell>
      </TodayProvider>
    </ThemeProvider>
  );
}
