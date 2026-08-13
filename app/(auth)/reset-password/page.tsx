import Link from "next/link";
import { getUser } from "@/lib/auth/dal";
import { ResetPasswordForm } from "./reset-password-form";

// Reachable only via the recovery link from app/auth/confirm/route.ts, which
// calls verifyOtp(type: "recovery") and establishes a session before
// redirecting here. No session means the link was invalid, expired, or
// already used.
export default async function ResetPasswordPage() {
  const user = await getUser();

  if (!user) {
    return (
      <>
        <h1 className="mb-4 text-xl font-semibold">Link expired</h1>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          This password reset link is invalid or has expired.{" "}
          <Link href="/forgot-password" className="underline">
            Request a new one
          </Link>
          .
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Set a new password</h1>
      <ResetPasswordForm />
    </>
  );
}
