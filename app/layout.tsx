import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EverNest Finance",
  description: "Your wealth, your legacy.",
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "EverNest Finance",
    description: "Your wealth, your legacy.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The inline script below sets data-theme before React hydrates, so
      // the client tree always has an attribute the server tree doesn't --
      // React reports that as a mismatch and, in its words, won't patch it
      // up. Suppressing is the intended escape hatch for a deliberate
      // pre-hydration mutation: it covers this element's own attributes
      // only (one level, not the subtree), which is exactly the scope of
      // the discrepancy.
      //
      // Rendering data-theme on the server instead would not work: the
      // root layout is public, so it has no session to read a theme from,
      // and "system" is expressly the absence of the attribute.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-page text-ink">
        {/*
          Sets data-theme from the localStorage mirror synchronously, as the
          first thing in the body, so the right palette is resolved before
          any of it paints -- otherwise a Dark user gets a white flash on
          every cold load. It has to be inline and blocking for that; a
          deferred or hydrated script runs a frame too late.

          Next's docs say not to hand-roll <head> in a root layout, so it
          sits here instead: still parsed and executed before any sibling
          below it renders.

          Not user input -- THEME_SCRIPT is a module constant with the
          storage key JSON-escaped into it, so there is nothing here for a
          caller to inject.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
