// The mail-merge renderer the portal's preview uses. It reads {{name}} exactly as app.render_message_text (0221) does when a
// message is queued: letters, digits and underscores, spaces inside the braces allowed. Values are plain text: the email is
// built from plain text and src/lib/messaging/email.ts escapes every character, so a value can never inject HTML.
//
// Pure (no "@/" imports): the background service imports it too.

export const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Every placeholder name the text uses, once each, in order. */
export function placeholdersIn(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(PLACEHOLDER_RE)) {
    const name = m[1] ?? "";
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The names the text uses that this email does not have. */
export function unknownPlaceholders(text: string | null | undefined, allowed: readonly string[]): string[] {
  return placeholdersIn(text).filter((n) => !allowed.includes(n));
}

/** Text that looks like a placeholder but is not one ("{{ pledge amount }}", "{pledge_amount}", "{{pledge_amount}"). */
export function brokenPlaceholders(text: string | null | undefined): string[] {
  const t = (text ?? "").replace(PLACEHOLDER_RE, "");
  const out: string[] = [];
  for (const m of t.matchAll(/\{\{[^{}]*\}?\}?|\{[A-Za-z0-9_]+\}/g)) {
    const s = m[0].trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export type MergeSegment =
  | { kind: "text"; text: string }
  | { kind: "value"; name: string; text: string }
  | { kind: "missing"; name: string; text: string }
  | { kind: "unknown"; name: string; text: string };

/**
 * The text split into what was typed and what each placeholder becomes, for a preview that marks values the record does not
 * have ("missing": the email's own wording for it, shown in brackets) and names the email does not know ("unknown").
 * `values`: a name's value, null when the record has none; `missing`: what the email says then.
 */
export function mergeSegments(
  text: string,
  values: Readonly<Record<string, string | null>>,
  missing: Readonly<Record<string, string>> = {},
): MergeSegment[] {
  const out: MergeSegment[] = [];
  let at = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const start = m.index ?? 0;
    if (start > at) out.push({ kind: "text", text: text.slice(at, start) });
    const name = m[1] ?? "";
    if (!(name in values)) out.push({ kind: "unknown", name, text: m[0] });
    else if (values[name] === null || values[name] === "") out.push({ kind: "missing", name, text: missing[name] ?? "" });
    else out.push({ kind: "value", name, text: values[name] as string });
    at = start + m[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

/**
 * The text with every placeholder filled, as the email will say it: a value the record lacks becomes the email's own wording
 * for it, an unknown name stays as typed (the database refuses to save such wording, so only a preview meets one).
 */
export function renderMerge(text: string, values: Readonly<Record<string, string | null>>, missing: Readonly<Record<string, string>> = {}): string {
  return mergeSegments(text, values, missing)
    .map((s) => s.text)
    .join("");
}

/** A value fit for a subject line or a one-line field: no line breaks, no control characters, spaces collapsed. */
export function oneLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s{2,}/g, " ").trim();
}
