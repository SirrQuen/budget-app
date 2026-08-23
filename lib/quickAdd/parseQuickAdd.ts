import { addDaysISO } from "@/lib/date";
import { formatDate } from "@/lib/format";

export type ParsedQuickAdd =
  | {
      ok: true;
      amount: number;
      transaction_type: "Income" | "Expense";
      merchant: string;
      transaction_date: string;
      dateLabel: string;
    }
  | { ok: false; reason: string };

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_ABBR = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const INCOME_KEYWORDS = /\b(income|salary|paycheck|refund|deposit|reimbursement)\b/;

const AMOUNT_RE = /(?:^|\s)([+-]?\$?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)(?=\s|$)/g;

type DateMatch = { text: string; index: number; date: string };

function weekdayIndex(name: string): number {
  const full = WEEKDAYS.indexOf(name);
  return full !== -1 ? full : WEEKDAY_ABBR.indexOf(name);
}

function monthIndex(name: string): number {
  const full = MONTHS.indexOf(name);
  return full !== -1 ? full : MONTH_ABBR.indexOf(name);
}

// Validates a calendar date the same way the DB would reject "Feb 30" --
// the JS Date constructor silently rolls invalid days into the next month,
// so round-tripping the parts back out is how the rollover gets caught.
function resolveCalendarDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// A bare "8/20" with no year is almost always meant as the most recent
// occurrence -- if that reads as more than a day in the future, the user
// meant last year, not next year (transactions are logged after the fact).
function nearestPast(dateISO: string, todayISO: string, yearExplicit: boolean): string {
  if (yearExplicit || dateISO <= addDaysISO(todayISO, 1)) {
    return dateISO;
  }
  const [year, month, day] = dateISO.split("-").map(Number);
  return resolveCalendarDate(year - 1, month, day) ?? dateISO;
}

function findDateMatches(lower: string, todayISO: string): DateMatch[] {
  const matches: DateMatch[] = [];

  const today = /\btoday\b/.exec(lower);
  if (today) matches.push({ text: today[0], index: today.index, date: todayISO });

  const yesterday = /\byesterday\b/.exec(lower);
  if (yesterday) {
    matches.push({ text: yesterday[0], index: yesterday.index, date: addDaysISO(todayISO, -1) });
  }

  const weekdayRe = new RegExp(`\\b(${[...WEEKDAYS, ...WEEKDAY_ABBR].join("|")})\\b`);
  const weekday = weekdayRe.exec(lower);
  if (weekday) {
    const target = weekdayIndex(weekday[1]);
    const todayIdx = new Date(`${todayISO}T00:00:00`).getDay();
    const diff = (todayIdx - target + 7) % 7;
    matches.push({ text: weekday[0], index: weekday.index, date: addDaysISO(todayISO, -diff) });
  }

  const numericRe = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/;
  const numeric = numericRe.exec(lower);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const yearExplicit = Boolean(numeric[3]);
    const year = yearExplicit ? Number(numeric[3]) : new Date(`${todayISO}T00:00:00`).getFullYear();
    const resolved = resolveCalendarDate(year, month, day);
    if (resolved) {
      matches.push({
        text: numeric[0],
        index: numeric.index,
        date: nearestPast(resolved, todayISO, yearExplicit),
      });
    }
  }

  const monthGroup = [...MONTHS, ...MONTH_ABBR].join("|");
  const monthFirstRe = new RegExp(`\\b(${monthGroup})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`);
  const monthFirst = monthFirstRe.exec(lower);
  const dayFirstRe = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthGroup})\\.?(?:,?\\s+(\\d{4}))?\\b`);
  const dayFirst = monthFirst ? null : dayFirstRe.exec(lower);

  if (monthFirst) {
    const month = monthIndex(monthFirst[1]);
    const day = Number(monthFirst[2]);
    const yearExplicit = Boolean(monthFirst[3]);
    const year = yearExplicit ? Number(monthFirst[3]) : new Date(`${todayISO}T00:00:00`).getFullYear();
    const resolved = month !== -1 ? resolveCalendarDate(year, month + 1, day) : null;
    if (resolved) {
      matches.push({
        text: monthFirst[0],
        index: monthFirst.index,
        date: nearestPast(resolved, todayISO, yearExplicit),
      });
    }
  } else if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = monthIndex(dayFirst[2]);
    const yearExplicit = Boolean(dayFirst[3]);
    const year = yearExplicit ? Number(dayFirst[3]) : new Date(`${todayISO}T00:00:00`).getFullYear();
    const resolved = month !== -1 ? resolveCalendarDate(year, month + 1, day) : null;
    if (resolved) {
      matches.push({
        text: dayFirst[0],
        index: dayFirst.index,
        date: nearestPast(resolved, todayISO, yearExplicit),
      });
    }
  }

  return matches;
}

// Two regexes can both match the same physical token (e.g. a weekday name
// embedded in a longer phrase) -- only genuinely separate spans count as
// more than one date.
function dedupeOverlapping(matches: DateMatch[]): DateMatch[] {
  const sorted = [...matches].sort((a, b) => a.index - b.index);
  const result: DateMatch[] = [];
  for (const m of sorted) {
    const last = result[result.length - 1];
    const overlaps = last && m.index < last.index + last.text.length;
    if (!overlaps) result.push(m);
  }
  return result;
}

function blank(text: string, start: number, length: number): string {
  return text.slice(0, start) + " ".repeat(length) + text.slice(start + length);
}

function dateLabelFor(dateISO: string, todayISO: string): string {
  if (dateISO === todayISO) return "Today";
  if (dateISO === addDaysISO(todayISO, -1)) return "Yesterday";
  return formatDate(dateISO);
}

export function parseQuickAdd(input: string, todayISO: string): ParsedQuickAdd {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    return { ok: false, reason: "Start typing an amount and what it was for." };
  }

  const lower = trimmedInput.toLowerCase();
  const dateMatches = dedupeOverlapping(findDateMatches(lower, todayISO));

  if (dateMatches.length > 1) {
    return { ok: false, reason: "Found more than one date — which is it?" };
  }

  let working = trimmedInput;
  let transactionDate = todayISO;

  if (dateMatches.length === 1) {
    const match = dateMatches[0];
    transactionDate = match.date;
    working = blank(working, match.index, match.text.length);
  }

  const amountMatches = [...working.matchAll(AMOUNT_RE)];
  if (amountMatches.length === 0) {
    return { ok: false, reason: "Add an amount." };
  }
  if (amountMatches.length > 1) {
    return { ok: false, reason: "Found more than one number — which is the amount?" };
  }

  const amountMatch = amountMatches[0];
  const rawAmount = amountMatch[1];
  // The regex's leading (?:^|\s) may consume a whitespace char before the
  // captured group -- find where the group actually starts within the
  // full match rather than assuming it's at index 0.
  const groupStart = amountMatch.index + amountMatch[0].indexOf(rawAmount);
  const groupEnd = groupStart + rawAmount.length;
  const isIncomeSign = rawAmount.startsWith("+");
  const numeric = Number(rawAmount.replace(/[+$,]/g, ""));

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { ok: false, reason: "Amount must be more than zero." };
  }

  working = blank(working, groupStart, groupEnd - groupStart);

  const transactionType: "Income" | "Expense" =
    isIncomeSign || INCOME_KEYWORDS.test(lower) ? "Income" : "Expense";

  const merchant = working.replace(/\s+/g, " ").trim();
  if (!merchant) {
    return { ok: false, reason: "What was it for?" };
  }

  return {
    ok: true,
    amount: numeric,
    transaction_type: transactionType,
    merchant,
    transaction_date: transactionDate,
    dateLabel: dateLabelFor(transactionDate, todayISO),
  };
}
