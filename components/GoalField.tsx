"use client";

import { useState } from "react";
import { FormField } from "@/components/ui/FormField";
import { FIELD_CLASS } from "@/components/ui/Input";
import type { FollowedGoal, GoalOption } from "@/lib/db/goals";
import { followedNote } from "@/lib/goalFollow";

// "Is this for a goal?" (docs/Log-Again-and-Goal-Links.md, section 3;
// migration 69). Optional, never required, and collapsed to one quiet row
// -- "Goal: none" -- because most transactions aren't for a goal and a
// question on every entry teaches people to dismiss it.
//
// It opens itself, as "Is this for a goal?", only where a goal is likely
// (lib/goalLinks.ts goalFieldAsks: a transfer leaving the spendable set),
// and when it already carries a goal (an edit, or Log again) so the link
// is visible and removable. Still defaults to none.
//
// The parent decides whether the type can carry a goal at all (never
// income) and doesn't render this when it can't.
export function GoalField({
  goals,
  value,
  onChange,
  asks,
  currentGoal,
  id,
  followed = [],
  accountIds = [],
}: {
  /** Active, uncompleted goals (listGoalOptions). */
  goals: GoalOption[];
  /** The chosen goal id, "" for none. */
  value: string;
  onChange: (goalId: string) => void;
  /** Open as "Is this for a goal?" (goalFieldAsks). */
  asks: boolean;
  /** The goal this row already carries when the list no longer offers it (archived or completed). */
  currentGoal?: { id: string; name: string } | null;
  id: string;
  /** Goals that follow a card (migration 70): never offered, but named when this transaction touches their card. */
  followed?: FollowedGoal[];
  /** The account(s) this transaction is on: the account, or a transfer's from and to. */
  accountIds?: string[];
}) {
  const [opened, setOpened] = useState(false);
  const options =
    currentGoal && !goals.some((g) => g.id === currentGoal.id)
      ? [...goals, { id: currentGoal.id, name: currentGoal.name, monthlyContribution: null }]
      : goals;

  // A payment to a followed card already counts toward its goal: say so,
  // beside the field, instead of offering the goal.
  const onCard = followed.filter((g) => accountIds.includes(g.accountId));
  const cardNote =
    onCard.length > 0 ? (
      <p className="text-xs text-ink-secondary">
        {onCard.map((g) => followedNote(g.name)).join(" ")}
      </p>
    ) : null;

  // No goal to offer: nothing to show. A value can't exist without an
  // option, so there's nothing to keep either.
  if (options.length === 0)
    return (
      <>
        <input type="hidden" name="goalid" value="" />
        {cardNote}
      </>
    );

  const expanded = opened || asks || value !== "";

  if (!expanded) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm">
        <input type="hidden" name="goalid" value="" />
        <span className="text-ink-secondary">Goal: none</span>
        <button
          type="button"
          onClick={() => setOpened(true)}
          className="rounded font-medium text-ink-secondary underline underline-offset-2 transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Choose a goal
        </button>
        </div>
        {cardNote}
      </div>
    );
  }

  return (
    <FormField
      label={asks && value === "" ? "Is this for a goal?" : "Goal"}
      htmlFor={id}
      hint="Optional. It counts toward the goal, and toward this month's amount for it."
    >
      <select id={id} name="goalid" value={value} onChange={(e) => onChange(e.target.value)} className={FIELD_CLASS}>
        <option value="">No goal</option>
        {options.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      {cardNote}
    </FormField>
  );
}
