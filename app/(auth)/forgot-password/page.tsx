import { ForgotPasswordForm } from "./forgot-password-form";
import { linkErrorMessage } from "@/lib/auth/linkOutcome";

export default async function ForgotPasswordPage({
  searchParams,
}: PageProps<"/forgot-password">) {
  // Set by app/auth/confirm/route.ts when a reset link didn't open; the form
  // below is the next step either way.
  const initialError = linkErrorMessage((await searchParams).error);

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold text-ink">Reset your password</h1>
      <ForgotPasswordForm initialError={initialError} />
    </>
  );
}
