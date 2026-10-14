import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// What the Communications screens draw for copying and templates. Nothing is called here, only rendered: the buttons' behaviour is in
// tests/comms-template-actions.test.ts (the actions) and tests/comms-templates.test.ts (the rules).
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (orig) => ({
  ...((await orig()) as object),
  usePathname: () => "/comms/newsletters",
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/comms/template-actions", () => ({
  copyCampaignAction: vi.fn(),
  saveTemplateAction: vi.fn(),
  startFromTemplateAction: vi.fn(),
  renameTemplateAction: vi.fn(),
  deleteTemplateAction: vi.fn(),
}));
vi.mock("@/app/(app)/comms/actions", () => ({ previewRecipientsAction: vi.fn(), saveCampaignAction: vi.fn(), submitNewsletterAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { CampaignActions } from "@/app/(app)/comms/campaign-menu";
import { NewsletterCompose } from "@/app/(app)/comms/newsletter-form";
import { StartFrom } from "@/app/(app)/comms/start-from";
import { TemplateRowActions } from "@/app/(app)/comms/templates/template-row-actions";
import { availableChannels, campaignMenu, type RecentRow, type TemplateRow } from "@/lib/comms-templates";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const ALL = availableChannels({ textingApproved: true, whatsappAccountApproved: true, whatsappProductOn: true });
const EMAIL_ONLY = availableChannels({ textingApproved: false, whatsappAccountApproved: false, whatsappProductOn: false });
const campaign = { id: "c1", label: "September news", defaultTemplateName: "September news", channels: ["email", "push"] };

describe("Copy as new draft and Save as template on a communication", () => {
  const items = campaignMenu({ canWrite: true, kind: "newsletter", channels: ["email", "push"], available: ALL });

  it("draws both as buttons on an open communication", () => {
    const out = html(createElement(CampaignActions, { campaign, items, layout: "buttons" }));
    expect(out).toContain("Copy as new draft");
    expect(out).toContain("Save as template");
  });
  it("draws one ⋯ menu button on a list row, closed, named for the communication", () => {
    const out = html(createElement(CampaignActions, { campaign, items, layout: "menu" }));
    expect(out).toContain('aria-label="More about September news"');
    expect(out).toContain('aria-haspopup="menu"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("Copy as new draft");
  });
  it("draws nothing for someone without the permission, for an alert, or for a channel the community has not set up", () => {
    const none = (i: ReturnType<typeof campaignMenu>) => html(createElement(CampaignActions, { campaign, items: i, layout: "menu" }));
    expect(none(campaignMenu({ canWrite: false, kind: "newsletter", channels: ["email"], available: ALL }))).toBe("");
    expect(none(campaignMenu({ canWrite: true, kind: "alert", channels: ["push"], available: ALL }))).toBe("");
    expect(none(campaignMenu({ canWrite: true, kind: "newsletter", channels: ["sms"], available: EMAIL_ONLY }))).toBe("");
    expect(html(createElement(CampaignActions, { campaign, items: [], layout: "buttons" }))).toBe("");
  });
});

describe("Start from", () => {
  const recent: RecentRow[] = [{ id: "r1", name: "September news", subject: "News", channels: ["email"], audience: "All members", statusLabel: "Sent", when: "Sent Sep 21", by: "Mona" }];
  const templates: TemplateRow[] = [
    { id: "t1", name: "Monthly news", subject: "News", channels: ["email"], tokens: ["recipient_first_name"], by: "Mona", when: "Saved Oct 10" },
    { id: "t2", name: "Lunch", subject: "", channels: ["whatsapp"], tokens: [], by: "Raj", when: "Saved Oct 9" },
  ];

  it("offers Blank, A saved template and A recent communication, with Blank chosen", () => {
    const out = html(createElement(StartFrom, { recent, templates, available: ALL }));
    expect(out).toContain("Start from");
    expect(out).toContain('role="radiogroup"');
    for (const label of ["Blank", "A saved template", "A recent communication"]) expect(out).toContain(label);
    expect(out).toMatch(/aria-checked="true"[^>]*><span[^>]*>Blank</);
    expect(out).toContain("2 saved templates");
    expect(out).toContain("Fill in the form below.");
  });
  it("says there are no templates yet instead of showing an empty list", () => {
    const out = html(createElement(StartFrom, { recent: [], templates: [], available: EMAIL_ONLY }));
    expect(out).toContain("None saved yet.");
    expect(out).toContain("Nothing sent, scheduled or drafted yet.");
  });
});

describe("the saved templates list", () => {
  it("draws Use, Rename and Delete for a template", () => {
    const out = html(createElement(TemplateRowActions, { id: "t1", name: "Monthly news" }));
    expect(out).toContain(">Use<");
    expect(out).toContain("Rename");
    expect(out).toContain("Delete");
  });
});

describe("the composer", () => {
  const options = { zones: [{ id: "z1", name: "North" }], classes: [], events: [], unavailable: [] };
  const draft = (over: Partial<Parameters<typeof NewsletterCompose>[0]["campaign"] & object> = {}) => ({
    id: "d1",
    name: "Copy of September news",
    title: "News",
    body_md: "Dear {{recipient_first_name}}",
    channels: ["email"],
    audience: { zone_ids: ["z1"] },
    translations: {},
    scheduled_local: "",
    ...over,
  });
  const compose = (campaignProps: ReturnType<typeof draft>, canApprove = true) =>
    html(createElement(NewsletterCompose, { options, canApprove, myEmail: "me@example.org", campaign: campaignProps }));

  it("opens a working draft as 'Edit draft' with Save draft and its own button to send it for approval", () => {
    const out = compose(draft({ status: "working_draft" }));
    expect(out).toContain("Edit draft");
    expect(out).toContain("Save draft");
    expect(out).toMatch(/<button[^>]*name="intent"[^>]*>/);
    expect(out).toMatch(/<button[^>]*value="submit"[^>]*>/);
    expect(out).toContain("Schedule send");
    expect(out).toContain("Saving keeps this as a draft");
    expect(out).toContain("Dear {{recipient_first_name}}");
  });
  it("says 'Send for approval' when the person cannot approve", () => {
    expect(compose(draft({ status: "working_draft" }), false)).toContain("Send for approval");
  });
  it("keeps the send button off until an audience is chosen", () => {
    const out = compose(draft({ status: "working_draft", audience: {} }));
    expect(out).toMatch(/<button[^>]*disabled[^>]*name="intent"|<button[^>]*name="intent"[^>]*disabled/);
    expect(out).toContain("Choose who receives it first");
  });
  it("warns when a draft's audience was set up outside this form, because saving replaces it", () => {
    const out = compose(draft({ status: "working_draft", audience: { boli_id: "b1", household_ids: ["h1"] } }));
    expect(out).toContain("set up somewhere other than this form");
  });
  it("leaves the ordinary edit of a communication awaiting approval as it was", () => {
    const out = compose(draft({ status: "draft" }));
    expect(out).toContain("Edit newsletter");
    expect(out).toContain("Save changes");
    expect(out).not.toContain('name="intent"');
    expect(out).not.toContain("Saving keeps this as a draft");
  });
});
