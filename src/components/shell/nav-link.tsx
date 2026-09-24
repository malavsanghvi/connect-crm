"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { activeModule } from "@/lib/permissions";

/** One module in the flat sidebar. Active when the current URL belongs to the module. */
export function NavLink({
  href,
  label,
  paths,
  tabs,
  badge,
  badgeLabel,
  onNavigate,
}: {
  href: string;
  label: string;
  paths: string[];
  tabs: { href: string }[];
  badge?: string | null;
  badgeLabel?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = activeModule([{ paths, tabs }], pathname) !== undefined;
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className="cc-nav" onClick={onNavigate}>
      <span>{label}</span>
      {badge ? (
        <span className="cc-nav-badge" aria-label={badgeLabel} title={badgeLabel}>
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/** The flat module list (sidebar and the mobile menu). */
export function ModuleNav({
  modules,
  homeBadge,
  homeBadgeLabel,
  onNavigate,
}: {
  modules: { key: string; label: string; href: string; paths: string[]; tabs: { href: string }[] }[];
  homeBadge?: string | null;
  homeBadgeLabel?: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Main">
      <ul className="flex flex-col gap-0.5">
        {modules.map((m) => (
          <li key={m.key}>
            <NavLink
              href={m.href}
              label={m.label}
              paths={m.paths}
              tabs={m.tabs}
              badge={m.key === "home" ? homeBadge : null}
              badgeLabel={m.key === "home" ? homeBadgeLabel : undefined}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}
