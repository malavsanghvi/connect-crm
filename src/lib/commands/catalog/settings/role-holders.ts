import { loadRoleFilter } from "@/lib/role-tags";
import { ACCESS_AREAS, ACCESS_AREA_KEYS, accessArea, permissionWords, permissionsFor, roleAllows, rolesThatGive } from "@/lib/settings-help/areas";
import { matchRoles } from "@/lib/settings-help/role-words";
import { needsSecondApprover } from "@/lib/security";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError } from "../../types";

import { loadHolders, loadRoles, nameList, type Holder, type RoleRow } from "./holders";

const SECOND_PERSON = "Anyone still waiting for approval does not have the right yet: a different administrator has to approve it first.";

/** The staff roles an organization lists (never a platform or a family role). */
function staffRoles(roles: readonly RoleRow[]): RoleRow[] {
  return roles.filter((r) => r.tier !== "platform" && r.tier !== "family");
}

// ---------------------------------------------------------------------------
// settings.role_holders: "who holds the treasurer role?"
// ---------------------------------------------------------------------------
const holdersInput = object({
  role: f.optional(
    f.string("The role, as a person would say it: treasurer, president, event manager. Leave it out to list every role with how many people hold it.", { max: 80 }),
  ),
});

export type RoleHoldersData =
  | { role_name: string; what_it_allows: string[]; needs_a_second_person: boolean; holders: Holder[]; waiting_for_a_second_person: Holder[]; not_shown: number }
  | { which_one: string[] }
  | { roles: { role_name: string; people: number; waiting_for_a_second_person: number }[]; not_shown: number };

export const roleHolders = defineCommand<Infer<typeof holdersInput>, RoleHoldersData>({
  key: "settings.role_holders",
  title: "Look up who holds a role",
  description:
    "Say who holds a role in this community: 'Who holds the treasurer role?', 'Who are the administrators?'. Give the role as people say it. " +
    "Returns each ADULT who holds it with their member number and household number (so two people with the same name can be told apart), " +
    "the part of the community the role is for (the whole community, or one event, class or zone), the last day it works, and what the role lets a person do, in words. " +
    "People waiting for a second person's approval are listed apart: they do not hold it yet. Without a role it lists every role with how many people hold it. " +
    "If the question could mean several roles it returns their names so you can ask which one. It changes nothing; to give or take away a role use settings.draft_role_grant, then the person confirms.",
  level: "read",
  permission: "roles",
  input: holdersInput,
  async execute(ctx, { role }) {
    const all = await loadRoles(ctx);
    const roles = staffRoles(all);
    if (!role) {
      const kindKey = ctx.session.kind?.key;
      const listed = kindKey ? await loadRoleFilter(ctx.session.db, kindKey) : () => true;
      const { holders, not_shown } = await loadHolders(ctx, roles);
      const rows = roles
        .filter((r) => listed(r.key) || holders.some((h) => h.role_name === r.name))
        .map((r) => ({
          role_name: r.name,
          people: holders.filter((h) => h.role_name === r.name && h.status === "active").length,
          waiting_for_a_second_person: holders.filter((h) => h.role_name === r.name && h.status !== "active").length,
        }));
      const held = rows.filter((r) => r.people > 0);
      return {
        ok: true,
        data: { roles: rows, not_shown },
        message: held.length === 0 ? "Nobody holds a role yet." : `${held.length} of ${rows.length} roles are held by at least one person. Ask about one role to see who.`,
      };
    }

    const found = matchRoles(role, roles);
    if (found.length === 0) throw new CommandError(`I could not find a role called "${role}". The roles are: ${nameList(roles.map((r) => r.name))}.`);
    if (found.length > 1) {
      return { ok: true, data: { which_one: found.map((r) => r.name) }, message: `That could be ${nameList(found.map((r) => r.name))}. Which one do you mean?` };
    }
    const r = found[0];
    const { holders, not_shown } = await loadHolders(ctx, roles, { roleKeys: [r.key] });
    const active = holders.filter((h) => h.status === "active");
    const waiting = holders.filter((h) => h.status !== "active");
    const people = [...new Set(active.map((h) => h.name))];
    const sentence =
      active.length === 0
        ? `Nobody holds ${r.name} right now.`
        : `${active.length === 1 ? "1 person holds" : `${active.length} people hold`} ${r.name}: ${nameList(people)}.`;
    return {
      ok: true,
      data: {
        role_name: r.name,
        what_it_allows: roleAllows(r.permissions),
        needs_a_second_person: needsSecondApprover(r.key),
        holders: active,
        waiting_for_a_second_person: waiting,
        not_shown,
      },
      message: [
        sentence,
        waiting.length > 0 ? `${waiting.length} more ${waiting.length === 1 ? "is" : "are"} waiting for a second person's approval.` : null,
        not_shown > 0 ? `${not_shown} more ${not_shown === 1 ? "is" : "are"} not shown because nothing confirms they are adults.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    };
  },
});

// ---------------------------------------------------------------------------
// settings.who_can_access: "who can see payments?"
// ---------------------------------------------------------------------------
const accessInput = object({
  area: f.enum(
    `What the person wants to know who can do. One of: ${ACCESS_AREAS.map((a) => `${a.key} (${a.label})`).join("; ")}.`,
    ACCESS_AREA_KEYS,
  ),
});

export type WhoCanData = {
  question: string;
  what_it_means: string;
  roles: { role_name: string; people: string[]; waiting_for_a_second_person: number }[];
  people_in_total: number;
  owner: { name: string; member_number: string | null } | null;
  not_shown: number;
};

export const whoCanAccess = defineCommand<Infer<typeof accessInput>, WhoCanData>({
  key: "settings.who_can_access",
  title: "Look up who can see or do something",
  description:
    "Answer 'who can see payments?', 'who can record a payment?', 'who can give roles?': pick the area, and it returns the roles that give that right and the ADULTS who hold them now, " +
    "plus what the right means in words (the permissions behind it). The community's owner is named apart: the owner can do everything without a role. " +
    "A role given for one event, class or zone does not count, because it gives no rights across the whole community. People waiting for a second person's approval do not count yet. " +
    "It changes nothing; it does not say who SHOULD have access.",
  level: "read",
  permission: "roles",
  input: accessInput,
  async execute(ctx, { area: key }) {
    const area = accessArea(key);
    if (!area) throw new CommandError("I do not know that area. Try: see payments, record a payment, give roles, change settings.");
    const roles = staffRoles(await loadRoles(ctx));
    const giving = rolesThatGive(area, roles);
    const { holders, not_shown, owner } = await loadHolders(ctx, roles, { roleKeys: giving.map((r) => r.key), centerWideOnly: true });
    const byRole = giving.map((r) => {
      const mine = holders.filter((h) => h.role_name === r.name);
      return {
        role_name: r.name,
        people: [...new Set(mine.filter((h) => h.status === "active").map((h) => h.name))],
        waiting_for_a_second_person: mine.filter((h) => h.status !== "active").length,
      };
    });
    const rolesShown = byRole.filter((r) => r.people.length > 0 || r.waiting_for_a_second_person > 0);
    const everyone = [...new Set(byRole.flatMap((r) => r.people))];
    const asked = `Who can ${area.label}?`;
    const needs = permissionWords(permissionsFor(area));
    const message =
      everyone.length === 0
        ? `Nobody holds a role that lets a person ${area.label}${owner ? `, other than the owner, ${owner.name}` : ""}.`
        : `${everyone.length === 1 ? "1 person" : `${everyone.length} people`} can ${area.label}: ${nameList(everyone)}${owner && !everyone.includes(owner.name) ? `, and the owner, ${owner.name}, who can do everything` : ""}.`;
    return {
      ok: true,
      data: {
        question: asked,
        what_it_means: `A role lets a person ${area.label} when it has at least one of these rights: ${needs.join("; ")}.`,
        roles: rolesShown,
        people_in_total: everyone.length,
        owner,
        not_shown,
      },
      message: [message, rolesShown.some((r) => r.waiting_for_a_second_person > 0) ? SECOND_PERSON : null].filter(Boolean).join(" "),
    };
  },
});
