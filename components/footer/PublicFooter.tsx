import Link from "next/link";
import { SorrelMark } from "@/components/SorrelMark";
import { Wordmark } from "@/components/Wordmark";
import { SocialLinks } from "@/components/footer/SocialLinks";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal";

// The footer of every public page: the landing page, /beta, privacy and
// terms. Static -- nothing here reads a session. Stacks on a phone; the
// groups sit in a row from 640px. The app's own footer is the slim row at
// the bottom of Settings (components/footer/SettingsFooter.tsx).

const LINK =
  "rounded text-ink-secondary transition-colors duration-150 hover:text-ink hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page";

export const CONTACT_EMAIL = "hello@mysorrel.com";

export function PublicFooter() {
  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
              {/* The wordmark names the brand; the mark's own label would repeat it. */}
              <span aria-hidden="true">
                <SorrelMark size={28} className="h-7 w-7" />
              </span>
              <Wordmark />
            </p>
            <p className="text-sm text-ink-secondary">Know what&rsquo;s safe to spend</p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-1 gap-6 text-sm sm:grid-cols-3 sm:gap-10">
            <div>
              <h2 className="font-medium text-ink">Sorrel</h2>
              <ul className="mt-2 flex flex-col gap-2">
                <li>
                  <Link href="/#waitlist" className={LINK}>
                    Join the waitlist
                  </Link>
                </li>
                <li>
                  <Link href="/beta" className={LINK}>
                    Become a beta tester
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="font-medium text-ink">Legal</h2>
              <ul className="mt-2 flex flex-col gap-2">
                <li>
                  <Link href={PRIVACY_PATH} className={LINK}>
                    Privacy
                  </Link>
                </li>
                <li>
                  <Link href={TERMS_PATH} className={LINK}>
                    Terms
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="font-medium text-ink">Contact</h2>
              <ul className="mt-2 flex flex-col gap-2">
                <li>
                  <a href={`mailto:${CONTACT_EMAIL}`} className={`${LINK} break-all`}>
                    {CONTACT_EMAIL}
                  </a>
                </li>
              </ul>
            </div>
          </nav>
        </div>

        <div className="flex flex-col gap-3 border-t border-hairline pt-6 sm:flex-row sm:items-center sm:justify-between">
          <SocialLinks className="-ml-2.5" />
          <p className="text-sm text-ink-secondary">&copy; 2026 MW Cyber Architects LLC &middot; Sorrel&trade;</p>
        </div>
      </div>
    </footer>
  );
}
