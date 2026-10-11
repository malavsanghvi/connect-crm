// The pure pieces of the Messages commands: how old a conversation is, the counts of the inbox, the guard that keeps a child's name
// out of what a model reads (D2), the ranking of approved answers, the wording of a drafted reply and the plain reason a message did
// not go out. No database, no clock of its own, no I/O: everything is given in, so every rule here is tested on its own
// (tests/messages-pure.test.ts).

// ---------------------------------------------------------------------------
// Age
// ---------------------------------------------------------------------------
const HOUR = 3_600_000;

export const AGE_BUCKETS = [
  { key: "under_a_day", label: "Under a day" },
  { key: "one_to_two_days", label: "1 to 2 days" },
  { key: "three_to_seven_days", label: "3 to 7 days" },
  { key: "over_a_week", label: "Over a week" },
] as const;
export type AgeBucketKey = (typeof AGE_BUCKETS)[number]["key"];

export function ageHours(from: string, now: Date): number {
  const ms = now.getTime() - new Date(from).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms / HOUR : 0;
}

export function ageBucket(hours: number): AgeBucketKey {
  if (hours < 24) return "under_a_day";
  if (hours < 72) return "one_to_two_days";
  if (hours < 24 * 7) return "three_to_seven_days";
  return "over_a_week";
}

/** "20 minutes", "5 hours", "3 days": how long a conversation has waited, in words. */
export function waitedWords(hours: number): string {
  if (hours < 1) {
    const m = Math.max(1, Math.round(hours * 60));
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  if (hours < 48) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.floor(hours / 24);
  return `${d} days`;
}

// ---------------------------------------------------------------------------
// Inbox counts
// ---------------------------------------------------------------------------
export type ThreadRow = {
  id: string;
  inbox_id: string;
  status: string;
  assignee_user: string | null;
  first_response_at: string | null;
  created_at: string;
  subject: string | null;
  from_person_id: string | null;
};
export type InboxRow = { id: string; name: string; response_target_hours: number | null };

export type InboxCounts = {
  inbox_id: string;
  name: string;
  open: number;
  waiting_on_us: number;
  waiting_on_member: number;
  unassigned: number;
  no_first_reply: number;
  past_target: number;
  oldest_waiting: string | null;
};

export type TriageCounts = {
  open: number;
  waiting_on_us: number;
  waiting_on_member: number;
  unassigned: number;
  no_first_reply: number;
  past_target: number;
  by_age: { key: AgeBucketKey; label: string; count: number }[];
  by_inbox: InboxCounts[];
};

/**
 * What is waiting. "Waiting on us" is a conversation whose last word belongs to the member (status open or assigned); "waiting on
 * the member" is one the inbox answered (status waiting). The age buckets count only what waits on us. A conversation is past its
 * target when nobody has replied yet and it is older than the inbox's reply target (default 48 hours).
 */
export function triageCounts(threads: readonly ThreadRow[], inboxes: readonly InboxRow[], now: Date): TriageCounts {
  const target = new Map(inboxes.map((i) => [i.id, i.response_target_hours ?? 48]));
  const names = new Map(inboxes.map((i) => [i.id, i.name]));
  const byInbox = new Map<string, InboxCounts & { oldestHours: number }>();
  const ages = new Map<AgeBucketKey, number>(AGE_BUCKETS.map((b) => [b.key, 0]));
  const total = { open: 0, waiting_on_us: 0, waiting_on_member: 0, unassigned: 0, no_first_reply: 0, past_target: 0 };

  for (const t of threads) {
    if (t.status === "closed") continue;
    const row =
      byInbox.get(t.inbox_id) ??
      ({ inbox_id: t.inbox_id, name: names.get(t.inbox_id) ?? "Inbox", open: 0, waiting_on_us: 0, waiting_on_member: 0, unassigned: 0, no_first_reply: 0, past_target: 0, oldest_waiting: null, oldestHours: -1 } as InboxCounts & { oldestHours: number });
    byInbox.set(t.inbox_id, row);
    const hours = ageHours(t.created_at, now);
    row.open += 1;
    total.open += 1;
    if (t.status === "waiting") {
      row.waiting_on_member += 1;
      total.waiting_on_member += 1;
      continue;
    }
    row.waiting_on_us += 1;
    total.waiting_on_us += 1;
    ages.set(ageBucket(hours), (ages.get(ageBucket(hours)) ?? 0) + 1);
    if (!t.assignee_user) {
      row.unassigned += 1;
      total.unassigned += 1;
    }
    if (!t.first_response_at) {
      row.no_first_reply += 1;
      total.no_first_reply += 1;
      if (hours > (target.get(t.inbox_id) ?? 48)) {
        row.past_target += 1;
        total.past_target += 1;
      }
    }
    if (hours > row.oldestHours) {
      row.oldestHours = hours;
      row.oldest_waiting = waitedWords(hours);
    }
  }
  return {
    ...total,
    by_age: AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: ages.get(b.key) ?? 0 })),
    by_inbox: [...byInbox.values()]
      .sort((a, b) => b.waiting_on_us - a.waiting_on_us || a.name.localeCompare(b.name))
      .map((row) => ({ inbox_id: row.inbox_id, name: row.name, open: row.open, waiting_on_us: row.waiting_on_us, waiting_on_member: row.waiting_on_member, unassigned: row.unassigned, no_first_reply: row.no_first_reply, past_target: row.past_target, oldest_waiting: row.oldest_waiting })),
  };
}

// ---------------------------------------------------------------------------
// The child guard for message text (D2)
// ---------------------------------------------------------------------------
// A member's message can name a child ("Zoya's class", "Aarav is allergic to nuts"). The command layer already replaces a child's
// FULL name (child-filter.ts); a message usually says only the first name. So a message that uses the first name of anyone under 18
// is not shown to Niva at all: it is replaced by a sentence and the person reads it on the screen. This errs on the side of
// withholding (an adult who shares a child's first name has their messages withheld too).

function fold(word: string): string {
  // Accents on Latin letters are ignored; the vowel signs of Gujarati and Hindi are part of the letters and stay.
  return word.normalize("NFKC").normalize("NFD").replace(/(?<=\p{Script=Latin})\p{M}+/gu, "").toLowerCase();
}

const WORD = /[\p{L}\p{M}\p{N}]+/gu;

function wordsOf(text: string): string[] {
  return (text.match(WORD) ?? []).map(fold);
}

/** The given names of the community's minors: every word of each full name except the last (the family name). */
export function childGivenNames(fullNames: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const full of fullNames) {
    const parts = wordsOf(full);
    if (parts.length === 0) continue;
    const given = parts.length === 1 ? parts : parts.slice(0, -1);
    for (const g of given) if (Array.from(g).length >= 2) out.add(g);
  }
  return out;
}

/** True when the text uses a child's given name as a word (any case, any accent). */
export function mentionsChild(text: string | null | undefined, givenNames: ReadonlySet<string>): boolean {
  if (!text || givenNames.size === 0) return false;
  return wordsOf(text).some((w) => givenNames.has(w));
}

export const WITHHELD_FOR_CHILD = "This message is about a child, so it is not shown here. Please read it on the screen.";

// ---------------------------------------------------------------------------
// Approved answers: which of them answers a question
// ---------------------------------------------------------------------------
export type SourceRow = { id: string; kind: string; title: string; body_md: string | null; source_url: string | null };
export type RankedSource = SourceRow & { score: number; matched: string[]; excerpt: string };

const STOP_WORDS =
  "the a an and or but if then so of to in on at for from by with about into over after before is are was were be been am do does did " +
  "have has had can could will would shall should may might must i me my we our us you your he she it its they them their this that " +
  "these those what when where which who whom why how not no yes please thanks thank hello hi dear regards hey also just any some " +
  "there here too very more most than as up out get got want need like know let us";
const STOP = new Set(STOP_WORDS.split(/\s+/).filter(Boolean));

/** The words of a question worth searching for: three letters or more, not filler. */
export function searchWords(question: string): string[] {
  const seen = new Set<string>();
  for (const w of wordsOf(question)) {
    if (Array.from(w).length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    seen.add(w);
  }
  return [...seen];
}

/** A light stem so "parking" and "park", "dinners" and "dinner" meet. Only for matching a question to an answer. */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}

/** The paragraph of `body` that uses the most search words, cut at a sentence end near `max` characters. */
export function pickExcerpt(body: string, words: readonly string[], max = 700): string {
  const paragraphs = body.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return "";
  const stems = words.map(stem);
  let best = paragraphs[0];
  let bestScore = -1;
  for (const p of paragraphs) {
    const pw = new Set(wordsOf(p).map(stem));
    const score = stems.filter((s) => pw.has(s)).length;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  if (Array.from(best).length <= max) return best;
  const cut = Array.from(best).slice(0, max).join("");
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

/**
 * The approved sources that answer a question, best first. A source needs at least two different words of the question (a question
 * of a single word needs that word in the source's title); a word in the title counts three times. Nothing that is not in `sources`
 * is ever returned: the caller passes only published sources, so a draft is built from approved answers and from nothing else. It
 * errs towards "no answer": a wrong draft to a family is worse than none.
 */
export function rankSources(question: string, sources: readonly SourceRow[], limit = 3): RankedSource[] {
  const words = searchWords(question);
  if (words.length === 0) return [];
  // One entry per stem, so "park" and "parking" count as one word of the question.
  const stems = [...new Map(words.map((w) => [stem(w), w] as const)).entries()];
  const ranked: RankedSource[] = [];
  for (const s of sources) {
    const title = new Set(wordsOf(s.title).map(stem));
    const body = new Set(wordsOf(s.body_md ?? "").map(stem));
    let score = 0;
    let inTitle = 0;
    const matched: string[] = [];
    for (const [st, word] of stems) {
      const t = title.has(st);
      const b = body.has(st);
      if (t) inTitle += 1;
      if (t || b) {
        score += t ? 3 : 1;
        matched.push(word);
      }
    }
    const enough = matched.length >= 2 || (stems.length === 1 && inTitle === 1);
    if (!enough) continue;
    ranked.push({ ...s, score, matched, excerpt: pickExcerpt(s.body_md ?? "", words) });
  }
  return ranked.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

/**
 * The drafted reply: a greeting, the best approved answer in its own words, the link when the source has one, and a sign-off.
 * `null` when no approved source answers the question: Niva then says so instead of inventing an answer.
 */
export function composeReply(args: { firstName: string | null; community: string; inbox: string; best: RankedSource | null }): string | null {
  const { best } = args;
  if (!best || !best.excerpt) return null;
  const lines = [
    `Hello ${args.firstName?.trim() || "there"},`,
    "",
    `Thank you for writing to ${args.community}.`,
    "",
    best.excerpt,
  ];
  if (best.source_url) lines.push("", `More: ${best.source_url}`);
  lines.push("", "With thanks,", `${args.inbox} · ${args.community}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Why a message did not go out
// ---------------------------------------------------------------------------
export type MessageState = {
  status: string;
  failure_reason: string | null;
  channel: string;
  scheduled_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  provider?: string | null;
};
export type JobState = { status: string; attempts: number; max_attempts: number; last_error: string | null; run_after: string | null } | null;

export const CHANNEL_WORDS: Record<string, string> = { email: "email", sms: "text", whatsapp: "WhatsApp", push: "push notification", in_app: "in-app message" };
export const channelWord = (c: string): string => CHANNEL_WORDS[c] ?? c;

/** "ending 4821" or "j***@example.org": enough to recognise an address, never the whole of it. */
export function maskAddress(address: string | null | undefined): string | null {
  const a = (address ?? "").trim();
  if (!a) return null;
  if (a.includes("@")) {
    const [local, domain] = a.split("@");
    return `${local.slice(0, 1)}***@${domain}`;
  }
  const digits = a.replace(/\D/g, "");
  return digits.length >= 4 ? `ending ${digits.slice(-4)}` : "a number on file";
}

/** The sentence that answers "why did this not go out?" for one message, from what the queue and the background service recorded. */
export function explainMessage(m: MessageState, job: JobState, when: (iso: string) => string, now: Date): { state: string; why: string; went_out: boolean } {
  const reason = (m.failure_reason ?? "").trim();
  const ch = channelWord(m.channel);
  switch (m.status) {
    case "delivered":
      return { state: "Delivered", why: `The ${ch} was delivered${m.delivered_at ? ` on ${when(m.delivered_at)}` : ""}.`, went_out: true };
    case "sent":
      return { state: "Handed over", why: `The ${ch} was handed to the sender${m.sent_at ? ` on ${when(m.sent_at)}` : ""}. The sender has not confirmed it arrived yet.`, went_out: true };
    case "bounced":
      return { state: "Bounced", why: reason || `The ${ch} address did not accept it. It is now on the do-not-send list until someone lifts it.`, went_out: false };
    case "complained":
      return { state: "Marked as spam", why: reason || "The person marked an earlier message as spam, so nothing more is sent to this address.", went_out: false };
    case "suppressed":
      return { state: "Not sent", why: reason || `This ${ch} address is on the do-not-send list.`, went_out: false };
    case "cancelled":
      return { state: "Cancelled", why: reason || "It was cancelled before it went out.", went_out: false };
    case "failed":
      return { state: "Failed", why: reason || (job?.last_error ? `The sender reported: ${job.last_error}` : `The ${ch} could not be sent. The sender did not say why.`), went_out: false };
    default: {
      // queued
      const due = m.scheduled_at ? new Date(m.scheduled_at) : null;
      if (due && due.getTime() > now.getTime()) {
        return { state: "Waiting for its time", why: `It is queued and will go out on ${when(m.scheduled_at as string)}.`, went_out: false };
      }
      if (job && job.status === "failed") {
        return { state: "Failed", why: `The background service tried ${job.attempts} time${job.attempts === 1 ? "" : "s"} and gave up${job.last_error ? `: ${job.last_error}` : "."}`, went_out: false };
      }
      if (job && job.status === "queued" && job.attempts > 0) {
        return { state: "Retrying", why: `The background service tried ${job.attempts} time${job.attempts === 1 ? "" : "s"} and will try again${job.run_after ? ` after ${when(job.run_after)}` : ""}${job.last_error ? `. The last problem: ${job.last_error}` : "."}`, went_out: false };
      }
      return { state: "Queued", why: "It is queued. The background service has not sent it yet.", went_out: false };
    }
  }
}

// ---------------------------------------------------------------------------
// Can this person be reached on a channel?
// ---------------------------------------------------------------------------
export type OptinState = { opted_in: boolean; address: string | null; recorded_at: string } | null;

export const SECRET_PURPOSES: readonly string[] = ["auth_code", "sandbox_code", "verification_code"];

/**
 * Whether one adult would receive a message on one channel, and if not, the plain reason: no answer recorded, opted out (and when),
 * no address on file, consent withdrawn, or the address is on the do-not-send list.
 */
export function reachability(
  args: { channel: string; optin: OptinState; consentGranted: boolean | null; suppression: { reason: string; created_at: string } | null },
  when: (iso: string) => string,
): { reachable: boolean | null; why: string } {
  const { channel, optin, consentGranted, suppression } = args;
  const ch = channelWord(channel);
  if (channel === "push" || channel === "in_app") {
    return { reachable: null, why: `${ch === "push notification" ? "Push notifications" : "In-app messages"} go to people who have the Weaver app with the topic switched on. Contact choices do not apply.` };
  }
  if (suppression) {
    const how = suppression.reason === "bounce" ? "a bounce" : suppression.reason === "complaint" ? "a spam complaint" : suppression.reason === "stop" ? "a STOP reply" : "a staff decision";
    return { reachable: false, why: `This ${ch} address is on the do-not-send list since ${when(suppression.created_at)} (${how}). Someone must lift it in Settings before ${ch} goes there again.` };
  }
  if (!optin) return { reachable: false, why: `No answer is recorded about ${ch}, so nothing is sent. They can opt in from the app or the office can record it.` };
  if (!optin.opted_in) return { reachable: false, why: `They opted out of ${ch} on ${when(optin.recorded_at)}. Nothing is sent until they opt in again.` };
  if (!(optin.address ?? "").trim()) return { reachable: false, why: `They opted in to ${ch} but there is no ${channel === "email" ? "email address" : "number"} on file.` };
  if (consentGranted === false) return { reachable: false, why: `They withdrew their consent for ${ch}, so nothing is sent.` };
  return { reachable: true, why: `Opted in to ${ch} on ${when(optin.recorded_at)}.` };
}

/** The newest row of each (person, key) from rows that carry `recorded_at` (or `created_at`). */
export function latestBy<T extends { recorded_at: string }>(rows: readonly T[], key: (r: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const k = key(r);
    const have = out.get(k);
    if (!have || r.recorded_at > have.recorded_at) out.set(k, r);
  }
  return out;
}

export function countBy<T>(rows: readonly T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1;
  return out;
}
