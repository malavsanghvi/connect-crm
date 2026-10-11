// The Content commands (B90 phase 4). The reads and the draft are on for everyone whose role allows them; the confirm-level ones (publish
// or send back an item, take an item out of use) are registered but OFF for Niva until the owner switches each on
// (assistant.tools.<key>). Niva never publishes: a draft waits for an approver, and an approval is the person's button. The visual
// parts of Content (block editors, the media library, the photo approval grids) stay screens. The Server Actions in
// src/app/(app)/content run the same `execute`, so a screen, the ⌘K palette and Niva share one code path.

import type { AnyCommand } from "../../types";

import { approvalQueue } from "./approval-queue";
import { archiveItem } from "./archive-item";
import { decideItem } from "./decide-item";
import { draftItem } from "./draft-item";
import { mediaLibrary, nivaSources } from "./niva-sources";

export { archiveItem, decideItem };

/** In the order a person would meet them: look, prepare, then change. */
export const CONTENT_COMMANDS: readonly AnyCommand[] = [
  // read
  approvalQueue,
  nivaSources,
  mediaLibrary,
  // draft
  draftItem,
  // confirm (off by default)
  decideItem,
  archiveItem,
];
