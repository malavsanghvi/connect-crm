import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

// The product is called "Weaver". Only the web address (weaverams.org) keeps the letters AMS; no visible text does.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe("the website's name", () => {
  it("is Weaver", () => {
    expect(SITE_NAME).toBe("Weaver");
    expect(SITE_DESCRIPTION).not.toMatch(/\bAMS\b/);
  });

  it("is never written as Weaver AMS in the website's pages, components or text", () => {
    const files = [...sourceFiles(join(process.cwd(), "src/app/site")), ...sourceFiles(join(process.cwd(), "src/components/site")), join(process.cwd(), "src/lib/site.ts")];
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/Weaver AMS/i);
  });
});
