// What the Email sheet shows and says (Giving › Pledges › ⋯ › Email…). Pure: the sheet, the server actions and the tests use these.
//
// The sheet opens with the household's PRIMARY member and their address in a text box that can be edited; whatever address is in the
// box when the person presses Send is the one the pledge email (with the pledge's PDF attached) goes to. The database holds the
// rules (app.send_pledge_email); this file turns its answers into plain English.

import { sameAddress } from "./address";

export type PrimaryContact = {
  personId: string | null;
  name: string | null;
  /** The primary member's usable address (lower case), or null with a `problem`. */
  email: string | null;
  problem: "no_primary" | "deceased" | "child" | "no_email" | "bad_email" | null;
  /** A sentence about why there is no address, as the database words it. */
  message: string | null;
};

export type EarlierEmail = {
  at: string;
  to: string | null;
  how: "automatic" | "manual";
  outcome: "sent" | "waiting" | "failed" | "not_sent";
  reason: string | null;
};

export type PledgeEmailSheetData = {
  pledge: { id: string; number: string | null; status: string; householdId: string; amountCents: number };
  primary: PrimaryContact;
  earlier: EarlierEmail[];
};

/** How a request that was queued is doing. `waiting`: the service has not finished with it yet. */
export type RequestState = "waiting" | "sent" | "failed" | "not_sent";
export type RequestStatus = { status: RequestState; to: string; reason: string | null };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const PROBLEMS = new Set(["no_primary", "deceased", "child", "no_email", "bad_email"]);
const OUTCOMES = new Set(["sent", "waiting", "failed", "not_sent"]);

/** Reads app.pledge_email_recipient's answer; null when it is not one. */
export function parsePledgeEmailSheet(json: unknown): PledgeEmailSheetData | null {
  const j = obj(json);
  const p = obj(j.pledge);
  const id = str(p.id);
  const householdId = str(p.household_id);
  if (!id || !householdId) return null;
  const primary = obj(j.primary);
  const problem = str(primary.problem);
  return {
    pledge: { id, number: str(p.number), status: str(p.status) ?? "open", householdId, amountCents: Number(p.amount_cents ?? 0) },
    primary: {
      personId: str(primary.person_id),
      name: str(primary.name),
      email: str(primary.email),
      problem: problem && PROBLEMS.has(problem) ? (problem as PrimaryContact["problem"]) : null,
      message: str(primary.message),
    },
    earlier: (Array.isArray(j.earlier) ? j.earlier : []).flatMap((e): EarlierEmail[] => {
      const x = obj(e);
      const at = str(x.at);
      const outcome = str(x.outcome);
      if (!at || !outcome || !OUTCOMES.has(outcome)) return [];
      return [{ at, to: str(x.to), how: x.how === "manual" ? "manual" : "automatic", outcome: outcome as EarlierEmail["outcome"], reason: str(x.reason) }];
    }),
  };
}

/** What the box starts with: the primary member's address, or nothing. */
export function defaultAddress(primary: PrimaryContact): string {
  return primary.email ?? "";
}

/** Whose address the box holds, in words: "Tarun Patni, primary member" while it is theirs, else a plain warning that it is not. */
export function whoseAddress(primary: PrimaryContact, typed: string): { text: string; primary: boolean } {
  const t = typed.trim();
  if (t === "") return { text: primary.email ? "Type the address to send it to." : "Type the address to send it to (nobody on file can be emailed).", primary: false };
  if (primary.email && sameAddress(primary.email, t)) return { text: `${primary.name ?? "The primary member"}, primary member`, primary: true };
  return { text: primary.name ? `Not ${primary.name}'s address on file: the pledge goes to exactly this address.` : "The pledge goes to exactly this address.", primary: false };
}

/** The note under the box when the primary member has no usable address. */
export function noAddressNote(primary: PrimaryContact): string | null {
  if (primary.email) return null;
  return `${primary.message ?? "There is no email address on file for the primary member."} Type an address to send it to.`;
}

/** A reason as one clause: "Not sent: …" loses its lead and its first letter. */
export function plainReason(reason: string | null | undefined): string {
  const r = (reason ?? "").trim().replace(/^not sent:\s*/i, "").replace(/^not emailed:\s*/i, "");
  if (r === "") return "";
  return r[0]!.toLowerCase() + r.slice(1).replace(/\.$/, "");
}

export const SEND_LABEL = "Send the pledge";

/** The Send button names the pledge and the address, so the person reads where it goes before pressing it. */
export function sendButtonLabel(number: string | null, address: string): string {
  const to = address.trim();
  return to ? `Send ${number ?? "the pledge"} to ${to}` : SEND_LABEL;
}

/** Said once the request is made and while the service writes the email. */
export function queuedMessage(to: string): string {
  return `Sending the pledge to ${to}… It leaves in a moment; this shows when it has gone.`;
}

/** The request's outcome, in a sentence for the person who clicked. */
export function outcomeMessage(s: RequestStatus): { tone: "ok" | "wait" | "bad"; text: string } {
  const reason = plainReason(s.reason);
  switch (s.status) {
    case "sent":
      return { tone: "ok", text: `Sent to ${s.to}, with the pledge's PDF attached. It is in the pledge's History.` };
    case "waiting":
      return { tone: "wait", text: `Still sending to ${s.to}… It can take a minute. You can close this: the pledge's History shows who sent it, and Messages shows whether it arrived.` };
    case "failed":
      return { tone: "bad", text: `The email to ${s.to} could not be sent${reason ? `: ${reason}` : ""}. Check the address, and send it again if it is right.` };
    case "not_sent":
      return { tone: "bad", text: `The email to ${s.to} was not sent${reason ? `: ${reason}` : ""}.` };
  }
}

/** One line for a past email in the sheet: when, to whom, and how it went. */
export function earlierLine(e: EarlierEmail, format: (iso: string) => string): string {
  const how = e.how === "manual" ? "Emailed from the menu" : "Sent automatically";
  const to = e.to ? ` to ${e.to}` : "";
  const state =
    e.outcome === "sent" ? "sent" : e.outcome === "waiting" ? "still sending" : e.outcome === "failed" ? `failed${e.reason ? ` (${plainReason(e.reason)})` : ""}` : `not sent${e.reason ? ` (${plainReason(e.reason)})` : ""}`;
  return `${format(e.at)} · ${how}${to} · ${state}`;
}

/** Reads app.pledge_email_request_status's answer; null when it is not one. */
export function parseRequestStatus(json: unknown): RequestStatus | null {
  const j = obj(json);
  const status = str(j.status);
  const to = str(j.to);
  if (!status || !to || !OUTCOMES.has(status)) return null;
  return { status: status as RequestState, to, reason: str(j.reason) };
}
