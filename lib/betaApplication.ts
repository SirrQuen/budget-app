// The beta application (/beta, docs/Beta-Application.md): every question,
// its options and their stored codes, and the one validation rule shared
// by the form (a convenience) and the server action (the gate). Pure --
// safe to import from a Client Component.
//
// The codes are the database's lists too: migration 75 checks each column
// against them, and lib/betaApplication.test.ts reads those lists back out
// of the migration and compares. Change both together.

import { normaliseWaitlistEmail } from "@/lib/waitlistValidation";

export const BETA_NAME_MAX = 100;

export type BetaOption = { code: string; label: string };

type QuestionBase = {
  /** The form field name, and the key of its error. */
  name: BetaChoiceField;
  legend: string;
  options: readonly BetaOption[];
  /** What the inline error says when it's unanswered. */
  missing: string;
};

export type BetaQuestion = QuestionBase & {
  kind: "one" | "many";
  /** Chips in a wrapping row (the age range), else the card grid. */
  layout?: "chips";
  hint?: string;
};

export type BetaChoiceField =
  | "age_range"
  | "describes"
  | "experience"
  | "money_methods"
  | "challenge"
  | "want"
  | "availability"
  | "comfortable"
  | "frequency"
  | "reason";

export type BetaField = "full_name" | "email" | BetaChoiceField | "consent";

export const BETA_QUESTIONS: Record<BetaChoiceField, BetaQuestion> = {
  age_range: {
    name: "age_range",
    kind: "one",
    layout: "chips",
    legend: "Which age range are you in?",
    missing: "Pick your age range.",
    options: [
      { code: "age_18_24", label: "18–24" },
      { code: "age_25_34", label: "25–34" },
      { code: "age_35_44", label: "35–44" },
      { code: "age_45_54", label: "45–54" },
      { code: "age_55_plus", label: "55+" },
    ],
  },
  describes: {
    name: "describes",
    kind: "one",
    legend: "Which best describes you?",
    missing: "Pick the one that fits best.",
    options: [
      { code: "describes_young_adult", label: "Young adult" },
      { code: "describes_working_professional", label: "Working professional" },
      { code: "describes_household", label: "Parent or managing household finances" },
      { code: "describes_experienced_budgeter", label: "Experienced budgeter" },
      { code: "describes_small_business", label: "Small business owner" },
      { code: "describes_new_to_budgeting", label: "New to budgeting" },
      { code: "describes_other", label: "Other" },
    ],
  },
  experience: {
    name: "experience",
    kind: "one",
    legend: "How would you describe your budgeting experience?",
    missing: "Pick the one that fits best.",
    options: [
      { code: "experience_beginner", label: "Beginner" },
      { code: "experience_some", label: "Some experience" },
      { code: "experience_experienced", label: "Experienced" },
      { code: "experience_very", label: "Very experienced" },
    ],
  },
  money_methods: {
    name: "money_methods",
    kind: "many",
    legend: "How do you manage your money today?",
    hint: "Pick all that apply",
    missing: "Pick at least one.",
    options: [
      { code: "method_spreadsheet", label: "Spreadsheet" },
      { code: "method_app", label: "Budgeting app or software" },
      { code: "method_paper", label: "Paper or notebook" },
      { code: "method_banking_app", label: "Banking app" },
      { code: "method_none", label: "I don't follow a budget right now" },
      { code: "method_other", label: "Other" },
    ],
  },
  challenge: {
    name: "challenge",
    kind: "one",
    legend: "What's your biggest money challenge?",
    missing: "Pick the one that fits best.",
    options: [
      { code: "challenge_safe_to_spend", label: "Knowing how much I can safely spend" },
      { code: "challenge_tracking", label: "Keeping track of where my money goes" },
      { code: "challenge_sticking", label: "Sticking to a budget" },
      { code: "challenge_bills", label: "Bills and due dates sneaking up on me" },
      { code: "challenge_saving", label: "Saving toward a goal" },
      { code: "challenge_debt", label: "Paying down debt" },
      { code: "challenge_variable_income", label: "Income that changes from month to month" },
      { code: "challenge_other", label: "Other" },
    ],
  },
  want: {
    name: "want",
    kind: "one",
    legend: "What would you most like a budgeting app to help you do?",
    missing: "Pick the one that fits best.",
    options: [
      { code: "want_safe_to_spend", label: "Know what's safe to spend, day to day" },
      { code: "want_plan_bills", label: "Plan ahead for upcoming bills" },
      { code: "want_all_accounts", label: "See all my accounts in one place" },
      { code: "want_savings", label: "Build savings toward a goal" },
      { code: "want_pay_debt", label: "Pay off debt" },
      { code: "want_less_stress", label: "Feel less stressed about money" },
      { code: "want_habits", label: "Build better money habits" },
      { code: "want_other", label: "Other" },
    ],
  },
  availability: {
    name: "availability",
    kind: "one",
    legend: "Can you actively test Sorrel for 3–4 weeks?",
    missing: "Pick an answer.",
    options: [
      { code: "available_yes", label: "Yes" },
      { code: "available_possibly", label: "Possibly" },
      { code: "available_no", label: "No" },
    ],
  },
  comfortable: {
    name: "comfortable",
    kind: "one",
    legend:
      "Are you comfortable exploring features, entering sample transactions and giving honest feedback?",
    missing: "Pick an answer.",
    options: [
      { code: "comfortable_yes", label: "Yes" },
      { code: "comfortable_no", label: "No" },
    ],
  },
  frequency: {
    name: "frequency",
    kind: "one",
    legend: "How often do you think you'll use Sorrel during the test?",
    missing: "Pick an answer.",
    options: [
      { code: "frequency_daily", label: "Daily" },
      { code: "frequency_few_weekly", label: "A few times a week" },
      { code: "frequency_weekly", label: "Once a week" },
      { code: "frequency_not_sure", label: "Not sure" },
    ],
  },
  reason: {
    name: "reason",
    kind: "one",
    legend: "Why would you like to join the beta?",
    missing: "Pick the one that fits best.",
    options: [
      { code: "reason_better_way", label: "I want a better way to manage my money" },
      { code: "reason_try_early", label: "I like trying new apps early" },
      { code: "reason_shape_product", label: "I want to help shape a new product" },
      { code: "reason_safe_to_spend", label: "The “safe to spend” idea caught my eye" },
      { code: "reason_recommended", label: "Someone recommended Sorrel to me" },
      { code: "reason_other", label: "Other" },
    ],
  },
};

export type BetaSection = { number: number; title: string; fields: readonly BetaField[] };

// In page order. A section is complete when every field in it is answered;
// the progress line counts complete sections.
export const BETA_SECTIONS: readonly BetaSection[] = [
  { number: 1, title: "About you", fields: ["full_name", "email", "age_range", "describes"] },
  {
    number: 2,
    title: "Your budgeting",
    fields: ["experience", "money_methods", "challenge", "want"],
  },
  { number: 3, title: "Your availability", fields: ["availability", "comfortable", "frequency"] },
  { number: 4, title: "Last one", fields: ["reason", "consent"] },
];

/** Every field, in page order -- the order the error summary lists them. */
export const BETA_FIELD_ORDER: readonly BetaField[] = BETA_SECTIONS.flatMap((s) => s.fields);

/** The summary's name for a field: its label or question. */
export function betaFieldLabel(field: BetaField): string {
  if (field === "full_name") return "Full name";
  if (field === "email") return "Email address";
  if (field === "consent") return "Consent to email about the beta";
  return BETA_QUESTIONS[field].legend;
}

export type BetaAnswers = {
  full_name: string;
  email: string;
  age_range: string;
  describes: string;
  experience: string;
  money_methods: string[];
  challenge: string;
  want: string;
  availability: string;
  comfortable: string;
  frequency: string;
  reason: string;
  consent: boolean;
};

export const EMPTY_BETA_ANSWERS: BetaAnswers = {
  full_name: "",
  email: "",
  age_range: "",
  describes: "",
  experience: "",
  money_methods: [],
  challenge: "",
  want: "",
  availability: "",
  comfortable: "",
  frequency: "",
  reason: "",
  consent: false,
};

export type BetaErrors = Partial<Record<BetaField, string>>;

export type BetaApplication = Omit<BetaAnswers, "consent"> & { consent: true };

export type BetaValidation =
  | { ok: true; application: BetaApplication }
  | { ok: false; errors: BetaErrors };

function codeOn(field: BetaChoiceField, value: unknown): value is string {
  return typeof value === "string" && BETA_QUESTIONS[field].options.some((o) => o.code === value);
}

/**
 * The rule, field by field. Name: trimmed, 1-100 characters. Email: the
 * waitlist's rule (trimmed, lower-cased, plausible). Each "pick one" a code
 * on its list; "pick all" at least one, every element on the list, repeats
 * dropped. Consent ticked.
 */
export function validateBetaApplication(answers: BetaAnswers): BetaValidation {
  const errors: BetaErrors = {};

  const fullName = answers.full_name.trim();
  if (!fullName) errors.full_name = "Enter your full name.";
  else if (fullName.length > BETA_NAME_MAX)
    errors.full_name = `Keep it to ${BETA_NAME_MAX} characters.`;

  const email = normaliseWaitlistEmail(answers.email);
  if (email.error !== null) errors.email = email.error;

  for (const question of Object.values(BETA_QUESTIONS)) {
    if (question.kind === "many") continue;
    if (!codeOn(question.name, answers[question.name])) errors[question.name] = question.missing;
  }

  const methods = [...new Set(answers.money_methods)];
  if (methods.length === 0 || !methods.every((m) => codeOn("money_methods", m))) {
    errors.money_methods = BETA_QUESTIONS.money_methods.missing;
  }

  if (answers.consent !== true) {
    errors.consent = "Tick the box so we can email you about the beta.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    application: { ...answers, full_name: fullName, email: email.email!, money_methods: methods, consent: true },
  };
}

/** Is every field in this section answered? Drives the progress line. */
export function betaSectionComplete(section: BetaSection, answers: BetaAnswers): boolean {
  const result = validateBetaApplication(answers);
  if (result.ok) return true;
  return section.fields.every((field) => result.errors[field] === undefined);
}

/** Reads the form's fields, and only those, into answers. */
export function betaAnswersFromFormData(formData: FormData): BetaAnswers {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    full_name: text("full_name"),
    email: text("email"),
    age_range: text("age_range"),
    describes: text("describes"),
    experience: text("experience"),
    money_methods: formData.getAll("money_methods").filter((v): v is string => typeof v === "string"),
    challenge: text("challenge"),
    want: text("want"),
    availability: text("availability"),
    comfortable: text("comfortable"),
    frequency: text("frequency"),
    reason: text("reason"),
    consent: text("consent") === "yes",
  };
}

/** The thank-you's name: the first word of the full name as typed. */
export function betaFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}
