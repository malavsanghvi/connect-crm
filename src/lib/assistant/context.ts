// Where the person is, as Niva needs to know it: a route PATTERN ("/events/[id]"), the kind of thing on screen and its id, so
// "this event" works. Never the query string, never form contents, and no id anywhere except entityId.

import { DEFAULT_LOCALE, moneyExample, type CommunityFormat } from "../community-format";
import { moduleNotOffered, type KindProfile } from "../kind";
import { mediaKindsPhrase, offlineMethodWord, pluginName, sample, schoolOrGeneric } from "../kind-samples";
import type { ModuleKey } from "../modules";
import type { PluginKey } from "../payments/plugins/catalog";
import { workspaceLabel, type WorkspaceKey } from "../workspaces";

export type RouteContext = { path: string; entityKind?: string; entityId?: string };

export type RouteParams = Record<string, string | string[] | undefined> | null | undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a pattern's last static segment before the id is called on screen ("/people/[id]" is a person). */
const KIND_BY_SEGMENT: Record<string, string> = {
  events: "event",
  households: "household",
  people: "person",
  campaigns: "campaign",
  surveys: "survey",
  threads: "message thread",
  photos: "photo",
  classes: "class",
  terms: "term",
  centers: "community",
  import: "import",
  feedback: "event survey",
  actions: "committee action",
  resolutions: "committee resolution",
  templates: "committee template",
};

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function isIdParam(name: string): boolean {
  return name === "id" || /Id$/.test(name);
}

function cleanPath(pathname: string): string[] {
  const noQuery = pathname.split("?")[0].split("#")[0];
  return noQuery.split("/").filter(Boolean);
}

/**
 * Turns the address into what Niva is told. `params` are the dynamic parts from Next (useParams). Every dynamic part becomes
 * "[name]" in the pattern; the value of a part called id / somethingId becomes entityId. A segment that looks like a UUID and was
 * not matched to a parameter is still replaced by "[id]" so a raw id never travels inside the path.
 */
export function routeContext(pathname: string, params?: RouteParams): RouteContext {
  const segments = cleanPath(pathname);
  const used = new Set<number>();
  const pattern = segments.slice();
  let entityId: string | undefined;
  let entityIndex = -1;

  // Parts are listed in path order. Work from the end so a value that is also a word earlier in the path (an id called "events")
  // claims its own place, and the deepest id wins as the thing on screen.
  for (const [name, raw] of Object.entries(params ?? {}).reverse()) {
    if (raw === undefined) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.length === 0) continue;
    // A catch-all part ([...slug]) covers several segments in a row.
    let start = -1;
    for (let i = segments.length - values.length; i >= 0 && start < 0; i -= 1) {
      if (values.every((v, k) => !used.has(i + k) && safeDecode(segments[i + k]) === safeDecode(v))) start = i;
    }
    if (start < 0) continue;
    for (let k = 0; k < values.length; k += 1) used.add(start + k);
    pattern.splice(start, values.length, ...Array.from({ length: values.length }, (_, k) => (k === 0 ? `[${Array.isArray(raw) ? `...${name}` : name}]` : "")));
    if (isIdParam(name) && !Array.isArray(raw) && entityId === undefined) {
      entityId = safeDecode(values[0]);
      entityIndex = start;
    }
  }

  // Defence in depth: a raw UUID that no parameter explained.
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] && UUID.test(safeDecode(pattern[i]))) {
      if (entityId === undefined) {
        entityId = safeDecode(pattern[i]);
        entityIndex = i;
      }
      pattern[i] = "[id]";
    }
  }

  const path = `/${pattern.filter((p) => p !== "").join("/")}`;
  const context: RouteContext = { path };
  if (entityId !== undefined) {
    context.entityId = entityId;
    // The kind comes from the static segment just before the id.
    const before = pattern
      .slice(0, entityIndex)
      .filter((p) => p !== "" && !p.startsWith("["))
      .pop();
    if (before) context.entityKind = KIND_BY_SEGMENT[before] ?? before.replace(/s$/, "");
  }
  return context;
}

/** routeContext that cannot throw: anything unexpected in the address or the params gives just the home path. */
export function safeRouteContext(pathname: string | null | undefined, params?: RouteParams): RouteContext {
  try {
    return routeContext(pathname ?? "/", params);
  } catch {
    return { path: "/" };
  }
}

// ---------------------------------------------------------------------------
// The area of the screen, for the "Ask Niva" suggestions
// ---------------------------------------------------------------------------
export type SuggestionArea = "people" | "giving" | "events" | "messages" | "content" | "store" | "accounting" | "settings" | "setup" | "reports" | "platform" | "learning" | "general";

const AREA_BY_FIRST_SEGMENT: Record<string, SuggestionArea> = {
  people: "people",
  households: "people",
  identifiers: "people",
  memberships: "people",
  giving: "giving",
  bolis: "giving",
  approvals: "giving",
  accounting: "accounting",
  events: "events",
  calendar: "events",
  comms: "messages",
  content: "content",
  store: "store",
  settings: "settings",
  setup: "setup",
  reports: "reports",
  platform: "platform",
  pathshala: "learning",
};

export function areaForPath(path: string): SuggestionArea {
  const first = cleanPath(path)[0];
  return (first && AREA_BY_FIRST_SEGMENT[first]) || "general";
}

/**
 * What the suggestions need to know about the community: its kind (words, modules, tradition), the modules switched off, how it
 * writes money, and the payment ways it has. Everything optional: a suggestion whose facts are not known is worded without them
 * (no amount, no named payment way) or left out, never filled with a guess.
 */
export type SuggestionContext = {
  kind?: KindProfile;
  modulesOff?: readonly string[];
  currency?: string | null;
  locale?: string | null;
  /** The payment plugin keys the community has switched on; null or missing when they could not be read. */
  paymentPlugins?: readonly string[] | null;
  /** The community's own address, for the Weaver team's sentences about one community. */
  communitySlug?: string | null;
};

/** The words a suggestion is built from, worked out once per request from the context. */
export type SuggestionWords = {
  school: string;
  pledges: string;
  festival: string;
  item: string;
  level: string;
  media: string;
  /** An example amount in the community's currency ("$250"), or null when the currency is not known. */
  amount: (minor: number) => string | null;
  /** "a $250 check", "a $250 payment", "a check" or "a payment", from what is known. */
  payment: (minor: number) => string;
  /** The plain name of a payment plugin ("Zelle"). */
  plugin: (key: string) => string;
  slug: string | null;
};

export type Suggestion = {
  /** What the person would say. A function is given the community's words. */
  text: string | ((w: SuggestionWords) => string);
  /** Shown only when the person may use this command (so Niva never offers what the role cannot do). */
  needs?: string;
  /** Shown only on a screen about this kind of thing ("this event"). */
  onlyFor?: string;
  /** Shown only when no particular thing is on screen. */
  onlyWithout?: boolean;
  /** Shown only on a screen under this path ("/settings/roles"). */
  onlyOn?: string;
  /** Shown only on exactly this screen ("/pathshala"), not on the screens under it. */
  onlyAt?: string;
  /** Shown only while the community has this module (on, and offered by its kind). */
  module?: ModuleKey;
  /** Shown only while the community has this payment plugin switched on. */
  plugin?: PluginKey;
  /** Shown only when the community's slug is known. */
  needsSlug?: boolean;
};

const SUGGESTIONS: Record<SuggestionArea, Suggestion[]> = {
  people: [
    // On a household or a person: about that one (a sentence never names a child).
    { text: "Show everything we have on this household, including its IDs", needs: "people.household_summary", onlyFor: "household" },
    { text: "Add a spouse to this household", needs: "people.add_person", onlyFor: "household" },
    { text: "Change this person's mobile number", needs: "people.update_person", onlyFor: "person" },
    // On the list: look things up and see what is waiting.
    { text: "Find the household with member number 1042", needs: "people.search" },
    { text: "Which applications and family requests are waiting?", needs: "people.pending_reviews" },
    { text: "Find the household with QuickBooks customer 2217", needs: "people.find_household", module: "accounting" },
    { text: "Show me the suggested duplicates", needs: "people.suggest_duplicates" },
    { text: "Find the household whose phone number ends in 4821", needs: "people.search" },
    { text: "What is waiting for me?", needs: "tasks.mine" },
  ],
  giving: [
    { text: (w) => `Who is behind on ${w.pledges}?`, needs: "giving.pledges_behind" },
    { text: (w) => `Record ${w.payment(25_000)} from member number 1042`, needs: "giving.draft_payment" },
    { text: (w) => `Which ${w.plugin("zelle")} reports are waiting for the bank?`, needs: "giving.zelle_waiting", plugin: "zelle" },
    { text: "Which bank lines are still unmatched?", needs: "giving.bank_lines_unmatched" },
    { text: "What is waiting for a second approver?", needs: "giving.waiting_for_second_approver" },
    { text: "Show the giving of member number 1042", needs: "giving.household_summary" },
    { text: "What is blocking month-end close?", needs: "accounting.month_close_blockers" },
  ],
  accounting: [
    { text: "What is blocking month-end close?", needs: "accounting.month_close_blockers" },
    { text: (w) => `Who is behind on ${w.pledges}?`, needs: "giving.pledges_behind" },
    { text: "What is waiting for me?", needs: "tasks.mine" },
  ],
  // Events (B90 phase 4): on an event page the first three the role may use are shown; on the list, the last four.
  events: [
    { text: "What is blocking this event from going live?", needs: "events.readiness", onlyFor: "event" },
    { text: "How is this event doing: RSVPs, lunch and volunteers?", needs: "events.summary", onlyFor: "event" },
    { text: "How many people would a reminder for this event reach, and when would it go out?", needs: "events.audience_preview", onlyFor: "event" },
    { text: "Draft a reminder for this event in each language we use", needs: "messages.draft_reminder", onlyFor: "event" },
    { text: "Move this event to the second Saturday of November", needs: "events.set_field", onlyFor: "event" },
    { text: "Change the venue of this event to the main hall", needs: "events.set_field", onlyFor: "event" },
    { text: "What events are coming up?", needs: "events.upcoming" },
    { text: (w) => `Copy last year's ${w.festival} to November 8 as a draft`, needs: "events.clone_draft", onlyWithout: true },
    { text: "Draft a reminder for the next event", needs: "messages.draft_reminder", onlyWithout: true },
  ],
  // Settings (B90 phase 4): the roles helper, and whether the connected services work. On a screen of its own the first three are about it.
  settings: [
    { text: "Who can see payments?", needs: "settings.who_can_access", onlyOn: "/settings/roles" },
    { text: "Who holds the treasurer role?", needs: "settings.role_holders", onlyOn: "/settings/roles" },
    { text: "Prepare the treasurer role for a member for a year", needs: "settings.draft_role_grant", onlyOn: "/settings/roles" },
    { text: "Are all our connected services working?", needs: "settings.integrations_health", onlyOn: "/settings/integrations" },
    { text: "Why might a text not go out?", needs: "settings.integrations_health", onlyOn: "/settings/integrations" },
    { text: "Which modules are switched on?", needs: "settings.modules_state", onlyOn: "/settings/modules" },
    { text: "What is left before we can go live?", needs: "settings.setup_status" },
    { text: "Are all our connected services working?", needs: "settings.integrations_health" },
    { text: "Who can see payments?", needs: "settings.who_can_access" },
  ],
  // Setup: the setup concierge.
  setup: [
    { text: "What is left before we can go live?", needs: "settings.setup_status" },
    { text: "Which go-live checks do not pass yet, and where do I fix them?", needs: "settings.setup_status" },
    { text: "Are all our connected services working?", needs: "settings.integrations_health" },
    { text: "Which modules are switched on?", needs: "settings.modules_state" },
  ],
  // Messages (B90 phase 4): on a conversation the first two are about it; on a message to families, about that message; on the list, the rest.
  messages: [
    { text: "Draft a reply to this conversation from our approved answers", needs: "messages.draft_reply", onlyFor: "message thread" },
    { text: "Why has this message not gone out?", needs: "messages.why_not_delivered", onlyFor: "campaign" },
    { text: "What is waiting in the inbox?", needs: "messages.inbox_triage", onlyWithout: true },
    { text: "Which messages to families are waiting for approval?", needs: "messages.campaigns", onlyWithout: true },
    { text: "How many people would a message to all members reach by email, text and WhatsApp?", needs: "messages.audience_preview", onlyWithout: true },
    { text: "Why did a family not get our text?", needs: "messages.why_not_delivered", onlyWithout: true },
    { text: "Draft a reminder for the next event in each language we use", needs: "messages.draft_reminder", onlyWithout: true },
    { text: "What is waiting for me?", needs: "tasks.mine" },
  ],
  // Content (B90 phase 4): the approval queue, Niva's sources and the media library. A tab's own examples come first.
  content: [
    { text: "What is waiting in the approval queue, and for how long?", needs: "content.approval_queue", onlyOn: "/content/queue" },
    { text: "Which of Niva's sources are out of date?", needs: "content.niva_sources", onlyOn: "/content/niva" },
    { text: (w) => `Draft a Niva source about parking at the ${w.festival}`, needs: "content.draft_item", onlyOn: "/content/niva" },
    { text: (w) => `How many ${w.media} are in the media library?`, needs: "content.media_library", onlyOn: "/content/media" },
    { text: "What is waiting in the approval queue?", needs: "content.approval_queue" },
    { text: "Are Niva's sources up to date?", needs: "content.niva_sources" },
    { text: (w) => `Draft an announcement about the ${w.festival} for approval`, needs: "content.draft_item" },
    { text: "What is waiting for me?", needs: "tasks.mine" },
  ],
  // Store (B90 phase 4): orders to hand over, stock, sales and a price change prepared (never made) by Niva.
  store: [
    { text: "Which orders are ready for pickup, and which are not ready yet?", needs: "store.orders_waiting", onlyOn: "/store/orders" },
    { text: "Mark the next order for pickup ready", needs: "store.set_order_status", onlyOn: "/store/orders" },
    { text: "What is running low?", needs: "store.low_stock" },
    { text: "How much did the store sell this month?", needs: "store.sales_summary" },
    { text: "Which orders are waiting for pickup?", needs: "store.orders_waiting" },
    {
      text: (w) => `Show what changing the price of the ${w.item} ${w.amount(800) && w.amount(850) ? `from ${w.amount(800)} to ${w.amount(850)} ` : ""}would look like`,
      needs: "store.draft_product",
    },
    { text: (w) => `Add the 24 ${w.item}s we just received to the stock`, needs: "store.adjust_stock" },
    { text: "What is waiting for me?", needs: "tasks.mine" },
  ],
  // Reports (B90 phase 4): number questions, answered by the database's own sums.
  reports: [
    { text: "How are we doing this year compared with last year?", needs: "reports.overview" },
    { text: "How much did we receive this year, month by month?", needs: "reports.giving_totals" },
    { text: "How is each campaign doing?", needs: "reports.campaign_progress" },
    { text: "Compare this month with last month", needs: "reports.compare_months" },
    { text: "How many people joined as members this month?", needs: "reports.membership_counts" },
    { text: "How many people came to events this year?", needs: "reports.event_attendance" },
    { text: "How much did the store sell this month?", needs: "reports.store_sales" },
  ],
  // Platform (the Weaver team only: these commands are never offered to anyone else, so neither are these sentences).
  platform: [
    { text: "Who is waiting for us, and what is missing?", needs: "platform.waiting" },
    { text: "Which sandboxes are waiting for a go-live review?", needs: "platform.waiting" },
    { text: (w) => `Summarise the community with address ${w.slug}`, needs: "platform.community_summary", needsSlug: true },
    { text: "What would changing a community's kind of organization do?", needs: "platform.preview_kind_change" },
  ],
  // Learning (B90 phase 4, decision D2): terms, levels, fees, classes and teachers (adults). A sentence here never speaks of a child or a
  // learner, and only the term, levels, classes and fees screens have one: the screens about learners (enrollments, a class's roster,
  // homework, sign-offs, attendance) fall back to the general ones.
  learning: [
    { text: "Which classes have no teacher yet, and who could teach them?", needs: "learning.classes_needing_teachers", onlyAt: "/pathshala", module: "pathshala" },
    { text: (w) => `How many ${w.school} tasks are waiting?`, needs: "learning.waiting_counts", onlyAt: "/pathshala", module: "pathshala" },
    { text: "How is this term set up: its levels, fees and rules?", needs: "learning.term_setup", onlyFor: "term", module: "pathshala" },
    { text: "Is anything missing before registration can open for this term?", needs: "learning.registration_checklist", onlyFor: "term", module: "pathshala" },
    { text: (w) => `What have we billed and collected for ${w.school} so far?`, needs: "learning.fee_report", onlyOn: "/pathshala/terms", module: "pathshala" },
    { text: "What is missing before registration can open for each term?", needs: "learning.registration_checklist", onlyAt: "/pathshala/terms", module: "pathshala" },
    { text: "Show how a term is set up: levels, fees and rules", needs: "learning.term_setup", onlyAt: "/pathshala/terms", module: "pathshala" },
    { text: "Which levels have no fee set for the term?", needs: "learning.term_setup", onlyOn: "/pathshala/levels", module: "pathshala" },
    {
      text: (w) => `What would a ${w.amount(13_500) ? `fee of ${w.amount(13_500)}` : "new fee"} for ${w.level} change?`,
      needs: "learning.draft_term_change",
      onlyOn: "/pathshala/levels",
      module: "pathshala",
    },
  ],
  general: [
    { text: "What is waiting for me?", needs: "tasks.mine" },
    { text: "What events are coming up?", needs: "events.upcoming" },
    { text: (w) => `Who is behind on ${w.pledges}?`, needs: "giving.pledges_behind" },
  ],
};

/** Every sentence the community could be offered, whatever the screen and the person's role (a test reads them all). */
export function allSuggestionTexts(context: SuggestionContext = {}): string[] {
  const words = suggestionWords(context);
  const plugins = context.paymentPlugins;
  return Object.values(SUGGESTIONS)
    .flat()
    .filter((s) => (s.module ? hasModule(context, s.module) : true))
    .filter((s) => (s.plugin ? Array.isArray(plugins) && plugins.includes(s.plugin) : true))
    .filter((s) => (s.needsSlug ? words.slug !== null : true))
    .map((s) => (typeof s.text === "function" ? s.text(words) : s.text));
}

/** A kind that says nothing about itself: no tradition, no faith, no particular words. What a suggestion uses when it is not told the kind. */
const NEUTRAL_KIND: KindProfile = { key: "neutral", label: "Community organization", faithBased: false, usesTradition: false, terms: {}, modules: {} };

/** The words the suggestions are built from, for a community. Exported for the tests. */
export function suggestionWords(context: SuggestionContext = {}): SuggestionWords {
  const kind = context.kind ?? NEUTRAL_KIND;
  const currency = context.currency ? context.currency.trim().toUpperCase() : "";
  const locale = context.locale || DEFAULT_LOCALE;
  const fmt: CommunityFormat | null = currency ? { currency, locale } : null;
  const amount = (minor: number) => (fmt ? moneyExample(minor, fmt) : null);
  const method = offlineMethodWord(context.paymentPlugins, locale);
  return {
    school: schoolOrGeneric(kind),
    pledges: sample(kind, "pledges"),
    festival: sample(kind, "festival_event"),
    item: sample(kind, "store_item"),
    level: sample(kind, "level_example"),
    media: mediaKindsPhrase(kind),
    amount,
    payment: (minor) => `a ${[amount(minor), method ?? "payment"].filter(Boolean).join(" ")}`,
    plugin: pluginName,
    slug: context.communitySlug?.trim() || null,
  };
}

function hasModule(context: SuggestionContext, key: ModuleKey): boolean {
  return !(context.modulesOff ?? []).includes(key) && !(context.kind && moduleNotOffered(context.kind, key));
}

/** Up to three plain example sentences for the screen the person is on, limited to what their role may use and what their community has. */
export function suggestionsFor(path: string, entityKind: string | undefined, availableKeys: ReadonlySet<string>, context: SuggestionContext = {}): string[] {
  const area = areaForPath(path);
  const words = suggestionWords(context);
  const plugins = context.paymentPlugins;
  const pick = (list: Suggestion[]) =>
    list
      .filter((s) => (s.needs ? availableKeys.has(s.needs) : true))
      .filter((s) => (s.onlyFor ? s.onlyFor === entityKind : true))
      .filter((s) => (s.onlyWithout ? entityKind === undefined : true))
      .filter((s) => (s.onlyOn ? path === s.onlyOn || path.startsWith(`${s.onlyOn}/`) : true))
      .filter((s) => (s.onlyAt ? path === s.onlyAt : true))
      .filter((s) => (s.module ? hasModule(context, s.module) : true))
      // A payment plugin whose state is unknown is not named: the sentence waits until the community's list is read.
      .filter((s) => (s.plugin ? Array.isArray(plugins) && plugins.includes(s.plugin) : true))
      .filter((s) => (s.needsSlug ? words.slug !== null : true))
      .map((s) => (typeof s.text === "function" ? s.text(words) : s.text));
  const own = pick(SUGGESTIONS[area]);
  // A screen whose role can use none of its own examples still gets the general ones.
  const list = own.length > 0 ? own : pick(SUGGESTIONS.general);
  return list.slice(0, 3);
}

const AREA_NAME: Record<SuggestionArea, string> = {
  people: "People",
  giving: "Giving",
  accounting: "Accounting",
  events: "Events",
  messages: "Messages",
  content: "Content",
  store: "Store",
  settings: "Settings",
  setup: "Setup",
  reports: "Reports",
  platform: "Platform",
  learning: "Learning",
  general: "Home",
};

/** The areas that carry the kind's own word in the rail (Giving, Learning, Store): the context line says the same word the rail does. */
const WORKSPACE_OF_AREA: Partial<Record<SuggestionArea, WorkspaceKey>> = { giving: "giving", learning: "learning", store: "store" };

/** "Looking at this event" / "Looking at Events": a line so the person can see what Niva knows about the screen. */
export function contextLine(context: RouteContext, kind?: Pick<KindProfile, "terms" | "modules">): string {
  if (context.entityKind) return `Looking at this ${context.entityKind}`;
  const area = areaForPath(context.path);
  if (area === "general") return context.path === "/" ? "Looking at Home" : "Looking at this page";
  const workspace = WORKSPACE_OF_AREA[area];
  return `Looking at ${workspace && kind ? workspaceLabel(workspace, kind) : AREA_NAME[area]}`;
}
