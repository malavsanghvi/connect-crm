import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/commands/context", () => ({ createCommandContext: vi.fn() }));

import { createCommandContext } from "@/lib/commands/context";
import { runScreenCommand } from "@/lib/commands/screen";
import { authorizeAction } from "@/lib/session";

import { fakeDb, fakeSession, testContext } from "./helpers";

beforeEach(() => {
  vi.mocked(authorizeAction).mockReset();
  vi.mocked(createCommandContext).mockReset();
});

// A Server Action that calls a Platform command through runScreenCommand gets the same refusal the action's own check gave.
describe("runScreenCommand and the Weaver-team-only commands", () => {
  it("refuses anyone outside the Weaver team, before reading anything", async () => {
    const db = fakeDb();
    vi.mocked(authorizeAction).mockResolvedValue({ ok: true, session: fakeSession({ db, isPlatformAdmin: false, isOwner: true }) } as never);
    const r = await runScreenCommand("platform.waiting", {}, "read who is waiting");
    expect(r).toEqual({ ok: false, error: "Could not read who is waiting — only the Weaver team (platform admins) can do this." });
    expect(createCommandContext).not.toHaveBeenCalled();
    expect(db.rpcCalls).toEqual([]);
  });

  it("runs the command for the Weaver team", async () => {
    const db = fakeDb({ rpc: { platform_waiting: { counts: {}, items: [], consent: [] } } });
    const session = fakeSession({ db, isPlatformAdmin: true });
    vi.mocked(authorizeAction).mockResolvedValue({ ok: true, session } as never);
    vi.mocked(createCommandContext).mockResolvedValue(testContext({ session }));
    const r = await runScreenCommand("platform.waiting", {}, "read who is waiting");
    expect(r).toMatchObject({ ok: true, message: "Nobody is waiting for the team right now." });
    expect(db.rpcCalls).toHaveLength(1);
  });
});
