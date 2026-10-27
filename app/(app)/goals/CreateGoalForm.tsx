"use client";

import { useEffect, useRef, useState } from "react";
import { GoalForm } from "./GoalForm";
import { Button } from "@/components/ui/Button";

// The goal-completion panel's "Start another goal" (GoalRow) opens this
// form from elsewhere on the page.
export const NEW_GOAL_EVENT = "sorrel:new-goal";

export function CreateGoalForm({
  label = "Add goal",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  // Opened by the event: focus goes to the name field, since the button
  // that held it was in the panel that just closed.
  const focusName = useRef(false);

  useEffect(() => {
    const openForm = () => {
      focusName.current = true;
      setOpen(true);
    };
    window.addEventListener(NEW_GOAL_EVENT, openForm);
    return () => window.removeEventListener(NEW_GOAL_EVENT, openForm);
  }, []);

  useEffect(() => {
    if (open && focusName.current) {
      focusName.current = false;
      formRef.current?.querySelector<HTMLInputElement>('input[name="goal_name"]')?.focus();
    }
  }, [open]);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </Button>
    );
  }

  return (
    <div ref={formRef}>
      <GoalForm onSuccess={() => setOpen(false)} onCancel={() => setOpen(false)} />
    </div>
  );
}
