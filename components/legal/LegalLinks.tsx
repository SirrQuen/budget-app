import Link from "next/link";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal";

// The footer pair, shared by the public legal pages and the auth screens.
// `ring` is the surface the links sit on, so the focus ring's offset matches it.
export function LegalLinks({ ring = "page" }: { ring?: "page" | "surface" }) {
  const link = `rounded transition-colors duration-150 hover:text-ink hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 ${
    ring === "page" ? "focus-visible:ring-offset-page" : "focus-visible:ring-offset-surface"
  }`;
  return (
    <nav aria-label="Legal">
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-muted">
        <li>
          <Link href={PRIVACY_PATH} className={link}>
            Privacy Policy
          </Link>
        </li>
        <li>
          <Link href={TERMS_PATH} className={link}>
            Terms of Service
          </Link>
        </li>
      </ul>
    </nav>
  );
}
