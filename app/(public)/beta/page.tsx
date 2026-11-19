import type { Metadata } from "next";
import { BetaApplicationForm } from "@/components/BetaApplicationForm";

// The beta tester application (docs/Beta-Application.md). Public -- in the
// proxy's PUBLIC_PATHS, and in AUTH_REDIRECT_PATHS, so a signed-in visitor
// goes to the dashboard as they do from "/". No account is needed and
// nothing here signs anyone up. Static: nothing reads a session.
export const metadata: Metadata = {
  title: "Become a beta tester · Sorrel",
  description:
    "Help shape Sorrel before it launches. A short application, every answer but your name and email a tap.",
};

const TAG =
  "inline-flex items-center rounded-full border border-hairline bg-surface px-3 py-1 text-sm text-ink-secondary";

export default function BetaPage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <BetaApplicationForm
        intro={
          <header className="flex flex-col gap-5">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-balance text-ink sm:text-4xl">
                Become a Sorrel beta tester
              </h1>
              <p className="mt-2 text-lg text-ink-secondary italic">Help us grow.</p>
            </div>
            <div className="space-y-4 text-base leading-relaxed text-ink-secondary">
              <p>
                We&rsquo;re expanding our beta community and looking for{" "}
                <strong className="font-semibold text-ink">30–50 more people</strong> to try
                Sorrel before it launches. Whether you&rsquo;re just starting to budget, running a
                household, or already have a routine, we&rsquo;d love your help.
              </p>
              <p>You&rsquo;ll get early access and a real say in how Sorrel turns out.</p>
            </div>
            <ul className="flex flex-wrap gap-2" aria-label="At a glance">
              <li className={TAG}>About 3–4 weeks</li>
              <li className={TAG}>You must be 18 or older</li>
            </ul>
          </header>
        }
      />
    </div>
  );
}
