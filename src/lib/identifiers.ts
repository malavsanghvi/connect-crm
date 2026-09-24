import type { IdentifierRules } from "@/lib/center-rules";
import type { IdentifierKind } from "@/lib/permissions";

// Labels for identifier kinds (app.identifier_kind plus the two Connect
// numbers that resolve_identifier returns as pseudo-kinds).

export function identifierKindLabel(
  kind: string,
  rules: Pick<IdentifierRules, "orgMemberLabel" | "orgHouseholdLabel">,
): string {
  switch (kind) {
    case "connect_member":
      return "Connect member number";
    case "connect_household":
      return "Connect household number";
    case "org_member":
      return rules.orgMemberLabel;
    case "org_household":
      return rules.orgHouseholdLabel;
    case "crm":
      return "Legacy CRM id";
    case "accounting":
      return "Accounting (QuickBooks) customer";
    case "bank_payer":
      return "Bank payer name";
    case "payment_provider":
      return "Payment-provider customer";
    case "other":
      return "Other identifier";
    default:
      return kind;
  }
}

export type SystemOption = { system: string; label: string | null };

/** `system` values offered per kind in the add-identifier form (with a default label). */
export function systemOptions(
  kind: IdentifierKind,
  rules: Pick<IdentifierRules, "orgMemberSystem" | "orgHouseholdSystem" | "legacySystems">,
): SystemOption[] {
  switch (kind) {
    case "org_member":
      return [{ system: rules.orgMemberSystem, label: null }];
    case "org_household":
      return [{ system: rules.orgHouseholdSystem, label: null }];
    case "crm":
      return rules.legacySystems.length > 0
        ? rules.legacySystems.map((l) => ({ system: l.system, label: l.label }))
        : [{ system: "neon", label: "Neon ID" }];
    case "accounting":
      return [{ system: "quickbooks", label: "QuickBooks customer" }];
    case "bank_payer":
      return [
        { system: "chase", label: null },
        { system: "bank", label: null },
      ];
    case "payment_provider":
      return [{ system: "stripe", label: "Stripe customer" }];
    default:
      return [];
  }
}

export type ResolvedIdentifier = {
  kind: string;
  system: string;
  value: string;
  person_id: string | null;
  household_id: string | null;
  display_name: string | null;
  household_name: string | null;
  household_number: string | null;
  org_household_id: string | null;
  members: string | null;
};

/** Which record an identifier kind must point at (0015 external_ids_org_target). */
export function identifierTarget(kind: string): "person" | "household" | "either" {
  if (kind === "org_member") return "person";
  if (kind === "org_household") return "household";
  return "either";
}

/**
 * One line for a resolver hit that never relies on a name alone:
 * "JSH member ID 0417 → Priya Shah, Shah family (JSH-H-2041)".
 */
export function describeResolvedHit(
  hit: ResolvedIdentifier,
  rules: Pick<IdentifierRules, "orgMemberLabel" | "orgHouseholdLabel">,
): string {
  const label = identifierKindLabel(hit.kind, rules);
  const who = hit.person_id
    ? [hit.display_name, hit.household_name].filter(Boolean).join(", ")
    : (hit.household_name ?? hit.display_name ?? "");
  return `${label} ${hit.value} → ${who || "unknown record"}${hit.household_number ? ` (${hit.household_number})` : ""}`;
}

/** Household ids a resolve_identifier() result points at (person rows carry their household). */
export function householdIdsFromResolved(rows: ResolvedIdentifier[]): string[] {
  return [...new Set(rows.map((r) => r.household_id).filter((x): x is string => !!x))];
}

/** Retired = its last valid day (valid_to) is before today. */
export function isRetired(validTo: string | null, today: string): boolean {
  return validTo !== null && validTo < today;
}

/**
 * Pad a numeric org ID to the center's width as the register issues it
 * ("417" → "0417" for JSH person IDs, rules.identifiers.org_member_digits = 4).
 * Non-numeric values and centers without a width are returned unchanged. The
 * database canonicalizes the same way (app.canonical_org_id), so lookups match
 * either form.
 */
export function padOrgId(value: string, digits: number | null): string {
  if (!digits) return value;
  const compact = value.replace(/\s+/g, "");
  if (!/^\d+$/.test(compact)) return value;
  const stripped = compact.replace(/^0+/, "") || "0";
  return stripped.length >= digits ? stripped : stripped.padStart(digits, "0");
}
