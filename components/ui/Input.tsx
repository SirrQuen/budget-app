// The one field style. Every text input, select and date field in the app
// takes its edge from here -- a form never restates it.
//
// --field-border, not --hairline: a field's edge is how you find the field,
// so it must clear 3:1 against every ground it can sit on (WCAG 1.4.11).
// --hairline is a decorative divider at ~1.3:1 and can't.
//
// Focus is a solid --action border plus a solid 2px --action ring. A
// translucent ring (the old ring-action/40) read 2.05-2.58:1 and leaned on
// the border to pass -- two sub-threshold signals don't make one that clears.
export const FIELD_EDGE =
  "rounded-lg border border-field-border outline-none transition-colors focus:border-action focus:ring-2 focus:ring-action";

/** A full-width field on a raised surface -- the default for forms. */
export const FIELD_CLASS = `w-full ${FIELD_EDGE} bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-muted`;

export function Input({
  className = "",
  ref,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} {...props} className={`${FIELD_CLASS} disabled:opacity-50 ${className}`} />;
}
