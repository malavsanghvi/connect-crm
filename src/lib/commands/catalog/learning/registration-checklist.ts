import { schoolOrGeneric } from "@/lib/kind-samples";
import { isPathshalaFund, missingFeeNames, openChecklist, type CheckItem } from "@/lib/pathshala-registration/fees";
import { feeEditing } from "@/lib/pathshala-registration/rules";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";

import { groupsFor, loadSetup, rulesOf, school } from "./setup";

const input = object({
  term_id: f.optional(f.uuid("One term (its id, from learning.term_setup). Leave it out to check every term whose fees are not locked yet.")),
});

const WORD: Record<CheckItem["tone"], "missing" | "check" | "ready" | "note"> = { bad: "missing", warn: "check", ok: "ready", info: "note" };

export type ChecklistItem = { status: "missing" | "check" | "ready" | "note"; text: string };

export type TermChecklist = {
  term_id: string;
  name: string;
  /** Registration has already opened (fees and rules locked): there is nothing left to open. */
  already_open: boolean;
  /** Nothing is missing: the Pathshala principal can open registration now. */
  ready_to_open: boolean;
  items: ChecklistItem[];
  who_opens_it: string;
  where: { label: string; href: string };
};

export type RegistrationChecklistData = { terms: TermChecklist[] };

/** What a term still needs before registration can open, in plain words; the same list as the Fees and rules screen. */
export const registrationChecklist = defineCommand<Infer<typeof input>, RegistrationChecklistData>({
  key: "learning.registration_checklist",
  title: "Check what is missing before registration opens",
  description: (kind) => {
    const schoolName = schoolOrGeneric(kind);
    return (
      `List what a ${schoolName} term still needs before registration can open: a fee for every level that has a class, a way for families to pay that works, a fund for the fee pledges, age bands, the registration dates. ` +
      `Each line says missing (the database will refuse until it is fixed), check (worth a look) or ready. Leave term_id out to check every term whose fees are not locked yet. ` +
      `Niva never opens registration: the ${schoolName} principal does that on the term's Fees and rules page. It is about the term's setup only and never shows a learner or a registration. It changes nothing.`
    );
  },
  level: "read",
  permission: "pathshalaFees",
  module: "pathshala",
  input,
  async execute(ctx, inp) {
    const world = await loadSetup(ctx, { termId: inp.term_id, readiness: true });
    const tz = ctx.session.center.time_zone;
    const picked = inp.term_id ? world.terms : world.terms.filter((t) => rulesOf(world, t).fees_locked_at === null);
    const terms = picked.map((term): TermChecklist => {
      const rules = rulesOf(world, term);
      const editing = feeEditing(ctx.session, { status: term.status, fees_locked_at: rules.fees_locked_at });
      const groups = groupsFor(world, term);
      const items: ChecklistItem[] = openChecklist({
        groups,
        paymentMode: rules.payment_mode,
        payNowBlocked: world.payNowBlocked,
        givingOn: world.givingOn,
        fundFound: world.funds === null ? null : rules.fund_id !== null || world.funds.some(isPathshalaFund),
        membershipRequired: term.membership_required,
        registrationOpensAt: term.registration_opens_at,
        registrationClosesAt: term.registration_closes_at,
        tz,
      }).map((i) => ({ status: WORD[i.tone], text: i.text }));
      const alreadyOpen = rules.fees_locked_at !== null;
      return {
        term_id: term.id,
        name: term.name,
        already_open: alreadyOpen,
        ready_to_open: !alreadyOpen && !editing.closed && missingFeeNames(groups).length === 0 && !items.some((i) => i.status === "missing"),
        items: alreadyOpen ? [{ status: "note", text: "Registration has already opened for this term. Its fees and rules are locked; only the treasurer can change them, with a reason." }] : items,
        who_opens_it: `Only the ${school(ctx)} principal (pathshala.manage) opens registration, on the term's Fees and rules page. Niva does not.`,
        where: { label: `${school(ctx)} › Terms › ${term.name} › Fees and rules`, href: `/pathshala/terms/${term.id}/fees` },
      };
    });
    const ready = terms.filter((t) => t.ready_to_open);
    const blocked = terms.filter((t) => !t.already_open && !t.ready_to_open);
    return {
      ok: true,
      data: { terms },
      message:
        terms.length === 0
          ? "Every term's registration has already opened, or there is no term yet."
          : `${ready.length} term${ready.length === 1 ? " is" : "s are"} ready to open${blocked.length ? `; ${blocked.map((t) => t.name).join(", ")} still ${blocked.length === 1 ? "has" : "have"} something missing` : ""}.`,
    };
  },
});
