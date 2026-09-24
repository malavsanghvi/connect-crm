"use server";

import { revalidatePath } from "next/cache";

import { expectedVersion, writeCenterRules } from "@/lib/data/center-rules-write";
import { failure, type ActionResult } from "@/lib/errors";
import { NUMBER_KINDS, parseLegacySystems, parseNumbering } from "@/lib/setup";
import { authorizeAction, dbWithReason } from "@/lib/session";

/** Settings › Numbering: save the prefixes and next numbers (app.save_numbering, migration 0302). */
export async function saveNumberingAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "save the numbering";
  const auth = await authorizeAction("centerSettings", doing);
  if (!auth.ok) return auth;
  const parsed = parseNumbering((n) => {
    const v = fd.get(n);
    return typeof v === "string" ? v : null;
  });
  if (!parsed.ok) return { ok: false, error: `Could not ${doing} — ${parsed.error}` };
  const reason = String(fd.get("reason") ?? "").trim() || "Numbering reviewed in Settings › Numbering";
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await db.rpc("save_numbering", { p_center: auth.session.center.id, p_items: parsed.value, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/settings/numbering");
  revalidatePath("/setup");
  const changed = typeof data === "object" && data && "changed" in data ? Number((data as { changed: unknown }).changed) : 0;
  return {
    ok: true,
    message: changed > 0 ? `Numbering saved (${changed} of ${NUMBER_KINDS.length} changed) · audit logged` : "Numbering reviewed · nothing changed · Setup step marked done",
  };
}

/** Settings › Numbering: the old systems whose IDs are kept (centers.rules.identifiers.legacy_systems). */
export async function saveIdentifierSystemsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "save the identifier systems";
  const auth = await authorizeAction("centerSettings", doing);
  if (!auth.ok) return auth;
  const expected = expectedVersion(fd.get("version"));
  if (expected === "invalid") return { ok: false, error: `Could not ${doing} — the page is out of date. Reload and try again.` };
  const parsed = parseLegacySystems(String(fd.get("systems") ?? ""));
  if (!parsed.ok) return { ok: false, error: `Could not ${doing} — ${parsed.error}` };
  const result = await writeCenterRules(auth.session, { mode: "patch", rules: { identifiers: { legacy_systems: parsed.value } } }, expected, "identifier systems", (v) =>
    parsed.value.length === 0 ? `No old systems declared · rules version ${v} · audit logged` : `${parsed.value.length} identifier system${parsed.value.length === 1 ? "" : "s"} saved · rules version ${v} · audit logged`,
  );
  if (result.ok) revalidatePath("/settings/numbering");
  return result;
}
