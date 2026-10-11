import { dbWithReason } from "@/lib/session";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview, type PreviewLine } from "../../types";
import { must } from "../db";

import { peopleMoveLines, previewMergePeople } from "./merge-preview";
import { cardsFor, loadPersonBrief, refuseChildForAssistant } from "./shared";

/** The profile fields a merge may copy from the duplicate (the same list as the database function). */
const TAKE_FIELDS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  preferred_name: "Preferred name",
  date_of_birth: "Date of birth",
  gender: "Gender",
  email: "Email",
  phone_e164: "Mobile",
  profession: "Profession",
  employer: "Employer",
};

const input = object({
  keep_id: f.uuid("The record to keep (its id). If only one of the two signs in to the app, keep that one."),
  drop_id: f.uuid("The duplicate record that is merged away (its id)."),
  take: f.optional(f.string(`Fields to copy from the duplicate onto the kept record, separated by commas. Any of: ${Object.keys(TAKE_FIELDS).join(", ")}. Optional.`, { min: 0, max: 400 })),
  reason: f.optional(f.string("Why they are the same person. Optional; kept in the audit log.", { min: 0, max: 1000 })),
});
export type MergePeopleInput = Infer<typeof input>;

function plan(inp: MergePeopleInput) {
  const take = (inp.take ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const reason = (inp.reason ?? "").trim().slice(0, 500);
  return { keep: inp.keep_id, drop: inp.drop_id, take, reason };
}

const compare = (v: unknown): string => String(v ?? "").trim().toLowerCase();

async function checkBoth(ctx: CommandContext, keep: string, drop: string) {
  const [k, d] = await Promise.all([loadPersonBrief(ctx, keep), loadPersonBrief(ctx, drop)]);
  if (!k || !d) throw new CommandError("Could not merge the two records — one of the two records was not found, or you can't see it.");
  refuseChildForAssistant(ctx, k);
  refuseChildForAssistant(ctx, d);
  return { k, d };
}

export const mergePeople = defineCommand<MergePeopleInput, undefined>({
  key: "people.merge_people",
  title: "Merge two records of the same person",
  description:
    "Merge a duplicate record of one person into the record to keep: household links, identifiers and memberships move to the kept record and the duplicate is marked as merged. " +
    "It asks the person to confirm first and shows both records side by side, with their households and what would move. There is no undo. " +
    "Use people.suggest_duplicates to find pairs. If only one record signs in to the app, that one must be kept. Niva does not merge children's records.",
  level: "confirm",
  permission: "householdsEdit",
  module: "people",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/people/actions.ts#mergePeopleAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const p = plan(inp);
    const { k, d } = await checkBoth(ctx, p.keep, p.drop);
    const pv = await previewMergePeople(ctx, p.keep, p.drop, p.take);
    if (!pv.canMerge) throw new CommandError(`Could not merge the two records — ${pv.blockers[0] ?? "the database would refuse it"}.`);
    const cols = Object.keys(TAKE_FIELDS).join(", ");
    const rows = must(await ctx.session.db.from("people").select(`id, ${cols}`).in("id", [p.keep, p.drop]), "read the two records") as unknown as Record<string, unknown>[] | null;
    const kr = (rows ?? []).find((r) => r.id === p.keep);
    const dr = (rows ?? []).find((r) => r.id === p.drop);
    const fieldLines: PreviewLine[] = [];
    for (const [key, label] of Object.entries(TAKE_FIELDS)) {
      if (!kr || !dr || compare(kr[key]) === compare(dr[key])) continue;
      if (p.take.includes(key)) fieldLines.push({ label, before: String(kr[key] ?? "") || null, after: String(dr[key] ?? "") || null });
      else if (compare(dr[key])) fieldLines.push({ label: `${label} (not copied)`, value: `the kept record has ${String(kr[key] ?? "").trim() ? `“${String(kr[key])}”` : "nothing"}; the duplicate has “${String(dr[key])}”` });
    }
    const cards = await cardsFor(ctx, [...k.links, ...d.links].map((l) => l.household_id));
    return {
      summary: `Merge the duplicate ${d.name} (${d.memberNumber ? `member number ${d.memberNumber}` : "no member number"}) into ${k.name} (${k.memberNumber ? `member number ${k.memberNumber}` : "no member number"}).`,
      lines: [
        { label: "Keeps", value: `${k.name}${k.memberNumber ? ` · member number ${k.memberNumber}` : ""}` },
        { label: "Merged away", value: `${d.name}${d.memberNumber ? ` · member number ${d.memberNumber}` : ""}` },
        ...peopleMoveLines(pv.moves),
        ...fieldLines,
      ],
      households: cards,
      warnings: ["There is no undo for a merge. The duplicate stays in the history, marked as merged into the kept record."],
    };
  },
  confirmText: () => "Yes, merge these two records",
  async execute(ctx, inp) {
    const p = plan(inp);
    // D2: the check is for Niva; the screen is the person's own hands.
    if (ctx.via === "assistant") await checkBoth(ctx, p.keep, p.drop);
    // Without a reason the database function records its own ("Merged duplicate person …").
    const writer = p.reason ? await dbWithReason(ctx.session, p.reason) : ctx.session.db;
    const res = await writer.rpc("merge_people", { p_keep: p.keep, p_drop: p.drop, p_take: p.take });
    if (res.error) throw new CommandDbError(res.error, "merge the two records");
    revalidateAfterCommand(["/people", "/households", "/", `/people/${p.keep}`, `/people/${p.drop}`, "/people/merge"]);
    return { ok: true, data: undefined, message: `Records merged${p.take.length ? ` (${p.take.length} field${p.take.length === 1 ? "" : "s"} taken from the duplicate)` : ""} · audit logged` };
  },
});
