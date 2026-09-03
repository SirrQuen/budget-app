import { cloneElement, isValidElement, useId } from "react";

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
  const generatedId = useId();
  const hintId = `${generatedId}-hint`;
  const errorId = `${generatedId}-error`;

  // The message that's actually shown drives what the control points at:
  // an error replaces the hint (see the render below), so describe the
  // control with whichever one is visible -- never a stale id.
  const describedBy = error ? errorId : hint ? hintId : undefined;

  // Wire aria-describedby / aria-invalid straight onto the control the
  // caller passed, so a screen reader reads the error or hint when focus
  // lands. Callers just drop an <Input>/<select> in as the child -- they
  // don't repeat the id plumbing at every field. Any aria-describedby the
  // child already carries is preserved and merged.
  const enhancedChildren = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        "aria-invalid": error ? true : (children.props as Record<string, unknown>)["aria-invalid"],
        "aria-describedby":
          [(children.props as Record<string, unknown>)["aria-describedby"], describedBy]
            .filter(Boolean)
            .join(" ") || undefined,
      })
    : children;

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
      {enhancedChildren}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-critical">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
