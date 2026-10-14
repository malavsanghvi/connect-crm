import { parseKindPreview, type KindPreview } from "@/lib/kind-change";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError } from "../../types";

import { findCommunity } from "./shared";

export type KindChangePreviewData = KindPreview & {
  community: string;
  /** The change is made on the Platform screen: the person reads this preview, says why, and enters a fresh security code. */
  next_step: string;
};

const input = object({
  community: f.string("The community by its address (like riverside), its name or its id.", { min: 1, max: 120 }),
  kind: f.string("The key of the new kind of organization, as the Platform screen lists them.", { min: 1, max: 60 }),
});

const PREVIEW_FAILED = "The database answered in a form this page does not understand. Reload and try again.";

/** What changing a community's kind of organization would do. It changes nothing. */
export const previewKindChange = defineCommand<Infer<typeof input>, KindChangePreviewData>({
  key: "platform.preview_kind_change",
  title: "Preview a change of kind of organization",
  description:
    "Show, in plain words, what changing a community's kind of organization would do: which modules would be hidden (their records stay) and which would become available. Name the community by its address, its name or its id, " +
    "and the new kind by its key. It changes nothing and is only for the Weaver team. To make the change, the person opens the community on the Platform screen, reads the preview, says why and enters a fresh security code: " +
    "platform.change_kind says where.",
  level: "draft",
  permission: "dashboard",
  platformOnly: true,
  input,
  async execute(ctx, { community, kind }) {
    const ref = await findCommunity(ctx.session.db, community);
    const { data, error } = await ctx.session.db.rpc("category_change_preview", { p_center: ref.id, p_category: kind });
    if (error) throw new CommandDbError(error, "preview the change");
    const preview = parseKindPreview(data);
    if (!preview) throw new CommandError(PREVIEW_FAILED);
    return {
      ok: true,
      data: { ...preview, community: ref.name, next_step: `Open Platform › ${ref.name}, choose the new kind under Kind of organization, say why and enter your security code.` },
      message: preview.changed ? preview.summary[0] : `${ref.name} is already of that kind.`,
    };
  },
});
