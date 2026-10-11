// Niva's example sentences for Pathshala (decision D2): only the term, levels, classes and fees screens have any; none ever speaks of a
// child or a learner; the screens about learners (enrollments, a class's roster, homework, sign-offs, attendance) have none of their own,
// and carry no "Ask Niva" button either.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));

import { areaForPath, contextLine, routeContext, suggestionsFor } from "@/lib/assistant/context";
import { areaLabel } from "@/lib/assistant/palette";
import { LEARNING_COMMANDS } from "@/lib/commands/catalog/learning";

import { JAIN } from "../fixtures/kinds";

// The Jain Center these examples were first written for: its school is called Pathshala and it writes dollars.
const JAIN_CTX = { kind: JAIN, currency: "USD", locale: "en-US" };
const ALL = new Set(LEARNING_COMMANDS.map((c) => c.key));
const GENERAL = ["What is waiting for me?", "What events are coming up?", "Who is behind on pledges?"];
const CHILD_WORDS = /child|kid|learner|student|pupil|minor|\bson\b|daughter|\bboy\b|\bgirl\b|attendance|homework|birth|allerg|health|photo/i;

const on = (pathname: string, params?: Record<string, string>) => {
  const c = routeContext(pathname, params);
  return suggestionsFor(c.path, c.entityKind, new Set([...ALL, "tasks.mine", "events.upcoming", "giving.pledges_behind"]), JAIN_CTX);
};

describe("Niva's examples for Pathshala", () => {
  it("is its own area, called Learning", () => {
    expect(areaForPath("/pathshala")).toBe("learning");
    expect(areaForPath("/pathshala/terms/[id]/fees")).toBe("learning");
    expect(areaLabel("learning")).toBe("Learning");
    expect(contextLine({ path: "/pathshala/levels" })).toBe("Looking at Learning");
  });

  it("offers the classes examples on the Classes screen", () => {
    expect(on("/pathshala")).toEqual(["Which classes have no teacher yet, and who could teach them?", "How many Pathshala tasks are waiting?"]);
  });

  it("offers the term examples on a term and on its Fees and rules page", () => {
    const expected = ["How is this term set up: its levels, fees and rules?", "Is anything missing before registration can open for this term?", "What have we billed and collected for Pathshala so far?"];
    expect(on("/pathshala/terms/7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001", { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001" })).toEqual(expected);
    expect(on("/pathshala/terms/7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001/fees", { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001" })).toEqual(expected);
  });

  it("offers the terms list and the levels screen their own", () => {
    expect(on("/pathshala/terms")).toEqual([
      "What have we billed and collected for Pathshala so far?",
      "What is missing before registration can open for each term?",
      "Show how a term is set up: levels, fees and rules",
    ]);
    expect(on("/pathshala/levels")).toEqual(["Which levels have no fee set for the term?", "What would a fee of $135 for Jainism 2 change?"]);
  });

  it("offers nothing about Pathshala on the screens about learners: only the general examples", () => {
    for (const [path, params] of [
      ["/pathshala/enrollments", undefined],
      ["/pathshala/classes/7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1002", { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1002" }],
      ["/pathshala/classes/7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1002/attendance", { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1002" }],
      ["/pathshala/classes/7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1002/reports", { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1002" }],
      ["/pathshala/homework", undefined],
      ["/pathshala/signoffs", undefined],
      ["/pathshala/my-classes", undefined],
      ["/pathshala/teachers", undefined],
      ["/pathshala/announcements", undefined],
      ["/pathshala/committee/actions", undefined],
    ] as [string, Record<string, string> | undefined][]) {
      expect(on(path, params), path).toEqual(GENERAL);
    }
  });

  it("never speaks of a child, a learner, attendance or homework, anywhere in the area", () => {
    const paths: [string, Record<string, string> | undefined][] = [
      ["/pathshala", undefined],
      ["/pathshala/terms", undefined],
      ["/pathshala/terms/7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001", { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001" }],
      ["/pathshala/terms/7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001/fees", { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001" }],
      ["/pathshala/levels", undefined],
    ];
    for (const [path, params] of paths) for (const s of on(path, params)) expect(s, `${path}: ${s}`).not.toMatch(CHILD_WORDS);
  });

  it("only offers a sentence the person's role can act on", () => {
    expect(suggestionsFor("/pathshala", undefined, new Set(["tasks.mine"]), JAIN_CTX)).toEqual(["What is waiting for me?"]);
    expect(suggestionsFor("/pathshala", undefined, new Set(["learning.waiting_counts"]), JAIN_CTX)).toEqual(["How many Pathshala tasks are waiting?"]);
  });
});

describe("the Ask Niva buttons", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), "src/app/(app)/pathshala", rel), "utf8");
  const prompts = (source: string) => [...source.matchAll(/<AskNiva\s+prompt="([^"]+)"/g)].map((m) => m[1]);

  it("are on the terms, term, fees, levels and classes headers, and say nothing about a child", () => {
    for (const file of ["terms/page.tsx", "terms/[id]/page.tsx", "terms/[id]/fees/page.tsx", "levels/page.tsx", "page.tsx"]) {
      const found = prompts(read(file));
      expect(found.length, file).toBe(1);
      expect(found[0], file).not.toMatch(CHILD_WORDS);
    }
  });

  it("are on no screen about learners", () => {
    for (const file of ["enrollments/page.tsx", "homework/page.tsx", "signoffs/page.tsx", "my-classes/page.tsx", "classes/[id]/page.tsx", "classes/[id]/attendance/page.tsx", "classes/[id]/reports/page.tsx", "teachers/page.tsx", "announcements/page.tsx"]) {
      let source = "";
      try {
        source = read(file);
      } catch {
        continue; // this build has no such file
      }
      expect(source, file).not.toContain("AskNiva");
    }
  });
});
