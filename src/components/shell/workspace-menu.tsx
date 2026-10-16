"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { Icon } from "@/components/brand/icons";
import { useActiveWorkspaceKey, type RailWorkspace } from "@/components/shell/workspace-rail";
import { fitWorkspaces } from "@/lib/workspace-fit";

/** The space between two links of the bar; the stylesheet (.v2-top-list) uses the same number. */
const GAP = 2;

function Badge({ badge }: { badge: string }) {
  return (
    <span className="v2-top-badge" aria-hidden="true">
      {badge}
    </span>
  );
}

/**
 * The workspaces of the top bar (docs/CRM_NAV_REDESIGN_PLAN.md): a row of text links, the open one underlined, and a More button for
 * the ones that do not fit. The row is measured, never guessed: a hidden copy of every link gives its natural width, and the pure
 * fitWorkspaces (src/lib/workspace-fit.ts) decides which stay. The open workspace is never under More. Settings and Platform
 * (placement "end") are not in the row; the bar's gear and the account menu carry them.
 */
export function WorkspaceMenu({
  workspaces,
  todayBadge,
  todayBadgeLabel,
}: {
  /** Every workspace the person may open (the open one is found among them, whichever side it is on). */
  workspaces: RailWorkspace[];
  todayBadge?: string | null;
  todayBadgeLabel?: string;
}) {
  const activeKey = useActiveWorkspaceKey(workspaces);
  const shown = workspaces.filter((w) => w.placement === "start");
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const panelId = useId();
  // Until the first measure every link is shown (the server's markup), clipped by the row.
  const [visible, setVisible] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);

  const keysSignature = shown.map((w) => w.key).join(",");

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const m = measureRef.current;
      if (!m) return;
      const cells = Array.from(m.children) as HTMLElement[];
      const moreCell = cells.pop();
      const keys = keysSignature === "" ? [] : keysSignature.split(",");
      const fit = fitWorkspaces({
        widths: cells.map((c) => c.offsetWidth),
        available: nav.clientWidth,
        moreWidth: moreCell?.offsetWidth ?? 0,
        active: keys.indexOf(activeKey ?? ""),
        gap: GAP,
      });
      const next = fit.visible.map((i) => keys[i]);
      setVisible((prev) => (prev && prev.length === next.length && prev.every((k, i) => k === next[i]) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    // The web font changes the widths when it arrives.
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [keysSignature, activeKey]);

  // The More menu closes on Escape (focus returns to its button), on a click elsewhere and when focus leaves it.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !moreRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        moreRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shownKeys = visible ?? shown.map((w) => w.key);
  const inBar = shown.filter((w) => shownKeys.includes(w.key));
  const under = shown.filter((w) => !shownKeys.includes(w.key));
  const badgeFor = (w: RailWorkspace) => (w.key === "today" ? todayBadge : null);

  const onPanelKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const links = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("a") ?? []);
    const i = links.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      links[(n + links.length) % links.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(links.length - 1);
  };
  const onMoreKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("a")?.focus());
    }
  };

  return (
    <nav ref={navRef} aria-label="Workspaces" className="v2-top-menu">
      <ul className="v2-top-list">
        {inBar.map((w) => (
          <li key={w.key}>
            <Link href={w.href} aria-current={w.key === activeKey ? "page" : undefined} className="v2-top-item" data-spotlight={`nav-${w.key}`}>
              {w.label}
              {badgeFor(w) ? <Badge badge={badgeFor(w) as string} /> : null}
              {badgeFor(w) && todayBadgeLabel ? <span className="sr-only">, {todayBadgeLabel}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      {under.length > 0 ? (
        <div className="v2-top-more">
          <button
            ref={moreRef}
            type="button"
            className="v2-top-item"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={() => setOpen((o) => !o)}
            onKeyDown={onMoreKey}
          >
            More
            <span className="sr-only"> workspaces, {under.length}</span>
            <Icon name="chevron" className="h-2.5 w-2.5" strokeWidth={3} />
          </button>
          {open ? (
            <ul ref={panelRef} id={panelId} className="v2-top-more-panel" onKeyDown={onPanelKey}>
              {under.map((w) => (
                <li key={w.key}>
                  <Link href={w.href} className="v2-top-more-item" data-spotlight={`nav-${w.key}`} onClick={() => setOpen(false)}>
                    {w.label}
                    {badgeFor(w) ? <Badge badge={badgeFor(w) as string} /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {/* A hidden copy of every link and of More, only to read their natural widths. */}
      <div ref={measureRef} className="v2-top-measure" aria-hidden="true">
        {shown.map((w) => (
          <span key={w.key} className="v2-top-item">
            {w.label}
            {badgeFor(w) ? <Badge badge={badgeFor(w) as string} /> : null}
          </span>
        ))}
        <span className="v2-top-item">
          More
          <Icon name="chevron" className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
      </div>
    </nav>
  );
}
