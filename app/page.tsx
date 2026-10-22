import type { Metadata } from "next";
import Link from "next/link";
import { SorrelMark } from "@/components/SorrelMark";
import { Wordmark } from "@/components/Wordmark";
import { WaitlistForm } from "@/components/WaitlistForm";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal";

// What a stranger who types the domain sees. Not a marketing page: no feature
// list, no screenshots, no funnel -- it says what Sorrel is, takes an address
// for the one "it's open" email (components/WaitlistForm), and gives the
// legal links a home.
//
// Static: nothing here reads a session, so it prerenders at build time. A
// signed-in visitor never reaches it -- the proxy sends "/" to /dashboard
// (AUTH_REDIRECT_PATHS in lib/supabase/middleware.ts).
export const metadata: Metadata = {
  title: "Sorrel · Know what's safe to spend",
  description:
    "Sorrel looks ahead at the money coming in and the bills going out, finds the lowest point your balance will reach, and tells you what you can spend while keeping that low point above zero.",
};

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page";

const BUTTON = `inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2 text-sm font-semibold transition-all duration-150 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 ${FOCUS}`;

const FOOTER_LINK = `rounded transition-colors duration-150 hover:text-ink hover:underline underline-offset-2 ${FOCUS}`;

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 items-center px-4 py-12 sm:px-6 sm:py-20">
        <div className="mx-auto w-full max-w-xl">
          <div className="flex items-center gap-3">
            {/* The wordmark beside it names the brand; the mark's label would repeat it. */}
            <span aria-hidden="true">
              <SorrelMark size={48} className="h-12 w-12" />
            </span>
            <div>
              <p className="text-2xl font-semibold tracking-tight text-ink">
                <Wordmark tm />
              </p>
              <p className="text-sm text-ink-secondary">Built to Grow Through Any Season</p>
            </div>
          </div>

          <h1 className="mt-12 text-4xl font-bold tracking-tight text-balance text-ink sm:text-5xl">
            Know what&rsquo;s safe to spend
          </h1>

          <div className="mt-6 space-y-4 text-lg leading-relaxed text-ink-secondary">
            <p>
              Sorrel looks ahead at the money coming in and the bills going out, finds the
              lowest point your balance will reach, and tells you what you can spend while
              keeping that low point above zero.
            </p>
            <p>
              Most budgeting apps tell you what you&rsquo;ve spent. Sorrel tells you
              what&rsquo;s coming.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/login"
              className={`${BUTTON} bg-action text-action-ink hover:bg-action-hover active:bg-action-pressed`}
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className={`${BUTTON} border border-field-border text-ink hover:bg-surface-raised`}
            >
              Create account
            </Link>
          </div>

          <section
            aria-labelledby="waitlist-heading"
            className="mt-12 flex flex-col gap-4 rounded-xl border border-hairline bg-surface p-5"
          >
            <h2
              id="waitlist-heading"
              className="text-base leading-relaxed font-normal text-ink-secondary"
            >
              Sorrel is in private beta right now, so sign-ups are invite-only &mdash; but you
              can be first to know when it&rsquo;s live.
            </h2>
            <WaitlistForm />
          </section>
        </div>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto w-full max-w-xl px-4 py-6 sm:px-6">
          <ul className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-ink-muted">
            <li>
              <Link href={PRIVACY_PATH} className={FOOTER_LINK}>
                Privacy
              </Link>
            </li>
            <li aria-hidden="true">·</li>
            <li>
              <Link href={TERMS_PATH} className={FOOTER_LINK}>
                Terms
              </Link>
            </li>
            <li aria-hidden="true">·</li>
            <li>
              <a href="mailto:hello@mysorrel.com" className={`${FOOTER_LINK} break-all`}>
                hello@mysorrel.com
              </a>
            </li>
            <li aria-hidden="true">·</li>
            <li>&copy; 2026 MW Cyber Architects LLC</li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
