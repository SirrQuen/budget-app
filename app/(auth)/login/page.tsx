import { InboxIcon } from "@/components/ui/icons";
import { LoginForm } from "./login-form";
import { EMAIL_CONFIRMED_NOTICE, linkErrorMessage } from "@/lib/auth/linkOutcome";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;

  // Set by app/auth/confirm/route.ts when a signup link didn't sign the user
  // in; the copy names only what the route knows (lib/auth/linkOutcome.ts).
  const initialError = linkErrorMessage(params.error);

  // Set by app/auth/confirm/route.ts when the signup link confirmed the
  // address but no session could open in this browser — the email opened on
  // another device, or a mail scanner spent the token first. Success: the
  // user did everything right and just needs to log in.
  const notice = params.notice === "email_confirmed" ? EMAIL_CONFIRMED_NOTICE : undefined;

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold text-ink">Log in</h1>

      {notice ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-hairline bg-surface-raised px-4 py-3">
          <InboxIcon className="mt-0.5 h-5 w-5 shrink-0 text-action" aria-hidden="true" />
          <p className="text-sm text-ink-secondary">{notice}</p>
        </div>
      ) : null}

      <LoginForm initialError={initialError} />
    </>
  );
}
