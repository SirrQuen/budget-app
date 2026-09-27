import { SorrelMark } from "@/components/SorrelMark";
import { Wordmark } from "@/components/Wordmark";

export function AuthBrandPanel() {
  return (
    // Splash tokens, not page/ink: this panel stays on the brand navy in
    // both themes, so the mark inside it takes --mark-on-dark rather than
    // following the theme: the mark follows its ground. See --splash in
    // app/globals.css.
    <div className="flex flex-col items-center justify-center gap-4 bg-splash px-6 py-10 text-center [--mark:var(--mark-on-dark)] md:w-2/5 md:shrink-0 md:gap-6 md:px-12 md:py-16">
      <SorrelMark size={112} className="h-14 w-14 md:h-28 md:w-28" />
      <div>
        <p className="text-lg font-semibold tracking-tight text-splash-ink md:text-3xl">
          <Wordmark tm />
        </p>
        <p className="mt-2 text-sm text-splash-ink-secondary md:mt-3 md:text-base">
          Grows in any soil.
        </p>
      </div>
    </div>
  );
}
