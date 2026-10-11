"use server";

import { revalidatePath } from "next/cache";

import { SCOPES } from "@/lib/commands/catalog/settings/grant-rules";
import { runScreenCommand } from "@/lib/commands/screen";
import { householdsById, orgIds, personName } from "@/lib/data/lookups";
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

/**
 * Give a role. The rules are applied by the `settings.grant_role` command (src/lib/commands/catalog/settings/grant-rules.ts), the
 * same code the ⌘K palette and Niva run once the person confirms. This action keeps the Roles screen's own browser confirmation and
 * its first checks, then runs the command as the signed-in person.
 */
export async function grantRoleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const grantee = String(formData.get("user_id") ?? "");
  const roleKey = String(formData.get("role_key") ?? "");
  const scopeKind = String(formData.get("scope_kind") ?? "center");
  const scopeId = String(formData.get("scope_id") ?? "");
  const endsOn = String(formData.get("ends_on") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  if (!isUuid(grantee)) return { ok: false, error: "Could not grant the role — choose a person who has signed in to Weaver at least once." };
  if (!(SCOPES as readonly string[]).includes(scopeKind)) return { ok: false, error: "Could not grant the role — choose a scope." };
  if (!roleKey || roleKey.length > 80) return { ok: false, error: "Could not grant the role — choose a role." };
  if (scopeKind !== "center" && !isUuid(scopeId)) return { ok: false, error: `Could not grant the role — choose which ${scopeKind} it is for.` };
  if (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return { ok: false, error: "Could not grant the role — the end date is not a valid date." };

  return runScreenCommand(
    "settings.grant_role",
    {
      user_id: grantee,
      role_key: roleKey,
      scope_kind: scopeKind,
      ...(scopeKind !== "center" ? { scope_id: scopeId } : {}),
      ...(endsOn ? { ends_on: endsOn } : {}),
      ...(reason ? { reason } : {}),
    },
    "grant the role",
  );
}

/** End a role at once (the `settings.revoke_role` command does the work; see grantRoleAction). */
export async function revokeGrantAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not revoke the role — the grant was not found." };
  return runScreenCommand("settings.revoke_role", { grant_id: id }, "revoke the role");
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
