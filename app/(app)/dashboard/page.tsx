import { recordLogin } from "@/lib/db/profile";
import { getSafeToSpend, getDashboardStats, getLoggingStreak } from "@/lib/db/dashboard";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { ReturnSummaryStrip } from "@/components/ui/ReturnSummaryStrip";
import { SafeToSpendHero } from "./SafeToSpendHero";

// Auth is already enforced by app/(app)/layout.tsx's requireUser() before
// this page renders.
export default async function DashboardPage() {
  const [greetingResult, safeToSpendResult, statsResult, streakResult] = await Promise.all([
    recordLogin(),
    getSafeToSpend(),
    getDashboardStats(),
    getLoggingStreak(),
  ]);

  const firstName = greetingResult.data?.firstName;
  const namePart = firstName ? `, ${firstName}` : "";
  const description = greetingResult.data?.isFirstLogin
    ? `Welcome to EverNest${namePart}.`
    : `Welcome back${namePart}.`;

  const stats = statsResult.data;
  const streak = streakResult.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description={description} />
      {safeToSpendResult.data ? <SafeToSpendHero data={safeToSpendResult.data} /> : null}

      {stats ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            id="dashboard-net-worth"
            label="Net worth"
            value={stats.netWorth.value}
            format="currency"
            delta={{
              value: stats.netWorth.delta,
              periodLabel: "last month",
              format: "currency",
              goodWhen: "up",
            }}
            trend={stats.netWorth.points}
          />
          <StatTile
            id="dashboard-income"
            label="Income this month"
            value={stats.income.value}
            format="currency"
            delta={{
              value: stats.income.delta,
              periodLabel: "last month",
              format: "currency",
              goodWhen: "up",
            }}
            trend={stats.income.points}
          />
          <StatTile
            id="dashboard-spending"
            label="Spending this month"
            value={stats.spending.value}
            format="currency"
            delta={{
              value: stats.spending.delta,
              periodLabel: "last month",
              format: "currency",
              goodWhen: "down",
            }}
            trend={stats.spending.points}
          />
          {streak ? (
            <StatTile
              id="dashboard-streak"
              label="Logging streak"
              value={streak.current}
              format="number"
              footnote={`Best: ${streak.best} day${streak.best === 1 ? "" : "s"}`}
            />
          ) : null}
        </div>
      ) : null}

      <ReturnSummaryStrip />
    </div>
  );
}
