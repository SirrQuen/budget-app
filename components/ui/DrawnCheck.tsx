import { useId } from "react";

// A check whose stroke draws itself in 250ms: the stroke is masked by a bar
// that grows left to right (a scaleX -- transform only, rule 8). At rest,
// and under reduced motion, it is simply a check. Decorative: the words
// beside it ("Saved") carry the meaning.
export function DrawnCheck({ className = "h-4 w-4" }: { className?: string }) {
  const maskId = useId();
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">
        <rect className="drawn-check-bar" x="0" y="0" width="16" height="16" fill="#fff" />
      </mask>
      <path
        d="M3 8.5 6.5 12 13 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}
