// Which unbanked cash and check payments make up one bank deposit (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md section 5.6).
// Pure: no database, no React. Integer cents only.
//
// A deposit line is solved as a BOUNDED subset-sum over the payments recorded but not yet on the bank (the rows of
// app.suggest_deposit_payments). The preference, in order:
//   1. all the candidates, when they add up exactly (then nothing else can: every amount is positive);
//   2. otherwise the sets that add up exactly, oldest payments first (FIFO): the search takes the oldest payment first, so the
//      sets come out already in that order;
//   3. at most 3 sets are returned. When more than one set fits, the screen says so and CHOOSES NOTHING: the person picks.
// The search is bounded two ways, and says when a bound was reached, so "only one combination fits" is never claimed on a guess:
//   - at most MAX_CANDIDATES payments are searched (the oldest 40; the rest are named as left out);
//   - at most MAX_NODES steps of the search.
// Nothing here moves money. The set is only proposed; the person ticks it and the existing match_deposit does the rest, which asks the
// database to check the total to the cent again.

export const MAX_CANDIDATES = 40;
export const MAX_NODES = 200_000;
export const MAX_SETS = 3;

export type DepositPayment = {
  id: string;
  amountCents: number;
  /** The day the payment was received (YYYY-MM-DD); older first. */
  receivedOn: string | null;
  /** Receipt number, the final tiebreak for a stable order. */
  receipt?: string | null;
};

export type DepositSets = {
  /** Up to MAX_SETS sets of payment ids, in the order they are preferred. Empty when none adds up. */
  sets: string[][];
  /** All the candidates add up to the deposit: the first and only set. */
  allFit: boolean;
  /** More than one set fits (or the search stopped early after finding one): nothing should be chosen for the person. */
  ambiguous: boolean;
  /** The search looked at every combination of the payments it considered. False when the step bound stopped it. */
  complete: boolean;
  /** How many payments were searched, and how many were left out because there were more than MAX_CANDIDATES. */
  searched: number;
  leftOut: number;
};

const none = (searched: number, leftOut: number, complete: boolean): DepositSets => ({ sets: [], allFit: false, ambiguous: false, complete, searched, leftOut });

function oldestFirst(a: DepositPayment, b: DepositPayment): number {
  return (a.receivedOn ?? "9999-12-31").localeCompare(b.receivedOn ?? "9999-12-31") || (a.receipt ?? "").localeCompare(b.receipt ?? "") || a.id.localeCompare(b.id);
}

export function findDepositSets(
  payments: readonly DepositPayment[],
  targetCents: number,
  opts: { maxCandidates?: number; maxNodes?: number; maxSets?: number } = {},
): DepositSets {
  const maxCandidates = opts.maxCandidates ?? MAX_CANDIDATES;
  const maxNodes = opts.maxNodes ?? MAX_NODES;
  const maxSets = opts.maxSets ?? MAX_SETS;

  if (!Number.isSafeInteger(targetCents) || targetCents <= 0) return none(0, 0, true);
  // Only whole, positive amounts can be part of a deposit.
  const usable = payments.filter((p) => Number.isSafeInteger(p.amountCents) && p.amountCents > 0).sort(oldestFirst);
  if (usable.length === 0) return none(0, 0, true);

  // 1. Prefer all the candidates. Every amount is positive, so if they add up, no smaller set can: this is the only answer.
  const all = usable.reduce((s, p) => s + p.amountCents, 0);
  if (all === targetCents) return { sets: [usable.map((p) => p.id)], allFit: true, ambiguous: false, complete: true, searched: usable.length, leftOut: 0 };

  // 2. Otherwise search the oldest MAX_CANDIDATES payments.
  const items = usable.slice(0, maxCandidates);
  const leftOut = usable.length - items.length;
  const n = items.length;
  // suffix[i] = what items i.. add up to: a branch that cannot reach the target any more is cut.
  const suffix = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + items[i].amountCents;

  const found: number[][] = [];
  const picked: number[] = [];
  let nodes = 0;
  let stopped = false;
  // Ask for one more than we show, to know that "more than the sets listed" fit.
  const want = maxSets + 1;

  const walk = (i: number, need: number): void => {
    if (stopped) return;
    if (need === 0) {
      found.push([...picked]);
      if (found.length >= want) stopped = true;
      return;
    }
    if (i >= n || need < 0 || suffix[i] < need) return;
    if (++nodes > maxNodes) {
      stopped = true;
      return;
    }
    // Take the older payment first, then leave it out: the sets are found oldest-first.
    picked.push(i);
    walk(i + 1, need - items[i].amountCents);
    picked.pop();
    walk(i + 1, need);
  };
  walk(0, targetCents);

  const hitBound = nodes > maxNodes;
  const enough = found.length >= want;
  const complete = !hitBound && !enough && leftOut === 0;
  if (found.length === 0) return none(n, leftOut, !hitBound && leftOut === 0);
  const sets = found.slice(0, maxSets).map((idx) => idx.map((k) => items[k].id));
  // Nothing is chosen for the person when several fit, or when one fits but the search did not finish (another may exist).
  return { sets, allFit: false, ambiguous: sets.length > 1 || !complete, complete, searched: n, leftOut };
}

/** What the screen says about the result, in words a treasurer reads. */
export function depositSetsSentence(r: DepositSets, count: (n: number) => string): string {
  if (r.allFit) return `All ${r.searched} recorded payments add up exactly to the deposit.`;
  if (r.sets.length === 0) {
    if (!r.complete) return "No combination was found in the time allowed. Tick the payments by hand.";
    return "No combination of the recorded payments adds up to this deposit. Tick the payments by hand, or record the missing payment first.";
  }
  if (r.sets.length === 1 && r.complete) return `Only one set of recorded payments adds up to this deposit: ${count(r.sets[0].length)}.`;
  if (r.sets.length === 1) return `One set of ${count(r.sets[0].length)} adds up, but the search did not look at every combination, so another may fit. Check it before you use it.`;
  const shown = r.sets.length;
  const more = !r.complete && shown === MAX_SETS ? " or more" : "";
  return `${shown}${more} combinations add up to this deposit. Nothing is chosen for you: look at each and pick the one that matches the bank slip.`;
}
