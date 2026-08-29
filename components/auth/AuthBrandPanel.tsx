import Image from "next/image";

export function AuthBrandPanel() {
  return (
    // Splash tokens, not page/ink: this panel stays on the brand navy in
    // both themes so the fixed-gold logo keeps its contrast. See --splash
    // in app/globals.css.
    <div className="flex flex-col items-center justify-center gap-4 bg-splash px-6 py-10 text-center md:w-2/5 md:shrink-0 md:gap-6 md:px-12 md:py-16">
      <Image src="/logo.svg" alt="" width={112} height={112} className="h-14 w-14 md:h-28 md:w-28" priority />
      <div>
        <p className="text-lg font-semibold tracking-tight text-splash-ink md:text-3xl">
          EverNest Finance
        </p>
        <p className="mt-2 text-sm text-splash-ink-secondary md:mt-3 md:text-base">
          Your wealth, your legacy.
        </p>
      </div>
    </div>
  );
}
