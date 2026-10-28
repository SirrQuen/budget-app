"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useActionForm } from "@/components/useActionForm";
import { login, type ActionState } from "@/lib/auth/actions";
import { signInSubmitted } from "@/lib/welcomeSignals";
import { SIGNED_IN_COOKIE } from "@/lib/auth/signedInFlag";

// How long after a submit, still on this page, before offering the link.
const CONTINUE_AFTER_MS = 5000;
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
  const [stuck, setStuck] = useState(false);
  const stuckTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(stuckTimer.current), []);

  // Tells the welcome host a sign-in is in flight (it watches for the
  // daily welcome cookie), then submits. And if, a few seconds on, this
  // form is still here while the sign-in cookie says it succeeded, the
  // redirect never landed -- offer the way in rather than a dead form.
  // A successful navigation unmounts this form (and the authenticated
  // layout clears that cookie), so the check never fires.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    signInSubmitted();
    clearTimeout(stuckTimer.current);
    stuckTimer.current = setTimeout(() => {
      if (document.cookie.split("; ").some((c) => c === `${SIGNED_IN_COOKIE}=1`)) setStuck(true);
    }, CONTINUE_AFTER_MS);
    submit(event);
  }
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
    <form action={action} onSubmit={onSubmit} className="flex flex-col gap-4">
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

      {/* The redirect never landed -- a script error, a chunk that won't
          load -- yet sign-in succeeded: a plain link that needs no JS, so a
          signed-in user isn't left facing a sign-in form.

          (Not a no-JS fallback: this form can't submit without JS at all.
          useActionForm wraps the server action in guardAction, so React
          renders the form's action as a javascript: placeholder -- true of
          every useActionForm form. See docs/phase-7-findings.md.) */}
      {stuck ? (
        <p role="status" className="text-sm text-ink-secondary">
          You&rsquo;re signed in.{" "}
          <a href="/dashboard" className="font-medium text-ink underline underline-offset-2">
            Continue to Sorrel
          </a>
        </p>
      ) : null}

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
