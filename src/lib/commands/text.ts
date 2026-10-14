// A command's description may name the community's own words (its school, its currency): it is then written as a function of the
// community's kind and worked out where the description leaves the command layer (the model's tool list, the palette, the lists).
// The title stays a plain string: it is shown in a dozen places that do not know the community, so it uses the general word.

import type { KindProfile } from "@/lib/kind";

export type CommandKind = Pick<KindProfile, "terms" | "modules" | "usesTradition">;

/** Plain text, or text worked out from the community's kind. */
export type KindText = string | ((kind: CommandKind) => string);

/** What a kind that says nothing about itself reads: the general words. */
const NO_KIND: CommandKind = { terms: {}, modules: {}, usesTradition: false };

/** The text for a community; the general wording when its kind is not known (a list of commands for no particular community). */
export function describe(text: KindText, kind?: CommandKind): string {
  return typeof text === "function" ? text(kind ?? NO_KIND) : text;
}
