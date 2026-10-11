import { todayInTz } from "@/lib/dates";
import { chunk } from "@/lib/data/fetch-all";
import { safeFilterText } from "@/lib/search-params";
import { roleAllows } from "@/lib/settings-help/areas";
import { endsWords, isAdultHolder, lastDayAfterMonths, matchRoles, scopeWords } from "@/lib/settings-help/role-words";
import { whereLabel, type FixAt } from "@/lib/settings-help/setup-view";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandContext, type HouseholdCard } from "../../types";

import { must } from "../db";
import { cardLine, cardsFor } from "../people/shared";

import { SCOPES, planRoleGrant, type GrantScope } from "./grant-rules";
import { loadRoles, nameList, type RoleRow } from "./holders";

type Row = Record<string, unknown>;

const input = object({
  person: f.optional(f.string("Who the role is for: a name, member number or email. Use it the first time; it returns the matching people with their household details so the person can choose.", { min: 2, max: 80 })),
  user_id: f.optional(f.uuid("The chosen person's sign-in id, taken from the people this command returned. Use it on the second call, after the person has chosen.")),
  role: f.string("The role as people say it: treasurer, president, event manager.", { max: 80 }),
  scope_kind: f.withDefault(f.enum("Which part of the community the role is for: center (the whole community, the usual), or one event, class or zone.", SCOPES), "center"),
  scope_id: f.optional(f.uuid("The one event, class or zone (its id) when the role is for just that.")),
  ends_on: f.optional(f.date("The last day the role works, like 2027-10-10. Leave it out for no end date.")),
  for_months: f.optional(f.integer("How long the role lasts, in months, instead of ends_on: 12 for a year.", { min: 1, max: 60 })),
  reason: f.optional(f.string("Why, in a sentence. It is kept in the audit log.", { max: 500 })),
});
export type DraftGrantInput = Infer<typeof input>;

export type GrantCandidate = {
  user_id: string;
  name: string;
  member_number: string | null;
  household: HouseholdCard | null;
};

export type GrantCard = {
  person: GrantCandidate;
  role_key: string;
  role_name: string;
  what_it_allows: string[];
  scope: string;
  scope_kind: GrantScope;
  scope_id: string | null;
  /** The last day the role works, or null when it has no end. */
  last_day: string | null;
  lasts: string;
  reason: string | null;
  /** True for the roles the database holds as pending until a different administrator approves them. */
  waits_for_a_second_person: boolean;
  /** The confirm command that gives it, with exactly this input. Calling it asks the person to confirm; it does not give the role by itself. */
  apply_with: { command: "settings.grant_role"; input: Record<string, string> };
};

export type DraftGrantData =
  | { stage: "choose_person"; candidates: GrantCandidate[]; not_signed_in_yet: { name: string; member_number: string | null }[]; hidden_because_under_18_or_unclear: number }
  | { stage: "which_role"; which_one: string[] }
  | { stage: "ready"; grant: GrantCard; where: FixAt | null };

// ---------------------------------------------------------------------------
// People who can be given a role: adults who have signed in
// ---------------------------------------------------------------------------
type Found = { candidates: GrantCandidate[]; notSignedIn: { name: string; member_number: string | null }[]; hidden: number };

function display(p: Row): string {
  return `${String(p.preferred_name ?? "").trim() || String(p.first_name)} ${String(p.last_name)}`.trim();
}

/** Name, member number or email of the person, the way Settings › Roles searches. */
function matchesText(p: Row, tokens: string[]): boolean {
  const hay = [p.first_name, p.last_name, p.email, p.member_number].map((x) => String(x ?? "").toLowerCase());
  if (tokens.length >= 2) return hay[0].startsWith(tokens[0]) && hay[1].startsWith(tokens[tokens.length - 1]);
  return hay.some((h) => h.includes(tokens[0]));
}

export async function describePeople(ctx: CommandContext, personIds: string[]): Promise<Found> {
  const { db, center } = ctx.session;
  const today = todayInTz(center.time_zone, ctx.now?.());
  const people: Row[] = [];
  const links: Row[] = [];
  const members: Row[] = [];
  for (const part of chunk(personIds)) {
    people.push(...((must(await db.from("people").select("id, first_name, last_name, preferred_name, email, date_of_birth, member_number").eq("center_id", center.id).in("id", part), "find the people") ?? []) as Row[]));
    links.push(...((must(await db.from("center_users").select("person_id, user_id").eq("center_id", center.id).in("person_id", part), "check who has signed in") ?? []) as Row[]));
    members.push(...((must(await db.from("household_members").select("person_id, household_id, role, is_primary").in("person_id", part).is("left_at", null), "find their households") ?? []) as Row[]));
  }
  const userOf = new Map(links.map((l) => [String(l.person_id), String(l.user_id)]));
  const rolesOf = (id: string) => members.filter((m) => String(m.person_id) === id).map((m) => String(m.role));
  const householdOf = (id: string) => {
    const mine = members.filter((m) => String(m.person_id) === id);
    return String((mine.find((m) => m.is_primary) ?? mine[0])?.household_id ?? "") || null;
  };

  let hidden = 0;
  const adults = people.filter((p) => {
    const ok = isAdultHolder({ date_of_birth: (p.date_of_birth as string | null) ?? null, household_roles: rolesOf(String(p.id)) }, today);
    if (!ok) hidden += 1;
    return ok;
  });
  const cards = await cardsFor(ctx, adults.filter((p) => userOf.has(String(p.id))).map((p) => householdOf(String(p.id))));
  const candidates: GrantCandidate[] = [];
  const notSignedIn: Found["notSignedIn"] = [];
  for (const p of adults) {
    const id = String(p.id);
    const user = userOf.get(id);
    if (!user) {
      notSignedIn.push({ name: display(p), member_number: (p.member_number as string | null) ?? null });
      continue;
    }
    const hh = householdOf(id);
    candidates.push({ user_id: user, name: display(p), member_number: (p.member_number as string | null) ?? null, household: cards.find((c) => c.household_id === hh) ?? null });
  }
  return { candidates, notSignedIn, hidden };
}

async function searchPeople(ctx: CommandContext, query: string): Promise<Found> {
  const { db, center } = ctx.session;
  const safe = safeFilterText(query);
  const tokens = safe.toLowerCase().split(" ").filter(Boolean);
  if (tokens.length === 0) throw new CommandError("Type at least 2 characters: a name, a member number or an email.");
  const base = db.from("people").select("id, first_name, last_name, email, member_number").eq("center_id", center.id).is("merged_into_id", null).eq("is_deceased", false).limit(25);
  const named =
    tokens.length >= 2
      ? base.ilike("first_name", `${tokens[0]}%`).ilike("last_name", `${tokens[tokens.length - 1]}%`)
      : base.or(`first_name.ilike.%${tokens[0]}%,last_name.ilike.%${tokens[0]}%,email.ilike.%${tokens[0]}%,member_number.ilike.%${tokens[0]}%`);
  const [byName, byId] = await Promise.all([named, db.rpc("resolve_identifier", { p_center: center.id, p_value: query.trim() })]);
  const ids = new Set<string>();
  for (const p of (must(byName, "search the people") ?? []) as Row[]) if (matchesText(p, tokens)) ids.add(String(p.id));
  for (const r of (must(byId, "search the identifiers") ?? []) as Row[]) if (r.person_id) ids.add(String(r.person_id));
  if (ids.size === 0) return { candidates: [], notSignedIn: [], hidden: 0 };
  return describePeople(ctx, [...ids].slice(0, 25));
}

export async function personForUser(ctx: CommandContext, userId: string): Promise<GrantCandidate> {
  const { db, center } = ctx.session;
  const link = must(await db.from("center_users").select("person_id").eq("center_id", center.id).eq("user_id", userId).maybeSingle(), "find the person") as { person_id: string } | null;
  if (!link) throw new CommandError("That person has not signed in to Weaver yet, so a role cannot be given. Invite them first in Settings › Team.");
  const found = await describePeople(ctx, [link.person_id]);
  const one = found.candidates[0];
  if (!one) throw new CommandError("Roles are only given to adults. Please do this on the Roles screen if it is right.");
  return one;
}

// ---------------------------------------------------------------------------
// The role, the scope and the end date
// ---------------------------------------------------------------------------
export function pickRole(ctx: CommandContext, roles: readonly RoleRow[], text: string): { role: RoleRow } | { which: string[] } {
  // The roles this person can give: the same limits the Roles screen applies (a platform role only for the platform team, a family role never).
  const grantable = roles.filter((r) => r.tier !== "family" && (r.tier !== "platform" || ctx.session.isPlatformAdmin));
  const found = matchRoles(text, grantable);
  if (found.length === 0) {
    const refused = matchRoles(text, roles);
    if (refused.length === 1 && refused[0].tier === "platform") throw new CommandError(`${refused[0].name} is a platform role: only the Weaver platform team gives it.`);
    if (refused.length === 1 && refused[0].tier === "family") throw new CommandError(`${refused[0].name} comes from household relationships, so it is not given as a role.`);
    throw new CommandError(`I could not find a role called "${text}". The roles are: ${nameList(grantable.map((r) => r.name))}.`);
  }
  if (found.length > 1) return { which: found.map((r) => r.name) };
  return { role: found[0] };
}

/** The last day from what the person asked ("for a year" is 12 months from today), or the date they gave, or null for no end. The rules for the date are the grant's own (grant-rules.ts). */
export function endFromMonths(ctx: CommandContext, inp: Pick<DraftGrantInput, "ends_on" | "for_months">): string | undefined {
  if (inp.ends_on && inp.for_months) throw new CommandError("Give an end date or a number of months, not both.");
  if (inp.for_months) return lastDayAfterMonths(todayInTz(ctx.session.center.time_zone, ctx.now?.()), inp.for_months);
  return inp.ends_on;
}

export const draftRoleGrant = defineCommand<DraftGrantInput, DraftGrantData>({
  key: "settings.draft_role_grant",
  title: "Prepare a role for someone",
  description:
    "Prepare giving a role to someone, for example 'give Priya the treasurer role for a year'. It never gives the role: it only shows what would be given, and a person decides. " +
    "First call it with `person` (a name, member number or email): it returns the adults with that name who have signed in to Weaver, each with their household details (number, community ID, city, adults), " +
    "and anyone who has not signed in yet. Show them to the person and let them choose; never choose by name alone. Then call it again with the chosen `user_id` and the `role` to get the prepared card: " +
    "the person, the role and what it allows in words, the part of the community it is for, the last day it works (use `for_months` for 'a year' = 12, or `ends_on`), and whether it will wait for a second person " +
    "(treasurer, administrator, finance volunteer, executive committee and privacy officer roles start pending until a different administrator approves them). " +
    "Roles are only for adults; nothing about a child is returned.",
  level: "draft",
  permission: "roles",
  input,
  async execute(ctx, inp) {
    if (Boolean(inp.person) === Boolean(inp.user_id)) {
      throw new CommandError("Say who the role is for: a name, a member number or an email. After the person has chosen from the people shown, pass their id instead.");
    }
    const roles = await loadRoles(ctx);
    const picked = pickRole(ctx, roles, inp.role);
    if ("which" in picked) return { ok: true, data: { stage: "which_role", which_one: picked.which }, message: `That could be ${nameList(picked.which)}. Which one do you mean?` };
    const role = picked.role;

    if (inp.person) {
      const found = await searchPeople(ctx, inp.person);
      const message =
        found.candidates.length === 0
          ? found.notSignedIn.length > 0
            ? `${nameList(found.notSignedIn.map((p) => p.name))} ${found.notSignedIn.length === 1 ? "has" : "have"} not signed in to Weaver yet, so a role cannot be given. Invite them first in Settings › Team.`
            : "I could not find an adult with that name, member number or email who has signed in."
          : found.candidates.length === 1
            ? `I found one person: ${found.candidates[0].name}${found.candidates[0].household ? ` (${cardLine(found.candidates[0].household)})` : ""}. Is this who you mean? Nothing has been given yet.`
            : `I found ${found.candidates.length} people. Which one do you mean? Nothing has been given yet.`;
      return {
        ok: true,
        data: { stage: "choose_person", candidates: found.candidates, not_signed_in_yet: found.notSignedIn.slice(0, 5), hidden_because_under_18_or_unclear: found.hidden },
        message,
      };
    }

    const person = await personForUser(ctx, inp.user_id!);
    if (person.user_id === ctx.session.userId) throw new CommandError("Nobody can give themselves a role. A different administrator has to do this.");
    // A role for the whole community never carries an event, class or zone: it would quietly give more than was asked.
    if (inp.scope_kind === "center" && inp.scope_id) {
      throw new CommandError("A role for the whole community has no event, class or zone. Leave that out, or choose event, class or zone.");
    }
    const plan = await planRoleGrant(ctx, {
      user_id: person.user_id,
      role_key: role.key,
      scope_kind: inp.scope_kind,
      scope_id: inp.scope_id,
      ends_on: endFromMonths(ctx, inp),
      reason: inp.reason,
    });
    const where = scopeWords(plan.scope_kind, plan.scope_name);
    const grant: GrantCard = {
      person,
      role_key: role.key,
      role_name: role.name,
      what_it_allows: roleAllows(role.permissions),
      scope: where,
      scope_kind: plan.scope_kind,
      scope_id: plan.scope_id,
      last_day: plan.ends_on,
      lasts: endsWords(plan.ends_on),
      reason: plan.reason,
      waits_for_a_second_person: plan.waits_for_a_second_person,
      apply_with: {
        command: "settings.grant_role",
        input: {
          user_id: person.user_id,
          role_key: role.key,
          scope_kind: plan.scope_kind,
          ...(plan.scope_id ? { scope_id: plan.scope_id } : {}),
          ...(plan.ends_on ? { ends_on: plan.ends_on } : {}),
          ...(plan.reason ? { reason: plan.reason } : {}),
        },
      },
    };
    return {
      ok: true,
      data: { stage: "ready", grant, where: whereLabel("/settings/roles") },
      message:
        `Nothing has been given yet. This is what is prepared: ${role.name} for ${person.name}${person.household ? ` (${cardLine(person.household)})` : ""}, ${plan.scope_kind === "center" ? "for the whole community" : `for ${where}`}, ${endsWords(plan.ends_on)}.` +
        (plan.waits_for_a_second_person ? ` ${role.name} needs a second person: it would wait as pending until a different administrator approves it.` : ""),
    };
  },
});
