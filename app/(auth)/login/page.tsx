import { InboxIcon, InfoIcon } from "@/components/ui/icons";
import { timeoutNotice } from "@/lib/idleTimeout";
import { LoginForm } from "./login-form";
import { EMAIL_CONFIRMED_NOTICE, linkErrorMessage } from "@/lib/auth/linkOutcome";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;

  // Signup link failures now land on /confirm-email, with a resend form;
  // this still reads ?error= so a link outcome bookmarked or in history
  // before that change shows its copy (lib/auth/linkOutcome.ts).
  const initialError = linkErrorMessage(params.error);

  // Set by app/auth/confirm/route.ts when a Supabase default-template (code)
  // signup link confirmed the address but no session could open in this
  // browser — the email opened on another device. Success: the user did
  // everything right and just needs to log in.
  const notice = params.notice === "email_confirmed" ? EMAIL_CONFIRMED_NOTICE : undefined;

  // Set by the idle sign-out (components/IdleTimeout.tsx). Says what
  // happened: a bare login form after a timeout reads as the app losing
  // the session. Neutral -- it's housekeeping, not an error.
  const timedOut = params.reason === "timeout";

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold text-ink">Log in</h1>

      {notice ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-hairline bg-surface-raised px-4 py-3">
          <InboxIcon className="mt-0.5 h-5 w-5 shrink-0 text-action" aria-hidden="true" />
          <p className="text-sm text-ink-secondary">{notice}</p>
        </div>
      ) : null}

      {timedOut ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-hairline bg-surface-raised px-4 py-3">
          <InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
          <p role="status" className="text-sm text-ink-secondary">
            {timeoutNotice()}
          </p>
        </div>
      ) : null}

      <LoginForm initialError={initialError} />
    </>
  );
}
