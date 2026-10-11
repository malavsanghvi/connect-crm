// Change what a term charges for its levels (Pathshala › Terms › Fees and rules › Save fees). THIS IS A MONEY RULE: it is a confirm
// command, off for Niva until the community switches it on, and the owner has to approve it before it is merged (NEEDS OWNER OK).
// The screen's Save fees button runs this very `execute` (through runCommandFromScreen), with the sentences it has always given.

import { changedFees, savedFeesSentence } from "@/lib/pathshala-registration/fees";
import { feeEditing, type FeeEditing } from "@/lib/pathshala-registration/rules";
import { feeLabel, parseFeeInput } from "@/lib/pathshala-registration/money";
import { loadLevelFees, loadLevelRows, loadTermRules, NEEDS_UPDATE, setLevelFees } from "@/lib/pathshala-registration/db";
import type { LevelFeeInput } from "@/lib/pathshala-registration/contract";
import { refusal } from "@/lib/pathshala-registration/refusal";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview } from "../../types";
import { must } from "../db";

import { NO_TERM } from "./setup";

const input = object({
  term_id: f.uuid("The term whose fees change (its id, from learning.term_setup)."),
  level_id: f.optional(f.uuid("The level whose fee changes (its id, from learning.term_setup). Use this with fee for one level.")),
  fee: f.optional(f.string("The new fee for that level in dollars: '130', '130.50' or 'Free'.", { max: 40 })),
  fees: f.optional(f.string("Several levels at once, as a JSON list like [{\"level_id\":\"…\",\"fee\":\"45.00\"}]. Leave it out when you give level_id and fee for one level.", { max: 30000 })),
  reason: f.optional(f.string("Why the fee changes, in a sentence. It is kept in the audit log, and it is required once registration has opened.", { max: 500 })),
});
export type SetLevelFeesInput = Infer<typeof input>;

const REASON_NEEDED = "Registration is open: say why the fees change. The reason is kept in the audit log.";

type Entered = { levelId: string; raw: string }[];

/** The fees asked for, as (level, what was typed) in the order given. The screen sends every box of the form, blank ones included. */
function enteredFees(inp: SetLevelFeesInput): Entered {
  if (inp.fees !== undefined) {
    if (inp.level_id !== undefined || inp.fee !== undefined) throw new CommandError("Give either level_id and fee for one level, or fees for several, not both.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(inp.fees);
    } catch {
      throw new CommandError('The fees could not be read. Give them as a list like [{"level_id":"…","fee":"45.00"}].');
    }
    if (!Array.isArray(parsed)) throw new CommandError('The fees could not be read. Give them as a list like [{"level_id":"…","fee":"45.00"}].');
    return parsed.map((x) => {
      const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
      if (typeof o.level_id !== "string") throw new CommandError("Each fee needs a level_id.");
      return { levelId: o.level_id, raw: typeof o.fee === "string" ? o.fee : "" };
    });
  }
  if (inp.level_id === undefined || inp.fee === undefined) throw new CommandError("Say which level and its new fee (level_id and fee).");
  return [{ levelId: inp.level_id, raw: inp.fee }];
}

type Plan = {
  term: { id: string; name: string };
  editing: FeeEditing;
  currency: string;
  names: Map<string, string>;
  saved: Map<string, number>;
  changes: LevelFeeInput[];
};

/** The term, who may change its fees now, and the fees that really differ from what is saved. The same checks, in the same order and words, as the Save fees button always made. */
async function plan(ctx: CommandContext, inp: SetLevelFeesInput): Promise<Plan> {
  const { db, center } = ctx.session;
  const screen = ctx.via === "screen";
  const term = must(await db.from("pathshala_terms").select("id, name, status, starts_on, ends_on, registration_closes_at").eq("id", inp.term_id).maybeSingle(), "find the term") as {
    id: string;
    name: string;
    status: string;
  } | null;
  if (!term) throw new CommandError(screen ? "That term no longer exists, or it is a draft only the Pathshala principal can see. Reload the page." : NO_TERM);
  const rules = await loadTermRules(db, [inp.term_id]);
  if (rules.status === "missing") throw new CommandError(NEEDS_UPDATE);
  if (rules.status === "error") throw new CommandDbError(rules.error, "read the term's rules");
  if (rules.status === "shape") throw new CommandError(`The term's rules could not be read (${rules.message}). Has the latest migration been applied?`);
  const current = rules.value.get(inp.term_id);
  if (!current) throw new CommandError("That term's rules could not be found. Reload the page.");
  const editing = feeEditing(ctx.session, { status: term.status, fees_locked_at: current.fees_locked_at });
  if (!editing.canEdit) throw new CommandError(editing.note);

  const [levels, fees] = await Promise.all([loadLevelRows(db, center.id), loadLevelFees(db, center.id)]);
  if (levels.status === "missing" || fees.status === "missing") throw new CommandError(NEEDS_UPDATE);
  if (levels.status === "error") throw new CommandDbError(levels.error, "read the levels");
  if (fees.status === "error") throw new CommandDbError(fees.error, "read the saved fees");
  if (levels.status === "shape" || fees.status === "shape") throw new CommandError("The levels or the saved fees could not be read. Has the latest migration been applied?");
  const names = new Map(levels.value.map((l) => [l.id, l.name]));
  const entered = new Map<string, number | null>();
  for (const { levelId, raw } of enteredFees(inp)) {
    const name = names.get(levelId);
    if (!name) throw new CommandError(screen ? "One of the levels on this page no longer exists. Reload the page." : "One of those levels was not found. Take the level ids from learning.term_setup.");
    const parsed = parseFeeInput(raw, name, center.currency);
    if (!parsed.ok) throw new CommandError(parsed.error);
    entered.set(levelId, parsed.cents);
  }
  const saved = new Map(fees.value.filter((x) => x.term_id === inp.term_id).map((x) => [x.level_id, x.fee_cents]));
  return { term: { id: term.id, name: term.name }, editing, currency: center.currency, names, saved, changes: changedFees(saved, entered) };
}

export const setLevelFeesCommand = defineCommand<SetLevelFeesInput, undefined>({
  key: "learning.set_level_fees",
  title: "Change the fees of Pathshala levels",
  description:
    "Change what a Pathshala term charges for one level, or several (a level fee, in dollars; 'Free' for none). It is a MONEY RULE: it shows each fee from-and-to in dollars and asks the person to confirm. " +
    "Before registration opens the principal or the treasurer may change a fee; once it has opened only the treasurer may, with a reason, and the change applies to new registrations only, never to fees already quoted or billed. " +
    "Use learning.draft_term_change first to show the change without making it. It never touches a learner or a family's registration.",
  level: "confirm",
  permission: "pathshalaFees",
  module: "pathshala",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/pathshala/terms/[id]/fees/actions.ts#saveFeesAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const p = await plan(ctx, inp);
    // Asked before the person is shown a card to confirm, so a card that would only fail is never offered.
    if (p.changes.length > 0 && p.editing.needsReason && !(inp.reason ?? "").trim()) throw new CommandError(REASON_NEEDED);
    const warnings = p.editing.locked ? ["Registration is open, so this needs a reason and applies to new registrations only: fees already quoted or billed do not change."] : [];
    if (p.changes.length === 0) {
      return { summary: `No fee changes for ${p.term.name}: every fee is as it was.`, lines: [], warnings };
    }
    return {
      summary: `Change ${p.changes.length === 1 ? "a fee" : `${p.changes.length} fees`} for ${p.term.name}.`,
      lines: p.changes.map((c) => ({
        label: `${p.names.get(c.level_id) ?? "A level"} fee`,
        before: feeLabel(p.saved.get(c.level_id) ?? null, p.currency),
        after: feeLabel(c.fee_cents, p.currency),
      })),
      warnings,
    };
  },
  confirmText: (_i, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, inp) {
    const p = await plan(ctx, inp);
    const { db } = ctx.session;
    if (!p.changes.length) return { ok: true, data: undefined, message: "Nothing to save: every fee is as it was." };
    const reason = (inp.reason ?? "").trim() || null;
    if (p.editing.needsReason && !reason) throw new CommandError(REASON_NEEDED);
    const res = await setLevelFees(db, p.term.id, p.changes, reason);
    if (!res.ok) return refusal("save the fees", res);
    revalidateAfterCommand(["/pathshala"]);
    return { ok: true, data: undefined, message: savedFeesSentence(p.changes, p.names, p.term.name, p.currency, p.editing.locked) };
  },
});
