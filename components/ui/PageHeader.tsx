export function PageHeader({
  title,
  description,
  descriptionAdornment,
  descriptionAfter,
  action,
}: {
  title: string;
  description?: string;
  /** Decoration beside the description (the dashboard's seasonal leaf). */
  descriptionAdornment?: React.ReactNode;
  /** Beside the description, after it (the dashboard's "Your Sorrel" link). */
  descriptionAfter?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-hairline pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {/* Focusable by script only: where focus lands when the thing that
            had it is removed (a deleted row -- see ConfirmDialog returnFocus). */}
        <h1 id="page-title" tabIndex={-1} className="text-2xl font-semibold text-ink focus:outline-none">
          {title}
        </h1>
        {description ? (
          descriptionAdornment || descriptionAfter ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              {descriptionAdornment}
              <p className="text-sm text-ink-secondary">{description}</p>
              {descriptionAfter}
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink-secondary">{description}</p>
          )
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
