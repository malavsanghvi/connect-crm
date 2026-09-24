import { NextResponse, type NextRequest } from "next/server";

// Where Stripe and PayPal send the payer after the checkout page. Nothing is
// recorded here (the provider's webhook does that); it only says what happens
// next. It never redirects to an address taken from the query string.
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const cancelled = q.get("result") === "cancel";
  const toSettings = q.get("to") === "settings";
  const title = cancelled ? "Payment cancelled" : "Thank you";
  const body = cancelled
    ? "Nothing was charged. You can close this window and go back."
    : "Your payment was sent. Community Connect records it as soon as the payment provider confirms it — usually within a minute. You can close this window and go back to the app.";
  const link = toSettings ? `<p><a href="/settings/payments">Back to Settings › Payments</a></p>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f2937}h1{font-size:1.5rem}</style></head>
<body><h1>${esc(title)}</h1><p>${esc(body)}</p>${link}</body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
