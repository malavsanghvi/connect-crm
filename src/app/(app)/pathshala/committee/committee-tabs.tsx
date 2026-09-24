"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/pathshala/committee", label: "Dashboard" },
  { href: "/pathshala/committee/actions", label: "Actions" },
  { href: "/pathshala/committee/templates", label: "Templates" },
  { href: "/pathshala/committee/year", label: "Create year" },
  { href: "/pathshala/committee/concerns", label: "Concerns" },
  { href: "/pathshala/committee/resolutions", label: "Resolutions" },
];

/** The committee's sections, as chips under the Pathshala tab strip (one tab row per module, as in the prototype). */
export function CommitteeTabs() {
  const pathname = usePathname();
  const active = [...TABS].reverse().find((t) => pathname === t.href || pathname.startsWith(t.href + "/"))?.href;
  return (
    <nav aria-label="Committee sections" className="mb-4 flex flex-wrap gap-1.5">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={active === t.href ? "page" : undefined} className="cc-chip">
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
