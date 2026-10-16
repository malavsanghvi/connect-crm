// The rules for giving a role, as the Roles screen has always applied them (src/app/(app)/settings/roles/actions.ts, now a wrapper over
// the commands in grant-role.ts). They are TypeScript and stay TypeScript: nothing is moved into the database here. The database
// still enforces its own (app.enforce_role_grant: not to yourself, no platform roles, the pending state for roles that need a second
// person), and RLS decides who may write at all. The sentences are the screen's, word for word.

import { addDays, startOfDayInTz, todayInTz } from "@/lib/dates";
import { kindName, type KindProfile } from "@/lib/kind";
import { canGrantRole, rolePrivateProducts, type OrgPrivateProduct } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { needsSecondApprover } from "@/lib/security";

import { CommandError, type CommandContext } from "../../types";
import { must } from "../db";

export const SCOPES = ["center", "event", "class", "zone"] as const;
export type GrantScope = (typeof SCOPES)[number];

export type GrantRequest = {
  user_id: string;
  role_key: string;
  scope_kind: GrantScope;
  scope_id?: string;
  /** The last day the role works (YYYY-MM-DD). */
  ends_on?: string;
  reason?: string;
};

export type GrantPlan = {
  role: { key: string; name: string; tier: string; permissions: unknown };
  scope_kind: GrantScope;
  scope_id: string | null;
  scope_name: string | null;
  ends_on: string | null;
  /** The moment it stops: the start of the day after `ends_on` in the community's time zone. */
  ends_at: string | null;
  reason: string | null;
  /** The roles the database holds as pending until a different administrator approves them. */
  waits_for_a_second_person: boolean;
};

const DOING = "grant the role";

/** The products' catalog names (app.modules.label, 0750), when the kind has no name of its own for them. */
const PRODUCT_NAMES: Readonly<Record<OrgPrivateProduct, string>> = { care: "DonorDelight", matching: "CatchTheMatch" };

/** An identical grant that still works (or still waits for a second person): the table allows duplicates; they only confuse. */
export async function holdsAlready(ctx: CommandContext, userId: string, roleKey: string, kind: GrantScope, scopeId: string | null, doing = DOING): Promise<boolean> {
  const { db, center } = ctx.session;
  const now = ctx.now?.() ?? new Date();
  const same = (must(await db.from("role_grants").select("id, scope_id, ends_at").eq("center_id", center.id).eq("user_id", userId).eq("role_key", roleKey).eq("scope_kind", kind), doing) ?? []) as {
    scope_id: string | null;
    ends_at: string | null;
  }[];
  return same.some((g) => (scopeId ? g.scope_id === scopeId : g.scope_id === null || g.scope_id === undefined) && (g.ends_at === null || g.ends_at === undefined || new Date(g.ends_at) > now));
}

/**
 * Check a grant the way the Roles screen does, in its order and with its sentences, and say what it would be. Throws CommandError
 * for a problem the person can fix; a database failure is a CommandDbError ("Could not grant the role").
 */
export async function planRoleGrant(ctx: CommandContext, req: GrantRequest): Promise<GrantPlan> {
  const { db, center, isPlatformAdmin } = ctx.session;

  const role = must(await db.from("roles").select("key, name, tier, permissions").eq("key", req.role_key).maybeSingle(), DOING) as GrantPlan["role"] | null;
  if (!role) throw new CommandError("Could not grant the role — choose a role.");
  if (role.tier === "platform" && !isPlatformAdmin) throw new CommandError(`Could not grant ${role.name} — platform roles are granted by the platform team only.`);
  if (role.tier === "family") throw new CommandError(`Could not grant ${role.name} — family roles come from household relationships, not grants.`);
  // The organization's own data (0757, app.role_grants_private_rule says the same): DonorDelight and CatchTheMatch roles.
  const products = rolePrivateProducts(role);
  if (products.length > 0) {
    if (!canGrantRole(ctx.session, role)) {
      const kind = ctx.session.kind as KindProfile | undefined;
      const names = products.map((p) => (kind ? kindName(kind, p, PRODUCT_NAMES[p]) : PRODUCT_NAMES[p])).join(" and ");
      throw new CommandError(`Could not grant ${role.name} — only the organization's owner or someone who manages ${names} can give it.`);
    }
    if (req.scope_kind !== "center") {
      throw new CommandError(`Could not grant ${role.name} — it works for the whole organization only. Give it without an event, class or zone.`);
    }
  }

  let scopeId: string | null = null;
  let scopeName: string | null = null;
  if (req.scope_kind !== "center") {
    if (!req.scope_id || !isUuid(req.scope_id)) throw new CommandError(`Could not grant the role — choose which ${req.scope_kind} it is for.`);
    const read = async () => {
      switch (req.scope_kind) {
        case "event":
          return db.from("events").select("id, name").eq("id", req.scope_id!).eq("center_id", center.id).maybeSingle();
        case "class":
          return db.from("pathshala_classes").select("id, name").eq("id", req.scope_id!).eq("center_id", center.id).maybeSingle();
        default:
          return db.from("zones").select("id, name").eq("id", req.scope_id!).eq("center_id", center.id).maybeSingle();
      }
    };
    const exists = must(await read(), DOING) as { id: string; name: string } | null;
    if (!exists) throw new CommandError(`Could not grant the role — that ${req.scope_kind} was not found.`);
    scopeId = exists.id;
    scopeName = exists.name;
  }

  let endsAt: string | null = null;
  if (req.ends_on) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.ends_on)) throw new CommandError("Could not grant the role — the end date is not a valid date.");
    if (req.ends_on < todayInTz(center.time_zone, ctx.now?.())) throw new CommandError("Could not grant the role — the end date is in the past.");
    endsAt = startOfDayInTz(addDays(req.ends_on, 1), center.time_zone); // through the end of that day
  }

  if (await holdsAlready(ctx, req.user_id, req.role_key, req.scope_kind, scopeId)) {
    throw new CommandError(`This person already holds ${role.name} for that scope.`);
  }

  return {
    role,
    scope_kind: req.scope_kind,
    scope_id: scopeId,
    scope_name: scopeName,
    ends_on: req.ends_on || null,
    ends_at: endsAt,
    reason: req.reason?.trim() ? req.reason.trim().slice(0, 500) : null,
    waits_for_a_second_person: needsSecondApprover(role.key),
  };
}
