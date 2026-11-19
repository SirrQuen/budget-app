"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useActionForm } from "@/components/useActionForm";
import { submitBetaApplicationAction, type BetaActionState } from "@/lib/actions/betaApplication";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { DrawnCheck } from "@/components/ui/DrawnCheck";
import { InfoIcon } from "@/components/ui/icons";
import { SorrelFlower } from "@/components/SorrelFlower";
import {
  BETA_FIELD_ORDER,
  BETA_NAME_MAX,
  BETA_QUESTIONS,
  BETA_SECTIONS,
  EMPTY_BETA_ANSWERS,
  betaFieldLabel,
  betaSectionComplete,
  validateBetaApplication,
  type BetaAnswers,
  type BetaChoiceField,
  type BetaErrors,
  type BetaField,
  type BetaQuestion,
} from "@/lib/betaApplication";
import { WAITLIST_EMAIL_MAX } from "@/lib/waitlistValidation";
import { PRIVACY_PATH } from "@/lib/legal";

// /beta's application (docs/Beta-Application.md). One page, four numbered
// sections; every answer but name and email is a tap on an option card.
// Each card wraps a real radio or checkbox (visually hidden, still focused
// and announced), so a fieldset + legend per question, Tab between groups
// and arrow keys within one all come from the platform -- arrow keys are
// added by hand only for the one checkbox group, where the platform has
// none. Nothing is stored in the browser: no cookie, no storage key.
//
// The thank-you is identical whether the email was new or had applied
// before (lib/db/betaApplications.ts).

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page";

// The ring sits on the card, drawn when the hidden input inside has
// keyboard focus.
const CARD_FOCUS =
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-action has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-page";

const CARD = `relative flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-field-border bg-surface px-4 py-3 text-sm text-ink transition-colors duration-150 hover:bg-surface-raised has-[:checked]:border-action has-[:checked]:bg-surface-raised motion-reduce:transition-none ${CARD_FOCUS}`;

const CHIP = `relative inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-field-border bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface-raised has-[:checked]:border-action has-[:checked]:bg-action has-[:checked]:text-action-ink motion-reduce:transition-none ${CARD_FOCUS}`;

const INLINE_LINK = `rounded text-ink underline underline-offset-2 hover:text-action ${FOCUS_RING}`;

const fieldId = (field: BetaField) => `beta-${field.replace("_", "-")}`;

export function BetaApplicationForm({ intro }: { intro: React.ReactNode }) {
  const [state, action, pending, submit] = useActionForm<BetaActionState>(
    submitBetaApplicationAction,
    undefined,
  );
  const [answers, setAnswers] = useState<BetaAnswers>(EMPTY_BETA_ANSWERS);
  // Errors show only once a send has been tried, then follow the answers
  // live, so each clears the moment it's answered.
  const [attempted, setAttempted] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const thanksRef = useRef<HTMLDivElement>(null);

  const submitted = state?.submitted;

  // The form is gone; put focus (and the view) on what replaced it.
  useEffect(() => {
    if (!submitted) return;
    window.scrollTo({ top: 0 });
    thanksRef.current?.focus();
  }, [submitted]);

  if (submitted) {
    return (
      <div
        ref={thanksRef}
        tabIndex={-1}
        role="status"
        className={`flex flex-col items-center gap-6 rounded-xl py-8 text-center ${FOCUS_RING}`}
      >
        {/* At rest: the open flower, no bloom -- it simply arrives. */}
        <SorrelFlower size={96} state="open" />
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight text-balance text-ink">
            Thank you, {submitted.firstName}!
          </h1>
          <p className="mx-auto max-w-md text-base leading-relaxed text-ink-secondary">
            We&rsquo;ve got your application. If you&rsquo;re selected, we&rsquo;ll email you with
            next steps and how to get into Sorrel.
          </p>
        </div>
      </div>
    );
  }

  const live = validateBetaApplication(answers);
  const clientErrors: BetaErrors = live.ok ? {} : live.errors;
  // The server applies the same rule; its field errors only matter if the
  // two ever disagree.
  const errors: BetaErrors = attempted ? { ...(state?.errors ?? {}), ...clientErrors } : {};
  const errorFields = BETA_FIELD_ORDER.filter((f) => errors[f] !== undefined);
  const formError = state?.error && !state.errors ? state.error : null;

  const completed = BETA_SECTIONS.filter((s) => betaSectionComplete(s, answers)).length;

  const set = <K extends keyof BetaAnswers>(key: K, value: BetaAnswers[K]) =>
    setAnswers((prev) => ({ ...prev, [key]: value }));

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    setAttempted(true);
    if (live.ok) {
      submit(e);
      return;
    }
    e.preventDefault();
    // After the summary renders.
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const focusField = (field: BetaField) => {
    const target = document.getElementById(fieldId(field));
    if (!target) return;
    const input =
      target instanceof HTMLInputElement
        ? target
        : (target.querySelector<HTMLInputElement>("input:checked") ??
          target.querySelector<HTMLInputElement>("input"));
    input?.focus();
    target.scrollIntoView({ block: "center" });
  };

  return (
    <div className="flex flex-col gap-10">
      <ProgressLine completed={completed} total={BETA_SECTIONS.length} />

      {intro}

      <form action={action} onSubmit={onSubmit} noValidate className="flex flex-col gap-12">
        {errorFields.length > 0 ? (
          <div
            ref={summaryRef}
            tabIndex={-1}
            role="alert"
            aria-labelledby="beta-summary-heading"
            className={`flex items-start gap-3 rounded-xl border border-hairline bg-surface-raised px-4 py-3 ${FOCUS_RING}`}
          >
            <InfoIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
            <div className="flex-1 text-sm text-ink">
              <h2 id="beta-summary-heading" className="font-semibold">
                {errorFields.length === 1
                  ? "One answer still needs you"
                  : `${errorFields.length} answers still need you`}
              </h2>
              <ul className="mt-2 space-y-1">
                {errorFields.map((field) => (
                  <li key={field}>
                    <a
                      href={`#${fieldId(field)}`}
                      onClick={(e) => {
                        e.preventDefault();
                        focusField(field);
                      }}
                      className={INLINE_LINK}
                    >
                      {betaFieldLabel(field)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {/* Honeypot. A person never sees or reaches it; a bot that fills it
            gets the normal thank-you and nothing is stored (migration 75). */}
        <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
          <label htmlFor="beta-website">Website</label>
          <input id="beta-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        {BETA_SECTIONS.map((section) => (
          <section
            key={section.number}
            aria-labelledby={`beta-section-${section.number}`}
            className="flex flex-col gap-8"
          >
            <h2
              id={`beta-section-${section.number}`}
              className="flex items-baseline gap-2 border-b border-hairline pb-3 text-lg font-semibold text-ink"
            >
              <span className="text-ink-secondary">{section.number}</span>
              <span aria-hidden="true" className="text-ink-muted">
                ·
              </span>
              <span>{section.title}</span>
            </h2>

            {section.fields.map((field) => {
              if (field === "full_name") {
                return (
                  <FormField
                    key={field}
                    label="Full name"
                    htmlFor={fieldId(field)}
                    error={errors.full_name}
                    errorTone="neutral"
                  >
                    <Input
                      id={fieldId(field)}
                      name="full_name"
                      type="text"
                      autoComplete="name"
                      maxLength={BETA_NAME_MAX}
                      value={answers.full_name}
                      onChange={(e) => set("full_name", e.target.value)}
                      required
                    />
                  </FormField>
                );
              }
              if (field === "email") {
                return (
                  <FormField
                    key={field}
                    label="Email address"
                    htmlFor={fieldId(field)}
                    hint="We'll only use this to contact you about the beta."
                    error={errors.email}
                    errorTone="neutral"
                  >
                    <Input
                      id={fieldId(field)}
                      name="email"
                      type="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={WAITLIST_EMAIL_MAX}
                      value={answers.email}
                      onChange={(e) => set("email", e.target.value)}
                      required
                    />
                  </FormField>
                );
              }
              if (field === "consent") {
                return (
                  <Consent
                    key={field}
                    checked={answers.consent}
                    onChange={(v) => set("consent", v)}
                    error={errors.consent}
                  />
                );
              }
              return (
                <ChoiceGroup
                  key={field}
                  question={BETA_QUESTIONS[field]}
                  answers={answers}
                  error={errors[field]}
                  onPick={(name, value) => set(name, value as never)}
                />
              );
            })}
          </section>
        ))}

        <div className="flex flex-col gap-4">
          {formError ? <ErrorMessage message={formError} /> : null}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Button type="submit" disabled={pending} className="w-full sm:w-auto sm:shrink-0">
              {pending ? "Sending…" : "Send my application"}
            </Button>
            <p className="text-sm text-ink-muted">
              Please don&rsquo;t include bank account numbers, passwords, card details or other
              sensitive financial information.
            </p>
          </div>
        </div>
      </form>
    </div>
  );
}

// The slim line at the top: complete sections out of four. It eases
// forward on the signature curve; under reduced motion it just moves.
function ProgressLine({ completed, total }: { completed: number; total: number }) {
  return (
    // Pulled up through the public layout's top padding (py-12 sm:py-16),
    // so it sits directly under the header.
    <div className="sticky top-0 z-10 -mx-4 -mt-12 bg-page px-4 py-3 sm:-mx-6 sm:-mt-16 sm:px-6">
      <div
        role="progressbar"
        aria-label="Application progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-valuetext={`${completed} of ${total} sections done`}
        className="h-1 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        <div
          className="h-full w-full origin-left rounded-full bg-action transition-transform duration-500 ease-[var(--icon-anim-ease)] motion-reduce:transition-none"
          style={{ transform: `scaleX(${completed / total})` }}
        />
      </div>
    </div>
  );
}

function ErrorLine({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} className="flex items-center gap-2 text-sm text-ink-secondary">
      <InfoIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
      {message}
    </p>
  );
}

function ChoiceGroup({
  question,
  answers,
  error,
  onPick,
}: {
  question: BetaQuestion;
  answers: BetaAnswers;
  error?: string;
  onPick: (name: BetaChoiceField, value: string | string[]) => void;
}) {
  const many = question.kind === "many";
  const chips = question.layout === "chips";
  const id = fieldId(question.name);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const selected = answers[question.name];

  const isChecked = (code: string) =>
    many ? (selected as string[]).includes(code) : selected === code;

  const toggle = (code: string, checked: boolean) => {
    if (!many) {
      onPick(question.name, code);
      return;
    }
    const current = selected as string[];
    // Kept in the list's order, whatever order they were tapped in.
    const next = question.options
      .map((o) => o.code)
      .filter((c) => (c === code ? checked : current.includes(c)));
    onPick(question.name, next);
  };

  // Radios get arrow keys from the browser. Checkboxes don't, so this adds
  // them: move focus within the group, never change what's ticked.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!many) return;
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (step === 0) return;
    const inputs = [...e.currentTarget.querySelectorAll<HTMLInputElement>("input")];
    const at = inputs.indexOf(e.target as HTMLInputElement);
    if (at === -1) return;
    e.preventDefault();
    inputs[(at + step + inputs.length) % inputs.length].focus();
  };

  const describedBy = [question.hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <fieldset
      id={id}
      aria-describedby={describedBy || undefined}
      aria-invalid={error ? true : undefined}
      className="flex min-w-0 flex-col gap-3"
    >
      <legend className="mb-3 text-base font-medium text-ink">{question.legend}</legend>
      {question.hint ? (
        <p id={hintId} className="-mt-1 text-sm text-ink-muted">
          {question.hint}
        </p>
      ) : null}
      <div
        onKeyDown={onKeyDown}
        className={chips ? "flex flex-wrap gap-2" : "grid grid-cols-1 gap-2 sm:grid-cols-2"}
      >
        {question.options.map((option) => {
          const checked = isChecked(option.code);
          return (
            <label key={option.code} className={chips ? CHIP : CARD}>
              <input
                type={many ? "checkbox" : "radio"}
                name={question.name}
                value={option.code}
                checked={checked}
                onChange={(e) => toggle(option.code, e.target.checked)}
                required={!many}
                className="sr-only"
              />
              {chips ? null : <Indicator round={!many} checked={checked} />}
              <span className="min-w-0">{option.label}</span>
            </label>
          );
        })}
      </div>
      {error ? <ErrorLine id={errorId} message={error} /> : null}
    </fieldset>
  );
}

// The visible stand-in for the hidden input: a ring (radio) or rounded
// square (checkbox), filled with a drawn check once chosen. The check
// mounts on selection, so it draws once; reduced motion shows it whole.
function Indicator({ round, checked }: { round: boolean; checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-5 w-5 shrink-0 items-center justify-center border ${
        round ? "rounded-full" : "rounded-md"
      } ${checked ? "border-action bg-action text-action-ink" : "border-field-border"}`}
    >
      {checked ? <DrawnCheck className="h-3.5 w-3.5" /> : null}
    </span>
  );
}

function Consent({
  checked,
  onChange,
  error,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
}) {
  const id = fieldId("consent");
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-3">
      <label className={`${CARD} items-start`}>
        <input
          id={id}
          type="checkbox"
          name="consent"
          value="yes"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="sr-only"
        />
        <Indicator round={false} checked={checked} />
        <span className="min-w-0 leading-relaxed">
          I agree that Sorrel may email me about the beta. See the{" "}
          <Link href={PRIVACY_PATH} target="_blank" rel="noopener" className={INLINE_LINK}>
            privacy policy
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
          .
        </span>
      </label>
      {error ? <ErrorLine id={errorId} message={error} /> : null}
    </div>
  );
}
