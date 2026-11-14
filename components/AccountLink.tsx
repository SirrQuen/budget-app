import Link from "next/link";
import { ChevronRightIcon } from "@/components/ui/icons";

/**
 * An account's name as the door to its page (/accounts/[id]). The NAME is the
 * link -- never a whole row that holds buttons, which nests interactive
 * elements. Visibly a link at rest (the chevron), underlined and nudged on
 * hover, a focus ring on Tab. One component so every place an account name
 * opens its page looks and behaves the same.
 *
 * `nameClassName` shapes the name only: "truncate" in a tight row, or
 * "break-words sm:truncate" where it may wrap on a phone.
 */
export function AccountLink({
  accountId,
  children,
  className = "text-ink",
  nameClassName = "truncate",
}: {
  accountId: string;
  children: React.ReactNode;
  /** The link's own text colour. */
  className?: string;
  nameClassName?: string;
}) {
  return (
    <Link
      href={`/accounts/${accountId}`}
      className={`group/account inline-flex min-w-0 max-w-full items-center gap-0.5 rounded underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${className}`}
    >
      <span className={`min-w-0 group-hover/account:underline ${nameClassName}`}>{children}</span>
      <ChevronRightIcon
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-ink-muted transition-transform duration-150 group-hover/account:translate-x-0.5 group-hover/account:text-ink motion-reduce:transition-none motion-reduce:group-hover/account:translate-x-0"
      />
    </Link>
  );
}
