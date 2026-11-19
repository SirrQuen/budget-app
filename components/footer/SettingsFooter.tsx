import Link from "next/link";
import { SocialLinks } from "@/components/footer/SocialLinks";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal";

// In the app, a slim row at the bottom of Settings: the social icons,
// Privacy and Terms. Nothing else -- the public footer's link groups and
// contact address are for people who haven't signed in.

const LINK =
  "inline-flex min-h-11 items-center rounded px-1 text-ink-secondary transition-colors duration-150 hover:text-ink hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page";

export function SettingsFooter() {
  return (
    <footer className="flex flex-col gap-1 border-t border-hairline pt-3 sm:flex-row sm:items-center sm:justify-between">
      <SocialLinks className="-ml-2.5" />
      <nav aria-label="Legal" className="text-sm">
        <ul className="flex items-center gap-4">
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
      </nav>
    </footer>
  );
}
