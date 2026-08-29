"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  type AddTransactionPrefill,
  type TransactionAccountOption,
} from "@/app/(app)/transactions/AddTransactionForm";
import type { CategoryWithGroup } from "@/lib/db/categories";
import { createTransactionAction, suggestCategoryAction, type ActionState } from "@/lib/actions/transactions";
import { useOptimisticTransactions } from "@/components/quick-add/OptimisticTransactionsContext";
import { parseQuickAdd } from "@/lib/quickAdd/parseQuickAdd";
import { todayISO } from "@/lib/date";
import { formatCurrency } from "@/lib/format";
import { PlusIcon, FlameIcon } from "@/components/ui/icons";
import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/Button";
import { Celebration } from "@/components/ui/Celebration";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { FullFormOverlay } from "@/components/quick-add/FullFormOverlay";

export function QuickAddBar({
  accounts,
  incomeCategories,
  expenseCategories,
  defaultAccountId,
}: {
  accounts: TransactionAccountOption[];
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  defaultAccountId: string | null;
}) {
  const [text, setText] = useState("");
  const [categoryid, setCategoryid] = useState("");
  const [lastParseKey, setLastParseKey] = useState<string | null>(null);
  const [accountid, setAccountid] = useState(() =>
    defaultAccountId && accounts.some((a) => a.id === defaultAccountId) ? defaultAccountId : "",
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fullFormOpen, setFullFormOpen] = useState(false);
  const [fullFormPrefill, setFullFormPrefill] = useState<AddTransactionPrefill>();
  const [celebrate, setCelebrate] = useState(false);
  const [celebrateMessage, setCelebrateMessage] = useState("Logged");
  const [celebrateIcon, setCelebrateIcon] = useState<React.ReactNode>("✓");

  const inputRef = useRef<HTMLInputElement>(null);
  const categorySelectRef = useRef<HTMLSelectElement>(null);
  const accountSelectRef = useRef<HTMLSelectElement>(null);
  const categoryTouchedRef = useRef(false);
  const requestTokenRef = useRef(0);
  const wasPendingRef = useRef(false);
  const celebrateTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingClientIdRef = useRef<string | null>(null);
  // Guards against a second Enter-triggered submit landing before React has
  // re-rendered with pending=true -- useActionState's `pending` is only
  // current as of the last commit, so a same-tick double Enter can race it.
  // This ref is set synchronously inside handleSubmit instead.
  const submittingRef = useRef(false);
  // One key per fill of the form: minted once on mount, reused on every
  // retry of the same submission, replaced only once the server has
  // confirmed the row exists. This makes two submissions that carry it
  // resolve to one row (see createTransaction's 23505 handling) rather than
  // relying on the button/Enter guards never letting a duplicate through.
  // State, not a ref -- the hidden input below reads it during render, and
  // refs can't be read there (only in effects/handlers).
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const { addPending, settlePending, failPending } = useOptimisticTransactions();

  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createTransactionAction,
    undefined,
  );

  const parsed = parseQuickAdd(text, todayISO());
  const parseKey = parsed.ok ? `${parsed.merchant} ${parsed.transaction_type}` : null;
  const categoryOptions = parsed.ok
    ? parsed.transaction_type === "Income"
      ? incomeCategories
      : expenseCategories
    : [];

  // Resets the category pick as soon as the recognized merchant/type
  // changes -- adjusted directly during render (React's documented pattern
  // for resetting state when a derived value changes) rather than in an
  // effect, since the old selection has no meaning for a different merchant.
  // Only plain state is touched here -- refs can't be read or written
  // during render, only in effects/handlers.
  if (parseKey !== lastParseKey) {
    setLastParseKey(parseKey);
    if (categoryid !== "") setCategoryid("");
  }

  // Re-suggests a category whenever the recognized merchant or its resolved
  // type changes -- not on every keystroke, since amount/date digits moving
  // around inside the text shouldn't touch the merchant-history lookup. The
  // only setState call here runs inside the timeout callback, not
  // synchronously in the effect body.
  useEffect(() => {
    categoryTouchedRef.current = false;
    if (!parsed.ok) return;

    const token = ++requestTokenRef.current;
    const timer = setTimeout(async () => {
      const suggestion = await suggestCategoryAction(parsed.merchant, parsed.transaction_type);
      if (requestTokenRef.current !== token || categoryTouchedRef.current || !suggestion) return;
      const list = parsed.transaction_type === "Income" ? incomeCategories : expenseCategories;
      if (list.some((c) => c.id === suggestion.categoryid)) {
        setCategoryid(suggestion.categoryid);
      }
    }, 300);

    return () => clearTimeout(timer);
    // parsed/incomeCategories/expenseCategories are derived from (or stable
    // alongside) parseKey -- re-running on parseKey alone is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parseKey]);

  useEffect(() => {
    // Failure: leave text, category, account and the idempotency key
    // exactly as entered, so pressing Add/Enter again retries the same
    // submission instead of risking a second row.
    if (wasPendingRef.current && !pending && state?.error) {
      submittingRef.current = false;
      const clientId = pendingClientIdRef.current;
      pendingClientIdRef.current = null;
      if (clientId) failPending(clientId);
    }
    if (wasPendingRef.current && !pending && !state?.error) {
      submittingRef.current = false;
      // A fresh key for the next transaction -- reusing this one across an
      // unrelated future submission would make the server treat it as a
      // retry of this one and silently drop it.
      setIdempotencyKey(crypto.randomUUID());
      const clientId = pendingClientIdRef.current;
      pendingClientIdRef.current = null;
      if (clientId) settlePending(clientId);

      const milestone = state?.milestone;
      const verb = parsed.ok && parsed.transaction_type === "Income" ? "from" : "at";
      const message = milestone
        ? milestone.message
        : parsed.ok
          ? `Logged ${formatCurrency(parsed.amount)} ${verb} ${parsed.merchant}`
          : "Logged";
      const icon = milestone?.kind === "streak-7" ? <FlameIcon className="h-4 w-4" /> : "✓";
      setCelebrateMessage(message);
      setCelebrateIcon(icon);
      setCelebrate(true);
      setText("");
      setSheetOpen(false);
      clearTimeout(celebrateTimeoutRef.current);
      celebrateTimeoutRef.current = setTimeout(() => setCelebrate(false), 1600);
    }
    wasPendingRef.current = pending;
    // parsed is read at the moment success is detected -- see body above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, state]);

  useEffect(() => {
    return () => clearTimeout(celebrateTimeoutRef.current);
  }, []);

  useEffect(() => {
    function handleGlobalKeydown(e: KeyboardEvent) {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(target?.isContentEditable);
      if (isEditable) return;
      e.preventDefault();
      setSheetOpen(true);
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", handleGlobalKeydown);
    return () => document.removeEventListener("keydown", handleGlobalKeydown);
  }, []);

  function openFullForm() {
    setFullFormPrefill(
      parsed.ok
        ? {
            transaction_date: parsed.transaction_date,
            description: parsed.merchant,
            amount: String(parsed.amount),
            merchant: parsed.merchant,
          }
        : { description: text.trim() || undefined },
    );
    setFullFormOpen(true);
  }

  function handleFullFormSaved() {
    setFullFormOpen(false);
    setText("");
    setSheetOpen(false);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setSheetOpen(false);
      e.currentTarget.blur();
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Blocks a second Enter (or a stray click) from resubmitting before
    // React commits pending=true and the button's disabled attribute takes
    // over -- see submittingRef's declaration for why pending alone isn't
    // enough here.
    if (submittingRef.current) {
      e.preventDefault();
      return;
    }
    if (!parsed.ok) {
      e.preventDefault();
      openFullForm();
      return;
    }
    if (!categoryid) {
      e.preventDefault();
      categorySelectRef.current?.focus();
      return;
    }
    if (!accountid) {
      e.preventDefault();
      accountSelectRef.current?.focus();
      return;
    }

    submittingRef.current = true;

    const category = categoryOptions.find((c) => c.id === categoryid);
    const account = accounts.find((a) => a.id === accountid);
    pendingClientIdRef.current = addPending({
      transaction_date: parsed.transaction_date,
      description: parsed.merchant,
      amount: parsed.amount,
      transaction_type: parsed.transaction_type,
      categoryid,
      category_name: category?.category_name ?? null,
      category_color: category?.color ?? null,
      accountid,
      account_name: account?.account_name ?? null,
    });
  }

  const panel = (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="flex w-full flex-col gap-2 p-3 md:px-0 md:py-3"
    >
      <input type="hidden" name="transaction_date" value={parsed.ok ? parsed.transaction_date : ""} readOnly />
      <input type="hidden" name="description" value={parsed.ok ? parsed.merchant : ""} readOnly />
      <input type="hidden" name="merchant" value={parsed.ok ? parsed.merchant : ""} readOnly />
      <input type="hidden" name="amount" value={parsed.ok ? String(parsed.amount) : ""} readOnly />
      <input
        type="hidden"
        name="transaction_type"
        value={parsed.ok ? parsed.transaction_type : ""}
        readOnly
      />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} readOnly />

      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Quick add — e.g. trader joes 82.45"
          autoComplete="off"
          className="w-full rounded-lg border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-muted outline-none transition-colors focus:border-action focus:ring-2 focus:ring-action/40"
        />
        <button
          type="button"
          onClick={openFullForm}
          className="shrink-0 rounded text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Full form
        </button>
        <Button type="submit" disabled={pending} className="shrink-0 px-4 py-2 text-sm">
          {pending ? "Saving…" : "Add"}
        </Button>
      </div>

      {text.trim() ? (
        <div className="flex flex-wrap items-center gap-2 px-1 text-sm">
          {parsed.ok ? (
            <>
              <Amount amount={parsed.amount} type={parsed.transaction_type} />
              <span className="text-ink-muted">·</span>
              <span className="text-ink">{parsed.merchant}</span>
              <span className="text-ink-muted">·</span>
              <span className="text-ink-secondary">{parsed.dateLabel}</span>
              <select
                ref={categorySelectRef}
                name="categoryid"
                value={categoryid}
                onChange={(e) => {
                  categoryTouchedRef.current = true;
                  setCategoryid(e.target.value);
                }}
                className="rounded-lg border border-hairline bg-surface-raised px-2 py-1 text-xs text-ink outline-none transition-colors duration-150 focus:border-action focus:ring-2 focus:ring-action/40"
              >
                <option value="" disabled>
                  Category
                </option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.category_name}
                  </option>
                ))}
              </select>
              <select
                ref={accountSelectRef}
                name="accountid"
                value={accountid}
                onChange={(e) => setAccountid(e.target.value)}
                className="rounded-lg border border-hairline bg-surface-raised px-2 py-1 text-xs text-ink-secondary outline-none transition-colors duration-150 focus:border-action focus:ring-2 focus:ring-action/40"
              >
                <option value="" disabled>
                  Account
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.account_name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span className="text-ink-muted">{!parsed.ok ? parsed.reason : null}</span>
          )}
        </div>
      ) : (
        <p className="px-1 text-xs text-ink-muted">
          Press <kbd className="rounded border border-hairline px-1">n</kbd> anywhere to jump here ·
          Enter to save
        </p>
      )}

      {state?.error ? <ErrorMessage message={state.error} /> : null}
    </form>
  );

  return (
    <>
      {/* One panel instance, not two -- its input/select refs and native
          form-submit-on-Enter only make sense bound to a single DOM node.
          Mobile: a fixed bottom sheet, slid off-screen until opened.
          Desktop: the same node becomes an always-visible sticky bar
          (position/inset utilities overridden at md:, not swapped out). */}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-hairline bg-surface transition-transform duration-200 motion-reduce:transition-none ${
          sheetOpen ? "translate-y-0" : "translate-y-full"
        } md:sticky md:top-0 md:z-30 md:translate-y-0 md:rounded-none md:border-t-0 md:border-b md:bg-page md:transition-none`}
      >
        {panel}
      </div>

      <button
        type="button"
        onClick={() => {
          setSheetOpen(true);
          inputRef.current?.focus();
        }}
        aria-label="Quick add transaction"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-action text-action-ink shadow-lg transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-action-hover hover:shadow-xl active:translate-y-0 active:scale-95 active:bg-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page md:hidden"
      >
        <PlusIcon className="h-6 w-6" />
      </button>

      {sheetOpen ? (
        <div
          className="fixed inset-0 z-30 bg-scrim md:hidden"
          onClick={() => setSheetOpen(false)}
        />
      ) : null}

      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center md:bottom-6">
        <Celebration show={celebrate} message={celebrateMessage} icon={celebrateIcon} />
      </div>

      {fullFormOpen ? (
        <FullFormOverlay
          accounts={accounts}
          incomeCategories={incomeCategories}
          expenseCategories={expenseCategories}
          prefill={fullFormPrefill}
          onClose={() => setFullFormOpen(false)}
          onSaved={handleFullFormSaved}
        />
      ) : null}
    </>
  );
}
