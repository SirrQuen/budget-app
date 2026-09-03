const variantClass = {
  primary: "bg-action text-action-ink hover:bg-action-hover active:bg-action-pressed",
  critical: "bg-critical text-critical-ink hover:bg-critical/90 active:bg-critical",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "critical" }) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${variantClass[variant]} ${className}`}
    />
  );
}
