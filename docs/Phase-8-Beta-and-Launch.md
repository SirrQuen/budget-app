# Phase 8 — Beta, then launch

> **Filed 2026-10-22 as the original plan, written 2026-10-13. Do not read this
> file for current status.** Several items below are complete. Live status for
> every one of them is tracked in `docs/phase-7-findings.md`, which is the
> single source of truth.
>
> **A1–A9 mapped to the findings doc's launch blockers:**
>
> | | Stage A item | Blocker # |
> |---|---|---|
> | A1 | Custom SMTP with a verified domain | 5 |
> | A2 | Privacy policy and terms of service | 6 |
> | A3 | The composite foreign keys | 1 |
> | A4 | Error visibility you can actually read | 8 |
> | A5 | A landing page that explains what this is | 4 |
> | A6 | Decide how people get in (invite gate) | — no blocker entry |
> | A7 | Decide the PITR question | 7 |
> | A8 | Check it on devices you don't own | — no blocker entry |
> | A9 | A feedback channel that isn't texts | — no blocker entry |
>
> Blockers 2 and 3 have no Stage A equivalent — they came out of Phase 7.

---

**Two stages, not one. Stage A gets other people using it. Stage B sells it.**

---

## What changes the moment it isn't just you

Everything in Phase 7 assumed one user: you. Every finding was rated on that basis. A handful of testers changes three things at once.

**Failures become invisible.** You find bugs by reading your own console. A tester will say "it didn't work" three days later, or more likely say nothing at all and quietly stop using it. Without server-side error visibility, a month of testing produces impressions instead of defects.

**Cross-user problems become real.** The composite foreign keys have been theoretical because there was one real account. With five people in one database, "you'd need to know another user's UUID" stops being a comfortable barrier.

**You acquire obligations.** The moment someone who isn't you puts their financial records in, you're holding another person's money data. That's not a launch-day thing — it's a first-other-user thing.

And one way the bar is *higher* than commercial launch: **these are people doing you a favour.** A stranger who hits a bug shrugs and leaves. A friend who loses a month of entered transactions is owed an apology and has learned something about your app that no feedback form will tell you.

---

# Stage A — Beta readiness

## Must have. No beta without these.

### A1 — Custom SMTP with a verified domain

**The single hardest blocker.** Supabase's built-in mailer is rate-limited and its messages land in spam. If your testers can't receive and click a confirmation link, there is no beta — they never get past signup.

- A sending provider (Resend, Postmark and SES are the usual choices for this size; all have free or near-free tiers at beta volume)
- `mysorrel.com` verified with that provider
- SPF, DKIM and DMARC records published
- Supabase Auth pointed at it under **Project Settings → Auth → SMTP Settings**
- Email templates checked — the defaults say "Supabase" in places

**Verify by actually doing it:** sign up a fresh address on a mail provider you don't control (ask one tester to try before the rest), confirm the mail arrives in the inbox rather than spam, and confirm the link works.

### A2 — Privacy policy and terms of service

Not optional, and not a launch-day item. You become a data controller the moment another person's financial data is in your database.

It must honestly describe what you actually do, including the things Phase 7 established:

- What you collect (financial records, email, name, timezone)
- Where it's stored (Supabase, and the region)
- That you can see it (you can — be straight about this)
- Backups and retention
- **The audit-log decision from Section 5** — a deleted user's id remains in `auth.audit_log_entries`. Your policy must say so rather than claim total erasure.
- How to delete an account, and what deletion does and doesn't remove

A beta-stage policy for a pre-revenue product doesn't need a lawyer, but it does need to be *true*. A policy that overstates what you delete is worse than none.

### A3 — The composite foreign keys

This has been a launch blocker mitigated in RLS only. With one real account the exposure was theoretical. With several, it isn't: the barrier was "you'd need another user's UUID," and UUIDs travel in screenshots, support messages and shared screens.

Ship the structural fix before anyone else has an account. It's already specified in Phase 7.5 Batch 1.2 and validated on a preview branch.

### A4 — Error visibility you can actually read

Without this you will finish the month with impressions and no defects.

**Minimum:** know how to read your Vercel function logs and your Supabase logs (Pro gives you 7 days), and check them deliberately — not when someone complains.

**Better:** an error tracker. Sentry's free tier is ample at this volume, takes about twenty minutes to wire into Next.js, and turns "it broke" into a stack trace with the route, the user and the time. For a month of real-user testing this is the highest-value thing on this list after SMTP.

Whichever you choose, **test it by deliberately causing an error in production and confirming you see it.** An error tracker you haven't verified is a placebo.

### A5 — A landing page that explains what this is

Your `/` still redirects. A tester who types the domain lands on a login form with no explanation.

It doesn't need to be a marketing site. It needs: what Sorrel is, one sentence on who it's for, a sign-in link, and links to the privacy policy and terms. An honest beta page can say it's in testing — that's reassuring, not embarrassing.

### A6 — Decide how people get in

A finance app shouldn't have open signup during a beta. Options, cheapest first:

- **Invite code** — one shared code checked at signup. Trivial, and enough for people you know.
- **Email allowlist** — only addresses you've added can register. Tighter, slightly more work.
- **Supabase's own signup restrictions** under Auth settings.

Pick one and make sure disabling it later is a one-line change.

---

## Should have

### A7 — Decide the PITR question, properly, now

Pro gives you daily snapshots. Worst case is **24 hours of lost work** — and during a beta that's not your work, it's a tester's evening of entering transactions.

Decide deliberately: either enable PITR for the beta period, or don't and tell your testers plainly what the recovery guarantee is. The second is acceptable. Saying nothing isn't.

### A8 — Check it on devices you don't own

You've tested in your Chrome, on your monitor. Your testers have Safari, Firefox, iPhones, Androids, and one person on a laptop at 125% scaling.

Before you invite anyone: open the app on a phone and do the three things a real user does — log a transaction, look at Safe to Spend, check an account balance. The 320px reflow failures from Section 11 become real here.

### A9 — A feedback channel that isn't texts

One email address, or one shared document, or a simple form. Anything, as long as it's one place.

Without this, feedback arrives across four channels at odd hours and two thirds of it is lost. With it, you have a list you can work from.

---

## Explicitly not needed for a beta

Resist these. They're launch-stage work and they'll eat the month.

| | Why not yet |
|---|---|
| Analytics / product metrics | Five users generate no statistics. Talk to them instead. |
| In-app feedback widget | Email is fine at this size and takes an hour less. |
| Rate limiting and abuse protection | A closed beta with known people isn't the threat model. |
| Payment or subscription plumbing | Nothing is being sold. |
| Onboarding tour | You want to watch where people get stuck, not prevent it. |
| Performance optimisation | Nothing is slow yet. Wait for evidence. |

---

## The conversation to have with your testers

This matters more than any of the technical items, and it's the part most people skip.

### Real data or fake data?

**Ask for real data.** Fake data produces fake feedback. Nobody meaningfully tests a budgeting app with invented numbers — Safe to Spend only means anything against a real cashflow, and the entire value of the trough calculation is invisible with made-up transactions.

But asking for real data means you owe them real care, which is exactly why A2, A3 and A7 are on the must-have list.

### Say these things explicitly, in writing, before they sign up

- **It's beta software.** Bugs are expected. Data loss is unlikely but possible.
- **What the recovery guarantee actually is** — daily backups, so up to a day could be lost, unless you've enabled PITR.
- **That you can see their data.** You can. Say so. Someone finding that out later feels very different from being told upfront.
- **Don't delete your other system.** If they're moving from a spreadsheet or another app, they should keep it running in parallel for the month. This is both honest and good advice.
- **What happens at the end.** Does their account survive into launch? Does their data? Do they get free access? Decide now and tell them — "I hadn't thought about it" is a bad answer in week four.

### What to ask them for

Specific beats general. "Any feedback?" gets you "it's nice."

- Tell me the first moment you were confused.
- Tell me anything that showed you a number you didn't believe.
- Tell me what you expected to be able to do and couldn't.
- Tell me if you stopped using it, and what the last straw was.

That last one is the most valuable question in the set, and the one people won't volunteer unless asked.

---

## Running the month

- **Stagger the invitations.** Two people in week one, the rest after you've fixed what they hit. Inviting everyone on day one means five people hitting the same bug.
- **Check your error tracker on a schedule**, not on complaint. Twice a week is plenty.
- **Keep a running list** of every report, with who said it. Patterns across two people matter more than one person's strong opinion.
- **Deploy fixes during the month.** It's a beta, not a frozen release. People seeing their feedback acted on give far better feedback afterwards.
- **Watch someone use it, once, in person or over a call.** Thirty minutes of watching tells you more than a month of written feedback. You will see them hesitate somewhere you thought was obvious.

---

# Stage B — Commercial launch

What's additionally needed once you're charging money. Don't start these until the beta has told you what to change.

| | |
|---|---|
| **Payments and subscriptions** | Stripe or similar. The `profiles.subscription_plan` and `subscription_status` columns already exist, unused — they'll need real plumbing and a webhook. |
| **Terms that cover a commercial relationship** | Refunds, cancellation, service levels, limitation of liability. This is the point where a lawyer is worth the money — a finance app with paying customers carries real exposure. |
| **A support path** | Somewhere people can reach you, with a response expectation you'll actually meet. |
| **PITR** | Optional for a beta. Not optional once people are paying you to hold their financial records. |
| **Rate limiting** | Including `username_is_available`, which Section 2d flagged as scrapeable. |
| **The trademark** | SORREL is pending under 1(b). Once it registers, ™ becomes ® and widens to the marketing page and footer. Section 15's note. |
| **A real marketing page** | What the beta page becomes once you know what people actually value about it — which the beta will tell you. |
| **Status and incident communication** | Even just a page you can update. When your database is down, silence is the worst option. |

---

## Sequencing

**Historical — this was the plan as of 2026-10-13.** The actual order of completion is recorded in the findings doc.

| Order | What | Why there |
|---|---|---|
| 1 | **A3** — composite foreign keys | Last Phase 7.5 blocker; must land before a second real account exists |
| 2 | **A1** — custom SMTP | Longest lead time. Domain verification and DNS propagation can take a day. |
| 3 | **A4** — error visibility | You want it running *before* testers arrive, not after the first report |
| 4 | **A2** — privacy policy and terms | Must exist before the first non-you signup |
| 5 | **A5, A6** — landing page and invite gate | The front door |
| 6 | **A7, A8** — PITR decision, device check | Cheap, do them while DNS propagates |
| 7 | **A9** + the tester conversation | Then invite the first two |

Start A1 today whatever else you do. Everything else is work you control; DNS is waiting.
