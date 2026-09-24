"use client";

import { useState } from "react";

import { ModuleNav } from "@/components/shell/nav-link";
import type { VisibleModule } from "@/lib/permissions";

/** Below the lg breakpoint the sidebar folds into this "Menu" button. */
export function MobileNav({
  modules,
  homeBadge,
  homeBadgeLabel,
  footer,
}: {
  modules: VisibleModule[];
  homeBadge: string | null;
  homeBadgeLabel?: string;
  footer: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative lg:hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="cc-btn cc-btn-ghost cc-btn-sm">
        {open ? "Close" : "Menu"}
      </button>
      {open ? (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 max-h-[80vh] w-64 overflow-y-auto rounded-2xl border border-line bg-white p-2.5 shadow-[var(--shadow-menu)]">
          <ModuleNav modules={modules} homeBadge={homeBadge} homeBadgeLabel={homeBadgeLabel} onNavigate={() => setOpen(false)} />
          <p className="cc-nav-foot mt-2">{footer}</p>
        </div>
      ) : null}
    </div>
  );
}
