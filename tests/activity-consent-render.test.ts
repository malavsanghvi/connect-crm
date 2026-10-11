import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The forms call Server Actions; here nothing is called, only rendered.
vi.mock("@/app/(app)/settings/automation/actions", () => ({
  giveActivityConsentAction: vi.fn(),
  withdrawActivityConsentAction: vi.fn(),
  setActivitySharingAction: vi.fn(),
  decideIdeaAction: vi.fn(),
}));
vi.mock("@/app/(app)/platform/centers/[id]/actions", () => ({ setActivityRecordingAction: vi.fn() }));
// ActionForm's step-up modal verifies a code through a server action.
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { RecordingCard } from "@/app/(app)/platform/centers/[id]/recording-card";
import { ConsentPanel } from "@/app/(app)/settings/automation/consent-panel";
import { ACTIVITY_NOTICE, ACTIVITY_NOTICE_VERSION, consentFromRules } from "@/lib/activity/consent";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const TZ = "America/Chicago";
const CENTER = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001";

const NOT_AGREED = consentFromRules({});
const AGREED = consentFromRules({ activity: { enabled: true, consent: { at: "2026-10-11T15:04:00Z", version: "1" } } });
const SHARING = consentFromRules({ activity: { enabled: true, share_with_weaver: true, consent: { at: "2026-10-11T15:04:00Z", version: "1" } } });
const SWITCHED_OFF = consentFromRules({ activity: { enabled: false, consent: { at: "2026-10-11T15:04:00Z", version: "1" } } });
const WITHDRAWN = consentFromRules({ activity: { enabled: false, withdrawn: { at: "2026-10-12T09:00:00Z" } } });

const panel = (consent: Parameters<typeof ConsentPanel>[0]["consent"], canDecide = true) =>
  render(createElement(ConsentPanel, { consent, tz: TZ, canDecide, centerId: CENTER }));

describe("Settings › Automation ideas · Help us learn how your community uses Weaver", () => {
  it("says Not agreed, shows the whole notice, and offers I agree with the sharing choice OFF", () => {
    const html = panel(NOT_AGREED);
    expect(html).toContain("Help us learn how your community uses Weaver");
    expect(html).toContain("Not agreed");
    for (const line of ACTIVITY_NOTICE) expect(html).toContain(line.replace(/'/g, "&#x27;"));
    expect(html).toContain(`notice v${ACTIVITY_NOTICE_VERSION}`);
    expect(html).toContain(">I agree<");
    expect(html).toContain("Also let Weaver staff see counts of how communities use Weaver (no names, no content)");
    const box = html.match(/<input type="checkbox"[^>]*>/)?.[0] ?? "";
    expect(box).toContain('name="share"');
    expect(box).not.toContain("checked");
    expect(html).toContain(`name="notice_version" value="${ACTIVITY_NOTICE_VERSION}"`);
    expect(html).toContain("fresh 2FA code");
    expect(html).not.toContain("Withdraw agreement");
  });

  it("says when an agreement was withdrawn", () => {
    expect(panel(WITHDRAWN)).toContain("Your agreement was withdrawn on Oct 12, 2026.");
  });

  it("says Agreed on the date with the notice version, and offers to withdraw and to share", () => {
    const html = panel(AGREED);
    expect(html).toContain("Agreed on Oct 11, 2026 (notice v1)");
    expect(html).toContain("Recording is <strong>on</strong>");
    expect(html).toContain("Weaver staff see counts: <strong>no</strong>");
    expect(html).toContain(">Withdraw agreement<");
    expect(html).toContain(">Let Weaver staff see counts<");
    expect(html).toContain('name="share" value="true"');
    expect(html).not.toContain(">I agree<");
  });

  it("offers to stop sharing when counts are shared", () => {
    const html = panel(SHARING);
    expect(html).toContain("Weaver staff see counts: <strong>yes</strong>");
    expect(html).toContain(">Stop letting Weaver staff see counts<");
    expect(html).toContain('name="share" value="false"');
  });

  it("says when Weaver has switched recording off while the agreement stands", () => {
    expect(panel(SWITCHED_OFF)).toContain("switched off at the moment");
  });

  it("gives Weaver staff the state and no buttons: only the community's administrator decides", () => {
    for (const consent of [NOT_AGREED, AGREED]) {
      const html = panel(consent, false);
      expect(html).toContain("Only this community&#x27;s own administrator can agree, withdraw or change what Weaver staff see.");
      expect(html).not.toContain("<button");
      expect(html).not.toContain(">I agree<");
      expect(html).not.toContain("Withdraw agreement");
    }
  });
});

describe("Platform › Centers · record how this community uses Weaver", () => {
  const card = (consent: Parameters<typeof RecordingCard>[0]["consent"]) => render(createElement(RecordingCard, { centerId: CENTER, centerName: "Jain Society", consent, tz: TZ }));

  it("cannot be switched on until the administrator agrees, and says why", () => {
    const html = card(NOT_AGREED);
    expect(html).toContain("Not agreed");
    expect(html).toContain("Switch recording on");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Switch recording on<\/button>/);
    expect(html).toContain("The community&#x27;s administrator has not agreed yet.");
    expect(html).toContain('data-testid="recording-blocked"');
  });

  it("cannot be switched on after a withdrawal either", () => {
    expect(card(WITHDRAWN)).toMatch(/<button[^>]*disabled[^>]*>Switch recording on<\/button>/);
  });

  it("can be switched on again while the agreement stands (Weaver had switched it off)", () => {
    const html = card(SWITCHED_OFF);
    expect(html).toContain("Agreed on Oct 11, 2026 (notice v1)");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>/);
    expect(html).toContain(">Switch recording on<");
    expect(html).toContain('name="enable" value="true"');
    expect(html).not.toContain('data-testid="recording-blocked"');
  });

  it("can always be switched off, and shows the sharing choice", () => {
    const html = card(SHARING);
    expect(html).toContain(">Switch recording off<");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>/);
    expect(html).toContain('name="enable" value="false"');
    expect(html).toContain("Weaver staff may see counts: <strong>yes</strong>");
    expect(html).toContain(`name="center" value="${CENTER}"`);
    expect(html).toContain("Reason (required)");
  });

  it("never claims to show counts for a community that did not share", () => {
    expect(card(AGREED)).toContain("Weaver staff may see counts: <strong>no</strong>");
  });
});
