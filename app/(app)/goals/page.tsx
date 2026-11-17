import { getGoalProgress, getGoalsSummary } from "@/lib/db/dashboard";
import {
  getGoalContributions,
  getGoalLinkedTransactions,
  listFundingTransfers,
  listFollowableCards,
  listGoalFundingLinks,
  type GoalContribution,
  type GoalLinkedTransaction,
} from "@/lib/db/goals";
import { getTimeZone } from "@/lib/db/settings";
import { todayInZone } from "@/lib/date";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadError } from "@/components/ui/LoadError";
import { StatTile } from "@/components/ui/StatTile";
import { SeedIllustration } from "@/components/ui/EmptyIllustrations";
import { CreateGoalForm } from "./CreateGoalForm";
import { GoalRow } from "./GoalRow";

export default async function GoalsPage() {
  const [progressResult, summaryResult, contributionsResult, timeZone, transfersResult, linksResult, linkedResult, cardsResult] =
    await Promise.all([
      getGoalProgress(),
      getGoalsSummary(),
      getGoalContributions(),
      getTimeZone(),
      listFundingTransfers(),
      listGoalFundingLinks(),
      getGoalLinkedTransactions(),
      // Cards a debt payoff goal can follow (migration 70). A failed read
      // only means no card is offered.
      listFollowableCards(),
    ]);

  if (
    progressResult.error !== null ||
    summaryResult.error !== null ||
    contributionsResult.error !== null ||
    transfersResult.error !== null ||
    linksResult.error !== null ||
    linkedResult.error !== null
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
            linkedResult.error ??
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
  // Transactions linked to a goal (migration 69): part of its history, and
  // already part of its total (v_goal_progress reads v_goal_money).
  const linkedByGoal = new Map<string, GoalLinkedTransaction[]>();
  for (const linked of linkedResult.data) {
    const list = linkedByGoal.get(linked.goalid) ?? [];
    list.push(linked);
    linkedByGoal.set(linked.goalid, list);
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
          icon={<SeedIllustration />}
          heading="Plant your first goal"
          message="Something you're saving toward. Sorrel helps it grow a little each month."
          action={<CreateGoalForm label="New goal" fundingTransfers={transfersResult.data} />}
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
            linked={linkedByGoal.get(goal.goal_id ?? "") ?? []}
            fundingRecurringId={linksResult.data.get(goal.goal_id ?? "") ?? null}
            fundingTransfers={transfersResult.data}
            cards={cardsResult.data ?? []}
            // completed_at is an instant; the day it names is the user's.
            completedOn={goal.completed_at ? todayInZone(timeZone, new Date(goal.completed_at)) : null}
          />
        ))}
      </ul>
    </div>
  );
}
