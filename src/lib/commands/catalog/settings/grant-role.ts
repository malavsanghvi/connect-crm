// Giving and taking away a role. Roles and permissions are the owner's, so both are confirm-level and OFF for Niva until the
// community's owner ticks them (assistant.tools[<key>]). The Roles screen's Server Actions (grantRoleAction, revokeGrantAction) are
// thin wrappers over these `execute`s (runScreenCommand), so the screen, the ⌘K palette and Niva share one code path and the rules in
// grant-rules.ts. The two-person rule is the database's (app.enforce_role_grant makes the roles that need it start as pending); a
// role granted here lands pending exactly as it does on the screen, and only a different administrator approves it (settings.second_approval).

import { rolePrivateProducts } from "@/lib/permissions";
import { endsWords, scopeWords } from "@/lib/settings-help/role-words";
import { roleAllows } from "@/lib/settings-help/areas";
import { dbWithReason } from "@/lib/session";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandContext, type CommandPreview } from "../../types";

import { must } from "../db";
import { dbFail, lowerFirst } from "../people/shared";

import { describePeople, personForUser } from "./draft-role-grant";
import { SCOPES, planRoleGrant } from "./grant-rules";

const grantInput = object({
  user_id: f.uuid("The person's sign-in id, taken from settings.draft_role_grant after the person chose who."),
  role_key: f.string("The role's key, taken from settings.draft_role_grant (for example treasurer).", { max: 80 }),
  scope_kind: f.withDefault(f.enum("Which part of the community the role is for: center (the whole community), or one event, class or zone.", SCOPES), "center"),
  scope_id: f.optional(f.uuid("The one event, class or zone (its id) when the role is for just that.")),
  ends_on: f.optional(f.date("The last day the role works, like 2027-10-10. Leave it out for no end date.")),
  reason: f.optional(f.string("Why, in a sentence. It is kept in the audit log.", { max: 500 })),
});
type GrantInput = Infer<typeof grantInput>;

/** Whoever is not the screen's own hands has the person checked again: an adult who has signed in, and not the one asking. */
async function checkGrantee(ctx: CommandContext, userId: string) {
  const person = await personForUser(ctx, userId);
  if (person.user_id === ctx.session.userId) throw new CommandError("Nobody can give themselves a role. A different administrator has to do this.");
  return person;
}

export const grantRole = defineCommand<GrantInput, undefined>({
  key: "settings.grant_role",
  title: "Give a role to someone",
  description:
    "Give a role to a person who has signed in to Weaver, for the whole community or for one event, class or zone, with an optional last day. " +
    "ALWAYS prepare it first with settings.draft_role_grant (so the person chooses who, by household details, never by name alone) and pass that card's input here. " +
    "This asks the person to confirm and shows who, which role and what it allows; nothing is given until they do. Treasurer, administrator, finance volunteer, executive committee and privacy officer roles " +
    "do NOT start at once: they wait as pending until a DIFFERENT administrator approves them (only the person can do that, settings.second_approval). " +
    "Nobody can give a role to themselves, and platform and family roles cannot be given this way. Roles are only for adults.",
  level: "confirm",
  permission: "roles",
  // Off until the owner switches it on in the community's settings (assistant.tools.settings.grant_role).
  enabledByDefault: false,
  input: grantInput,
  async preview(ctx, inp): Promise<CommandPreview> {
    const plan = await planRoleGrant(ctx, inp);
    const person = await checkGrantee(ctx, inp.user_id);
    const allows = roleAllows(plan.role.permissions);
    return {
      summary: `Give ${plan.role.name} to ${person.name}.`,
      lines: [
        { label: "Person", value: [person.name, person.member_number ? `member ${person.member_number}` : null].filter(Boolean).join(" · ") },
        { label: "Role", value: plan.role.name },
        ...(allows.length > 0 ? [{ label: "It allows", value: allows.join("; ") }] : []),
        { label: "For", value: scopeWords(plan.scope_kind, plan.scope_name) },
        { label: "Lasts", value: endsWords(plan.ends_on) },
        ...(plan.reason ? [{ label: "Why", value: plan.reason }] : []),
      ],
      ...(person.household ? { households: [person.household] } : {}),
      warnings: [
        plan.waits_for_a_second_person
          ? `${plan.role.name} needs a second person: it will wait as pending, and starts only when a different administrator approves it under "Waiting for approval".`
          : `${plan.role.name} starts at once.`,
      ],
    };
  },
  confirmText: (_input, preview) => `Yes, ${lowerFirst(preview.summary.replace(/\.$/, ""))}`,
  async execute(ctx, inp) {
    // Everything is checked again now: the person, the role or an earlier grant may have changed since it was proposed.
    const plan = await planRoleGrant(ctx, inp);
    if (ctx.via !== "screen") await checkGrantee(ctx, inp.user_id);
    const { db, center, userId } = ctx.session;
    const writer = plan.reason ? await dbWithReason(ctx.session, plan.reason) : db;
    const { data: inserted, error } = await writer
      .from("role_grants")
      .insert({
        center_id: center.id,
        user_id: inp.user_id,
        role_key: inp.role_key,
        scope_kind: plan.scope_kind,
        scope_id: plan.scope_id,
        ends_at: plan.ends_at,
        granted_by: userId,
        reason: plan.reason,
      })
      .select("status")
      .single();
    if (error) return dbFail(`Could not grant ${plan.role.name}`, error);
    revalidateAfterCommand(["/settings/roles", "/content/guide"]); // zone leads are also assigned from Content › Guide & directory
    if (inserted?.status === "pending") {
      return {
        ok: true,
        data: undefined,
        message: `${plan.role.name} is waiting for a second person: it starts only when a different administrator approves it under "Waiting for approval".`,
      };
    }
    // WeCare and CatchTheMatch roles (0757): the database emails the organization's owner about each one.
    const ownerTold = rolePrivateProducts(plan.role).length > 0 ? " The organization's owner gets an email about it." : "";
    return { ok: true, data: undefined, message: `Granted ${plan.role.name}${plan.ends_on ? ` until ${plan.ends_on}` : ""}.${ownerTold}` };
  },
});

// ---------------------------------------------------------------------------
// Taking a role away
// ---------------------------------------------------------------------------
const revokeInput = object({
  grant_id: f.uuid("The grant to end: its id, from settings.role_holders (grant_id)."),
});
type RevokeInput = Infer<typeof revokeInput>;

type GrantRow = { ends_at: string | null; user_id: string; role_key: string; scope_kind: string; scope_id: string | null };

async function currentGrant(ctx: CommandContext, id: string): Promise<GrantRow> {
  const { db, center } = ctx.session;
  const current = must(
    await db.from("role_grants").select("ends_at, user_id, role_key, scope_kind, scope_id").eq("id", id).eq("center_id", center.id).maybeSingle(),
    "revoke the role",
  ) as GrantRow | null;
  if (!current) throw new CommandError("Could not revoke the role — the grant was not found.");
  if (current.ends_at && current.ends_at <= (ctx.now?.() ?? new Date()).toISOString()) throw new CommandError("Could not revoke the role — it has already ended.");
  return current;
}

export const revokeRole = defineCommand<RevokeInput, undefined>({
  key: "settings.revoke_role",
  title: "Take a role away from someone",
  description:
    "End a role that someone holds, at once. Find the grant with settings.role_holders (each holder has a grant_id). This asks the person to confirm and shows whose role it is; " +
    "nothing is taken away until they do. It stops working immediately. Giving it back later is a new grant (and for the roles that need a second person, a new approval). " +
    "A role that was only waiting for approval can also be ended this way.",
  level: "confirm",
  permission: "roles",
  // Off until the owner switches it on in the community's settings (assistant.tools.settings.revoke_role).
  enabledByDefault: false,
  input: revokeInput,
  async preview(ctx, inp): Promise<CommandPreview> {
    const grant = await currentGrant(ctx, inp.grant_id);
    const { db, center } = ctx.session;
    const role = must(await db.from("roles").select("key, name").eq("key", grant.role_key).maybeSingle(), "read the role") as { name: string } | null;
    const link = must(await db.from("center_users").select("person_id").eq("center_id", center.id).eq("user_id", grant.user_id).maybeSingle(), "find the person") as { person_id: string } | null;
    const holder = link ? (await describePeople(ctx, [link.person_id])).candidates[0] : undefined;
    if (!holder) throw new CommandError("Niva cannot show whose role this is. Please take it away on the Roles screen.");
    const roleName = role?.name ?? grant.role_key;
    return {
      summary: `Take ${roleName} away from ${holder.name}.`,
      lines: [
        { label: "Person", value: [holder.name, holder.member_number ? `member ${holder.member_number}` : null].filter(Boolean).join(" · ") },
        { label: "Role", value: roleName },
        { label: "Stops", value: "At once" },
      ],
      ...(holder.household ? { households: [holder.household] } : {}),
      warnings: [holder.user_id === ctx.session.userId ? "This is your own role. You will lose what it lets you do." : "They lose what the role lets them do, immediately."],
    };
  },
  confirmText: (_input, preview) => `Yes, ${lowerFirst(preview.summary.replace(/\.$/, ""))}`,
  async execute(ctx, inp) {
    const { db, center } = ctx.session;
    const current = await currentGrant(ctx, inp.grant_id);
    const now = (ctx.now?.() ?? new Date()).toISOString();
    // Plain filters only: PostgREST 12 rejects or=(…) logic trees on UPDATE.
    let update = db.from("role_grants").update({ ends_at: now }).eq("id", inp.grant_id).eq("center_id", center.id);
    update = current.ends_at ? update.eq("ends_at", current.ends_at) : update.is("ends_at", null);
    const rows = must(await update.select("id"), "revoke the role");
    if (!rows || rows.length === 0) throw new CommandError("Could not revoke the role — it changed meanwhile, or you lack permission. Reload and try again.");
    revalidateAfterCommand(["/settings/roles"]);
    return { ok: true, data: undefined, message: "Role revoked. It stopped working immediately." };
  },
});
