import { test, before } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import type { AnchorPreview } from "@/lib/anchorAnswer";

// The component imports a Server Action, whose data layer imports
// "server-only" -- a marker only Next's bundler resolves. Same stub as
// RecurringForm.test.
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
let PreAnchorQuestion: typeof import("./PreAnchorQuestion").PreAnchorQuestion;

before(async () => {
  React = await import("react");
  ({ renderToStaticMarkup } = await import("react-dom/server"));
  ({ PreAnchorQuestion } = await import("./PreAnchorQuestion"));
});

const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ").trim();

const PREVIEW: AnchorPreview = {
  countsByDate: false,
  anchorBalance: 1240,
  anchorDate: "2026-11-03",
  anchorSetAt: "2026-11-03T17:00:00+00:00",
  accountType: "Checking",
};

function render(props: Partial<Parameters<typeof PreAnchorQuestion>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(PreAnchorQuestion, {
      idPrefix: "t",
      accountId: "chk",
      accountName: "Checking",
      preview: PREVIEW,
      ...props,
    }),
  );
}

test("asks the question with the balance and its date, two required answers", () => {
  const html = render();
  assert.match(text(html), /This is dated before your balance of \$1,240\.00 on 3 November\. Was it already included in that balance\?/);
  assert.match(text(html), /Yes, it's already counted/);
  assert.match(text(html), /No, add it to my balance/);
  assert.equal((html.match(/type="radio"/g) ?? []).length, 2);
  assert.equal((html.match(/required=""/g) ?? []).length, 2);
});

// Either default is wrong, so a new transaction starts with neither.
test("a new transaction has neither answer checked", () => {
  assert.doesNotMatch(render(), /checked=""/);
});

test("carries the anchor it was shown, so the answer is stored against it", () => {
  assert.match(render(), /name="anchor_set_at\.chk" value="2026-11-03T17:00:00\+00:00"/);
});

test("a liability's balance reads as owed, never negative", () => {
  const html = render({ preview: { ...PREVIEW, anchorBalance: -480.5, accountType: "Credit Card" } });
  assert.match(text(html), /balance of \$480\.50 owed on 3 November/);
});

test("on edit, a stored answer for this anchor is shown checked and said in words", () => {
  const add = render({ stored: { counts_despite_anchor: true, anchor_answer_set_at: "2026-11-03T17:00:00Z" } });
  assert.match(add, /checked="" value="add"/);
  assert.match(text(add), /counts toward the balance despite its date/);

  const counted = render({ stored: { counts_despite_anchor: false, anchor_answer_set_at: "2026-11-03T17:00:00Z" } });
  assert.match(counted, /checked="" value="counted"/);
  assert.match(text(counted), /already included it, so it doesn't change the balance/);
});

// An override is valid only against the anchor it answered.
test("an answer given for an earlier balance is not pre-selected, and the form says why", () => {
  const html = render({ stored: { counts_despite_anchor: true, anchor_answer_set_at: "2026-10-01T09:00:00Z" } });
  assert.doesNotMatch(html, /checked=""/);
  assert.match(text(html), /You answered this for an earlier balance \(you added it then\)/);
});

test("a transfer names the account each question is about", () => {
  assert.match(text(render({ nameAccount: true })), /before your Checking balance of/);
});

// An edit that leaves date, amount and account alone doesn't ask again;
// it says what's stored, so the exception stays visible.
let StoredAnchorAnswer: typeof import("./PreAnchorQuestion").StoredAnchorAnswer;
before(async () => {
  ({ StoredAnchorAnswer } = await import("./PreAnchorQuestion"));
});

function renderStored(stored?: { counts_despite_anchor: boolean | null; anchor_answer_set_at: string | null }) {
  return text(
    renderToStaticMarkup(
      React.createElement(StoredAnchorAnswer, { accountName: "Checking", preview: PREVIEW, stored }),
    ),
  );
}

test("unchanged edit: no radios, just the stored answer in words", () => {
  const html = renderToStaticMarkup(
    React.createElement(StoredAnchorAnswer, {
      accountName: "Checking",
      preview: PREVIEW,
      stored: { counts_despite_anchor: true, anchor_answer_set_at: "2026-11-03T17:00:00Z" },
    }),
  );
  assert.doesNotMatch(html, /type="radio"/);
  assert.match(text(html), /counts toward the balance despite its date/);
  assert.match(
    renderStored({ counts_despite_anchor: false, anchor_answer_set_at: "2026-11-03T17:00:00Z" }),
    /already included it, so it doesn't change the balance/,
  );
});

test("unchanged edit of a row never asked, or answered for an earlier balance: not counted, said plainly", () => {
  assert.match(renderStored(undefined), /Dated before your balance of \$1,240\.00 on 3 November, so it isn't counted/);
  assert.match(
    renderStored({ counts_despite_anchor: true, anchor_answer_set_at: "2026-10-01T09:00:00Z" }),
    /so it isn't counted in that balance/,
  );
});
