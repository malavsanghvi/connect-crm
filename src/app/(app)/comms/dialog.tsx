"use client";

import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A small centred dialog for a form of one or two fields (the portal's scrim and card). It closes with Escape, with a click outside
 * and with whatever Cancel button the form carries; it keeps the page behind it from scrolling. The form inside shows its own
 * errors, so a failure never closes it.
 */
export function CommsDialog({ kicker, title, onClose, children }: { kicker: string; title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(
    <div
      className="cc-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="cc-modal"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <p className="cc-kicker">{kicker}</p>
        <h2 id={titleId} className="cc-modal-title">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
