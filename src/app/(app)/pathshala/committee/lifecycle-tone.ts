import type { Lifecycle } from "@/lib/logic/resolutions";

import type { PTone as Tone } from "../ui";

export const LIFECYCLE_TONE: Record<Lifecycle, Tone> = {
  Draft: "muted",
  "Comment period open": "navy",
  "Comment period paused": "warning",
  "Ready for vote": "purple",
  "Voting open": "maroon",
  "Voting paused": "warning",
  "Closed – passed": "success",
  "Closed – failed": "danger",
  "Closed – no quorum": "neutral",
  Withdrawn: "muted",
};
