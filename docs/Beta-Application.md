# "Become a beta tester": button and application form

**A second button beside "Join the waitlist" opens a short, friendly application. Apart from name and email, every answer is a tap. No typing, no essays, and nothing sensitive to leak.**

---

## Where it lives

- **Landing page:** a **"Become a beta tester"** button directly beside "Join the waitlist". Same size, secondary style (outline), so the waitlist stays the main action. They stack on a phone.
- **The form:** its own public page, **`/beta`**. No account needed, and nothing about it signs anyone up for Sorrel.
- **After submitting:** a thank-you screen on the same page (see the end of this doc).

## Look and feel

- Sorrel's brand: the dark theme by default, the flower mark at the top, the app's own colour tokens and type.
- **One page, four short sections,** each numbered: *1 · About you*, *2 · Your budgeting*, *3 · Your availability*, *4 · Last one*. A slim progress line at the top fills as sections are completed.
- **Answers are big tappable option cards, not tiny radio dots.** Each card has a hidden real radio or checkbox inside it, so it's fully keyboard and screen-reader friendly: `fieldset` and `legend` per question, a visible focus ring, and arrow keys within a group.
- The age range is a row of compact chips. Longer lists are a two-column grid of cards on desktop and one column on a phone.
- **No dropdowns** except where a list is long. None here is, so everything is visible at a glance.
- Errors appear beside the question and in a summary at the top on submit, in neutral wording, never red alarm styling.
- Motion follows the app's rules: a gentle check on a selected card, the progress line easing forward, and nothing with reduced motion.

---

## The copy and questions

### Header

> **Become a Sorrel beta tester**
> *Help us grow.*
>
> We're expanding our beta community and looking for **30–50 more people** to try Sorrel before it launches. Whether you're just starting to budget, running a household, or already have a routine, we'd love your help.
>
> You'll get early access and a real say in how Sorrel turns out.
>
> `About 3–4 weeks` `You must be 18 or older`

### 1 · About you

**Full name**, a text field, required.

**Email address**, an email field, required. *"We'll only use this to contact you about the beta."*

**Which age range are you in?** Pick one, required.
18–24 · 25–34 · 35–44 · 45–54 · 55+

**Which best describes you?** Pick one, required.
Young adult · Working professional · Parent or managing household finances · Experienced budgeter · Small business owner · New to budgeting · Other

### 2 · Your budgeting

**How would you describe your budgeting experience?** Pick one, required.
Beginner · Some experience · Experienced · Very experienced

**How do you manage your money today?** *Pick all that apply*, at least one.
Spreadsheet · Budgeting app or software · Paper or notebook · Banking app · I don't follow a budget right now · Other

**What's your biggest money challenge?** Pick one, required.
- Knowing how much I can safely spend
- Keeping track of where my money goes
- Sticking to a budget
- Bills and due dates sneaking up on me
- Saving toward a goal
- Paying down debt
- Income that changes from month to month
- Other

**What would you most like a budgeting app to help you do?** Pick one, required.
- Know what's safe to spend, day to day
- Plan ahead for upcoming bills
- See all my accounts in one place
- Build savings toward a goal
- Pay off debt
- Feel less stressed about money
- Build better money habits
- Other

### 3 · Your availability

**Can you actively test Sorrel for 3–4 weeks?** Pick one, required.
Yes · Possibly · No

**Are you comfortable exploring features, entering sample transactions and giving honest feedback?** Pick one, required.
Yes · No

**How often do you think you'll use Sorrel during the test?** Pick one, required.
Daily · A few times a week · Once a week · Not sure

### 4 · Last one

**Why would you like to join the beta?** Pick one, required.
- I want a better way to manage my money
- I like trying new apps early
- I want to help shape a new product
- The "safe to spend" idea caught my eye
- Someone recommended Sorrel to me
- Other

**Consent**, a checkbox, required:
> I agree that Sorrel may email me about the beta. See the [privacy policy](/privacy).

**Note beside the button**, small and muted:
> Please don't include bank account numbers, passwords, card details or other sensitive financial information.

**Button:** *Send my application*

### Thank-you screen

The Sorrel flower in its resting state, then:

> **Thank you, <first name>!**
> We've got your application. If you're selected, we'll email you with next steps and how to get into Sorrel.

"Other" never opens a text box, so the only typed answers are name and email.

---

## How it's stored: the waitlist pattern, reused

- **Migration 75: a `beta_applications` table.** Every answer is stored as a fixed code (`age_25_34`, `challenge_safe_to_spend`, and so on), enforced by **check constraints**, so the database refuses anything not on the list. "Pick all that apply" is a text array, each element checked against the list.
- **RLS on, no table grants** to `anon` or `authenticated`. Applications are readable only by the project owner, through the Supabase dashboard.
- **One SECURITY DEFINER function, `submit_beta_application(...)`, granted to `anon` only**, with a pinned search path and the full migration 57 grant block otherwise. It mirrors `join_waitlist()`:
  - normalises the email (trim, lower case) and rejects implausible ones;
  - trims the name and caps its length (100 characters);
  - **the same answer whether or not the email has already applied.** A repeat updates that application and never reveals whether someone applied before;
  - **the same rate limit as the waitlist**;
  - stores `created_at`, `updated_at` and the consent time. It does **not** store IP addresses or user agents.
- **Spam:** a hidden honeypot field (if it's filled in, return the normal success answer and store nothing), plus the rate limit. No CAPTCHA, because that would mean a third-party script and cookie.
- **No account is created** and nothing is linked to the app's users.
- **No automatic email** in this version. The thank-you screen says what happens next.
- **Reading applications:** Supabase dashboard → sorrel-prod → Table Editor → `beta_applications`. It can be exported as CSV from there. No admin page in the app, since that would be a new security surface.

## Privacy

- **The privacy policy needs a short new paragraph** saying what the application collects (name, email and the answers), why (choosing testers and contacting them), that answers aren't shared, how long they're kept, and how to ask for deletion (email hello@).
- **Retention, for Matt to confirm:** applications from people not selected are deleted **6 months after submission or at public launch, whichever comes first**. Selected testers' applications are deleted when the beta ends.
- This adds a new kind of data from **people who aren't users yet**. It doesn't change how existing users' information is handled, so the existing notice clause isn't triggered. Record that reasoning in the findings, as with the cookie correction.
- The merge-gate cookie and local-storage rule applies: this form should add **neither.** If it needs one, stop and say so.

---

## The prompt (Opus)

```
Read docs/Beta-Application.md in full. New branch off main.

REPORT FIRST, then build:
  - How join_waitlist() and the landing page's waitlist button are
    built today (the function, its rate limit, its grants, the page).
  - The privacy policy's current waitlist wording, quoted.
  - Anything in the doc that conflicts with how the app already works.
  If anything blocks, STOP and tell me.

BUILD per the doc:
  - "Become a beta tester" button beside "Join the waitlist", secondary
    style, stacking on phone.
  - /beta: one public page, four numbered sections, slim progress line,
    option CARDS wrapping real radios/checkboxes (fieldset + legend,
    focus ring, arrow keys), the exact copy and options in the doc.
    Only Full name and Email are typed. "Other" has no text box.
    Consent checkbox required. Inline + summary errors, neutral tone.
    Thank-you screen with the resting flower and first name.
  - Migration 75: beta_applications with check constraints on every
    coded answer (array elements too), RLS on, no table grants;
    submit_beta_application() SECURITY DEFINER, anon EXECUTE only,
    pinned search_path, migration 57 grant block, email normalisation,
    name cap, identical answer for repeat emails (update, never reveal),
    the waitlist's rate limit, honeypot stores nothing, no IP or user
    agent stored.
  - Harness: a section like 2e waitlist — grants, anon/authenticated
    refused on the table, repeat-email identical answer, invalid code
    rejected by the constraint, rate limit, honeypot. Final ALL PASS row.
  - Privacy policy: the new paragraph, with "6 months or public launch,
    whichever first" retention marked for my confirmation. Findings
    entry with the reasoning that this doesn't trigger the notice
    clause. Show me before/after.
  - No cookies, no localStorage, no new dependency, no third-party
    scripts.
Migration 75 to DEV only; I run the push and the harness.

VERIFY in the browser on dev (no sign-in needed):
  - Desktop and phone width: both buttons, the form, the thank-you.
  - Keyboard only: fill and submit the whole form.
  - Submitting the same email twice: same thank-you, one row updated.
  - A forced invalid code via devtools is refused by the database.
  - Network: the request carries only the form fields.
  - Delete your test rows on dev afterwards (through SQL as owner,
    ZZ-prefixed names only).
tsc, eslint, full npm test. Report, then stop. Don't merge.
```
