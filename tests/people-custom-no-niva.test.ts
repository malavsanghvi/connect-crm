import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D2: nothing about anyone under 18 reaches an AI provider, and no custom field is offered to Niva on the Family page or the slide-over.
// The custom-field code reads and writes the database as the signed-in person and draws the page; it never imports the assistant, the
// provider layer or the commands' child filter, and its data (the payload) is not part of the family model that other code hands on.

const root = join(__dirname, "..");
const dirs = ["src/components/people-v2/custom", "src/app/dev/people-fields"];
const files = [
  "src/lib/people-v2/custom-fields.ts",
  "src/lib/people-v2/custom-load.ts",
  "src/lib/custom-field-suggestions.ts",
  "src/app/(app)/households/[id]/custom-actions.ts",
  ...dirs.flatMap((d) => readdirSync(join(root, d)).map((f) => `${d}/${f}`)),
];

describe("custom fields and the assistant", () => {
  it("has files to look at", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("never imports the assistant, the provider layer or Niva", () => {
    for (const f of files) {
      const text = readFileSync(join(root, f), "utf8");
      const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      expect(imports.filter((i) => /assistant|niva|anthropic|openai|provider|child-filter/i.test(i)), f).toEqual([]);
    }
  });

  it("offers nothing to Niva: no ask-Niva control, no assistant context, and the only Niva words are the staff-only note", () => {
    for (const f of files.filter((x) => x.startsWith("src/components"))) {
      const text = readFileSync(join(root, f), "utf8").replace("never sent to Niva", "").replace(/\/\/.*$/gm, "");
      expect(text, f).not.toMatch(/niva|ask-niva|assistant/i);
    }
  });

  it("keeps the custom payload out of the family model", () => {
    const model = readFileSync(join(root, "src/lib/people-v2/family-model.ts"), "utf8");
    expect(model).not.toMatch(/custom/i);
    const load = readFileSync(join(root, "src/lib/people-v2/family-load.ts"), "utf8");
    expect(load).not.toMatch(/custom_values|custom_staff|loadCustom/);
  });
});
