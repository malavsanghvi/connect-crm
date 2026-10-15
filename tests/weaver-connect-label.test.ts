import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MODULES, MODULE_KEYS, buildModuleRows, isProductModule, moduleDef, moduleForPath, moduleLabelFor, moduleOffMessage, notGrantedSentence } from "@/lib/modules";
import { NAV } from "@/lib/permissions";

// The Marketplace product behind WhatsApp Business messages (and, later, Facebook and Instagram posts for events) is called
// Weaver Connect (owner decision 2026-10-15; migration 0850). It was called CommunityConnect. Its module key, `channels`, never
// changes (docs/MARKETPLACE_PACKS.md rule P6: a key never changes, the label does). supabase/tests/850_weaver_connect_label_test.sql
// holds the database half of this.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const OLD_NAME = /Community\s*Connect/i;

describe("Weaver Connect: the label changed, the key did not", () => {
  it("the module is `channels`, called Weaver Connect, and still needs Communications", () => {
    expect((MODULE_KEYS as readonly string[]).includes("channels")).toBe(true);
    const m = MODULES.find((x) => x.key === "channels")!;
    expect(m.label).toBe("Weaver Connect");
    expect(m.core).toBe(false);
    expect(m.dependsOn).toEqual(["comms"]);
    expect(moduleDef("channels").label).toBe("Weaver Connect");
    expect(moduleLabelFor("channels")).toBe("Weaver Connect");
    expect(isProductModule("channels")).toBe(true);
  });

  it("no module label or description in the registry carries the old name", () => {
    expect(MODULES.filter((m) => OLD_NAME.test(m.label) || OLD_NAME.test(m.description))).toEqual([]);
  });

  it("the other Marketplace products keep their names", () => {
    const labels = Object.fromEntries(MODULES.filter((m) => isProductModule(m.key)).map((m) => [m.key, m.label]));
    expect(labels).toEqual({ ai: "iWeaver", website: "WeaverSite", channels: "Weaver Connect", care: "WeCare", matching: "CatchTheMatch", market: "Community Market" });
  });

  it("Settings › Modules (the registry standing in for the catalog) lists it as Weaver Connect under the same key", () => {
    const row = buildModuleRows(null, []).find((r) => r.key === "channels")!;
    expect(row.label).toBe("Weaver Connect");
    expect(row.dependsOn).toEqual(["comms"]);
  });

  it("the sentences a person reads when it is off say Weaver Connect", () => {
    const label = moduleLabelFor("channels");
    expect(notGrantedSentence(label)).toBe("Weaver has not enabled Weaver Connect for this community.");
    const off = moduleOffMessage("channels", "Sunrise Center");
    expect(off).toMatch(/^Weaver Connect is not on for Sunrise Center\./);
    expect(off).not.toMatch(OLD_NAME);
  });

  it("the WhatsApp settings page still follows the `channels` module, and WhatsApp group links stay in Communications", () => {
    const tabs = NAV.flatMap((n) => n.tabs);
    const wa = tabs.find((t) => t.href === "/settings/whatsapp");
    expect(wa?.module).toBe("channels");
    expect(moduleForPath("/settings/whatsapp")).toBe("channels");
    expect(moduleForPath("/comms/whatsapp")).toBe("comms");
  });
});

describe("Weaver Connect: nothing the portal shows still says CommunityConnect", () => {
  it("no source file under src/ carries the old product spelling (comments included)", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, name.name);
        if (name.isDirectory()) {
          if (name.name !== "node_modules" && name.name !== ".next") walk(path);
        } else if (/\.(?:tsx?|css)$/.test(name.name)) {
          const lines = readFileSync(path, "utf8").replace(/\r\n/g, "\n").split("\n");
          lines.forEach((line, i) => {
            if (/CommunityConnect/.test(line)) found.push(`${path.slice(ROOT.length + 1).replace(/\\/g, "/")}:${i + 1}`);
          });
        }
      }
    };
    walk(join(ROOT, "src"));
    // src/lib/tenancy.ts keeps "CommunityConnect.app" as an example base domain in a comment: a domain name, not the product.
    expect(found.filter((f) => !f.startsWith("src/lib/tenancy.ts:"))).toEqual([]);
  });

  it("the latest definition of the send-time function says Weaver Connect in the sentence recorded when a WhatsApp message is not sent", () => {
    const dir = join(ROOT, "supabase/migrations");
    const defining = readdirSync(dir)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .sort()
      .filter((f) => /create or replace function app\.worker_message_to_send\(/i.test(read(`supabase/migrations/${f}`)));
    const latest = defining[defining.length - 1]!;
    // Without its comments (a comment is shown to no one), the way the database test reads the function.
    const text = read(`supabase/migrations/${latest}`).replace(/--[^\n]*/g, "");
    expect(text).toContain("Not sent: WhatsApp messages are part of Weaver Connect, which is not on for this community.");
    const from = text.indexOf("create or replace function app.worker_message_to_send(");
    const fn = text.slice(from, text.indexOf("end $$;", from));
    expect(fn).not.toMatch(OLD_NAME);
  });

  it("migration 0850 changes only words: it never touches the key, the dependency, the grants or a policy", () => {
    const sql = read("supabase/migrations/0850_weaver_connect_label.sql").replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/update app\.modules set label = 'Weaver Connect' where key = 'channels' and label = 'CommunityConnect'/);
    expect(sql).not.toMatch(/set key\s*=|set module_key\s*=|set depends_on|center_module_grants|create policy|drop policy|alter table|grant execute|revoke/i);
  });
});
