"use client";

import { useEffect } from "react";
import { markPageReady } from "@/lib/welcomeSignals";

/**
 * Rendered by a page once its data has landed -- it sits inside the
 * streamed content, so it can't mount any earlier -- to tell the daily
 * welcome (components/WelcomeBloom.tsx) the page behind it is ready.
 * Renders nothing.
 */
export function WelcomeReady() {
  useEffect(() => {
    markPageReady();
  }, []);
  return null;
}
