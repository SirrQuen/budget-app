import type { SupabaseClient } from "@supabase/supabase-js";
import { authErrorMessage } from "@/lib/auth/errors";
import { checkInviteCode, INVITE_CODE_FIELD } from "@/lib/auth/inviteCode";
import { clean } from "@/lib/displayName";
import { validateSignup, type SignupField, type SignupValues } from "@/lib/signupValidation";

export type SignupActionState =
  | { error?: string; field?: SignupField | typeof INVITE_CODE_FIELD; success?: string }
  | undefined;

// What createAccount needs from the request. A thunk, so nothing -- not even
// the Supabase client -- is created for a submission the invite gate turns
// away. The server action supplies the real one; tests supply a fake.
export type SignupConnection = () => Promise<{
  auth: Pick<SupabaseClient["auth"], "signUp">;
  origin: string | null;
}>;

// The body of the signup server action (lib/auth/actions.ts). Not in that
// file because every export of a "use server" module is a callable endpoint.
//
// Collects everything a new account needs, so nobody finishes setup in
// Settings: email, password, first name (required), last name and nickname
// (optional). Nothing else -- every extra field is data we'd then hold.
//
// The form validates the same rules inline (lib/signupValidation.ts); this is
// the authoritative pass, and the one a no-JS submit gets.
export async function createAccount(
  formData: FormData,
  connect: SignupConnection,
): Promise<SignupActionState> {
  // First, before anything else is looked at: no code, no account.
  const invite = checkInviteCode(String(formData.get(INVITE_CODE_FIELD) ?? ""));
  if (!invite.ok) return { field: invite.field, error: invite.error };

  const values: SignupValues = {
    email: String(formData.get("email") ?? ""),
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    preferredName: String(formData.get("preferredName") ?? ""),
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  };

  const errors = validateSignup(values);
  const firstInvalid = (Object.keys(errors) as SignupField[]).find((field) => errors[field]);
  if (firstInvalid) {
    return { field: firstInvalid, error: errors[firstInvalid]! };
  }

  const email = clean(values.email)!;
  const firstName = clean(values.firstName)!;
  const lastName = clean(values.lastName);
  const preferredName = clean(values.preferredName);

  const { auth, origin } = await connect();

  const { error } = await auth.signUp({
    email,
    password: values.password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm?next=/dashboard`,
      // Read by handle_new_user() (migration 34), which already maps these
      // keys -- no trigger change. Optional keys are omitted when blank: the
      // trigger stores a missing last_name as '' and preferred_name as null.
      data: {
        first_name: firstName,
        ...(lastName ? { last_name: lastName } : {}),
        ...(preferredName ? { preferred_name: preferredName } : {}),
      },
    },
  });

  if (error) {
    return {
      error: authErrorMessage(error),
      ...(error.code === "weak_password" ? { field: "password" as const } : {}),
    };
  }

  // Said up front because the common path is cross-device: signed up here,
  // the email opened on a phone. The link confirms wherever it's clicked,
  // and this screen offers the way back in (app/(auth)/signup/signup-form.tsx).
  return {
    success:
      "Check your email for a confirmation link. It works on any device, so opening it on your phone is fine. Once you've confirmed, you can sign in here.",
  };
}
