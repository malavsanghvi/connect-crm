// Member profile details (migration 0546): the optional things a member tells the community
// in the app ("A little more about you"): wedding anniversary, dietary needs, interests,
// volunteering interests and an emergency contact. Pure helpers only: how the portal names
// and shows them, and parses the Setup › Lists form for the dietary choices.
//
// Where each piece lives:
//   anniversary, dietary, dietary_other, emergency_contact_*   app.person_profile_details (0546)
//   interests                                                   app.people.interests (0018)
//   volunteering interests                                      app.volunteer_interests → app.volunteer_groups
//   the dietary choice list, per community                      app.dietary_options (0546)

type Read = (name: string) => string | null;
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** The six interest tags the member app offers (people.interests holds the keys). */
export const INTEREST_LABELS: Record<string, string> = {
  events: "Events",
  pathshala: "Pathshala",
  volunteering: "Volunteering",
  youth: "Youth",
  seniors: "Seniors",
  giving: "Giving",
};

/** "nut_allergy" → "Nut allergy": the last-resort name for a key nobody labelled. */
export function humanizeKey(key: string): string {
  const t = key.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/** Names for interest keys, in the order stored; an unknown key is humanized rather than dropped. */
export function interestLabels(keys: readonly string[] | null | undefined): string[] {
  return [...new Set((keys ?? []).map((k) => k.trim()).filter(Boolean))].map((k) => INTEREST_LABELS[k.toLowerCase()] ?? humanizeKey(k));
}

export type DietaryOptionRow = { key: string; label: string; active: boolean };
export type DietaryChoice = { key: string; label: string; /** The community switched this choice off after the member picked it. */ retired: boolean };

/**
 * A member's dietary keys as names. The community's own label wins; a key that is no longer in the
 * list (or was switched off) still reads as what it was, so nothing the member said disappears.
 * "Other" is shown as the member's own words when they gave some.
 */
export function dietaryChoices(keys: readonly string[] | null | undefined, options: readonly DietaryOptionRow[], other?: string | null): DietaryChoice[] {
  const byKey = new Map(options.map((o) => [o.key, o]));
  const note = (other ?? "").trim();
  return (keys ?? []).map((key) => {
    const o = byKey.get(key);
    const label = key === "other" && note ? `Other: ${note}` : (o?.label ?? humanizeKey(key));
    return { key, label, retired: !!o && !o.active };
  });
}

/** `tel:` link for an E.164 number; null when it is not one (the page then shows the text only). */
export function telHref(phone: string | null | undefined): string | null {
  const p = (phone ?? "").trim();
  return /^\+[1-9][0-9]{6,14}$/.test(p) ? `tel:${p}` : null;
}

/** The emergency contact as staff read it: "Kiran Shah (sister)". */
export function emergencyContactLine(name: string | null | undefined, relationship: string | null | undefined): string {
  const n = (name ?? "").trim();
  const r = (relationship ?? "").trim();
  if (!n) return "";
  return r ? `${n} (${r.toLowerCase()})` : n;
}

// ── Setup › Lists: dietary options ───────────────────────────────────────────

/** The stable key stored on member rows: lower-case, letters/digits/underscores, starting with a letter (the column's check). */
export function dietaryKeyFromLabel(label: string): string {
  let k = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!k) k = "option";
  if (!/^[a-z]/.test(k)) k = `d_${k}`.slice(0, 40);
  return k;
}

export type DietaryOptionInput = { label: string; active: boolean };

export function parseDietaryOption(read: Read): Parsed<DietaryOptionInput> {
  const label = (read("label") ?? "").trim().replace(/\s+/g, " ");
  if (label.length < 1 || label.length > 60) return { ok: false, error: "Enter the dietary option's name (1 to 60 characters), for example Dairy-free." };
  const a = read("active");
  return { ok: true, value: { label, active: a === null ? true : a === "on" || a === "true" } };
}
