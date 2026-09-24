// Settings › Audit log: the WAVE2 traceability filters (the module recorded
// on each row, the client app, reason text). Pure; the page applies them.

import { isModuleKey, type ModuleKey } from "@/lib/modules";

export const CLIENT_APPS = [
  { key: "portal", label: "Portal" },
  { key: "member", label: "Member app" },
  { key: "kiosk", label: "Volunteer kiosk" },
  { key: "job", label: "Scheduled job" },
  { key: "import", label: "Data import" },
] as const;
export type ClientApp = (typeof CLIENT_APPS)[number]["key"];

/** "core" filters rows with no module (core platform tables). */
export type RecordedModule = ModuleKey | "core";

export type TraceFilters = { recordedModule: RecordedModule | null; clientApp: ClientApp | null; reason: string | null };

export function parseTraceFilters(get: (name: string) => string | undefined): TraceFilters {
  const m = get("mod");
  const a = get("app");
  const r = (get("reason") ?? "").replace(/[%*,()"\\:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    recordedModule: m === "core" || isModuleKey(m) ? (m as RecordedModule) : null,
    clientApp: CLIENT_APPS.some((c) => c.key === a) ? (a as ClientApp) : null,
    reason: r || null,
  };
}

/** True when a filter needs the new audit_log columns (module, client_app). */
export function needsTraceColumns(f: TraceFilters): boolean {
  return f.recordedModule !== null || f.clientApp !== null;
}
