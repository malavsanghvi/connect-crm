import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ dbWithReason: vi.fn() }));

import { addPerson } from "@/lib/commands/catalog/people/add-person";
import { decideApplication } from "@/lib/commands/catalog/people/decide-application";
import { decideHouseholdRequest } from "@/lib/commands/catalog/people/decide-request";
import { mergeHouseholds } from "@/lib/commands/catalog/people/merge-households";
import { mergePeople } from "@/lib/commands/catalog/people/merge-people";
import { movePerson } from "@/lib/commands/catalog/people/move-person";
import { updateHousehold } from "@/lib/commands/catalog/people/update-household";
import { updatePerson } from "@/lib/commands/catalog/people/update-person";
import { confirmProposal, runCommand } from "@/lib/commands/run";
import { type CommandNeedsConfirmation, type CommandRunResult, type CommandVia } from "@/lib/commands/types";
import { dbWithReason } from "@/lib/session";

import { fakeSession } from "./helpers";
import { ID, MERGE_HOUSEHOLDS_PREVIEW, MERGE_PEOPLE_PREVIEW, peopleContext, peopleDb, switchedOn } from "./people-fixture";

const CHANGES = [
  "people.add_person",
  "people.update_person",
  "people.move_person",
  "people.update_household",
  "people.merge_people",
  "people.merge_households",
  "people.dismiss_duplicate",
  "people.decide_application",
  "people.decide_household_request",
];
const CHILD_WORDS = /Zoya|Aarav|2018-05-05|\bDev\b/;
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function world(opts: { via?: CommandVia; on?: boolean; permissions?: string[]; rpc?: Record<string, unknown> } = {}) {
  const { db, tables } = peopleDb({ rpc: opts.rpc });
  vi.mocked(dbWithReason).mockResolvedValue(db as never);
  const rules = opts.on === false ? {} : switchedOn(CHANGES);
  const ctx = peopleContext({ via: opts.via ?? "assistant", db, permissions: opts.permissions, session: { center: { ...fakeSession().center, rules } } });
  return { db, tables, ctx };
}

function proposed(r: CommandRunResult): CommandNeedsConfirmation {
  if (!r.ok || !r.needsConfirmation) throw new Error(`expected a proposal, got ${JSON.stringify(r)}`);
  return r;
}
const failed = (r: CommandRunResult): string => {
  if (r.ok) throw new Error(`expected a failure, got ${JSON.stringify(r)}`);
  return r.error;
};

/** Propose, then confirm. Returns both answers. */
async function propose(ctx: ReturnType<typeof world>["ctx"], key: string, input: Record<string, unknown>) {
  const p = proposed(await runCommand(ctx, key, input));
  return { p, confirm: () => confirmProposal(ctx, p.proposalId, p.inputHash) };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(dbWithReason).mockReset();
});

describe("every change", () => {
  it("is off for Niva until the community switches it on, with a plain sentence", async () => {
    const { ctx } = world({ on: false });
    for (const key of CHANGES) {
      const r = await runCommand(ctx, key, {});
      expect(r).toMatchObject({ ok: false, code: "switched_off" });
      expect(failed(r)).toMatch(/not set up to .* for Jain Society yet/);
    }
  });

  it("needs the permission the screen needs", async () => {
    const { ctx } = world({ permissions: ["people.view"] });
    for (const key of CHANGES) expect(await runCommand(ctx, key, {})).toMatchObject({ ok: false, code: "no_access" });
  });

  it("asks for a confirmation and changes nothing until it is given", async () => {
    const { ctx, db } = world();
    const { p } = await propose(ctx, "people.move_person", { person_id: ID.rahul, from_household_id: ID.hhShah, to_household_id: ID.hhPatel, role: "parent" });
    expect(p.confirmText).toMatch(/^Yes, move Rahul Shah/);
    expect(db.rpcCalls.some((c) => c.fn === "move_person_household")).toBe(false);
  });
});

describe("people.add_person", () => {
  const input = { household_id: ID.hhShah, first_name: "Meera", last_name: "Shah", role: "parent", date_of_birth: "02/02/1955", email: "Meera@Example.org", phone_e164: "(512) 555-0199" };

  it("shows the household card (adults only) and, once confirmed, adds the person", async () => {
    const { ctx, db } = world();
    const { p, confirm } = await propose(ctx, "people.add_person", input);
    expect(p.preview.summary).toBe("Add Meera Shah to the household as parent.");
    expect(p.preview.households).toHaveLength(1);
    expect(p.preview.households?.[0]).toMatchObject({ household_number: "H-1001", adults: ["Priya Shah", "Rahul Shah"] });
    expect(p.preview.warnings?.join(" ")).toMatch(/sign in to the member app/);
    expect(JSON.stringify(p)).not.toMatch(CHILD_WORDS);
    expect(p.preview.summary).not.toMatch(UUID_ANYWHERE);
    const done = await confirm();
    expect(done).toMatchObject({ ok: true, data: { personId: "b0000000-0000-4000-8000-0000000000aa" } });
    expect(db.rpcCalls.find((c) => c.fn === "staff_add_person")?.args).toEqual({
      p_household: ID.hhShah,
      p_first: "Meera",
      p_last: "Shah",
      p_role: "parent",
      p_dob: "1955-02-02",
      p_gender: undefined,
      p_email: "meera@example.org",
      p_phone: "+15125550199",
    });
    if (done.ok) expect(done.message).toMatch(/Meera Shah added to the household · audit logged\. They can sign in/);
  });

  it("is never used by Niva for a child, whatever way the child is described", async () => {
    const { ctx } = world();
    for (const extra of [{ role: "child" }, { role: "other", date_of_birth: "01/01/2015" }, { role: "sibling", date_of_birth: undefined }]) {
      const r = await runCommand(ctx, "people.add_person", { ...input, date_of_birth: undefined, ...extra });
      expect(failed(r)).toMatch(/does not work with children's records/);
    }
  });

  it("is open to the person on the screen for a child, with the screen's own sentences for mistakes", async () => {
    const { ctx, db } = world({ via: "screen" });
    await addPerson.execute!(ctx, { ...input, role: "child", date_of_birth: "01/01/2015" });
    expect(db.rpcCalls.find((c) => c.fn === "staff_add_person")?.args).toMatchObject({ p_role: "child", p_dob: "2015-01-01" });
    await expect(addPerson.execute!(ctx, { ...input, first_name: " " })).rejects.toThrow("Could not add the person — first and last name are required.");
    await expect(addPerson.execute!(ctx, { ...input, role: undefined })).rejects.toThrow("Could not add the person — choose their relationship to the household.");
    await expect(addPerson.execute!(ctx, { ...input, email: "nope" })).rejects.toThrow("Could not add the person — that email address does not look right.");
    await expect(addPerson.execute!(ctx, { ...input, date_of_birth: "01/01/2999" })).rejects.toThrow("Could not add the person — the date of birth is in the future.");
  });
});

describe("people.update_person", () => {
  it("shows before and after, with the household card, and saves only what changed", async () => {
    const { ctx, tables } = world();
    const { p, confirm } = await propose(ctx, "people.update_person", { id: ID.priya, profession: "Doctor", email: "PRIYA@example.org", employer: "Acme" });
    expect(p.preview.summary).toBe("Change profession and employer for Priya Shah.");
    expect(p.preview.lines).toEqual(expect.arrayContaining([{ label: "profession", before: "Engineer", after: "Doctor" }, { label: "employer", before: null, after: "Acme" }]));
    expect(p.preview.households?.[0].household_number).toBe("H-1001");
    expect(JSON.stringify(p)).not.toMatch(CHILD_WORDS);
    const done = await confirm();
    expect(done).toMatchObject({ ok: true });
    if (done.ok) expect(done.message).toBe("Saved Priya's profile (profession and employer) · audit logged");
    expect(tables.people.find((r) => r.id === ID.priya)).toMatchObject({ profession: "Doctor", employer: "Acme", email: "priya@example.org" });
  });

  it("says when nothing would change", async () => {
    const { ctx } = world({ via: "screen" });
    const r = await updatePerson.execute!(ctx, { id: ID.priya, profession: "Engineer" });
    expect(r).toEqual({ ok: true, data: undefined, message: "No changes to save." });
  });

  it("changes a relationship in the household named", async () => {
    const { ctx, tables } = world({ via: "screen" });
    const r = await updatePerson.execute!(ctx, { id: ID.rahul, household_id: ID.hhShah, role: "parent" });
    expect(r).toMatchObject({ ok: true, message: "Saved Rahul's profile (relationship) · audit logged" });
    expect(tables.household_members.find((m) => m.person_id === ID.rahul)?.role).toBe("parent");
  });

  it("is never used by Niva on a child, on someone's own privacy choices, or to make an adult a child", async () => {
    const { ctx } = world();
    expect(failed(await runCommand(ctx, "people.update_person", { id: ID.zoya, profession: "x" }))).toMatch(/does not work with children's records/);
    expect(failed(await runCommand(ctx, "people.update_person", { id: ID.aarav, profession: "x" }))).toMatch(/does not work with children's records/);
    expect(failed(await runCommand(ctx, "people.update_person", { id: ID.priya, photo_opt_in: "on" }))).toMatch(/own to make/);
    expect(failed(await runCommand(ctx, "people.update_person", { id: ID.priya, date_of_birth: "01/01/2015" }))).toMatch(/does not work with children's records/);
  });

  it("keeps the screen's sentences for a person who is gone, merged or a bad value", async () => {
    const { ctx, tables } = world({ via: "screen" });
    await expect(updatePerson.execute!(ctx, { id: "b0000000-0000-4000-8000-0000000000ff" })).rejects.toThrow("Could not save the profile — the person was not found, or you can't see them.");
    await expect(updatePerson.execute!(ctx, { id: ID.priya, date_of_birth: "31/31/2000" })).rejects.toThrow(/^Could not save the profile — /);
    tables.people.find((r) => r.id === ID.priya)!.merged_into_id = ID.priya2;
    await expect(updatePerson.execute!(ctx, { id: ID.priya, profession: "x" })).rejects.toThrow("Could not save the profile — this record was merged into another one. Edit that one instead.");
  });
});

describe("people.move_person", () => {
  it("shows both households as cards and moves the person once confirmed", async () => {
    const { ctx, db } = world();
    const { p, confirm } = await propose(ctx, "people.move_person", { person_id: ID.rahul, from_household_id: ID.hhShah, to_household_id: ID.hhPatel, role: "parent" });
    expect(p.preview.households?.map((h) => h.household_number)).toEqual(["H-1001", "H-1002"]);
    expect(p.preview.lines.map((l) => l.label)).toEqual(["Leaves", "Joins", "Relationship there"]);
    expect(p.preview.lines[1].value).toContain("Nikhil Patel");
    expect(p.preview.warnings).toEqual(["Pledges and payments stay with the original household."]);
    expect(JSON.stringify(p)).not.toMatch(CHILD_WORDS);
    const done = await confirm();
    expect(done).toMatchObject({ ok: true });
    if (done.ok) expect(done.message).toBe("Rahul moved · pledges and payments stay with the original household · audit logged");
    expect(db.rpcCalls.find((c) => c.fn === "move_person_household")?.args).toEqual({ p_person: ID.rahul, p_from: ID.hhShah, p_to: ID.hhPatel, p_role: "parent" });
  });

  it("says before confirming what the database would refuse", async () => {
    const { ctx } = world();
    const base = { from_household_id: ID.hhShah, to_household_id: ID.hhPatel, role: "other" };
    expect(failed(await runCommand(ctx, "people.move_person", { person_id: ID.priya, ...base }))).toMatch(/primary member of the household they are leaving, which still has 2 other members/);
    expect(failed(await runCommand(ctx, "people.move_person", { person_id: ID.rahul, ...base, to_household_id: ID.hhShah }))).toMatch(/choose a different household/);
    expect(failed(await runCommand(ctx, "people.move_person", { person_id: ID.rahul, ...base, from_household_id: ID.hhPatel, to_household_id: ID.hhShah }))).toMatch(/not a current member of the household being left/);
    expect(failed(await runCommand(ctx, "people.move_person", { person_id: ID.zoya, ...base }))).toMatch(/does not work with children's records/);
  });

  it("keeps the screen's sentences for an unfinished form", async () => {
    const { ctx } = world({ via: "screen" });
    await expect(movePerson.execute!(ctx, { person_id: ID.rahul, from_household_id: ID.hhShah })).rejects.toThrow("Could not move — choose the household to move to first.");
  });
});

describe("people.update_household", () => {
  it("shows the card and before and after, and saves only what changed", async () => {
    const { ctx, tables } = world();
    const { p, confirm } = await propose(ctx, "people.update_household", { id: ID.hhShah, city: "Round Rock", postal_code: "78664" });
    expect(p.preview.summary).toBe("Change the city and ZIP code of this household.");
    expect(p.preview.lines).toEqual(expect.arrayContaining([{ label: "city", before: "Austin", after: "Round Rock" }]));
    expect(p.preview.households?.[0].household_number).toBe("H-1001");
    expect(JSON.stringify(p)).not.toMatch(CHILD_WORDS);
    expect((await confirm()).ok).toBe(true);
    expect(tables.households.find((h) => h.id === ID.hhShah)).toMatchObject({ city: "Round Rock", postal_code: "78664" });
  });

  it("leaves the tier and the household's privacy choices to the screen", async () => {
    const { ctx } = world();
    expect(failed(await runCommand(ctx, "people.update_household", { id: ID.hhShah, tier: "life", tier_reason: "paid" }))).toMatch(/does not change membership tiers/);
    expect(failed(await runCommand(ctx, "people.update_household", { id: ID.hhShah, directory_opt_in: "on" }))).toMatch(/own to make/);
  });

  it("keeps the screen's rules for a tier change: people.approve and a reason", async () => {
    const noApprove = world({ via: "screen", permissions: ["people.view", "people.manage"] });
    await expect(updateHousehold.execute!(noApprove.ctx, { id: ID.hhShah, tier: "life", tier_reason: "paid" })).rejects.toThrow("Could not change the membership tier — tier changes need the people.approve permission.");
    const { ctx, db } = world({ via: "screen" });
    await expect(updateHousehold.execute!(ctx, { id: ID.hhShah, tier: "life" })).rejects.toThrow("Could not save — say why the membership tier is changing (it goes in the audit log).");
    const r = await updateHousehold.execute!(ctx, { id: ID.hhShah, tier: "life", tier_reason: "Life fee paid at the office" });
    expect(r).toMatchObject({ ok: true, message: "Household saved (tier to Life) · audit logged" });
    expect(vi.mocked(dbWithReason)).toHaveBeenCalledWith(expect.anything(), "Life fee paid at the office");
    expect(db.rpcCalls.find((c) => c.fn === "change_household_tier")?.args).toEqual({ p_household: ID.hhShah, p_tier: "life", p_reason: "Life fee paid at the office" });
  });

  it("explains a half-done save in words", async () => {
    const { ctx } = world({ via: "screen", rpc: { change_household_tier: undefined } });
    const { db } = peopleDb({ failRpc: { change_household_tier: { code: "P0001", message: "That household was not found, or it was merged" } } });
    vi.mocked(dbWithReason).mockResolvedValue(db as never);
    const r = await updateHousehold.execute!(ctx, { id: ID.hhShah, city: "Cedar Park", tier: "life", tier_reason: "paid" });
    expect(r).toEqual({ ok: false, error: "Could not change the membership tier — That household was not found, or it was merged. The other change was saved." });
  });
});

describe("people.merge_people", () => {
  it("shows both records, their households and what would move, then merges once confirmed", async () => {
    const { ctx, db } = world();
    const { p, confirm } = await propose(ctx, "people.merge_people", { keep_id: ID.priya, drop_id: ID.priya2, take: "phone_e164, email", reason: "Same person, new signup" });
    expect(p.preview.summary).toMatch(/^Merge the duplicate Priya Shah \(member number M-6\) into Priya Shah \(member number M-1\)\.$/);
    expect(p.preview.lines.map((l) => l.label)).toEqual(expect.arrayContaining(["Keeps", "Merged away", "Household links", "Identifiers", "Memberships", "Duplicate suggestion"]));
    expect(p.preview.lines.find((l) => l.label === "Identifiers")?.value).toMatch(/2 identifiers move/);
    expect(p.preview.households?.map((h) => h.household_number).sort()).toEqual(["H-1001", "H-1003"]);
    expect(p.preview.warnings?.[0]).toMatch(/no undo/);
    expect(JSON.stringify(p)).not.toMatch(CHILD_WORDS);
    expect(db.rpcCalls.find((c) => c.fn === "merge_people_preview")?.args).toEqual({ p_keep: ID.priya, p_drop: ID.priya2, p_take: ["phone_e164", "email"] });
    const done = await confirm();
    expect(done).toMatchObject({ ok: true });
    if (done.ok) expect(done.message).toBe("Records merged (2 fields taken from the duplicate) · audit logged");
    expect(db.rpcCalls.find((c) => c.fn === "merge_people")?.args).toEqual({ p_keep: ID.priya, p_drop: ID.priya2, p_take: ["phone_e164", "email"] });
    expect(vi.mocked(dbWithReason)).toHaveBeenCalledWith(expect.anything(), "Same person, new signup");
  });

  it("is refused before the card when the database would refuse it, in the database's own words", async () => {
    const blocked = { ...MERGE_PEOPLE_PREVIEW, can_merge: false, blockers: ["The duplicate signs in to the app. Keep that record instead (swap which record is kept)"] };
    const { ctx } = world({ rpc: { merge_people_preview: blocked } });
    expect(failed(await runCommand(ctx, "people.merge_people", { keep_id: ID.priya2, drop_id: ID.priya }))).toBe(
      "Could not merge the two records — The duplicate signs in to the app. Keep that record instead (swap which record is kept).",
    );
  });

  it("is never used by Niva on a child's records, and shows no child through a household", async () => {
    const { ctx } = world();
    expect(failed(await runCommand(ctx, "people.merge_people", { keep_id: ID.zoya, drop_id: ID.aarav }))).toMatch(/does not work with children's records/);
    expect(failed(await runCommand(ctx, "people.merge_people", { keep_id: ID.priya, drop_id: ID.aarav }))).toMatch(/does not work with children's records/);
  });

  it("shows differences between the two records, and which would be copied", async () => {
    const { ctx } = world({ via: "palette" });
    const r = proposed(await runCommand(ctx, "people.merge_people", { keep_id: ID.priya, drop_id: ID.priya2, take: "gender" }));
    expect(r.preview.lines.some((l) => l.label === "Gender" && l.before === "female")).toBe(true);
  });
});

describe("people.merge_households", () => {
  it("shows both cards and what stays on the duplicate, then merges once confirmed", async () => {
    const { ctx, db } = world();
    const { p, confirm } = await propose(ctx, "people.merge_households", { keep_id: ID.hhShah, drop_id: ID.hhShah2 });
    expect(p.preview.households?.map((h) => h.household_number)).toEqual(["H-1001", "H-1003"]);
    expect(p.preview.summary).toContain("H-1003");
    expect(p.preview.summary).toContain("H-1001");
    expect(p.preview.lines.find((l) => l.label === "Stays on the duplicate")?.value).toMatch(/1 household identifier, 0 active memberships, and its giving history/);
    expect(p.preview.lines.find((l) => l.label === "Primary member")).toBeDefined();
    expect(JSON.stringify(p)).not.toMatch(CHILD_WORDS);
    const done = await confirm();
    expect(done).toMatchObject({ ok: true, message: "Households merged · members moved · the duplicate's giving history stays on it · audit logged" });
    expect(db.rpcCalls.find((c) => c.fn === "merge_households")?.args).toEqual({ p_keep: ID.hhShah, p_drop: ID.hhShah2 });
    expect(vi.mocked(dbWithReason)).not.toHaveBeenCalled();
  });

  it("is refused before the card when the database would refuse it", async () => {
    const blocked = { ...MERGE_HOUSEHOLDS_PREVIEW, can_merge: false, blockers: ["One of the two households was already merged"] };
    const { ctx } = world({ rpc: { merge_households_preview: blocked } });
    expect(failed(await runCommand(ctx, "people.merge_households", { keep_id: ID.hhShah, drop_id: ID.hhShah2 }))).toBe("Could not merge the households — One of the two households was already merged.");
  });
});

describe("people.dismiss_duplicate", () => {
  it("shows the pair and records that it is not a duplicate", async () => {
    const { ctx, tables } = world();
    const { p, confirm } = await propose(ctx, "people.dismiss_duplicate", { candidate_id: ID.candPerson });
    expect(p.preview.summary).toBe("Mark Priya Shah and Priya Shah as two different people.");
    expect(p.preview.lines.map((l) => l.value)).toEqual(["Priya Shah · member number M-1", "Priya Shah · member number M-6"]);
    expect(p.preview.households).toHaveLength(2);
    const done = await confirm();
    expect(done).toMatchObject({ ok: true, message: "Marked as not a duplicate" });
    expect(tables.merge_candidates.find((c) => c.id === ID.candPerson)).toMatchObject({ status: "dismissed", resolved_by: "user-1" });
    expect(failed(await runCommand(ctx, "people.dismiss_duplicate", { candidate_id: ID.candPerson }))).toMatch(/already resolved/);
  });

  it("is never used by Niva on a pair of children", async () => {
    const { ctx } = world();
    expect(failed(await runCommand(ctx, "people.dismiss_duplicate", { candidate_id: ID.candChildren }))).toMatch(/does not work with children's records/);
  });

  it("shows two households as cards", async () => {
    const { ctx } = world();
    const { p } = await propose(ctx, "people.dismiss_duplicate", { candidate_id: ID.candHousehold });
    expect(p.preview.households?.map((h) => h.household_number)).toEqual(["H-1001", "H-1003"]);
  });
});

describe("people.decide_application", () => {
  it("shows the application with its checks and the fee in dollars, then records the decision", async () => {
    const { ctx, tables } = world();
    const { p, confirm } = await propose(ctx, "people.decide_application", { id: ID.app, decision: "approve" });
    expect(p.preview.summary).toBe("Approve Nikhil Patel's Yearly membership. It becomes active now and the $50.00 fee is recorded as an open pledge.");
    expect(p.preview.households?.[0].household_number).toBe("H-1002");
    const lines = Object.fromEntries(p.preview.lines.map((l) => [l.label, l.value]));
    expect(lines["Reference"]).toBe("Rahul Shah · answered: approved");
    expect(lines["Reference's membership"]).toMatch(/Yearly \(needs Community or higher\): passes/);
    expect(lines["Reference's household"]).toBe("outside the applicant's household");
    expect(lines["Fee"]).toBe("$50.00");
    expect(JSON.stringify(p)).not.toMatch(CHILD_WORDS);
    const done = await confirm();
    expect(done).toMatchObject({ ok: true });
    expect(tables.membership_applications[0]).toMatchObject({ status: "approved", center_decided_by: "user-1" });
  });

  it("sends a life application to the Executive Committee and says so", async () => {
    const { ctx, tables } = world();
    tables.membership_applications[0].tier = "life";
    const { p } = await propose(ctx, "people.decide_application", { id: ID.app, decision: "approve" });
    expect(p.preview.summary).toMatch(/^Record the center review for Nikhil Patel's Life application\. It then waits for Executive Committee approval\.$/);
  });

  it("needs a reason to decline, and says why a decision cannot be made", async () => {
    const { ctx, tables } = world();
    expect(failed(await runCommand(ctx, "people.decide_application", { id: ID.app, decision: "reject" }))).toBe("Could not decline the application — give a reason (it is kept for the applicant's record).");
    const { p, confirm } = await propose(ctx, "people.decide_application", { id: ID.app, decision: "reject", reason: "Not a resident" });
    expect(p.confirmText).toBe("Yes, decline this application");
    const done = await confirm();
    expect(done).toMatchObject({ ok: true, message: "Declined. The reason is saved with the application." });
    expect(vi.mocked(dbWithReason)).toHaveBeenCalledWith(expect.anything(), "Not a resident");
    expect(tables.membership_applications[0]).toMatchObject({ status: "rejected", center_reason: "Not a resident" });
    expect(failed(await runCommand(ctx, "people.decide_application", { id: ID.app, decision: "approve" }))).toBe("Could not approve the application — the application is already rejected.");
  });

  it("keeps the decision's own sentences on the screen", async () => {
    const { ctx, tables } = world({ via: "screen" });
    tables.membership_applications[0].status = "awaiting_reference";
    await expect(decideApplication.execute!(ctx, { id: ID.app, decision: "approve" })).rejects.toThrow("Could not approve the application — the named reference has not approved it yet.");
  });
});

describe("people.decide_household_request", () => {
  it("shows the household card and what is asked, then records the decision", async () => {
    const { ctx, db } = world();
    expect(failed(await runCommand(ctx, "people.decide_household_request", { id: ID.reqAdult, decision: "approve" }))).toBe("Could not approve the request — choose their relationship to the household first.");
    const { p, confirm } = await propose(ctx, "people.decide_household_request", { id: ID.reqAdult, decision: "approve", role: "parent" });
    expect(p.preview.summary).toBe("Approve the request to add Meera Shah to the household as parent.");
    expect(p.preview.households?.[0].household_number).toBe("H-1001");
    expect(JSON.stringify(p)).not.toMatch(CHILD_WORDS);
    const done = await confirm();
    expect(done).toMatchObject({ ok: true, message: "Request approved — they're now in the household · audit logged" });
    expect(db.rpcCalls.find((c) => c.fn === "decide_household_change_request")?.args).toEqual({ p_request: ID.reqAdult, p_decision: "approve", p_role: "parent" });
    expect(vi.mocked(dbWithReason)).toHaveBeenCalledWith(expect.anything(), "Family change request approved");
  });

  it("needs a reason to decline", async () => {
    const { ctx, db } = world();
    expect(failed(await runCommand(ctx, "people.decide_household_request", { id: ID.reqAdult, decision: "reject" }))).toBe("Could not decline the request — give a reason (it is kept for the household's record).");
    const { confirm } = await propose(ctx, "people.decide_household_request", { id: ID.reqAdult, decision: "reject", reason: "Not a relative" });
    expect(await confirm()).toMatchObject({ ok: true, message: "Request declined · audit logged" });
    expect(db.rpcCalls.find((c) => c.fn === "decide_household_change_request")?.args).toEqual({ p_request: ID.reqAdult, p_decision: "reject", p_reason: "Not a relative" });
  });

  it("is never used by Niva on a request about a child", async () => {
    const { ctx } = world();
    const r = await runCommand(ctx, "people.decide_household_request", { id: ID.reqChild, decision: "reject", reason: "no" });
    expect(failed(r)).toMatch(/does not work with children's records/);
    expect(JSON.stringify(r)).not.toMatch(CHILD_WORDS);
  });

  it("is open to the person on the screen for any request", async () => {
    const { ctx, db } = world({ via: "screen" });
    const r = await decideHouseholdRequest.execute!(ctx, { id: ID.reqChild, decision: "approve", role: "child" });
    expect(r).toMatchObject({ ok: true });
    expect(db.rpcCalls.find((c) => c.fn === "decide_household_change_request")?.args).toMatchObject({ p_role: "child" });
  });
});

describe("a failed step", () => {
  it("is explained in plain words, logged, and never shown as done", async () => {
    const { ctx } = world({ rpc: {} });
    const { db } = peopleDb({ failRpc: { move_person_household: { code: "P0001", message: "That person is not a current member of the household being left" } } });
    ctx.session.db = db as never;
    const { confirm } = await propose(ctx, "people.move_person", { person_id: ID.rahul, from_household_id: ID.hhShah, to_household_id: ID.hhPatel, role: "other" });
    const r = await confirm();
    expect(r).toMatchObject({ ok: false });
    expect(failed(r)).toBe("Could not move Rahul — That person is not a current member of the household being left.");
  });

});

describe("merges are described", () => {
  it("never describe a merge in terms that do not name the two records", () => {
    for (const c of [mergePeople, mergeHouseholds]) expect(c.description).toMatch(/There is no undo/);
  });
});
