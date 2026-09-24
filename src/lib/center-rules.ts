import type { Json } from "@/lib/database.types";

// centers.rules is a per-center rule bag (0001 comment + seed). Helpers here
// read it defensively and validate edits made in Settings → Center.

type Obj = { [key: string]: Json | undefined };

export function isPlainObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function get(obj: Json, path: string[]): Json | undefined {
  let cur: Json | undefined = obj;
  for (const key of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

export type IdentifierRules = {
  /** Label for kind org_member — the org's PERSON id, e.g. "JSH member ID". */
  orgMemberLabel: string;
  /** external_ids.system for person ids, e.g. "jsh_register". */
  orgMemberSystem: string;
  /** Digits person ids are padded to (JSH: 4, so "417" = "0417"); null = not configured. */
  orgMemberDigits: number | null;
  /** Label for kind org_household — the org's HOUSEHOLD id, e.g. "JSH household ID". */
  orgHouseholdLabel: string;
  orgHouseholdSystem: string;
  orgHouseholdDigits: number | null;
  /** Legacy systems whose ids are kept as kind "crm" (JSH: neon, namocrm). */
  legacySystems: { system: string; label: string }[];
};

function text(v: Json | undefined, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}
function digits(v: Json | undefined): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

export function identifierRules(rules: Json): IdentifierRules {
  const r = (key: string) => get(rules, ["identifiers", key]);
  const memberSystem = text(r("org_member_system"), "org_register");
  return {
    orgMemberLabel: text(r("org_member_label"), "Organization member ID"),
    orgMemberSystem: memberSystem,
    orgMemberDigits: digits(r("org_member_digits")),
    orgHouseholdLabel: text(r("org_household_label"), "Organization household ID"),
    orgHouseholdSystem: text(r("org_household_system"), memberSystem),
    orgHouseholdDigits: digits(r("org_household_digits")),
    legacySystems: legacySystems(r("legacy_systems")),
  };
}

function legacySystems(v: Json | undefined): { system: string; label: string }[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((item) => {
    if (!isPlainObject(item) || typeof item.system !== "string" || !item.system.trim()) return [];
    const system = item.system.trim();
    return [{ system, label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : system }];
  });
}

// ---------------------------------------------------------------------------
// Rules JSON validation (Settings → Center)
// ---------------------------------------------------------------------------
type Check = { path: string; kind: "int" | "bool" | "string" | "object"; min?: number; max?: number };

/** Known keys and their types. Unknown keys are allowed (centers extend the bag). */
const RULE_CHECKS: Check[] = [
  // Bumped by every structured save in Settings → Rules ("Rules saved · version N"); see settings-rules.ts.
  { path: "version", kind: "int", min: 0 },
  { path: "child_login_age", kind: "int", min: 0, max: 21 },
  { path: "membership", kind: "object" },
  { path: "membership.reference_required", kind: "bool" },
  { path: "membership.max_pending_sponsorships_per_year", kind: "int", min: 0, max: 100 },
  { path: "membership.reference_expiry_days", kind: "int", min: 1, max: 365 },
  { path: "membership.reference_reminder_days", kind: "int", min: 1, max: 365 },
  { path: "membership.life_references_required", kind: "int", min: 1, max: 5 },
  { path: "membership.life_prior_yearly_months", kind: "int", min: 0, max: 120 },
  { path: "voting", kind: "object" },
  { path: "voting.life_member_wait_days", kind: "int", min: 0, max: 3650 },
  { path: "voting.requires_maintenance_paid", kind: "bool" },
  { path: "voting.requires_prior_year_pledges_paid", kind: "bool" },
  { path: "lunch", kind: "object" },
  { path: "lunch.slot_minutes", kind: "int", min: 5, max: 240 },
  { path: "lunch.family_with_child_under_12_at_start", kind: "bool" },
  { path: "lunch.senior_at_start", kind: "bool" },
  { path: "lunch.reminder_minutes_before", kind: "int", min: 0, max: 120 },
  { path: "boli", kind: "object" },
  { path: "boli.step_cents", kind: "int", min: 1 },
  { path: "boli.soft_close_minutes", kind: "int", min: 0, max: 120 },
  { path: "fees", kind: "object" },
  { path: "fees.ask_donor_to_cover", kind: "bool" },
  { path: "points", kind: "object" },
  { path: "points.anumodana_daily_cap", kind: "int", min: 0, max: 1000 },
  { path: "points.anumodana_points", kind: "int", min: 0, max: 1000 },
  { path: "points.support_points", kind: "int", min: 0, max: 1000 },
  { path: "points.day_complete_bonus", kind: "int", min: 0, max: 1000 },
  { path: "points.streak_rest_days_per_month", kind: "int", min: 0, max: 31 },
  { path: "points.behind_after_days", kind: "int", min: 1, max: 60 },
  { path: "rsvp", kind: "object" },
  { path: "rsvp.confirmation_hours_before", kind: "int", min: 0, max: 720 },
  { path: "rsvp.nudge_hour_local", kind: "int", min: 0, max: 23 },
  { path: "store", kind: "object" },
  { path: "store.gift_pack_cents", kind: "int", min: 0 },
  { path: "store.cancel_hours_before_pickup", kind: "int", min: 0, max: 720 },
  { path: "accounting", kind: "object" },
  { path: "onboarding", kind: "object" },
  { path: "onboarding.fields", kind: "object" },
  { path: "onboarding.wizard_step", kind: "int", min: 1, max: 6 },
  { path: "onboarding.import_source", kind: "string" },
  { path: "notifications", kind: "object" },
  { path: "notifications.quiet_start_hour", kind: "int", min: 0, max: 23 },
  { path: "notifications.quiet_end_hour", kind: "int", min: 0, max: 23 },
  { path: "notifications.event_day_during_quiet_hours", kind: "bool" },
  { path: "notifications.triggers", kind: "object" },
  { path: "security", kind: "object" },
  { path: "security.printed_signin_codes", kind: "bool" },
  { path: "security.admin_session_hours", kind: "int", min: 1, max: 24 },
  { path: "security.admin_idle_minutes", kind: "int", min: 5, max: 240 },
  { path: "identifiers", kind: "object" },
  { path: "identifiers.org_member_label", kind: "string" },
  { path: "identifiers.org_member_system", kind: "string" },
  { path: "identifiers.org_member_digits", kind: "int", min: 1, max: 12 },
  { path: "identifiers.org_household_label", kind: "string" },
  { path: "identifiers.org_household_system", kind: "string" },
  { path: "identifiers.org_household_digits", kind: "int", min: 1, max: 12 },
  { path: "bank", kind: "object" },
  { path: "bank.institution", kind: "string" },
  { path: "bank.statement_format", kind: "string" },
];

export type RulesValidation = { ok: true; value: Obj } | { ok: false; errors: string[] };

/** Parse and check the rules JSON typed into the editor. */
export function validateRulesJson(text: string): RulesValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`The rules are not valid JSON: ${(e as Error).message}`] };
  }
  if (!isPlainObject(parsed)) return { ok: false, errors: ["The rules must be a JSON object ({ … })."] };
  const errors: string[] = [];
  for (const c of RULE_CHECKS) {
    const v = get(parsed, c.path.split("."));
    if (v === undefined || v === null) continue;
    if (c.kind === "object" && !isPlainObject(v)) errors.push(`"${c.path}" must be an object.`);
    if (c.kind === "bool" && typeof v !== "boolean") errors.push(`"${c.path}" must be true or false.`);
    if (c.kind === "string" && typeof v !== "string") errors.push(`"${c.path}" must be text.`);
    if (c.kind === "int") {
      if (typeof v !== "number" || !Number.isInteger(v)) {
        errors.push(`"${c.path}" must be a whole number.`);
      } else {
        if (c.min !== undefined && v < c.min) errors.push(`"${c.path}" must be at least ${c.min}.`);
        if (c.max !== undefined && v > c.max) errors.push(`"${c.path}" must be at most ${c.max}.`);
      }
    }
  }
  const legacy = get(parsed, ["identifiers", "legacy_systems"]);
  if (legacy !== undefined && legacy !== null) {
    if (!Array.isArray(legacy)) errors.push(`"identifiers.legacy_systems" must be a list of {"system", "label"} entries.`);
    else
      legacy.forEach((item, i) => {
        if (!isPlainObject(item) || typeof item.system !== "string" || !item.system.trim()) {
          errors.push(`"identifiers.legacy_systems[${i}]" needs a "system" name.`);
        }
      });
  }
  const format = get(parsed, ["bank", "statement_format"]);
  if (format !== undefined && format !== null && !["generic_csv", "chase_csv", "ofx"].includes(String(format))) {
    errors.push(`"bank.statement_format" must be "chase_csv", "generic_csv" or "ofx".`);
  }
  const fields = get(parsed, ["onboarding", "fields"]);
  if (isPlainObject(fields)) {
    for (const [k, v] of Object.entries(fields)) {
      if (v !== "required" && v !== "optional" && v !== "hidden") errors.push(`"onboarding.fields.${k}" must be "required", "optional" or "hidden".`);
    }
  }
  const triggers = get(parsed, ["notifications", "triggers"]);
  if (isPlainObject(triggers)) {
    for (const [k, v] of Object.entries(triggers)) {
      if (typeof v !== "boolean") errors.push(`"notifications.triggers.${k}" must be true or false.`);
    }
  }
  const basis = get(parsed, ["accounting", "basis"]);
  if (basis !== undefined && basis !== "cash" && basis !== "accrual") {
    errors.push(`"accounting.basis" must be "cash" or "accrual".`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: parsed };
}

/** Feature flags must be a flat object of booleans. */
export function validateFlags(value: unknown): string[] {
  if (!isPlainObject(value)) return ["Feature flags must be an object."];
  return Object.entries(value)
    .filter(([, v]) => typeof v !== "boolean")
    .map(([k]) => `Feature flag "${k}" must be true or false.`);
}
