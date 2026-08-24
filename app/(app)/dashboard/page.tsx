import { requireUser } from "@/lib/auth/dal";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReturnSummaryStrip } from "@/components/ui/ReturnSummaryStrip";

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description={`Welcome back, ${user.email ?? "there"}.`} />
      <ReturnSummaryStrip />
    </div>
  );
}
