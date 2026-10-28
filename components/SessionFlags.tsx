"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";
import { SIGNED_IN_COOKIE } from "@/lib/auth/signedInFlag";
import { clearCookieScript } from "@/lib/welcome";
import { dropSignInFold, isWelcomeActive, offerSignInFold } from "@/lib/welcomeSignals";

/**
 * Consumes the two one-shot sign-in cookies, in one place: the
 * authenticated layout, which renders on every app page -- unlike the
 * dashboard flower, which an empty-state dashboard never mounts, and which
 * used to leave the sign-in flag behind for a later dashboard.
 *
 * The server already read both cookies (app/(app)/layout.tsx) and passed
 * what they said; this deletes them as the layout mounts, so a refresh or
 * a later render can't replay either. The sign-in fold is offered to
 * DayNightMark only when no welcome bloom plays: the bloom supersedes it.
 * Renders nothing.
 */
export function SessionFlags({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const landing = useRef<string | null>(null);

  // A layout effect: done before the first paint after mount, and before
  // DayNightMark's first frame reads the fold.
  useLayoutEffect(() => {
    if (landing.current !== null) return;
    landing.current = pathname;
    // The welcome host (root layout) has decided by now: it renders before
    // the page content, and for A it was told before the login form
    // navigated.
    offerSignInFold(signedIn && !isWelcomeActive(), pathname);
    if (signedIn) document.cookie = clearCookieScript(SIGNED_IN_COOKIE);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the landing render
  }, []);

  useEffect(() => {
    if (landing.current !== null && pathname !== landing.current) dropSignInFold();
  }, [pathname]);

  return null;
}
