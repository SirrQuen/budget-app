"use client";

import { useState } from "react";
import { RecurringForm } from "./RecurringForm";
import { Button } from "@/components/ui/Button";
import type { CategoryWithGroup } from "@/lib/db/categories";
import type { TransactionAccountOption } from "../transactions/AddTransactionForm";

export function CreateRecurringForm({
  incomeCategories,
  expenseCategories,
  accounts,
  label = "Add schedule",
}: {
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  accounts: TransactionAccountOption[];
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
      onSuccess={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    />
  );
}
