import Link from "next/link";

// A person who is in several families is asked which one to open. Each family is shown as its card (the name, the household number and
// the organization's own id, the adults, the place) and the person's part in it: a family is never picked by its name alone.

export type FamilyChoice = {
  id: string;
  href: string;
  /** The household card in parts: the first is the family's name, the rest are the facts. */
  lines: string[];
  /** "Primary member", "Spouse" …: the person's part in this family. */
  part: string | null;
};

export function ChooseFamilyList({ name, choices }: { name: string; choices: FamilyChoice[] }) {
  return (
    <ul className="m-0 mt-4 grid list-none gap-3 p-0 md:grid-cols-2" aria-label={`Families of ${name}`} data-testid="choose-family">
      {choices.map((c) => (
        <li key={c.id}>
          <Link
            href={c.href}
            className="block rounded-2xl border border-line bg-white p-4 no-underline hover:border-[var(--v2-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)]"
          >
            <span className="block text-[16px] font-semibold text-ink" dir="auto">
              {c.lines[0]}
            </span>
            <span className="mt-1 block text-[13.5px] text-muted" dir="auto">
              {c.lines.slice(1).join(" · ")}
            </span>
            {c.part ? (
              <span className="mt-2 inline-flex min-h-6 items-center rounded-full bg-[var(--v2-blue-tint)] px-2.5 text-[12px] font-bold text-[var(--v2-blue)]">{c.part}</span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
