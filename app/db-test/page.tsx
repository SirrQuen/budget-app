import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import {
  listAccounts,
  createAccount,
  getAccount,
  updateAccount,
  archiveAccount,
  listAccountBalances,
} from "@/lib/db/accounts";
import {
  listCategories,
  listCategoriesForType,
  getCategory,
  createCategory,
  updateCategory,
  archiveCategory,
  listCategoryGroups,
} from "@/lib/db/categories";
import {
  listBudgets,
  getBudget,
  createBudget,
  updateBudget,
  deleteBudget,
  getBudgetProgress,
} from "@/lib/db/budgets";
import {
  listTransactions,
  getTransaction,
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from "@/lib/db/transactions";
import {
  getProfile,
  updateProfile,
  checkUsernameAvailable,
  getSubscription,
  type UpdateProfilePatch,
} from "@/lib/db/profile";
import {
  getDashboardKpis,
  getNetWorth,
  getMonthlyCashflow,
  getDailyCashflow,
  getCategorySpending,
  getGoalProgress,
  getGoalsSummary,
  getUpcomingRecurring,
  getIntegrityIssues,
  getInvestmentHoldings,
  getPortfolioSummary,
} from "@/lib/db/dashboard";

// Every DbResult-returning function in lib/db/, called against whatever
// session cookies the browser sends in. Not a unit test suite -- it writes
// and cleans up real rows in the logged-in user's own data, over RLS, the
// same way a real request would.

type Expectation = "success" | "failure";

type TestEntry = {
  section: string;
  name: string;
  expect: Expectation;
  pass: boolean;
  data: unknown;
  error: string | null;
};

async function run<R extends { data: unknown; error: string | null }>(
  results: TestEntry[],
  section: string,
  name: string,
  expect: Expectation,
  fn: () => Promise<R>,
): Promise<R["data"]> {
  const { data, error } = await fn();
  const pass = expect === "success" ? error === null : error !== null;
  results.push({ section, name, expect, pass, data, error });
  return data;
}

function skip(results: TestEntry[], section: string, name: string, reason: string) {
  results.push({
    section,
    name,
    expect: "success",
    pass: false,
    data: null,
    error: `skipped: ${reason}`,
  });
}

type RawErrorDetail = {
  name: string;
  error: { message: string; code: string; details: string; hint: string } | null;
};

// lib/db functions collapse PostgrestError down to error.message before
// returning (see DbResult in each file), so code/details/hint never reach
// the UI through them. These three go around lib/db and hit the same
// table/view directly with the request-scoped client, purely to recover the
// fields that got dropped -- not how app code should query normally.
async function collectRawErrors(
  profileFirstName: string | null,
): Promise<RawErrorDetail[]> {
  const supabase = await createClient();
  const details: RawErrorDetail[] = [];

  function record(name: string, error: { message: string; code: string; details: string; hint: string } | null) {
    details.push({
      name,
      error:
        error == null
          ? null
          : { message: error.message, code: error.code, details: error.details, hint: error.hint },
    });
  }

  if (profileFirstName !== null) {
    const { error } = await supabase
      .from("profiles")
      .update({ first_name: profileFirstName })
      .select()
      .single();
    record("updateProfile() -- allowed field", error);
  } else {
    record("updateProfile() -- allowed field", null);
  }

  {
    const { error } = await supabase.from("subscriptions").select("*").single();
    record("getSubscription()", error);
  }

  {
    const { error } = await supabase.from("v_goals_summary").select("*").single();
    record("getGoalsSummary()", error);
  }

  return details;
}

// Not a component -- the App Router's purity check for components/hooks
// (new Date(), Date.now()) doesn't apply to a plain async function, and this
// is where the actual reads/writes happen. DbTestPage below just renders
// whatever it returns.
async function collectResults(): Promise<{
  user: Awaited<ReturnType<typeof requireUser>>;
  results: TestEntry[];
  rawErrors: RawErrorDetail[];
}> {
  const user = await requireUser();
  const results: TestEntry[] = [];

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const firstOfMonth = `${today.slice(0, 7)}-01`;

  // ---------------------------------------------------------------- Accounts
  await run(results, "Accounts", "listAccounts()", "success", () => listAccounts());

  const account = await run(results, "Accounts", "createAccount()", "success", () =>
    createAccount({
      account_name: "DB Test Account",
      account_type: "Checking",
      opening_balance: 0,
    }),
  );

  if (account) {
    await run(results, "Accounts", "getAccount()", "success", () => getAccount(account.id));
    await run(results, "Accounts", "updateAccount()", "success", () =>
      updateAccount(account.id, { account_name: "DB Test Account (renamed)" }),
    );
  } else {
    skip(results, "Accounts", "getAccount()", "no account created");
    skip(results, "Accounts", "updateAccount()", "no account created");
  }

  await run(results, "Accounts", "listAccountBalances()", "success", () =>
    listAccountBalances(),
  );

  // -------------------------------------------------------------- Categories
  await run(results, "Categories", "listCategories()", "success", () => listCategories());

  const expenseCategories = await run(
    results,
    "Categories",
    'listCategoriesForType("Expense")',
    "success",
    () => listCategoriesForType("Expense"),
  );
  const expenseCategory = expenseCategories?.[0] ?? null;

  const incomeCategories = await run(
    results,
    "Categories",
    'listCategoriesForType("Income")',
    "success",
    () => listCategoriesForType("Income"),
  );
  const incomeCategory = incomeCategories?.[0] ?? null;

  const groups = await run(results, "Categories", "listCategoryGroups()", "success", () =>
    listCategoryGroups(),
  );
  const group = groups?.[0] ?? null;

  if (expenseCategory) {
    await run(results, "Categories", "getCategory()", "success", () =>
      getCategory(expenseCategory.id),
    );
  } else {
    skip(results, "Categories", "getCategory()", "no expense category available");
  }

  let testCategory: Awaited<ReturnType<typeof createCategory>>["data"] = null;
  if (group) {
    testCategory = await run(results, "Categories", "createCategory()", "success", () =>
      createCategory({
        category_name: "DB Test Category",
        category_type: "Expense",
        groupid: group.id,
      }),
    );
  } else {
    skip(results, "Categories", "createCategory()", "no category group available");
  }

  if (testCategory) {
    await run(results, "Categories", "updateCategory()", "success", () =>
      updateCategory(testCategory.id, { category_name: "DB Test Category (renamed)" }),
    );
  } else {
    skip(results, "Categories", "updateCategory()", "no test category created");
  }

  // ----------------------------------------------------------------- Budgets
  await run(results, "Budgets", "listBudgets()", "success", () => listBudgets());

  let testBudget: Awaited<ReturnType<typeof createBudget>>["data"] = null;
  if (testCategory) {
    testBudget = await run(results, "Budgets", "createBudget()", "success", () =>
      createBudget({
        categoryid: testCategory.id,
        budget_month: firstOfMonth,
        budget_amount: 500,
      }),
    );
  } else {
    skip(results, "Budgets", "createBudget()", "no test category available");
  }

  if (testBudget) {
    await run(results, "Budgets", "getBudget()", "success", () => getBudget(testBudget.id));
    await run(results, "Budgets", "updateBudget()", "success", () =>
      updateBudget(testBudget.id, { budget_amount: 600 }),
    );
  } else {
    skip(results, "Budgets", "getBudget()", "no test budget created");
    skip(results, "Budgets", "updateBudget()", "no test budget created");
  }

  await run(results, "Budgets", "getBudgetProgress()", "success", () =>
    getBudgetProgress({ budget_month: firstOfMonth }),
  );

  if (testBudget) {
    await run(results, "Budgets", "deleteBudget()", "success", () =>
      deleteBudget(testBudget.id),
    );
  } else {
    skip(results, "Budgets", "deleteBudget()", "no test budget created");
  }

  if (testCategory) {
    await run(results, "Categories", "archiveCategory()", "success", () =>
      archiveCategory(testCategory.id),
    );
  } else {
    skip(results, "Categories", "archiveCategory()", "no test category created");
  }

  // ------------------------------------------------------------ Transactions
  await run(results, "Transactions", "listTransactions()", "success", () =>
    listTransactions(),
  );
  await run(
    results,
    "Transactions",
    "listTransactions({ dateFrom, dateTo })",
    "success",
    () => listTransactions({ dateFrom: monthAgo, dateTo: today }),
  );

  let testTransaction: Awaited<ReturnType<typeof createTransaction>>["data"] = null;
  if (account && expenseCategory) {
    testTransaction = await run(
      results,
      "Transactions",
      "createTransaction() -- valid category",
      "success",
      () =>
        createTransaction({
          accountid: account.id,
          categoryid: expenseCategory.id,
          transaction_type: "Expense",
          description: "DB test - valid create",
          amount: 42.5,
          transaction_date: today,
        }),
    );
  } else {
    skip(
      results,
      "Transactions",
      "createTransaction() -- valid category",
      "missing account or expense category",
    );
  }

  if (account && incomeCategory) {
    // Income category, Expense transaction_type -- enforce_category_type
    // should reject this. createTransaction pre-checks the category type
    // itself and returns a readable message before the insert ever runs.
    await run(
      results,
      "Transactions",
      "createTransaction() -- mismatched category type",
      "failure",
      () =>
        createTransaction({
          accountid: account.id,
          categoryid: incomeCategory.id,
          transaction_type: "Expense",
          description: "DB test - mismatched create",
          amount: 10,
          transaction_date: today,
        }),
    );
  } else {
    skip(
      results,
      "Transactions",
      "createTransaction() -- mismatched category type",
      "missing account or income category",
    );
  }

  if (testTransaction) {
    await run(results, "Transactions", "getTransaction()", "success", () =>
      getTransaction(testTransaction.id),
    );
    await run(results, "Transactions", "updateTransaction()", "success", () =>
      updateTransaction(testTransaction.id, { description: "DB test - updated" }),
    );
    await run(results, "Transactions", "deleteTransaction()", "success", () =>
      deleteTransaction(testTransaction.id),
    );
  } else {
    skip(results, "Transactions", "getTransaction()", "no test transaction created");
    skip(results, "Transactions", "updateTransaction()", "no test transaction created");
    skip(results, "Transactions", "deleteTransaction()", "no test transaction created");
  }

  // ----------------------------------------------------------------- Profile
  const profile = await run(results, "Profile", "getProfile()", "success", () => getProfile());

  if (profile) {
    await run(results, "Profile", "updateProfile() -- allowed field", "success", () =>
      updateProfile({ first_name: profile.first_name }),
    );
  } else {
    skip(results, "Profile", "updateProfile() -- allowed field", "no profile loaded");
  }

  // Deliberately bypassing the compile-time restriction on UpdateProfilePatch
  // (profile.ts only types the grant-allowed columns) to prove the DB
  // column grant, not just the app's TS types, is what actually blocks this.
  const forbiddenPatch = { subscription_plan: "Premium" } as unknown as UpdateProfilePatch;
  await run(results, "Profile", "updateProfile() -- subscription_plan", "failure", () =>
    updateProfile(forbiddenPatch),
  );

  await run(
    results,
    "Profile",
    "checkUsernameAvailable()",
    "success",
    () => checkUsernameAvailable(`db-test-probe-${Date.now()}`),
  );

  await run(results, "Profile", "getSubscription()", "success", () => getSubscription());

  // --------------------------------------------------------------- Dashboard
  await run(results, "Dashboard", "getDashboardKpis()", "success", () => getDashboardKpis());
  await run(results, "Dashboard", "getNetWorth()", "success", () => getNetWorth());
  await run(results, "Dashboard", "getMonthlyCashflow()", "success", () =>
    getMonthlyCashflow(),
  );
  await run(results, "Dashboard", "getDailyCashflow()", "success", () => getDailyCashflow());
  await run(results, "Dashboard", "getCategorySpending()", "success", () =>
    getCategorySpending(),
  );
  await run(results, "Dashboard", "getGoalProgress()", "success", () => getGoalProgress());
  await run(results, "Dashboard", "getGoalsSummary()", "success", () => getGoalsSummary());
  await run(results, "Dashboard", "getUpcomingRecurring()", "success", () =>
    getUpcomingRecurring(),
  );
  await run(results, "Dashboard", "getIntegrityIssues()", "success", () =>
    getIntegrityIssues(),
  );
  await run(results, "Dashboard", "getInvestmentHoldings()", "success", () =>
    getInvestmentHoldings(),
  );
  await run(results, "Dashboard", "getPortfolioSummary()", "success", () =>
    getPortfolioSummary(),
  );

  // ----------------------------------------------------------------- Cleanup
  if (account) {
    await run(results, "Accounts", "archiveAccount()", "success", () =>
      archiveAccount(account.id),
    );
  } else {
    skip(results, "Accounts", "archiveAccount()", "no account created");
  }

  const rawErrors = await collectRawErrors(profile?.first_name ?? null);

  return { user, results, rawErrors };
}

export default async function DbTestPage() {
  const { user, results, rawErrors } = await collectResults();
  const passCount = results.filter((r) => r.pass).length;
  const sections = [...new Set(results.map((r) => r.section))];

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <h1 className="text-xl font-semibold">lib/db smoke test</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Running as {user.email}. {passCount}/{results.length} passed.
      </p>

      {sections.map((section) => (
        <section key={section} className="mt-8">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
            {section}
          </h2>
          <div className="mt-2 divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {results
              .filter((r) => r.section === section)
              .map((r, i) => (
                <details key={i} className="p-3">
                  <summary className="flex cursor-pointer items-center justify-between gap-3">
                    <span className="font-mono text-sm">{r.name}</span>
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-zinc-500">expect {r.expect}</span>
                      <span
                        className={
                          "inline-block rounded px-2 py-0.5 font-semibold " +
                          (r.pass
                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200")
                        }
                      >
                        {r.pass ? "PASS" : "FAIL"}
                      </span>
                    </span>
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">
                    {JSON.stringify({ data: r.data, error: r.error }, null, 2)}
                  </pre>
                </details>
              ))}
          </div>
        </section>
      ))}

      <section className="mt-8">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
          Raw error detail (Postgres)
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          lib/db collapses PostgrestError to just `error.message`. These re-run the same
          three failing reads/writes directly against Supabase to recover code/details/hint.
        </p>
        <div className="mt-2 divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rawErrors.map((r, i) => (
            <div key={i} className="p-3">
              <div className="font-mono text-sm">{r.name}</div>
              <pre className="mt-2 overflow-x-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">
                {JSON.stringify(r.error, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
