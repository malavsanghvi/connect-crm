"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/brand/icons";
import { useRecordNav } from "@/components/shell/record-nav";
import { type RailWorkspace } from "@/components/shell/workspace-rail";
import { PANEL_COOKIE, type PanelPref } from "@/lib/panel-pref";
import { activeWorkspace } from "@/lib/workspaces";
import { activeChildHref, activeSectionKey, sectionCount, type WorkspaceSections } from "@/lib/workspace-sections";

/** The width from which an undecided panel starts open (the stylesheet uses the same number). */
const WIDE = "(min-width: 1280px)";

/** Two letters for the collapsed strip: the first letters of the first two words, or the first two letters of one word. */
export function monogram(label: string): string {
  const words = label.split(/[\s&/·-]+/).filter(Boolean);
  const chars = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? "").slice(0, 2);
  return chars.charAt(0).toUpperCase() + chars.slice(1).toLowerCase();
}

function Chevron({ open }: { open: boolean }) {
  return <Icon name="chevron" className={open ? "h-2.5 w-2.5" : "h-2.5 w-2.5 -rotate-90"} strokeWidth={3.5} />;
}

/**
 * The left panel of the redesigned shell (docs/CRM_NAV_REDESIGN_PLAN.md): the sections of the open workspace in groups that fold,
 * scrolling on its own. 232px open, a 56px strip of two-letter marks when collapsed (the name is on the link for a screen reader
 * and on hover). The choice is remembered in a cookie; with no choice it is open from 1280px wide and collapsed below. Under 1024px
 * it is not drawn: the pages keep their own tab rows there. A workspace with fewer than two sections has no panel.
 */
export function SectionPanel({ workspaces, sections, initial }: { workspaces: RailWorkspace[]; sections: WorkspaceSections[]; initial: PanelPref }) {
  const pathname = usePathname() ?? "";
  const [pref, setPref] = useState<PanelPref>(initial);
  const [wide, setWide] = useState(true);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const record = useRecordNav();

  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const isOpen = pref === "open" || (pref === "auto" && wide);
  const toggle = useCallback(() => {
    const next: PanelPref = isOpen ? "closed" : "open";
    setPref(next);
    document.cookie = `${PANEL_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, [isOpen]);

  // Ctrl B (Cmd B on a Mac) folds the panel, except while someone is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "b") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      toggle();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);

  const ws = activeWorkspace(workspaces, pathname);
  const sec = ws ? sections.find((s) => s.key === ws.key) : undefined;
  // A record page (a household) lists its own sections here for as long as it is open (record-nav.tsx).
  if (record) {
    return (
      <aside className="v2-panel" data-section-panel="" data-state={pref} aria-label={`${record.title} sections`}>
        <div className="v2-panel-head">
          <Link href={record.backHref} className="v2-panel-back" title={`Back to ${record.backLabel}`}>
            <Icon name="chevron" className="h-3 w-3 rotate-90" strokeWidth={3} />
            {record.backLabel}
          </Link>
          <button type="button" className="v2-panel-toggle" onClick={toggle} aria-expanded={isOpen} aria-label="Section list" title={`${isOpen ? "Collapse" : "Expand"} (Ctrl B)`}>
            <Icon name="chevron" className={isOpen ? "h-4 w-4 rotate-90" : "h-4 w-4 -rotate-90"} />
          </button>
        </div>
        <div className="v2-panel-record">
          <p className="v2-panel-record-name">{record.title}</p>
          {record.subtitle ? <p className="v2-panel-record-sub">{record.subtitle}</p> : null}
        </div>
        <nav className="v2-panel-nav" aria-label={`${record.title} sections`}>
          <ul className="v2-panel-list">
            {record.items.map((item) => (
              <li key={item.key}>
                <Link href={item.href} scroll={false} aria-current={item.active ? "page" : undefined} aria-label={item.label} title={item.label} className="v2-panel-item">
                  <span className="v2-panel-mono" aria-hidden="true">
                    {monogram(item.label)}
                  </span>
                  <span className="v2-panel-label">{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {sec && ws ? (
          <div className="v2-panel-foot">
            <Link href={ws.href} className="v2-panel-foot-link">
              All {sec.label} sections
            </Link>
          </div>
        ) : null}
      </aside>
    );
  }
  if (!sec || sectionCount(sec.groups) < 2) return null;
  const current = activeSectionKey(sec.groups, pathname);
  const flip = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className="v2-panel" data-section-panel="" data-state={pref} aria-label={`${sec.label} sections`}>
      <div className="v2-panel-head">
        <h2 className="v2-panel-title">{sec.label}</h2>
        <button type="button" className="v2-panel-toggle" onClick={toggle} aria-expanded={isOpen} aria-label="Section list" title={`${isOpen ? "Collapse" : "Expand"} (Ctrl B)`}>
          <Icon name="chevron" className={isOpen ? "h-4 w-4 rotate-90" : "h-4 w-4 -rotate-90"} />
        </button>
      </div>
      <nav className="v2-panel-nav" aria-label={`${sec.label} sections`}>
        {sec.groups.map((g, gi) => {
          const id = `${sec.key}:${gi}:${g.title ?? ""}`;
          const open = !folded.has(id);
          return (
            <div key={id} className="v2-panel-group">
              {g.title ? (
                <button type="button" className="v2-panel-group-title" aria-expanded={open} onClick={() => flip(id)}>
                  <Chevron open={open} />
                  {g.title}
                </button>
              ) : null}
              <ul className={open || !g.title ? "v2-panel-list" : "v2-panel-list is-folded"}>
                  {g.items.map((item) => {
                    const on = item.key === current;
                    const child = on ? activeChildHref(item, pathname) : undefined;
                    return (
                      <li key={item.key}>
                        <Link href={item.href} aria-current={on ? "page" : undefined} aria-label={item.label} title={item.label} className="v2-panel-item">
                          <span className="v2-panel-mono" aria-hidden="true">
                            {monogram(item.label)}
                          </span>
                          <span className="v2-panel-label">{item.label}</span>
                        </Link>
                        {on && item.children ? (
                          <ul className="v2-panel-sub">
                            {item.children.map((c) => (
                              <li key={c.href}>
                                <Link href={c.href} aria-current={c.href === child ? "page" : undefined} className="v2-panel-subitem">
                                  {c.label}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
