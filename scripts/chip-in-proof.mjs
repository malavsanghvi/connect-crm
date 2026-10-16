#!/usr/bin/env node
// Starts ONE test-mode payment for the Stripe proof of the optional Chip In and the covered card fee (docs/STRIPE_CHIP_IN_PROOF.md),
// the way the member app's Pay sheet will, until that sheet ships. It signs in as a member with the member's own e-mail code, asks the
// database for the quote (app.payment_addons_quote), shows the lines, then starts the checkout through the portal's route
// (POST /api/payments/intent) with the total it was shown, and prints the Stripe page to open. It does not pay: you do, on Stripe's page,
// with a Stripe TEST card. Nothing is written to disk. The member's access token lives in this process only and is never printed.
//
//   SUPABASE_URL=https://<project>.supabase.co  SUPABASE_ANON_KEY=<the public anon key>  PORTAL_URL=https://<the portal>
//   node scripts/chip-in-proof.mjs --email member@example.org --center <uuid> --household <uuid> --pledge <uuid> --gift 10000 \
//        [--cover-fee] [--chip-in 500] [--method card|ach] [--expect 10845] [--dry-run]
//
// --gift, --chip-in and --expect are cents. --expect sends that as "the total the payer saw" instead of the quote's, to see the database
// refuse a total that changed. --dry-run prints what would be sent and signs nobody in. The anon key is the public one every app
// ships (NEXT_PUBLIC_SUPABASE_ANON_KEY); no secret key is ever needed here.

import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** $12.34 from cents, in integer arithmetic. */
export function usd(cents) {
  const c = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}$${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

/** The command line → options, or { error } in a plain sentence. */
export function parseArgs(argv, env = {}) {
  const o = { email: "", center: "", household: "", pledge: "", gift: 0, coverFee: false, chipIn: 0, method: null, expect: null, dryRun: false,
              supabase: (env.SUPABASE_URL || "").replace(/\/+$/, ""), anon: env.SUPABASE_ANON_KEY || "", portal: (env.PORTAL_URL || "").replace(/\/+$/, "") };
  const value = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value.`);
    return v;
  };
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--cover-fee") o.coverFee = true;
      else if (a === "--dry-run") o.dryRun = true;
      else if (a === "--email") o.email = value(i++, a);
      else if (a === "--center") o.center = value(i++, a);
      else if (a === "--household") o.household = value(i++, a);
      else if (a === "--pledge") o.pledge = value(i++, a);
      else if (a === "--gift") o.gift = Number(value(i++, a));
      else if (a === "--chip-in") o.chipIn = Number(value(i++, a));
      else if (a === "--method") o.method = value(i++, a);
      else if (a === "--expect") o.expect = Number(value(i++, a));
      else if (a === "--portal") o.portal = value(i++, a).replace(/\/+$/, "");
      else throw new Error(`I do not know ${a}.`);
    }
  } catch (e) {
    return { error: e.message };
  }
  if (!UUID.test(o.center)) return { error: "--center must be the organization's id (a uuid)." };
  if (!UUID.test(o.household)) return { error: "--household must be the family's id (a uuid)." };
  if (!UUID.test(o.pledge)) return { error: "--pledge must be an open pledge of that family (a uuid)." };
  if (!Number.isSafeInteger(o.gift) || o.gift < 50) return { error: "--gift must be at least 50, in whole cents (10000 is $100.00)." };
  if (!Number.isSafeInteger(o.chipIn) || o.chipIn < 0) return { error: "--chip-in must be whole cents, 0 or more (500 is $5.00)." };
  if (o.method !== null && o.method !== "card" && o.method !== "ach") return { error: "--method must be card or ach." };
  if (o.expect !== null && (!Number.isSafeInteger(o.expect) || o.expect < 0)) return { error: "--expect must be whole cents, 0 or more." };
  if (!o.dryRun && !o.email) return { error: "--email is the member you sign in as." };
  if (!o.portal) return { error: "Set PORTAL_URL (or --portal) to the portal's address." };
  if (!o.dryRun && (!o.supabase || !o.anon)) return { error: "Set SUPABASE_URL and SUPABASE_ANON_KEY (the public ones every app ships)." };
  return { options: o };
}

/** The arguments of app.payment_addons_quote: only what was chosen. */
export function quoteArgs(o) {
  return {
    p_center: o.center, p_household: o.household, p_gift_cents: o.gift, p_pledge_ids: [o.pledge], p_context: "pledges", p_processor: "stripe",
    ...(o.method ? { p_method: o.method } : {}), ...(o.coverFee ? { p_cover_fee: true } : {}), ...(o.chipIn > 0 ? { p_chip_in_cents: o.chipIn } : {}),
  };
}

/** The body of POST /api/payments/intent: the choices, and the total the quote showed (so a changed total is refused, not charged). */
export function intentBody(o, quote) {
  return {
    center_id: o.center, household_id: o.household, amount_cents: o.gift, pledge_ids: [o.pledge], processor: "stripe", context: "pledges",
    for_label: "Stripe test-mode proof",
    ...(o.coverFee ? { cover_fee: true } : {}), ...(o.chipIn > 0 ? { chip_in_cents: o.chipIn } : {}),
    ...(o.method ? { pay_method: o.method } : {}),
    ...(o.expect !== null ? { expected_total_cents: o.expect } : quote && Number.isSafeInteger(quote.total_cents) ? { expected_total_cents: quote.total_cents } : {}),
  };
}

/** The lines a quote shows, one per row, and what is not offered. */
export function describeQuote(q) {
  const out = (q.lines || []).map((l) => `  ${String(l.label).padEnd(40)} ${usd(l.cents).padStart(10)}`);
  out.push(`  ${"Total charged to the card".padEnd(40)} ${usd(q.total_cents).padStart(10)}`);
  out.push(`  Weaver's application fee on the charge: ${usd(q.application_fee_cents || 0)}; the organization is charged ${usd(q.org_charge_cents)}; method: ${q.pay_method || "(none)"}; mode: ${q.mode}`);
  for (const r of q.refusals || []) out.push(`  NOT OFFERED: ${r.message} (${r.reason})`);
  return out.join("\n");
}

async function json(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2), process.env);
  if (parsed.error) {
    console.error(parsed.error);
    process.exitCode = 2;
    return;
  }
  const o = parsed.options;
  if (o.dryRun) {
    console.log("Would ask app.payment_addons_quote with:\n" + JSON.stringify(quoteArgs(o), null, 2));
    console.log("\nand then POST " + o.portal + "/api/payments/intent with (expected_total_cents is added from the quote):\n" + JSON.stringify(intentBody(o, null), null, 2));
    return;
  }
  const anon = { apikey: o.anon, "content-type": "application/json" };
  const sent = await fetch(`${o.supabase}/auth/v1/otp`, { method: "POST", headers: anon, body: JSON.stringify({ email: o.email, create_user: false }) });
  if (!sent.ok) {
    console.error(`The sign-in code could not be sent to ${o.email} (${sent.status}): ${JSON.stringify(await json(sent)).slice(0, 200)}`);
    process.exitCode = 1;
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question(`Code that was e-mailed to ${o.email}: `)).trim();
  rl.close();
  const verified = await json(await fetch(`${o.supabase}/auth/v1/verify`, { method: "POST", headers: anon, body: JSON.stringify({ type: "email", email: o.email, token: code }) }));
  const token = verified.access_token;
  if (typeof token !== "string") {
    console.error(`That code was not accepted: ${JSON.stringify(verified).slice(0, 200)}`);
    process.exitCode = 1;
    return;
  }

  const asMember = { ...anon, authorization: `Bearer ${token}`, "accept-profile": "app", "content-profile": "app" };
  const quoted = await fetch(`${o.supabase}/rest/v1/rpc/payment_addons_quote`, { method: "POST", headers: asMember, body: JSON.stringify(quoteArgs(o)) });
  const quote = await json(quoted);
  if (!quoted.ok) {
    console.error(`The quote was refused (${quoted.status}): ${quote.message || JSON.stringify(quote).slice(0, 200)}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nThe database's quote:\n" + describeQuote(quote));
  if (!quote.ok) console.log("\nSomething you asked for is not offered; it is left out of the numbers above and the checkout will be refused.");

  const res = await fetch(`${o.portal}/api/payments/intent`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(intentBody(o, quote)) });
  const body = await json(res);
  if (!res.ok) {
    console.error(`\nThe checkout was not started (${res.status}${body.code ? ` ${body.code}` : ""}): ${body.error || JSON.stringify(body).slice(0, 300)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nCheckout ${body.checkout_id} (${body.processor}, ${body.mode} mode). The route says the card will be charged ${usd(body.total_cents ?? quote.total_cents)}.`);
  console.log("Open this page and pay with a Stripe TEST card (docs/STRIPE_CHIP_IN_PROOF.md section 4):\n\n  " + body.url + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`Stopped: ${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  });
}
