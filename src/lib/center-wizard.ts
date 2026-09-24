// Platform › New center wizard (prototype AdminPortal Platform sub 1): the six
// steps, the choices on each, and the helpers that turn them into a
// centers row. Pure, shared by the page, the actions and the tests.

import { isPlainObject } from "@/lib/center-rules";
import type { Json } from "@/lib/database.types";

export const WIZARD_STEPS = ["Branding", "Tradition pack", "Payments & QuickBooks", "Import data", "Roles & admins", "Go-live checks"] as const;
export const WIZARD_STEP_COUNT = WIZARD_STEPS.length;

export const PRIMARY_COLORS = [
  { value: "#1B2C5C", label: "Navy" },
  { value: "#7A2E1F", label: "Maroon" },
  { value: "#1F7A4D", label: "Green" },
  { value: "#C9731C", label: "Saffron" },
] as const;

export const TRADITIONS = [
  { value: "shvetambar_murtipujak", label: "Shvetambar Murtipujak" },
  { value: "sthanakvasi", label: "Sthanakvasi" },
  { value: "terapanthi", label: "Terapanthi" },
  { value: "digambar", label: "Digambar" },
] as const;
export type Tradition = (typeof TRADITIONS)[number]["value"] | "other";

export function traditionLabel(t: string | null | undefined): string {
  if (t === "other") return "Configurable";
  return TRADITIONS.find((x) => x.value === t)?.label ?? "—";
}

export const IMPORT_SOURCES = [
  { value: "neon", label: "Neon" },
  { value: "salesforce", label: "Salesforce" },
  { value: "bloomerang", label: "Bloomerang" },
  { value: "spreadsheet", label: "Spreadsheet" },
] as const;

/** "Design partner center A" → "design-partner-center-a" (letters, digits, single hyphens, ≤ 40). */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug) && !slug.includes("--");
}

/** Where a center is in onboarding, kept in rules.onboarding.wizard_step (1–6). */
export function wizardStep(rules: Json): number | null {
  const o = isPlainObject(rules) ? rules.onboarding : undefined;
  const v = isPlainObject(o) ? o.wizard_step : undefined;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= WIZARD_STEP_COUNT ? v : null;
}

/** The STATUS cell: "Live", "Onboarding · step 3 of 6", "Suspended", "Exited". */
export function centerStatusLabel(status: string, rules: Json): { label: string; live: boolean } {
  if (status === "active") return { label: "Live", live: true };
  if (status === "onboarding") {
    const step = wizardStep(rules);
    return { label: step ? `Onboarding · step ${step} of ${WIZARD_STEP_COUNT}` : "Onboarding", live: false };
  }
  return { label: status.charAt(0).toUpperCase() + status.slice(1), live: false };
}

export const TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "Europe/London",
  "Asia/Kolkata",
] as const;

type Read = (name: string) => string | null;

/** What one wizard step writes: columns on app.centers plus keys merged into rules. */
export type WizardChange = {
  columns: { name?: string; slug?: string; tradition?: Tradition; time_zone?: string; state_region?: string | null; branding?: { [k: string]: Json | undefined } };
  rules: { [k: string]: Json | undefined };
};

export type ParsedWizardStep = { ok: true; change: WizardChange } | { ok: false; error: string };

/**
 * Validate one step of the new-center wizard. Admin emails (step 5) are
 * never stored: centers are readable by anyone, and inviting by email is
 * not available yet.
 */
export function parseWizardStep(step: number, read: Read, branding: Json = {}): ParsedWizardStep {
  const text = (n: string) => (read(n) ?? "").trim();
  switch (step) {
    case 1: {
      const name = text("name");
      const slug = text("slug").toLowerCase();
      const color = text("primary");
      const logo = text("logo_url");
      const tz = text("time_zone");
      const errors: string[] = [];
      if (name.length < 3 || name.length > 120) errors.push("Enter the center's name (3 to 120 characters).");
      if (!isValidSlug(slug)) errors.push("The public URL may use lowercase letters, digits and single hyphens (up to 40), e.g. partner-a.");
      if (!PRIMARY_COLORS.some((c) => c.value === color)) errors.push("Choose a primary colour.");
      if (logo && !/^https:\/\/\S+$/i.test(logo)) errors.push("The logo address must start with https://.");
      if (!(TIME_ZONES as readonly string[]).includes(tz)) errors.push("Choose the center's time zone.");
      if (errors.length) return { ok: false, error: errors.join(" ") };
      const base = isPlainObject(branding) ? branding : {};
      return {
        ok: true,
        change: {
          columns: { name, slug, time_zone: tz, branding: { ...base, primary: color, ...(logo ? { logo_url: logo } : {}) } },
          rules: {},
        },
      };
    }
    case 2: {
      const t = text("tradition");
      if (!TRADITIONS.some((x) => x.value === t)) return { ok: false, error: "Choose the center's tradition." };
      return { ok: true, change: { columns: { tradition: t as Tradition }, rules: {} } };
    }
    case 3: {
      const basis = text("basis");
      const state = text("state_region").toUpperCase();
      if (basis !== "cash" && basis !== "accrual") return { ok: false, error: "Choose cash or accrual accounting." };
      if (state && !/^[A-Z]{2}$/.test(state)) return { ok: false, error: "Enter the state as two letters, e.g. TX." };
      return { ok: true, change: { columns: { state_region: state || null }, rules: { accounting: { basis } } } };
    }
    case 4: {
      const source = text("import_source");
      if (!IMPORT_SOURCES.some((x) => x.value === source)) return { ok: false, error: "Choose the system the center's records come from." };
      return { ok: true, change: { columns: {}, rules: { onboarding: { import_source: source } } } };
    }
    case 5:
    case 6:
      return { ok: true, change: { columns: {}, rules: {} } };
    default:
      return { ok: false, error: "Unknown wizard step." };
  }
}
