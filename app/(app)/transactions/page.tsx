import { PageHeader } from "@/components/ui/PageHeader";
import { TransactionsView } from "./TransactionsView";

export default async function TransactionsPage({
  searchParams,
}: PageProps<"/transactions">) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Transactions" description="Every dollar in and out, newest first." />
      <TransactionsView searchParams={params} basePath="/transactions" />
    </div>
  );
}
