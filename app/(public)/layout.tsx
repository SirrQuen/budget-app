import Link from "next/link";
import { SorrelMark } from "@/components/SorrelMark";
import { Wordmark } from "@/components/Wordmark";
import { LegalLinks } from "@/components/legal/LegalLinks";

// Public documents, readable signed out (both paths are in the proxy's
// PUBLIC_PATHS). Static: nothing here reads a session, so the pages
// prerender at build time.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-hairline">
        <div className="mx-auto flex w-full max-w-[68ch] items-center px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 rounded text-lg font-semibold tracking-tight text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page"
          >
            {/* The wordmark names the link; the mark's own label would repeat it. */}
            <span aria-hidden="true">
              <SorrelMark size={28} className="h-7 w-7" />
            </span>
            <Wordmark />
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4 py-12 sm:px-6 sm:py-16">{children}</main>

      <footer className="border-t border-hairline">
        <div className="mx-auto w-full max-w-[68ch] px-4 py-6 sm:px-6">
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
}
