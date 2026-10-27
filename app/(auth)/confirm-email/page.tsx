import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { isRecoveryLink, readOtpLink } from "@/lib/auth/confirmLink";
import { LINK_ERRORS, linkErrorMessage } from "@/lib/auth/linkOutcome";
import { ResendConfirmationForm } from "./resend-form";
import { BrowserTimeZoneField } from "@/components/BrowserTimeZoneField";

const TEXT_LINK =
  "rounded text-ink underline underline-offset-2 transition-colors duration-150 hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

// The interstitial for an emailed token_hash link (app/auth/confirm/route.ts
// forwards every such GET here). Rendering it spends nothing: the token is
// only verified when the button POSTs it back to /auth/confirm. Link
// scanners and preview fetchers GET this page and leave; a person presses
// the button.
//
// Without a usable link -- or after a POST that failed -- it says what
// happened and offers a new link.
export default async function ConfirmEmailPage({ searchParams }: PageProps<"/confirm-email">) {
  const params = await searchParams;
  const link = readOtpLink({
    get: (name) => {
      const value = params[name];
      return typeof value === "string" ? value : null;
    },
  });

  if (link) {
    const recovery = isRecoveryLink(link.type, link.next);
    return (
      <>
        <h1 className="mb-6 text-2xl font-semibold text-ink">
          {recovery ? "Reset your password" : "Confirm your email"}
        </h1>
        <form method="post" action="/auth/confirm" className="flex flex-col gap-6">
          <input type="hidden" name="token_hash" value={link.tokenHash} />
          <input type="hidden" name="type" value={link.type} />
          <input type="hidden" name="next" value={link.next} />
          {/* The user's day for the welcome, before their settings have a zone. */}
          <BrowserTimeZoneField />
          <p className="text-sm text-ink-secondary">
            {recovery
              ? "Continue to choose a new password."
              : "One tap and you're in. This signs you in on this device."}
          </p>
          <Button type="submit" className="w-full">
            {recovery ? "Continue" : "Confirm and sign in"}
          </Button>
        </form>
      </>
    );
  }

  const message = linkErrorMessage(params.error) ?? LINK_ERRORS.link_incomplete;

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold text-ink">Confirm your email</h1>
      <div className="flex flex-col gap-6">
        <ErrorMessage message={message} />
        <ResendConfirmationForm />
        <p className="text-center text-sm text-ink-secondary">
          Already confirmed?{" "}
          <Link href="/login" className={TEXT_LINK}>
            Log in
          </Link>
        </p>
      </div>
    </>
  );
}
