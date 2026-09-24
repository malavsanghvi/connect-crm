"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/pathshala/committee", label: "Dashboard", module: null },
  { href: "/pathshala/committee/actions", label: "Actions", module: "events" },
  { href: "/pathshala/committee/templates", label: "Templates", module: "events" },
  { href: "/pathshala/committee/year", label: "Create year", module: "events" },
  { href: "/pathshala/committee/concerns", label: "Concerns", module: "governance" },
  { href: "/pathshala/committee/resolutions", label: "Resolutions", module: "governance" },
] as const;

/** The committee's sections, as chips under the Pathshala tab strip (one tab row per module, as in the prototype). */
export function CommitteeTabs({ modulesOff = [] }: { modulesOff?: readonly string[] }) {
  const pathname = usePathname();
  // Sections of a switched-off module (Events, Governance) are hidden.
  const tabs = TABS.filter((t) => !t.module || !modulesOff.includes(t.module));
  const active = [...tabs].reverse().find((t) => pathname === t.href || pathname.startsWith(t.href + "/"))?.href;
  return (
    <nav aria-label="Committee sections" className="mb-4 flex flex-wrap gap-1.5">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={active === t.href ? "page" : undefined} className="cc-chip">
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
