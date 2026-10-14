import { describe, expect, it } from "vitest";

import { checkEmailAddress, sameAddress } from "@/lib/pledge-email/address";
import {
  emailHeadline,
  emailProblemLines,
  emailsSettled,
  parsePledgeEmailStatuses,
  summarizeEmails,
  type PledgeEmailStatus,
} from "@/lib/pledge-email/bulk";
import {
  defaultAddress,
  earlierLine,
  noAddressNote,
  outcomeMessage,
  parsePledgeEmailSheet,
  parseRequestStatus,
  plainReason,
  queuedMessage,
  sendButtonLabel,
  whoseAddress,
  type PrimaryContact,
} from "@/lib/pledge-email/sheet";

// The Email sheet and the bulk upload's result, in plain English. The database holds the rules (supabase/tests/184); these are the
// recipient defaulting, the address check, and the sentences a person reads.

const TARUN: PrimaryContact = { personId: "p-1", name: "Tarun Patni", email: "tarun@example.org", problem: null, message: null };
const NO_EMAIL: PrimaryContact = {
  personId: "p-2",
  name: "Ravi Shah",
  email: null,
  problem: "no_email",
  message: "The primary member (Ravi Shah) has no email address on file.",
};

describe("the address in the box", () => {
  it("is one address, trimmed and in lower case, checked the way the database checks it", () => {
    expect(checkEmailAddress("  Tarun.Patni@Example.ORG ")).toEqual({ ok: true, value: "tarun.patni@example.org" });
    expect(checkEmailAddress("a+tag@sub.example.co.uk")).toEqual({ ok: true, value: "a+tag@sub.example.co.uk" });
  });

  it("says what to fix, in plain words", () => {
    expect(checkEmailAddress("")).toEqual({ ok: false, error: "Type the email address to send the pledge to." });
    expect(checkEmailAddress("   ")).toMatchObject({ ok: false });
    expect(checkEmailAddress(undefined)).toMatchObject({ ok: false });
    expect(checkEmailAddress("tarun@example")).toEqual({ ok: false, error: '"tarun@example" does not look like an email address. Check it and try again.' });
    expect(checkEmailAddress("no at sign.org")).toEqual({ ok: false, error: "That is more than one address, or has spaces in it. Type one email address." });
    expect(checkEmailAddress("a@b.co, c@d.co")).toMatchObject({ ok: false, error: expect.stringContaining("more than one address") });
    expect(checkEmailAddress("a@b.co;c@d.co")).toMatchObject({ ok: false });
    expect(checkEmailAddress("a@@b.co")).toMatchObject({ ok: false });
    expect(checkEmailAddress("<a@b.co>")).toMatchObject({ ok: false });
    expect(checkEmailAddress(`${"x".repeat(250)}@b.co`)).toMatchObject({ ok: false, error: expect.stringContaining("longer than 254") });
  });

  it("shortens a very long wrong address in the sentence, so the page stays readable", () => {
    const r = checkEmailAddress(`${"y".repeat(100)}@nodot`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeLessThan(140);
  });

  it("compares two addresses by case and spaces only", () => {
    expect(sameAddress("Tarun@Example.org ", "tarun@example.org")).toBe(true);
    expect(sameAddress("a@b.co", "c@d.co")).toBe(false);
    expect(sameAddress("", "")).toBe(false);
    expect(sameAddress(null, undefined)).toBe(false);
  });
});

describe("who the email goes to by default", () => {
  it("starts with the primary member's address in the box, and says whose it is", () => {
    expect(defaultAddress(TARUN)).toBe("tarun@example.org");
    expect(whoseAddress(TARUN, "tarun@example.org")).toEqual({ text: "Tarun Patni, primary member", primary: true });
    expect(whoseAddress(TARUN, "  TARUN@example.org ")).toEqual({ text: "Tarun Patni, primary member", primary: true });
  });

  it("when the person types another address, says plainly that it is not the primary member's", () => {
    expect(whoseAddress(TARUN, "someone.else@example.org")).toEqual({
      text: "Not Tarun Patni's address on file: the pledge goes to exactly this address.",
      primary: false,
    });
    expect(whoseAddress({ ...TARUN, name: null }, "x@y.co").text).toBe("The pledge goes to exactly this address.");
  });

  it("a primary member with no address leaves the box empty, with a plain note, and the person can still type one", () => {
    expect(defaultAddress(NO_EMAIL)).toBe("");
    expect(noAddressNote(NO_EMAIL)).toBe("The primary member (Ravi Shah) has no email address on file. Type an address to send it to.");
    expect(noAddressNote(TARUN)).toBeNull();
    expect(whoseAddress(NO_EMAIL, "").text).toContain("nobody on file can be emailed");
    expect(whoseAddress(NO_EMAIL, "ravi.home@example.org").primary).toBe(false);
    expect(noAddressNote({ ...NO_EMAIL, message: null })).toContain("There is no email address on file for the primary member.");
  });

  it("the Send button names the pledge and the address, so the person reads where it goes", () => {
    expect(sendButtonLabel("PL-0455", " tarun@example.org ")).toBe("Send PL-0455 to tarun@example.org");
    expect(sendButtonLabel(null, "a@b.co")).toBe("Send the pledge to a@b.co");
    expect(sendButtonLabel("PL-1", "")).toBe("Send the pledge");
  });
});

describe("reading the database's answers", () => {
  it("reads the sheet's data, and the earlier emails", () => {
    const sheet = parsePledgeEmailSheet({
      pledge: { id: "pl-1", number: "PL-0455", status: "open", household_id: "h-1", amount_cents: 120000 },
      primary: { person_id: "p-1", name: "Tarun Patni", email: "tarun@example.org", problem: null, message: null },
      earlier: [
        { at: "2026-10-03T15:00:00Z", to: "tarun@example.org", how: "automatic", outcome: "sent", reason: null },
        { at: "2026-10-04T15:00:00Z", to: null, how: "manual", outcome: "failed", reason: "Resend could not send the email (HTTP 422)" },
        { at: "2026-10-05T15:00:00Z", to: "x@y.co", how: "manual", outcome: "teleported", reason: null },
      ],
    });
    expect(sheet?.pledge).toEqual({ id: "pl-1", number: "PL-0455", status: "open", householdId: "h-1", amountCents: 120000 });
    expect(sheet?.primary).toEqual(TARUN);
    expect(sheet?.earlier).toHaveLength(2);
    expect(parsePledgeEmailSheet(null)).toBeNull();
    expect(parsePledgeEmailSheet({ pledge: {} })).toBeNull();
    expect(parsePledgeEmailSheet({ pledge: { id: "x", household_id: "h" }, primary: { problem: "nonsense" } })?.primary.problem).toBeNull();
  });

  it("reads one request's status", () => {
    expect(parseRequestStatus({ status: "sent", to: "a@b.co", reason: null })).toEqual({ status: "sent", to: "a@b.co", reason: null });
    expect(parseRequestStatus({ status: "failed", to: "a@b.co", reason: "no" })?.reason).toBe("no");
    expect(parseRequestStatus({ status: "weird", to: "a@b.co" })).toBeNull();
    expect(parseRequestStatus({})).toBeNull();
  });
});

describe("what the person reads after Send", () => {
  it("says it is sending, never 'sent' before the server says so", () => {
    expect(queuedMessage("a@b.co")).toBe("Sending the pledge to a@b.co… It leaves in a moment; this shows when it has gone.");
    expect(outcomeMessage({ status: "waiting", to: "a@b.co", reason: null }).tone).toBe("wait");
    expect(outcomeMessage({ status: "waiting", to: "a@b.co", reason: null }).text).not.toMatch(/^Sent/);
  });

  it("confirms a sent email with its PDF, and points to the History", () => {
    expect(outcomeMessage({ status: "sent", to: "a@b.co", reason: null })).toEqual({
      tone: "ok",
      text: "Sent to a@b.co, with the pledge's PDF attached. It is in the pledge's History.",
    });
  });

  it("says why an email failed or was not sent, in plain English, with what to do", () => {
    const failed = outcomeMessage({ status: "failed", to: "a@b.co", reason: "Resend could not send the email (HTTP 422: the recipient was rejected)" });
    expect(failed.tone).toBe("bad");
    expect(failed.text).toBe("The email to a@b.co could not be sent: resend could not send the email (HTTP 422: the recipient was rejected). Check the address, and send it again if it is right.");
    const held = outcomeMessage({ status: "not_sent", to: "a@b.co", reason: "Not sent: this sandbox sends only to verified test recipients (Settings › Limits)." });
    expect(held).toEqual({ tone: "bad", text: "The email to a@b.co was not sent: this sandbox sends only to verified test recipients (Settings › Limits)." });
    expect(outcomeMessage({ status: "not_sent", to: "a@b.co", reason: null }).text).toBe("The email to a@b.co was not sent.");
  });

  it("turns a reason into a clause", () => {
    expect(plainReason("Not sent: The primary member has no email address on file.")).toBe("the primary member has no email address on file");
    expect(plainReason("Not emailed: whoever uploaded these pledges chose not to email the families.")).toBe("whoever uploaded these pledges chose not to email the families");
    expect(plainReason(null)).toBe("");
    expect(plainReason("  ")).toBe("");
  });

  it("lists what was sent before, with when, to whom and how it went", () => {
    const at = (iso: string) => `D(${iso.slice(0, 10)})`;
    expect(earlierLine({ at: "2026-10-03T15:00:00Z", to: "a@b.co", how: "automatic", outcome: "sent", reason: null }, at)).toBe("D(2026-10-03) · Sent automatically to a@b.co · sent");
    expect(earlierLine({ at: "2026-10-04T15:00:00Z", to: "c@d.co", how: "manual", outcome: "failed", reason: "Not sent: bounced" }, at)).toBe(
      "D(2026-10-04) · Emailed from the menu to c@d.co · failed (bounced)",
    );
    expect(earlierLine({ at: "2026-10-05T15:00:00Z", to: null, how: "automatic", outcome: "not_sent", reason: "Not sent: no email" }, at)).toBe("D(2026-10-05) · Sent automatically · not sent (no email)");
    expect(earlierLine({ at: "2026-10-06T15:00:00Z", to: "a@b.co", how: "manual", outcome: "waiting", reason: null }, at)).toContain("still sending");
  });
});

const S = (state: PledgeEmailStatus["state"], n: string, reason: string | null = null): PledgeEmailStatus => ({ pledgeId: `id-${n}`, number: n, state, reason });

describe("a bulk upload's emails: sent, no email address, failed", () => {
  const list: PledgeEmailStatus[] = [
    S("sent", "PL-1"),
    S("sent", "PL-2"),
    S("waiting", "PL-3"),
    S("pending", "PL-4"),
    S("no_email", "PL-5", "Not sent: The primary member (Ravi Shah) has no email address on file."),
    S("failed", "PL-6", "Resend could not send the email (HTTP 422: the recipient was rejected)"),
    S("history", "PL-7", "This pledge is dated more than 30 days ago, so it counts as history and is not emailed."),
    S("not_approved", "PL-8", "Not sent: The treasurer has not approved the receipt templates yet."),
  ];

  it("counts what the owner asked for: how many were sent, how many had no email, how many failed", () => {
    const s = summarizeEmails(list);
    expect(s).toEqual({ total: 8, sent: 2, waiting: 2, noEmail: 1, failed: 1, notEmailed: 2 });
    expect(emailsSettled(s)).toBe(false);
    expect(emailsSettled(summarizeEmails(list.filter((e) => e.state !== "waiting" && e.state !== "pending")))).toBe(true);
  });

  it("says it in one sentence, only mentioning what applies", () => {
    expect(emailHeadline(summarizeEmails(list), true)).toBe("2 families emailed · 2 still sending · 1 family with no email address on file · 1 could not be sent · 2 not emailed (see below).");
    expect(emailHeadline(summarizeEmails([S("sent", "PL-1")]), true)).toBe("1 family emailed.");
    expect(emailHeadline(summarizeEmails([]), true)).toBe("No pledge emails to report.");
    expect(emailHeadline(summarizeEmails(list), false)).toBe("The families were not emailed, as you chose. Each pledge's History says so.");
  });

  it("lists each pledge that needs a person: who has no address, what failed and why, and what was held back and why", () => {
    const lines = emailProblemLines(list, (e) => `${e.number} (Rao household 0127)`);
    expect(lines.map((l) => l.state)).toEqual(["no_email", "failed", "history", "not_approved"]);
    expect(lines[0]?.text).toBe(
      "PL-5 (Rao household 0127): not emailed, the primary member (Ravi Shah) has no email address on file. Add the primary member's email, then use ⋯ › Email… on the pledge.",
    );
    expect(lines[1]?.text).toBe(
      "PL-6 (Rao household 0127): could not be sent, resend could not send the email (HTTP 422: the recipient was rejected). Use ⋯ › Email… on the pledge to try again.",
    );
    expect(lines[2]?.text).toBe("PL-7 (Rao household 0127): not emailed, this pledge is dated more than 30 days ago, so it counts as history and is not emailed.");
    expect(lines[3]?.text).toBe("PL-8 (Rao household 0127): not emailed, the treasurer has not approved the receipt templates yet.");
    expect(emailProblemLines([S("no_email", "PL-9")], (e) => String(e.number))[0]?.text).toContain("no email address on file. Add");
  });

  it("reads the database's list, leaving out anything that is not one pledge's status", () => {
    const parsed = parsePledgeEmailStatuses([
      { pledge_id: "a", number: "PL-1", state: "sent", reason: null },
      { pledge_id: "b", number: null, state: "no_email", reason: "x" },
      { pledge_id: "c", state: "mystery" },
      { state: "sent" },
      "text",
      null,
    ]);
    expect(parsed).toEqual([
      { pledgeId: "a", number: "PL-1", state: "sent", reason: null },
      { pledgeId: "b", number: null, state: "no_email", reason: "x" },
    ]);
    expect(parsePledgeEmailStatuses({ not: "a list" })).toEqual([]);
  });
});
