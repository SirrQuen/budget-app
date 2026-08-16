export function Celebration({
  show,
  message,
  icon,
}: {
  show: boolean;
  message: string;
  icon?: React.ReactNode;
}) {
  if (!show) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-full border border-good/30 bg-good/10 px-4 py-2 text-sm font-medium text-ink motion-safe:animate-[celebrate-pop_700ms_ease-out]"
    >
      <span className="text-good" aria-hidden="true">
        {icon ?? "✦"}
      </span>
      <span>{message}</span>
    </div>
  );
}
