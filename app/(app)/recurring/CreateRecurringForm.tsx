"use client";

import { useState } from "react";
import { RecurringForm } from "./RecurringForm";
import { Button } from "@/components/ui/Button";
import type { CategoryWithGroup } from "@/lib/db/categories";
import type { TransactionAccountOption } from "../transactions/AddTransactionForm";
import type { FeedingSchedule, GoalOption } from "@/lib/db/goals";

export function CreateRecurringForm({
  incomeCategories,
  expenseCategories,
  accounts,
  goals,
  goalSchedules = [],
  holidays = [],
  label = "Add schedule",
}: {
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  accounts: TransactionAccountOption[];
  goals: GoalOption[];
  goalSchedules?: FeedingSchedule[];
  /** ISO dates, for RecurringForm's live timing preview -- see its own doc comment. */
  holidays?: string[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} className="self-start">
        {label}
      </Button>
    );
  }

  return (
    <RecurringForm
      incomeCategories={incomeCategories}
      expenseCategories={expenseCategories}
      accounts={accounts}
      goals={goals}
      goalSchedules={goalSchedules}
      holidays={holidays}
      onSuccess={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    />
  );
}
