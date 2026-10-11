import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The card imports the security-code window, which verifies a code through a server action; nothing is called here.
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { NivaHouseholdCard } from "@/components/niva/niva-household-card";
import { ProposalCardView } from "@/components/niva/proposal-card";
import { ResultCards } from "@/components/niva/result-cards";
import { initialProposalFlow, type ProposalFlow } from "@/lib/assistant/proposal";
import { asHouseholdCard } from "@/lib/assistant/result-view";

import { sampleProposal } from "./fake-server";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const proposal = sampleProposal({ expiresAt: "2026-10-10T12:14:30.000Z" });
const noop = () => {};

const view = (flow: ProposalFlow, nowMs = NOW) => renderToStaticMarkup(createElement(ProposalCardView, { flow, nowMs, onConfirm: noop, onCancel: noop }));
const buttonTag = (html: string, label: string) => new RegExp(`<button[^>]*>${label}</button>`).exec(html)?.[0] ?? "";

describe("the confirmation card", () => {
  const html = view(initialProposalFlow(proposal));

  it("says in plain sentences what will happen, with a clear button and a Cancel", () => {
    expect(html).toContain("Needs your OK");
    expect(html).toContain("What will happen");
    expect(html).toContain("The venue of Diwali Dinner changes from Hall A to Main Hall.");
    expect(buttonTag(html, "Change the venue")).not.toBe("");
    expect(buttonTag(html, "Change the venue")).not.toContain(`disabled=""`);
    expect(buttonTag(html, "Cancel")).not.toBe("");
    expect(html).toContain("Nothing changes until you press the button.");
  });

  it("shows how long it stays valid", () => {
    expect(html).toContain("valid for 14 minutes");
  });

  it("shows the household as a card (numbers, city, open pledges) and adults only", () => {
    expect(html).toContain("Shah household");
    expect(html).toContain("H-1042");
    expect(html).toContain("Rahul Shah, Mira Shah");
    expect(html).toContain("Edison");
    expect(html).toContain("$250.00");
    expect(html).not.toContain("Kid Shah");
  });

  it("while it works the button is disabled and says so", () => {
    const working = view({ ...initialProposalFlow(proposal), phase: "confirming" });
    expect(buttonTag(working, "Working…")).toContain(`disabled=""`);
    expect(buttonTag(working, "Cancel")).toContain(`disabled=""`);
    expect(working).toContain('aria-busy="true"');
  });

  it("when the security code is needed it points to the code window and has no field for the code", () => {
    const waiting = view({ ...initialProposalFlow(proposal), phase: "waiting_for_code" });
    expect(waiting).toContain("Waiting for your security code");
    expect(waiting).toContain("never typed into this chat");
    expect(waiting).not.toContain("<input");
    expect(waiting).not.toContain("<textarea");
  });

  it("shows the server's message after it went through, and offers nothing more to press", () => {
    const done = view({ ...initialProposalFlow(proposal), phase: "done", message: "The venue is now Main Hall." });
    expect(done).toContain("The venue is now Main Hall.");
    expect(done).toContain("Done");
    expect(done).not.toContain("<button");
    expect(done).not.toContain("Saved");
  });

  it("shows a plain-English error with Try again", () => {
    const failed = view({ ...initialProposalFlow(proposal), phase: "failed", error: "Could not change the venue — the event is already over." });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Could not change the venue — the event is already over.");
    expect(buttonTag(failed, "Try again")).not.toBe("");
    expect(failed).not.toContain("Done");
  });

  it("after its time is up the button is gone and it says so, even before anything marked it expired", () => {
    const late = view(initialProposalFlow(proposal), Date.parse("2026-10-10T12:20:00.000Z"));
    expect(late).toContain("This ran out of time, so nothing was changed.");
    expect(late).not.toContain("<button");
  });

  it("shows a cancelled card as cancelled", () => {
    const cancelled = view({ ...initialProposalFlow(proposal), phase: "cancelled" });
    expect(cancelled).toContain("Cancelled. Nothing was changed.");
    expect(cancelled).not.toContain("<button");
  });

  it("works with no household cards and no sentences", () => {
    const bare = view(initialProposalFlow({ ...proposal, cards: undefined, lines: [] }));
    expect(bare).toContain("Nothing else to show.");
    expect(buttonTag(bare, "Change the venue")).not.toBe("");
  });
});

describe("result cards", () => {
  it("draw household cards and small tables", () => {
    const html = renderToStaticMarkup(
      createElement(ResultCards, {
        title: "Behind on pledges",
        data: { total_open: "$400.00", showing: [{ household: proposal.cards?.[0], open: "$250.00" }], tasks: [{ title: "Approve a refund", open: [{ label: "Open", href: "/approvals" }] }] },
      }),
    );
    expect(html).toContain("Behind on pledges");
    expect(html).toContain("$400.00");
    expect(html).toContain("Rahul Shah, Mira Shah");
    expect(html).not.toContain("Kid Shah");
    expect(html).toContain('href="/approvals"');
    expect(html).toContain("<table");
  });

  it("says plainly when there is nothing to show", () => {
    expect(renderToStaticMarkup(createElement(ResultCards, { title: "My tasks", data: {} }))).toContain("My tasks: nothing to show.");
  });

  it("a household card never shows a name alone", () => {
    const card = asHouseholdCard({ household_id: "h2", household_name: "Shah household", household_number: null, org_household_id: null, adults: [], primary_adult: null, zone: null, city: null, last_gift_on: null })!;
    const html = renderToStaticMarkup(createElement(NivaHouseholdCard, { card }));
    expect(html).toContain("No household number");
    expect(html).toContain("Adults:");
    expect(html).toContain("No city");
    expect(html).toContain("Last gift never");
  });
});
