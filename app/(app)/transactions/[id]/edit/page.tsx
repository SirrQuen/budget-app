import Link from "next/link";
import { notFound } from "next/navigation";
import { getTransaction, type TransactionType, type TransactionWithRelations } from "@/lib/db/transactions";
import { listCategoriesForType, getCategory } from "@/lib/db/categories";
import { listAccounts, getAccount } from "@/lib/db/accounts";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletIcon } from "@/components/ui/icons";
import { AddTransactionForm } from "../../AddTransactionForm";
import { DeleteTransactionButton } from "../../DeleteTransactionButton";

// transactions_category_required (see 07_transfers.sql) guarantees categoryid
// is non-null whenever transfer_group_id is null. Narrowing on that basis
// here means every downstream read of tx.categoryid is checked by the
// compiler instead of relying on a one-off assertion.
function isNonTransfer(
  tx: TransactionWithRelations,
): tx is TransactionWithRelations & { categoryid: string; transfer_group_id: null } {
  return tx.transfer_group_id === null;
}

export default async function EditTransactionPage({
  params,
}: PageProps<"/transactions/[id]/edit">) {
  const { id } = await params;

  const transactionResult = await getTransaction(id);
  // .single() errors on zero rows -- indistinguishable here from "belongs
  // to another user" (RLS) and "no such id". Both mean the same thing to
  // this viewer: there's nothing here for them to edit.
  if (transactionResult.error !== null) {
    notFound();
  }
  const tx = transactionResult.data;

  // A transfer is two linked legs, not one transaction -- there's no
  // per-leg edit flow yet, so point back at the list instead of rendering a
  // form that would only ever touch one side of the pair.
  if (!isNonTransfer(tx)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Edit transaction" />
        <EmptyState
          icon={<WalletIcon className="h-10 w-10" />}
          heading="This is a transfer"
          message="Transfers move money between two accounts as a linked pair, so there's nothing to edit here yet. Delete it and re-log the transfer if the details were wrong."
          action={
            <Link
              href="/transactions"
              className="rounded text-sm font-medium text-action transition-colors duration-150 hover:text-action-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Back to transactions
            </Link>
          }
        />
      </div>
    );
  }

  const [incomeCategoriesResult, expenseCategoriesResult, accountsResult] = await Promise.all([
    listCategoriesForType("Income"),
    listCategoriesForType("Expense"),
    listAccounts({ is_active: true }),
  ]);

  if (
    incomeCategoriesResult.error !== null ||
    expenseCategoriesResult.error !== null ||
    accountsResult.error !== null
  ) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Edit transaction" />
        <ErrorMessage
          message={
            incomeCategoriesResult.error ??
            expenseCategoriesResult.error ??
            accountsResult.error ??
            "Failed to load the form."
          }
        />
      </div>
    );
  }

  let incomeCategories = incomeCategoriesResult.data;
  let expenseCategories = expenseCategoriesResult.data;
  const accounts = accountsResult.data;

  // This transaction's category or account may have been archived since it
  // was logged. Archived rows don't appear in the active-only lists above
  // -- if the current one is missing, fetch it and splice it back in so the
  // picker still shows it (marked archived) as the selected value, instead
  // of the picker silently defaulting away from it on save.
  const currentTypeCategories = tx.transaction_type === "Income" ? incomeCategories : expenseCategories;
  if (!currentTypeCategories.some((c) => c.id === tx.categoryid)) {
    const categoryResult = await getCategory(tx.categoryid);
    if (categoryResult.error === null) {
      if (tx.transaction_type === "Income") {
        incomeCategories = [...incomeCategories, categoryResult.data];
      } else {
        expenseCategories = [...expenseCategories, categoryResult.data];
      }
    }
  }

  let accountsWithCurrent = accounts;
  if (!accounts.some((a) => a.id === tx.accountid)) {
    const accountResult = await getAccount(tx.accountid);
    if (accountResult.error === null) {
      accountsWithCurrent = [...accounts, accountResult.data];
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Edit transaction" description="Update the details of this transaction." />
      <AddTransactionForm
        mode="edit"
        initialValues={{
          id: tx.id,
          transaction_date: tx.transaction_date,
          description: tx.description,
          amount: tx.amount,
          transaction_type: tx.transaction_type as TransactionType,
          categoryid: tx.categoryid,
          accountid: tx.accountid,
          merchant: tx.merchant,
          notes: tx.notes,
          payment_method: tx.payment_method,
        }}
        incomeCategories={incomeCategories}
        expenseCategories={expenseCategories}
        accounts={accountsWithCurrent}
      />

      <div className="self-start">
        <DeleteTransactionButton
          id={tx.id}
          description={tx.description}
          amount={tx.amount}
          transactionType={tx.transaction_type as TransactionType}
          transactionDate={tx.transaction_date}
          redirectToList={true}
          label="Delete transaction"
        />
      </div>
    </div>
  );
}
