// CatchTheMatch Phase 1, piece 1 (migration 0921): "Send to the member". Pure: no I/O. The database builds the message from the library and
// decides who can be reached; this file reads what it was given and writes the words. "Queued" is never "sent".

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** What would be sent, exactly, and to whom (app.match_claim_message_preview). No address: how the person can be reached, as yes or no. */
export type ClaimMessagePreview = {
  problem: string | null;
  program: { id: string; companyName: string };
  employer: string | null;
  person: { id: string; name: string };
  gifts: { receivedOn: string; deadlineOn: string | null }[];
  subject: string | null;
  body: string | null;
  email: boolean;
  app: boolean;
  sandbox: boolean;
};

export function parseClaimMessagePreview(v: unknown): ClaimMessagePreview {
  const o = obj(v);
  const p = obj(o.program);
  return {
    problem: str(o.problem),
    program: { id: str(p.id) ?? "", companyName: str(p.company_name) ?? "" },
    employer: str(o.employer),
    person: { id: str(obj(o.person).id) ?? "", name: str(obj(o.person).name) ?? "A member" },
    gifts: arr(o.gifts).flatMap((g) => {
      const e = obj(g);
      const receivedOn = str(e.received_on);
      return receivedOn ? [{ receivedOn, deadlineOn: str(e.deadline_on) }] : [];
    }),
    subject: str(o.subject),
    body: str(o.body),
    email: o.email === true,
    app: o.app === true,
    sandbox: o.sandbox === true,
  };
}

export type ClaimSendResult = { queued: boolean; email: boolean; push: boolean; notQueued: { reason: string; count: number }[]; claims: number };

export function parseClaimSendResult(v: unknown): ClaimSendResult {
  const o = obj(v);
  return {
    queued: o.queued === true,
    email: o.email === true,
    push: o.push === true,
    notQueued: Object.entries(obj(o.not_queued))
      .flatMap(([reason, count]) => (typeof count === "number" && count > 0 ? [{ reason, count }] : []))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    claims: num(o.claims),
  };
}

/** The reach of a message, in words. */
export function reachLine(p: Pick<ClaimMessagePreview, "email" | "app">): string {
  if (p.email && p.app) return "By email and in the member app";
  if (p.email) return "By email";
  if (p.app) return "In the member app";
  return "No way to reach this person from Weaver";
}

/**
 * What the screen says after "Send". Nothing queued is an error, never a success; a success says "queued", not "sent", and where the real
 * outcome of the message shows.
 */
export function claimSendOutcome(r: ClaimSendResult, firstName: string): { ok: true; message: string } | { ok: false; error: string } {
  const why = r.notQueued.map((n) => n.reason);
  if (!r.queued) {
    return { ok: false, error: `Could not send the message to ${firstName} — nothing was queued, and nothing was recorded.${why.length > 0 ? ` ${why.join(" ")}` : ""}` };
  }
  const how = [r.email ? "by email" : null, r.push ? "in the member app" : null].filter(Boolean).join(" and ");
  const parts = [
    `Queued the message to ${firstName} ${how}. Queued means handed to the sending service; whether it arrived shows under Settings › Email › Recent emails.`,
    `${r.claims === 1 ? "The gift is" : `The ${r.claims} gifts are`} now under Claims as asked, by message.`,
    why.length > 0 ? `Not queued: ${why.join(" ")}` : null,
  ];
  return { ok: true, message: parts.filter(Boolean).join(" ") };
}
