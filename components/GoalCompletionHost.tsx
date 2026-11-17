"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GoalCompletePanel } from "@/app/(app)/goals/GoalCompletePanel";
import type { GoalCompletion } from "@/lib/goalCompletion";

// The goal-completion panel for actions outside the goals page -- a
// payment that pays a followed card to zero, a confirmed card payment
// (migration 70). Mounted once by the shell. It shows only what an
// action's response handed it (lib/goalCompletionCheck.ts); nothing is
// stored, so a reload shows nothing. The goals page keeps its own panel.

type Show = (completion: GoalCompletion | undefined) => void;

const GoalCompletionContext = createContext<Show | null>(null);

export function GoalCompletionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [completion, setCompletion] = useState<GoalCompletion | null>(null);
  const show = useCallback<Show>((next) => {
    if (next) setCompletion(next);
  }, []);
  const value = useMemo(() => show, [show]);

  return (
    <GoalCompletionContext.Provider value={value}>
      {children}
      {completion ? (
        <GoalCompletePanel
          completion={completion}
          onClose={() => setCompletion(null)}
          onPrimary={() => {
            setCompletion(null);
            router.push("/goals");
          }}
        />
      ) : null}
    </GoalCompletionContext.Provider>
  );
}

const noop: Show = () => {};

/** Shows the panel for a completion an action returned; a no-op outside the provider. */
export function useShowGoalCompletion(): Show {
  return useContext(GoalCompletionContext) ?? noop;
}
