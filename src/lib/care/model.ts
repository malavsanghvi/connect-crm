// DonorDelight slice 2 (docs/DONORDELIGHT.md sections 3 and 5.1-5.3; connect-crm 0760-0763): the words and shapes the Care card and
// the DonorDelight area draw from. Pure: no React and no server-only imports, so the card, the list, the actions and the tests
// read the same thing.
//
// Nothing here decides who may see what: app.care_household_can and app.care_can in the database do (no platform-admin
// branch), and the read functions return only what the caller may see. These helpers only read what came back, safely, and
// say it in plain English. Nothing here is about anyone under 18: the database never returns a child.

export const NO_ACCESS = "You don't have access to this area";

// ── The care profile's choices ──────────────────────────────────────────────
export const THANKS = ["in_person", "call", "card", "message", "none"] as const;
export type Thanks = (typeof THANKS)[number];
export const THANKS_LABEL: Record<Thanks, string> = {
  in_person: "In person",
  call: "A call",
  card: "A card",
  message: "A message",
  none: "No thanks, please",
};

export const RECOGNITION = ["public", "private_only", "anonymous"] as const;
export type Recognition = (typeof RECOGNITION)[number];
export const RECOGNITION_LABEL: Record<Recognition, string> = {
  public: "Public",
  private_only: "Private only",
  anonymous: "Anonymous",
};
export const RECOGNITION_HINT: Record<Recognition, string> = {
  public: "They are happy to be named.",
  private_only: "Thank them personally; never name them in public.",
  anonymous: "They give in secret: private thanks only, never named.",
};

export const PROFILE_CHANNELS = ["in_person", "phone", "text", "email", "whatsapp", "post"] as const;
export type ProfileChannel = (typeof PROFILE_CHANNELS)[number];

// ── The touch log's words ───────────────────────────────────────────────────
export const TOUCH_KINDS = ["thank_you", "check_in", "greeting", "welcome", "update", "invitation", "care_moment", "other"] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];
export const TOUCH_KIND_LABEL: Record<TouchKind, string> = {
  thank_you: "Thank-you",
  check_in: "Check-in",
  greeting: "Greeting on their day",
  welcome: "Welcome",
  update: "Update on what their gift did",
  invitation: "Invitation",
  care_moment: "Care moment",
  other: "Something else",
};

export const TOUCH_CHANNELS = ["in_person", "phone", "text", "email", "whatsapp", "post", "video", "other"] as const;
export type TouchChannel = (typeof TOUCH_CHANNELS)[number];
export const CHANNEL_LABEL: Record<string, string> = {
  in_person: "In person",
  phone: "Phone",
  text: "Text",
  sms: "Text",
  email: "Email",
  whatsapp: "WhatsApp",
  post: "Post",
  video: "Video call",
  other: "Another way",
  push: "App notification",
};

export const TOUCH_OUTCOMES = ["done", "no_answer", "left_message", "declined", "later"] as const;
export type TouchOutcome = (typeof TOUCH_OUTCOMES)[number];
export const OUTCOME_LABEL: Record<TouchOutcome, string> = {
  done: "Done",
  no_answer: "No answer",
  left_message: "Left a message",
  declined: "Declined",
  later: "Try again later",
};

export type TouchInput = {
  kind: TouchKind;
  channel: TouchChannel;
  outcome: TouchOutcome;
  is_ask: boolean;
  note?: string | null;
  person_id?: string | null;
  touched_at?: string | null;
};

/** The one-tap touches: recorded at once, with no form. */
export const TOUCH_PRESETS: readonly { key: string; label: string; touch: TouchInput }[] = [
  { key: "called_no_answer", label: "Called, no answer", touch: { kind: "check_in", channel: "phone", outcome: "no_answer", is_ask: false } },
  { key: "called", label: "Called and talked", touch: { kind: "check_in", channel: "phone", outcome: "done", is_ask: false } },
  { key: "card_sent", label: "Card sent", touch: { kind: "thank_you", channel: "post", outcome: "done", is_ask: false } },
  { key: "visited", label: "Visited", touch: { kind: "check_in", channel: "in_person", outcome: "done", is_ask: false } },
];

/** What a touch Weaver already knows came from. */
export const SOURCE_LABEL: Record<string, string> = {
  manual: "Recorded",
  message: "Message",
  receipt: "Receipt",
  statement: "Statement",
  check_in: "Event check-in",
  volunteer: "Volunteer shift",
};

// ── Shapes (as the database returns them) ───────────────────────────────────
export type CareAdult = { personId: string; name: string; isPrimary: boolean };
export type CareHousehold = {
  id: string;
  name: string;
  number: string | null;
  orgHouseholdId: string | null;
  city: string | null;
  zone: string | null;
  primaryMember: string | null;
  adults: CareAdult[];
  merged: boolean;
};
export type CareOwnerPerson = { userId: string; name: string; holds: boolean };
export type CareOwners = { owner: CareOwnerPerson | null; backup: CareOwnerPerson | null; needsOwner: boolean; assignedAt: string | null; assignedBy: string | null };
export type CareProfile = {
  thanks: Thanks | null;
  recognition: Recognition | null;
  channel: ProfileChannel | null;
  language: string | null;
  contactPersonId: string | null;
  contactName: string | null;
  doNotAsk: boolean;
  restUntil: string | null;
  resting: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};
export type CarePersonFields = {
  personId: string;
  name: string;
  isPrimary: boolean;
  bestCallTime: string | null;
  interests: string[];
  expertise: string[];
  language: string | null;
  anniversary: string | null;
  dietary: string[];
  dietaryOther: string | null;
  agreed: { email: boolean | null; sms: boolean | null; whatsapp: boolean | null; post: boolean | null };
};
export type CareSpecialDay = { kind: string; label: string | null; date: string | null; tithi: string | null; personName: string | null };
export type CareNote = { id: string; body: string; personName: string | null; by: string | null; mine: boolean; createdAt: string; editedAt: string | null };
export type CareLastTouch = { at: string; kind: string; channel: string; outcome: string; isAsk: boolean; by: string | null };
export type CareAccess = { level: "manage" | "view" | "own"; manage: boolean; amounts: boolean; people: boolean };
export type CareCard = {
  household: CareHousehold;
  label: string;
  access: CareAccess;
  owners: CareOwners;
  profile: CareProfile | null;
  languages: string[];
  today: string | null;
  people: CarePersonFields[] | null;
  specialDays: CareSpecialDay[] | null;
  notes: CareNote[];
  notesTotal: number;
  lastTouch: CareLastTouch | null;
  touches12m: number;
  asks12m: number;
};
export type CareTouchRow = {
  source: string;
  id: string;
  /** source:id, the tie-breaker of the log's cursor. */
  key: string;
  at: string;
  kind: string | null;
  channel: string | null;
  outcome: string | null;
  isAsk: boolean;
  note: string | null;
  by: string | null;
  personName: string | null;
  label: string | null;
  amountCents: number | null;
  opened: boolean | null;
  canRemove: boolean;
};
export type CareTouchPage = { rows: CareTouchRow[]; more: boolean; amounts: boolean };
export type CareListRow = {
  household: CareHousehold;
  owner: string | null;
  ownerHolds: boolean;
  backup: string | null;
  mine: boolean;
  needsOwner: boolean;
  resting: boolean;
  restUntil: string | null;
  lastTouchAt: string | null;
};
export const LIST_FILTERS = ["all", "mine", "needs_owner", "resting"] as const;
export type CareListFilter = (typeof LIST_FILTERS)[number];
export type CareList = {
  filter: CareListFilter;
  total: number;
  limit: number;
  offset: number;
  rows: CareListRow[];
  counts: { all: number | null; mine: number; needsOwner: number | null; resting: number };
  label: string;
  can: { all: boolean; manage: boolean };
};
export type CareHolder = { userId: string; name: string; level: "manage" | "view" | "own" };

// ── Safe readers ────────────────────────────────────────────────────────────
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const bool = (v: unknown): boolean => v === true;
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string" && x !== "");
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);

export function parseHousehold(v: unknown): CareHousehold {
  const o = obj(v);
  return {
    id: str(o.id) ?? "",
    name: str(o.name) ?? "Household",
    number: str(o.number),
    orgHouseholdId: str(o.org_household_id),
    city: str(o.city),
    zone: str(o.zone),
    primaryMember: str(o.primary_member),
    adults: arr(o.adults).map((a) => {
      const x = obj(a);
      return { personId: str(x.person_id) ?? "", name: str(x.name) ?? "", isPrimary: bool(x.is_primary) };
    }),
    merged: bool(o.merged),
  };
}

function parseOwnerPerson(v: unknown): CareOwnerPerson | null {
  const o = obj(v);
  const userId = str(o.user_id);
  return userId ? { userId, name: str(o.name) ?? "Someone", holds: bool(o.holds) } : null;
}

export function parseOwners(v: unknown): CareOwners {
  const o = obj(v);
  return {
    owner: parseOwnerPerson(o.owner),
    backup: parseOwnerPerson(o.backup),
    needsOwner: o.needs_owner === undefined ? true : bool(o.needs_owner),
    assignedAt: str(o.assigned_at),
    assignedBy: str(o.assigned_by),
  };
}

export function parseProfile(v: unknown): CareProfile | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = obj(v);
  return {
    thanks: oneOf(THANKS, o.thanks),
    recognition: oneOf(RECOGNITION, o.recognition),
    channel: oneOf(PROFILE_CHANNELS, o.channel),
    language: str(o.language),
    contactPersonId: str(o.contact_person_id),
    contactName: str(o.contact_name),
    doNotAsk: bool(o.do_not_ask),
    restUntil: str(o.rest_until),
    resting: bool(o.resting),
    updatedAt: str(o.updated_at),
    updatedBy: str(o.updated_by),
  };
}

export function parseCard(v: unknown): CareCard {
  const o = obj(v);
  const access = obj(o.access);
  const level = oneOf(["manage", "view", "own"] as const, access.level) ?? "own";
  const lt = obj(o.last_touch);
  return {
    household: parseHousehold(o.household),
    label: str(o.label) ?? "DonorDelight",
    access: { level, manage: bool(access.manage), amounts: bool(access.amounts), people: bool(access.people) },
    owners: parseOwners(o.owners),
    profile: parseProfile(o.profile),
    languages: strs(o.languages).length > 0 ? strs(o.languages) : ["en"],
    today: str(o.today),
    people: Array.isArray(o.people)
      ? o.people.map((p) => {
          const x = obj(p);
          const agreed = obj(x.agreed);
          return {
            personId: str(x.person_id) ?? "",
            name: str(x.name) ?? "",
            isPrimary: bool(x.is_primary),
            bestCallTime: str(x.best_call_time),
            interests: strs(x.interests),
            expertise: strs(x.expertise),
            language: str(x.language),
            anniversary: str(x.anniversary),
            dietary: strs(x.dietary),
            dietaryOther: str(x.dietary_other),
            agreed: { email: boolOrNull(agreed.email), sms: boolOrNull(agreed.sms), whatsapp: boolOrNull(agreed.whatsapp), post: boolOrNull(agreed.post) },
          };
        })
      : null,
    specialDays: Array.isArray(o.special_days)
      ? o.special_days.map((d) => {
          const x = obj(d);
          return { kind: str(x.kind) ?? "other", label: str(x.label), date: str(x.date), tithi: str(x.tithi), personName: str(x.person_name) };
        })
      : null,
    notes: arr(o.notes).map((n) => {
      const x = obj(n);
      return {
        id: str(x.id) ?? "",
        body: typeof x.body === "string" ? x.body : "",
        personName: str(x.person_name),
        by: str(x.by),
        mine: bool(x.mine),
        createdAt: str(x.created_at) ?? "",
        editedAt: str(x.edited_at),
      };
    }),
    notesTotal: num(o.notes_total),
    lastTouch: str(lt.at)
      ? { at: str(lt.at)!, kind: str(lt.kind) ?? "other", channel: str(lt.channel) ?? "other", outcome: str(lt.outcome) ?? "done", isAsk: bool(lt.is_ask), by: str(lt.by) }
      : null,
    touches12m: num(o.touches_12m),
    asks12m: num(o.asks_12m),
  };
}

export function parseTouchPage(v: unknown): CareTouchPage {
  const o = obj(v);
  return {
    rows: arr(o.rows).map((r) => {
      const x = obj(r);
      return {
        source: str(x.source) ?? "manual",
        id: str(x.id) ?? "",
        key: str(x.key) ?? `${str(x.source) ?? "manual"}:${str(x.id) ?? ""}`,
        at: str(x.at) ?? "",
        kind: str(x.kind),
        channel: str(x.channel),
        outcome: str(x.outcome),
        isAsk: bool(x.is_ask),
        note: str(x.note),
        by: str(x.by),
        personName: str(x.person_name),
        label: str(x.label),
        amountCents: typeof x.amount_cents === "number" ? x.amount_cents : null,
        opened: boolOrNull(x.opened),
        canRemove: bool(x.can_remove),
      };
    }),
    more: bool(o.more),
    amounts: bool(o.amounts),
  };
}

export function parseList(v: unknown): CareList {
  const o = obj(v);
  const counts = obj(o.counts);
  const can = obj(o.can);
  const nullableCount = (x: unknown): number | null => (typeof x === "number" ? x : null);
  return {
    filter: oneOf(LIST_FILTERS, o.filter) ?? "mine",
    total: num(o.total),
    limit: num(o.limit) || 50,
    offset: num(o.offset),
    rows: arr(o.rows).map((r) => {
      const x = obj(r);
      return {
        household: parseHousehold(x.household),
        owner: str(x.owner),
        ownerHolds: bool(x.owner_holds),
        backup: str(x.backup),
        mine: bool(x.mine),
        needsOwner: bool(x.needs_owner),
        resting: bool(x.resting),
        restUntil: str(x.rest_until),
        lastTouchAt: str(x.last_touch_at),
      };
    }),
    counts: { all: nullableCount(counts.all), mine: num(counts.mine), needsOwner: nullableCount(counts.needs_owner), resting: num(counts.resting) },
    label: str(o.label) ?? "DonorDelight",
    can: { all: bool(can.all), manage: bool(can.manage) },
  };
}

export function parseHolders(v: unknown): CareHolder[] {
  return arr(v).flatMap((r) => {
    const x = obj(r);
    const userId = str(x.user_id);
    const level = oneOf(["manage", "view", "own"] as const, x.level);
    return userId && level ? [{ userId, name: str(x.name) ?? "Someone", level }] : [];
  });
}

// ── Sentences ───────────────────────────────────────────────────────────────

/** Is this database error a refusal because of permissions (not a failure)? Then the screen says NO_ACCESS. */
export function isNoAccess(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string | null; message?: string | null };
  return e.code === "42501" || /You don't have access to this area/i.test(e.message ?? "");
}

/** "DonorDelight is not on for this community." from the database, when that is why. */
export function offSentence(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const m = (error as { message?: string | null }).message ?? "";
  return /is not on for this community/i.test(m) ? m.replace(/\.$/, "") + "." : null;
}

/** A language code as its name in English ("es" → "Spanish"); the code itself when the runtime does not know it. */
export function languageName(code: string | null | undefined): string {
  if (!code) return "";
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

/** "Owner: Sam K. · Backup: Lee P." or "Needs an owner" (with who it was, when the owner lost the role). */
export function ownerLine(o: CareOwners): string {
  if (!o.owner) return "Needs an owner";
  if (!o.owner.holds) return `Needs an owner (${o.owner.name} no longer has a care role)`;
  return o.backup ? `Owner: ${o.owner.name} · Backup: ${o.backup.name}` : `Owner: ${o.owner.name}`;
}

/** "Do not ask until 12 November 2026", "Do not ask", or null. */
export function restLine(p: Pick<CareProfile, "doNotAsk" | "restUntil" | "resting"> | null): string | null {
  if (!p || !p.doNotAsk || !p.resting) return null;
  return p.restUntil ? `Do not ask until ${formatDay(p.restUntil)}` : "Do not ask";
}

/** "12 November 2026" from "2026-11-12" (the calendar day as written, no time zone shift). */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? ""} ${m[1]}`.trim();
}

/** "12 November" (a recurring day: birthdays and anniversaries never show a year here). */
export function formatMonthDay(iso: string | null | undefined): string {
  const full = formatDay(iso);
  return full.replace(/ \d{4}$/, "");
}

/** One line for a touch: "Check-in by phone · No answer · Ask" / "Event check-in: Harvest supper". */
export function touchLine(t: Pick<CareTouchRow, "source" | "kind" | "channel" | "outcome" | "isAsk" | "label" | "opened">): string {
  if (t.source === "manual") {
    const kind = TOUCH_KIND_LABEL[t.kind as TouchKind] ?? "Touch";
    const how = t.channel ? (CHANNEL_LABEL[t.channel] ?? t.channel).toLowerCase() : "";
    const parts = [how ? `${kind} · ${how}` : kind];
    if (t.outcome && t.outcome !== "done") parts.push(OUTCOME_LABEL[t.outcome as TouchOutcome] ?? t.outcome);
    parts.push(t.isAsk ? "Ask" : "No ask");
    return parts.join(" · ");
  }
  if (t.source === "message") {
    const how = t.channel ? (CHANNEL_LABEL[t.channel] ?? t.channel) : "Message";
    return `${how}${t.label ? `: ${t.label}` : ""}${t.opened ? " · Opened" : ""}`;
  }
  const what = SOURCE_LABEL[t.source] ?? "Touch";
  if (t.source === "receipt" || t.source === "statement") return t.label ?? what;
  return t.label ? `${what}: ${t.label}` : what;
}

/** A household as the community knows it, never by name alone: "Household number · city · primary member". */
export function householdLine(h: CareHousehold): string {
  return [h.number, h.orgHouseholdId, h.city, h.zone, h.primaryMember].filter((x): x is string => Boolean(x)).join(" · ");
}

/** Who the care readers are, for the "who can see this" line. */
export function accessLine(label: string, access: CareAccess): string {
  const amounts = access.amounts ? "" : " Amounts stay hidden: your role does not include giving.";
  return `Only people your organization gives ${label} access can see this. Weaver staff cannot.${amounts}`;
}
