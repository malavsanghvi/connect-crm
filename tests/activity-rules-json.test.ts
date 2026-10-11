import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Advanced rules editor must leave the activity-recording setting exactly as it is: the database refuses any write of it
// except through the agreement functions (0621), so the editor neither shows it, nor lets one in, and a replace carries the
// stored one over.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ authorizeAction: vi.fn() }));
// ActionForm's step-up modal verifies a code through a server action.
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { saveRulesJsonAction } from "@/app/(app)/settings/rules/actions";
import { AdvancedRulesForm } from "@/app/(app)/settings/rules/rules-forms";
import { authorizeAction } from "@/lib/session";

import { fakeSession } from "./commands/helpers";

type Rules = Record<string, unknown>;

const ACTIVITY = { enabled: true, share_with_weaver: false, consent: { by: "5b1d6c0e-1111-4222-8333-444455556666", at: "2026-10-11T15:04:00Z", version: "1" } };

/** Just enough of the centers table for a versioned rules save: read the rules, and update them when the version still matches. */
function centersDb(start: Rules) {
  const state = { rules: start, updates: 0 };
  function from() {
    const q = { op: "select", patch: undefined as { rules: Rules } | undefined, filters: [] as [string, string, unknown][] };
    const run = () => {
      if (q.op === "select") return { data: { rules: state.rules }, error: null };
      const current = state.rules.version === undefined ? null : String(state.rules.version);
      const wanted = q.filters.find((f) => f[0] === "rules->>version");
      const matches = !wanted || (wanted[1] === "is" ? current === null : String(wanted[2]) === current);
      if (!matches) return { data: [], error: null };
      state.rules = q.patch!.rules;
      state.updates += 1;
      return { data: [{ id: "center-1" }], error: null };
    };
    const b = {
      select: () => b,
      update: (patch: { rules: Rules }) => ((q.op = "update"), (q.patch = patch), b),
      eq: (c: string, v: unknown) => (q.filters.push([c, "eq", v]), b),
      is: (c: string, v: unknown) => (q.filters.push([c, "is", v]), b),
      maybeSingle: () => b,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return b;
  }
  return { from, state };
}

function form(rules: Rules, version = "3"): FormData {
  const fd = new FormData();
  fd.set("rules", JSON.stringify(rules));
  fd.set("version", version);
  return fd;
}

function world(rules: Rules) {
  const db = centersDb(rules);
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, session: fakeSession({ db }) });
  return db.state;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(authorizeAction).mockReset();
});

describe("Settings › Rules › Advanced JSON and the activity-recording setting", () => {
  it("saves the edited rules and carries the stored activity setting over unchanged", async () => {
    const state = world({ version: 3, store: { gift_pack_cents: 299 }, activity: ACTIVITY });
    const result = await saveRulesJsonAction(null, form({ store: { gift_pack_cents: 399 }, home: { layout: "grid" } }));
    expect(result).toMatchObject({ ok: true });
    expect(state.rules).toEqual({ store: { gift_pack_cents: 399 }, home: { layout: "grid" }, activity: ACTIVITY, version: 4 });
  });

  it("does not add an activity setting to a community that has none", async () => {
    const state = world({ version: 3, store: { gift_pack_cents: 299 } });
    expect(await saveRulesJsonAction(null, form({ store: { gift_pack_cents: 399 } }))).toMatchObject({ ok: true });
    expect(state.rules).toEqual({ store: { gift_pack_cents: 399 }, version: 4 });
  });

  it("refuses JSON that carries an activity setting, with the reason, and writes nothing", async () => {
    const state = world({ version: 3, activity: ACTIVITY });
    const result = await saveRulesJsonAction(null, form({ activity: { enabled: false } }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("is not edited here") });
    expect((result as { error: string }).error).toContain("Settings > Automation ideas");
    expect(state.updates).toBe(0);
    expect(state.rules.activity).toEqual(ACTIVITY);
  });

  it("does not show the activity setting in the editor, and says where it is agreed", () => {
    const html = renderToStaticMarkup(createElement(AdvancedRulesForm, { rules: { version: 3, store: { gift_pack_cents: 299 }, activity: ACTIVITY } as never, version: 3, readOnly: false }));
    expect(html).toContain("gift_pack_cents");
    expect(html).not.toContain("consent");
    expect(html).not.toContain("share_with_weaver");
    expect(html).not.toContain("5b1d6c0e");
    expect(html).toContain("Settings › Automation ideas");
  });
});
