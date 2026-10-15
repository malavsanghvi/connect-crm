// Spotlight: a guided, dimmed-page walkthrough of a real screen (docs/SPOTLIGHT.md).
// A tour is DATA: a list of steps, each naming one element of the real page by its `data-spotlight` key. Nothing in a tour
// can click, submit or write: the engine only lights an element and explains it. The types are plain strings and numbers so a
// server component can hand the tours it chose for a person to the client.

import type { AccessKey } from "@/lib/permissions";

export type Placement = "top" | "bottom" | "left" | "right" | "auto";

export type TourStep = {
  /** Unique inside its tour. */
  id: string;
  /** The `data-spotlight` key of the element to light (several elements may share a key: the first one on the screen wins). */
  target: string;
  /** The page this step lives on. Next (or Back) goes there when the person is on another page. Query strings are ignored when comparing. */
  href?: string;
  title: string;
  /** One or two plain sentences. */
  body: string;
  placement?: Placement;
  /** Left out silently when its target is not on the screen (a hidden menu on a phone, a module that is off). */
  optional?: boolean;
  /**
   * What the card says when the target never shows up, instead of the usual note. Plain English, about this step: why it can be
   * empty and what the person will see when it is not.
   */
  missing?: string;
  /** The lit element stays clickable on this step ("Try it yourself"). The person acts on it; the tour never does. */
  interactive?: boolean;
};

/** Who gets a tour. Both lists are "any of" for roles and "all of" for access and modules; empty or missing means no condition. */
export type TourRequires = {
  /** Access keys of src/lib/permissions.ts (ACCESS): the screens of the tour must open for the person. */
  access?: readonly AccessKey[];
  /** Module keys of src/lib/modules.ts that must be on for the community. */
  modules?: readonly string[];
};

export type TourDef = {
  id: string;
  title: string;
  /** A sentence for the invitation. */
  summary: string;
  /** Rough length for the invitation ("1-minute tour"). */
  minutes: number;
  /** Role keys (src/lib/permissions.ts, docs/ROLES.md): the person holds one of them for the whole community. */
  persona: readonly string[];
  requires: TourRequires;
  steps: readonly TourStep[];
};

/** What this browser remembers about one tour for one signed-in person. */
export type TourStatus = "not_started" | "seen" | "completed" | "dismissed";

export type Rect = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };
