import { requireUser } from "@/lib/auth/dal";
import { AppShell } from "@/components/app-shell/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell userEmail={user.email ?? "Signed in"}>{children}</AppShell>;
}
