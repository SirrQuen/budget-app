import Link from "next/link";

export default function AccountDeletedPage() {
  return (
    <>
      <h1 className="mb-3 text-2xl font-semibold text-ink">Your account is gone</h1>
      <p className="text-sm text-ink-secondary">
        We&rsquo;ve permanently deleted your account and everything in it. There is no backup and
        nothing to undo.
      </p>
      <p className="mt-4 text-sm text-ink-secondary">
        You&rsquo;re welcome back any time —{" "}
        <Link
          href="/signup"
          className="rounded text-ink transition-colors duration-150 hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          create a new account
        </Link>
        .
      </p>
    </>
  );
}
