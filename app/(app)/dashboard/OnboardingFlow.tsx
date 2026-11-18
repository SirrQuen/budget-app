"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToday } from "@/components/TodayProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { FIELD_CLASS } from "@/components/ui/Input";
import { FormField, useFieldId } from "@/components/ui/FormField";
import { SorrelFlower } from "@/components/SorrelFlower";
import { toneClassName } from "@/components/ui/Amount";
import { createAccountAction, type CreateAccountState } from "@/lib/actions/accounts";
import { createPaycheckAction, currentSafeToSpendAction, type PaycheckState } from "@/lib/actions/onboarding";
import type { SafeToSpend } from "@/lib/db/dashboard";
import { formatDateWithWeekday, formatSignedAmount, formatCurrency } from "@/lib/format";
import { ONBOARDING_ACCOUNT_TYPES, PAY_FREQUENCIES, nextLastDay, type OnboardingStep, type PayFrequency } from "@/lib/onboarding";
import { paydaySkipCookie } from "@/lib/paydaySkip";
import { RunwayDialog } from "./RunwayDialog";
import { BillsPrompt, type BillsFormLists } from "./BillsPrompt";
import { RollingFigure } from "@/components/ui/RollingFigure";
import { useValueChange } from "@/components/ui/useValueChange";

// Onboarding that grows (docs/Decide-and-Grow.md, G): three screens for
// someone with no accounts -- an account, a paycheck, the number. The page
// derives which of the first two to show from what exists
// (lib/onboarding.ts); step 3 is the step-2 answer's response, held here.
// Both writes are the existing paths: createAccountAction and
// createRecurring() (through createPaycheckAction). No bank login, no
// account numbers.

const STEPS = ["Your account", "Your pay", "Your number"] as const;

export type OnboardingAccount = { id: string; name: string };
export type OnboardingCategory = { id: string; name: string };

export function OnboardingFlow({
  step,
  welcome,
  accounts,
  incomeCategories,
  defaultCategoryId,
  skipToken,
  billsLists = null,
}: {
  step: OnboardingStep;
  /** Step 3's "Add your bills": the recurring form's lists. */
  billsLists?: BillsFormLists | null;
  welcome: string;
  /** Step 2: the checking and cash accounts pay can land in. */
  accounts: OnboardingAccount[];
  /** Step 2: active Income categories, for the picker when Paychecks/Salary is archived. */
  incomeCategories: OnboardingCategory[];
  /** Paychecks/Salary when it's active; null shows the picker. */
  defaultCategoryId: string | null;
  /** The skip cookie's value for this user (lib/paydaySkip.ts). */
  skipToken: string;
}) {
  const [result, setResult] = useState<SafeToSpend | null>(null);
  const current = result ? 3 : step;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Each new step moves focus to its heading, so a keyboard or screen-reader
  // user lands on the new screen rather than on whatever just disappeared.
  // Not on the first render: arriving on the dashboard shouldn't steal focus.
  const shownStep = useRef(current);
  useEffect(() => {
    if (shownStep.current !== current) {
      shownStep.current = current;
      headingRef.current?.focus();
    }
  }, [current]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description={welcome} />
      <section aria-labelledby="onboarding-heading" className="mx-auto w-full max-w-lg rounded-2xl border border-hairline bg-surface p-5 sm:p-6">
        <Progress current={current} />
        {current === 1 ? (
          <AccountStep headingRef={headingRef} />
        ) : current === 2 ? (
          <PaycheckStep
            headingRef={headingRef}
            accounts={accounts}
            incomeCategories={incomeCategories}
            defaultCategoryId={defaultCategoryId}
            skipToken={skipToken}
            onDone={setResult}
          />
        ) : result ? (
          <NumberStep headingRef={headingRef} data={result} lists={billsLists} />
        ) : null}
      </section>
    </div>
  );
}

function Progress({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav aria-label="Setup progress" className="mb-5">
      <p className="mb-2 text-xs text-ink-muted">
        Step {current} of {STEPS.length}
      </p>
      <ol className="grid grid-cols-3 gap-2">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < current ? "done" : n === current ? "current" : "next";
          return (
            <li key={label} aria-current={state === "current" ? "step" : undefined} className="flex flex-col gap-1.5">
              <span
                aria-hidden="true"
                className={`h-1 rounded-full ${state === "next" ? "bg-gridline" : "bg-action"}`}
              />
              <span className={`text-xs ${state === "current" ? "font-medium text-ink" : "text-ink-muted"}`}>
                {label}
                {state === "done" ? <span className="sr-only"> (done)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepHeading({
  headingRef,
  children,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  children: React.ReactNode;
}) {
  return (
    <h2 id="onboarding-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-ink outline-none">
      {children}
    </h2>
  );
}

// A choice among a few: real radios, styled as chips, so arrow keys and
// screen readers treat them as one group.
function Choice<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-ink-secondary">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={`whatif-chip inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-action has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface ${
              value === o.value
                ? "border-action bg-surface-raised text-ink shadow-[0_0_0_1px_var(--action)]"
                : "border-field-border text-ink-secondary hover:text-ink"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Step 1: an account
// ---------------------------------------------------------------------------

function AccountStep({ headingRef }: { headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const today = useToday();
  const fieldId = useFieldId();
  const [type, setType] = useState<(typeof ONBOARDING_ACCOUNT_TYPES)[number]>("Checking");
  const [state, formAction, pending] = useActionState<CreateAccountState, FormData>(createAccountAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <StepHeading headingRef={headingRef}>Start with the account you spend from</StepHeading>
        <p className="mt-1 text-sm text-ink-secondary">
          Your checking account, or the cash in your pocket. No bank login and no account numbers: just a name and
          what&apos;s in it right now.
        </p>
      </div>

      <FormField label="Name" htmlFor={fieldId("name")} required>
        <input
          id={fieldId("name")}
          name="account_name"
          required
          autoComplete="off"
          placeholder="e.g. Everyday checking"
          className={FIELD_CLASS}
        />
      </FormField>

      <Choice
        legend="Type"
        name="account_type"
        options={ONBOARDING_ACCOUNT_TYPES.map((t) => ({ value: t, label: t }))}
        value={type}
        onChange={setType}
      />

      <FormField label="Balance right now" htmlFor={fieldId("balance")} hint="What your bank shows today, or what's in your wallet." required>
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-muted">
            $
          </span>
          <input
            id={fieldId("balance")}
            name="opening_balance"
            type="number"
            step="0.01"
            inputMode="decimal"
            required
            placeholder="0.00"
            className={`${FIELD_CLASS} pl-7 tabular-nums`}
          />
        </div>
      </FormField>
      {/* The balance date is today, the user's day -- the anchor that later
          entries are counted from. */}
      <input type="hidden" name="opening_date" value={today} />

      {state?.error ? <ErrorMessage message={state.error} /> : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Next"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Step 2: a paycheck
// ---------------------------------------------------------------------------

function PaycheckStep({
  headingRef,
  accounts,
  incomeCategories,
  defaultCategoryId,
  skipToken,
  onDone,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  accounts: OnboardingAccount[];
  incomeCategories: OnboardingCategory[];
  defaultCategoryId: string | null;
  skipToken: string;
  onDone: (data: SafeToSpend) => void;
}) {
  const today = useToday();
  const fieldId = useFieldId();
  const [frequency, setFrequency] = useState<PayFrequency>("every_2_weeks");
  // The answer's response is step 3, held by the parent.
  const [state, formAction, pending] = useActionState<PaycheckState, FormData>(async (prev, formData) => {
    const res = await createPaycheckAction(prev, formData);
    if (res?.done) onDone(res.done.safeToSpend);
    return res;
  }, undefined);
  const [skipping, startSkip] = useTransition();
  const [skipError, setSkipError] = useState<string | null>(null);
  const monthly = frequency === "monthly" || frequency === "twice_a_month";

  function skip() {
    setSkipError(null);
    // The skip is this browser's cookie, keyed to this user (lib/paydaySkip.ts).
    document.cookie = paydaySkipCookie(skipToken, window.location.protocol === "https:");
    startSkip(async () => {
      const res = await currentSafeToSpendAction();
      if ("error" in res) setSkipError(res.error);
      else onDone(res.safeToSpend);
    });
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <StepHeading headingRef={headingRef}>When does your pay come in?</StepHeading>
        <p className="mt-1 text-sm text-ink-secondary">
          Sorrel looks ahead to your paydays to work out what you can spend. Each payday, it asks whether your pay
          landed. It never adds it on its own.
        </p>
      </div>

      <FormField label="Take-home pay" htmlFor={fieldId("amount")} hint="What lands in your account each payday." required>
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-muted">
            $
          </span>
          <input
            id={fieldId("amount")}
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            required
            placeholder="0.00"
            className={`${FIELD_CLASS} pl-7 tabular-nums`}
          />
        </div>
      </FormField>

      <Choice legend="How often" name="frequency" options={PAY_FREQUENCIES} value={frequency} onChange={setFrequency} />

      {frequency === "twice_a_month" ? (
        <>
          <PaydayField n={1} label="First payday" today={today} allowLastDay />
          <PaydayField n={2} label="Second payday" today={today} allowLastDay />
        </>
      ) : (
        <PaydayField n={1} label="Next payday" today={today} allowLastDay={monthly} />
      )}

      {accounts.length > 1 ? (
        <FormField label="Lands in" htmlFor={fieldId("account")} required>
          <select id={fieldId("account")} name="accountid" required className={FIELD_CLASS} defaultValue={accounts[0].id}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </FormField>
      ) : (
        <input type="hidden" name="accountid" value={accounts[0]?.id ?? ""} />
      )}

      {defaultCategoryId ? (
        <input type="hidden" name="categoryid" value={defaultCategoryId} />
      ) : (
        // Paychecks/Salary is archived: ask, never create one silently.
        <FormField label="Category" htmlFor={fieldId("category")} hint="Your Paychecks/Salary category is archived, so choose one for your pay." required>
          <select id={fieldId("category")} name="categoryid" required className={FIELD_CLASS} defaultValue="">
            <option value="" disabled>
              Choose a category
            </option>
            {incomeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
      )}

      {state?.error ? <ErrorMessage message={state.error} /> : null}
      {skipError ? <ErrorMessage message={skipError} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || skipping}>
          {pending ? "Saving…" : "Next"}
        </Button>
        <button
          type="button"
          onClick={skip}
          disabled={pending || skipping}
          className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-ink-secondary transition-colors duration-150 hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          My pay isn&apos;t regular, so skip this
        </button>
      </div>
    </form>
  );
}

// A payday: a date from today on, or -- for a monthly payday -- "the last
// day of the month", which fills in this month's last day
// (lib/onboarding.ts, lastDayAnchor, for why that's its own choice).
function PaydayField({ n, label, today, allowLastDay }: { n: 1 | 2; label: string; today: string; allowLastDay: boolean }) {
  const fieldId = useFieldId();
  const [lastDay, setLastDay] = useState(false);
  const last = allowLastDay && lastDay;
  const hintId = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId("date")} className="text-sm font-medium text-ink-secondary">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        {last ? (
          <>
            <input type="hidden" name={`payday_${n}`} value={nextLastDay(today)} />
            <input
              id={fieldId("date")}
              type="date"
              value={nextLastDay(today)}
              disabled
              aria-describedby={hintId}
              className={`${FIELD_CLASS} max-w-[12rem] opacity-70`}
            />
          </>
        ) : (
          <input
            id={fieldId("date")}
            name={`payday_${n}`}
            type="date"
            min={today}
            required
            className={`${FIELD_CLASS} max-w-[12rem]`}
          />
        )}
        {allowLastDay ? (
          <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              name={`last_day_${n}`}
              checked={lastDay}
              onChange={(e) => setLastDay(e.target.checked)}
              className="h-4 w-4 accent-[var(--action)]"
            />
            Last day of the month
          </label>
        ) : null}
      </div>
      {last ? (
        <p id={hintId} className="text-xs text-ink-muted">
          Every month&apos;s last day, starting {formatDateWithWeekday(nextLastDay(today))}.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: the number
// ---------------------------------------------------------------------------

function NumberStep({
  headingRef,
  data: initial,
  lists,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  data: SafeToSpend;
  /** The recurring form's lists, for "Add your bills". null: bills aren't offered here. */
  lists: BillsFormLists | null;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [runwayOpen, setRunwayOpen] = useState(false);
  const [addingBills, setAddingBills] = useState(false);
  const [continuing, startContinue] = useTransition();
  const positive = data.safeToSpend > 0;
  const figure = positive ? formatSignedAmount(data.safeToSpend, "Income").text : formatCurrency(0);
  // A bill lowers the number: it rolls down calmly -- no glow, no leaves, no
  // comment (RollingFigure with glow off; a fall never glows anyway).
  const change = useValueChange(data.safeToSpend);
  const previousFigure =
    change.previous === null ? null : change.previous > 0 ? formatSignedAmount(change.previous, "Income").text : formatCurrency(0);
  // Honest about what it counts: right after onboarding there are no bills.
  const paycheckCounted = data.incomes.length > 0;

  function refreshFigure() {
    startContinue(async () => {
      const res = await currentSafeToSpendAction();
      if (!("error" in res)) setData(res.safeToSpend);
    });
  }

  const toDashboard = () => startContinue(() => router.refresh());

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {/* The bloom: the existing welcome flower, once, here -- the welcome
          overlay yields to it for someone with no accounts. Decorative;
          reduced motion shows it open. */}
      <div aria-hidden="true">
        <SorrelFlower size={120} state="bloom" />
      </div>
      <div>
        <StepHeading headingRef={headingRef}>Here&apos;s your number</StepHeading>
        <p className="mt-1 text-sm text-ink-secondary">Safe to spend through {formatDateWithWeekday(data.horizonEnd)}</p>
      </div>
      <p className={`text-5xl font-medium ${positive ? toneClassName("good") : "text-ink"}`}>
        <RollingFigure text={figure} previousText={previousFigure} change={change} glow={false} />
      </p>
      <p className="max-w-sm text-sm text-ink-secondary">
        {paycheckCounted ? "That counts your paycheck. " : ""}Add your regular bills and it gets sharper.
      </p>

      {addingBills && lists ? (
        <div className="flex w-full flex-col items-center gap-3">
          <BillsPrompt lists={lists} added={[]} stayOnPage onAdded={refreshFigure} />
          <Button type="button" disabled={continuing} onClick={toDashboard}>
            {continuing ? "One moment…" : "Done"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {lists ? (
            <Button type="button" onClick={() => setAddingBills(true)}>
              Add your bills
            </Button>
          ) : null}
          <button type="button" disabled={continuing} onClick={toDashboard} className={secondaryButton}>
            {continuing ? "One moment…" : lists ? "Later" : "Go to your dashboard"}
          </button>
        </div>
      )}
      <button type="button" onClick={() => setRunwayOpen(true)} className={secondaryButton}>
        See how we got there
      </button>

      {runwayOpen ? <RunwayDialog data={data} startWith="runway" onClose={() => setRunwayOpen(false)} /> : null}
    </div>
  );
}

const secondaryButton =
  "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-ink-secondary underline-offset-2 transition-colors duration-150 hover:text-ink hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
