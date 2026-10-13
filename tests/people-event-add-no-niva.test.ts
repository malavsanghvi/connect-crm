import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D2: nothing about anyone under 18 reaches an AI provider. "Add to an event" lists a family's children by name on the staff screen and
// writes their names on the tickets; it never imports the assistant, the provider layer or Niva, offers nothing to Niva, and is not part of
// the command catalog (a command's input and result can reach a model; this is a plain Server Action).

const root = join(__dirname, "..");
const dirs = ["src/components/people-v2/events", "src/app/dev/people-event-add"];
const files = [
  "src/lib/people-v2/event-add.ts",
  "src/lib/people-v2/event-add-props.ts",
  "src/lib/people-v2/event-add-server.ts",
  "src/lib/people-v2/event-add-setup.ts",
  "src/lib/people-v2/person-events.ts",
  "src/lib/people-v2/person-events-load.ts",
  "src/app/(app)/households/[id]/event-add-actions.ts",
  "src/app/(app)/households/[id]/person-events.tsx",
  ...dirs.flatMap((d) => readdirSync(join(root, d)).map((f) => `${d}/${f}`)),
];

describe("Add to an event and the assistant", () => {
  it("has files to look at", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("never imports the assistant, the provider layer, the command layer or Niva", () => {
    for (const f of files) {
      const text = readFileSync(join(root, f), "utf8");
      const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      expect(imports.filter((i) => /assistant|niva|anthropic|openai|provider|child-filter|lib\/commands/i.test(i)), f).toEqual([]);
    }
  });

  it("offers nothing to Niva: no ask-Niva control and no assistant context in what is drawn", () => {
    for (const f of files.filter((x) => x.includes("components") || x.endsWith(".tsx"))) {
      const text = readFileSync(join(root, f), "utf8").replace(/\/\/.*$/gm, "");
      expect(text, f).not.toMatch(/niva|ask-niva|assistant/i);
    }
  });

  it("is not a command: it is not in the catalog and has no assistant tool", () => {
    const catalog = readFileSync(join(root, "src/lib/commands/catalog/index.ts"), "utf8");
    expect(catalog).not.toMatch(/event-add|addToEvent|add_to_event/i);
    const events = readdirSync(join(root, "src/lib/commands/catalog/events")).join(" ");
    expect(events).not.toMatch(/event-add|add-to-event/);
  });

  it("changes no migration, policy or permission: nothing under supabase/ is touched by these files", () => {
    for (const f of files) expect(readFileSync(join(root, f), "utf8"), f).not.toMatch(/create policy|alter table|create or replace function app\./i);
  });
});
