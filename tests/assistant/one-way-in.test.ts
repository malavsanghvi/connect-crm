// One way into Niva on each page: the shell's button (and the rail item and Ctrl+J) open the panel; a page header does not add a second
// "Ask Niva" button. A button on a screen is only for one particular thing, so it carries its own label ("Draft a reply with Niva").
// What the old header buttons asked is offered as a suggested question in the panel instead (context.test.ts and the area tests).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

const AREAS = ["giving", "comms", "content", "events", "pathshala", "people", "reports", "settings", "setup", "store"];

describe("one way into Niva on each page", () => {
  const pages = sources(join(process.cwd(), "src/app")).map((file) => ({ file: file.split(sep).join("/"), text: readFileSync(file, "utf8") }));

  it("no page places an Ask Niva button without a label of its own for its one purpose", () => {
    for (const { file, text } of pages) {
      for (const tag of text.matchAll(/<AskNiva\b[^>]*>/g)) expect(tag[0], file).toMatch(/\blabel=/);
    }
  });

  it("the page headers of the areas that have suggested questions in the panel carry no Ask Niva button at all", () => {
    const withButton = pages.filter(({ file, text }) => AREAS.some((area) => file.includes(`/app/(app)/${area}/`)) && text.includes("<AskNiva"));
    // The one left is a button on a conversation: "Draft a reply with Niva".
    expect(withButton.map(({ file }) => file.split("/app/(app)/")[1])).toEqual(["comms/threads/[id]/page.tsx"]);
  });
});
