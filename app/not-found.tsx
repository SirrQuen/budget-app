import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-page px-6 py-16 text-center text-ink">
      <div className="flex max-w-sm flex-col gap-2">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-sm text-ink-secondary">
          This page doesn&rsquo;t exist, or it has moved.
        </p>
      </div>

      <Link
        href="/dashboard"
        className="inline-flex items-center justify-center rounded-full bg-action px-4 py-2 text-sm font-semibold text-action-ink transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-action-hover hover:shadow-md active:translate-y-0 active:scale-[0.97] active:bg-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page"
      >
        Back to dashboard
      </Link>
    </main>
  );
}
