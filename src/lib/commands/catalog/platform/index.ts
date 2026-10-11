// The Platform console commands (B90 phase 4): the Weaver team's inbox and one-page community summary, a preview of a change of
// kind, and what only the team can do. Every one is platformOnly (types.ts, enabled.ts): it is never listed or offered to anyone
// who is not a platform admin, and Niva only uses it for them. Nothing here changes anything: the changes are "only you", each
// pointing to the Platform screen that keeps its own safeguards (a preview, a reason, a fresh security code, two approvers).

import type { AnyCommand } from "../../types";

import { communitySummary } from "./community-summary";
import { PLATFORM_ONLY_YOU } from "./only-you";
import { previewKindChange } from "./preview-kind-change";
import { platformWaiting } from "./waiting";

export const PLATFORM_COMMANDS: readonly AnyCommand[] = [
  // read
  platformWaiting,
  communitySummary,
  // draft
  previewKindChange,
  // only you
  ...PLATFORM_ONLY_YOU,
];
