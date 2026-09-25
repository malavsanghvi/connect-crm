// Setup › Lists (onboarding, o-golive): the setup data an organization admin types in on
// screen when no other screen creates it — membership types, funds, inboxes, zones and
// Pathshala tracks. Pure parsing only; the Server Action writes through RLS.

export const SETUP_LISTS = ["membership_types", "funds", "inboxes", "zones", "pathshala_tracks"] as const;
export type SetupList = (typeof SETUP_LISTS)[number];

export function isSetupList(v: unknown): v is SetupList {
  return typeof v === "string" && (SETUP_LISTS as readonly string[]).includes(v);
}

export const MEMBERSHIP_TIERS = [
  { value: "community", label: "Community (free, no dues)" },
  { value: "yearly", label: "Yearly" },
  { value: "life", label: "Life" },
] as const;
export type MembershipTier = (typeof MEMBERSHIP_TIERS)[number]["value"];

type Read = (name: string) => string | null;
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** "Life membership (family)" → "life_membership_family": the stable key for a new row. */
export function keyFromName(name: string): string {
  const k = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return k || "item";
}

/** "$1,250.50" / "1250.5" → 125050 cents; "" → 0; null when not a money amount. */
export function dollarsToCents(raw: string): number | null {
  const t = raw.trim().replace(/[$,\s]/g, "");
  if (t === "") return 0;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

const text = (read: Read, n: string) => (read(n) ?? "").trim();
const on = (read: Read, n: string) => read(n) === "on" || read(n) === "true";

export type MembershipTypeInput = {
  name: string;
  tier: MembershipTier;
  fee_cents: number;
  period_months: number | null;
  includes_spouse: boolean;
  reference_required: boolean;
  ec_approval_required: boolean;
  voting_wait_days: number;
  active: boolean;
};

export function parseMembershipType(read: Read): Parsed<MembershipTypeInput> {
  const errors: string[] = [];
  const name = text(read, "name");
  if (name.length < 2 || name.length > 80) errors.push("Enter the membership type's name (2 to 80 characters).");
  const tier = text(read, "tier");
  if (!MEMBERSHIP_TIERS.some((t) => t.value === tier)) errors.push("Choose the tier: community, yearly or life.");
  const fee = dollarsToCents(text(read, "fee"));
  if (fee === null) errors.push("Enter the fee as an amount in dollars, e.g. 150 or 150.00 (0 for none).");
  const periodRaw = text(read, "period_months");
  const period = periodRaw === "" ? null : Number(periodRaw);
  if (period !== null && (!Number.isInteger(period) || period < 1 || period > 120)) errors.push("The period is a whole number of months from 1 to 120, or empty for no end.");
  if (tier === "yearly" && period === null) errors.push("A yearly membership needs its period in months (usually 12).");
  const waitRaw = text(read, "voting_wait_days") || "0";
  const wait = Number(waitRaw);
  if (!Number.isInteger(wait) || wait < 0 || wait > 3650) errors.push("The voting wait is a whole number of days from 0 to 3,650.");
  if (errors.length) return { ok: false, error: errors.join(" ") };
  return {
    ok: true,
    value: {
      name,
      tier: tier as MembershipTier,
      fee_cents: fee!,
      period_months: period,
      includes_spouse: on(read, "includes_spouse"),
      reference_required: on(read, "reference_required"),
      ec_approval_required: on(read, "ec_approval_required"),
      voting_wait_days: wait,
      active: read("active") === null ? true : on(read, "active"),
    },
  };
}

export function parseFund(read: Read): Parsed<{ name: string; restricted: boolean; active: boolean }> {
  const name = text(read, "name");
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Enter the fund's name (2 to 80 characters)." };
  return { ok: true, value: { name, restricted: on(read, "restricted"), active: read("active") === null ? true : on(read, "active") } };
}

export function parseInbox(read: Read): Parsed<{ name: string; response_target_hours: number }> {
  const errors: string[] = [];
  const name = text(read, "name");
  if (name.length < 2 || name.length > 80) errors.push("Enter the inbox's name, e.g. Office (2 to 80 characters).");
  const hours = Number(text(read, "response_target_hours") || "48");
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) errors.push("The response target is a whole number of hours from 1 to 720.");
  if (errors.length) return { ok: false, error: errors.join(" ") };
  return { ok: true, value: { name, response_target_hours: hours } };
}

export function parseZone(read: Read): Parsed<{ name: string; zip_codes: string[] }> {
  const errors: string[] = [];
  const name = text(read, "name");
  if (name.length < 2 || name.length > 80) errors.push("Enter the zone's name (2 to 80 characters).");
  const zips = [...new Set(text(read, "zip_codes").split(/[\s,;]+/).filter(Boolean))];
  const bad = zips.filter((z) => !/^\d{5}$/.test(z));
  if (bad.length) errors.push(`These are not 5-digit ZIP codes: ${bad.slice(0, 5).join(", ")}.`);
  if (zips.length > 200) errors.push("List at most 200 ZIP codes per zone.");
  if (errors.length) return { ok: false, error: errors.join(" ") };
  return { ok: true, value: { name, zip_codes: zips } };
}

export function parseTrack(read: Read): Parsed<{ name: string }> {
  const name = text(read, "name");
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Enter the track's name, e.g. Weekend Pathshala (2 to 80 characters)." };
  return { ok: true, value: { name } };
}

/** "$1,250.00" for the list. */
export function centsLabel(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch (error) {
    console.error(`[setup-lists] could not format ${currency}; showing dollars:`, error);
    return `$${(cents / 100).toFixed(2)}`;
  }
}
