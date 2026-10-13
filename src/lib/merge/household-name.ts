// A household's name as an automatic email may say it: without the first names of its members under the age of majority.
// The same rule as householdNameWithoutChildren (src/lib/commands/child-filter.ts), which the screens use; this copy takes
// only relative imports so the background service can use it, and tests/merge-format.test.ts keeps the two in step.

import { compileMinorNames } from "../commands/minor-names";

export function householdNameForEmail(name: string | null | undefined, minorFirstNames: readonly string[]): string | null {
  if (!name) return null;
  const minors = compileMinorNames(minorFirstNames.map((n) => n.trim()).filter(Boolean));
  if (minors.size === 0) return name;
  const stripped = minors.strip(name);
  if (stripped.count === 0) return name;
  const out = stripped.text
    .replace(/\(\s*[,&]*\s*\)/g, "")
    .replace(/\s+(?:and|&)\s*(?=[,)]|$)/gi, "")
    .replace(/(?:\s*[,&]\s*){2,}/g, ", ")
    .replace(/\s*[,&]\s*(?=\)|$)/g, "")
    .replace(/^[\s,&]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out || null;
}
