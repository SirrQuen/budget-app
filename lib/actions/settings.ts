"use server";

import { revalidatePath } from "next/cache";
import { updateTheme } from "@/lib/db/settings";
import { isTheme } from "@/lib/theme";

export type ThemeActionState = { error?: string } | undefined;

// The control applies the theme locally before calling this, so a failure
// here doesn't undo what the user just saw -- it only means the choice
// didn't follow the account to their other devices. The message says that
// rather than claiming nothing happened.
export async function setThemeAction(theme: unknown): Promise<ThemeActionState> {
  if (!isTheme(theme)) {
    return { error: "That isn't a theme we recognise." };
  }

  const result = await updateTheme(theme);

  if (result.error) {
    return { error: "Your theme is set on this device, but we couldn't save it to your account." };
  }

  // The layout renders the stored theme into ThemeProvider, so the cached
  // server output is now stale for every authenticated route.
  revalidatePath("/", "layout");

  return undefined;
}
