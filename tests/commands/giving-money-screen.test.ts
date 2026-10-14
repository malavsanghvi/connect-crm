import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ authorizeAction: vi.fn(), authorizeActionWhere: vi.fn(), dbWithReason: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { CATALOG } from "@/lib/commands/catalog";
import { runCommandFromScreen } from "@/lib/commands/catalog/events/bridge";
import { runScreenCommand } from "@/lib/commands/screen";
import { authorizeAction } from "@/lib/session";

import { SHAH } from "./giving-world";
import { fakeSession } from "./helpers";

const MONEY = ["giving.record_payment", "giving.confirm_exact_zelle_matches", "giving.match_deposit"];
const ask = { household_id: SHAH, amount: "250", method: "check", received_on: "2026-10-04" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(authorizeAction).mockReset();
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, session: fakeSession({ permissions: ["giving.view", "giving.manage", "giving.record_offline", "giving.approve"] }) } as never);
});

describe("a money command cannot be run straight from a screen", () => {
  it("is refused by the screen bridge, even with the owner's switch on and every permission", async () => {
    for (const key of MONEY) {
      const r = await runScreenCommand(key, ask, "record the payment");
      expect(r, key).toMatchObject({ ok: false, error: expect.stringContaining("it moves money, so it only runs after it is confirmed on its card") });
    }
  });

  it("is refused by the events screen bridge too", async () => {
    const session = fakeSession({ permissions: ["giving.manage"] });
    for (const key of MONEY) {
      const command = CATALOG.find((c) => c.key === key)!;
      expect(await runCommandFromScreen(command, session, ask), key).toMatchObject({ ok: false, error: expect.stringContaining("it moves money") });
    }
  });

  it("still lets a screen run an ordinary command", async () => {
    // giving.household_summary is a read: the bridge goes on to the permission and input checks, not to the money refusal.
    const r = await runScreenCommand("giving.household_summary", {}, "show the giving");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).not.toContain("it moves money");
  });
});
