// The platform setup wizard (/platform/setup, onboarding Wave D): Community
// Connect's own providers and infrastructure, entered once by the super admin.
// Pure and shared: the portal renders it, the worker (worker/src) and the
// portal server use the same names when they read the saved values.
//
// Every field name is the environment variable it replaces, so a value saved in
// the wizard overrides the server's environment for exactly that variable
// (database first, environment as the fallback). Two settings are not env names:
// portal_domain and wildcard_domain (o-https reads them for HTTPS).
//
// app.platform_secret_names() / app.platform_setting_keys() (0320) hold the same
// lists; tests/platform-setup.test.ts keeps them in step with this file.

export type StepKey = "background" | "portal" | "email" | "hooks" | "payments" | "texting" | "quickbooks" | "ai" | "push" | "wildcard";
export type FieldKind = "secret" | "setting";

export type Field = {
  name: string;
  kind: FieldKind;
  label: string;
  hint: string;
  placeholder?: string;
  /** A select instead of a text box (settings only). */
  options?: { value: string; label: string }[];
  /** The server can make a strong random value for it ("Generate"). */
  generate?: boolean;
};

export type Step = {
  key: StepKey;
  required: boolean;
  title: string;
  what: string;
  why: string;
  fields: Field[];
  /** The worker can test it with the saved keys (platform.test_provider). */
  workerTest: boolean;
};

const F = {
  portal_domain: { name: "portal_domain", kind: "setting", label: "Portal address", hint: "The name staff type to reach the portal, without https:// — for example crm.communityconnect.app.", placeholder: "crm.communityconnect.app" },
  wildcard_domain: { name: "wildcard_domain", kind: "setting", label: "Base domain for organizations", hint: "Each organization gets <short name>.<this domain>, for example jsh.communityconnect.app.", placeholder: "communityconnect.app" },
  MESSAGING_EMAIL_PROVIDER: { name: "MESSAGING_EMAIL_PROVIDER", kind: "setting", label: "Email provider", hint: "Resend is the default; Postmark also works.", options: [{ value: "resend", label: "Resend" }, { value: "postmark", label: "Postmark" }] },
  RESEND_API_KEY: { name: "RESEND_API_KEY", kind: "secret", label: "Resend API key", hint: "Resend › API Keys › Create (full access: it adds organizations' sending domains). Starts with re_.", placeholder: "re_…" },
  RESEND_WEBHOOK_SECRET: { name: "RESEND_WEBHOOK_SECRET", kind: "secret", label: "Resend webhook signing secret", hint: "Resend › Webhooks › the endpoint for /api/webhooks/resend › Signing secret (whsec_…).", placeholder: "whsec_…" },
  POSTMARK_SERVER_TOKEN: { name: "POSTMARK_SERVER_TOKEN", kind: "secret", label: "Postmark server token", hint: "Postmark › your server › API Tokens." },
  POSTMARK_ACCOUNT_TOKEN: { name: "POSTMARK_ACCOUNT_TOKEN", kind: "secret", label: "Postmark account token", hint: "Postmark › Account › API Tokens (needed to add organizations' domains)." },
  POSTMARK_WEBHOOK_TOKEN: { name: "POSTMARK_WEBHOOK_TOKEN", kind: "secret", label: "Postmark webhook password", hint: "The HTTP Basic password you put on the /api/webhooks/postmark webhook." },
  MESSAGING_FROM_ADDRESS: { name: "MESSAGING_FROM_ADDRESS", kind: "setting", label: "Community Connect's sender address", hint: "Used for platform email (sandbox codes, sign-in codes for people without a community sender). Its domain must be verified with the provider.", placeholder: "no-reply@mail.communityconnect.app" },
  MESSAGING_FROM_NAME: { name: "MESSAGING_FROM_NAME", kind: "setting", label: "Sender name", hint: "Shown as the sender of platform email.", placeholder: "Community Connect" },
  MESSAGING_LINK_SECRET: { name: "MESSAGING_LINK_SECRET", kind: "secret", label: "Link signing secret", hint: "Signs unsubscribe links. Use Generate: nobody needs to know it.", generate: true },
  SEND_EMAIL_HOOK_SECRET: { name: "SEND_EMAIL_HOOK_SECRET", kind: "secret", label: "Send Email hook secret", hint: "Supabase › Authentication › Hooks › Send Email hook › the secret Supabase generates (v1,whsec_…).", placeholder: "v1,whsec_…" },
  SEND_SMS_HOOK_SECRET: { name: "SEND_SMS_HOOK_SECRET", kind: "secret", label: "Send SMS hook secret", hint: "Supabase › Authentication › Hooks › Send SMS hook › its secret (v1,whsec_…). Needed only if people sign in by text.", placeholder: "v1,whsec_…" },
  STRIPE_SECRET_KEY: { name: "STRIPE_SECRET_KEY", kind: "secret", label: "Stripe live secret key", hint: "Stripe (Community Connect's platform account) › Developers › API keys › Secret key (sk_live_… or a restricted rk_live_…).", placeholder: "sk_live_…" },
  STRIPE_TEST_SECRET_KEY: { name: "STRIPE_TEST_SECRET_KEY", kind: "secret", label: "Stripe test secret key", hint: "The same page in test mode (sk_test_…). Sandboxes only ever use this one.", placeholder: "sk_test_…" },
  STRIPE_CLIENT_ID: { name: "STRIPE_CLIENT_ID", kind: "setting", label: "Stripe Connect client id", hint: "Stripe › Settings › Connect › Onboarding options › OAuth › Client ID (ca_…).", placeholder: "ca_…" },
  STRIPE_WEBHOOK_SECRET: { name: "STRIPE_WEBHOOK_SECRET", kind: "secret", label: "Stripe webhook signing secret", hint: "Stripe › Developers › Webhooks › the Connect endpoint for /api/webhooks/stripe › Signing secret (whsec_…). For test and live, separate them with a comma.", placeholder: "whsec_…" },
  PAYPAL_CLIENT_ID: { name: "PAYPAL_CLIENT_ID", kind: "setting", label: "PayPal live client id", hint: "PayPal Developer › Apps & Credentials › Live › Community Connect's partner app." },
  PAYPAL_CLIENT_SECRET: { name: "PAYPAL_CLIENT_SECRET", kind: "secret", label: "PayPal live secret", hint: "The secret of the same live app." },
  PAYPAL_SANDBOX_CLIENT_ID: { name: "PAYPAL_SANDBOX_CLIENT_ID", kind: "setting", label: "PayPal sandbox client id", hint: "PayPal Developer › Apps & Credentials › Sandbox." },
  PAYPAL_SANDBOX_CLIENT_SECRET: { name: "PAYPAL_SANDBOX_CLIENT_SECRET", kind: "secret", label: "PayPal sandbox secret", hint: "The secret of the same sandbox app." },
  PAYPAL_PARTNER_ID: { name: "PAYPAL_PARTNER_ID", kind: "setting", label: "PayPal partner (merchant) id", hint: "Needed for \"Connect with PayPal\". Without it organizations use the PayPal Business email route." },
  PAYPAL_BN_CODE: { name: "PAYPAL_BN_CODE", kind: "setting", label: "PayPal BN code", hint: "The partner attribution code PayPal gave Community Connect (optional)." },
  PAYPAL_WEBHOOK_ID: { name: "PAYPAL_WEBHOOK_ID", kind: "setting", label: "PayPal live webhook id", hint: "PayPal Developer › the live app › Webhooks › the id of the /api/webhooks/paypal webhook." },
  PAYPAL_SANDBOX_WEBHOOK_ID: { name: "PAYPAL_SANDBOX_WEBHOOK_ID", kind: "setting", label: "PayPal sandbox webhook id", hint: "The same for the sandbox app." },
  OAUTH_STATE_SECRET: { name: "OAUTH_STATE_SECRET", kind: "secret", label: "Connect-link signing secret", hint: "Signs the \"connect your account\" links for Stripe, PayPal and QuickBooks. Use Generate.", generate: true },
  TWILIO_ACCOUNT_SID: { name: "TWILIO_ACCOUNT_SID", kind: "setting", label: "Twilio account SID", hint: "Twilio console › Account info (AC…).", placeholder: "AC…" },
  TWILIO_AUTH_TOKEN: { name: "TWILIO_AUTH_TOKEN", kind: "secret", label: "Twilio auth token", hint: "Twilio console › Account info › Auth token. Also checks the signature of Twilio's webhooks." },
  TWILIO_FROM_NUMBER: { name: "TWILIO_FROM_NUMBER", kind: "setting", label: "Community Connect's number", hint: "The number platform texts (sign-in codes) come from, in international format.", placeholder: "+18325550100" },
  TWILIO_MESSAGING_SERVICE_SID: { name: "TWILIO_MESSAGING_SERVICE_SID", kind: "setting", label: "Messaging service SID", hint: "Instead of a single number (MG…), optional.", placeholder: "MG…" },
  INTUIT_CLIENT_ID: { name: "INTUIT_CLIENT_ID", kind: "setting", label: "Intuit production client id", hint: "Intuit Developer › your app › Keys & credentials › Production." },
  INTUIT_CLIENT_SECRET: { name: "INTUIT_CLIENT_SECRET", kind: "secret", label: "Intuit production client secret", hint: "The same page." },
  INTUIT_SANDBOX_CLIENT_ID: { name: "INTUIT_SANDBOX_CLIENT_ID", kind: "setting", label: "Intuit development client id", hint: "Keys & credentials › Development: reaches Intuit sandbox companies only (for organizations' sandboxes)." },
  INTUIT_SANDBOX_CLIENT_SECRET: { name: "INTUIT_SANDBOX_CLIENT_SECRET", kind: "secret", label: "Intuit development client secret", hint: "The same page." },
  INTUIT_REDIRECT_URI: { name: "INTUIT_REDIRECT_URI", kind: "setting", label: "Fixed redirect address (optional)", hint: "Leave empty to use the address the person is on. Intuit does not accept wildcards, so a fixed address is simplest.", placeholder: "https://crm.communityconnect.app/api/oauth/intuit/callback" },
  ANTHROPIC_API_KEY: { name: "ANTHROPIC_API_KEY", kind: "secret", label: "Anthropic API key", hint: "console.anthropic.com › API Keys (sk-ant-…). Powers Niva, import mapping and donor-matching suggestions.", placeholder: "sk-ant-…" },
  EXPO_ACCESS_TOKEN: { name: "EXPO_ACCESS_TOKEN", kind: "secret", label: "Expo access token (optional)", hint: "Only if \"enhanced push security\" is on for the Expo project. Push works without it." },
} satisfies Record<string, Field>;

export type FieldName = keyof typeof F;
export const FIELDS: Record<string, Field> = F;

export const STEPS: Step[] = [
  {
    key: "background", required: true, title: "Background service",
    what: "The service that sends email and texts, talks to Stripe, PayPal and QuickBooks, and runs imports.",
    why: "Almost everything an organization sets up waits on it. It also reads the keys you save in this wizard.",
    fields: [], workerTest: false,
  },
  {
    key: "portal", required: true, title: "Portal address and HTTPS",
    what: "The web address of this portal, and a certificate so it is served over HTTPS.",
    why: "Sign-in codes and sessions must never cross the network unencrypted. Provider callbacks and email links use this address.",
    fields: [F.portal_domain], workerTest: false,
  },
  {
    key: "email", required: true, title: "Email provider",
    what: "The service that delivers every email: sign-in codes, receipts, newsletters, sandbox codes.",
    why: "Supabase's built-in email reaches only its own team. Nobody else can sign in until this works.",
    fields: [F.MESSAGING_EMAIL_PROVIDER, F.RESEND_API_KEY, F.RESEND_WEBHOOK_SECRET, F.POSTMARK_SERVER_TOKEN, F.POSTMARK_ACCOUNT_TOKEN, F.POSTMARK_WEBHOOK_TOKEN,
      F.MESSAGING_FROM_ADDRESS, F.MESSAGING_FROM_NAME, F.MESSAGING_LINK_SECRET],
    workerTest: true,
  },
  {
    key: "hooks", required: true, title: "Sign-in hooks",
    what: "Supabase Auth hands every sign-in code to the portal, which sends it with the right organization's name and sender.",
    why: "One Supabase project serves every organization; without the hooks, sign-in email is unbranded and limited.",
    fields: [F.SEND_EMAIL_HOOK_SECRET, F.SEND_SMS_HOOK_SECRET], workerTest: false,
  },
  {
    key: "payments", required: false, title: "Payments",
    what: "Community Connect's Stripe platform (Stripe Connect) and PayPal partner apps.",
    why: "Organizations connect their own Stripe or PayPal accounts through these apps to take card and PayPal payments.",
    fields: [F.STRIPE_TEST_SECRET_KEY, F.STRIPE_SECRET_KEY, F.STRIPE_CLIENT_ID, F.STRIPE_WEBHOOK_SECRET, F.PAYPAL_SANDBOX_CLIENT_ID, F.PAYPAL_SANDBOX_CLIENT_SECRET,
      F.PAYPAL_CLIENT_ID, F.PAYPAL_CLIENT_SECRET, F.PAYPAL_PARTNER_ID, F.PAYPAL_BN_CODE, F.PAYPAL_WEBHOOK_ID, F.PAYPAL_SANDBOX_WEBHOOK_ID, F.OAUTH_STATE_SECRET],
    workerTest: true,
  },
  {
    key: "texting", required: false, title: "Texting",
    what: "Twilio, for sign-in codes by text, reminders and WhatsApp.",
    why: "Without it, phone sign-in and texts are off; email keeps working.",
    fields: [F.TWILIO_ACCOUNT_SID, F.TWILIO_AUTH_TOKEN, F.TWILIO_FROM_NUMBER, F.TWILIO_MESSAGING_SERVICE_SID], workerTest: true,
  },
  {
    key: "quickbooks", required: false, title: "QuickBooks",
    what: "Community Connect's Intuit app, which organizations connect their QuickBooks Online company through.",
    why: "Posting gifts to QuickBooks, pulling the chart of accounts and donor matching all need it.",
    fields: [F.INTUIT_CLIENT_ID, F.INTUIT_CLIENT_SECRET, F.INTUIT_SANDBOX_CLIENT_ID, F.INTUIT_SANDBOX_CLIENT_SECRET, F.INTUIT_REDIRECT_URI, F.OAUTH_STATE_SECRET],
    workerTest: true,
  },
  {
    key: "ai", required: false, title: "AI (Niva and suggestions)",
    what: "An Anthropic API key.",
    why: "Niva answers, import column mapping and QuickBooks donor-matching suggestions use it. Without it they are off and say so.",
    fields: [F.ANTHROPIC_API_KEY], workerTest: true,
  },
  {
    key: "push", required: false, title: "Push notifications",
    what: "Expo's push service for the member app.",
    why: "Push works without a token; add one only if enhanced push security is on for the Expo project.",
    fields: [F.EXPO_ACCESS_TOKEN], workerTest: true,
  },
  {
    key: "wildcard", required: false, title: "Addresses for organizations",
    what: "A base domain so every organization and sandbox gets its own address (jsh.communityconnect.app, jsh-sandbox.communityconnect.app).",
    why: "Without it every organization shares the portal address and people switch with the Center pill.",
    fields: [F.wildcard_domain], workerTest: false,
  },
];

export const STEP_BY_KEY: Record<StepKey, Step> = Object.fromEntries(STEPS.map((s) => [s.key, s])) as Record<StepKey, Step>;

export function isStepKey(v: unknown): v is StepKey {
  return typeof v === "string" && v in STEP_BY_KEY;
}

export const SECRET_NAMES: string[] = [...new Set(STEPS.flatMap((s) => s.fields.filter((f) => f.kind === "secret").map((f) => f.name)))];
export const SETTING_KEYS: string[] = [...new Set(STEPS.flatMap((s) => s.fields.filter((f) => f.kind === "setting").map((f) => f.name)))];

/** Settings that are env variables too (portal_domain / wildcard_domain are not). */
export function isEnvName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]+$/.test(name) && !name.startsWith("WORKER_");
}

// ── Validation (the database checks the essentials again) ───────────────────
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

/** A bare host from what someone typed ("https://CRM.example.org/" -> "crm.example.org"). */
export function normalizeDomain(input: string, wildcard = false): string {
  let v = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (wildcard) v = v.replace(/^\*\./, "");
  return v;
}

/** A plain-English problem with a value, or null when it looks right. Never echoes a secret. */
export function fieldProblem(name: string, raw: string): string | null {
  const field = FIELDS[name];
  if (!field) return "That is not a field of the setup wizard.";
  const v = raw.trim();
  if (!v) return `Enter the ${field.label.toLowerCase()}.`;
  if (v !== raw && field.kind === "secret") return "The value starts or ends with a space; paste it again without it.";
  if (/[\r\n\t]/.test(v)) return "The value has line breaks; paste it on one line.";
  if (field.kind === "secret" && v.length < 8) return "That is too short to be a real key (at least 8 characters).";
  if (v.length > (field.kind === "secret" ? 8192 : 500)) return "That value is too long.";
  const starts = (prefixes: string[], what: string) => (prefixes.some((p) => v.startsWith(p)) ? null : `That does not look like ${what} (it should start with ${prefixes.join(" or ")}).`);
  switch (name) {
    case "portal_domain":
    case "wildcard_domain": {
      const d = normalizeDomain(v, name === "wildcard_domain");
      if (d.includes("/")) return "Enter the domain only, without a path.";
      return d === "localhost" || DOMAIN.test(d) ? null : "Enter a domain name only, for example crm.communityconnect.app.";
    }
    case "MESSAGING_EMAIL_PROVIDER":
      return v === "resend" || v === "postmark" ? null : "Choose Resend or Postmark.";
    case "MESSAGING_FROM_ADDRESS":
      return /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(v) ? null : "Enter an email address, for example no-reply@mail.communityconnect.app.";
    case "RESEND_API_KEY":
      return starts(["re_"], "a Resend API key");
    case "RESEND_WEBHOOK_SECRET":
    case "STRIPE_WEBHOOK_SECRET":
      return v.split(",").every((p) => p.trim().startsWith("whsec_")) ? null : "That does not look like a webhook signing secret (it should start with whsec_).";
    case "SEND_EMAIL_HOOK_SECRET":
    case "SEND_SMS_HOOK_SECRET":
      return /^(v1,)?whsec_[A-Za-z0-9+/=]{16,}$/.test(v) ? null : "That does not look like a Supabase hook secret (v1,whsec_… as Supabase shows it).";
    case "STRIPE_SECRET_KEY":
      return starts(["sk_live_", "rk_live_"], "a live Stripe secret key");
    case "STRIPE_TEST_SECRET_KEY":
      return starts(["sk_test_", "rk_test_"], "a test Stripe secret key");
    case "STRIPE_CLIENT_ID":
      return starts(["ca_"], "a Stripe Connect client id");
    case "TWILIO_ACCOUNT_SID":
      return /^AC[0-9a-fA-F]{32}$/.test(v) ? null : "That does not look like a Twilio account SID (AC followed by 32 letters and digits).";
    case "TWILIO_MESSAGING_SERVICE_SID":
      return /^MG[0-9a-fA-F]{32}$/.test(v) ? null : "That does not look like a messaging service SID (MG followed by 32 letters and digits).";
    case "TWILIO_FROM_NUMBER":
      return /^\+[1-9][0-9]{7,14}$/.test(v) ? null : "Enter the number in international format, for example +18325550100.";
    case "INTUIT_REDIRECT_URI":
      return /^https:\/\/[^\s/]+\/api\/oauth\/intuit\/callback$/.test(v) || /^http:\/\/localhost(:[0-9]+)?\/api\/oauth\/intuit\/callback$/.test(v)
        ? null
        : "The redirect address must be https://<portal>/api/oauth/intuit/callback.";
    case "ANTHROPIC_API_KEY":
      return starts(["sk-ant-"], "an Anthropic API key");
    case "OAUTH_STATE_SECRET":
    case "MESSAGING_LINK_SECRET":
      return v.length >= 32 ? null : "Use at least 32 characters (Generate makes one).";
    default:
      return null;
  }
}

// ── What each step needs to count as configured ──────────────────────────────
/** Which names have a value somewhere (saved in the wizard, or in the server's environment). */
export type Has = (name: string) => boolean;
export type SettingValue = (name: string) => string | null;

/** Plain-English list of what is still missing for a step's configuration (empty = complete). */
export function missingFor(step: StepKey, has: Has, value: SettingValue = () => null): string[] {
  const out: string[] = [];
  const need = (name: string) => {
    if (!has(name)) out.push(FIELDS[name]?.label ?? name);
  };
  switch (step) {
    case "background":
      return [];
    case "portal":
      need("portal_domain");
      return out;
    case "email": {
      const provider = value("MESSAGING_EMAIL_PROVIDER") === "postmark" ? "postmark" : "resend";
      if (provider === "resend") need("RESEND_API_KEY");
      else {
        need("POSTMARK_SERVER_TOKEN");
        need("POSTMARK_ACCOUNT_TOKEN");
      }
      need("MESSAGING_FROM_ADDRESS");
      need("MESSAGING_LINK_SECRET");
      return out;
    }
    case "hooks":
      need("SEND_EMAIL_HOOK_SECRET");
      return out;
    case "payments": {
      const stripe = has("STRIPE_CLIENT_ID") && (has("STRIPE_TEST_SECRET_KEY") || has("STRIPE_SECRET_KEY")) && has("STRIPE_WEBHOOK_SECRET");
      const paypal = (has("PAYPAL_SANDBOX_CLIENT_ID") && has("PAYPAL_SANDBOX_CLIENT_SECRET")) || (has("PAYPAL_CLIENT_ID") && has("PAYPAL_CLIENT_SECRET"));
      if (!stripe && !paypal) out.push("Stripe (client id, a secret key and the webhook secret) or a PayPal app (client id and secret)");
      need("OAUTH_STATE_SECRET");
      return out;
    }
    case "texting":
      need("TWILIO_ACCOUNT_SID");
      need("TWILIO_AUTH_TOKEN");
      if (!has("TWILIO_FROM_NUMBER") && !has("TWILIO_MESSAGING_SERVICE_SID")) out.push("a number or a messaging service");
      return out;
    case "quickbooks":
      if (!(has("INTUIT_CLIENT_ID") && has("INTUIT_CLIENT_SECRET")) && !(has("INTUIT_SANDBOX_CLIENT_ID") && has("INTUIT_SANDBOX_CLIENT_SECRET"))) {
        out.push("an Intuit client id and secret (production or development)");
      }
      need("OAUTH_STATE_SECRET");
      return out;
    case "ai":
      need("ANTHROPIC_API_KEY");
      return out;
    case "push":
      return [];
    case "wildcard":
      need("wildcard_domain");
      return out;
  }
}

// ── The wizard as a whole ────────────────────────────────────────────────────
export type StepStatus = "not_started" | "done" | "parked";
export type StepRow = { key: string; required: boolean; status: StepStatus };

/** Complete = every required step done, every optional step done or parked. */
export function setupComplete(rows: StepRow[]): boolean {
  if (rows.length === 0) return false;
  return rows.every((r) => r.status === "done" || (!r.required && r.status === "parked"));
}

export function setupProgress(rows: StepRow[]): { done: number; parked: number; open: number; requiredOpen: number } {
  return {
    done: rows.filter((r) => r.status === "done").length,
    parked: rows.filter((r) => r.status === "parked").length,
    open: rows.filter((r) => r.status === "not_started").length,
    requiredOpen: rows.filter((r) => r.required && r.status !== "done").length,
  };
}

/** The addresses to register with a provider for one callback path. */
export function callbackUrls(path: string, portalDomain: string | null, wildcardDomain: string | null, extra: string[] = []): string[] {
  const hosts = [portalDomain, ...extra].filter((h): h is string => !!h && h.trim() !== "");
  const urls = hosts.map((h) => `https://${h}${path}`);
  if (wildcardDomain) urls.push(`https://<organization>.${wildcardDomain}${path} — one per organization address (providers do not accept wildcards)`);
  return [...new Set(urls)];
}

/** A random value for a "Generate" field (server side): 48 url-safe characters. */
export function randomSecret(bytes: (n: number) => Uint8Array): string {
  return Buffer.from(bytes(36)).toString("base64url");
}
