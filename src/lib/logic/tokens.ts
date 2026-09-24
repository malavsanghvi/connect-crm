// Tokens for QR codes. Generated with the Web Crypto API (browser and Node).

export const ATTENDANCE_TOKEN_MINUTES = 10;

export function randomToken(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function tokenExpiry(now: Date = new Date(), minutes = ATTENDANCE_TOKEN_MINUTES): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export function secondsLeft(expiresAt: string | null, now: Date = new Date()): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((Date.parse(expiresAt) - now.getTime()) / 1000));
}

/**
 * Text encoded in the class attendance QR. The member app reads the session id
 * and token from it. (Format to be confirmed with connect-mobile.)
 */
export function attendanceQrPayload(sessionId: string, token: string): string {
  return `connect:pathshala-attendance?session=${sessionId}&token=${token}`;
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
