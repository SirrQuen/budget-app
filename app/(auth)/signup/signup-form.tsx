"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signup } from "@/lib/auth/actions";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined);

  if (state?.success) {
    return <p className="text-sm text-ink-secondary">{state.success}</p>;
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormField label="Email" htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </FormField>

      <FormField label="Password" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
      </FormField>

      <FormField label="Confirm password" htmlFor="confirmPassword" required>
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
        {pending ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-ink-secondary">
        Already have an account?{" "}
        <Link href="/login" className="text-ink hover:text-gold">
          Log in
        </Link>
      </p>
    </form>
  );
}
