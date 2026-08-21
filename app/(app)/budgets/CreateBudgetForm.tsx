"use client";

import { useState } from "react";
import { BudgetForm } from "./BudgetForm";
import { Button } from "@/components/ui/Button";
import type { CategoryWithGroup } from "@/lib/db/categories";

export function CreateBudgetForm({
  categories,
  month,
}: {
  categories: CategoryWithGroup[];
  month: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} className="self-start">
        Add budget
      </Button>
    );
  }

  return (
    <BudgetForm
      categories={categories}
      month={month}
      onSuccess={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    />
  );
}
