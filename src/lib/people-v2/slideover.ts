// The pure core of the person slide-over (docs/PEOPLE_REDESIGN.md section 4, "Person slide-over"). No server imports and no React: the
// loader (slideover-load.ts) reads the database and fills these in, the components draw them, and the tests need no database.
//
//   - the model: what the slide-over shows, as plain serialisable data; each deep section carries its own state (ok, no access,
//     or a read that failed), so a section the role cannot read says so in words and never shows as an empty table
//   - section plan: which sections there are, which are open, where the places reserved for later slices sit
//   - lines: the read-only rows (account, roles, what the member told the community), in plain words
//   - ID chips: grouped by kind, finance kinds only for people who may read them, and the kinds that may be added
//   - the more menu, the addresses (shareable `?person=`), the home household of a person, and the check behind "Add person"
//
// Built for every organization: nothing here names a community or a tradition; relationship words and ID labels come from the
// community's own data (`relationshipLabel`, `identifierKindLabel`, its rules).

import { isAdultMember } from "@/lib/commands/child-filter";
import { formatDate } from "@/lib/dates";
import { identifierTarget, isRetired, systemOptions, type SystemOption } from "@/lib/identifiers";
import {
  RELATIONSHIP_OPTIONS,
  contactChannelLabel,
  formatPhone,
  isEmail,
  normalizePhone,
  parseDateInput,
  relationshipLabel,
  toUsDate,
  type HouseholdRole,
} from "@/lib/people";
import { hrefWith, isUuid, param, type RawSearchParams } from "@/lib/search-params";

import { adultsLine, type FamilyCheck, type FamilyModel, type FamilyPerson } from "./family-model";
import type { Values } from "./inline-edit";
import type { ProfileEditFacts } from "./profile-details";

// ---------------------------------------------------------------------------
// A section's state
// ---------------------------------------------------------------------------
/** What one deep section holds: its data, a refusal (the role cannot read it) or a read that failed. Never an empty table in place of either. */
export type Part<T> = { state: "ok"; data: T } | { state: "no-access" } | { state: "error"; message: string };

export const part = {
  ok: <T>(data: T): Part<T> => ({ state: "ok", data }),
  noAccess: <T = never>(): Part<T> => ({ state: "no-access" }),
  error: <T = never>(message: string): Part<T> => ({ state: "error", message }),
};

export const NO_ACCESS_TEXT = "You don't have access to this area";

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------
export type DetailHousehold = {
  id: string;
  name: string;
  number: string | null;
  /** The organization's own household id label ("Community household ID" unless the organization named one). */
  orgLabel: string;
  orgIds: string[];
  adults: string[];
  place: string | null;
};

/** The household of a Family page, as the slide-over shows it (its card line in parts). */
export function detailHousehold(model: FamilyModel): DetailHousehold {
  return { id: model.id, name: model.name, number: model.number, orgLabel: model.orgLabel, orgIds: model.card.orgIds, adults: model.card.adults, place: model.card.place };
}

export type AccountFacts = {
  /** When the person's app account was linked (an instant); null: not signed in yet. */
  linkedAt: string | null;
  hasEmail: boolean;
  hasMobile: boolean;
  /** Under this age a child's account is managed by the parents. */
  childLoginAge: number;
};

export type RolesFacts = { roles: Part<string[]>; waiver: Part<string>; background: Part<string> };

/** What the member told the community in the app. Members change it in the app; staff with people.manage change it here (migration 0723). */
export type ProfileDetails = {
  anniversary: string | null;
  dietary: { label: string; retired: boolean }[];
  emergency: { name: string; relationship: string | null; phone: string } | null;
  labelsNote: string | null;
  /** What the editor needs (the keys and the community's list). Left out where nothing edits: the details then read as lines. */
  edit?: ProfileEditFacts;
};

export type DetailId = {
  id: string;
  /** An identifier kind, or "connect_member" for the member number Weaver issued (never retired, never added). */
  kind: string;
  label: string;
  value: string;
  system: string | null;
  retired: boolean;
  canRetire: boolean;
};

export type AddIdKind = { kind: string; label: string; systems: SystemOption[]; hint?: string };

export type IdsFacts = {
  rows: DetailId[];
  addKinds: AddIdKind[];
  /** Member ids keep their width ("417" is saved as 0417); null when the organization sets none. */
  orgMemberDigits: number | null;
  /** Kinds this role cannot read, in words, so the section says what is hidden. */
  hiddenKinds: string[];
};

export type MembershipHeld = {
  id: string;
  tier: string;
  status: string;
  startsOn: string;
  endsOn: string | null;
  household: { name: string; number: string | null } | null;
};

export type PrivacyFacts = {
  /** photo_opt_in, new_member_contact_opt_in, expertise_opt_in, expertise_headline (the editors' values). */
  values: Values;
  /** "Listed with the household", "Not listed" or null (no household): the directory is a household choice. */
  directory: string | null;
  mail: string | null;
};

/**
 * What else is on an adult's record (the Profile section): interests, expertise areas, best call time and the daily learning goal,
 * which staff can change, and the ways the member said they like to be reached, which only the member changes (their sign-in consent
 * is kept with it). Null for a child: none of this is kept or offered for anyone under the age of majority (D2).
 */
export type PreferenceFacts = {
  /** interests, expertise_tags, best_call_time, gyan_daily_minutes (the editors' values). */
  values: Values;
  /** people.contact_channels as stored. */
  channels: string[];
  /** The learning module is on for the community, so the daily goal is offered (a goal already on file is shown whatever the module). */
  learningOn: boolean;
};

export type PersonDetailModel = {
  person: FamilyPerson;
  /** The household the page is about; null on the person's own page when they are in none. */
  household: DetailHousehold | null;
  /** people.manage, and the record is not merged. Without it every value is plain text. */
  canEdit: boolean;
  mergedIntoId: string | null;
  deceasedOn: string | null;
  timeZone: string;
  /** The community's own reading of "today", its age of majority and languages: what the editors need to check a draft. */
  check: FamilyCheck;
  account: Part<AccountFacts>;
  roles: RolesFacts;
  profileDetails: Part<ProfileDetails>;
  privacy: PrivacyFacts;
  preferences: PreferenceFacts | null;
  ids: Part<IdsFacts>;
  memberships: Part<MembershipHeld[]>;
  /** Links to the screens that own roles (null: this role has none). */
  ownerLinks: { roles: string | null };
};

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
export type SectionKey = "profile" | "custom_fields" | "account" | "roles" | "privacy" | "ids" | "memberships" | "events" | "giving" | "notes" | "history";

export type SectionPlan = {
  key: SectionKey;
  title: string;
  /** Open when the slide-over opens (plan: the first two). */
  open: boolean;
  /** A place kept in the structure for a later slice: nothing is drawn for it here. */
  reserved?: "custom-fields" | "notes";
};

/**
 * The sections in the order the plan gives them. Profile and Account and sign-in open by default. Custom fields (slice 2) sit right
 * under Profile and Notes (slices 10 to 13) before History: both are reserved places, drawn by whoever builds them.
 * Giving at a glance is there only when the Giving module is on and the community reads giving by person, and never for a child (D2: giving is kept with the
 * household, and nothing about a child is shown there). Events (this person's tickets, and "Add to an event") is there only with the Events module (`hasEvents`).
 */
export function sectionPlan(o: { isChild: boolean; givingByPerson: boolean; givingOn: boolean; hasHistory: boolean; hasEvents?: boolean; membershipOn?: boolean }): SectionPlan[] {
  const out: SectionPlan[] = [
    { key: "profile", title: "Profile", open: true },
    { key: "custom_fields", title: "Custom fields", open: true, reserved: "custom-fields" },
    { key: "account", title: "Account and sign-in", open: true },
    { key: "roles", title: "Roles, teams and waivers", open: false },
    { key: "privacy", title: "Privacy and directory", open: false },
    { key: "ids", title: "IDs", open: false },
    // Memberships: the person's and their family's, with the staff actions (assign, edit dates and notes, change tier) for a person
    // who holds both people.approve and people.manage. Only with the Membership module on (`membershipOn`, true unless said).
    ...(o.membershipOn === false ? [] : [{ key: "memberships" as const, title: "Memberships", open: false }]),
  ];
  if (o.hasEvents) out.push({ key: "events", title: "Events", open: false });
  if (o.givingByPerson && o.givingOn && !o.isChild) out.push({ key: "giving", title: "Giving at a glance", open: false });
  out.push({ key: "notes", title: "Notes", open: false, reserved: "notes" });
  if (o.hasHistory) out.push({ key: "history", title: "History", open: false });
  return out;
}

/** The sections that are drawn (the reserved places are not). */
export const drawnSections = (plan: readonly SectionPlan[]) => plan.filter((s) => !s.reserved);

// ---------------------------------------------------------------------------
// Read-only lines
// ---------------------------------------------------------------------------
export type DetailLine = {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad" | "muted";
  /** A small switched-off marker beside the value ("Coming next"). */
  soon?: boolean;
};

const fail = (what: string): DetailLine["value"] => `Could not load ${what}`;

/** App account, sign-in methods, member card and the printed code: for a child under the login age the parents manage the account. */
export function accountLines(o: { isChild: boolean; age: number | null; account: Part<AccountFacts>; memberNumber: string | null; timeZone: string }): DetailLine[] {
  const card = o.memberNumber ? `Rotating QR · ${o.memberNumber}` : "No member number yet";
  if (o.account.state === "no-access") return [{ label: "App account", value: NO_ACCESS_TEXT, tone: "muted" }];
  if (o.account.state === "error") return [{ label: "App account", value: fail("the app account"), tone: "bad" }, { label: "Member card", value: card }];
  const a = o.account.data;
  const managed = o.isChild && (o.age === null || o.age < a.childLoginAge);
  if (managed) {
    return [
      { label: "App account", value: `Managed by parents until age ${a.childLoginAge}` },
      { label: "Sign-in methods", value: "—" },
      { label: "Member card", value: card },
      { label: "Printed sign-in code", value: "—" },
    ];
  }
  const methods = [a.hasEmail ? "email" : null, a.hasMobile ? "mobile" : null].filter(Boolean).join(" and ");
  return [
    {
      label: "App account",
      value: a.linkedAt ? `Active · linked ${formatDate(a.linkedAt, o.timeZone)}` : "Not signed in yet",
      tone: a.linkedAt ? "ok" : "warn",
    },
    { label: "Sign-in methods", value: a.linkedAt && methods ? `Code by ${methods}` : "—" },
    { label: "Member card", value: card },
    ...(o.isChild ? [] : [{ label: "Printed sign-in code", value: "needs a fresh 2FA check", soon: true }]),
  ];
}

function partLine(label: string, p: Part<string[] | string>, empty: string, what: string): DetailLine {
  if (p.state === "no-access") return { label, value: NO_ACCESS_TEXT, tone: "muted" };
  if (p.state === "error") return { label, value: fail(what), tone: "bad" };
  const v = Array.isArray(p.data) ? p.data.join(", ") : p.data;
  return { label, value: v || empty };
}

/** Roles, volunteer waiver and background check. A child's waiver is signed by a parent and a background check does not apply. */
export function rolesLines(o: { isChild: boolean; facts: RolesFacts }): DetailLine[] {
  const f = o.facts;
  return [
    partLine("Roles", f.roles, "None", "the roles"),
    o.isChild ? { label: "Volunteer waiver", value: "Parent signs" } : partLine("Volunteer waiver", f.waiver, "None on file", "the waiver"),
    o.isChild ? { label: "Background check", value: "Not applicable" } : partLine("Background check", f.background, "None on file", "the background check"),
  ];
}

/** True when every line of the section is a refusal: the section then says it once instead of three times. */
export function allNoAccess(lines: readonly DetailLine[]): boolean {
  return lines.length > 0 && lines.every((l) => l.value === NO_ACCESS_TEXT);
}

/** Wedding anniversary (adults), dietary needs and the emergency contact: what the member gave in the app. */
export function profileDetailLines(o: { isChild: boolean; firstName: string; details: Part<ProfileDetails> }): DetailLine[] {
  const d = o.details;
  if (d.state === "no-access") return [{ label: "Given in the app", value: NO_ACCESS_TEXT, tone: "muted" }];
  if (d.state === "error") return [{ label: "Given in the app", value: fail("what this member gave in the app"), tone: "bad" }];
  const p = d.data;
  const given = (v: string | null | undefined): DetailLine["value"] => v || "Not given";
  const emergency = p.emergency
    ? `${[p.emergency.name, p.emergency.relationship ? `(${p.emergency.relationship.toLowerCase()})` : null].filter(Boolean).join(" ")} · ${formatPhone(p.emergency.phone)}`
    : o.isChild
      ? "Not given. A parent adds it in the app."
      : null;
  return [
    ...(o.isChild ? [] : [{ label: "Anniversary", value: given(p.anniversary ? toUsDate(p.anniversary) : null) }]),
    { label: "Dietary needs", value: given(p.dietary.map((x) => (x.retired ? `${x.label} (no longer offered)` : x.label)).join(", ") || null) },
    { label: o.isChild ? `Emergency contact for ${o.firstName}` : "Emergency contact", value: given(emergency) },
  ];
}

/** How the member said they like to be reached, as a read-only line ("Phone call, Email"); staff do not set it. */
export function reachedByLine(channels: readonly string[]): DetailLine {
  return { label: "Reached by", value: channels.length ? channels.map(contactChannelLabel).join(", ") : "Not given" };
}

/** The line under the name: "Primary · age 41", "Daughter · age 11", or just the age for someone in no household. */
export function detailSubline(p: Pick<FamilyPerson, "role" | "isPrimary" | "age" | "values">, hasHousehold: boolean): string {
  const rel = hasHousehold ? relationshipLabel(p.isPrimary ? "primary" : p.role, p.values.gender || null) : null;
  return [rel && rel !== "—" ? rel : null, p.age !== null ? `age ${p.age}` : null].filter(Boolean).join(" · ");
}

/** The household card line as plain facts (never a name alone): the number, the organization's id, the adults and the place. */
export function householdLine(h: DetailHousehold): string[] {
  return [h.name, h.number ? `No. ${h.number}` : "No household number yet", ...h.orgIds, h.adults.length ? adultsLine(h.adults) : null, h.place].filter(
    (x): x is string => Boolean(x),
  );
}

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------
/** The order the kinds are shown in: the numbers an organization knows people by first, finance last. */
export const ID_KIND_ORDER = ["connect_member", "org_member", "crm", "other", "accounting", "bank_payer", "payment_provider"] as const;

export type IdRow = { id: string; kind: string; system: string | null; value: string; valid_to: string | null };

/**
 * A person's identifiers as chips: only the kinds this role may read (finance kinds need a giving permission), live ones and
 * retired ones apart, the household-only kinds left out (they belong to the household). The member number Weaver issued comes first.
 */
export function shapeIdRows(o: {
  rows: readonly IdRow[];
  memberNumber: string | null;
  today: string;
  labelOf: (kind: string) => string;
  canView: (kind: string) => boolean;
  canManage: (kind: string) => boolean;
}): DetailId[] {
  const out: DetailId[] = [];
  if (o.memberNumber) out.push({ id: "member-number", kind: "connect_member", label: o.labelOf("connect_member"), value: o.memberNumber, system: null, retired: false, canRetire: false });
  for (const r of o.rows) {
    if (identifierTarget(r.kind) === "household") continue;
    if (!(ID_KIND_ORDER as readonly string[]).includes(r.kind) || !o.canView(r.kind)) continue;
    const retired = isRetired(r.valid_to, o.today);
    out.push({ id: r.id, kind: r.kind, label: o.labelOf(r.kind), value: r.value, system: r.system, retired, canRetire: !r.valid_to && o.canManage(r.kind) });
  }
  return out;
}

export type IdGroup = { kind: string; label: string; items: DetailId[] };

/** Live chips grouped by kind, in the kinds' order; a kind with nothing live is not shown. */
export function groupIds(ids: readonly DetailId[]): IdGroup[] {
  const groups: IdGroup[] = [];
  for (const kind of ID_KIND_ORDER) {
    const items = ids.filter((i) => i.kind === kind && !i.retired);
    if (items.length > 0) groups.push({ kind, label: items[0].label, items });
  }
  return groups;
}

export const retiredIds = (ids: readonly DetailId[]) => ids.filter((i) => i.retired);

/** The kinds the "+ Add ID" popover offers: the ones this role may manage, for a person (not the household-only kinds), with their systems. */
export function addIdKinds(o: {
  canManage: (kind: string) => boolean;
  labelOf: (kind: string) => string;
  rules: Parameters<typeof systemOptions>[1];
  hints?: Partial<Record<string, string>>;
}): AddIdKind[] {
  return ID_KIND_ORDER.filter((k) => k !== "connect_member" && identifierTarget(k) !== "household" && o.canManage(k)).map((kind) => ({
    kind,
    label: o.labelOf(kind),
    systems: systemOptions(kind as Parameters<typeof systemOptions>[0], o.rules),
    ...(o.hints?.[kind] ? { hint: o.hints[kind] } : {}),
  }));
}

// ---------------------------------------------------------------------------
// The more menu
// ---------------------------------------------------------------------------
export type MenuKey = "details" | "move" | "merge" | "code" | "deceased" | "undo_deceased";
export type MenuItem = {
  key: MenuKey;
  label: string;
  /** link: goes to `href`; action: the menu opens a sheet; disabled: shown, switched off, with `note`. */
  kind: "link" | "action" | "disabled";
  href?: string;
  note?: string;
  hint?: string;
  danger?: boolean;
};

export type MenuHrefs = { details: string; move: string; merge: string };

/**
 * The rare things done to a person, under ⋯: open details (on the card only: it is already open in the slide-over), move to another
 * family, merge a duplicate, the printed sign-in code (not built yet, so it is shown switched off and says so) and mark as deceased
 * (or undo it). Without people.manage, or for a merged record, only "Open details" is left.
 */
export function personMenu(o: {
  surface: "card" | "panel";
  canEdit: boolean;
  isChild: boolean;
  deceased: boolean;
  hasHousehold: boolean;
  hrefs: MenuHrefs;
}): MenuItem[] {
  const items: MenuItem[] = [];
  if (o.surface === "card") items.push({ key: "details", label: "Open details", kind: "link", href: o.hrefs.details });
  if (!o.canEdit) return items;
  if (o.hasHousehold) items.push({ key: "move", label: "Move to another family…", kind: "link", href: o.hrefs.move, hint: "Pledges and payments stay with the family" });
  items.push({ key: "merge", label: "Merge with another person…", kind: "link", href: o.hrefs.merge, hint: "Compare two records and keep one" });
  if (!o.isChild) items.push({ key: "code", label: "Printed sign-in code", kind: "disabled", note: "Coming next" });
  items.push(
    o.deceased
      ? { key: "undo_deceased", label: "Undo “deceased”…", kind: "action", hint: "For a mistake, or the wrong person" }
      : { key: "deceased", label: "Mark as deceased…", kind: "action", danger: true },
  );
  return items;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------
/** The family page's address with this person's slide-over open (`?person=<id>`), other parts of the address kept. */
export function slideOverHref(path: string, sp: RawSearchParams, personId: string, mode?: string): string {
  return hrefWith(path, sp, { person: personId, mode: mode ?? null, hh: null, app: null });
}

/**
 * What the family page's address asks for: a person's slide-over (`?person=<id>`), or the classic drawers (the household's own old
 * links `?hh=…`, and the move flow `?person=<id>&mode=move`, which is still the classic drawer).
 */
export function slideOverRequest(sp: RawSearchParams): { kind: "slideover"; personId: string } | { kind: "classic" } {
  const person = param(sp, "person");
  return isUuid(person) && param(sp, "mode") !== "move" ? { kind: "slideover", personId: person } : { kind: "classic" };
}

/** The same page with the slide-over closed. */
export function closeHref(path: string, sp: RawSearchParams): string {
  return hrefWith(path, sp, { person: null, mode: null, hh: null, app: null });
}

/** `/people/[id]` in the New look: where does it go? One household: its family page with the slide-over open. Several: choose. None: the slide-over alone. */
export type HomeChoice = { kind: "none" } | { kind: "one"; householdId: string } | { kind: "many"; householdIds: string[] };

export function homeChoice(links: readonly { household_id: string; left_at?: string | null }[]): HomeChoice {
  const ids = [...new Set(links.filter((l) => !l.left_at).map((l) => l.household_id))];
  if (ids.length === 0) return { kind: "none" };
  if (ids.length === 1) return { kind: "one", householdId: ids[0] };
  return { kind: "many", householdIds: ids };
}

/** Where /people/[id] sends the New look: the family page, this person's slide-over open, the other parts of the address kept. */
export function familyHrefFor(householdId: string, personId: string, sp: RawSearchParams): string {
  return slideOverHref(`/households/${householdId}`, sp, personId);
}

// ---------------------------------------------------------------------------
// Add person
// ---------------------------------------------------------------------------
export const ADD_RELATIONSHIPS = RELATIONSHIP_OPTIONS.filter((o) => o.value !== "primary");

export type AddPersonDraft = { first: string; last: string; role: string; dob: string; phone: string; email: string };

export const EMPTY_ADD: AddPersonDraft = { first: "", last: "", role: "child", dob: "", phone: "", email: "" };

export type AddPersonInput = {
  household_id: string;
  first_name: string;
  last_name: string;
  role: HouseholdRole;
  date_of_birth?: string;
  phone_e164?: string;
  email?: string;
};

export type AddChecked = { ok: true; input: AddPersonInput; isChild: boolean } | { ok: false; error: string; field: keyof AddPersonDraft };

/** Is this person (typed role and birth date) a child here? The same rule that sorts the family page, so the form and the page agree. */
export function isChildDraft(d: Pick<AddPersonDraft, "role" | "dob">, ctx: Pick<FamilyCheck, "today" | "majority">): boolean {
  const dob = parseDateInput(d.dob);
  return !isAdultMember({ date_of_birth: dob.ok ? dob.value : null, role: d.role }, ctx.today, ctx.majority);
}

/**
 * What was typed in the "Add person" card, as the input of the add-person command, or the sentence for a mistake. The same checks the
 * command makes (so a mistake shows before anything is sent; the server checks again). A child has no mobile or email ("contact via
 * parents"): they are not sent for one, and the card does not offer them.
 */
export function checkAddPerson(d: AddPersonDraft, householdId: string, ctx: Pick<FamilyCheck, "today" | "majority">): AddChecked {
  const first = d.first.trim();
  const last = d.last.trim();
  if (!first) return { ok: false, error: "Enter a first name", field: "first" };
  if (!last) return { ok: false, error: "Enter a last name", field: "last" };
  if (!ADD_RELATIONSHIPS.some((o) => o.value === d.role)) return { ok: false, error: "Choose their relationship to the family", field: "role" };
  const dob = parseDateInput(d.dob);
  if (!dob.ok) return { ok: false, error: dob.error, field: "dob" };
  if (dob.value && dob.value > ctx.today) return { ok: false, error: "The date of birth is in the future", field: "dob" };
  const child = !isAdultMember({ date_of_birth: dob.value, role: d.role }, ctx.today, ctx.majority);
  const input: AddPersonInput = { household_id: householdId, first_name: first, last_name: last, role: d.role as HouseholdRole };
  if (dob.value) input.date_of_birth = dob.value;
  if (!child) {
    const phone = normalizePhone(d.phone);
    if (!phone.ok) return { ok: false, error: phone.error, field: "phone" };
    if (phone.value) input.phone_e164 = phone.value;
    const email = d.email.trim().toLowerCase();
    if (email && !isEmail(email)) return { ok: false, error: "That email address does not look right", field: "email" };
    if (email) input.email = email;
  }
  return { ok: true, input, isChild: child };
}

/** The last name the card starts with: the primary member's, as stored (never the last word of a display name: some names put the family name first). */
export function suggestedLastName(adults: readonly Pick<FamilyPerson, "isPrimary" | "values">[]): string {
  const primary = adults.find((a) => a.isPrimary) ?? adults[0];
  return primary?.values.last_name ?? "";
}

/** "Zara Hassan was added to the family (child)": said after the person was added. */
export function addedSentence(name: string, role: string): string {
  const rel = relationshipLabel(role);
  return `${name} was added to the family${rel && rel !== "—" ? ` (${rel.toLowerCase()})` : ""}`;
}
