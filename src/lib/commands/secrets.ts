// One-time secrets never reach a model (ADMIN_REDESIGN "Rules Niva always follows": "Never sees secrets or one-time links. Secrets go
// through secure fields; codes go through the security window"). Some Server Actions today return them in their result (the
// sandbox code, the owner invitation link). This strips them from anything a command returns to the assistant, whatever the
// command did: by the name of the value, and by what the value looks like.

export const HIDDEN_VALUE = "[hidden: kept private]";
export const HIDDEN_LINK = "[hidden link: kept private]";

/** Keys that hold a secret or a one-time value. Matched on the whole key (camelCase is read as snake_case). */
const SECRET_KEY = new RegExp(
  [
    // A bare code or pin, and the named kinds of one-time code.
    "^(code|otp|pin|passcode|pass_code)$",
    "^(sandbox|sign_in|signin|login|auth|access|invite|invitation|verification|verify|confirmation|reset|security|recovery|backup|one_time|onetime)_(code|codes|pin)$",
    // Anything that is a credential by name.
    "(^|_)(token|tokens|secret|secrets|password|passwords|passphrase|credential|credentials|authorization|cookie|cookies|bearer)(_|$)",
    "(^|_)(api_?key|apikey|private_?key|secret_?key|access_?key|signing_?key|service_?role|webhook_?secret|client_?secret|encryption_?key)(_|$)",
    // A one-time or signed link.
    "^(invite|invitation|magic|reset|signin|sign_in|login|claim|accept|verify|verification|signed|download|checkout|setup)_(link|links|url|urls)$",
    "(^|_)(link|url)_(token|secret|code)$",
  ].join("|"),
  "i",
);

/** What a secret looks like inside a longer text. */
const SECRET_IN_TEXT: { pattern: RegExp; replacement: string }[] = [
  // A link that carries a token, a code or a signature in its query string.
  { pattern: /https?:\/\/[^\s"'<>]*[?&](?:token|code|invite|invitation|key|secret|sig|signature|otp|access_token|auth|ticket)=[^\s"'<>]*/gi, replacement: HIDDEN_LINK },
  // A link whose path is an invitation, a reset, a claim or a magic link followed by a long random part.
  { pattern: /https?:\/\/[^\s"'<>]*\/(?:invite|invitation|accept|claim|reset|magic|verify|redeem|join)\/[A-Za-z0-9_-]{12,}[^\s"'<>]*/gi, replacement: HIDDEN_LINK },
  // The portal's own invitation placeholder, before the worker puts the address in.
  { pattern: /%PORTAL_URL%\/[^\s"'<>]*/g, replacement: HIDDEN_LINK },
  // Keys of the services this app talks to.
  { pattern: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g, replacement: HIDDEN_VALUE },
  { pattern: /\bwhsec_[A-Za-z0-9]{8,}\b/g, replacement: HIDDEN_VALUE },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{8,}\b/g, replacement: HIDDEN_VALUE },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: HIDDEN_VALUE },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: HIDDEN_VALUE },
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, replacement: HIDDEN_VALUE },
  // A signed token (JWT) and a bearer header.
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replacement: HIDDEN_VALUE },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, replacement: HIDDEN_VALUE },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: HIDDEN_VALUE },
];

function snake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[-\s.]+/g, "_").toLowerCase();
}

/** True when a key names a secret or a one-time value. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(snake(key));
}

/** A text with every secret-looking part replaced. */
export function scrubSecretText(text: string): string {
  let out = text;
  for (const { pattern, replacement } of SECRET_IN_TEXT) out = out.replace(pattern, replacement);
  return out;
}

export type SecretStrip<T> = { value: T; removed: number };

/**
 * A copy of `value` with every secret removed: entries whose key names a secret are dropped, and secret-looking parts of any
 * text are replaced. `removed` counts what was taken out (for the record, never shown to the model).
 */
export function stripSecrets<T>(value: T): SecretStrip<T> {
  let removed = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const clean = scrubSecretText(v);
      if (clean !== v) removed += 1;
      return clean;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (isSecretKey(k)) {
          removed += 1;
          continue;
        }
        out[k] = walk(child);
      }
      return out;
    }
    return v;
  };
  return { value: walk(value) as T, removed };
}
