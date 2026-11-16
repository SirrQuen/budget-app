// A small leaf: the one shape the save reaction and "First one today" share.
// Filled with the colour of the text it sits in (currentColor).
export function LeafIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
      <path d="M13.5 2.5C7.5 2.5 3 5.2 3 9.4c0 1.1.4 2 1 2.7L2.6 13.5l1 .6 1.4-1.4c.7.4 1.5.6 2.4.6 4 0 6.1-4 6.1-10.8Z" />
    </svg>
  );
}
