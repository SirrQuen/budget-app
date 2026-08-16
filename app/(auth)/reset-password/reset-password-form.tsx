"use client";

import { useActionState } from "react";
import { updatePassword } from "@/lib/auth/actions";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormField label="New password" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
      </FormField>

      <FormField label="Confirm new password" htmlFor="confirmPassword" required>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </FormField>

      {state?.error ? <ErrorMessage message={state.error} /> : null}

      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
