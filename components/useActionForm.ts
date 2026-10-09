import { startTransition, useActionState, useCallback, type FormEvent } from "react";
import { unstable_rethrow } from "next/navigation";
import { thrownErrorMessage } from "@/lib/thrownError";

// useActionState for a <form>, with two fixes that keep what the user typed
// on screen when a submission doesn't succeed.
//
// 1. A Server Action that THROWS -- the browser went offline, the server
//    crashed -- would reject into the nearest error boundary, and
//    app/error.tsx would replace the whole route, form and all. callAction
//    turns the throw into a returned { error }, which every form already
//    shows inline. Next's own control flow (redirect(), notFound()) also
//    arrives as a rejection on the client, so unstable_rethrow passes those
//    through untouched.
//
// 2. A <form action={fn}> submission makes React reset every uncontrolled
//    field when the action finishes, error or not (react-dom's
//    startHostTransition queues requestFormReset before the action runs).
//    So a returned "That name is taken" would also blank the name. `submit`
//    takes the submission over in onSubmit and dispatches it itself, which
//    React leaves alone: it sees defaultPrevented plus a transition and only
//    tracks pending state (useFormStatus still works). `action` stays on the
//    form so a submit before hydration still posts natively.
//
// Nothing here resets the form on success. Forms that stay open after a
// save reset themselves (AddTransactionForm, GoalRow, QuickAddBar); the rest
// close, redirect, or show the saved value.
//
//   const [state, formAction, pending, submit] = useActionForm(createThing, undefined);
//   <form action={formAction} onSubmit={submit}>
//
// A form with its own onSubmit validation calls submit(e) once it passes.

type ErrorState = { error?: string } | undefined;

// The catch itself, for a direct call too: an action called from an event
// handler inside startTransition rejects into the error boundary the same
// way. Every such caller already shows result?.error inline.
//   const result = await callAction(() => deleteBudgetAction(id));
export async function callAction<R>(call: () => Promise<R>): Promise<R | { error: string }> {
  try {
    return await call();
  } catch (error) {
    unstable_rethrow(error);
    // Production redacts a server-thrown error to its digest; the server
    // logged the real one. This line is for the client-side failures the
    // server never saw, like a fetch that couldn't leave the browser.
    console.error("[action] threw; kept the page:", error);
    return { error: thrownErrorMessage(error, navigator.onLine) };
  }
}

// Awaited<S> as in useActionState's own signature; for any concrete state
// type it's just S.
export function guardAction<S extends ErrorState>(
  action: (prev: Awaited<S>, formData: FormData) => Promise<S>,
): (prev: Awaited<S>, formData: FormData) => Promise<S> {
  // Every state type here admits { error }, so the fallback is a valid S.
  return (prev, formData) => callAction(() => action(prev, formData)) as Promise<S>;
}

export function useActionForm<S extends ErrorState>(
  action: (prev: Awaited<S>, formData: FormData) => Promise<S>,
  initialState: Awaited<S>,
) {
  const [state, formAction, pending] = useActionState<S, FormData>(guardAction(action), initialState);

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      // The button that submitted, so a form with two (the cushion's Save
      // and "Use the suggestion") sends the right name/value.
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      const formData = new FormData(event.currentTarget, submitter);
      startTransition(() => formAction(formData));
    },
    [formAction],
  );

  return [state, formAction, pending, submit] as const;
}
