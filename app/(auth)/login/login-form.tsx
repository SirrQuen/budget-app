"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, type ActionState } from "@/lib/auth/actions";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    login,
    initialError ? { error: initialError } : undefined,
  );

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
          autoComplete="current-password"
          required
        />
      </FormField>

      {state?.error ? <ErrorMessage message={state.error} /> : null}

      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? "Logging in…" : "Log in"}
      </Button>

      <div className="flex items-center justify-between text-sm text-ink-secondary">
        <Link
          href="/forgot-password"
          className="rounded transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Forgot password?
        </Link>
        <Link
          href="/signup"
          className="rounded transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Create account
        </Link>
      </div>
    </form>
  );
}
