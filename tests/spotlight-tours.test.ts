import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { NEUTRAL_KIND } from "@/lib/kind";
import { MODULE_KEYS } from "@/lib/modules";
import { ACCESS, NAV, sessionPermissions, type RoleLike, type ScopedContext } from "@/lib/permissions";
import { SPOTLIGHT_TEXT } from "@/lib/spotlight/copy";
import { holdsPersona, tourQualifies, toursFor } from "@/lib/spotlight/registry";
import { isValidKey } from "@/lib/spotlight/target";
import { TOURS } from "@/lib/spotlight/tours";
import { TREASURER_BANK_MATCH } from "@/lib/spotlight/tours/treasurer-bank-match";
import { WORKSPACES } from "@/lib/workspaces";

// The tour definitions are data: this checks them against the real source (every target is an attribute on a real element, every
// address is a real page, every permission and module exists) and that only the people the tour is for have it.

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

/** Every key the source puts on an element: `data-spotlight="x"`, `data-spotlight={a ? "x" : undefined}` or a `spotlight=` prop that sets it. */
function markedKeys(): { keys: Set<string>; prefixes: Set<string>; places: Map<string, string[]> } {
  const keys = new Set<string>();
  const prefixes = new Set<string>();
  const places = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    // The engine and the tours name keys; they do not mark elements. The dev preview pages draw samples, not the real screens.
    if (rel.startsWith("src/lib/spotlight/") || rel.startsWith("src/components/spotlight/") || rel.startsWith("src/app/dev/")) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!/(?:^|[\s{(])(?:data-)?spotlight=/.test(line)) continue;
      for (const m of line.matchAll(/"([A-Za-z0-9][A-Za-z0-9:_-]*)"/g)) {
        keys.add(m[1]);
        places.set(m[1], [...(places.get(m[1]) ?? []), rel]);
      }
      for (const m of line.matchAll(/`([A-Za-z0-9:_-]+)\$\{/g)) prefixes.add(m[1]);
    }
  }
  return { keys, prefixes, places };
}

/** Is there an element in the source that carries this key? A `nav-` key is a link of the navigation: a module of NAV or a workspace of the New look. */
function isMarked(target: string, marked = markedKeys()): boolean {
  if (marked.keys.has(target)) return true;
  for (const prefix of marked.prefixes) {
    if (!target.startsWith(prefix)) continue;
    const rest = target.slice(prefix.length);
    if (prefix === "nav-" && (NAV.some((m) => m.key === rest) || WORKSPACES.some((w) => w.key === rest))) return true;
  }
  return false;
}

describe("every tour is well formed", () => {
  it("has at least one tour, with unique ids", () => {
    expect(TOURS.length).toBeGreaterThan(0);
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(TOURS.length);
  });

  for (const tour of TOURS) {
    describe(tour.id, () => {
      it("has a title, a summary and a length", () => {
        expect(tour.title.trim()).not.toBe("");
        expect(tour.summary.trim()).not.toBe("");
        expect(tour.minutes).toBeGreaterThan(0);
        expect(tour.persona.length).toBeGreaterThan(0);
      });

      it("is about 6 to 8 steps with unique ids", () => {
        expect(tour.steps.length).toBeGreaterThanOrEqual(6);
        expect(tour.steps.length).toBeLessThanOrEqual(8);
        expect(new Set(tour.steps.map((s) => s.id)).size).toBe(tour.steps.length);
      });

      it("gives every step a title and a body of one or two plain sentences", () => {
        for (const s of tour.steps) {
          expect(s.title.trim(), `${s.id} title`).not.toBe("");
          expect(s.body.trim(), `${s.id} body`).not.toBe("");
          expect(s.body.length, `${s.id} body is short`).toBeLessThanOrEqual(260);
          const sentences = s.body.split(/(?<=[.!?])\s+/).filter(Boolean);
          expect(sentences.length, `${s.id} has ${sentences.length} sentences`).toBeLessThanOrEqual(2);
          if (s.missing !== undefined) expect(s.missing.trim(), `${s.id} missing`).not.toBe("");
        }
      });

      it("only names targets that are valid keys", () => {
        for (const s of tour.steps) expect(isValidKey(s.target), `${s.id}: ${s.target}`).toBe(true);
      });

      it("has a data-spotlight attribute in the source for every target", () => {
        const marked = markedKeys();
        for (const s of tour.steps) {
          expect(isMarked(s.target, marked), `no element in src/ carries data-spotlight="${s.target}" (step ${s.id})`).toBe(true);
        }
      });

      it("goes only to pages that exist", () => {
        for (const s of tour.steps) {
          if (!s.href) continue;
          expect(s.href.startsWith("/") && !s.href.startsWith("//"), `${s.id}: ${s.href}`).toBe(true);
          const path = s.href.split(/[?#]/)[0];
          const page = path === "/" ? join(SRC, "app/(app)/page.tsx") : join(SRC, "app/(app)", path, "page.tsx");
          expect(existsSync(page), `${s.id}: ${s.href} has no page at ${relative(ROOT, page)}`).toBe(true);
        }
      });

      it("needs only permissions and modules that exist", () => {
        for (const key of tour.requires.access ?? []) expect(Object.keys(ACCESS), key).toContain(key);
        for (const key of tour.requires.modules ?? []) expect(MODULE_KEYS as readonly string[], key).toContain(key);
      });

      it("is for a role that exists in the role catalog (docs/ROLES.md, supabase/seed.sql)", () => {
        const seed = readFileSync(join(ROOT, "supabase/seed.sql"), "utf8");
        for (const role of tour.persona) expect(seed, role).toContain(`('${role}',`);
      });

      it("is only data: an address to visit, an element to light and words (nothing in a step can click, submit or write)", () => {
        for (const s of tour.steps) expect(Object.keys(s).sort().filter((k) => !["id", "target", "href", "title", "body", "placement", "optional", "missing", "interactive"].includes(k))).toEqual([]);
      });

      it("writes for every community: no tradition's words, no community's name, no amounts", () => {
        const banned = [/Pathshala/, /Diwali/, /Paryushan/, /Satvik/, /Gyan Path/, /Jain/i, /stavan/i, /\bjsh\b/i, /\btemple\b/i, /\$\s?\d/, /\bdollars?\b/i, /\bUSD\b/];
        const words = [tour.title, tour.summary, ...tour.steps.flatMap((s) => [s.title, s.body, s.missing ?? ""]), ...(Object.values(SPOTLIGHT_TEXT).filter((v) => typeof v === "string") as string[])];
        for (const text of words) for (const re of banned) expect(text, `${re} in "${text}"`).not.toMatch(re);
      });
    });
  }
});

describe("the first tour: the treasurer matches a bank line", () => {
  it("is the registered tour", () => {
    expect(TOURS).toContain(TREASURER_BANK_MATCH);
    expect(TREASURER_BANK_MATCH.persona).toEqual(["treasurer"]);
  });

  it("takes the treasurer from Home to the household card, the confirm button and QuickBooks, ending on the real button", () => {
    expect(TREASURER_BANK_MATCH.steps.map((s) => s.target)).toEqual([
      "home-bank-task",
      "nav-giving",
      "bank-views",
      "bank-line",
      "bank-household",
      "bank-confirm",
      "qbo-sync-status",
      "bank-confirm",
    ]);
    const last = TREASURER_BANK_MATCH.steps[TREASURER_BANK_MATCH.steps.length - 1];
    expect(last.title).toBe("Try it yourself");
    expect(last.interactive).toBe(true);
    // Only the last step leaves the real button for the person to press.
    expect(TREASURER_BANK_MATCH.steps.filter((s) => s.interactive)).toHaveLength(1);
  });

  it("says what Confirm match does, and that the tour does not press it", () => {
    const confirm = TREASURER_BANK_MATCH.steps.find((s) => s.id === "confirm")!;
    expect(confirm.body).toMatch(/records the payment/i);
    expect(confirm.body).toMatch(/earliest open pledge/i);
    expect(confirm.body).toMatch(/QuickBooks/);
    expect(confirm.body).toMatch(/payer's name/i);
    expect(confirm.body).toMatch(/will not press/i);
  });

  it("says a name alone is never enough", () => {
    expect(TREASURER_BANK_MATCH.steps.find((s) => s.id === "household-card")!.body).toMatch(/name alone is never enough/i);
  });

  it("leaves out, silently, the stops a phone or a community without accounting cannot show", () => {
    const optional = TREASURER_BANK_MATCH.steps.filter((s) => s.optional).map((s) => s.id);
    expect(optional).toEqual(["money-area", "where-it-lands"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Who has a tour: the treasurer, and nobody else.

const PAST = "2020-01-01T00:00:00Z";

type SeedRole = RoleLike & { defaultScope: string };

function seedRoles(): SeedRole[] {
  const text = readFileSync(join(ROOT, "supabase/seed.sql"), "utf8");
  const re = /^\('([a-z_]+)',\s*'([a-z]+)',\s*'(?:[^']|'')*',\s*'([a-z]+)',\s*'(?:[^']|'')*',\s*'(\[[^\]]*\])'\)[,;]?\s*$/gm;
  return [...text.matchAll(re)].map((m) => ({ key: m[1], tier: m[2], defaultScope: m[3], permissions: JSON.parse(m[4]) as string[] }));
}

function ctxOf(role: RoleLike, roles: RoleLike[], over: Partial<ScopedContext> & { scope?: string; owner?: boolean } = {}): ScopedContext {
  const scope = over.scope ?? "center";
  const grants = [{ role_key: role.key, scope_kind: scope, scope_id: scope === "center" ? null : "scope-1", starts_at: PAST, ends_at: null }];
  const isOwner = over.owner ?? false;
  const permissions = sessionPermissions(grants, roles, isOwner);
  return {
    permissions,
    isPlatformAdmin: over.isPlatformAdmin ?? false,
    isOwner,
    modulesOff: over.modulesOff ?? [],
    kind: over.kind,
    grants: grants.map((g) => ({ role_key: g.role_key, scope_kind: g.scope_kind, scope_id: g.scope_id })),
  };
}

describe("only the treasurer has the tour", () => {
  const roles = seedRoles();
  const treasurer = roles.find((r) => r.key === "treasurer")!;

  it("reads the role catalog", () => {
    expect(roles.length).toBeGreaterThan(20);
    expect(treasurer).toBeDefined();
  });

  it("the treasurer of a community has it", () => {
    expect(toursFor(ctxOf(treasurer, roles)).map((t) => t.id)).toEqual(["treasurer-bank-match"]);
  });

  it("and in a community of any kind (the neutral kind has no tradition words)", () => {
    expect(toursFor(ctxOf(treasurer, roles, { kind: NEUTRAL_KIND })).map((t) => t.id)).toEqual(["treasurer-bank-match"]);
  });

  it("no other role, held for the whole community, has any tour: every other role sees nothing new", () => {
    const others = roles.filter((r) => r.key !== "treasurer");
    expect(others.length).toBeGreaterThan(20);
    for (const r of others) expect(toursFor(ctxOf(r, roles)), r.key).toEqual([]);
  });

  it("the owner and a platform admin are not treasurers: holding every permission does not give the tour", () => {
    const admin = roles.find((r) => r.key === "center_admin")!;
    expect(toursFor(ctxOf(admin, roles, { owner: true }))).toEqual([]);
    expect(toursFor({ permissions: ["giving.view"], isPlatformAdmin: true, isOwner: false, grants: [] })).toEqual([]);
  });

  it("the finance volunteer, who also matches bank lines, is not offered the treasurer's tour in this prototype", () => {
    const volunteer = roles.find((r) => r.key === "finance_volunteer")!;
    expect(volunteer).toBeDefined();
    expect(toursFor(ctxOf(volunteer, roles))).toEqual([]);
  });

  it("a treasurer grant for one event, class or zone is not the role (scoped grants add nothing community-wide)", () => {
    expect(toursFor(ctxOf(treasurer, roles, { scope: "event" }))).toEqual([]);
    expect(holdsPersona({ grants: [{ role_key: "treasurer", scope_kind: "event", scope_id: "e" }] }, ["treasurer"])).toBe(false);
    expect(holdsPersona({ grants: [{ role_key: "treasurer", scope_kind: "center", scope_id: null }] }, ["treasurer"])).toBe(true);
    expect(holdsPersona({}, ["treasurer"])).toBe(false);
  });

  it("a treasurer who cannot open the Bank screen (no giving.view, no giving.record_offline) has none", () => {
    const ctx = ctxOf(treasurer, roles);
    expect(tourQualifies(TREASURER_BANK_MATCH, { ...ctx, permissions: ctx.permissions.filter((p) => p !== "giving.view" && p !== "giving.record_offline") })).toBe(false);
  });

  it("a community that switched off Giving or Bank reconciliation has no tour for its treasurer", () => {
    expect(toursFor(ctxOf(treasurer, roles, { modulesOff: ["giving_bank"] }))).toEqual([]);
    expect(toursFor(ctxOf(treasurer, roles, { modulesOff: ["giving"] }))).toEqual([]);
    // An unrelated module being off changes nothing.
    expect(toursFor(ctxOf(treasurer, roles, { modulesOff: ["store"] })).map((t) => t.id)).toEqual(["treasurer-bank-match"]);
  });

  it("the demo's treasurer (Meera Doshiwal) is a treasurer of the faith demo", () => {
    const dir = join(ROOT, "supabase/migrations");
    const file = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .reverse()
      .find((f) => readFileSync(join(dir, f), "utf8").includes("'demo_faith_jain_v1'") && readFileSync(join(dir, f), "utf8").includes("$demo$"))!;
    const body = readFileSync(join(dir, file), "utf8").split("$demo$")[1];
    const personas = (JSON.parse(body) as { personas: { role: string; person: string }[] }).personas;
    expect(personas.some((p) => p.role === "treasurer" && /doshiwal/i.test(p.person))).toBe(true);
  });
});
