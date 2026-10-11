// Records for the resolve engine, made from what the import engine already holds: the rows staged for an import run
// (people, households, payments) and the households already in the records. Pure: no database, no network.
//
// The import engine has mapped and checked each row into columns (`import_rows.data`, the transformed values) plus a few side
// values (`import_rows.extra`: the legacy and CRM ids, the household a person belongs to). That is all that is used here. The
// original cells (`import_rows.raw`) are not read: their headings differ from file to file, and guessing which one is a donor's
// name would be worse than saying so. A payment therefore finds its donor through the household and person references the import
// already resolved (and through the amount, date and check number against another source), not through a name.
//
// Identifier systems are named so the engine knows what an ID says (link.ts idScope): a `household_*` ID says "same household", a
// `person_*` ID says "same person". Two rows with different IDs in the same system are different records, and the engine says so.

import type { Json } from "@/lib/database.types";

import type { ExistingHousehold } from "../existing";
import type { RawRecord } from "./types";

export type ResolvableEntity = "people" | "households" | "payments";

export const RESOLVABLE_ENTITIES: readonly ResolvableEntity[] = ["people", "households", "payments"];

export function isResolvableEntity(entity: string): entity is ResolvableEntity {
  return (RESOLVABLE_ENTITIES as readonly string[]).includes(entity);
}

/** The columns of an import row that matching reads. */
export type ImportRowLike = { row_no: number; source_key?: string | null; data: Json | null; extra: Json | null };

function obj(v: Json | null | undefined): Record<string, Json> {
  return v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {};
}

function str(v: Json | null | undefined): string | null {
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** The value of a link to another record ({"$ref": "household", "value": "H-17", "by": "legacy"}), or of a plain value. */
function refOf(v: Json | null | undefined): { value: string; by: string | null } | null {
  if (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, Json>;
    const value = str(o.value);
    return value ? { value, by: str(o.by) } : null;
  }
  const value = str(v);
  return value ? { value, by: null } : null;
}

function householdIdKey(by: string | null): string {
  if (by === "legacy" || by === "number" || by === "crm") return `household_${by}`;
  return "household_ref";
}

function compact(ids: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ids)) if (v) out[k] = v;
  return out;
}

function centsToDollars(cents: Json | null | undefined): string | null {
  const n = typeof cents === "number" ? cents : typeof cents === "string" && /^-?\d+$/.test(cents.trim()) ? Number(cents.trim()) : null;
  if (n === null || !Number.isFinite(n)) return null;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(n));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * The staged rows of an import run as records for the engine. `source` names the file ("people.csv"); the record id is
 * `<source>#<row number>`, unique within the run. Rows are returned in row order.
 */
export function rawRecordsFromImportRows(entity: ResolvableEntity, rows: readonly ImportRowLike[], source: string): RawRecord[] {
  const out: RawRecord[] = [];
  const sorted = [...rows].sort((a, b) => a.row_no - b.row_no);
  for (const row of sorted) {
    const d = obj(row.data);
    const x = obj(row.extra);
    const base = { id: `${source}#${row.row_no}`, source, sourceKind: "spreadsheet" as const, row: row.row_no };
    if (entity === "people") {
      const household = refOf(x.household_id);
      const others = (str(x.other_emails) ?? "").split(/[;,]/).map((e) => e.trim()).filter(Boolean);
      out.push({
        ...base,
        kind: "person",
        name: str(d.first_name) || str(d.last_name) ? null : str(x.full_name),
        firstName: str(d.first_name),
        lastName: str(d.last_name),
        email: str(d.email),
        email2: others[0] ?? null,
        phone: str(d.phone_e164),
        dob: str(d.date_of_birth),
        ids: compact({
          person_connect: str(d.member_number),
          person_crm: str(x.crm_id),
          person_legacy: str(x.legacy_id),
          ...(household ? { [householdIdKey(household.by)]: household.value } : {}),
        }),
        // "child" here holds the row (the engine never decides about anyone under 18).
        role: str(x.relationship),
      });
    } else if (entity === "households") {
      out.push({
        ...base,
        kind: "household",
        name: str(d.display_name),
        address1: str(d.address_line1),
        address2: str(d.address_line2),
        city: str(d.city),
        state: str(d.state_region),
        zip: str(d.postal_code),
        ids: compact({ household_number: str(d.household_number), household_crm: str(x.crm_id), household_legacy: str(x.legacy_id) }),
      });
    } else {
      const household = refOf(d.household_id);
      const payer = refOf(d.payer_person_id);
      out.push({
        ...base,
        kind: "gift",
        ids: compact({
          ...(household ? { [householdIdKey(household.by)]: household.value } : {}),
          ...(payer ? { person_ref: payer.value } : {}),
        }),
        gift: { amount: centsToDollars(d.amount_cents), date: str(d.received_on), ref: str(d.check_number) ?? str(d.provider_ref) },
      });
    }
  }
  return out;
}

/** The id prefix of a record that is already in the records (never collides with a file row: those are `<file>#<n>`). */
export const EXISTING_ID_PREFIX = "existing:";

/**
 * Households already in the records, as link targets: one record for the household (its name, address and Connect number), one
 * per current member (name, e-mail, mobile, the household's address). Each carries `existing.householdId`, so a new row that lands
 * in one of them is joined to it and two existing households are never joined to each other.
 */
export function existingToRawRecords(list: readonly ExistingHousehold[], source = "Records already in Weaver"): RawRecord[] {
  const out: RawRecord[] = [];
  let row = 1;
  for (const h of list) {
    const existing = { householdId: h.id, number: h.number };
    const at = { address1: h.address1, address2: h.address2, zip: h.zip, city: h.city };
    out.push({
      id: `${EXISTING_ID_PREFIX}h:${h.id}`,
      source,
      sourceKind: "existing",
      row: row++,
      kind: "household",
      name: h.name,
      ...at,
      ids: compact({ household_number: h.number }),
      existing,
    });
    h.people.forEach((p, i) => {
      out.push({
        id: `${EXISTING_ID_PREFIX}p:${h.id}:${i}`,
        source,
        sourceKind: "existing",
        row: row++,
        kind: "person",
        name: p.name,
        email: p.email,
        phone: p.phone,
        ...at,
        existing,
      });
    });
  }
  return out;
}

/** The ids of the records that were made for link targets (they are not rows of the file). */
export function isExistingRecordId(id: string): boolean {
  return id.startsWith(EXISTING_ID_PREFIX);
}
