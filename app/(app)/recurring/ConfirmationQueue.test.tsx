import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import type { ConfirmationQueueItem } from "@/lib/db/dashboard";

// The component imports Server Actions, whose data layer imports
// "server-only" -- a marker only Next's bundler resolves. Same stub as
// PreAnchorQuestion.test.
type Next<A, R> = (arg: A, context: unknown) => R;
type HookResult = { url?: string; format?: string; source?: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve(specifier: string, context: unknown, nextResolve: Next<string, HookResult>): HookResult;
    load(url: string, context: unknown, nextLoad: Next<string, HookResult>): HookResult;
  }): void;
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "stub:server-only", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "stub:server-only") return { format: "commonjs", source: "", shortCircuit: true };
    return nextLoad(url, context);
  },
});

let React: typeof import("react");
let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
let ConfirmationQueue: typeof import("./ConfirmationQueue").ConfirmationQueue;

before(async () => {
  React = await import("react");
  ({ renderToStaticMarkup } = await import("react-dom/server"));
  ({ ConfirmationQueue } = await import("./ConfirmationQueue"));
});

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ").trim();

function comingUp(over: Partial<ConfirmationQueueItem>): ConfirmationQueueItem {
  return {
    key: "r1:2026-11-20",
    state: "coming-up",
    recurringId: "r1",
    name: "Rent",
    kind: "Expense",
    accountId: "a1",
    toAccountId: null,
    payee: null,
    amount: 1850,
    isEstimate: false,
    basis: { kind: "fixed" },
    dueDate: "2026-11-20",
    approximate: false,
    dateToleranceDays: 0,
    outstanding: 1,
    accounts: [{ id: "a1", name: "Checking", openingDate: "2026-01-01" }],
    alreadyRecorded: null,
    ...over,
  } as ConfirmationQueueItem;
}

const render = (item: ConfirmationQueueItem) =>
  text(renderToStaticMarkup(React.createElement(ConfirmationQueue, { items: [item] })));

test("coming up: the account name follows the weekday", () => {
  assert.match(render(comingUp({})), /Rent · .*1,850.* · Friday · Checking/);
});

test("coming up: a transfer names both ends, source first", () => {
  const out = render(
    comingUp({
      name: "Card payment",
      kind: "Transfer",
      toAccountId: "a2",
      accounts: [
        { id: "a1", name: "Checking", openingDate: "2026-01-01" },
        { id: "a2", name: "Visa", openingDate: "2026-01-01" },
      ],
    }),
  );
  assert.match(out, /Friday · Checking → Visa/);
});
