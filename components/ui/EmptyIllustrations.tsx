// The small drawings for empty states (docs/Motion-and-Delight.md, step 4).
// Inline SVG, drawn in the ink tokens with one gold leaf of chrome, so they
// follow the theme. Each sways gently (+-4deg over 6s -- see .empty-sway in
// globals.css); under reduced motion it holds still. Decorative: the
// heading and the sentence carry the meaning.

const FRAME = "h-20 w-20";

// Goals: a seed in soil, one shoot.
export function SeedIllustration({ className = FRAME }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={`empty-sway ${className}`} fill="none" aria-hidden="true">
      <path d="M12 64c8-6 18-8 28-8s20 2 28 8" stroke="var(--ink-muted)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M22 70h36" stroke="var(--ink-muted)" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      <ellipse cx="40" cy="58" rx="6" ry="4" fill="var(--ink-muted)" opacity="0.55" />
      <path d="M40 54V34" stroke="var(--ink-secondary)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M40 38c0-8 6-13 14-13 0 8-6 13-14 13Z" fill="var(--gold)" />
    </svg>
  );
}

// Transactions: a two-leaf sprout.
export function SproutIllustration({ className = FRAME }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={`empty-sway ${className}`} fill="none" aria-hidden="true">
      <path d="M16 66h48" stroke="var(--ink-muted)" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      <path d="M40 66V38" stroke="var(--ink-secondary)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M40 46c-1-9-8-14-17-14 0 9 7 14 17 14Z" fill="var(--gold)" />
      <path d="M40 40c1-9 8-14 17-14 0 9-7 14-17 14Z" fill="var(--ink-secondary)" opacity="0.75" />
    </svg>
  );
}

// Search, no results: a magnifier with a leaf.
export function SearchLeafIllustration({ className = FRAME }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={`empty-sway ${className}`} fill="none" aria-hidden="true">
      <circle cx="35" cy="35" r="18" stroke="var(--ink-secondary)" strokeWidth="3" />
      <path d="m48.5 48.5 15 15" stroke="var(--ink-secondary)" strokeWidth="4" strokeLinecap="round" />
      <path d="M43 26c-9 0-15 5-15 12 0 2 .6 3.6 1.6 5C38 43 44 36 43 26Z" fill="var(--gold)" />
    </svg>
  );
}
