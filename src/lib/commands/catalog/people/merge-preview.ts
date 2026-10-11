// What the two merge previews (migration 0650: app.merge_people_preview, app.merge_households_preview) answer, read defensively and
// put into sentences. Pure except for the call itself.

import { untypedRpc } from "@/lib/payments/rpc";

import { CommandDbError, type CommandContext, type PreviewLine } from "../../types";

export type MergePreviewData = { canMerge: boolean; blockers: string[]; moves: Record<string, number> };

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** The jsonb the database function returns, or null when it is not the shape expected (then nothing is shown as a fact). */
export function parseMergePreview(data: unknown): MergePreviewData | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (typeof o.can_merge !== "boolean") return null;
  const blockers = Array.isArray(o.blockers) ? o.blockers.filter((b): b is string => typeof b === "string" && b.trim() !== "") : [];
  const moves: Record<string, number> = {};
  if (o.moves && typeof o.moves === "object") for (const [k, v] of Object.entries(o.moves as Record<string, unknown>)) moves[k] = num(v);
  return { canMerge: o.can_merge, blockers, moves };
}

export async function callMergePreview(ctx: CommandContext, fn: "merge_people_preview" | "merge_households_preview", args: Record<string, unknown>): Promise<MergePreviewData> {
  const res = await untypedRpc(ctx.session.db)(fn, args);
  if (res.error) throw new CommandDbError(res.error, "check what the merge would do");
  const parsed = parseMergePreview(res.data);
  if (!parsed) throw new CommandDbError(new Error(`${fn} answered in an unexpected shape`), "check what the merge would do");
  return parsed;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function peopleMoveLines(m: Record<string, number>): PreviewLine[] {
  const lines: PreviewLine[] = [
    { label: "Household links", value: `${plural(m.household_links ?? 0, "household link moves", "household links move")} to the kept record${m.shared_households ? ` (${plural(m.shared_households, "household lists both", "households list both")}, so they fold into one)` : ""}` },
    { label: "Identifiers", value: `${plural(m.external_ids ?? 0, "identifier moves", "identifiers move")} to the kept record (Connect, community, CRM, QuickBooks, bank payer names)` },
    { label: "Memberships", value: `${plural(m.memberships ?? 0, "membership moves", "memberships move")} to the kept record` },
  ];
  if (m.open_suggestions) lines.push({ label: "Duplicate suggestion", value: "The suggestion for this pair is marked as merged." });
  return lines;
}

export function householdMoveLines(m: Record<string, number>): PreviewLine[] {
  const lines: PreviewLine[] = [
    { label: "Members", value: `${plural(m.members_moving ?? 0, "member joins", "members join")} the kept household${m.already_in_keep ? ` (${m.already_in_keep} already listed there)` : ""}` },
  ];
  if (m.primary_becomes_other) lines.push({ label: "Primary member", value: "The duplicate's primary member joins as \"other\"; the kept household keeps its own primary member." });
  lines.push({ label: "Stays on the duplicate", value: `${plural(m.household_ids_staying ?? 0, "household identifier", "household identifiers")}, ${plural(m.active_memberships_staying ?? 0, "active membership", "active memberships")}, and its giving history` });
  if (m.open_suggestions) lines.push({ label: "Duplicate suggestion", value: "The suggestion for this pair is marked as merged." });
  return lines;
}
