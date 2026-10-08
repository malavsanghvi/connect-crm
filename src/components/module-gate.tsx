import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClass } from "@/components/ui";
import { kindModuleLabel, moduleNotOffered, notOfferedExplanation, notPartOfKindSentence } from "@/lib/kind";
import { isModuleEnabled, moduleDef, moduleOffMessage, type ModuleKey } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { loadSession } from "@/lib/session";

/**
 * Wraps a module's route folder (its layout.tsx): when the center has
 * switched the module off, a direct URL shows a plain explanation instead of
 * the page. When the organization's kind never offers the module (a chamber of
 * commerce has no Bolis) the page says so instead, with no link to a switch that
 * does not exist. Convenience only — the database refuses the module's data anyway.
 * Session problems (signed out, setup) are left to the (app) layout.
 */
export async function ModuleGate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const state = await loadSession();
  if (state.status !== "ok" || isModuleEnabled(state.session, module)) return <>{children}</>;
  const { session } = state;
  const center = session.center.short_name || session.center.name;
  const label = kindModuleLabel(session.kind, module, moduleDef(module).label);
  if (moduleNotOffered(session.kind, module)) {
    return (
      <div className="cc-card px-6 py-10 text-center" data-testid="module-not-offered">
        <p className="font-display text-[22px] font-semibold text-ink">{notPartOfKindSentence(label, session.kind.label)}</p>
        <p role="status" className="mx-auto mt-2 max-w-lg text-[13px] text-muted">
          {notOfferedExplanation(center, session.kind.label)}
        </p>
      </div>
    );
  }
  return (
    <div className="cc-card px-6 py-10 text-center">
      <p className="font-display text-[22px] font-semibold text-ink">{label} is switched off</p>
      <p role="status" className="mx-auto mt-2 max-w-lg text-[13px] text-muted">
        {moduleOffMessage(module, center, label)}
      </p>
      {canAccess(session, "centerSettings") ? (
        <p className="mt-4">
          <Link href="/settings/modules" className={buttonClass("primary", "sm")}>
            Open Settings › Modules
          </Link>
        </p>
      ) : null}
    </div>
  );
}
