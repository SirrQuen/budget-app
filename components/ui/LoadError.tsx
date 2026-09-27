"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ErrorMessage } from "@/components/ui/ErrorMessage";

/**
 * A page whose data didn't load. Notice tone, not critical: a failed read is
 * transient and nothing is wrong with the user's data, so it matches the
 * dashboard's SectionError rather than borrowing status red. The message
 * has to say what happened; "Try again" re-runs the page's server render
 * in place, so the way forward isn't a browser refresh.
 */
export function LoadError({ message }: { message: string }) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();

  return (
    <ErrorMessage
      message={message}
      retrying={retrying}
      onRetry={() => startTransition(() => router.refresh())}
    />
  );
}
