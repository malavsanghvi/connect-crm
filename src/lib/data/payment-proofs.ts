import "server-only";

import type { CardLabels } from "@/components/household-card";
import { communityFormat, type CommunityFormat } from "@/lib/community-format";
import { todayInTz } from "@/lib/dates";
import { failure } from "@/lib/errors";
import { identifierRules } from "@/lib/center-rules";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { parseProofQueue, type CardCan, type ProofCard } from "@/lib/payment-proofs/queue";
import type { CrmSession } from "@/lib/session";
import type { AppSupabase } from "@/lib/supabase/server";

// Giving > Payment proofs: the queue (migration 0866 payment_proof_queue) with the files' short-lived links. The database decides who
// may see the queue; this loader only says so in words when it refuses, and never shows an empty list for a refusal.

export const EVIDENCE_BUCKET = "payment-evidence";
/** A link to a proof's file lives 10 minutes (plan section 4.5). */
export const SIGNED_URL_SECONDS = 600;
/** The first cards' files are linked with the page; the others are linked when the card is opened. */
const PRESIGN_CARDS = 20;

export type ProofsPage =
  | {
      state: "ok";
      cards: ProofCard[];
      can: CardCan;
      fmt: CommunityFormat;
      timeZone: string;
      labels: CardLabels;
      today: string;
      /** Problems that did not stop the page: previews that could not be made, said in words. */
      notices: string[];
    }
  | { state: "no_access" }
  | { state: "off" }
  | { state: "error"; error: string };

/** Short-lived links for storage paths in the proof bucket. A path that could not be linked is left out; `error` says why. */
export async function signEvidencePaths(db: AppSupabase, paths: readonly string[]): Promise<{ urls: Map<string, string>; error: string | null }> {
  const urls = new Map<string, string>();
  const unique = [...new Set(paths)];
  if (unique.length === 0) return { urls, error: null };
  const res = await db.storage.from(EVIDENCE_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (res.error) return { urls, error: failure("Could not make the links to the confirmation files", res.error).error };
  let missing = 0;
  for (const row of res.data ?? []) {
    if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl);
    else missing += 1;
  }
  return { urls, error: missing > 0 ? `Could not make a link for ${missing} ${missing === 1 ? "file" : "files"}. Reload the page to try again.` : null };
}

/** The staff view log (0872): one audit entry per file a staff member is shown. A failure is logged on the server and never hides the file. */
export async function logProofViews(db: AppSupabase, fileIds: readonly string[]): Promise<void> {
  await Promise.all(
    [...new Set(fileIds)].map(async (id) => {
      const res = await db.rpc("log_proof_view", { p_file: id });
      if (res.error) failure("Could not write the confirmation view to the audit log", res.error);
    }),
  );
}

export async function loadProofsPage(session: CrmSession): Promise<ProofsPage> {
  if (!isModuleEnabled(session, "giving_proofs")) return { state: "off" };
  if (!canAccess(session, "payments")) return { state: "no_access" };
  const { db, center } = session;
  const res = await db.rpc("payment_proof_queue", { p_center: center.id });
  if (res.error) {
    // The database is the rule: a refusal for permission is said as "no access", never as an empty queue.
    if (res.error.code === "42501") return { state: "no_access" };
    return { state: "error", error: failure("Could not load the payment confirmations", res.error).error };
  }
  const cards = parseProofQueue(res.data);
  if (!cards) {
    console.error("[giving/proofs] unexpected answer from payment_proof_queue:", res.data);
    return { state: "error", error: "Could not load the payment confirmations — the answer was not in the expected shape." };
  }

  const notices: string[] = [];
  const first = cards.slice(0, PRESIGN_CARDS);
  const signed = await signEvidencePaths(db, first.flatMap((c) => c.files.filter((f) => !f.removed).map((f) => f.path)));
  if (signed.error) notices.push(signed.error);
  for (const c of first) for (const f of c.files) f.url = signed.urls.get(f.path) ?? null;
  await logProofViews(db, first.flatMap((c) => c.files.filter((f) => f.url).map((f) => f.id)));

  const rules = identifierRules(center.rules);
  return {
    state: "ok",
    cards,
    can: {
      decide: canAccess(session, "recordPayment"),
      approve: canAccess(session, "givingApprove"),
      bank: canAccess(session, "bankConfirm") && isModuleEnabled(session, "giving_bank"),
    },
    fmt: communityFormat(center),
    timeZone: center.time_zone,
    labels: { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel },
    today: todayInTz(center.time_zone),
    notices,
  };
}
