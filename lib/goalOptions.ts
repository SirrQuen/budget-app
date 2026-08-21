// Shared between the create-goal Server Action (validation) and the
// create-goal form (rendering) -- no "server-only" import so the client
// form can pull the same source of truth.

// Mirrors goals_goal_type_check. Keep in sync if that constraint ever
// changes.
export const GOAL_TYPES = [
  "Home",
  "Car",
  "Vacation",
  "Education",
  "Wedding",
  "Baby",
  "Emergency Fund",
  "Retirement",
  "Debt Payoff",
  "Custom",
] as const;

export type GoalType = (typeof GOAL_TYPES)[number];
