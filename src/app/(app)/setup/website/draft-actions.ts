"use server";

// Setup › Your website › the first draft (B92 W3, migrations 0642 to 0644). "Build my first draft" turns what Weaver found on
// the organization's website (and what it likes) plus Weaver's own records into a draft of the new website, stored as data
// (app.site_draft_save). "Approve page" marks a page of the draft accepted (app.site_page_set_status). settings.manage ("setup"
// access); the database checks it again. NOTHING IS PUBLISHED: the draft is seen only in the private preview.

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import type { Json } from "@/lib/database.types";
import { failure, type ActionResult } from "@/lib/errors";
import { authorizeAction } from "@/lib/session";
import { readOwnCrawl, readReferenceHints, type OwnCrawl, type ReferenceHints } from "@/lib/site-draft/crawl";
import { generateDraft } from "@/lib/site-draft/generate";
import { PAGE_STATUSES, type DraftSummary, type PageStatus } from "@/lib/site-draft/types";
import { parseSiteStatus, readIsCurrent } from "@/lib/site-found";

import { loadDraftSummary, loadWeaverData } from "./draft-load";

const PATH = "/setup/website";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the first draft of the website. `replace` false refuses when a draft already exists (the database says so in words);
 * true starts the draft again, which clears the approvals on its pages.
 */
export async function buildFirstDraftAction(replace: boolean): Promise<ActionResult<DraftSummary>> {
  return withActivity("website.build_draft", () => buildFirstDraft(replace === true));
}

async function buildFirstDraft(replace: boolean): Promise<ActionResult<DraftSummary>> {
  const doing = "build the first draft of your website";
  const auth = await authorizeAction("setup", doing);
  if (!auth.ok) return auth;
  const { db, center, kind } = auth.session;

  // Which websites have been read, and are the reads of the addresses saved now?
  const st = await db.rpc("site_found_status", { p_center: center.id });
  if (st.error) return failure(`Could not ${doing}`, st.error);
  const status = parseSiteStatus(st.data);
  if (!status) {
    console.error("[setup/website] site_found_status returned an unexpected shape:", st.data);
    return { ok: false, error: `Could not ${doing} — the database answered in a shape this screen does not understand (has the latest migration been applied?).` };
  }
  const finished = status.jobs.filter((j) => j.status === "done" && readIsCurrent(j, status));
  const ownJob = finished.find((j) => j.slot === "own") ?? null;
  const refJobs = finished.filter((j) => j.slot !== "own");
  if (status.ownUrl !== null && !ownJob) {
    return { ok: false, error: `Could not ${doing} — Weaver has not finished looking at your website yet. Wait for it to finish, or press Look at my website, then try again.` };
  }
  if (!ownJob && refJobs.length === 0) {
    return { ok: false, error: `Could not ${doing} — Weaver has not looked at a website yet. Press Look at my website first.` };
  }

  // The finished reads, in full.
  let own: OwnCrawl | null = null;
  const references: ReferenceHints[] = [];
  for (const job of [ownJob, ...refJobs]) {
    if (!job) continue;
    const rep = await db.rpc("site_found_report", { p_center: center.id, p_job: job.id });
    if (rep.error) return failure(`Could not ${doing}`, rep.error);
    const result = rep.data && typeof rep.data === "object" ? (rep.data as { result?: unknown }).result : null;
    if (job.slot === "own") {
      own = readOwnCrawl(result);
      if (!own) {
        console.error("[setup/website] the finished read of the organization's own website is not a report this screen understands, job", job.id);
        return { ok: false, error: `Could not ${doing} — the report of your website is not in a form Weaver understands. Press Look at my website to read it again.` };
      }
    } else {
      const hints = readReferenceHints(result);
      if (hints) references.push(hints);
      else console.error("[setup/website] the finished read of a website the organization likes is not a report this screen understands, job", job.id);
    }
  }

  const weaver = await loadWeaverData(db, center.id, doing);
  if (!weaver.ok) return weaver;

  let draft;
  try {
    draft = generateDraft({ own, references, weaver: weaver.data, kind });
  } catch (err) {
    return failure(`Could not ${doing}`, err);
  }

  const saved = await db.rpc("site_draft_save", { p_center: center.id, p_draft: draft as unknown as Json, ...(ownJob ? { p_job: ownJob.id } : {}), p_replace: replace });
  if (saved.error) return failure(`Could not ${doing}`, saved.error);

  revalidatePath(PATH);
  revalidatePath(`${PATH}/preview`);
  const standIns = draft.pages.reduce((n, p) => n + p.blocks.filter((b) => b.needs_text).length, 0);
  const message =
    `Your first draft is ready: ${draft.pages.length} ${draft.pages.length === 1 ? "page" : "pages"}. ` +
    (standIns > 0 ? `${standIns} ${standIns === 1 ? "part has" : "parts have"} short stand-in text for you to replace. ` : "") +
    "Nothing is published: only you and the other people who manage settings can see it.";
  // The draft is saved either way; when its summary cannot be read back right now, the screen asks again.
  const summary = await loadDraftSummary(db, center.id, doing);
  return summary.ok && summary.summary ? { ok: true, message, data: summary.summary } : { ok: true, message };
}

/** Approve a page of the draft, or reopen it. Nothing is published by either. */
export async function setDraftPageStatusAction(pageId: string, status: string): Promise<ActionResult<{ pageId: string; status: PageStatus }>> {
  return withActivity("website.approve_page", () => setPageStatus(pageId, status));
}

async function setPageStatus(pageId: string, status: string): Promise<ActionResult<{ pageId: string; status: PageStatus }>> {
  const approving = status === "approved";
  const doing = approving ? "approve this page" : "reopen this page";
  const auth = await authorizeAction("setup", doing);
  if (!auth.ok) return auth;
  if (typeof pageId !== "string" || !UUID.test(pageId)) return { ok: false, error: `Could not ${doing} — Weaver does not know which page that is.` };
  if (!(PAGE_STATUSES as readonly string[]).includes(status)) return { ok: false, error: `Could not ${doing} — a page is either a draft or approved.` };
  const { db, center } = auth.session;
  const { error } = await db.rpc("site_page_set_status", { p_center: center.id, p_page: pageId, p_status: status });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath(`${PATH}/preview`);
  revalidatePath(PATH);
  return {
    ok: true,
    message: approving ? "Page approved. Nothing is published yet." : "Page reopened as a draft.",
    data: { pageId, status: status as PageStatus },
  };
}
