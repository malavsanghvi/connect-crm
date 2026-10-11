// A page address turned into the pattern we may record: /events/8f0c9e5a-... becomes /events/[id].
// Pure, no imports, shared by the browser beacon and the server (which checks every key again).
//
// The rule is a whitelist, not a blacklist: a segment survives only when it looks like a fixed word of
// the portal's own address space (lowercase letters and hyphens, such as "giving" or "gyan-path").
// Anything else (digits, capitals, underscores, dots, percent signs, very long text, a hex-looking run)
// becomes [id]. So no id, number, token, name or query string can ever pass through.

export const ID_SEGMENT = "[id]";
export const SCREEN_PREFIX = "screen:";
/** Longest pattern we keep: deeper addresses are cut here (the portal has none that deep). */
export const MAX_SEGMENTS = 8;

const STATIC_WORD = /^[a-z][a-z-]{0,29}$/;
// A run of only a-f letters is how a hex id looks when it happens to have no digit.
const HEX_LOOKING = /^[a-f-]{8,}$/;

function isStaticWord(segment: string): boolean {
  return STATIC_WORD.test(segment) && !segment.endsWith("-") && !HEX_LOOKING.test(segment);
}

/** Drop a scheme and host if a full address was given, then the query string and the hash. */
function pathOnly(input: string): string {
  let s = input.trim();
  const scheme = s.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i);
  if (scheme) s = s.slice(scheme[0].length);
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  return s;
}

/**
 * The pattern for a pathname. `dynamicValues` are the values of the route's dynamic parameters when the
 * caller knows them (Next's useParams()): a segment equal to one is always [id], even if it looks like a word.
 * The result always starts with "/" and never ends with one (except the root, "/").
 */
export function routePattern(pathname: string, dynamicValues: readonly string[] = []): string {
  const known = new Set(dynamicValues.filter((v) => v !== ""));
  const out: string[] = [];
  for (const raw of pathOnly(typeof pathname === "string" ? pathname : "").split("/")) {
    if (raw === "") continue;
    if (out.length >= MAX_SEGMENTS) break;
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      // A malformed escape is not a word; the raw text fails the whitelist below.
    }
    out.push(known.has(raw) || known.has(decoded) || raw === ID_SEGMENT ? ID_SEGMENT : isStaticWord(raw) ? raw : ID_SEGMENT);
  }
  return `/${out.join("/")}`;
}

/** The catalog key of a screen: "screen:/events/[id]". */
export function screenKey(pathname: string, dynamicValues: readonly string[] = []): string {
  return `${SCREEN_PREFIX}${routePattern(pathname, dynamicValues)}`;
}

/** True when `key` is a screen key whose pattern is already in canonical form (so it carries no id). */
export function isCanonicalScreenKey(key: unknown): key is string {
  if (typeof key !== "string" || !key.startsWith(SCREEN_PREFIX)) return false;
  const pattern = key.slice(SCREEN_PREFIX.length);
  return pattern.startsWith("/") && routePattern(pattern) === pattern;
}

// Areas never recorded as screens: the Weaver platform console (Weaver staff, not a community), the
// interface's own endpoints and the sign-in flow.
const SKIPPED_AREAS = new Set(["platform", "api", "login", "auth", "invite", "start", "request-access"]);

/** Whether visiting this address is recorded at all. */
export function shouldTrackPath(pathname: string): boolean {
  const first = pathOnly(typeof pathname === "string" ? pathname : "")
    .split("/")
    .find((s) => s !== "");
  return !first || !SKIPPED_AREAS.has(first.toLowerCase());
}
