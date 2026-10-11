import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { defineCommand } from "@/lib/commands/define";
import { CommandRegistry } from "@/lib/commands/registry";
import { confirmProposal, runCommand } from "@/lib/commands/run";
import { f, object, type Infer } from "@/lib/commands/schema";
import { CommandError, type CommandNeedsConfirmation } from "@/lib/commands/types";

import { fakeSession, testContext } from "./helpers";

// A tiny confirm command that fixes a value when the confirmation is prepared (`resolve`), keeps a hidden field, and runs only what was stored.
const secret = {
  description: "worked out by the command",
  optional: true,
  hidden: true,
  parse: (v: unknown) => (v === undefined || v === null ? { ok: true as const, value: undefined } : typeof v === "number" ? { ok: true as const, value: v } : { ok: false as const, error: "Stamp must be a number." }),
  json: () => ({ type: "integer" as const, description: "worked out by the command" }),
};
const input = object({ what: f.string("What to do.", { min: 1 }), stamp: secret });
type In = Infer<typeof input>;

function build(opts: { refuse?: boolean } = {}) {
  let clock = 100;
  const ran: In[] = [];
  const command = defineCommand<In, { stamp: number | undefined }>({
    key: "test.fix_it",
    title: "Fix something",
    description: "A test command that fixes a value when the confirmation is prepared, then runs exactly that value.",
    level: "confirm",
    permission: "dashboard",
    input,
    async resolve(_ctx, inp) {
      if (opts.refuse) throw new CommandError("Not now.");
      clock += 1;
      return { ...inp, stamp: clock };
    },
    async preview(_ctx, inp) {
      return { summary: `Fix ${inp.what} at ${inp.stamp}.`, lines: [] };
    },
    async execute(_ctx, inp) {
      ran.push(inp);
      return { ok: true, data: { stamp: inp.stamp }, message: "done" };
    },
  });
  const registry = new CommandRegistry();
  registry.register(command);
  const ctx = testContext({ session: fakeSession({ permissions: [] }), registry, via: "screen" });
  return { ctx, ran, registry, bump: () => (clock += 50) };
}

describe("resolve: what the card shows is what is stored and what runs", () => {
  it("makes the card from the resolved input, stores that input, and runs it exactly", async () => {
    const { ctx, ran, bump } = build();
    const t = (await runCommand(ctx, "test.fix_it", { what: "the door" })) as CommandNeedsConfirmation;
    expect(t.preview.summary).toBe("Fix the door at 101.");
    bump(); // time moves on before the button is pressed; nothing is worked out again
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: true, data: { stamp: 101 } });
    expect(ran).toEqual([{ what: "the door", stamp: 101 }]);
  });

  it("replaces a value given for a hidden field, and never offers it to a model", async () => {
    const { ctx, ran, registry } = build();
    const t = (await runCommand(ctx, "test.fix_it", { what: "x", stamp: 9999 })) as CommandNeedsConfirmation;
    await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(ran[0].stamp).toBe(101);
    expect(Object.keys(registry.get("test.fix_it")!.input.json().properties)).toEqual(["what"]);
  });

  it("can refuse, in the command's own words, before any card is made", async () => {
    const { ctx } = build({ refuse: true });
    expect(await runCommand(ctx, "test.fix_it", { what: "x" })).toMatchObject({ ok: false, error: "Not now." });
  });
});
