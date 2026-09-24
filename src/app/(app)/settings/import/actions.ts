"use server";

import { revalidatePath } from "next/cache";

import type { Json } from "@/lib/database.types";
import { todayInTz } from "@/lib/dates";
import { failure, type ActionResult } from "@/lib/errors";
import { buildRow, customKeyFor, savedMappingOf, type ColumnTarget, type Mapping } from "@/lib/import/mapping";
import { maskedSamples } from "@/lib/import/mask";
import { canImportEntity, entityDef } from "@/lib/import/registry";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason } from "@/lib/session";

// Every action re-checks the session and the data type's permission here (UI
// convenience); the database checks both again (app.import_assert_run) and
// is the enforcement. Errors come back as plain sentences.

const MAX_ROWS_PER_CALL = 300;

function refresh(runId?: string) {
  revalidatePath("/settings/import");
  if (runId) revalidatePath(`/settings/import/${runId}`);
}

async function authorizeEntity(entityKey: string, doing: string) {
  const auth = await authorizeAction("dataImport", doing);
  if (!auth.ok) return auth;
  const e = entityDef(entityKey);
  if (!e) return { ok: false as const, error: `Could not ${doing} — the import tool does not load that kind of data.` };
  if (!canImportEntity(auth.session, e)) {
    return { ok: false as const, error: `Could not ${doing} — importing ${e.label.toLowerCase()} needs ${e.writePerms.join(" or ")}.` };
  }
  return { ok: true as const, session: auth.session, entity: e };
}

function validMapping(m: unknown, headerCount: number): m is Mapping {
  if (!m || typeof m !== "object") return false;
  const x = m as Mapping;
  return Array.isArray(x.columns) && x.columns.length === headerCount && typeof x.options === "object" && x.options !== null;
}

export type StartResult = { runId: string; runNumber: number; previousRunNumber: number | null; sameFileRunNumber: number | null };

/** Upload: start a numbered run for this file. */
export async function startImportAction(input: {
  entity: string;
  source: string;
  fileName: string;
  fingerprint: string;
  fileSize: number;
  crmSystem: string;
}): Promise<ActionResult<StartResult>> {
  const a = await authorizeEntity(input.entity, "start the import");
  if (!a.ok) return a;
  const { db, center } = a.session;
  const { data, error } = await db.rpc("import_create_run", {
    p_center: center.id,
    p_entity: a.entity.key,
    p_source: String(input.source ?? "").trim().slice(0, 80) || "csv",
    p_file_name: String(input.fileName ?? "").slice(0, 200),
    p_fingerprint: String(input.fingerprint ?? "").slice(0, 128) || undefined,
    p_file_size: Number.isFinite(input.fileSize) ? Math.round(input.fileSize) : undefined,
    p_options: { crm_system: String(input.crmSystem ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40) || null },
  });
  if (error) return failure("Could not start the import", error);
  const d = data as { id: string; run_number: number; previous_run_number: number | null; same_file_run_number: number | null };
  refresh();
  return {
    ok: true,
    data: { runId: d.id, runNumber: d.run_number, previousRunNumber: d.previous_run_number, sameFileRunNumber: d.same_file_run_number },
  };
}

/** Keep extra columns as custom fields: create (or reuse) their definitions; returns the mapping with each field's key. */
export async function defineCustomFieldsAction(input: { runId: string; entity: string; mapping: Mapping }): Promise<ActionResult<Mapping>> {
  const a = await authorizeEntity(input.entity, "keep the extra columns as custom fields");
  if (!a.ok) return a;
  if (!isUuid(input.runId)) return { ok: false, error: "Could not keep the extra columns — the import was not found. Start again." };
  const customs = input.mapping.columns.flatMap((c, i) => (c.kind === "custom" ? [{ i, c }] : []));
  if (customs.length === 0) return { ok: true, data: input.mapping };
  for (const { c } of customs) {
    if (!c.label.trim()) return { ok: false, error: "Could not keep the extra columns — every custom field needs a name." };
  }
  const { data, error } = await a.session.db.rpc("import_define_fields", {
    p_run: input.runId,
    p_fields: customs.map(({ c }) => ({ label: c.label.trim(), type: c.type, choices: c.choices ?? [], key: c.key ?? null })) as unknown as Json,
  });
  if (error) return failure("Could not keep the extra columns as custom fields", error);
  const keys = (data as { label: string; key: string }[]) ?? [];
  const columns: ColumnTarget[] = input.mapping.columns.map((c) => {
    if (c.kind !== "custom") return c;
    const hit = keys.find((k) => k.label === c.label.trim());
    return { ...c, key: hit?.key ?? c.key ?? customKeyFor(c.label) };
  });
  return { ok: true, data: { ...input.mapping, columns } };
}

/**
 * Check → stage: the server rebuilds every row from the original cells with the
 * same code the browser used, so what is staged is exactly what was shown.
 */
export async function stageRowsAction(input: {
  runId: string;
  entity: string;
  headers: string[];
  mapping: Mapping;
  rows: { rowNo: number; cells: string[] }[];
  first: boolean;
}): Promise<ActionResult<{ staged: number }>> {
  const a = await authorizeEntity(input.entity, "check the rows");
  if (!a.ok) return a;
  if (!isUuid(input.runId)) return { ok: false, error: "Could not check the rows — the import was not found. Start again." };
  const headers = Array.isArray(input.headers) ? input.headers.map((h) => String(h ?? "")) : [];
  if (!validMapping(input.mapping, headers.length)) return { ok: false, error: "Could not check the rows — the column mapping is incomplete. Go back to Map." };
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (rows.length === 0) return { ok: true, data: { staged: 0 } };
  if (rows.length > MAX_ROWS_PER_CALL) return { ok: false, error: `Could not check the rows — send at most ${MAX_ROWS_PER_CALL} at a time.` };
  const today = todayInTz(a.session.center.time_zone);
  const staged = rows.map((r) => {
    const cells = Array.isArray(r.cells) ? r.cells.map((c) => (c === null || c === undefined ? "" : String(c))) : [];
    return buildRow(a.entity.key, input.mapping, headers, cells, Number(r.rowNo), today);
  });
  const { data, error } = await a.session.db.rpc("import_stage_rows", {
    p_run: input.runId,
    p_rows: staged as unknown as Json,
    p_mapping: input.first ? ({ headers, ...savedMappingOf(headers, input.mapping) } as unknown as Json) : undefined,
  });
  if (error) return failure("Could not check the rows", error);
  return { ok: true, data: { staged: Number(data ?? 0) } };
}

/** Save the mapping for this source ("Neon export") so the next file maps itself. */
export async function saveMappingAction(input: { entity: string; source: string; headers: string[]; mapping: Mapping }): Promise<ActionResult> {
  const a = await authorizeEntity(input.entity, "save the mapping");
  if (!a.ok) return a;
  const source = String(input.source ?? "").trim();
  if (!source) return { ok: false, error: "Could not save the mapping — name the source first, for example \"Neon export\"." };
  if (!validMapping(input.mapping, input.headers?.length ?? -1)) return { ok: false, error: "Could not save the mapping — it is incomplete." };
  const { error } = await a.session.db.rpc("import_save_mapping", {
    p_center: a.session.center.id,
    p_entity: a.entity.key,
    p_source: source,
    p_mapping: savedMappingOf(input.headers, input.mapping) as unknown as Json,
  });
  if (error) return failure("Could not save the mapping", error);
  return { ok: true, message: `Mapping saved for "${source}".` };
}

export type AiSuggestion = { header: string; field: string | null; confidence: number; reason: string };
export type AiState =
  | { status: "unavailable"; reason: string }
  | { status: "queued" | "running"; jobId?: string }
  | { status: "done"; suggestions: AiSuggestion[] }
  | { status: "failed"; reason: string }
  | { status: "none" };

/**
 * Ask the background service for mapping suggestions: only the headers and a
 * few MASKED sample values leave (masked here, on the server).
 */
export async function requestAiMappingAction(input: {
  runId: string;
  entity: string;
  headers: string[];
  sampleRows: string[][];
  unmapped: string[];
}): Promise<ActionResult<AiState>> {
  const a = await authorizeEntity(input.entity, "ask for mapping suggestions");
  if (!a.ok) return a;
  if (!isUuid(input.runId)) return { ok: false, error: "Could not ask for suggestions — the import was not found." };
  const headers = (input.headers ?? []).map(String).slice(0, 200);
  const sample = (input.sampleRows ?? []).slice(0, 20).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : []));
  const columns = maskedSamples(headers, sample, 3).filter((c) => (input.unmapped ?? []).includes(c.header));
  if (columns.length === 0) return { ok: true, data: { status: "none" } };
  const fields = a.entity.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, description: f.description }));
  const { data, error } = await a.session.db.rpc("import_request_ai_mapping", {
    p_run: input.runId,
    p_payload: { entity: a.entity.key, entity_label: a.entity.label, columns, fields } as unknown as Json,
  });
  if (error) return failure("Could not ask for mapping suggestions", error);
  const d = data as { status: string; reason?: string; job_id?: string };
  if (d.status === "queued") return { ok: true, data: { status: "queued", jobId: d.job_id } };
  return { ok: true, data: { status: "unavailable", reason: d.reason ?? "The background service is not available, so only name-based matching ran." } };
}

export async function aiMappingResultAction(input: { runId: string; entity: string }): Promise<ActionResult<AiState>> {
  const a = await authorizeEntity(input.entity, "read the mapping suggestions");
  if (!a.ok) return a;
  if (!isUuid(input.runId)) return { ok: false, error: "Could not read the suggestions — the import was not found." };
  const { data, error } = await a.session.db.rpc("import_ai_mapping_result", { p_run: input.runId });
  if (error) return failure("Could not read the mapping suggestions", error);
  const d = (data ?? {}) as { status?: string; result?: { suggestions?: AiSuggestion[] } | null; error?: string | null; reason?: string };
  switch (d.status) {
    case "done":
      return { ok: true, data: { status: "done", suggestions: Array.isArray(d.result?.suggestions) ? d.result!.suggestions : [] } };
    case "failed":
    case "cancelled":
      return { ok: true, data: { status: "failed", reason: d.error || "The suggestion job failed." } };
    case "queued":
    case "running":
      return { ok: true, data: { status: d.status } };
    case "unavailable":
      return { ok: true, data: { status: "unavailable", reason: d.reason ?? "The background service is not set up." } };
    default:
      return { ok: true, data: { status: "none" } };
  }
}

// ── Run steps (Preview → Import → Reconcile), for the run page ───────────────

async function authorizeRun(runId: string, doing: string) {
  const auth = await authorizeAction("dataImport", doing);
  if (!auth.ok) return auth;
  if (!isUuid(runId)) return { ok: false as const, error: `Could not ${doing} — that import was not found.` };
  return auth;
}

export type PreviewCounts = { create: number; update: number; skip: number; needs_decision: number; error: number; total: number };

export async function previewAction(runId: string): Promise<ActionResult<PreviewCounts>> {
  const a = await authorizeRun(runId, "preview the import");
  if (!a.ok) return a;
  const { data, error } = await a.session.db.rpc("import_preview", { p_run: runId });
  if (error) return failure("Could not preview the import", error);
  refresh(runId);
  return { ok: true, data: data as unknown as PreviewCounts };
}

export async function decideAction(runId: string, rowNo: number, decision: "create" | "skip"): Promise<ActionResult> {
  const a = await authorizeRun(runId, "record the decision");
  if (!a.ok) return a;
  if (decision !== "create" && decision !== "skip") return { ok: false, error: "Could not record the decision — choose add or skip." };
  const { error } = await a.session.db.rpc("import_decide", { p_run: runId, p_row_no: Math.round(rowNo), p_decision: decision });
  if (error) return failure("Could not record the decision", error);
  refresh(runId);
  return { ok: true, message: decision === "create" ? `Row ${rowNo} will be added.` : `Row ${rowNo} will be skipped.` };
}

export type CommitProgress = {
  processed: number;
  remaining: number;
  status: string;
  counts: { created: number; updated: number; unchanged: number; skipped: number; failed: number; total: number };
};

/** Import one batch; the page calls it again until nothing remains. */
export async function commitBatchAction(runId: string): Promise<ActionResult<CommitProgress>> {
  const a = await authorizeRun(runId, "import the rows");
  if (!a.ok) return a;
  const { data, error } = await a.session.db.rpc("import_commit_batch", { p_run: runId, p_limit: 100 });
  if (error) return failure("Could not import the rows", error);
  const d = data as unknown as CommitProgress;
  if (d.remaining === 0) refresh(runId);
  return { ok: true, data: d };
}

export async function reconcileAction(runId: string): Promise<ActionResult> {
  const a = await authorizeRun(runId, "reconcile the import");
  if (!a.ok) return a;
  const { error } = await a.session.db.rpc("import_reconcile", { p_run: runId });
  if (error) return failure("Could not reconcile the import", error);
  refresh(runId);
  return { ok: true, message: "Totals compared with the file." };
}

export async function signOffAction(runId: string, note: string): Promise<ActionResult> {
  const a = await authorizeRun(runId, "sign the import off");
  if (!a.ok) return a;
  const clean = String(note ?? "").trim().slice(0, 500);
  const db = clean ? await dbWithReason(a.session, clean) : a.session.db;
  const { error } = await db.rpc("import_sign_off", { p_run: runId, p_note: clean || undefined });
  if (error) return failure("Could not sign the import off", error);
  refresh(runId);
  return { ok: true, message: "Signed off." };
}

export async function undoAction(runId: string, reason: string): Promise<ActionResult<{ removed: number; restored: number; kept: unknown[] }>> {
  const a = await authorizeRun(runId, "undo the import");
  if (!a.ok) return a;
  const clean = String(reason ?? "").trim();
  if (!clean) return { ok: false, error: "Could not undo the import — say why. The reason is kept in the audit log." };
  if (clean.length > 500) return { ok: false, error: "Could not undo the import — keep the reason under 500 characters." };
  const db = await dbWithReason(a.session, clean);
  const { data, error } = await db.rpc("import_undo", { p_run: runId, p_reason: clean });
  if (error) {
    if (error.code === "CCSTP" || /fresh 2FA check/i.test(error.message ?? "")) {
      console.error("[import] undo needs step-up:", error);
      return { ok: false, error: "Could not undo the import — this needs a fresh 2FA check. Confirm with your authenticator, then try again." };
    }
    return failure("Could not undo the import", error);
  }
  const d = data as { removed: number; restored: number; kept: unknown[] };
  refresh(runId);
  const kept = d.kept?.length ? ` ${d.kept.length} value${d.kept.length === 1 ? " was" : "s were"} changed by someone since, so left as they are.` : "";
  return { ok: true, message: `Undone: ${d.removed} added row${d.removed === 1 ? "" : "s"} removed, ${d.restored} changed row${d.restored === 1 ? "" : "s"} put back.${kept}`, data: d };
}

export async function cancelImportAction(runId: string): Promise<ActionResult> {
  const a = await authorizeRun(runId, "cancel the import");
  if (!a.ok) return a;
  const { error } = await a.session.db.rpc("import_cancel", { p_run: runId });
  if (error) return failure("Could not cancel the import", error);
  refresh(runId);
  return { ok: true, message: "Import cancelled; nothing was changed." };
}
