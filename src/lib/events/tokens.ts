// Ticket tokens read by the check-in scanner (moved from connect-admin lib/logic/tokens.ts).

export function randomToken(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Pull a ticket token out of whatever the scanner read: a bare token, a URL
 * with ?t= / ?token=, or a "connect:ticket?token=" payload.
 */
export function extractTicketToken(scanned: string): string {
  const text = scanned.trim();
  const param = /[?&](?:t|token)=([^&#\s]+)/i.exec(text);
  if (param) return decodeURIComponent(param[1]);
  const hex = /\b([0-9a-f]{32})\b/i.exec(text);
  if (hex) return hex[1].toLowerCase();
  return text;
}
