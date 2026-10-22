"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useActionForm } from "@/components/useActionForm";
import { joinWaitlistAction, type WaitlistActionState } from "@/lib/actions/waitlist";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { normaliseWaitlistEmail, WAITLIST_EMAIL_MAX } from "@/lib/waitlistValidation";
import { PRIVACY_PATH } from "@/lib/legal";

// Underlined at rest: it sits inside a sentence, so colour alone wouldn't
// mark it as a link.
const NOTICE_LINK =
  "rounded text-ink-secondary underline underline-offset-2 transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

// The landing page's waitlist. The success line is the same whether the
// address was new or already on the list -- the server can't tell this form
// which, by design (lib/db/waitlist.ts). A failure keeps what was typed and
// never shows the success line.
export function WaitlistForm() {
  const [state, action, pending, submit] = useActionForm<WaitlistActionState>(
    joinWaitlistAction,
    undefined,
  );
  const [email, setEmail] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  // The server result the visitor has since edited away.
  const [dismissed, setDismissed] = useState<WaitlistActionState>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);

  // The form (and the button that had focus) is gone; put focus on the
  // line that replaced it, so it's read out and keyboard focus isn't lost.
  useEffect(() => {
    if (state?.joined) successRef.current?.focus();
  }, [state]);

  if (state?.joined) {
    return (
      <p
        ref={successRef}
        tabIndex={-1}
        role="status"
        className="rounded text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        You&rsquo;re on the list. We&rsquo;ll email you at{" "}
        <span className="font-semibold break-all">{state.joined}</span> when Sorrel opens
        &mdash; nothing else.
      </p>
    );
  }

  const serverResult = state && state !== dismissed ? state : undefined;
  const fieldError =
    clientError ?? (serverResult?.field === "email" ? serverResult.error : undefined);
  const formError = serverResult?.error && !serverResult.field ? serverResult.error : null;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const { error } = normaliseWaitlistEmail(email);
    if (error === null) {
      setClientError(null);
      submit(e);
      return;
    }
    e.preventDefault();
    setClientError(error);
    inputRef.current?.focus();
  };

  return (
    <form action={action} onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <FormField label="Email address" htmlFor="waitlist-email" error={fieldError}>
        <Input
          ref={inputRef}
          id="waitlist-email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={WAITLIST_EMAIL_MAX}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setClientError(null);
            if (serverResult) setDismissed(serverResult);
          }}
          aria-describedby="waitlist-notice"
          required
        />
      </FormField>

      <p id="waitlist-notice" className="text-sm text-ink-muted">
        One email when we launch. Nothing else, ever.{" "}
        <Link href={PRIVACY_PATH} className={NOTICE_LINK}>
          Privacy policy
        </Link>
      </p>

      {formError ? <ErrorMessage message={formError} /> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Adding you…" : "Tell me when it opens"}
      </Button>
    </form>
  );
}
