import { getGoalProgress, getGoalsSummary } from "@/lib/db/dashboard";
import {
  getGoalContributions,
  listFundingTransfers,
  listGoalFundingLinks,
  type GoalContribution,
} from "@/lib/db/goals";
import { getTimeZone } from "@/lib/db/settings";
import { todayInZone } from "@/lib/date";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/LoadError";
import { StatTile } from "@/components/ui/StatTile";
import { TargetIcon } from "@/components/ui/icons";
import { CreateGoalForm } from "./CreateGoalForm";
import { GoalRow } from "./GoalRow";

export default async function GoalsPage() {
  const [progressResult, summaryResult, contributionsResult, timeZone, transfersResult, linksResult] = await Promise.all([
    getGoalProgress(),
    getGoalsSummary(),
    getGoalContributions(),
    getTimeZone(),
    listFundingTransfers(),
    listGoalFundingLinks(),
  ]);

  if (
    progressResult.error !== null ||
    summaryResult.error !== null ||
    contributionsResult.error !== null ||
    transfersResult.error !== null ||
    linksResult.error !== null
  ) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Goals"
          description="What you're saving toward, and how close you are."
        />
        <LoadError
          message={
            progressResult.error ??
            summaryResult.error ??
            contributionsResult.error ??
            transfersResult.error ??
            linksResult.error ??
            "We couldn't load your goals. Refresh the page to try again."
          }
        />
      </div>
    );
  }

  const goals = progressResult.data;

  const contributionsByGoal = new Map<string, GoalContribution[]>();
  for (const contribution of contributionsResult.data) {
    const list = contributionsByGoal.get(contribution.goalid) ?? [];
    list.push(contribution);
    contributionsByGoal.set(contribution.goalid, list);
  }

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
          action={<CreateGoalForm label="Set your first goal" fundingTransfers={transfersResult.data} />}
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

      <CreateGoalForm fundingTransfers={transfersResult.data} />

      <ul className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
        {goals.map((goal) => (
          <GoalRow
            key={goal.goal_id}
            goal={goal}
            contributions={contributionsByGoal.get(goal.goal_id ?? "") ?? []}
            fundingRecurringId={linksResult.data.get(goal.goal_id ?? "") ?? null}
            fundingTransfers={transfersResult.data}
            // completed_at is an instant; the day it names is the user's.
            completedOn={goal.completed_at ? todayInZone(timeZone, new Date(goal.completed_at)) : null}
          />
        ))}
      </ul>
    </div>
  );
}
