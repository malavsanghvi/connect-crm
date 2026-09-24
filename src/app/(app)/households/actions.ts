"use server";

import { revalidatePath } from "next/cache";

import type { HouseholdFinderResult } from "@/app/(app)/giving/actions";
import { householdCards } from "@/lib/data/lookups";
import { searchHouseholds } from "@/lib/data/search";
import { failure, type ActionResult } from "@/lib/errors";
import {
  FIELD_LABELS,
  HOUSEHOLD_FIELDS,
  changedKeys,
  isHouseholdRole,
  listPhrase,
  normalizePhone,
  parseDateInput,
  parseHouseholdForm,
  tierLabel,
  type HouseholdDetails,
  type Tier,
} from "@/lib/people";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason } from "@/lib/session";
import { todayInTz } from "@/lib/dates";
import { can } from "@/lib/permissions";

// Household edits (People › household drawer). Every write goes through RLS
// (people.manage) and the audit trigger on households / household_members /
// memberships. Multi-row changes use the 0030 functions so they are all or
// nothing.

function refresh(householdId?: string) {
  revalidatePath("/households");
  revalidatePath("/people");
  revalidatePath("/");
  if (householdId) revalidatePath(`/households/${householdId}`);
}

function fields(fd: FormData, keys: readonly string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of keys) {
    const v = fd.get(k);
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

const TIERS: readonly Tier[] = ["community", "yearly", "life"];

export async function updateHouseholdAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not save the household — it was not found." };
  const auth = await authorizeAction("householdsEdit", "save the household");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;

  const [current, zones, active] = await Promise.all([
    db
      .from("households")
      .select("display_name, address_line1, address_line2, city, state_region, postal_code, zone_id, directory_opt_in, physical_mail_opt_in, merged_into_id")
      .eq("id", id)
      .eq("center_id", center.id)
      .maybeSingle(),
    db.from("zones").select("id").eq("center_id", center.id),
    db.from("memberships").select("tier").eq("household_id", id).eq("status", "active").order("starts_on", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (current.error) return failure("Could not save the household", current.error);
  if (!current.data) return { ok: false, error: "Could not save the household — it was not found, or you can't see it." };
  if (current.data.merged_into_id) return { ok: false, error: "Could not save the household — it was merged into another household. Edit that one instead." };
  if (zones.error) return failure("Could not save the household", zones.error);

  const parsed = parseHouseholdForm(fields(fd, HOUSEHOLD_FIELDS), (zones.data ?? []).map((z) => z.id));
  if (!parsed.ok) return { ok: false, error: `Could not save the household — ${parsed.error}.` };
  const original: HouseholdDetails = { ...current.data, physical_mail_opt_in: current.data.physical_mail_opt_in !== false };
  const keys = changedKeys(original, parsed.value);

  // Tier: only with people.approve, and always with a reason.
  const tierRaw = String(fd.get("tier") ?? "");
  const tier = TIERS.find((t) => t === tierRaw);
  const currentTier = active.data?.tier ?? null;
  const tierChanged = tier !== undefined && tier !== currentTier;
  if (tierChanged && !can(auth.session, "people.approve")) {
    return { ok: false, error: "Could not change the membership tier — tier changes need the people.approve permission." };
  }
  const reason = String(fd.get("tier_reason") ?? "").trim();
  if (tierChanged && !reason) return { ok: false, error: "Could not save — say why the membership tier is changing (it goes in the audit log)." };

  if (keys.length === 0 && !tierChanged) return { ok: true, message: "No changes to save." };

  if (keys.length > 0) {
    const changes: Partial<HouseholdDetails> = {};
    for (const k of keys) (changes as Record<string, unknown>)[k] = parsed.value[k];
    const upd = await db.from("households").update(changes).eq("id", id).eq("center_id", center.id).select("id");
    if (upd.error) return failure("Could not save the household", upd.error);
    if ((upd.data ?? []).length === 0) return { ok: false, error: "Could not save the household — nothing was changed (you may not have permission to edit it)." };
  }
  if (tierChanged && tier) {
    const t = await (await dbWithReason(auth.session, reason)).rpc("change_household_tier", { p_household: id, p_tier: tier, p_reason: reason });
    if (t.error) {
      const saved = keys.length ? ` The other ${keys.length === 1 ? "change was" : "changes were"} saved.` : "";
      return { ok: false, error: `${failure("Could not change the membership tier", t.error).error}${saved}` };
    }
  }
  refresh(id);
  const what = [...keys.map((k) => FIELD_LABELS[k] ?? k), ...(tierChanged ? [`tier to ${tierLabel(tier)}`] : [])];
  return { ok: true, message: `Household saved (${listPhrase([...new Set(what)])}) · audit logged` };
}

export async function addPersonAction(_prev: ActionResult<{ personId: string }> | null, fd: FormData): Promise<ActionResult<{ personId: string }>> {
  const household = String(fd.get("household_id") ?? "");
  if (!isUuid(household)) return { ok: false, error: "Could not add the person — the household was not found." };
  const auth = await authorizeAction("householdsEdit", "add the person");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;

  const first = String(fd.get("first_name") ?? "").trim();
  const last = String(fd.get("last_name") ?? "").trim();
  if (!first || !last) return { ok: false, error: "Could not add the person — first and last name are required." };
  const role = String(fd.get("role") ?? "");
  if (!isHouseholdRole(role) || role === "primary") return { ok: false, error: "Could not add the person — choose their relationship to the household." };
  const dob = parseDateInput(String(fd.get("date_of_birth") ?? ""));
  if (!dob.ok) return { ok: false, error: `Could not add the person — ${dob.error}.` };
  if (dob.value && dob.value > todayInTz(center.time_zone)) return { ok: false, error: "Could not add the person — the date of birth is in the future." };
  const phone = normalizePhone(String(fd.get("phone_e164") ?? ""));
  if (!phone.ok) return { ok: false, error: `Could not add the person — ${phone.error}.` };
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Could not add the person — that email address does not look right." };
  const gender = String(fd.get("gender") ?? "");

  const res = await db.rpc("staff_add_person", {
    p_household: household,
    p_first: first,
    p_last: last,
    p_role: role,
    p_dob: dob.value ?? undefined,
    p_gender: gender || undefined,
    p_email: email || undefined,
    p_phone: phone.value ?? undefined,
  });
  if (res.error) return failure("Could not add the person", res.error);
  refresh(household);
  return {
    ok: true,
    message: `${first} ${last} added to the household · audit logged${email || phone.value ? ". They can sign in to the member app with that email or mobile" : ""}`,
    data: { personId: String(res.data) },
  };
}

export async function mergeHouseholdsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const keep = String(fd.get("keep") ?? "");
  const drop = String(fd.get("drop") ?? "");
  if (!isUuid(keep) || !isUuid(drop)) return { ok: false, error: "Could not merge — choose both households first." };
  const auth = await authorizeAction("householdsEdit", "merge the households");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("merge_households", { p_keep: keep, p_drop: drop });
  if (res.error) return failure("Could not merge the households", res.error);
  refresh(keep);
  revalidatePath(`/households/${drop}`);
  revalidatePath("/people/merge");
  return { ok: true, message: "Households merged · members moved · the duplicate's giving history stays on it · audit logged" };
}

export async function dismissDuplicateAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("candidate") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not dismiss — the suggested duplicate was not found." };
  const auth = await authorizeAction("householdsEdit", "dismiss the suggested duplicate");
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  const res = await db
    .from("merge_candidates")
    .update({ status: "dismissed", resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("center_id", center.id)
    .eq("status", "open")
    .select("id");
  if (res.error) return failure("Could not dismiss the suggested duplicate", res.error);
  if ((res.data ?? []).length === 0) return { ok: false, error: "Could not dismiss — it was already resolved, or you can't change it." };
  revalidatePath("/people/merge");
  refresh();
  return { ok: true, message: "Marked as not a duplicate" };
}

/** Household picker search for People screens (move a person, merge households): needs people.manage. */
export async function findHouseholdsForPeopleAction(query: string): Promise<ActionResult<HouseholdFinderResult>> {
  const auth = await authorizeAction("householdsEdit", "search households");
  if (!auth.ok) return auth;
  const q = String(query ?? "").trim();
  if (q.length < 2) return { ok: false, error: "Type at least 2 characters — a name, a member or household ID." };
  if (q.length > 120) return { ok: false, error: "That search is too long." };
  const { db, center } = auth.session;
  const found = await searchHouseholds(db, center.id, q, { limit: 60 });
  if (found.error && found.householdIds.length === 0) return failure("Could not search households", found.error);
  const ids = found.householdIds.slice(0, 12);
  const cards = await householdCards(db, ids);
  if (cards.error && cards.map.size === 0) return failure("Could not load the household details", cards.error);
  return {
    ok: true,
    data: { cards: ids.flatMap((id) => (cards.map.has(id) ? [cards.map.get(id)!] : [])), hits: found.identifierMatches, more: found.householdIds.length > 12 },
  };
}
