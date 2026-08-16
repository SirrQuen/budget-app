"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset } from "@/lib/auth/actions";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);

  if (state?.success) {
    return <p className="text-sm text-ink-secondary">{state.success}</p>;
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormField label="Email" htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </FormField>

      {state?.error ? <ErrorMessage message={state.error} /> : null}

      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? "Sending…" : "Send reset link"}
      </Button>

      <p className="text-center text-sm text-ink-secondary">
        <Link href="/login" className="hover:text-ink">
          Back to login
        </Link>
      </p>
    </form>
  );
}
