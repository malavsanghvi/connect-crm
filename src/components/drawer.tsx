"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Right-hand record panel, as in the prototype: 460px, white, kicker +
 * Fraunces 22 title + sub-line, a round × close button, scrolling sections
 * and a footer of pill actions. It sits under the 60px top bar and leaves the
 * page usable beside it (on narrow screens it covers the page, with a scrim).
 *
 * Fill it with <DrawerSection> and <KeyValueRow> from components/ui.
 */
export function Drawer({
  open,
  onClose,
  kicker,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  kicker?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !document.querySelector(".cc-scrim [role=dialog][aria-modal=true]")) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open, onClose]);

  // A drawer opened by URL (?app=…) renders on the server too, where there is no
  // document.body to portal into; it appears once the page hydrates.
  const onClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!open || !onClient) return null;

  return createPortal(
    <>
      <div aria-hidden className="fixed inset-x-0 bottom-0 top-[60px] z-40 bg-[rgba(20,18,14,0.45)] lg:hidden" onClick={onClose} />
      <aside role="dialog" aria-modal="false" aria-labelledby={titleId} className="cc-drawer">
        <div className="cc-drawer-head">
          <div className="min-w-0 flex-1">
            {kicker ? <p className="cc-kicker">{kicker}</p> : null}
            <h2 id={titleId} className="cc-drawer-title">
              {title}
            </h2>
            {subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close panel" className="cc-drawer-close">
            ×
          </button>
        </div>
        <div className="cc-drawer-body">{children}</div>
        {footer ? <div className="cc-drawer-foot">{footer}</div> : null}
      </aside>
    </>,
    document.body,
  );
}

const noSubscribe = () => () => {};
