import Link from "next/link";
import type { OverdueOccurrence } from "@/lib/safeToSpendProjection";
import { formatDateShort } from "@/lib/format";

export const INLINE_ACTION =
  "rounded text-xs font-medium text-ink underline underline-offset-2 transition-colors duration-150 hover:text-ink-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50";

/** Where every "confirm it" points: the one confirmation queue on the dashboard. */
export const CONFIRM_QUEUE_HREF = "/dashboard#to-confirm";

// A paycheck the projection left out because its latest possible date
// passed without a confirmation. The maths is right to drop it (counting
// money that probably isn't coming over-promises); the user still needs to
// see why the figure is lower than they expect. It stays in the
// confirmation queue, so a late paycheck that does land is one tap away.
// One wording, shared by the hero's breakdown and the Upcoming list.
//
// The schedule's name stands alone -- never name + "paycheck": a schedule
// called "Paycheck" would read "Paycheck paycheck".
export function UnconfirmedIncomeNote({ item }: { item: OverdueOccurrence }) {
  return (
    <>
      Your {formatDateShort(item.dueDate)} {item.name} hasn&apos;t been confirmed, so it isn&apos;t
      counted.{" "}
      <Link href={CONFIRM_QUEUE_HREF} className={INLINE_ACTION}>
        Confirm it
      </Link>
    </>
  );
}

// An outflow past its due date that nobody has confirmed. Still counted --
// today -- because it hasn't been cancelled, just not answered.
export function UnconfirmedObligationNote({ item }: { item: OverdueOccurrence }) {
  return (
    <>
      {item.name} was due {formatDateShort(item.dueDate)}, so it&apos;s counted today.{" "}
      <Link href={CONFIRM_QUEUE_HREF} className={INLINE_ACTION}>
        Confirm it
      </Link>
    </>
  );
}
