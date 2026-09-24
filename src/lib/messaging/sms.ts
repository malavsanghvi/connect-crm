// SMS length: GSM-7 text fits 160 characters in one segment (153 per segment
// once split); the extension characters (^ { } \ [ ] ~ | €) count twice. Any
// other character (Gujarati, Hindi, emoji, "·", curly quotes) makes the whole
// text Unicode (UCS-2): 70 characters, then 67 per segment, counted in UTF-16
// code units (an emoji is two).
//
// Shared by the portal (template editor, Settings › Texting) and the worker
// (messaging.send stores the exact count). Pure: no imports.

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENSION = "^{}\\[~]|€\f";

const basic = new Set(Array.from(GSM_BASIC));
const extension = new Set(Array.from(GSM_EXTENSION));

export type SmsLength = {
  encoding: "gsm7" | "ucs2";
  /** Units counted against the limit: septets for GSM-7, UTF-16 code units for UCS-2. */
  units: number;
  segments: number;
  /** Units per segment for this text (160/153 or 70/67). */
  perSegment: number;
  /** Characters that forced Unicode, if any (first few, for the editor's hint). */
  unicodeChars: string[];
};

export function smsLength(text: string): SmsLength {
  let septets = 0;
  const unicodeChars: string[] = [];
  for (const ch of Array.from(text)) {
    if (basic.has(ch)) septets += 1;
    else if (extension.has(ch)) septets += 2;
    else if (unicodeChars.length < 5 && !unicodeChars.includes(ch)) unicodeChars.push(ch);
  }
  if (unicodeChars.length === 0) {
    const segments = septets === 0 ? 0 : septets <= 160 ? 1 : Math.ceil(septets / 153);
    return { encoding: "gsm7", units: septets, segments, perSegment: septets <= 160 ? 160 : 153, unicodeChars };
  }
  const units = text.length; // UTF-16 code units
  const segments = units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67);
  return { encoding: "ucs2", units, segments, perSegment: units <= 70 ? 70 : 67, unicodeChars };
}

/** "2 segments · Unicode (because of “·”)" — the editor's line under a text. */
export function smsLengthText(text: string): string {
  const l = smsLength(text);
  if (l.segments === 0) return "Empty";
  const seg = `${l.segments} segment${l.segments === 1 ? "" : "s"}`;
  if (l.encoding === "gsm7") return `${seg} · ${l.units} of ${l.segments <= 1 ? 160 : l.segments * 153} characters`;
  const why = l.unicodeChars.map((c) => `“${c}”`).join(" ");
  return `${seg} · Unicode, ${l.units} of ${l.segments <= 1 ? 70 : l.segments * 67} characters (because of ${why})`;
}

/** Keywords carriers require (CTIA): what an inbound text asks for, if anything. */
export function smsKeyword(body: string): "stop" | "start" | "help" | null {
  const w = body.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"].includes(w)) return "stop";
  if (["START", "YES", "UNSTOP", "SUBSCRIBE"].includes(w)) return "start";
  if (["HELP", "INFO"].includes(w)) return "help";
  return null;
}
