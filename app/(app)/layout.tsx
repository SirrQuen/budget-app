import { requireUser } from "@/lib/auth/dal";
import { getLoggingStreak } from "@/lib/db/dashboard";
import { AppShell } from "@/components/app-shell/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, streakResult] = await Promise.all([requireUser(), getLoggingStreak()]);

  // Nothing worth showing for a user who hasn't logged anything in the
  // streak window yet -- the badge would just read "0 days," which isn't
  // encouraging, it's a non-event.
  const streak =
    streakResult.data && (streakResult.data.current > 0 || streakResult.data.best > 0)
      ? streakResult.data
      : null;

  return (
    <AppShell userEmail={user.email ?? "Signed in"} streak={streak}>
      {children}
    </AppShell>
  );
}
