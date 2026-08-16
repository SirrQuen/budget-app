import { InboxIcon } from "@/components/ui/icons";

export function EmptyState({
  icon,
  heading,
  message,
  action,
}: {
  icon?: React.ReactNode;
  heading: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-gridline bg-surface px-6 py-12 text-center">
      <div className="text-ink-muted" aria-hidden="true">
        {icon ?? <InboxIcon className="h-10 w-10" />}
      </div>
      <h2 className="text-lg font-semibold text-ink">{heading}</h2>
      <p className="max-w-sm text-sm text-ink-secondary">{message}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
