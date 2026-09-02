import { getGoalProgress, getGoalsSummary } from "@/lib/db/dashboard";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { StatTile } from "@/components/ui/StatTile";
import { TargetIcon } from "@/components/ui/icons";
import { CreateGoalForm } from "./CreateGoalForm";
import { GoalRow } from "./GoalRow";

export default async function GoalsPage() {
  const [progressResult, summaryResult] = await Promise.all([
    getGoalProgress(),
    getGoalsSummary(),
  ]);

  if (progressResult.error !== null || summaryResult.error !== null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Goals"
          description="What you're saving toward, and how close you are."
        />
        <ErrorMessage
          severity="critical"
          message={
            progressResult.error ??
            summaryResult.error ??
            "We couldn't load your goals. Refresh the page to try again."
          }
        />
      </div>
    );
  }

  const goals = progressResult.data;

  // A brand-new goals list means nothing else on this page (the saved-so-far
  // hero figure) means anything yet -- same narrowing accounts/page.tsx does
  // for a zero-account user.
  if (goals.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Goals"
          description="What you're saving toward, and how close you are."
        />
        <EmptyState
          icon={<TargetIcon className="h-10 w-10" />}
          heading="Give your savings a destination"
          message="A trip, a down payment, a cushion for emergencies -- name it, set a target, and every contribution counts toward it."
          action={<CreateGoalForm label="Set your first goal" />}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Goals"
        description="What you're saving toward, and how close you are."
      />

      {summaryResult.data ? (
        <StatTile
          id="goals-total-saved"
          label="Saved toward your goals"
          value={summaryResult.data.total_saved ?? 0}
          format="currency"
          size="hero"
        />
      ) : null}

      <CreateGoalForm />

      <ul className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
        {goals.map((goal) => (
          <GoalRow key={goal.goal_id} goal={goal} />
        ))}
      </ul>
    </div>
  );
}
