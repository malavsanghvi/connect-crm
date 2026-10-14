// What a bulk pledge upload says about the emails it sent (Giving › Pledges › Upload). Pure: the result screen, the server action and the
// tests use these. The database answers per pledge (app.pledge_email_status, 0793); this turns the answers into the three numbers the
// owner asked for (sent, no email address, failed with the reason) and a few plain lines more.

import { plainReason } from "./sheet";

export type PledgeEmailState =
  | "sent"
  | "waiting"
  | "pending"
  | "no_email"
  | "declined"
  | "history"
  | "not_approved"
  | "switched_off"
  | "failed"
  | "not_sent";

export type PledgeEmailStatus = { pledgeId: string; number: string | null; state: PledgeEmailState; reason: string | null };

const STATES = new Set<string>(["sent", "waiting", "pending", "no_email", "declined", "history", "not_approved", "switched_off", "failed", "not_sent"]);

/** Reads app.pledge_email_status's answer (a list); anything that is not one pledge's status is left out. */
export function parsePledgeEmailStatuses(json: unknown): PledgeEmailStatus[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((e): PledgeEmailStatus[] => {
    const x = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
    const id = typeof x.pledge_id === "string" ? x.pledge_id : null;
    const state = typeof x.state === "string" && STATES.has(x.state) ? (x.state as PledgeEmailState) : null;
    if (!id || !state) return [];
    return [{ pledgeId: id, number: typeof x.number === "string" ? x.number : null, state, reason: typeof x.reason === "string" && x.reason ? x.reason : null }];
  });
}

export type EmailSummary = {
  total: number;
  sent: number;
  /** Queued or not yet written: still on its way. */
  waiting: number;
  noEmail: number;
  failed: number;
  /** Not emailed on purpose or by rule: unticked, history, switched off, waiting for the treasurer's approval, or held back by the sender. */
  notEmailed: number;
};

export function summarizeEmails(list: readonly PledgeEmailStatus[]): EmailSummary {
  const s: EmailSummary = { total: list.length, sent: 0, waiting: 0, noEmail: 0, failed: 0, notEmailed: 0 };
  for (const e of list) {
    if (e.state === "sent") s.sent += 1;
    else if (e.state === "waiting" || e.state === "pending") s.waiting += 1;
    else if (e.state === "no_email") s.noEmail += 1;
    else if (e.state === "failed") s.failed += 1;
    else s.notEmailed += 1;
  }
  return s;
}

/** Nothing is on its way any more: the numbers will not change. */
export function emailsSettled(s: EmailSummary): boolean {
  return s.waiting === 0;
}

const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** The headline of the result: how many families were emailed, had no email address, or could not be emailed. */
export function emailHeadline(s: EmailSummary, requested: boolean): string {
  if (!requested) return "The families were not emailed, as you chose. Each pledge's History says so.";
  if (s.total === 0) return "No pledge emails to report.";
  const parts = [`${n(s.sent, "family", "families")} emailed`];
  if (s.waiting > 0) parts.push(`${s.waiting.toLocaleString("en-US")} still sending`);
  if (s.noEmail > 0) parts.push(`${n(s.noEmail, "family", "families")} with no email address on file`);
  if (s.failed > 0) parts.push(`${s.failed.toLocaleString("en-US")} could not be sent`);
  if (s.notEmailed > 0) parts.push(`${s.notEmailed.toLocaleString("en-US")} not emailed (see below)`);
  return `${parts.join(" · ")}.`;
}

/** One line per pledge that needs a person: who has no address, what failed and why, what was held back and why. */
export function emailProblemLines(list: readonly PledgeEmailStatus[], label: (e: PledgeEmailStatus) => string): { state: PledgeEmailState; text: string }[] {
  const out: { state: PledgeEmailState; text: string }[] = [];
  for (const e of list) {
    if (e.state === "sent" || e.state === "waiting" || e.state === "pending") continue;
    const why = plainReason(e.reason);
    const head = label(e);
    const text =
      e.state === "no_email"
        ? `${head}: not emailed${why ? `, ${why}` : ": no email address on file"}. Add the primary member's email, then use ⋯ › Email… on the pledge.`
        : e.state === "failed"
          ? `${head}: could not be sent${why ? `, ${why}` : ""}. Use ⋯ › Email… on the pledge to try again.`
          : e.state === "declined"
            ? `${head}: not emailed, as you chose.`
            : e.state === "history"
              ? `${head}: not emailed${why ? `, ${why}` : ": it counts as history"}.`
              : `${head}: not emailed${why ? `, ${why}` : ""}.`;
    out.push({ state: e.state, text });
  }
  return out;
}
