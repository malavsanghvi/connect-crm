// The two numbers Home and Giving's Today show for payment proofs (migration 0866 payment_proof_counts) and for money that is
// recorded as paid but not on a bank statement yet (0868 unbanked_counts). Pure: the loaders in src/lib/data/home-tasks.ts read
// the database, these parse and word the answers. Anything that is not a whole number reads as 0, never as a made-up figure.

export type ProofCounts = { waiting: number; needsInfo: number; stale: number; oldestDays: number };
export type UnbankedCounts = { total: number; pastWindow: number; oldestDays: number };

function whole(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function parseProofCounts(data: unknown): ProofCounts {
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return { waiting: whole(o.waiting), needsInfo: whole(o.needs_info), stale: whole(o.stale), oldestDays: whole(o.oldest_days) };
}

export function parseUnbankedCounts(data: unknown): UnbankedCounts {
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return { total: whole(o.total), pastWindow: whole(o.past_window), oldestDays: whole(o.oldest_days) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export type CountsTaskCopy = { count: number; title: string; meta: string };

/**
 * "Proofs to verify": the proofs nobody has looked at, plus the ones a member never answered (stale ones are back in the queue,
 * never rejected on their own). Proofs waiting only for a member's reply are not the treasury team's to do, so they are not counted.
 */
export function proofsTaskCopy(c: ProofCounts): CountsTaskCopy | null {
  const count = c.waiting + c.stale;
  if (count === 0) return null;
  const parts: string[] = [];
  if (c.waiting > 0 && c.oldestDays > 0) parts.push(`oldest waiting ${plural(c.oldestDays, "day")}`);
  if (c.stale > 0) parts.push(`${plural(c.stale, "reply", "replies")} overdue from members`);
  const meta = parts.length ? `Sent by members as soft credit · ${parts.join(" · ")}` : "Sent by members as soft credit";
  return { count, title: `${plural(count, "payment proof")} to verify`, meta };
}

/** "Paid, not on the bank": payments recorded as received that no bank line has been matched to. */
export function unbankedTaskCopy(c: UnbankedCounts): CountsTaskCopy | null {
  if (c.total === 0) return null;
  const parts: string[] = [];
  if (c.pastWindow > 0) parts.push(`${plural(c.pastWindow, "payment")} past the usual days to reach the bank`);
  if (c.oldestDays > 0) parts.push(`oldest ${plural(c.oldestDays, "day")}`);
  return {
    count: c.total,
    title: `${plural(c.total, "payment")} paid, not on the bank`,
    meta: parts.length ? parts.join(" · ") : "Recorded as received, waiting for a bank statement line",
  };
}
