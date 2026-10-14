import { describe, expect, it, vi } from "vitest";

// Which payment ways a community has switched on: what Niva's examples and the routines name. Read from the same answer as the Payments
// settings screen, only for a person who may see it, and never guessed when it cannot be read.

vi.mock("server-only", () => ({}));

import { communityHints } from "@/lib/assistant/community";
import { enabledPaymentPlugins } from "@/lib/payments/plugins/enabled";

const entry = (key: string, family: string, enabled: boolean, extra: Record<string, unknown> = {}) => ({
  key,
  label: key,
  label_override: null,
  family,
  provider: family === "provider_checkout" ? "stripe" : null,
  depends_on: [],
  sandbox_behavior: "none",
  catalog_status: "available",
  enabled,
  mode: "test",
  status: enabled ? "live" : "off",
  problem: null,
  sort: 10,
  config: {},
  config_fields: [],
  changed_at: null,
  ...extra,
});

const answer = (plugins: unknown[]) => ({ environment: "production", forced_test: false, offline_only: false, can_configure: true, can_connect: true, plugins });

function session(over: Record<string, unknown> = {}, rpc: (fn: string) => { data?: unknown; error?: { message: string; code?: string } | null } = () => ({ data: answer([]) })) {
  const calls: string[] = [];
  return {
    calls,
    value: {
      db: {
        rpc: (fn: string) => {
          calls.push(fn);
          const r = rpc(fn);
          return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
        },
      },
      center: { id: "c1", slug: "riverside", currency: "GBP", country: "GB" },
      modulesOff: [] as string[],
      permissions: ["giving.view"],
      isPlatformAdmin: false,
      isOwner: false,
      ...over,
    } as never,
  };
}

describe("the payment ways a community has switched on", () => {
  it("lists the ones that are on", async () => {
    const s = session({}, () => ({ data: answer([entry("card", "provider_checkout", true), entry("zelle", "reported_transfer", false), entry("check", "instructions", true)]) }));
    expect(await enabledPaymentPlugins(s.value)).toEqual(["card", "check"]);
    expect(s.calls).toEqual(["payment_plugin_settings"]);
  });

  it("does not ask when the community has no Giving, or the person may not see the payment settings", async () => {
    const off = session({ modulesOff: ["giving"] });
    expect(await enabledPaymentPlugins(off.value)).toBeNull();
    expect(off.calls).toEqual([]);
    const noAccess = session({ permissions: ["events.view"] });
    expect(await enabledPaymentPlugins(noAccess.value)).toBeNull();
    expect(noAccess.calls).toEqual([]);
    expect(await enabledPaymentPlugins(session({ permissions: ["integrations.view"] }).value)).toEqual([]);
  });

  it("is null, with the reason logged, when the database refuses or answers in a shape nobody expected", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await enabledPaymentPlugins(session({}, () => ({ error: { message: "boom", code: "XX000" } })).value)).toBeNull();
    expect(await enabledPaymentPlugins(session({}, () => ({ data: { nope: true } })).value)).toBeNull();
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});

describe("what Niva's panel is told about the community", () => {
  it("is its currency, its convention, its payment ways and the modules that are off", async () => {
    const s = session({ modulesOff: ["store"] }, () => ({ data: answer([entry("zelle", "reported_transfer", true)]) }));
    expect(await communityHints(s.value)).toEqual({ currency: "GBP", locale: "en-GB", paymentPlugins: ["zelle"], modulesOff: ["store"] });
  });

  it("gives the community's address only to the Weaver team", async () => {
    expect(await communityHints(session({ isPlatformAdmin: true }).value)).toMatchObject({ slug: "riverside" });
    expect(await communityHints(session({ isPlatformAdmin: false }).value)).not.toHaveProperty("slug");
  });
});
