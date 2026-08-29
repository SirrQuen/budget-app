import { recordLogin } from "@/lib/db/profile";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReturnSummaryStrip } from "@/components/ui/ReturnSummaryStrip";

// Auth is already enforced by app/(app)/layout.tsx's requireUser() before
// this page renders.
export default async function DashboardPage() {
  const greetingResult = await recordLogin();

  const firstName = greetingResult.data?.firstName;
  const namePart = firstName ? `, ${firstName}` : "";
  const description = greetingResult.data?.isFirstLogin
    ? `Welcome to EverNest${namePart}.`
    : `Welcome back${namePart}.`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description={description} />
      <ReturnSummaryStrip />
    </div>
  );
}
