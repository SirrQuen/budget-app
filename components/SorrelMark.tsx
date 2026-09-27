type SorrelMarkProps = {
  size?: number;
  className?: string;
  // "folded" is the closing-umbrella silhouette (see .sorrel-mark in
  // app/globals.css). Changing the prop is the whole animation -- the
  // transition lives in CSS, so every caller gets the same fold.
  // "looping" folds and reopens continuously -- the loading indicator
  // (components/SorrelLoader.tsx); reduced motion holds it open.
  state?: "open" | "folded" | "looping";
};

const PETAL =
  "M 50 50 C 44 36, 24 32, 24 18 C 24 8, 36 2, 44 8 C 47 10, 48.5 12, 50 16 C 51.5 12, 53 10, 56 8 C 64 2, 76 8, 76 18 C 76 32, 56 36, 50 50 Z";

export function SorrelMark({ size = 24, className, state = "open" }: SorrelMarkProps) {
  const stateClass = state === "open" ? "" : `sorrel-mark--${state}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="currentColor"
      role="img"
      aria-label="Sorrel"
      className={`${stateClass} ${className ?? ""}`}
      // --mark is the one place the mark red lives, and it is theme-scoped
      // (see app/globals.css). Set here rather than left to callers so the
      // mark can't be recoloured, and no caller needs a colour utility for it.
      style={{ color: "var(--mark)" }}
    >
      {/* Each leaflet's 0/120/240 rotation is in CSS, not a transform
          attribute, so open and folded interpolate as one transform list. */}
      <g className="sorrel-leaves">
        <path className="sorrel-leaf sorrel-leaf--1" d={PETAL} />
        <path className="sorrel-leaf sorrel-leaf--2" d={PETAL} />
        <path className="sorrel-leaf sorrel-leaf--3" d={PETAL} />
      </g>
    </svg>
  );
}
