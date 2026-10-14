import type { ReactNode } from "react";

import { ActionForm } from "@/components/action-form";
import { StatusText } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { kindOrganization, withArticle } from "@/lib/kind";
import { moduleStatus, type ModuleRow } from "@/lib/modules";

import { setModuleGrantAction } from "./actions";

/**
 * Platform › Communities › [community] › Modules (0740): Weaver enables or disables each non-core module for one community, with a
 * reason and a fresh 2FA check (the form asks for the code when the database wants it, then retries). A module sits under the
 * module it needs (Bolis and Accounting under Giving), so an add-on is read with its core. The community itself can only pause
 * and switch back on what is enabled here (Settings › Modules).
 */
export function ModulesPanel({ centerId, rows, kindLabel, tz }: { centerId: string; rows: ModuleRow[]; kindLabel: string | null; tz: string }) {
  const aKind = kindLabel ? withArticle(kindOrganization(kindLabel)) : "this kind of organization";
  const byKey = new Map(rows.map((r) => [r.key, r]));
  // The module it sits under: the first module it needs that is in the list and not core.
  const parentOf = (r: ModuleRow) => r.dependsOn.find((d) => byKey.has(d) && !byKey.get(d)!.core) ?? null;
  const offered = rows.filter((r) => !r.core && r.availability !== "not_available");
  const notOffered = rows.filter((r) => !r.core && r.availability === "not_available");
  const core = rows.filter((r) => r.core);
  const childrenOf = (key: string) => offered.filter((r) => parentOf(r) === key);
  const top = offered.filter((r) => {
    const p = parentOf(r);
    return p === null || !offered.some((o) => o.key === p);
  });

  const line = (r: ModuleRow, depth: number, seen: Set<string>): ReactNode => {
    if (seen.has(r.key)) return null;
    const next = new Set(seen).add(r.key);
    const status = moduleStatus(r, rows);
    const tone = status.key === "on" ? "ok" : status.key === "waiting" || status.key === "paused" ? "warn" : "bad";
    const source = r.grantedAt
      ? `${r.granted ? "Enabled" : "Disabled"} by Weaver ${formatDateTime(r.grantedAt, tz)}${r.grantReason ? ` · Reason: ${r.grantReason}` : ""}`
      : r.granted
        ? `Enabled by default for ${aKind}`
        : `Waits for Weaver: ${aKind} starts it off`;
    const kids = childrenOf(r.key);
    return (
      <li key={r.key} data-module={r.key} data-state={status.key} className={depth > 0 ? "border-l border-line pl-3" : undefined}>
        <div className="flex flex-wrap items-start justify-between gap-3 py-2">
          <div className="min-w-[16rem] flex-1">
            <p className="text-[13px]">
              <span className="font-bold">{r.label}</span> · <StatusText tone={tone}>{status.text}</StatusText>
              {r.paused && r.granted ? <span className="text-muted"> (paused by the community)</span> : null}
            </p>
            <p className="text-xs text-muted">{source}</p>
          </div>
          <ActionForm
            action={setModuleGrantAction}
            submitLabel={r.granted ? "Disable" : "Enable"}
            variant={r.granted ? "bad" : undefined}
            size="xs"
            resetOnSuccess
            className="flex flex-wrap items-center gap-1.5"
            buttonsClassName=""
          >
            <input type="hidden" name="center" value={centerId} />
            <input type="hidden" name="module" value={r.key} />
            <input type="hidden" name="label" value={r.label} />
            <input type="hidden" name="granted" value={r.granted ? "false" : "true"} />
            <input
              name="reason"
              className="crm-input w-56"
              placeholder="Reason (required)"
              aria-label={`Reason for ${r.granted ? "disabling" : "enabling"} ${r.label}`}
              autoComplete="off"
            />
          </ActionForm>
        </div>
        {kids.length > 0 ? <ul className="ml-4">{kids.map((k) => line(k, depth + 1, next))}</ul> : null}
      </li>
    );
  };

  return (
    <div className="space-y-3 text-[13px]">
      {core.length > 0 ? (
        <p className="text-muted">
          {core.map((r) => r.label).join(", ")} {core.length === 1 ? "is" : "are"} part of the core platform and always on.
        </p>
      ) : null}
      <ul className="divide-y divide-line">{top.map((r) => line(r, 0, new Set()))}</ul>
      {notOffered.length > 0 ? (
        <p className="text-muted" data-testid="modules-not-offered">
          Not offered to {aKind} (change the kind of organization to offer them): {notOffered.map((r) => r.label).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
