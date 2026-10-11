import { can } from "@/lib/permissions";
import {
  FIELD_LABELS,
  HOUSEHOLD_FIELDS,
  changedKeys,
  listPhrase,
  parseHouseholdForm,
  tierLabel,
  type HouseholdDetails,
  type Tier,
} from "@/lib/people";
import { dbWithReason } from "@/lib/session";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview } from "../../types";

import { cardsFor, dbFail } from "./shared";

const TIERS = ["community", "yearly", "life"] as const;
const text = (what: string) => f.optional(f.string(what, { min: 0, max: 1000 }));

const input = object({
  id: f.uuid("The household to change (its id, from people.find_household). Show the household card to the person first."),
  display_name: text("The household's name."),
  address_line1: text("Street address. Empty clears it."),
  address_line2: text("Address line 2. Empty clears it."),
  city: text("City. Empty clears it."),
  state_region: text("State. Empty clears it."),
  postal_code: text("ZIP code. Empty clears it."),
  zone_id: text("The zone's id. Empty clears it."),
  directory_opt_in: text("Screen only: listed in the member directory. Niva does not change it."),
  physical_mail_opt_in: text("Screen only: physical mail. Niva does not change it."),
  tier: f.optional(f.enum("Screen only: the membership tier. Niva does not change it.", TIERS)),
  tier_reason: text("Screen only: why the tier is changing."),
});
export type UpdateHouseholdInput = Infer<typeof input>;

type Plan = {
  id: string;
  original: HouseholdDetails;
  changes: Partial<HouseholdDetails>;
  keys: (keyof HouseholdDetails)[];
  tier: Tier | undefined;
  tierChanged: boolean;
  reason: string;
};

async function plan(ctx: CommandContext, inp: UpdateHouseholdInput): Promise<Plan> {
  const { db, center } = ctx.session;
  const id = inp.id;
  const given = inp as unknown as Record<string, unknown>;
  const raw: Record<string, string | undefined> = {};
  for (const k of HOUSEHOLD_FIELDS) if (typeof given[k] === "string") raw[k] = given[k] as string;

  if (ctx.via === "assistant") {
    // Privacy choices are the household's own; a membership tier is a membership decision made on the household screen.
    if (raw.directory_opt_in !== undefined || raw.physical_mail_opt_in !== undefined) throw new CommandError("Directory and mail choices are the household's own to make. Change them on the People screen.");
    if (inp.tier !== undefined) throw new CommandError("Niva does not change membership tiers yet. Do it on the household screen, where the reason goes in the audit log.");
  }

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
  if (current.error) throw new CommandDbError(current.error, "save the household");
  if (!current.data) throw new CommandError("Could not save the household — it was not found, or you can't see it.");
  if (current.data.merged_into_id) throw new CommandError("Could not save the household — it was merged into another household. Edit that one instead.");
  if (zones.error) throw new CommandDbError(zones.error, "save the household");

  const parsed = parseHouseholdForm(raw, (zones.data ?? []).map((z) => z.id));
  if (!parsed.ok) throw new CommandError(`Could not save the household — ${parsed.error}.`);
  const original: HouseholdDetails = { ...current.data, physical_mail_opt_in: current.data.physical_mail_opt_in !== false };
  const keys = changedKeys(original, parsed.value);

  // Tier: only with people.approve, and always with a reason.
  const tier = TIERS.find((t) => t === inp.tier);
  const currentTier = active.data?.tier ?? null;
  const tierChanged = tier !== undefined && tier !== currentTier;
  if (tierChanged && !can(ctx.session, "people.approve")) {
    throw new CommandError("Could not change the membership tier — tier changes need the people.approve permission.");
  }
  const reason = (inp.tier_reason ?? "").trim();
  if (tierChanged && !reason) throw new CommandError("Could not save — say why the membership tier is changing (it goes in the audit log).");

  const changes: Partial<HouseholdDetails> = {};
  for (const k of keys) (changes as Record<string, unknown>)[k] = parsed.value[k];
  return { id, original, changes, keys, tier, tierChanged, reason };
}

const shown = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

export const updateHousehold = defineCommand<UpdateHouseholdInput, undefined>({
  key: "people.update_household",
  title: "Update a household's details",
  description:
    "Change a household's name, address, city, state, ZIP code or zone. Only the details you send change; the rest stay. " +
    "It asks the person to confirm first, shows the household card and before and after. " +
    "Directory and mail choices and the membership tier are not changed by Niva; those are done on the People screen.",
  level: "confirm",
  permission: "householdsEdit",
  module: "people",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/households/actions.ts#updateHouseholdAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const p = await plan(ctx, inp);
    const cards = await cardsFor(ctx, [p.id]);
    const labels = [...p.keys.map((k) => FIELD_LABELS[k] ?? String(k)), ...(p.tierChanged ? [`tier to ${tierLabel(p.tier)}`] : [])];
    return {
      summary: labels.length ? `Change the ${listPhrase([...new Set(labels)])} of this household.` : "No changes for this household.",
      lines: [
        ...p.keys.map((k) => ({ label: FIELD_LABELS[k] ?? String(k), before: shown(p.original[k]), after: shown(p.changes[k]) })),
        ...(p.tierChanged ? [{ label: "Membership tier", after: tierLabel(p.tier), value: p.reason }] : []),
      ],
      households: cards,
      warnings: labels.length ? [] : ["Everything you gave is already what is on file, so nothing would change."],
    };
  },
  confirmText: (_i, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, inp) {
    const p = await plan(ctx, inp);
    if (p.keys.length === 0 && !p.tierChanged) return { ok: true, data: undefined, message: "No changes to save." };
    const { db, center } = ctx.session;
    if (p.keys.length > 0) {
      const upd = await db.from("households").update(p.changes).eq("id", p.id).eq("center_id", center.id).select("id");
      if (upd.error) throw new CommandDbError(upd.error, "save the household");
      if ((upd.data ?? []).length === 0) throw new CommandError("Could not save the household — nothing was changed (you may not have permission to edit it).");
    }
    if (p.tierChanged && p.tier) {
      const t = await (await dbWithReason(ctx.session, p.reason)).rpc("change_household_tier", { p_household: p.id, p_tier: p.tier, p_reason: p.reason });
      if (t.error) return dbFail("Could not change the membership tier", t.error, p.keys.length ? ` The other ${p.keys.length === 1 ? "change was" : "changes were"} saved.` : "");
    }
    revalidateAfterCommand(["/households", "/people", "/", `/households/${p.id}`]);
    const what = [...p.keys.map((k) => FIELD_LABELS[k] ?? String(k)), ...(p.tierChanged ? [`tier to ${tierLabel(p.tier)}`] : [])];
    return { ok: true, data: undefined, message: `Household saved (${listPhrase([...new Set(what)])}) · audit logged` };
  },
});
