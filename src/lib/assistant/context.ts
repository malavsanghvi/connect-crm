// Where the person is, as Niva needs to know it: a route PATTERN ("/events/[id]"), the kind of thing on screen and its id, so
// "this event" works. Never the query string, never form contents, and no id anywhere except entityId.

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
export type SuggestionArea = "people" | "giving" | "events" | "messages" | "accounting" | "general";

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
};

export function areaForPath(path: string): SuggestionArea {
  const first = cleanPath(path)[0];
  return (first && AREA_BY_FIRST_SEGMENT[first]) || "general";
}

export type Suggestion = {
  /** What the person would say. */
  text: string;
  /** Shown only when the person may use this command (so Niva never offers what the role cannot do). */
  needs?: string;
  /** Shown only on a screen about this kind of thing ("this event"). */
  onlyFor?: string;
  /** Shown only when no particular thing is on screen. */
  onlyWithout?: boolean;
};

const SUGGESTIONS: Record<SuggestionArea, Suggestion[]> = {
  people: [
    { text: "Find the household with member number 1042", needs: "people.search" },
    { text: "Find the family whose phone number ends in 4821", needs: "people.search" },
    { text: "What is waiting for me?", needs: "tasks.mine" },
  ],
  giving: [
    { text: "Who is behind on pledges?", needs: "giving.pledges_behind" },
    { text: "What is blocking month-end close?", needs: "accounting.month_close_blockers" },
    { text: "Record a $50 gift from member number 1042", needs: "giving.record_payment" },
  ],
  accounting: [
    { text: "What is blocking month-end close?", needs: "accounting.month_close_blockers" },
    { text: "Who is behind on pledges?", needs: "giving.pledges_behind" },
    { text: "What is waiting for me?", needs: "tasks.mine" },
  ],
  events: [
    { text: "Draft a reminder for this event in English, Gujarati and Hindi", needs: "messages.draft_reminder", onlyFor: "event" },
    { text: "Change the venue of this event to the main hall", needs: "events.set_field", onlyFor: "event" },
    { text: "What events are coming up?", needs: "events.upcoming" },
    { text: "Draft a reminder for the next event", needs: "messages.draft_reminder", onlyWithout: true },
  ],
  messages: [
    { text: "Draft a reminder for the next event in English, Gujarati and Hindi", needs: "messages.draft_reminder" },
    { text: "What events are coming up?", needs: "events.upcoming" },
    { text: "What is waiting for me?", needs: "tasks.mine" },
  ],
  general: [
    { text: "What is waiting for me?", needs: "tasks.mine" },
    { text: "What events are coming up?", needs: "events.upcoming" },
    { text: "Who is behind on pledges?", needs: "giving.pledges_behind" },
  ],
};

/** Up to three plain example sentences for the screen the person is on, limited to what their role may use. */
export function suggestionsFor(path: string, entityKind: string | undefined, availableKeys: ReadonlySet<string>): string[] {
  const area = areaForPath(path);
  const pick = (list: Suggestion[]) =>
    list
      .filter((s) => (s.needs ? availableKeys.has(s.needs) : true))
      .filter((s) => (s.onlyFor ? s.onlyFor === entityKind : true))
      .filter((s) => (s.onlyWithout ? entityKind === undefined : true))
      .map((s) => s.text);
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
  general: "Home",
};

/** "Looking at this event" / "Looking at Events": a line so the person can see what Niva knows about the screen. */
export function contextLine(context: RouteContext): string {
  if (context.entityKind) return `Looking at this ${context.entityKind}`;
  const area = areaForPath(context.path);
  return area === "general" && context.path === "/" ? "Looking at Home" : area === "general" ? "Looking at this page" : `Looking at ${AREA_NAME[area]}`;
}
