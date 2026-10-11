"use server";

// Setup › Your website (B92 W2, migration 0640). The organization gives its own website and up to three it likes
// (app.site_found_save_inputs), presses "Look at my website" (app.site_crawl_start → worker site.crawl), and reads
// "What we found" (app.site_found_status, app.site_found_report). settings.manage ("setup" access); the database
// checks it again. Nothing is drafted or published here.

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { failure, type ActionResult } from "@/lib/errors";
import { checkSiteInputs, isSlot } from "@/lib/site-found";
import { authorizeAction } from "@/lib/session";

import { loadSnapshot, rpc, type Snapshot } from "./load";

const PATH = "/setup/website";

/** Save the addresses. Returns the saved addresses (and the reads so far) so the screen shows what was kept. */
export async function saveSiteAddressesAction(own: string, refs: string[]): Promise<ActionResult<Snapshot>> {
  return withActivity("website.save_addresses", () => saveAddresses(own, refs));
}

async function saveAddresses(own: string, refs: string[]): Promise<ActionResult<Snapshot>> {
  const doing = "save the website addresses";
  const auth = await authorizeAction("setup", doing);
  if (!auth.ok) return auth;
  const checked = checkSiteInputs(typeof own === "string" ? own : "", Array.isArray(refs) ? refs.filter((r): r is string => typeof r === "string") : []);
  if (!checked.ok) return { ok: false, error: `Could not ${doing} — ${checked.error}` };
  const { db, center } = auth.session;
  const { error } = await rpc(db)("site_found_save_inputs", { p_center: center.id, p_own: checked.own, p_refs: checked.refs });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath(PATH);
  const message = "Website addresses saved.";
  // The save worked either way; when the screen's details cannot be read back right now it asks again.
  const snap = await loadSnapshot(db, center.id, []);
  return snap.ok ? { ok: true, message, data: snap.data } : { ok: true, message };
}

/**
 * Ask the background service to read the saved websites: all of them, or just one (`slot`, for Try again). The addresses
 * read are always the saved ones. At most 8 reads an hour; one at a time per website (the database says so in words).
 */
export async function lookAtWebsiteAction(slot?: string): Promise<ActionResult<Snapshot>> {
  return withActivity("website.look_at_site", () => lookAtWebsite(slot));
}

async function lookAtWebsite(slot?: string): Promise<ActionResult<Snapshot>> {
  const doing = "start looking at the website";
  const auth = await authorizeAction("setup", doing);
  if (!auth.ok) return auth;
  if (slot !== undefined && slot !== null && !isSlot(slot)) return { ok: false, error: `Could not ${doing} — Weaver does not know which website that is.` };
  const { db, center } = auth.session;
  const { error } = await rpc(db)("site_crawl_start", { p_center: center.id, p_slot: slot ?? null });
  if (error) return failure(`Could not ${doing}`, error);
  const message = slot ? "Looking at that website again. This usually takes one to three minutes." : "Looking at your websites. This usually takes one to three minutes.";
  // The reads are queued either way; when the status cannot be read back right now, the screen asks again.
  const snap = await loadSnapshot(db, center.id, []);
  return snap.ok ? { ok: true, message, data: snap.data } : { ok: true, message };
}

/** The status again (while a read is on its way), with the reports the screen does not have yet. */
export async function siteStatusAction(have: number[]): Promise<ActionResult<Snapshot>> {
  const doing = "check on the websites";
  const auth = await authorizeAction("setup", doing);
  if (!auth.ok) return auth;
  const known = Array.isArray(have) ? have.filter((n): n is number => Number.isInteger(n)).slice(0, 50) : [];
  const { db, center } = auth.session;
  const snap = await loadSnapshot(db, center.id, known, doing);
  return snap.ok ? { ok: true, data: snap.data } : { ok: false, error: snap.error };
}
