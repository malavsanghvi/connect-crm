"use server";

import { revalidatePath } from "next/cache";

import { householdsById, orgIds, personName } from "@/lib/data/lookups";
import { addDays, startOfDayInTz, todayInTz } from "@/lib/dates";
import { failure, type ActionResult } from "@/lib/errors";
import { isUuid, safeFilterText } from "@/lib/search-params";
import { authorizeAction, dbWithReason } from "@/lib/session";

export type PersonOption = {
  person_id: string;
  name: string;
  member_number: string | null;
  org_member_ids: string[];
  email: string | null;
  household_name: string | null;
  household_number: string | null;
  user_id: string | null;
};

/** People (with enough detail to tell namesakes apart) and whether they have an app login. */
export async function searchPeopleAction(query: string): Promise<ActionResult<PersonOption[]>> {
  const auth = await authorizeAction("roles", "search people");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const q = String(query ?? "").trim();
  if (q.length < 2) return { ok: false, error: "Type at least 2 characters — a name, email, member number or ID." };
  const safe = safeFilterText(q);
  const tokens = safe.split(" ").filter(Boolean);

  const ids = new Set<string>();
  const base = db.from("people").select("id").eq("center_id", center.id).is("merged_into_id", null).eq("is_deceased", false).limit(25);
  const byName =
    tokens.length >= 2
      ? base.ilike("first_name", `${tokens[0]}%`).ilike("last_name", `${tokens[tokens.length - 1]}%`)
      : tokens.length === 1
        ? base.or(`first_name.ilike.%${tokens[0]}%,last_name.ilike.%${tokens[0]}%,email.ilike.%${tokens[0]}%,member_number.ilike.%${tokens[0]}%`)
        : null;
  const [nameRes, idRes] = await Promise.all([byName, db.rpc("resolve_identifier", { p_center: center.id, p_value: q })]);
  if (nameRes?.error) return failure("Could not search people", nameRes.error);
  for (const p of nameRes?.data ?? []) ids.add(p.id);
  for (const r of idRes.data ?? []) if (r.person_id) ids.add(r.person_id);
  const list = [...ids].slice(0, 25);
  if (list.length === 0) return { ok: true, data: [] };

  const [people, links, members, org] = await Promise.all([
    db.from("people").select("id, first_name, last_name, preferred_name, member_number, email").in("id", list),
    db.from("center_users").select("person_id, user_id").eq("center_id", center.id).in("person_id", list),
    db.from("household_members").select("person_id, household_id, is_primary").in("person_id", list).is("left_at", null),
    orgIds(db, center.id, { personIds: list }),
  ]);
  if (people.error) return failure("Could not search people", people.error);
  if (links.error) return failure("Could not check which people have a login", links.error);
  const userOf = new Map((links.data ?? []).map((l) => [l.person_id, l.user_id]));
  const householdOf = new Map<string, string>();
  for (const m of [...(members.data ?? [])].sort((a, b) => Number(a.is_primary) - Number(b.is_primary))) householdOf.set(m.person_id, m.household_id);
  const { map: households } = await householdsById(db, [...householdOf.values()]);

  return {
    ok: true,
    data: (people.data ?? []).map((p) => {
      const h = households.get(householdOf.get(p.id) ?? "");
      return {
        person_id: p.id,
        name: personName(p),
        member_number: p.member_number,
        org_member_ids: org.byPerson.get(p.id) ?? [],
        email: p.email,
        household_name: h?.display_name ?? null,
        household_number: h?.household_number ?? null,
        user_id: userOf.get(p.id) ?? null,
      };
    }),
  };
}

const SCOPES = ["center", "event", "class", "zone"] as const;

export async function grantRoleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("roles", "grant the role");
  if (!auth.ok) return auth;
  const { db, center, userId, isPlatformAdmin } = auth.session;
  const grantee = String(formData.get("user_id") ?? "");
  const roleKey = String(formData.get("role_key") ?? "");
  const scopeKind = String(formData.get("scope_kind") ?? "center") as (typeof SCOPES)[number];
  const scopeId = String(formData.get("scope_id") ?? "");
  const endsOn = String(formData.get("ends_on") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  if (!isUuid(grantee)) return { ok: false, error: "Could not grant the role — choose a person who has signed in to Community Connect at least once." };
  if (!SCOPES.includes(scopeKind)) return { ok: false, error: "Could not grant the role — choose a scope." };

  const role = await db.from("roles").select("key, name, tier").eq("key", roleKey).maybeSingle();
  if (role.error) return failure("Could not grant the role", role.error);
  if (!role.data) return { ok: false, error: "Could not grant the role — choose a role." };
  if (role.data.tier === "platform" && !isPlatformAdmin) {
    return { ok: false, error: `Could not grant ${role.data.name} — platform roles are granted by the platform team only.` };
  }
  if (role.data.tier === "family") {
    return { ok: false, error: `Could not grant ${role.data.name} — family roles come from household relationships, not grants.` };
  }

  let scope: string | null = null;
  if (scopeKind !== "center") {
    if (!isUuid(scopeId)) return { ok: false, error: `Could not grant the role — choose which ${scopeKind} it is for.` };
    const table = scopeKind === "event" ? "events" : scopeKind === "class" ? "pathshala_classes" : "zones";
    const exists = await db.from(table).select("id").eq("id", scopeId).eq("center_id", center.id).maybeSingle();
    if (exists.error) return failure("Could not grant the role", exists.error);
    if (!exists.data) return { ok: false, error: `Could not grant the role — that ${scopeKind} was not found.` };
    scope = scopeId;
  }

  let endsAt: string | null = null;
  if (endsOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return { ok: false, error: "Could not grant the role — the end date is not a valid date." };
    if (endsOn < todayInTz(center.time_zone)) return { ok: false, error: "Could not grant the role — the end date is in the past." };
    endsAt = startOfDayInTz(addDays(endsOn, 1), center.time_zone); // through the end of that day
  }

  // Refuse an identical live grant (the table allows duplicates; they only confuse).
  let dupQ = db
    .from("role_grants")
    .select("id")
    .eq("center_id", center.id)
    .eq("user_id", grantee)
    .eq("role_key", roleKey)
    .eq("scope_kind", scopeKind)
    .or(`ends_at.is.null,ends_at.gt."${new Date().toISOString()}"`);
  dupQ = scope ? dupQ.eq("scope_id", scope) : dupQ.is("scope_id", null);
  const dup = await dupQ.limit(1);
  if (dup.error) return failure("Could not grant the role", dup.error);
  if ((dup.data ?? []).length > 0) return { ok: false, error: `This person already holds ${role.data.name} for that scope.` };

  const writer = reason ? await dbWithReason(auth.session, reason) : db;
  const { data: inserted, error } = await writer.from("role_grants").insert({
    center_id: center.id,
    user_id: grantee,
    role_key: roleKey,
    scope_kind: scopeKind,
    scope_id: scope,
    ends_at: endsAt,
    granted_by: userId,
    reason: reason || null,
  }).select("status").single();
  if (error) return failure(`Could not grant ${role.data.name}`, error);
  revalidatePath("/settings/roles");
  revalidatePath("/content/guide"); // zone leads are also assigned from Content › Guide & directory
  if (inserted?.status === "pending") {
    return {
      ok: true,
      message: `${role.data.name} is waiting for a second person: it starts only when a different administrator approves it under "Waiting for approval".`,
    };
  }
  return { ok: true, message: `Granted ${role.data.name}${endsOn ? ` until ${endsOn}` : ""}.` };
}

export async function revokeGrantAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("roles", "revoke the role");
  if (!auth.ok) return auth;
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not revoke the role — the grant was not found." };
  const { db, center } = auth.session;
  const current = await db.from("role_grants").select("ends_at").eq("id", id).eq("center_id", center.id).maybeSingle();
  if (current.error) return failure("Could not revoke the role", current.error);
  if (!current.data) return { ok: false, error: "Could not revoke the role — the grant was not found." };
  const now = new Date().toISOString();
  if (current.data.ends_at && current.data.ends_at <= now) return { ok: false, error: "Could not revoke the role — it has already ended." };
  // Plain filters only: PostgREST 12 rejects or=(…) logic trees on UPDATE.
  let update = db.from("role_grants").update({ ends_at: now }).eq("id", id).eq("center_id", center.id);
  update = current.data.ends_at ? update.eq("ends_at", current.data.ends_at) : update.is("ends_at", null);
  const { data, error } = await update.select("id");
  if (error) return failure("Could not revoke the role", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not revoke the role — it changed meanwhile, or you lack permission. Reload and try again." };
  revalidatePath("/settings/roles");
  return { ok: true, message: "Role revoked. It stopped working immediately." };
}

/** Two-person rule (0017 approve_role_grant): a different person with roles.manage activates a pending grant. */
export async function approveGrantAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("roles", "approve the role grant");
  if (!auth.ok) return auth;
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not approve the role grant — it was not found." };
  const { session } = auth;
  const g = await session.db.from("role_grants").select("status, granted_by, user_id, role_key").eq("id", id).eq("center_id", session.center.id).maybeSingle();
  if (g.error) return failure("Could not approve the role grant", g.error);
  if (!g.data || g.data.status !== "pending") return { ok: false, error: "Could not approve the role grant — it is no longer waiting for approval. Reload the page." };
  if (g.data.granted_by === session.userId) return { ok: false, error: "Could not approve the role grant — you made this grant; the two-person rule needs a different approver." };
  if (g.data.user_id === session.userId) return { ok: false, error: "Could not approve the role grant — nobody approves a role for themselves." };
  const writer = await dbWithReason(session, "Second approval of a role grant (two-person rule)");
  const { error } = await writer.rpc("approve_role_grant", { p_grant: id });
  if (error) return failure("Could not approve the role grant", error);
  revalidatePath("/settings/roles");
  return { ok: true, message: "Approved by a second person. The role works from now on." };
}
