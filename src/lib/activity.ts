// Audit rows as short human sentences, for the "Recent activity (audit)"
// sections of the household and person views. Pure; tested.

import type { Json } from "@/lib/database.types";

export type AuditRowLike = {
  action: string;
  record_table: string | null;
  before: Json | null;
  after: Json | null;
};

const FIELD: Record<string, string> = {
  display_name: "name",
  address_line1: "address",
  address_line2: "address",
  city: "city",
  state_region: "state",
  postal_code: "ZIP code",
  zone_id: "zone",
  directory_opt_in: "directory",
  physical_mail_opt_in: "physical mail",
  first_name: "first name",
  last_name: "last name",
  preferred_name: "preferred name",
  date_of_birth: "date of birth",
  gender: "gender",
  email: "email",
  phone_e164: "mobile",
  language: "language",
  profession: "profession",
  employer: "employer",
  photo_opt_in: "photos",
  expertise_opt_in: "expertise listing",
  expertise_headline: "expertise",
  expertise_tags: "expertise",
  new_member_contact_opt_in: "open to new members",
  is_verified: "verification",
  merged_into_id: "merged",
  role: "relationship",
  is_primary: "primary member",
};

const IGNORED = new Set(["updated_at", "created_at", "verified_at"]);

function obj(j: Json | null): Record<string, Json | undefined> {
  return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, Json | undefined>) : {};
}

/** Plain names of the fields that changed between before and after (deduplicated, in a stable order). */
export function changedFields(before: Json | null, after: Json | null): string[] {
  const b = obj(before);
  const a = obj(after);
  const out: string[] = [];
  for (const k of Object.keys(a)) {
    if (IGNORED.has(k)) continue;
    if (JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null)) continue;
    const label = FIELD[k] ?? k.replace(/_/g, " ");
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** One audit row → { what happened, detail }. */
export function describeAudit(row: AuditRowLike): { what: string; detail: string } {
  const op = row.action.split(".").pop() ?? "";
  const a = obj(row.after);
  const b = obj(row.before);
  const fields = changedFields(row.before, row.after);
  const list = fields.slice(0, 3).join(", ") + (fields.length > 3 ? "…" : "");
  const table = row.record_table ?? "";
  switch (table) {
    case "households":
      if (op === "insert") return { what: "Household created", detail: String(a.display_name ?? "") };
      return { what: "Household details changed", detail: list };
    case "people":
      if (op === "insert") return { what: "Person added", detail: [a.first_name, a.last_name].filter(Boolean).join(" ") };
      if (fields.includes("merged")) return { what: "Record merged into another", detail: "" };
      return { what: "Profile changed", detail: list };
    case "household_members":
      if (op === "insert") return { what: "Joined a household", detail: cap(String(a.role ?? "")) };
      if (op === "delete") return { what: "Removed from a household", detail: "" };
      if (a.left_at && !b.left_at) return { what: "Left a household", detail: "" };
      if (!a.left_at && b.left_at) return { what: "Rejoined a household", detail: cap(String(a.role ?? "")) };
      return { what: "Household role changed", detail: list };
    case "memberships":
      if (op === "insert") return { what: `${cap(String(a.tier ?? ""))} membership started`.trim(), detail: String(a.status ?? "") };
      if (a.status !== b.status) return { what: `${cap(String(a.tier ?? ""))} membership ${String(a.status ?? "changed")}`, detail: "" };
      return { what: "Membership changed", detail: list };
    case "membership_applications":
      return { what: op === "insert" ? "Membership application started" : "Membership application updated", detail: cap(String(a.status ?? "").replace(/_/g, " ")) };
    case "pledges":
      return { what: op === "insert" ? "Pledge recorded" : "Pledge updated", detail: String(a.pledge_number ?? "") };
    case "payments":
      return { what: op === "insert" ? "Payment recorded" : "Payment updated", detail: String(a.receipt_number ?? "") };
    case "eligibility_snapshots":
      return { what: "Voting eligibility updated", detail: a.can_vote === true ? "Eligible" : a.can_vote === false ? "Not eligible" : "" };
    case "pathshala_enrollments":
      return { what: op === "insert" ? "Pathshala registration" : "Pathshala enrollment updated", detail: cap(String(a.status ?? "")) };
    case "background_checks":
      return { what: "Background check recorded", detail: cap(String(a.status ?? "")) };
    default:
      return { what: cap(`${table.replace(/_/g, " ")} ${op === "insert" ? "added" : op === "delete" ? "removed" : "changed"}`.trim()), detail: list };
  }
}
