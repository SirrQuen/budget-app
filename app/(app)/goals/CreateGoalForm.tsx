"use client";

import { useState } from "react";
import { GoalForm } from "./GoalForm";
import { Button } from "@/components/ui/Button";

export function CreateGoalForm({
  label = "Add goal",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </Button>
    );
  }

  return <GoalForm onSuccess={() => setOpen(false)} onCancel={() => setOpen(false)} />;
}
