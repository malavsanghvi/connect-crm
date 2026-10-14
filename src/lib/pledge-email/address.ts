// The address a pledge is emailed to: one address, typed or taken from the primary member, checked the same way the database checks it
// (app.send_pledge_email, 0792). Pure: the Email sheet, the server action and the tests use these sentences.

/** The longest an address may be (RFC 5321). */
export const EMAIL_MAX = 254;

/** The shape the database accepts: one @, no spaces, commas, semicolons or angle brackets, a dot in the domain. */
const ADDRESS = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;

export type AddressCheck = { ok: true; value: string } | { ok: false; error: string };

/** The address as it will be used (trimmed, lower case), or a sentence for the person that says what to fix. */
export function checkEmailAddress(raw: unknown): AddressCheck {
  const value = (typeof raw === "string" ? raw : "").trim().toLowerCase();
  if (value === "") return { ok: false, error: "Type the email address to send the pledge to." };
  if (value.length > EMAIL_MAX) return { ok: false, error: `That address is longer than ${EMAIL_MAX} characters. Check it and try again.` };
  if (/[,;]/.test(value) || /\s/.test(value) || (value.match(/@/g) ?? []).length > 1) {
    return { ok: false, error: "That is more than one address, or has spaces in it. Type one email address." };
  }
  if (!ADDRESS.test(value)) return { ok: false, error: `"${value.length > 60 ? `${value.slice(0, 59)}…` : value}" does not look like an email address. Check it and try again.` };
  return { ok: true, value };
}

/** Both addresses are the same person's mailbox as far as a computer can tell (case and spaces aside). */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase() && (a ?? "").trim() !== "";
}
