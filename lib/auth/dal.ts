import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { classifyDbError, logDbError } from "@/lib/db/errors";
import { UnreachableError } from "@/lib/unreachable";

// Cached per-request: safe to call from both a layout and a page without
// double-hitting Supabase.
//
// null means signed out. An auth server we can't reach is NOT signed out:
// it throws, so the route renders app/error.tsx -- never the page, and
// never a redirect to /login over our own outage. UnreachableError's digest
// is what lets error.tsx say "we can't reach our servers" rather than the
// generic text.
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error && classifyDbError(error) === "network-unreachable") {
    logDbError("[auth] getUser: auth server unreachable:", error);
    throw new UnreachableError("Auth server unreachable; session could not be verified.");
  }

  if (error || !data.user) {
    return null;
  }

  return data.user;
});

export const requireUser = cache(async () => {
  const user = await getUser();

  if (!user) {
    redirect("/login");
  }

  return user;
});
