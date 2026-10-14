"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { LookSwitch } from "@/components/shell/look-switch";
import { WorkspaceIcon } from "@/components/shell/workspace-icon";
import { type RailWorkspace } from "@/components/shell/workspace-rail";
import { activeWorkspace, phoneBar } from "@/lib/workspaces";

const MORE_ICON = "M5 12h.01 M12 12h.01 M19 12h.01";

function BarLink({ w, active, badge, badgeLabel }: { w: RailWorkspace; active: boolean; badge?: string | null; badgeLabel?: string }) {
  return (
    <Link href={w.href} aria-current={active ? "page" : undefined} className="v2-bar-item" data-spotlight={`nav-${w.key}`}>
      <span className="relative">
        <WorkspaceIcon path={w.icon} />
        {badge ? (
          <span className="v2-nav-badge" aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="v2-nav-label">{w.label}</span>
      {badge && badgeLabel ? <span className="sr-only">, {badgeLabel}</span> : null}
    </Link>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The phone's bottom bar (under 768px): Today, People, Giving, Events and More, with Niva's button beside them. "More" opens a
 * sheet with every other workspace the person may open, the look switch and the role line. Only workspaces the person may open
 * appear, as in the rail.
 */
export function PhoneBar({
  workspaces,
  todayBadge,
  todayBadgeLabel,
  footer,
  children,
}: {
  workspaces: RailWorkspace[];
  todayBadge?: string | null;
  todayBadgeLabel?: string;
  /** The role line shown at the bottom of the sheet. */
  footer: string;
  /** Niva's button, shown last in the bar. */
  children?: ReactNode;
}) {
  const pathname = usePathname();
  const activeKey = activeWorkspace(workspaces, pathname)?.key;
  const { bar, more } = phoneBar(workspaces);
  const moreActive = more.some((w) => w.key === activeKey);
  // The sheet is open for the page it was opened on: a page change (a link in the sheet, back, forward) closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpenAt(null);
    moreRef.current?.focus();
  }, []);

  // Move focus into the sheet when it opens.
  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    // Keep Tab inside the sheet while it is open.
    const nodes = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <nav aria-label="Main workspaces" className="v2-bar md:hidden">
        <ul className="v2-bar-list">
          {bar.map((w) => (
            <li key={w.key}>
              <BarLink w={w} active={w.key === activeKey} badge={w.key === "today" ? todayBadge : null} badgeLabel={todayBadgeLabel} />
            </li>
          ))}
          {more.length > 0 ? (
            <li>
              <button
                ref={moreRef}
                type="button"
                className="v2-bar-item"
                aria-haspopup="dialog"
                aria-expanded={open}
                data-active={moreActive ? "true" : undefined}
                onClick={() => setOpenAt(open ? null : pathname)}
              >
                <WorkspaceIcon path={MORE_ICON} />
                <span className="v2-nav-label">More</span>
              </button>
            </li>
          ) : null}
          {children ? <li>{children}</li> : null}
        </ul>
      </nav>
      {open ? (
        <div className="v2-sheet-layer md:hidden">
          <div className="v2-sheet-backdrop" onClick={close} aria-hidden="true" />
          <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown} className="v2-sheet">
            <div className="flex items-center justify-between gap-3 px-1 pb-2">
              <h2 id={titleId} className="font-display text-[20px] font-semibold text-ink">
                More
              </h2>
              <button type="button" onClick={close} className="cc-btn cc-btn-ghost cc-btn-sm">
                Close
              </button>
            </div>
            <nav aria-label="More workspaces">
              <ul className="grid grid-cols-3 gap-2">
                {more.map((w) => (
                  <li key={w.key}>
                    <Link href={w.href} aria-current={w.key === activeKey ? "page" : undefined} className="v2-sheet-item" onClick={() => setOpenAt(null)}>
                      <WorkspaceIcon path={w.icon} />
                      <span className="v2-nav-label">{w.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="mt-3 border-t border-line-soft pt-3">
              <LookSwitch look="v2" block />
              <p className="cc-nav-foot mt-2 border-t-0">{footer}</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
