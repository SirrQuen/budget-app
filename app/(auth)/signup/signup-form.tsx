"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check, Circle } from "lucide-react";
import { signup, type SignupActionState } from "@/lib/auth/actions";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { NAME_MAX, PREFERRED_NAME_MAX } from "@/lib/displayName";
import {
  PASSWORD_RULES,
  validateSignup,
  type SignupField,
  type SignupValues,
} from "@/lib/signupValidation";

const EMPTY: SignupValues = {
  email: "",
  firstName: "",
  lastName: "",
  preferredName: "",
  password: "",
  confirmPassword: "",
};

const FIELD_ORDER: SignupField[] = [
  "email",
  "firstName",
  "lastName",
  "preferredName",
  "password",
  "confirmPassword",
];

// Controlled, so a server-side rejection (e.g. the email's taken) keeps
// everything the user typed -- React resets uncontrolled fields after a form
// action. Each field validates when the user leaves it, and again as they
// edit it once it has shown an error; submit validates everything.
export function SignupForm() {
  const [state, action, pending] = useActionState<SignupActionState, FormData>(
    signup,
    undefined,
  );
  const [values, setValues] = useState<SignupValues>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<SignupField, boolean>>>({});
  // The server result whose field error the user has since edited away.
  const [dismissed, setDismissed] = useState<SignupActionState>(undefined);

  if (state?.success) {
    return <p className="text-sm text-ink-secondary">{state.success}</p>;
  }

  const clientErrors = validateSignup(values);
  const serverResult = state && state !== dismissed ? state : undefined;

  const errorFor = (field: SignupField) =>
    (touched[field] ? clientErrors[field] : null) ??
    (serverResult?.field === field ? serverResult.error : undefined) ??
    undefined;

  const bind = (field: SignupField) => ({
    id: field,
    name: field,
    value: values[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setValues((v) => ({ ...v, [field]: value }));
      if (serverResult?.field === field) setDismissed(serverResult);
    },
    onBlur: () => {
      // Tabbing through an untouched optional field isn't an attempt.
      setTouched((t) => (t[field] || values[field] !== "" ? { ...t, [field]: true } : t));
    },
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const firstInvalid = FIELD_ORDER.find((field) => clientErrors[field]);
    if (!firstInvalid) return;
    e.preventDefault();
    setTouched(Object.fromEntries(FIELD_ORDER.map((f) => [f, true])));
    document.getElementById(firstInvalid)?.focus();
  };

  return (
    <form action={action} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormField label="Email" htmlFor="email" error={errorFor("email")} required>
        <Input {...bind("email")} type="email" autoComplete="email" required />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="First name" htmlFor="firstName" error={errorFor("firstName")} required>
          <Input
            {...bind("firstName")}
            autoComplete="given-name"
            maxLength={NAME_MAX}
            required
          />
        </FormField>
        <FormField label="Last name" htmlFor="lastName" error={errorFor("lastName")}>
          <Input {...bind("lastName")} autoComplete="family-name" maxLength={NAME_MAX} />
        </FormField>
      </div>

      <FormField
        label="Nickname"
        htmlFor="preferredName"
        hint="What should we call you?"
        error={errorFor("preferredName")}
      >
        <Input
          {...bind("preferredName")}
          autoComplete="nickname"
          maxLength={PREFERRED_NAME_MAX}
        />
      </FormField>

      <div className="flex flex-col gap-2">
        <FormField label="Password" htmlFor="password" error={errorFor("password")} required>
          <Input
            {...bind("password")}
            type="password"
            autoComplete="new-password"
            aria-describedby="password-rules"
            required
          />
        </FormField>
        <PasswordRules password={values.password} />
      </div>

      <FormField
        label="Confirm password"
        htmlFor="confirmPassword"
        error={errorFor("confirmPassword")}
        required
      >
        <Input {...bind("confirmPassword")} type="password" autoComplete="new-password" required />
      </FormField>

      {serverResult?.error && !serverResult.field ? (
        <ErrorMessage message={serverResult.error} />
      ) : null}

      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-ink-secondary">
        Already have an account?{" "}
        <Link
          href="/login"
          className="rounded text-ink transition-colors duration-150 hover:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Log in
        </Link>
      </p>
    </form>
  );
}

// Shown from the first render, so the requirements are known before typing.
// Each rule ticks as it's met: icon + label, never colour alone.
function PasswordRules({ password }: { password: string }) {
  return (
    <ul id="password-rules" aria-label="Password needs" className="flex flex-col gap-1">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li key={rule.id} className="flex items-center gap-2 text-sm text-ink-muted">
            {met ? (
              <Check aria-hidden="true" className="size-4 shrink-0 text-good" />
            ) : (
              <Circle aria-hidden="true" className="size-4 shrink-0" />
            )}
            <span className={met ? "text-ink-secondary" : undefined}>{rule.label}</span>
            {met ? <span className="sr-only">(done)</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
