import { describe, expect, it } from "vitest";

import {
  ACTIVITY_NOTICE,
  ACTIVITY_NOTICE_VERSION,
  SHARE_LABEL,
  agreementText,
  consentFromRules,
  consentFromStatus,
  countSharingCommunities,
  sharedWithWeaver,
  weaverCanSwitchOn,
  withdrawnText,
} from "@/lib/activity/consent";

const AGREED = { activity: { enabled: true, share_with_weaver: false, consent: { by: "5b1d6c0e-1111-4222-8333-444455556666", at: "2026-10-11T15:04:00.123456Z", version: "1" } } };
const SHARING = { activity: { ...AGREED.activity, share_with_weaver: true } };
const WITHDRAWN = { activity: { enabled: false, withdrawn: { by: "5b1d6c0e-1111-4222-8333-444455556666", at: "2026-10-12T09:00:00Z" } } };

describe("the notice", () => {
  it("has one version, in one place, that the database accepts", () => {
    expect(ACTIVITY_NOTICE_VERSION).toMatch(/^[A-Za-z0-9._-]{1,40}$/);
  });
  it("says in plain words what is counted, what never is, for how long, and that the agreement can be withdrawn", () => {
    const all = ACTIVITY_NOTICE.join(" ");
    expect(all).toMatch(/which screens your staff use and which actions they take/);
    expect(all).toMatch(/screens members open in the app/);
    expect(all).toMatch(/never keeps what anyone types: no names, amounts, notes or searches/);
    expect(all).toMatch(/Nothing is noted about anyone under 18/);
    expect(all).toMatch(/kept for 400 days/);
    expect(all).toMatch(/Members can switch this off for themselves/);
    expect(all).toMatch(/withdraw your agreement at any time/);
  });
  it("asks about sharing with Weaver staff in the owner's words", () => {
    expect(SHARE_LABEL).toBe("Also let Weaver staff see counts of how communities use Weaver (no names, no content)");
  });
});

describe("the agreement as the community's rules hold it", () => {
  it("is not agreed, and not recording, when nothing is set", () => {
    for (const rules of [null, undefined, {}, { activity: null }, { activity: {} }, { activity: "yes" }]) {
      expect(consentFromRules(rules)).toEqual({ recording: false, agreed: false, at: null, version: null, share: false, withdrawnAt: null });
    }
  });
  it("is agreed when a consent record with a date exists", () => {
    expect(consentFromRules(AGREED)).toEqual({ recording: true, agreed: true, at: "2026-10-11T15:04:00.123456Z", version: "1", share: false, withdrawnAt: null });
    expect(consentFromRules(SHARING).share).toBe(true);
  });
  it("is not agreed on a flag alone: recording without a consent record, or sharing without one", () => {
    expect(consentFromRules({ activity: { enabled: true } })).toMatchObject({ recording: true, agreed: false, share: false });
    expect(consentFromRules({ activity: { enabled: true, share_with_weaver: true } })).toMatchObject({ agreed: false, share: false });
    expect(consentFromRules({ activity: { consent: { at: "" } } }).agreed).toBe(false);
  });
  it("only a boolean true counts, not the word", () => {
    expect(consentFromRules({ activity: { enabled: "true", consent: { at: "2026-10-11T15:04:00Z" } } }).recording).toBe(false);
    expect(consentFromRules({ activity: { share_with_weaver: "true", consent: { at: "2026-10-11T15:04:00Z" } } }).share).toBe(false);
  });
  it("remembers a withdrawal until the community agrees again", () => {
    expect(consentFromRules(WITHDRAWN)).toMatchObject({ agreed: false, recording: false, withdrawnAt: "2026-10-12T09:00:00Z" });
    expect(consentFromRules({ activity: { ...AGREED.activity, withdrawn: { at: "2026-10-01T00:00:00Z" } } }).withdrawnAt).toBeNull();
  });
});

describe("the agreement as activity_status tells it", () => {
  const status = { enabled: true, opted_out: false, eligible: true, member: false, portal: true, consented: true, consent: { at: "2026-10-11T15:04:00Z", version: "1" }, share_with_weaver: true };
  it("takes the answer for someone with settings.manage", () => {
    expect(consentFromStatus(status, {})).toEqual({ recording: true, agreed: true, at: "2026-10-11T15:04:00Z", version: "1", share: true, withdrawnAt: null });
    expect(consentFromStatus({ ...status, consented: false, consent: null, share_with_weaver: false, enabled: false }, WITHDRAWN)).toEqual({
      recording: false,
      agreed: false,
      at: null,
      version: null,
      share: false,
      withdrawnAt: "2026-10-12T09:00:00Z",
    });
  });
  it("falls back to the rules when the answer has no agreement in it (Weaver staff)", () => {
    const weaver = { enabled: true, opted_out: false, eligible: false, member: false, portal: false };
    expect(consentFromStatus(weaver, SHARING)).toMatchObject({ recording: true, agreed: true, share: true });
    expect(consentFromStatus(null, AGREED)).toMatchObject({ agreed: true, share: false });
  });
  it("never shows sharing for a community that has not agreed", () => {
    expect(consentFromStatus({ ...status, consented: false, share_with_weaver: true }, {}).share).toBe(false);
  });
});

describe("what Weaver may see", () => {
  it("is a community only when recording is on, agreed, and shared (the same yes as the database)", () => {
    expect(sharedWithWeaver(SHARING)).toBe(true);
    expect(sharedWithWeaver(AGREED)).toBe(false);
    expect(sharedWithWeaver({ activity: { ...SHARING.activity, enabled: false } })).toBe(false);
    expect(sharedWithWeaver({ activity: { enabled: true, share_with_weaver: true } })).toBe(false);
    expect(sharedWithWeaver({})).toBe(false);
  });
  it("counts the communities included", () => {
    expect(countSharingCommunities([{ rules: SHARING }, { rules: AGREED }, { rules: {} }, { rules: SHARING }, { rules: WITHDRAWN }])).toBe(2);
    expect(countSharingCommunities([])).toBe(0);
  });
  it("lets Weaver switch recording on only while the community's agreement stands", () => {
    expect(weaverCanSwitchOn(consentFromRules(AGREED))).toEqual({ ok: true });
    const blocked = weaverCanSwitchOn(consentFromRules({}));
    expect(blocked).toMatchObject({ ok: false });
    expect((blocked as { reason: string }).reason).toMatch(/administrator has not agreed yet/);
    expect(weaverCanSwitchOn(consentFromRules(WITHDRAWN)).ok).toBe(false);
  });
});

describe("the words for the state", () => {
  it("says Not agreed, or Agreed on a date with the notice version", () => {
    expect(agreementText(consentFromRules({}), "America/Chicago")).toBe("Not agreed");
    expect(agreementText(consentFromRules(AGREED), "America/Chicago")).toBe("Agreed on Oct 11, 2026 (notice v1)");
  });
  it("says when an agreement was withdrawn, only while it is not agreed again", () => {
    expect(withdrawnText(consentFromRules(WITHDRAWN), "America/Chicago")).toBe("Your agreement was withdrawn on Oct 12, 2026.");
    expect(withdrawnText(consentFromRules(AGREED), "America/Chicago")).toBeNull();
    expect(withdrawnText(consentFromRules({}), "America/Chicago")).toBeNull();
  });
});
