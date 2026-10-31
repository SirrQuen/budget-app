import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PaymentNote } from "./PaymentNote";
import { ACCOUNT_TYPES, paymentPayee } from "@/lib/accountOptions";

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;|&apos;/g, "'");

// The boundary: money owed to a third party gets the line; a move between
// the user's own accounts doesn't. Every account type, so a new one has to
// be placed on one side deliberately.
test("paymentPayee: cards and loans are paid to someone else, nothing else is", () => {
  const placed = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t, paymentPayee(t)]));
  for (const [type, payee] of Object.entries(placed)) {
    const expected = type === "Credit Card" ? "card" : type === "Loan" ? "loan" : null;
    assert.equal(payee, expected, type);
  }
  assert.equal(paymentPayee(null), null);
});

test("PaymentNote says the same thing for each payee, adapted only in how to pay", () => {
  const lead = "Recording a payment here updates Sorrel. It doesn't move any money — ";
  assert.equal(text(renderToStaticMarkup(<PaymentNote payees={["card"]} />)), lead + "pay the card through your bank or card issuer.");
  assert.equal(text(renderToStaticMarkup(<PaymentNote payees={["loan"]} />)), lead + "pay the loan through your bank or lender.");
  assert.equal(
    text(renderToStaticMarkup(<PaymentNote payees={["card", "loan", "card"]} />)),
    lead + "pay each one through your bank, card issuer or lender.",
  );
});

test("PaymentNote renders nothing when nobody is being paid", () => {
  assert.equal(renderToStaticMarkup(<PaymentNote payees={[]} />), "");
});
