import { NextResponse } from "next/server";

import { workerQuery } from "@/lib/messaging/server-db";
import { verifyLink } from "@/lib/messaging/signatures";

// The "Unsubscribe" link in every newsletter / notification email (and the
// List-Unsubscribe one-click POST). The link carries the message id and an HMAC
// (MESSAGING_LINK_SECRET), so nobody can unsubscribe someone else by guessing.
// Receipts and sign-in codes still go; only newsletters and notifications stop.
export const dynamic = "force-dynamic";

function page(status: number, title: string, text: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return new NextResponse(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>` +
      `<body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1f1a14"><h1 style="font-size:1.4rem">${esc(title)}</h1><p>${esc(text)}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const m = url.searchParams.get("m") ?? "";
  const secret = process.env.MESSAGING_LINK_SECRET?.trim();
  if (!secret) {
    console.error("[unsubscribe] MESSAGING_LINK_SECRET is not set on the portal server");
    return page(503, "Could not unsubscribe", "Unsubscribing isn't configured on the Community Connect server yet. Reply to the email and ask to be removed.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(m) || !verifyLink(secret, m, url.searchParams.get("s"))) {
    return page(400, "This link is not valid", "The unsubscribe link is incomplete or was changed. Use the link in the email, or reply to it and ask to be removed.");
  }
  try {
    const rows = await workerQuery<{ r: { center_name: string; address: string } | null }>("select app.worker_unsubscribe($1) as r", [m]);
    if (rows === null) return page(503, "Could not unsubscribe", "Unsubscribing isn't configured on the Community Connect server yet. Reply to the email and ask to be removed.");
    const r = rows[0]?.r;
    if (!r) return page(404, "Message not found", "We could not find the email this link belongs to. Reply to the email and ask to be removed.");
    return page(200, "You are unsubscribed", `${r.address} will get no more newsletters or notifications by email from ${r.center_name}. Receipts and sign-in codes still arrive.`);
  } catch (err) {
    console.error("[unsubscribe] could not record the opt-out:", err instanceof Error ? err.message : err);
    return page(500, "Could not unsubscribe", "Something went wrong on our side and nothing was changed. Try the link again in a minute.");
  }
}

export const GET = handle;
export const POST = handle;
