import { QueryError } from "@/components/ui";
import type { Section } from "@/lib/data/chip-in-platform";

/** The database refused the platform check: said once, in the card's place. Never an empty table. */
export function NoAccessNote() {
  return (
    <div role="alert" data-testid="chip-in-no-access" className="rounded-field border border-danger/30 bg-danger-50 px-4 py-3 text-[13px] text-danger">
      <p className="font-bold">You don&apos;t have access to this area</p>
      <p className="mt-1">Only the Weaver team can see or change the Chip In and card fee settings, and the database did not let this sign-in do either.</p>
    </div>
  );
}

/** Why a part of a platform card could not be shown: a refusal by the database's permission rules, or a read that failed (with a retry). */
export function SectionProblem<T>({ section, what, retryHref }: { section: Section<T>; what: string; retryHref: string }) {
  if (section.ok) return null;
  if (section.reason === "no_access") return <NoAccessNote />;
  return <QueryError what={what} error={section.error} retryHref={retryHref} />;
}
