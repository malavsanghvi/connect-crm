import "server-only";

import { explainError } from "@/lib/errors";
import type { AppSupabase } from "@/lib/supabase/server";

import { parseAskList, type AskList } from "./ask";
import { LIBRARY_BUCKET } from "./files";
import { parseClaimDetail, type ClaimDetail } from "./pay";
import { parseCatchList, parseClaimsList, parsePersonGifts, parseProcessAnswer, parseProcessList, type CatchList, type ClaimsList, type PersonGifts, type ProcessAnswer, type ProcessListRow } from "./catch";
import { parseClaimMessagePreview, type ClaimMessagePreview } from "./send";
import { PROGRAM_COLUMNS, parseSearch, type ProgramRow, type SearchRow } from "./directory";

// Reads for CatchTheMatch's directory screens (migrations 0765-0767). Each runs as the signed-in person: the database decides
// what comes back (the shared directory for Weaver's team and CatchTheMatch readers; a community's own submissions and links
// for its CatchTheMatch readers only). Every failure comes back as a plain-English sentence for the screen to show.

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

function failed<T>(what: string, error: unknown): Loaded<T> {
  console.error(`[matching] ${what}:`, error);
  return { ok: false, error: `Could not load ${what}: ${explainError(error)}.` };
}

export const SEARCH_PAGE = 50;

export async function searchDirectory(db: AppSupabase, query: string, status: "active" | "retired" | "all", page: number): Promise<Loaded<{ total: number; rows: SearchRow[] }>> {
  const { data, error } = await db.rpc("match_program_search", {
    p_query: query || undefined,
    p_status: status,
    p_limit: SEARCH_PAGE,
    p_offset: (Math.max(1, page) - 1) * SEARCH_PAGE,
  });
  if (error) return failed("the gift matching directory", error);
  return { ok: true, data: parseSearch(data) };
}

export type ProgramName = { name: string; is_primary: boolean };

export async function loadProgram(db: AppSupabase, id: string): Promise<Loaded<{ program: ProgramRow; names: ProgramName[] } | null>> {
  const [p, n] = await Promise.all([
    db.from("match_programs").select(PROGRAM_COLUMNS).eq("id", id).maybeSingle(),
    db.from("match_program_names").select("name, is_primary").eq("program_id", id).order("is_primary", { ascending: false }).order("name"),
  ]);
  if (p.error) return failed("this directory entry", p.error);
  if (n.error) return failed("the names of this directory entry", n.error);
  if (!p.data) return { ok: true, data: null };
  return { ok: true, data: { program: p.data as unknown as ProgramRow, names: (n.data ?? []) as ProgramName[] } };
}

/** A few entries by id (names for a submission's or a link's entry). */
export type ProgramBrief = {
  company_name: string;
  country: string | null;
  status: string;
  merged_into: string | null;
  verified_by_kind: string | null;
  verified_submission_id: string | null;
};

export async function programNames(db: AppSupabase, ids: Array<string | null | undefined>): Promise<Loaded<Map<string, ProgramBrief>>> {
  const out = new Map<string, ProgramBrief>();
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (unique.length === 0) return { ok: true, data: out };
  const { data, error } = await db.from("match_programs").select("id, company_name, country, status, merged_into, verified_by_kind, verified_submission_id").in("id", unique);
  if (error) return failed("the directory entries", error);
  for (const r of data ?? []) {
    out.set(r.id, {
      company_name: r.company_name,
      country: r.country,
      status: r.status,
      merged_into: r.merged_into,
      verified_by_kind: r.verified_by_kind,
      verified_submission_id: r.verified_submission_id,
    });
  }
  return { ok: true, data: out };
}

export type SubmissionRow = {
  id: string;
  program_id: string | null;
  proposal: unknown;
  note: string | null;
  channel: string;
  submitted_by: string;
  submitted_at: string;
  status: string;
  reviewed: unknown;
  forwarded_at: string | null;
  forward_note: string | null;
  forwarded_because: string | null;
  decided_kind: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  result_program_id: string | null;
  duplicate_of: string | null;
};

export const SUBMISSION_VIEWS = [
  { key: "open", label: "Waiting", statuses: ["pending"] },
  { key: "forwarded", label: "With Weaver's team", statuses: ["forwarded"] },
  { key: "decided", label: "Decided", statuses: ["approved", "rejected", "merged"] },
  { key: "all", label: "All", statuses: ["pending", "forwarded", "approved", "rejected", "merged"] },
] as const;
export type SubmissionView = (typeof SUBMISSION_VIEWS)[number]["key"];

/** The community's own submissions (RLS: its CatchTheMatch readers). */
export async function loadSubmissions(db: AppSupabase, centerId: string, view: SubmissionView): Promise<Loaded<SubmissionRow[]>> {
  const statuses = SUBMISSION_VIEWS.find((v) => v.key === view)?.statuses ?? ["pending"];
  const { data, error } = await db
    .from("match_program_submissions")
    .select("id, program_id, proposal, note, channel, submitted_by, submitted_at, status, reviewed, forwarded_at, forward_note, forwarded_because, decided_kind, decided_by, decided_at, decision_reason, result_program_id, duplicate_of")
    .eq("center_id", centerId)
    .in("status", [...statuses])
    .order("submitted_at", { ascending: view === "open" })
    .limit(200);
  if (error) return failed("the submissions", error);
  return { ok: true, data: (data ?? []) as SubmissionRow[] };
}

/** The submission behind a community's check is this community's own ("Verified by your community"). */
export async function ownsVerification(db: AppSupabase, centerId: string, submissionId: string | null): Promise<boolean> {
  if (!submissionId) return false;
  const { data, error } = await db.from("match_program_submissions").select("id").eq("id", submissionId).eq("center_id", centerId).maybeSingle();
  if (error) {
    console.error("[matching] could not tell whether this community verified the entry:", error);
    return false;
  }
  return Boolean(data);
}

export type PlatformSubmission = {
  id: string;
  center_id: string;
  community: string;
  program_id: string | null;
  program_name: string | null;
  proposal: unknown;
  reviewed: unknown;
  note: string | null;
  channel: string;
  status: string;
  submitted_at: string;
  forwarded_at: string | null;
  forward_note: string | null;
  forwarded_because: string | null;
  decided_kind: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  result_program_id: string | null;
  duplicate_of: string | null;
};

/** Which of these submissions are this community's own (the checks behind "verified by a community" it may change itself). */
export async function ownSubmissionIds(db: AppSupabase, centerId: string, ids: Array<string | null | undefined>): Promise<Set<string>> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (unique.length === 0) return new Set();
  const { data, error } = await db.from("match_program_submissions").select("id").eq("center_id", centerId).in("id", unique);
  if (error) {
    console.error("[matching] could not tell which entries this community verified:", error);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.id));
}

/** Every community's submissions for Weaver's team (app.platform_match_submissions: the facts and the community's name only). */
export async function loadPlatformSubmissions(db: AppSupabase, view: "open" | "forwarded" | "decided" | "all", programId?: string): Promise<Loaded<PlatformSubmission[]>> {
  const { data, error } = await db.rpc("platform_match_submissions", { p_view: view, p_program: programId, p_limit: 200 });
  if (error) return failed("the submissions of every community", error);
  const rows = Array.isArray(data) ? (data as unknown as PlatformSubmission[]).filter((r) => r && typeof r.id === "string") : [];
  return { ok: true, data: rows };
}

export type EntryBrief = {
  id: string;
  company_name: string;
  country: string | null;
  status: string;
  match_ratio_bp: number | null;
  portal: string | null;
  religious_orgs: string | null;
  last_verified_on: string | null;
  verified_by_kind: string | null;
  version: number;
};
export type LinkCard = {
  program: EntryBrief | null;
  how: string;
  confirmed_at: string;
  confirmed_by: string;
  confirmed_version: number;
  /** The entry changed (another version, or merged into another) since staff confirmed the link. */
  changed_since_confirmed: boolean;
};
export type Candidate = { id: string; company_name: string; country: string | null; match_ratio_bp: number | null; portal: string | null; matched_name: string; how: string };
export type QueueRow = {
  person_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  member_number: string | null;
  employer: string;
  link: LinkCard | null;
  best: Candidate | null;
  candidates: number;
};
export const QUEUE_PAGE = 50;

export async function loadEmployersQueue(db: AppSupabase, centerId: string, filter: "unlinked" | "linked" | "all", page: number): Promise<Loaded<{ total: number; rows: QueueRow[] }>> {
  const { data, error } = await db.rpc("match_employers_queue", {
    p_center: centerId,
    p_filter: filter,
    p_limit: QUEUE_PAGE,
    p_offset: (Math.max(1, page) - 1) * QUEUE_PAGE,
  });
  if (error) return failed("the employers on file", error);
  const o = (data ?? {}) as { total?: unknown; rows?: unknown };
  const rows = Array.isArray(o.rows) ? (o.rows as QueueRow[]).filter((r) => r && typeof r.person_id === "string") : [];
  return { ok: true, data: { total: typeof o.total === "number" ? o.total : rows.length, rows } };
}

export type CandidatesResult = { employer: string | null; link: LinkCard | null; candidates: Candidate[] };

export async function loadCandidates(db: AppSupabase, centerId: string, personId: string): Promise<Loaded<CandidatesResult>> {
  const { data, error } = await db.rpc("match_program_candidates", { p_center: centerId, p_person: personId });
  if (error) return failed("the directory entries this employer may be", error);
  const o = (data ?? {}) as { employer?: unknown; link?: unknown; candidates?: unknown };
  return {
    ok: true,
    data: {
      employer: typeof o.employer === "string" ? o.employer : null,
      link: o.link && typeof o.link === "object" ? (o.link as LinkCard) : null,
      candidates: Array.isArray(o.candidates) ? (o.candidates as Candidate[]) : [],
    },
  };
}

export type PublishingState = { paused: boolean; pause_reason: string | null; daily_cap: number; published_today: number };

/** Weaver's switch for this community: publishing paused (and why), the daily cap, what it published today. */
export async function loadPublishingState(db: AppSupabase, centerId: string): Promise<Loaded<PublishingState>> {
  const { data, error } = await db.rpc("match_publishing_state", { p_center: centerId });
  if (error) return failed("whether your community can publish to the directory", error);
  const o = (data ?? {}) as Partial<PublishingState>;
  return {
    ok: true,
    data: {
      paused: o.paused === true,
      pause_reason: typeof o.pause_reason === "string" ? o.pause_reason : null,
      daily_cap: typeof o.daily_cap === "number" ? o.daily_cap : 20,
      published_today: typeof o.published_today === "number" ? o.published_today : 0,
    },
  };
}

export type RecentPublish = {
  program_id: string;
  company_name: string;
  version: number;
  current_version: number;
  status: string;
  community: string | null;
  written_at: string;
  note: string | null;
};

export async function loadRecentPublishes(db: AppSupabase, days: number): Promise<Loaded<RecentPublish[]>> {
  const { data, error } = await db.rpc("platform_match_recent_publishes", { p_days: days });
  if (error) return failed("what communities published lately", error);
  return { ok: true, data: Array.isArray(data) ? (data as unknown as RecentPublish[]) : [] };
}

export type CommunityPublishing = {
  center_id: string;
  community: string;
  paused: boolean;
  pause_reason: string | null;
  daily_cap: number;
  published_today: number;
  published_week: number;
  waiting: number;
};

export async function loadCommunityPublishing(db: AppSupabase): Promise<Loaded<CommunityPublishing[]>> {
  const { data, error } = await db.rpc("platform_match_communities");
  if (error) return failed("each community's publishing", error);
  return { ok: true, data: Array.isArray(data) ? (data as unknown as CommunityPublishing[]) : [] };
}

export type ProgramVersion = { version: number; written_at: string; written_kind: string; community: string | null; note: string | null; company_name: string | null };

export async function loadProgramVersions(db: AppSupabase, id: string): Promise<Loaded<ProgramVersion[]>> {
  const { data, error } = await db.rpc("platform_match_program_versions", { p_id: id });
  if (error) return failed("this entry's versions", error);
  return { ok: true, data: Array.isArray(data) ? (data as unknown as ProgramVersion[]) : [] };
}

// ── Phase 1 (0886-0888): the members to catch, the claims and the library ────

export const CATCH_PAGE = 50;

/** The members whose gift may be matched and who have not asked, because the program has paid this community. */
export async function loadCatchList(db: AppSupabase, centerId: string, filter: "catchable" | "missed", page: number): Promise<Loaded<CatchList>> {
  const { data, error } = await db.rpc("match_catch_list", {
    p_center: centerId,
    p_filter: filter,
    p_limit: CATCH_PAGE,
    p_offset: (Math.max(1, page) - 1) * CATCH_PAGE,
  });
  if (error) return failed("the members to catch", error);
  return { ok: true, data: parseCatchList(data) };
}

export async function loadClaimsList(db: AppSupabase, centerId: string, filter: "open" | "ended", page: number): Promise<Loaded<ClaimsList>> {
  const { data, error } = await db.rpc("match_claims_list", {
    p_center: centerId,
    p_filter: filter,
    p_limit: CATCH_PAGE,
    p_offset: (Math.max(1, page) - 1) * CATCH_PAGE,
  });
  if (error) return failed("the claims", error);
  return { ok: true, data: parseClaimsList(data) };
}

export async function loadPersonGifts(db: AppSupabase, centerId: string, personId: string): Promise<Loaded<PersonGifts>> {
  const { data, error } = await db.rpc("match_person_gifts", { p_center: centerId, p_person: personId });
  if (error) return failed("this person's gifts", error);
  return { ok: true, data: parsePersonGifts(data) };
}

/** How to claim from one employer's program (the library), with how many communities were paid through it and how many matches this one received. */
export async function loadProcess(db: AppSupabase, programId: string, centerId: string | null): Promise<Loaded<ProcessAnswer>> {
  const { data, error } = await db.rpc("match_process_get", { p_program: programId, p_center: centerId ?? undefined });
  if (error) return failed("how to claim from this employer", error);
  const answer = parseProcessAnswer(data);
  // The files open through links made now, as the reader (the bucket's policy decides), good for an hour. A link that cannot be made never hides the steps.
  if (answer.files.length > 0) {
    const signed = await db.storage.from(LIBRARY_BUCKET).createSignedUrls(answer.files.map((f) => f.path), 3600);
    if (signed.error || !signed.data) {
      console.error("[matching] could not make links for the library's files:", signed.error);
      return { ok: true, data: { ...answer, filesNotice: `The files could not be opened just now (${explainError(signed.error)}). Reload the page to try again.` } };
    }
    const urls = new Map(signed.data.flatMap((s) => (s.path && s.signedUrl ? [[s.path, s.signedUrl] as const] : [])));
    return { ok: true, data: { ...answer, files: answer.files.map((f) => ({ ...f, url: urls.get(f.path) ?? null })) } };
  }
  return { ok: true, data: answer };
}

export const LIBRARY_PAGE = 50;

export async function loadProcessList(db: AppSupabase, query: string, page: number): Promise<Loaded<{ total: number; rows: ProcessListRow[] }>> {
  const { data, error } = await db.rpc("match_process_list", {
    p_query: query || undefined,
    p_limit: LIBRARY_PAGE,
    p_offset: (Math.max(1, page) - 1) * LIBRARY_PAGE,
  });
  if (error) return failed("the how-to-claim library", error);
  return { ok: true, data: parseProcessList(data) };
}

// ── Piece 0 (0920): asking families for their employer ───────────────────────

export const ASK_PAGE = 50;

export async function loadAskList(db: AppSupabase, centerId: string, page: number): Promise<Loaded<AskList>> {
  const { data, error } = await db.rpc("match_employer_ask_list", {
    p_center: centerId,
    p_limit: ASK_PAGE,
    p_offset: (Math.max(1, page) - 1) * ASK_PAGE,
  });
  if (error) return failed("the families to ask", error);
  return { ok: true, data: parseAskList(data) };
}

// ── Piece 1 (0921): sending the claim message ────────────────────────────────

export async function loadClaimMessage(db: AppSupabase, centerId: string, personId: string, programId: string): Promise<Loaded<ClaimMessagePreview>> {
  const { data, error } = await db.rpc("match_claim_message_preview", { p_center: centerId, p_person: personId, p_program: programId });
  if (error) return failed("the message to send", error);
  return { ok: true, data: parseClaimMessagePreview(data) };
}

// ── Piece 3 (0925): recording the match in Giving ────────────────────────────

export async function loadMatchClaim(db: AppSupabase, centerId: string, claimId: string): Promise<Loaded<ClaimDetail>> {
  const { data, error } = await db.rpc("match_claim_get", { p_center: centerId, p_claim: claimId });
  if (error) return failed("this claim", error);
  const detail = parseClaimDetail(data);
  if (!detail) return { ok: false, error: "Could not load this claim: the answer was not what was expected. Reload the page." };
  return { ok: true, data: detail };
}
