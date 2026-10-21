"use client";

import { useActionForm } from "@/components/useActionForm";
import { resendConfirmation, type ActionState } from "@/lib/auth/actions";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

export function ResendConfirmationForm() {
  const [state, action, pending, submit] = useActionForm<ActionState>(resendConfirmation, undefined);

  if (state?.success) {
    return (
      <p role="status" className="text-sm text-ink-secondary">
        {state.success}
      </p>
    );
  }

  return (
    <form action={action} onSubmit={submit} className="flex flex-col gap-4">
      <FormField label="Email" htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </FormField>

      {state?.error ? <ErrorMessage message={state.error} /> : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Send a new link"}
      </Button>
    </form>
  );
}
