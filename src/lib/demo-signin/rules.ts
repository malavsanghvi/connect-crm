// "Try the demo" (B88 part 2): the pure rules and wording. No I/O here; the database decides everything that matters
// (app.worker_demo_begin, app.demo_session_state in migrations 0678/0679) and these helpers only read its answers and word them
// for people. Plain English throughout.

/** The reserved address domain of every demo person (nobody receives mail there). Mirrors app.demo_persona_domain(). */
export const DEMO_EMAIL_DOMAIN = "demo.weaverams.org";

/** How long a demo session lasts (owner decision 2026-10-11). Mirrors app.demo_signin_hours(). */
export const DEMO_SESSION_HOURS = 2;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** True only for an address exactly on the demo domain (not a look-alike such as x@demo.weaverams.org.example.com). */
export function isDemoEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const m = email.trim().toLowerCase().match(/^[a-z0-9._+-]{1,64}@([a-z0-9.-]+)$/);
  return m !== null && m[1] === DEMO_EMAIL_DOMAIN;
}

/**
 * True for a demo person's sign-in token: the address is on the demo domain, OR the token's app_metadata says demo (the database sets that
 * flag, and a person cannot edit their own app_metadata, so it still marks the sign-in if its address were ever changed).
 */
export function isDemoClaims(claims: { email?: unknown; app_metadata?: unknown } | null | undefined): boolean {
  if (!claims) return false;
  if (isDemoEmail(claims.email)) return true;
  const meta = claims.app_metadata;
  return !!meta && typeof meta === "object" && (meta as { demo?: unknown }).demo === true;
}

/**
 * What the per-visitor limit counts. An IPv4 address is itself; an IPv6 address is its /64 (the first four groups), because a household
 * or a phone is given a whole /64 and could otherwise start a demo from a new address every time. An IPv4-mapped IPv6 address counts as
 * the IPv4 one. Anything that is not an address is counted as itself, lower-cased (the portal only passes on checked addresses).
 */
export function ipLimitKey(ip: string | null | undefined): string {
  const raw = (ip ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  const mapped = raw.match(/^(?:0*:)*:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1]!;
  if (!raw.includes(":")) return raw;
  const halves = raw.split("::");
  if (halves.length > 2) return raw;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return raw;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return raw;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// ── The two demo communities ────────────────────────────────────────────────
export type DemoKind = "faith" | "neutral";
export const DEMO_KINDS: readonly DemoKind[] = ["faith", "neutral"];
export const KIND_LABEL: Record<DemoKind, string> = { faith: "Faith-based", neutral: "Not faith-based" };
export const KIND_BLURB: Record<DemoKind, string> = {
  faith: "A temple with Pathshala classes, pledges, events and its store.",
  neutral: "A neighbourhood club with events, giving, a directory and notices.",
};

/**
 * The two areas the featured demo people are arranged in (owner decision 2026-10-14; app.demo_featured_roles, migration 0815):
 * the non-profit's operational roles, and the community's own.
 */
export type DemoArea = "operations" | "community";
export const DEMO_AREAS: readonly DemoArea[] = ["operations", "community"];
export const AREA_LABEL: Record<DemoArea, string> = { operations: "Non-profit operational roles", community: "Community roles" };
export const AREA_BLURB: Record<DemoArea, string> = {
  operations: "The people who run the organization. Each one sees only what their role allows.",
  community: "A member of the community, as a family member would use it.",
};

export type DemoPerson = { id: string; role: string; name: string; story: string; area: DemoArea };
/** `id` and `slug` are the demo community's own, public ones: the member app opens it with them, as a guest, before anyone is chosen. */
export type DemoCommunity = { kind: DemoKind; name: string; id: string; slug: string; people: DemoPerson[] };
export type DemoChoices = { enabled: boolean; communities: DemoCommunity[] };

/** A community's people in their two areas, operations first, the database's order kept inside each; an area nobody is in is left out. */
export function peopleByArea(community: Pick<DemoCommunity, "people">): { area: DemoArea; label: string; blurb: string; people: DemoPerson[] }[] {
  return DEMO_AREAS.map((area) => ({ area, label: AREA_LABEL[area], blurb: AREA_BLURB[area], people: community.people.filter((p) => p.area === area) })).filter(
    (g) => g.people.length > 0,
  );
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Reads app.demo_choices(). Anything unexpected is left out rather than guessed at (a person without a known area, a community without its id and slug). */
export function parseChoices(raw: unknown): DemoChoices {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const communities: DemoCommunity[] = [];
  for (const c of Array.isArray(o.communities) ? o.communities : []) {
    if (!c || typeof c !== "object") continue;
    const kind = (c as Record<string, unknown>).kind;
    if (kind !== "faith" && kind !== "neutral") continue;
    const people: DemoPerson[] = [];
    for (const p of Array.isArray((c as Record<string, unknown>).people) ? ((c as Record<string, unknown>).people as unknown[]) : []) {
      if (!p || typeof p !== "object") continue;
      const r = p as Record<string, unknown>;
      if (!isUuid(r.id) || !str(r.role) || !str(r.name) || (r.area !== "operations" && r.area !== "community")) continue;
      people.push({ id: r.id, role: str(r.role), name: str(r.name), story: str(r.story), area: r.area });
    }
    const community = c as Record<string, unknown>;
    if (people.length > 0 && isUuid(community.id) && str(community.slug)) {
      communities.push({ kind, name: str(community.name), id: community.id, slug: str(community.slug), people });
    }
  }
  communities.sort((a, b) => DEMO_KINDS.indexOf(a.kind) - DEMO_KINDS.indexOf(b.kind));
  return { enabled: o.enabled === true, communities };
}

// ── Starting a session ──────────────────────────────────────────────────────
export type BeginCode = "off" | "unknown_persona" | "not_ready" | "ip_limit" | "busy";
export type BeginAnswer =
  | { ok: true; demoSessionId: string; email: string; password: string; centerSlug: string; role: string; name: string; expiresAt: string }
  | { ok: false; code: BeginCode };

const BEGIN_CODES: readonly BeginCode[] = ["off", "unknown_persona", "not_ready", "ip_limit", "busy"];

/** Reads app.worker_demo_begin(); null when the answer is not in the shape the database promises. */
export function parseBegin(raw: unknown): BeginAnswer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.ok === false) return BEGIN_CODES.includes(o.code as BeginCode) ? { ok: false, code: o.code as BeginCode } : null;
  if (o.ok !== true) return null;
  if (!isUuid(o.demo_session_id) || !str(o.email) || !str(o.password) || !str(o.center_slug)) return null;
  return {
    ok: true,
    demoSessionId: o.demo_session_id,
    email: str(o.email),
    password: str(o.password),
    centerSlug: str(o.center_slug),
    role: str(o.role),
    name: str(o.name),
    expiresAt: str(o.expires_at),
  };
}

/**
 * Why a start failed, in the four words a caller outside the portal (the member app, POST /api/demo/session) can tell apart:
 * "off" the demo is not available right now (switched off, or its sign-ins are not set up), "limit" too many starts (this visitor's
 * hour, or the whole platform's), "unknown_person" the chosen person is not a demo person, "failed" anything else (the request, the
 * database or the sign-in).
 */
export type StartFailCode = "off" | "limit" | "unknown_person" | "failed";

export function failCodeFor(code: BeginCode): StartFailCode {
  switch (code) {
    case "off":
    case "not_ready":
      return "off";
    case "ip_limit":
    case "busy":
      return "limit";
    case "unknown_persona":
      return "unknown_person";
  }
}

/** Why a start was refused, in words for the visitor (follows "Could not start the demo — "). */
export function refusalMessage(code: BeginCode): string {
  switch (code) {
    case "off":
      return "the demo is switched off right now. Please try again later.";
    case "unknown_persona":
      return "that demo person is not available. Choose another one.";
    case "not_ready":
      return "the demo is not ready yet. Its sign-ins have not been set up. Please try again later.";
    case "ip_limit":
      return "you have started a lot of demos in the last hour. Please wait a while, then try again.";
    case "busy":
      return "the demo is very busy right now. Please try again in a few minutes.";
  }
}

/** The "session_id" claim of an access token Supabase Auth just handed over (no check of the signature: it came straight from Auth). */
export function sessionIdFromAccessToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const claims = JSON.parse(json) as { session_id?: unknown };
    return isUuid(claims.session_id) ? claims.session_id : null;
  } catch {
    return null;
  }
}

// ── The check on every request of a demo session ────────────────────────────
export type DemoEndReason = "expired" | "off" | "unknown" | "error";

/** A short sentence for the demo page when a session ended (the "ended" parameter of /demo). */
export function endedNotice(code: string | null | undefined): string | null {
  switch (code) {
    case "expired":
      return `Your ${DEMO_SESSION_HOURS}-hour demo has ended. Start another one below.`;
    case "off":
      return "The demo was switched off, so your session ended. Please try again later.";
    case "unknown":
      return "Your demo session is no longer active. Start a new one below.";
    case "error":
      return "We could not check your demo session, so it was closed. Start a new one below.";
    case "left":
      return "You have left the demo.";
    default:
      return null;
  }
}

/** "1 h 42 min left" / "35 min left" / "less than a minute left". */
export function timeLeftText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return "less than a minute left";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min left` : `${m} min left`;
}

/** What the database says about the signed-in demo person's own session (app.demo_session_state), for the banner. */
export type DemoBannerInfo = { role: string; name: string; centerName: string; secondsLeft: number };

export function parseBanner(raw: unknown): DemoBannerInfo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.state !== "ok") return null;
  const left = typeof o.seconds_left === "number" ? o.seconds_left : Number(o.seconds_left);
  return { role: str(o.role), name: str(o.name), centerName: str(o.center_name), secondsLeft: Number.isFinite(left) ? left : 0 };
}
