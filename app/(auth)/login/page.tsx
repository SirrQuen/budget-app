import { InboxIcon } from "@/components/ui/icons";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;

  const initialError =
    params.error === "confirmation_failed"
      ? "That confirmation link didn't work — it may be expired or already used. Try logging in below; your email may already be confirmed."
      : undefined;

  // Set by app/auth/confirm/route.ts when a signup token was already spent —
  // usually because a mail-provider link scanner confirmed the address before
  // the user clicked. Nothing is wrong; they just need to log in.
  const notice =
    params.notice === "email_confirmed"
      ? "Your email is confirmed. Please log in."
      : undefined;

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
