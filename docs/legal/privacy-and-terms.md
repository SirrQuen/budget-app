# Privacy Policy

**Last updated: October 27, 2026**

Sorrel is a personal budgeting app operated by **MW Cyber Architects LLC**. This policy explains what we collect, where it lives, who can see it, and what happens when you leave.

Sorrel is currently in beta testing. This policy describes what we do today, not what we might do later.

## What we collect

**Account information**

- Your email address
- Your first and last name, and a preferred name if you give one
- Your time zone, detected from your browser

**Financial information you enter**

- Accounts you set up, including their names, types and balances
- Transactions you record, including amounts, dates, descriptions and categories
- Budgets, savings goals, recurring schedules and investment holdings
- Any notes or labels you add

**Sorrel does not connect to your bank.** Everything financial in Sorrel is information you typed in yourself. We have no access to your bank accounts, cards or credentials, and Sorrel never asks for them.

**Technical information**

- Sign-in times and session records
- Error logs when something goes wrong, which may include the page you were on and what failed

We don't use advertising trackers, analytics pixels, or third-party cookies. The only cookies Sorrel sets are the ones that keep you signed in, support the sign-in process, remember when you last saw the opening animation, and, for up to a minute as you sign in, carry the name that animation greets you by. Your theme and a few display preferences are stored in your browser's local storage, on your device only.

## If you join the waitlist

The waitlist on our home page collects **your email address** and nothing else — no name, and no record of where you came from.

We use it to send you one email when Sorrel opens. We don't use it for anything else, and we don't add it to any other list. Only we can see it; it's held in the same Supabase database described below.

Your waitlist entry is held separately from any Sorrel account, including one you create later with the same address. Deleting an account doesn't remove it. To be removed from the waitlist, email hello@mysorrel.com and we'll delete your address.

## Where your information is stored

Your data is held in a PostgreSQL database operated by **Supabase**, hosted in Amazon Web Services' **US West (Oregon)** region. It is encrypted in transit and at rest.

The app itself is served by **Vercel**. Emails from Sorrel — confirmations and password resets — are sent through **Resend**.

These three providers process data on our behalf. We don't share your information with anyone else, and we don't sell it. This policy will be updated before that ever changes.

## Who can see your information

**Other users cannot see your data.** Sorrel enforces this at the database level: every table is restricted so that one account's queries can only ever return that account's rows.

**We can see your data.** We want to be straightforward about this, because many apps are not. As the operator, we have administrative access to the database and can read what's in it. In practice we look at individual accounts only when:

- You ask us to, usually because something is wrong
- We're investigating an error that appears to affect a specific account
- We're legally required to

We don't browse user data out of curiosity. During the beta we may look at how the app is being used in aggregate — how many accounts exist, how often features are used — to decide what to fix.

## Backups

The database is backed up automatically once a day, and backups are kept for seven days. Backups are held by Supabase in the same region as the live database.

**This means that if something goes badly wrong, up to 24 hours of your data could be lost.** Sorrel is beta software, and we tell you this plainly rather than burying it.

Deleted data may persist in a backup until that backup expires, which is at most seven days after deletion.

## Deleting your account

You can delete your account at any time from Settings. Deletion is immediate and permanent.

**What is deleted:** every transaction, account, category and category group, budget, savings goal and goal contribution, recurring schedule, investment holding, notification and setting associated with you — along with your profile and your login credentials. All of it, straight away.

**What is not deleted:**

- **Security audit records.** Supabase keeps an authentication log recording events such as sign-ins and password changes. Depending on the event, an entry may contain your account's internal identifier, your email address and the IP address the request came from. It does not contain your financial data, your name, or anything you entered into Sorrel. We retain it because it is how account security incidents get investigated. Entries are kept for seven days, then removed automatically.
- **A waitlist entry**, if you joined the waitlist. It's separate from your account; email hello@mysorrel.com to have it removed.
- **Backup copies**, until the backup they're in expires — at most seven days.
- **Error logs**, which may reference your account identifier, for a limited period.

We mention this because a policy claiming everything is erased when it isn't would be a false statement, and the whole point of this document is that it's accurate.

## Security

- Every table is protected by row-level security, so one account cannot read or write another account's data
- Passwords are stored as cryptographic hashes and are never readable, including by us
- All traffic uses HTTPS
- Database access requires authentication, and administrative access is limited to the operator

**No system is perfectly secure**, and Sorrel is beta software built by one person. If you'd rather not put real financial information into it, use approximate numbers. We'd rather tell you that than have you assume more than we can promise.

## Your choices

- **See your data** — it's all visible in the app
- **Correct it** — edit or delete anything, any time
- **Take it with you** — email us and we'll send you an export
- **Delete everything** — Settings, as above

## Children

Sorrel is not for anyone under 18. We don't knowingly collect information from children. If you believe a child has created an account, email us and we'll remove it.

## Changes

If this policy changes in a way that affects how your information is handled, we'll email you before it takes effect. The date at the top shows when it was last revised.

## Contact

hello@mysorrel.com

---
---

# Terms of Service

**Last updated: October 12, 2026**

These terms govern your use of Sorrel, operated by **MW Cyber Architects LLC**. By creating an account you agree to them.

## Sorrel is in beta

Sorrel is unfinished software being tested. That means:

- **It will have bugs**, including ones that produce wrong numbers
- **It may be unavailable** without warning
- **Your data could be lost.** Backups run daily, so up to 24 hours of entries could disappear in a serious failure.
- **Features will change or be removed**
- **The beta may end**, with reasonable notice

**Keep your existing system running.** If you're moving from a spreadsheet or another app, don't stop using it. Sorrel is not yet somewhere to keep your only copy of anything.

The beta is free. We'll tell you before that changes, and you'll be able to decline.

## Sorrel is not financial advice

This matters more than anything else here.

Sorrel shows you figures based on information you enter — including a "safe to spend" number that forecasts your balance. **Those figures are estimates produced by software, from data you typed in.** They are not advice, and we are not financial advisors, accountants or planners.

Sorrel does not know about anything you haven't told it. It cannot know whether a payment will actually clear, whether your income will arrive on time, or whether a number you entered was right.

**Check your actual bank balance before making decisions that depend on it.** Don't rely on Sorrel to avoid an overdraft, a missed payment or a fee. If you need financial advice, speak to a qualified professional.

## Your account

- Keep your password private. You're responsible for what happens under your account.
- Give us a real email address — it's how you recover access.
- One account per person.
- You must be 18 or older.
- Tell us promptly if you think someone else has got in.

## Your data is yours

You own what you put into Sorrel. We don't claim any rights to it beyond what's needed to run the service for you — storing it, displaying it back to you, and backing it up.

You can export it or delete it whenever you like.

## What you may not do

- Try to access anyone else's account or data
- Probe, scan or test the security of the service without asking first
- Use Sorrel for anything illegal
- Resell or redistribute it
- Automate access in a way that degrades the service for others
- Upload malicious code

If you find a security problem, please tell us at hello@mysorrel.com rather than exploiting it. We'll take it seriously and we won't be annoyed.

## Ending things

**You** can delete your account at any time from Settings. That ends these terms.

**We** can suspend or close an account that breaks these terms, or close the beta entirely. Except where someone is causing harm, we'll give reasonable notice and a chance to export your data first.

## No warranty

Sorrel is provided "as is" and "as available", without warranties of any kind, express or implied, including fitness for a particular purpose and uninterrupted or error-free operation.

We don't warrant that the figures Sorrel produces are accurate. See "Sorrel is not financial advice" above.

## Limitation of liability

To the fullest extent permitted by law, MW Cyber Architects LLC is not liable for indirect, incidental, special or consequential damages, or for lost profits, lost data, or financial losses arising from your use of Sorrel — including decisions you made based on figures it displayed.

Sorrel is free during the beta. Our total liability to you will not exceed $100.

Some jurisdictions don't allow these limitations, in which case they apply to the greatest extent permitted.

## Governing law

These terms are governed by the laws of the State of Georgia, United States, without regard to conflict-of-law rules. Any dispute will be brought in the state or federal courts located in Georgia.

## Changes

We may update these terms. If a change is material we'll email you before it takes effect. Continuing to use Sorrel after that means you accept the revised terms.

## Contact

hello@mysorrel.com