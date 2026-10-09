"use client";

import { useId } from "react";
import { useActionForm } from "@/components/useActionForm";
import {
  updateProfileNamesAction,
  type ProfileNamesActionState,
} from "@/lib/actions/profile";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { NAME_MAX, PREFERRED_NAME_MAX } from "@/lib/displayName";

// Names are all optional. The sidebar shows the full name; the dashboard
// greets by preferred name, falling back to first. Uncontrolled fields,
// so a failed save keeps what the user typed.
export function ProfileForm({
  firstName,
  lastName,
  preferredName,
}: {
  firstName: string;
  lastName: string;
  preferredName: string | null;
}) {
  const firstId = useId();
  const lastId = useId();
  const preferredId = useId();
  const [state, action, pending, submit] = useActionForm<ProfileNamesActionState>(
    updateProfileNamesAction,
    undefined,
  );

  const fieldError = (field: NonNullable<ProfileNamesActionState>["field"]) =>
    state?.field === field ? state?.error : undefined;

  return (
    <form action={action} onSubmit={submit} className="mt-4 flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="First name" htmlFor={firstId} error={fieldError("firstName")}>
          <Input
            id={firstId}
            name="firstName"
            autoComplete="given-name"
            maxLength={NAME_MAX}
            defaultValue={firstName}
          />
        </FormField>
        <FormField label="Last name" htmlFor={lastId} error={fieldError("lastName")}>
          <Input
            id={lastId}
            name="lastName"
            autoComplete="family-name"
            maxLength={NAME_MAX}
            defaultValue={lastName}
          />
        </FormField>
      </div>

      <FormField
        label="Nickname"
        htmlFor={preferredId}
        hint="What should we call you? Optional."
        error={fieldError("preferredName")}
      >
        <Input
          id={preferredId}
          name="preferredName"
          autoComplete="nickname"
          maxLength={PREFERRED_NAME_MAX}
          defaultValue={preferredName ?? ""}
          className="sm:max-w-[calc(50%-0.5rem)]"
        />
      </FormField>

      {state?.error && !state.field ? <ErrorMessage message={state.error} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save profile
        </Button>
        <span aria-live="polite" className="text-sm text-ink-muted">
          {pending ? "Saving…" : state?.saved ? "Saved" : null}
        </span>
      </div>
    </form>
  );
}
