// Who holds a role, for the Settings commands. Reads what Settings › Roles reads (role grants, the people behind them) and says it
// in names: adults only (D2), with the member and household numbers that tell two namesakes apart. Nothing here writes.

import { chunk } from "@/lib/data/fetch-all";
import { addDays, dateInTz, startOfDayInTz, todayInTz } from "@/lib/dates";
import { isGrantActive } from "@/lib/permissions";
import { isAdultHolder, scopeWords } from "@/lib/settings-help/role-words";

import type { CommandContext } from "../../types";
import { must } from "../db";

type Row = Record<string, unknown>;

export type RoleRow = { key: string; name: string; tier: string; description: string | null; permissions: unknown };

export type Holder = {
  name: string;
  member_number: string | null;
  household_number: string | null;
  role_name: string;
  scope: string;
  /** The last day, or null when nobody has set an end. */
  until: string | null;
  status: "active" | "waiting_for_a_second_person";
};

export type HolderList = {
  holders: Holder[];
  /** People who hold a role but are not named because nothing confirms they are adults (or they are under 18). A count only. */
  not_shown: number;
  /** The community's owner, who can do everything without a role; null when there is none on record or they cannot be named. */
  owner: { name: string; member_number: string | null } | null;
};

/** The last day a grant works. A grant given "until Oct 10" ends at the start of Oct 11 in the community's time zone. */
export function lastDay(endsAt: string | null, timeZone: string): string | null {
  if (!endsAt) return null;
  const at = new Date(endsAt);
  if (Number.isNaN(at.getTime())) return null;
  const date = dateInTz(at, timeZone);
  return startOfDayInTz(date, timeZone) === at.toISOString() ? addDays(date, -1) : date;
}

export async function loadRoles(ctx: CommandContext): Promise<RoleRow[]> {
  const rows = must(await ctx.session.db.from("roles").select("key, name, tier, description, permissions").order("tier").order("name"), "read the roles");
  return (rows ?? []) as RoleRow[];
}

/**
 * The people holding these roles (all roles when `roleKeys` is empty), active grants and the ones waiting for a second person.
 * `centerWideOnly` leaves out grants for one event, class or zone: those never give center-wide rights.
 */
export async function loadHolders(ctx: CommandContext, roles: readonly RoleRow[], opts: { roleKeys?: readonly string[]; centerWideOnly?: boolean } = {}): Promise<HolderList> {
  const { db, center } = ctx.session;
  const tz = center.time_zone;
  const now = ctx.now?.() ?? new Date();
  const today = todayInTz(tz, now);
  const roleName = new Map(roles.map((r) => [r.key, r.name]));

  let q = db.from("role_grants").select("id, user_id, role_key, scope_kind, scope_id, starts_at, ends_at, status").eq("center_id", center.id);
  if (opts.roleKeys && opts.roleKeys.length > 0) q = q.in("role_key", [...opts.roleKeys]);
  const grants = ((must(await q.limit(1000), "read who holds the roles") ?? []) as Row[]).filter((g) => (opts.centerWideOnly ? g.scope_kind === "center" : true));

  const waiting = (g: Row) => g.status === "pending" && (g.ends_at === null || new Date(String(g.ends_at)) > now);
  const live = grants.filter((g) => (g.status !== "pending" && isGrantActive({ starts_at: String(g.starts_at), ends_at: (g.ends_at as string | null) ?? null }, now)) || waiting(g));

  const userIds = [...new Set(live.map((g) => String(g.user_id)))];
  const ownerRes = must(await db.from("center_owners").select("user_id").eq("center_id", center.id).maybeSingle(), "read the owner") as { user_id: string } | null;
  const ownerId = ownerRes?.user_id ?? null;
  const wantedUsers = [...new Set([...userIds, ...(ownerId ? [ownerId] : [])])];

  // user -> person -> details
  const personOf = new Map<string, string>();
  for (const part of chunk(wantedUsers)) {
    for (const l of (must(await db.from("center_users").select("user_id, person_id").eq("center_id", center.id).in("user_id", part), "read the people behind the roles") ?? []) as Row[]) {
      personOf.set(String(l.user_id), String(l.person_id));
    }
  }
  const personIds = [...new Set(personOf.values())];
  const people = new Map<string, Row>();
  const householdRoles = new Map<string, string[]>();
  const householdOf = new Map<string, string>();
  for (const part of chunk(personIds)) {
    for (const p of (must(await db.from("people").select("id, first_name, last_name, preferred_name, date_of_birth, member_number").in("id", part), "read the people who hold roles") ?? []) as Row[]) {
      people.set(String(p.id), p);
    }
    for (const m of (must(await db.from("household_members").select("person_id, household_id, role, is_primary").in("person_id", part).is("left_at", null), "read the households of the people who hold roles") ?? []) as Row[]) {
      const id = String(m.person_id);
      householdRoles.set(id, [...(householdRoles.get(id) ?? []), String(m.role)]);
      if (m.is_primary || !householdOf.has(id)) householdOf.set(id, String(m.household_id));
    }
  }
  const householdNumber = new Map<string, string | null>();
  for (const part of chunk([...new Set(householdOf.values())])) {
    for (const h of (must(await db.from("households").select("id, household_number").in("id", part), "read the household numbers") ?? []) as Row[]) {
      householdNumber.set(String(h.id), (h.household_number as string | null) ?? null);
    }
  }

  // Names of the events, classes and zones that scoped grants are for.
  const scopeIds: Record<"event" | "class" | "zone", string[]> = { event: [], class: [], zone: [] };
  for (const g of live) if ((g.scope_kind === "event" || g.scope_kind === "class" || g.scope_kind === "zone") && g.scope_id) scopeIds[g.scope_kind].push(String(g.scope_id));
  const scopeName = new Map<string, string>();
  const readNames = async (kind: "event" | "class" | "zone", ids: string[]) => {
    for (const part of chunk([...new Set(ids)])) {
      const res =
        kind === "event"
          ? await db.from("events").select("id, name").eq("center_id", center.id).in("id", part)
          : kind === "class"
            ? await db.from("pathshala_classes").select("id, name").eq("center_id", center.id).in("id", part)
            : await db.from("zones").select("id, name").eq("center_id", center.id).in("id", part);
      for (const r of (must(res, `read the ${kind}s the roles are for`) ?? []) as Row[]) scopeName.set(String(r.id), String(r.name));
    }
  };
  await readNames("event", scopeIds.event);
  await readNames("class", scopeIds.class);
  await readNames("zone", scopeIds.zone);

  const adultNamed = (userId: string) => {
    const personId = personOf.get(userId);
    const p = personId ? people.get(personId) : undefined;
    if (!personId || !p) return null;
    const adult = isAdultHolder({ date_of_birth: (p.date_of_birth as string | null) ?? null, household_roles: householdRoles.get(personId) ?? [] }, today);
    if (!adult) return null;
    const hh = householdOf.get(personId);
    return {
      name: `${String(p.preferred_name ?? "").trim() || String(p.first_name)} ${String(p.last_name)}`.trim(),
      member_number: (p.member_number as string | null) ?? null,
      household_number: hh ? (householdNumber.get(hh) ?? null) : null,
    };
  };

  let notShown = 0;
  const holders: Holder[] = [];
  for (const g of live) {
    const who = adultNamed(String(g.user_id));
    if (!who) {
      notShown += 1;
      continue;
    }
    holders.push({
      ...who,
      role_name: roleName.get(String(g.role_key)) ?? String(g.role_key),
      scope: scopeWords(String(g.scope_kind), g.scope_id ? (scopeName.get(String(g.scope_id)) ?? null) : null),
      until: lastDay((g.ends_at as string | null) ?? null, tz),
      status: waiting(g) ? "waiting_for_a_second_person" : "active",
    });
  }
  holders.sort((a, b) => a.role_name.localeCompare(b.role_name) || a.name.localeCompare(b.name));

  const owner = ownerId ? adultNamed(ownerId) : null;
  return { holders, not_shown: notShown, owner: owner ? { name: owner.name, member_number: owner.member_number } : null };
}

/** "Priya Shah, Rahul Shah and Nikhil Patel". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
