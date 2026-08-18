"use client";

import { useState } from "react";
import { CategoryForm } from "./CategoryForm";
import { Button } from "@/components/ui/Button";

export function CreateCategoryForm({
  groups,
}: {
  groups: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} className="self-start">
        Add category
      </Button>
    );
  }

  return <CategoryForm groups={groups} onSuccess={() => setOpen(false)} onCancel={() => setOpen(false)} />;
}
