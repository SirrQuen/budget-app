import { addDaysISO, monthStartISO, parseLocalDate } from "@/lib/date";
import { formatCurrencyInSentence } from "@/lib/format";

// "Your month, as a story" (docs/Motion-and-Delight.md, step 9): a few
// cards looking back at last month, shown the first time the app opens in
// the first 7 days of a month. Pure -- the figures come from month_story()
// (migration 71) and getSafeToSpend(), already summed; this decides which
// month, whether it shows, and which cards say something.
//
// Only good news or plain facts. A card with nothing positive or neutral
// to say is LEFT OUT; below RECAP_MIN_LOGS hand logs there is no recap at
// all. Never "you overspent", never a comparison with last month or with
// anyone else, never a colour that describes the money.

/** Fewer hand-logged transactions than this in the month: no recap. */
export const RECAP_MIN_LOGS = 5;

/** The recap shows on days 1..RECAP_DAYS of a month, in the user's day. */
export const RECAP_DAYS = 7;

/** First day of the month before the one `today` is in. */
export function previousMonthStart(today: string): string {
  return monthStartISO(addDaysISO(monthStartISO(today), -1));
}

/** The month to recap today, or null outside the first RECAP_DAYS days. */
export function recapMonthFor(today: string): string | null {
  return Number(today.slice(8, 10)) <= RECAP_DAYS ? previousMonthStart(today) : null;
}

/**
 * Done or close dismisses the recap for its month. Named with the month,
 * so next month's starts unseen. Set by the client (MonthRecap), read by
 * the dashboard render, which never writes.
 */
export function recapCookieName(monthStart: string): string {
  return `sorrel_recap_seen_${monthStart.slice(0, 7)}`;
}

/** "October" for "2026-10-01". */
export function monthName(monthStart: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long" }).format(parseLocalDate(monthStart));
}

// ---------------------------------------------------------------------------
// month_story()'s row, checked at the edge
// ---------------------------------------------------------------------------

export type StoryGoal = { goalId: string; name: string; amount: number; pctByMonthEnd: number };
export type StoryCard = { goalId: string; cardName: string; amount: number };
export type MonthStory = {
  monthStart: string;
  logs: number;
  goalTotal: number;
  goals: StoryGoal[];
  cards: StoryCard[];
};

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * month_story()'s one row, or null when it doesn't have the expected
 * shape -- an unreadable recap is no recap, never a wrong figure. The
 * money arrives summed in SQL (numeric); nothing here adds it up.
 */
export function parseMonthStory(row: {
  month_start: unknown;
  logs: unknown;
  goal_total: unknown;
  goals: unknown;
  cards: unknown;
}): MonthStory | null {
  const monthStart = str(row.month_start);
  const logs = num(row.logs);
  const goalTotal = num(row.goal_total);
  if (monthStart === null || logs === null || goalTotal === null) return null;
  if (!Array.isArray(row.goals) || !Array.isArray(row.cards)) return null;

  const goals: StoryGoal[] = [];
  for (const g of row.goals as Record<string, unknown>[]) {
    const goalId = str(g?.goal_id);
    const name = str(g?.name);
    const amount = num(g?.amount);
    const pct = num(g?.pct_by_month_end);
    if (goalId === null || name === null || amount === null || pct === null) return null;
    goals.push({ goalId, name, amount, pctByMonthEnd: pct });
  }
  const cards: StoryCard[] = [];
  for (const c of row.cards as Record<string, unknown>[]) {
    const goalId = str(c?.goal_id);
    const cardName = str(c?.card_name);
    const amount = num(c?.amount);
    if (goalId === null || cardName === null || amount === null) return null;
    cards.push({ goalId, cardName, amount });
  }
  return { monthStart, logs, goalTotal, goals, cards };
}

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

/**
 * One card. `figure` is the card's one big number (null on the opening
 * card); `before` and `after` wrap it into a sentence, and `sentence` is
 * the whole thing for a screen reader. `shareLine` is what the share image
 * says with amounts shown, `shareLineHidden` without -- null when the card
 * says nothing without its amount, so it's left off that image.
 */
export type RecapCard = {
  id: string;
  before: string;
  figure: string | null;
  after: string;
  sentence: string;
  shareLine: string | null;
  shareLineHidden: string | null;
  meter?: { name: string; pct: number };
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * The recap's cards, in order, or null when there's no recap (fewer than
 * RECAP_MIN_LOGS logs). `safeToSpend` is today's figure, or null when it
 * couldn't be read: its card is left out then, as it is at $0.
 */
export function buildRecapCards(story: MonthStory, safeToSpend: number | null): RecapCard[] | null {
  if (story.logs < RECAP_MIN_LOGS) return null;
  const month = monthName(story.monthStart);
  const cards: RecapCard[] = [];

  cards.push({
    id: "intro",
    before: `Your ${month}`,
    figure: null,
    after: "A look back at your month",
    sentence: `Your ${month}. A look back at your month.`,
    shareLine: null,
    shareLineHidden: null,
  });

  const times = plural(story.logs, "time", "times");
  cards.push({
    id: "logs",
    before: "You logged",
    figure: String(story.logs),
    after: `${times} in ${month}.`,
    sentence: `You logged ${story.logs} ${times} in ${month}.`,
    // A count, not an amount: shown either way.
    shareLine: `Logged ${story.logs} ${times}`,
    shareLineHidden: `Logged ${story.logs} ${times}`,
  });

  const top = story.goals[0];
  if (top && story.goalTotal > 0) {
    const total = formatCurrencyInSentence(story.goalTotal);
    const single = story.goals.length === 1;
    const after = single
      ? `for ${top.name}.`
      : `for your goals, ${formatCurrencyInSentence(top.amount)} of it for ${top.name}.`;
    cards.push({
      id: "goals",
      before: "You set aside",
      figure: total,
      after,
      sentence: `You set aside ${total} ${after}`,
      shareLine: single ? `Set aside ${total} for ${top.name}` : `Set aside ${total} for my goals`,
      shareLineHidden: single ? `Set money aside for ${top.name}` : "Set money aside for my goals",
      meter: { name: top.name, pct: Math.min(100, Math.max(0, top.pctByMonthEnd)) },
    });
  }

  for (const card of story.cards) {
    // month_story() only returns a card whose debt went down; this is the
    // guard that a rise is never shown, whatever the source says.
    if (!(card.amount > 0)) continue;
    const amount = formatCurrencyInSentence(card.amount);
    cards.push({
      id: `card-${card.goalId}`,
      before: `You paid ${card.cardName} down by`,
      figure: amount,
      after: `in ${month}.`,
      sentence: `You paid ${card.cardName} down by ${amount} in ${month}.`,
      shareLine: `Paid ${card.cardName} down by ${amount}`,
      shareLineHidden: `Paid ${card.cardName} down`,
    });
  }

  if (safeToSpend !== null && safeToSpend > 0) {
    const amount = formatCurrencyInSentence(safeToSpend);
    cards.push({
      id: "closing",
      before: "Right now, you have",
      figure: amount,
      after: "safe to spend.",
      sentence: `Right now, you have ${amount} safe to spend.`,
      shareLine: `${amount} safe to spend right now`,
      // Nothing to say about it without the figure.
      shareLineHidden: null,
    });
  }

  return cards;
}

/** The share image's title line: "My October". */
export function shareTitle(story: MonthStory): string {
  return `My ${monthName(story.monthStart)}`;
}

/** The lines the share image draws, in order. */
export function shareLines(cards: RecapCard[], showAmounts: boolean): string[] {
  return cards.flatMap((c) => {
    const line = showAmounts ? c.shareLine : c.shareLineHidden;
    return line === null ? [] : [line];
  });
}
