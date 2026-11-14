import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonClass } from "@/components/ui/Button";
import { parseTransactionFilters } from "@/lib/transactionFilters";
import { TransactionsView } from "./TransactionsView";

export default async function TransactionsPage({
  searchParams,
}: PageProps<"/transactions">) {
  const params = await searchParams;
  // The same import flow as Settings > Import, not a second one. Filtered to
  // exactly one account, that account is preselected; otherwise the person
  // picks. `from` only decides where "Back" goes.
  const { accountid } = parseTransactionFilters(params);
  const importHref = accountid ? `/import?account=${accountid}&from=transactions` : "/import?from=transactions";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Transactions"
        description="Every dollar in and out, newest first."
        action={
          <Link href={importHref} className={buttonClass("primary")}>
            Import transactions
          </Link>
        }
      />
      <TransactionsView searchParams={params} basePath="/transactions" />
    </div>
  );
}
