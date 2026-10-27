"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useActionForm } from "@/components/useActionForm";
import { login, type ActionState } from "@/lib/auth/actions";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { takeSignupEmail } from "@/lib/auth/signupEmailHandoff";
import { BrowserTimeZoneField } from "@/components/BrowserTimeZoneField";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, action, pending, submit] = useActionForm<ActionState>(
    login,
    initialError ? { error: initialError } : undefined,
  );
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Arriving from "I've confirmed — sign in" on the signup screen: the
  // address is already known, so the password is all that's left. After
  // hydration, never in the render -- sessionStorage doesn't exist on the
  // server. Never overwrites anything already typed.
  useEffect(() => {
    const email = takeSignupEmail();
    const input = emailRef.current;
    if (!email || !input || input.value) return;
    input.value = email;
    passwordRef.current?.focus();
  }, []);

  return (
    <form action={action} onSubmit={submit} className="flex flex-col gap-4">
      {/* The user's day for the daily welcome, before their settings have a zone. */}
      <BrowserTimeZoneField />
      <FormField label="Email" htmlFor="email" required>
        <Input
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </FormField>

      <FormField label="Password" htmlFor="password" required>
        <Input
          ref={passwordRef}
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
