export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink-secondary">
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="text-ink-muted">
              {" "}
              *
            </span>
            <span className="sr-only"> required</span>
          </>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-critical">{error}</p>
      ) : hint ? (
        <p className="text-sm text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}
