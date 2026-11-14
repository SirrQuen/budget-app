import { notFound } from "next/navigation";
import {
  getScheduleSummary,
  getTransaction,
  getTransferForEdit,
  type TransactionType,
  type TransactionWithRelations,
} from "@/lib/db/transactions";
import { listCategoriesForType, getCategory } from "@/lib/db/categories";
import { listAccounts, getAccount } from "@/lib/db/accounts";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoadError } from "@/components/ui/LoadError";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletIcon } from "@/components/ui/icons";
import { AddTransactionForm, type TransactionAccountOption } from "../../AddTransactionForm";
import { TransferEditForm } from "./TransferEditForm";
import { DeleteTransactionButton } from "../../DeleteTransactionButton";
import { getDifferentBillAnswers, getSameBillDeletePreviews, getSameBillPairs } from "@/lib/db/sameBill";
import { sameBillDeleteNote } from "@/lib/sameBill";
import { DifferentBillNote, SameBillQuestion } from "@/components/SameBillQuestion";

// "Is this the same bill?" on the entry's own screen (migration 66): the
// open question if this entry pairs with a schedule's next occurrence,
// every "No, keep both" read back with a way to change it, and what a
// delete will do to a "Yes". `entryId` is the row answers are stored on
// (a transfer's Expense leg); `ids` every leg. A failed read loses only
// the question or the note -- the delete trigger still restores when it
// can.
async function loadSameBill(entryId: string, ids: string[]) {
  const [pairs, differents, previews] = await Promise.all([
    getSameBillPairs(),
    getDifferentBillAnswers(ids),
    getSameBillDeletePreviews(ids),
  ]);
  const pair = (pairs.data ?? []).find((p) => p.transactionId === entryId) ?? null;
  const preview = previews.data?.[0];
  return {
    section:
      pair || (differents.data ?? []).length > 0 ? (
        <div className="flex flex-col gap-2">
          {pair ? <SameBillQuestion pair={pair} /> : null}
          {(differents.data ?? []).map((d) => (
            <DifferentBillNote
              key={d.recurringId}
              recurringId={d.recurringId}
              transactionId={entryId}
              scheduleName={d.scheduleName}
              occurrenceDueDate={d.occurrenceDueDate}
            />
          ))}
        </div>
      ) : null,
    deleteNote: preview ? sameBillDeleteNote(preview) : undefined,
  };
}

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
  // A failed read is a load error, not "not found": a timeout must not
  // tell the user their transaction doesn't exist.
  if (transactionResult.error !== null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Edit transaction" />
        <LoadError message={transactionResult.error} />
      </div>
    );
  }
  // No row: no such id, or another user's (RLS). Both mean the same thing
  // to this viewer -- there's nothing here for them to edit.
  const tx = transactionResult.data;
  if (tx === null) {
    notFound();
  }

  // A transfer is ONE THING WITH TWO LEGS: opening either leg opens the
  // transfer editor, never a transaction editor -- a leg is not editable
  // on its own (docs/Recurring-Amounts-and-Transfer-Editing.md, 4). Saving
  // writes both legs through update_transfer().
  if (!isNonTransfer(tx)) {
    // isNonTransfer keyed on transfer_group_id === null, so this branch has a
    // group id -- TS just can't narrow a non-union field through the negation.
    const transferGroupId = tx.transfer_group_id as string;
    const [transferResult, transferAccountsResult] = await Promise.all([
      getTransferForEdit(transferGroupId),
      listAccounts({ is_active: true }),
    ]);
    if (transferResult.error !== null || transferAccountsResult.error !== null) {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader title="Edit transfer" />
          <LoadError message={transferResult.error ?? transferAccountsResult.error ?? "We couldn't load this transfer."} />
        </div>
      );
    }
    const transfer = transferResult.data;
    if (transfer === null) {
      // Not a whole pair -- nothing a person can edit as a transfer. The
      // integrity view reports it; deleting the group is still offered.
      return (
        <div className="flex flex-col gap-6">
          <PageHeader title="Edit transfer" />
          <EmptyState
            icon={<WalletIcon className="h-10 w-10" />}
            heading="This transfer is missing a side"
            message="One of its two entries isn't there, so it can't be edited as a transfer. You can delete what's left and enter it again."
            action={
              <DeleteTransactionButton
                id={tx.id}
                description={tx.description}
                amount={tx.amount}
                transactionType={tx.transaction_type as TransactionType}
                transactionDate={tx.transaction_date}
                transferGroupId={transferGroupId}
                redirectToList={true}
                label="Delete this transfer"
              />
            }
          />
        </div>
      );
    }

    // Archived accounts don't appear in the active list; a leg on one is
    // spliced back in so the picker shows it rather than silently moving it.
    let transferAccounts: TransactionAccountOption[] = transferAccountsResult.data;
    for (const accountId of [transfer.fromLeg.accountId, transfer.toLeg.accountId]) {
      if (!transferAccounts.some((a) => a.id === accountId)) {
        const accountResult = await getAccount(accountId);
        if (accountResult.error === null) transferAccounts = [...transferAccounts, accountResult.data];
      }
    }
    const fromName = transferAccounts.find((a) => a.id === transfer.fromLeg.accountId)?.account_name;
    const toName = transferAccounts.find((a) => a.id === transfer.toLeg.accountId)?.account_name;
    const sameBill = await loadSameBill(transfer.fromLeg.id, [transfer.fromLeg.id, transfer.toLeg.id]);

    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Edit transfer"
          description="A transfer moves money between two of your accounts. Both sides change together."
        />
        {sameBill.section}
        <TransferEditForm transfer={transfer} accounts={transferAccounts} />
        <div className="self-start">
          <DeleteTransactionButton
            id={tx.id}
            description={tx.description}
            amount={tx.amount}
            transactionType={tx.transaction_type as TransactionType}
            transactionDate={tx.transaction_date}
            transferGroupId={transferGroupId}
            transferAccounts={fromName && toName ? { from: fromName, to: toName } : undefined}
            forecastNote={sameBill.deleteNote}
            redirectToList={true}
            label="Delete this transfer"
          />
        </div>
      </div>
    );
  }

  const [incomeCategoriesResult, expenseCategoriesResult, accountsResult, scheduleResult, sameBill] = await Promise.all([
    listCategoriesForType("Income"),
    listCategoriesForType("Expense"),
    listAccounts({ is_active: true }),
    getScheduleSummary(tx.recurringid),
    loadSameBill(tx.id, [tx.id]),
  ]);

  if (
    incomeCategoriesResult.error !== null ||
    expenseCategoriesResult.error !== null ||
    accountsResult.error !== null ||
    scheduleResult.error !== null
  ) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Edit transaction" />
        <LoadError
          message={
            incomeCategoriesResult.error ??
            expenseCategoriesResult.error ??
            accountsResult.error ??
            scheduleResult.error ??
            "We couldn't load this transaction. Refresh the page to try again."
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
      {sameBill.section}
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
          anchorAnswer: {
            counts_despite_anchor: tx.counts_despite_anchor,
            anchor_answer_set_at: tx.anchor_answer_set_at,
          },
          schedule: scheduleResult.data
            ? { description: scheduleResult.data.description, amountIsVariable: scheduleResult.data.amountIsVariable }
            : null,
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
          forecastNote={sameBill.deleteNote}
          redirectToList={true}
          label="Delete transaction"
        />
      </div>
    </div>
  );
}
