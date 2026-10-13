/**
 * Facts only the owner can give (home page review, 2026-10-13). Each stays null until the owner supplies it, and the
 * website leaves out whatever depends on a null instead of guessing. Filling one in is the only change needed.
 */
export type OwnerFacts = {
  /** The company that runs Weaver, as the footer and the FAQ name it. */
  legalEntity: string | null;
  /** The named person behind Weaver ("Write to …"). */
  founder: string | null;
  /** Where people write to us. */
  contactEmail: string | null;
  /** Who pays for Weaver until the optional Chip In starts. */
  fundedBy: string | null;
  /** When the optional Chip In starts, for example "January 2027". */
  chipInStarts: string | null;
  /** What happens to an organization's data if Weaver ever closes. */
  shutdownCommitment: string | null;
};

export const OWNER_FACTS: OwnerFacts = {
  legalEntity: null,
  founder: null,
  contactEmail: null,
  fundedBy: null,
  chipInStarts: null,
  shutdownCommitment: null,
};
