import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(async (opts: unknown) => ({ from: vi.fn(), rpc: vi.fn(), tag: opts })) }));
vi.mock("@/lib/session", () => ({ authorizeActionWhere: vi.fn() }));

import { authorizeCommandContext, createCommandContext } from "@/lib/commands/context";
import { defaultRegistry } from "@/lib/commands/registry";
import { authorizeActionWhere } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { fakeSession } from "./helpers";

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockClear();
});

describe("a command context", () => {
  it("makes Niva's database writes carry client_app assistant, for the same person and request", async () => {
    const session = fakeSession();
    const ctx = await createCommandContext(session, "assistant");
    expect(createSupabaseServerClient).toHaveBeenCalledWith({ requestId: "req-1", clientApp: "assistant" });
    expect(ctx.session.clientApp).toBe("assistant");
    expect(ctx.session.userId).toBe(session.userId);
    expect(ctx.session.db).not.toBe(session.db);
    expect(ctx.via).toBe("assistant");
    expect(ctx.minors).toBeDefined();
    // The signed-in session itself is not changed.
    expect(session.clientApp).toBeUndefined();
  });

  it("keeps the person's own client for the screen and the palette", async () => {
    const session = fakeSession();
    for (const via of ["screen", "palette"] as const) {
      const ctx = await createCommandContext(session, via);
      expect(ctx.session).toBe(session);
    }
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("registers the first commands in the shared registry, once", async () => {
    await createCommandContext(fakeSession(), "screen");
    await createCommandContext(fakeSession(), "screen");
    expect(defaultRegistry.all().map((c) => c.key)).toContain("people.search");
    expect(defaultRegistry.all().filter((c) => c.key === "events.set_field")).toHaveLength(1);
  });

  it("gives a signed-out person the reason, not a context", async () => {
    vi.mocked(authorizeActionWhere).mockResolvedValueOnce({ ok: false, error: "Could not search — your session has expired. Sign in again." });
    expect(await authorizeCommandContext("palette", "search")).toEqual({ ok: false, error: "Could not search — your session has expired. Sign in again." });
    vi.mocked(authorizeActionWhere).mockResolvedValueOnce({ ok: true, session: fakeSession() });
    expect(await authorizeCommandContext("palette", "search")).toMatchObject({ ok: true, ctx: { via: "palette" } });
  });
});
