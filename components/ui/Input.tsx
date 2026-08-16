export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-muted outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/40 disabled:opacity-50 ${className}`}
    />
  );
}
