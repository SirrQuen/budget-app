"use server";

import { revalidatePath } from "next/cache";
import { updateProfile } from "@/lib/db/profile";
import { clean, nameLength, NAME_MAX, PREFERRED_NAME_MAX } from "@/lib/displayName";

export type ProfileNamesActionState =
  | { error?: string; field?: "firstName" | "lastName" | "preferredName"; saved?: boolean }
  | undefined;

// useActionState-shaped. All three fields are optional -- clearing one is
// a real edit, and it's how a typo gets fixed. Blank is stored the way the
// signup trigger stores it: '' for the NOT NULL first/last name columns,
// null for preferred_name (its check rejects '').
export async function updateProfileNamesAction(
  _prev: ProfileNamesActionState,
  formData: FormData,
): Promise<ProfileNamesActionState> {
  const firstName = clean(String(formData.get("firstName") ?? ""));
  const lastName = clean(String(formData.get("lastName") ?? ""));
  const preferredName = clean(String(formData.get("preferredName") ?? ""));

  if (firstName && nameLength(firstName) > NAME_MAX) {
    return { field: "firstName", error: `Keep your first name to ${NAME_MAX} characters or fewer.` };
  }
  if (lastName && nameLength(lastName) > NAME_MAX) {
    return { field: "lastName", error: `Keep your last name to ${NAME_MAX} characters or fewer.` };
  }
  if (preferredName && nameLength(preferredName) > PREFERRED_NAME_MAX) {
    return {
      field: "preferredName",
      error: `Keep your nickname to ${PREFERRED_NAME_MAX} characters or fewer.`,
    };
  }

  const result = await updateProfile({
    first_name: firstName ?? "",
    last_name: lastName ?? "",
    preferred_name: preferredName,
  });

  if (result.error) {
    return { error: "We couldn't save that. Give it another try." };
  }

  // The layout renders the sidebar name; the dashboard renders the greeting.
  revalidatePath("/", "layout");
  return { saved: true };
}
