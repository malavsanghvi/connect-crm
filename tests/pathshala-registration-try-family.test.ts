import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// "Try a family" after the database answered: the form's action state is replaced by a fixed answer, so what is
// checked is how the screen shows the database's lines, a row it refused (beside that row) and what it says about the
// whole family. Nothing is priced here.
const answer = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return { ...real, useActionState: () => [answer.current, () => {}, false] };
});

import { TryFamily } from "@/app/(app)/pathshala/terms/[id]/fees/try-family";
import type { Quote, QuoteLine } from "@/lib/pathshala-registration/contract";

const line = (over: Partial<QuoteLine>): QuoteLine => ({
  index: 1,
  first_name: "Riya",
  row_key: "1",
  person_id: null,
  track_id: null,
  level_id: "j5",
  learner_kind: "child",
  family_rank: 1,
  age_on_cutoff: 12,
  outcome: null,
  base_fee_cents: 13000,
  sibling_discount_cents: 0,
  cap_reduction_cents: 0,
  late_fee_cents: 0,
  assistance_cents: 0,
  total_cents: 13000,
  priced: true,
  refusal: null,
  ...over,
});

const props = {
  action: vi.fn(),
  levels: [
    { id: "j5", name: "Jainism 5", label: "Jainism 5 · $130.00" },
    { id: "g2", name: "Gujarati 2", label: "Gujarati 2 · $130.00" },
    { id: "j2", name: "Jainism 2", label: "Jainism 2 · $130.00" },
  ],
  cutoffLabel: "Sun, Sep 6, 2026",
  lateFeeLabel: null,
  currency: "USD",
};

const render = (quote: Quote) => {
  answer.current = { ok: true, data: quote };
  return renderToStaticMarkup(createElement(TryFamily, props));
};

describe("Try a family: the database's answer on the screen", () => {
  it("shows one learner in two classes at one rank, and says the family is priced as a registration would be", () => {
    const html = render({
      lines: [line({}), line({ index: 2, row_key: "2", level_id: "g2" })],
      children_total_cents: 26000,
      adults_total_cents: 0,
      total_cents: 26000,
      late: false,
    });
    expect(html.match(/Child · 1st in the family · age 12/g)?.length).toBe(2);
    expect(html).toContain("Gujarati 2");
    expect(html).toContain("$260.00");
    expect(html).toContain("Priced as a registration would be.");
    expect(html).not.toContain("could not be priced");
  });

  it("shows a refused row's sentence beside that row and in its line, leaves it out of the totals, and never claims a registration's price", () => {
    const html = render({
      lines: [
        line({}),
        line({
          index: 2,
          first_name: "Mira",
          row_key: "2",
          level_id: "j2",
          learner_kind: "adult",
          family_rank: null,
          age_on_cutoff: 44,
          base_fee_cents: 0,
          total_cents: 0,
          priced: false,
          refusal: "Jainism 2 is a children's class, and Mira is an adult.",
        }),
      ],
      children_total_cents: 13000,
      adults_total_cents: 0,
      total_cents: 13000,
      late: false,
    });
    // Beside the form's second row (described by it), and in the answer's line instead of amounts.
    expect(html).toContain('<p id="try-family-row-2" class="mt-1 text-[13px] text-danger">Not priced: Jainism 2 is a children&#x27;s class, and Mira is an adult.</p>');
    expect(html).toMatch(/<select(?=[^>]*aria-describedby="try-family-row-2")(?=[^>]*aria-invalid="true")[^>]*name="level_id"/);
    expect(html.match(/Not priced: Jainism 2 is a children&#x27;s class, and Mira is an adult\./g)?.length).toBe(2);
    expect(html).toContain("1 row could not be priced — see that row. The totals leave those rows out.");
    expect(html).not.toContain("Priced as a registration would be");
    expect(html).toContain("$130.00");
  });
});
