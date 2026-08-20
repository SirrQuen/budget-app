"use client";

import { useState } from "react";
import { AccountForm } from "./AccountForm";
import { Button } from "@/components/ui/Button";

export function CreateAccountForm({
  label = "Add account",
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

  return <AccountForm onSuccess={() => setOpen(false)} onCancel={() => setOpen(false)} />;
}
