import { contentKindLabel, contentStatusLabel } from "@/lib/content";
import { isUuid } from "@/lib/search-params";
import { dbWithReason } from "@/lib/session";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandPreview } from "../../types";
import { must } from "../db";
import { childGuard } from "../messages/shared";
import { dbFail } from "../people/shared";

const input = object({
  item_id: f.uuid("The item to take out of use (its id: content_id from content.draft_item, or item_id from content.approval_queue)."),
  kind: f.optional(f.string("Only when the item is of this kind (for example niva_source). Leave it out for any kind.", { max: 40 })),
  reason: f.optional(f.string("Why, in a sentence. It is kept in the audit log.", { max: 500 })),
});
export type ArchiveItemInput = Infer<typeof input>;
export type ArchiveItemData = { item: { id: string; title: string }; result: "retired" };

const NIVA = "niva_source";
const NAMES_A_CHILD = "This item's title names a child, so Niva will not handle it. Please retire it yourself on the Content screen.";

function wording(kind: string | undefined) {
  const source = kind === NIVA;
  return { noun: source ? "source" : "item", doing: source ? "retire the source" : "retire the item" };
}

/**
 * Take an item out of use for good (status `retired`): the existing "Retire" on Content > Niva, for any item of this community. It stays
 * in the list under "Show retired"; editing it sends it back through approval. Nothing is deleted. The screen only retires Niva
 * sources, so it passes `kind`.
 */
export const archiveItem = defineCommand<ArchiveItemInput, ArchiveItemData>({
  key: "content.archive_item",
  title: "Take a published item out of use",
  description:
    "Retire (archive) one content item of this community so members and Niva no longer use it: a Niva source, a FAQ, a recipe, an announcement. Nothing is deleted: a retired item stays in Content under 'Show retired' and can be sent back through approval. " +
    "This asks the person to confirm first and needs content.manage. Answers Niva already gave that cite a retired source stay until someone presses Regenerate on them. Not for platform-library items.",
  level: "confirm",
  permission: "contentManage",
  module: "content",
  // Off until the owner switches it on in the community's settings (assistant.tools.content.archive_item).
  enabledByDefault: false,
  covers: ["src/app/(app)/content/niva/actions.ts#retireNivaSourceAction"],
  input,
  async preview(ctx, inp): Promise<CommandPreview> {
    const { db, center } = ctx.session;
    const { noun, doing } = wording(inp.kind);
    if (!isUuid(inp.item_id)) throw new CommandError(`Could not ${doing} — no ${noun} was given. Reload the page and try again.`);
    let q = db.from("content_items").select("id, title, kind, status, center_id").eq("id", inp.item_id).eq("center_id", center.id);
    if (inp.kind) q = q.eq("kind", inp.kind);
    const row = must(await q.maybeSingle(), doing) as { id: string; title: string; kind: string; status: string } | null;
    if (!row) throw new CommandError(`Could not ${doing} — it is not one of this community's ${noun}s, or you can't see it.`);
    if (row.status === "retired") throw new CommandError(`Could not ${doing} — "${row.title}" is already retired.`);
    // D2: the card's title goes to the model, so Niva does not take an item whose title names a child.
    if ((await childGuard(ctx)).mentions(row.title)) throw new CommandError(NAMES_A_CHILD);
    const warnings =
      row.kind === NIVA
        ? ["Niva stops answering from this source. Answers that already cite it stay until someone presses Regenerate on them."]
        : ["Members no longer see this item once it is retired."];
    warnings.push("Nothing is deleted. A retired item stays under 'Show retired' and can go back through approval.");
    return {
      summary: `Take "${row.title}" (${contentKindLabel(row.kind)}) out of use.`,
      lines: [
        { label: "Title", value: row.title },
        { label: "Kind", value: contentKindLabel(row.kind) },
        { label: "Now", before: contentStatusLabel(row.status), after: "Retired" },
      ],
      warnings,
    };
  },
  confirmText: "Yes, take it out of use",
  async execute(ctx, inp) {
    const { session } = ctx;
    const { center } = session;
    const { noun, doing } = wording(inp.kind);
    const id = inp.item_id;
    if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — no ${noun} was given. Reload the page and try again.` };
    const gone = { ok: false as const, error: `Could not ${doing} — it is already retired, or it is not one of this community's ${noun}s. Reload the page to see the current list.` };
    // The title is read first: the update below only has to say whether it changed a row.
    let find = session.db.from("content_items").select("id, title, kind, status").eq("id", id).eq("center_id", center.id);
    if (inp.kind) find = find.eq("kind", inp.kind);
    const row = must(await find.maybeSingle(), doing) as { id: string; title: string; kind: string; status: string } | null;
    if (!row || row.status === "retired") return gone;
    const base = inp.reason?.trim() || (inp.kind === NIVA ? "Retired from Niva on Content › Niva" : "Retired from Content");
    const writer = await dbWithReason(session, ctx.via === "assistant" ? `${base} (asked through Niva)` : base);
    let q = writer.from("content_items").update({ status: "retired" }).eq("id", id).eq("center_id", center.id);
    if (inp.kind) q = q.eq("kind", inp.kind);
    const { data, error } = await q.neq("status", "retired").select("id");
    if (error) return dbFail(`Could not ${doing}`, error);
    if (!data?.length) return gone;
    revalidateAfterCommand(["/content"]);
    return {
      ok: true,
      data: { item: { id: row.id, title: row.title }, result: "retired" },
      message:
        row.kind === NIVA
          ? `"${row.title}" retired: Niva no longer answers from it. Answers that already cite it stay until you press Regenerate on them.`
          : `"${row.title}" retired: members no longer see it.`,
    };
  },
});
