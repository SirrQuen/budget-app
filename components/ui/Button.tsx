const variantClass = {
  primary: "bg-gold text-gold-ink hover:bg-gold-hover active:bg-gold-pressed",
  critical: "bg-critical text-white hover:bg-critical/90",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "critical" }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantClass[variant]} ${className}`}
    />
  );
}
