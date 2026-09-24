// Setup module (organization onboarding, ONBOARDING_PLAN §4): the pure parts —
// stage and status labels, the 13 go-live readiness checks, which linked screens
// exist in this build, form parsing for the Step 0 screens, the brand-kit
// contrast check and public file URLs. No server imports; tested directly.

import { NAV } from "@/lib/permissions";

export const SETUP_STAGES = [
  { stage: 0, title: "Organization foundation", who: "Owner" },
  { stage: 1, title: "Connect services", who: "Treasurer, communications officer" },
  { stage: 2, title: "Templates and documents", who: "Communications officer, treasurer, privacy officer" },
  { stage: 3, title: "Setup data", who: "Module owners" },
  { stage: 4, title: "Records", who: "Membership coordinator, module owners" },
  { stage: 5, title: "History and transactions", who: "Treasurer" },
  { stage: 6, title: "Train Niva", who: "Content editor, religious coordinator" },
  { stage: 7, title: "Test, train staff, pilot", who: "Owner, Community Connect onboarding lead" },
  { stage: 8, title: "Request go-live", who: "Owner" },
] as const;

export const STEP_STATUSES = ["not_started", "in_progress", "waiting_on_provider", "needs_review", "done", "skipped"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export function isStepStatus(v: unknown): v is StepStatus {
  return typeof v === "string" && (STEP_STATUSES as readonly string[]).includes(v);
}

const STATUS_LABEL: Record<StepStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  waiting_on_provider: "Waiting on a provider",
  needs_review: "Needs Community Connect review",
  done: "Done",
  skipped: "Skipped",
};

export function stepStatusLabel(s: string): string {
  return isStepStatus(s) ? STATUS_LABEL[s] : s;
}

/** Status colour: done is ok; in progress, waiting and review warn; not started and skipped are muted. */
export function stepStatusTone(s: string): "ok" | "warn" | "muted" {
  if (s === "done") return "ok";
  if (s === "skipped" || s === "not_started") return "muted";
  return "warn";
}

/** Statuses a person may choose for a step (skipped only when the module is on and the step is optional or not needed). */
export const MANUAL_STATUSES: readonly StepStatus[] = ["not_started", "in_progress", "waiting_on_provider", "done", "skipped"];

export type ChecklistRow = {
  step_key: string;
  stage: number;
  status: string;
  required: boolean;
};

/** Progress for a stage or the whole list: done over the steps that count (skipped ones do not). */
export function checklistProgress(rows: readonly Pick<ChecklistRow, "status" | "required">[]): { done: number; total: number; pct: number } {
  const counted = rows.filter((r) => r.status !== "skipped");
  const done = counted.filter((r) => r.status === "done").length;
  const total = counted.length;
  return { done, total, pct: total === 0 ? 100 : Math.round((done / total) * 100) };
}

// ── Linked screens ────────────────────────────────────────────────────────────
/** Portal screens that exist but are not NAV tabs (detail and sub pages). */
const EXTRA_ROUTES = ["/giving/bank", "/giving/campaigns", "/setup/profile", "/setup/organization", "/setup/leaders", "/setup/readiness", "/accounting/qbo/setup"];

/**
 * Is the screen a step links to built in this deployment? Every NAV tab counts,
 * so a screen another stream adds as a tab lights up here on its own; until
 * then the checklist says "Coming soon" instead of linking to a 404.
 */
export function routeAvailable(route: string | null | undefined, extra: readonly string[] = EXTRA_ROUTES): boolean {
  if (!route) return false;
  const path = route.split("#")[0];
  if (extra.includes(path)) return true;
  return NAV.some((m) => m.tabs.some((t) => t.href === path));
}

// ── Readiness (plan §4 Step 8) ────────────────────────────────────────────────
export type ReadinessDef = {
  n: number;
  key: string;
  title: string;
  proof: string;
  owner: string;
  /** Where the evidence is produced (a screen the admin can open). */
  href?: string;
  /** An interim version of the check: what it proves today, and that the full version comes later. */
  interim?: string;
};

/** The plan's 13 checks, with the registry keys each stream registers (migrations 0182, 0300, 0301). */
export const READINESS_CHECKS: readonly ReadinessDef[] = [
  { n: 1, key: "nonprofit_verified", title: "Non-profit status verified", proof: "Community Connect review done (Step 0.2)", owner: "Setup", href: "/setup/organization" },
  { n: 2, key: "agreements_accepted", title: "Agreements accepted", proof: "Records exist (Step 0.7)", owner: "Security", href: "/settings/agreements" },
  { n: 3, key: "owner_and_second_admin_2fa", title: "An owner and a second admin, both with 2FA", proof: "Automatic", owner: "Security", href: "/settings/team" },
  { n: 4, key: "email_domain_verified", title: "Email domain verified, and sign-in codes reach any address", proof: "Automatic test", owner: "Messaging", href: "/settings/email" },
  { n: 5, key: "texting_registered", title: "Texting registered, or phone sign-in switched off", proof: "Provider status", owner: "Messaging", href: "/settings/texting" },
  {
    n: 6,
    key: "payments_live",
    title: "Payments connected with a $1 charge and refund (live in production, test mode in a sandbox), or \"offline only\" chosen",
    proof: "Automatic",
    owner: "Payments",
    href: "/settings/payments",
  },
  { n: 7, key: "quickbooks_ready", title: "If QuickBooks is used: connected, mapping and test post approved, go-live date set", proof: "Approvals recorded", owner: "QuickBooks", href: "/accounting/qbo/setup" },
  {
    n: 8,
    key: "statement_templates_approved",
    title: "Statement and receipt templates approved",
    proof: "The treasurer's approval (who, when)",
    owner: "Giving",
    href: "/giving/statements",
    interim: "Today the treasurer approves the receipt and year-end statement settings that exist (signer and personal note). Statements built from an uploaded sample come in a later release.",
  },
  { n: 9, key: "setup_data_complete", title: "Setup data complete for every module that is on", proof: "Automatic", owner: "Setup", href: "/setup" },
  {
    n: 10,
    key: "records_imported_reconciled",
    title: "Records and history imported and reconciled; duplicates reviewed; contact coverage above target",
    proof: "Sign-offs, plus the data-quality view",
    owner: "Import",
    href: "/settings/import",
  },
  { n: 11, key: "member_legal_documents_published", title: "Member legal documents published", proof: "Automatic", owner: "Setup", href: "/content/legal" },
  {
    n: 12,
    key: "niva_evaluated",
    title: "Niva's content approved, or Niva switched off",
    proof: "An administrator's approval (who, when)",
    owner: "Niva",
    href: "/content/niva",
    interim: "Today an administrator approves Niva's knowledge sources. The full evaluation (question bank and pass mark) comes in a later release.",
  },
  { n: 13, key: "staff_trained_pilot_done", title: "Staff trained, health check green, pilot done", proof: "Owner confirms", owner: "Platform", href: "/setup/go-live" },
];

/** Registered checks beyond the plan's 13, with where their evidence is. */
const EXTRA_CHECK_HREF: Record<string, string> = { background_service: "/settings/integrations" };

export type ReadinessResult = { key: string; title: string; ok: boolean; detail: string };
export type ReadinessRow = ReadinessDef & { state: "pass" | "fail" | "not_built"; detail: string; registeredTitle: string | null };

/** The 13 checks with each registered result; unregistered ones are "not built yet". Extra registered checks follow. */
export function mergeReadiness(results: readonly ReadinessResult[]): ReadinessRow[] {
  const byKey = new Map(results.map((r) => [r.key, r]));
  const rows: ReadinessRow[] = READINESS_CHECKS.map((d) => {
    const r = byKey.get(d.key);
    if (!r) return { ...d, state: "not_built", detail: "Not built yet — this check arrives with a later release.", registeredTitle: null };
    return { ...d, state: r.ok ? "pass" : "fail", detail: r.detail, registeredTitle: r.title };
  });
  const known = new Set(READINESS_CHECKS.map((d) => d.key));
  let n = READINESS_CHECKS.length;
  for (const r of results) {
    if (known.has(r.key)) continue;
    n += 1;
    rows.push({
      n,
      key: r.key,
      title: r.title,
      proof: "Automatic",
      owner: "Other",
      href: EXTRA_CHECK_HREF[r.key],
      state: r.ok ? "pass" : "fail",
      detail: r.detail,
      registeredTitle: r.title,
    });
  }
  return rows;
}

// ── Go-live approvals (readiness 8 and 12, migration 0300) ─────────────────────
export type ApprovalState = {
  state: "none" | "current" | "changed";
  approved_by_name?: string | null;
  approved_at?: string | null;
  approver_role?: string | null;
  note?: string | null;
};

export function isApprovalState(v: unknown): v is ApprovalState {
  if (!v || typeof v !== "object") return false;
  const s = (v as { state?: unknown }).state;
  return s === "none" || s === "current" || s === "changed";
}

/** Plain words and a tone for an approval (never colour alone). */
export function approvalView(a: ApprovalState | null): { state: ApprovalState["state"]; label: string; tone: "ok" | "warn" | "bad" } {
  if (!a || a.state === "none") return { state: "none", label: "Not approved yet", tone: "warn" };
  if (a.state === "changed") return { state: "changed", label: "Changed since approved", tone: "bad" };
  return { state: "current", label: "Approved", tone: "ok" };
}

/** The status JSON of app.golive_approval_status, read defensively. */
export function parseApprovalStatus(v: unknown): {
  statements: ApprovalState | null;
  niva: ApprovalState | null;
  isTreasurer: boolean;
  canApproveNiva: boolean;
} {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    statements: isApprovalState(o.statement_templates) ? o.statement_templates : null,
    niva: isApprovalState(o.niva_content) ? o.niva_content : null,
    isTreasurer: o.is_treasurer === true,
    canApproveNiva: o.can_approve_niva === true,
  };
}

// ── Numbering (Settings › Numbering, migration 0302) ───────────────────────────
export const NUMBER_KINDS = ["member", "household", "pledge", "order", "receipt", "event"] as const;
export type NumberKind = (typeof NUMBER_KINDS)[number];
export type NumberingRow = { kind: NumberKind; label: string; prefix: string; next_value: number; started: boolean };

export function parseNumberingOverview(v: unknown): NumberingRow[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    if (!NUMBER_KINDS.includes(o.kind as NumberKind)) return [];
    return [{ kind: o.kind as NumberKind, label: String(o.label ?? o.kind), prefix: String(o.prefix ?? ""), next_value: Number(o.next_value ?? 1), started: o.started === true }];
  });
}

/** The form's prefix_<kind> / next_<kind> fields → items for app.save_numbering, or the plain-English problem. */
export function parseNumbering(read: Read): { ok: true; value: { kind: NumberKind; prefix: string; next_value: string }[] } | { ok: false; error: string } {
  const errors: string[] = [];
  const value: { kind: NumberKind; prefix: string; next_value: string }[] = [];
  for (const kind of NUMBER_KINDS) {
    const prefix = (read(`prefix_${kind}`) ?? "").trim().toUpperCase();
    const next = (read(`next_${kind}`) ?? "").trim().replace(/[,\s]/g, "");
    if (!prefix && !next) continue;
    if (!/^[A-Z0-9][A-Z0-9-]{0,15}$/.test(prefix)) errors.push(`The ${kind} prefix can use capital letters, digits and dashes (up to 16), e.g. JSH-.`);
    if (!/^\d{1,12}$/.test(next) || Number(next) < 1) errors.push(`The next ${kind} number must be a whole number of at least 1.`);
    value.push({ kind, prefix, next_value: next });
  }
  if (errors.length) return { ok: false, error: errors.join(" ") };
  if (value.length === 0) return { ok: false, error: "there is nothing to save." };
  return { ok: true, value };
}

/** "Neon | Neon CRM" lines → legacy identifier systems (centers.rules.identifiers.legacy_systems). */
export function parseLegacySystems(text: string): { ok: true; value: { system: string; label: string }[] } | { ok: false; error: string } {
  const out: { system: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const [sys, ...rest] = line.split("|");
    const system = (sys ?? "").trim();
    const label = rest.join("|").trim() || system;
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/.test(system)) return { ok: false, error: `line ${i + 1}: the system name uses letters, digits, spaces, dots, dashes or underscores (up to 40).` };
    if (label.length > 80) return { ok: false, error: `line ${i + 1}: keep the label under 80 characters.` };
    if (seen.has(system.toLowerCase())) return { ok: false, error: `line ${i + 1}: "${system}" is listed twice.` };
    seen.add(system.toLowerCase());
    out.push({ system, label });
  }
  if (out.length > 20) return { ok: false, error: "list at most 20 systems." };
  return { ok: true, value: out };
}

// ── Storage (Settings › Storage, migration 0302) ──────────────────────────────
export const STORAGE_AREAS: Record<string, { label: string; holds: string; readers: string; kept: string }> = {
  branding: { label: "Branding (public)", holds: "Logos, leader photos", readers: "Anyone", kept: "Until replaced" },
  content: { label: "Content", holds: "Guide media, flyers, library audio", readers: "Your members", kept: "Until removed" },
  photos: { label: "Photos", holds: "Event albums, member uploads (moderated)", readers: "Members; children's photos per consent", kept: "Until removed" },
  store: { label: "Store", holds: "Item photos", readers: "Members", kept: "Until replaced" },
  statements: { label: "Statements", holds: "Receipts and year-end statements", readers: "The household's adults and finance roles", kept: "7 years" },
  recordings: { label: "Recordings", holds: "Gyan Path recitations", readers: "The child, their parents, their teachers", kept: "Your choice (default 90 days)" },
  imports: { label: "Imports", holds: "Uploaded source files", readers: "People who may import that data", kept: "Your choice (default 90 days)" },
  "org-documents": { label: "Organization documents", holds: "W-9, determination letter, agreements", readers: "The owner and Community Connect verification staff", kept: "Life of the account" },
  exports: { label: "Exports", holds: "Generated exports", readers: "The person who asked", kept: "7 days" },
};

export type StorageArea = {
  bucket: string;
  public: boolean;
  max_file_bytes: number | null;
  types: string[];
  files: number;
  bytes: number;
  retention_days: number | null;
  retention_editable: boolean;
  module: string | null;
  module_on: boolean;
};

export function parseStorageOverview(v: unknown): { available: boolean; areas: StorageArea[]; limitBytes: number | null; usedBytes: number } {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const areas = Array.isArray(o.areas)
    ? o.areas.flatMap((x) => {
        if (!x || typeof x !== "object") return [];
        const a = x as Record<string, unknown>;
        return [
          {
            bucket: String(a.bucket ?? ""),
            public: a.public === true,
            max_file_bytes: typeof a.max_file_bytes === "number" ? a.max_file_bytes : null,
            types: Array.isArray(a.types) ? a.types.map(String) : [],
            files: Number(a.files ?? 0),
            bytes: Number(a.bytes ?? 0),
            retention_days: typeof a.retention_days === "number" ? a.retention_days : null,
            retention_editable: a.retention_editable === true,
            module: typeof a.module === "string" ? a.module : null,
            module_on: a.module_on !== false,
          },
        ];
      })
    : [];
  const limit = typeof o.limit_bytes === "number" ? o.limit_bytes : null;
  return { available: o.available === true, areas, limitBytes: limit, usedBytes: Number(o.used_bytes ?? 0) };
}

/** 1536 → "1.5 KB"; bytes in plain units. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n || 0))} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

/** Retention days typed for imports / recordings: 1–3650, or the problem. */
export function parseRetentionDays(raw: string | null): { ok: true; value: number } | { ok: false; error: string } {
  const t = (raw ?? "").trim();
  if (!/^\d{1,4}$/.test(t) || Number(t) < 1 || Number(t) > 3650) return { ok: false, error: "Enter the number of days to keep files, from 1 to 3,650." };
  return { ok: true, value: Number(t) };
}

// ── Step 0.2 · legal identity ─────────────────────────────────────────────────
export const ENTITY_TYPES = [
  { value: "house_of_worship", label: "House of worship (church, temple, derasar)" },
  { value: "public_charity", label: "501(c)(3) public charity" },
  { value: "private_foundation", label: "501(c)(3) private foundation" },
  { value: "group_exemption_member", label: "Member of a group exemption" },
  { value: "other_exempt", label: "Other tax-exempt organization" },
  { value: "other", label: "Other" },
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number]["value"];

export const DOCUMENT_KINDS = [
  { value: "w9", label: "Signed W-9" },
  { value: "determination_letter", label: "IRS determination letter" },
  { value: "group_exemption", label: "Proof of inclusion in a group exemption" },
  { value: "board_letter", label: "Board letter (house of worship)" },
  { value: "attorney_letter", label: "Attorney letter (house of worship)" },
  { value: "other", label: "Other document" },
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]["value"];

export function documentKindLabel(k: string): string {
  return DOCUMENT_KINDS.find((d) => d.value === k)?.label ?? k;
}

export const DOCUMENT_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"] as const;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** A file the server accepts, or the plain-English reason it doesn't. */
export function checkUpload(
  file: { name: string; type: string; size: number } | null,
  allowed: readonly string[],
  maxBytes: number,
  what: string,
): { ok: true } | { ok: false; error: string } {
  if (!file || file.size === 0) return { ok: false, error: `Choose the ${what} to upload.` };
  if (!allowed.includes(file.type)) {
    const kinds = allowed.map((t) => (t === "application/pdf" ? "PDF" : t === "image/svg+xml" ? "SVG" : t.replace("image/", "").toUpperCase())).join(", ");
    return { ok: false, error: `The ${what} must be a ${kinds} file.` };
  }
  if (file.size > maxBytes) return { ok: false, error: `The ${what} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.` };
  return { ok: true };
}

/** "file name.PDF" → "file-name.pdf" (storage-safe, keeps the extension). */
export function safeFileName(name: string): string {
  const base = name.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+/, "");
  const cut = base.slice(-80).toLowerCase();
  return cut || "file";
}

export function extensionFor(type: string): string {
  switch (type) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/svg+xml":
      return "svg";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

type Read = (name: string) => string | null;

export const US_STATES = /^[A-Z]{2}$/;

export type LegalIdentity = {
  legal_name: string;
  dba: string | null;
  ein: string;
  entity_type: EntityType;
  incorporation_state: string | null;
  registered_address: { line1: string; line2: string | null; city: string; state: string; postal_code: string } | null;
  authorized_signer_name: string | null;
  authorized_signer_title: string | null;
  sales_tax_id: string | null;
};

/** "123456789" / "12 3456789" / "12-3456789" → "12-3456789"; else null. */
export function formatEin(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return /^\d{9}$/.test(d) ? `${d.slice(0, 2)}-${d.slice(2)}` : null;
}

export function parseLegalIdentity(read: Read): { ok: true; value: LegalIdentity } | { ok: false; error: string } {
  const t = (n: string) => (read(n) ?? "").trim();
  const errors: string[] = [];
  const legal = t("legal_name");
  if (legal.length < 2 || legal.length > 200) errors.push("Enter the legal name exactly as on the IRS letter.");
  const ein = formatEin(t("ein"));
  if (!ein) errors.push("The EIN has nine digits, like 12-3456789.");
  const entity = t("entity_type");
  if (!ENTITY_TYPES.some((e) => e.value === entity)) errors.push("Choose the entity type.");
  const state = t("incorporation_state").toUpperCase();
  if (state && !US_STATES.test(state)) errors.push("Enter the state of incorporation as two letters, e.g. TX.");
  const line1 = t("address_line1");
  const city = t("address_city");
  const addrState = t("address_state").toUpperCase();
  const zip = t("address_postal_code");
  const anyAddress = [line1, t("address_line2"), city, addrState, zip].some(Boolean);
  if (anyAddress) {
    if (!line1 || !city || !addrState || !zip) errors.push("Complete the registered address (street, city, state and ZIP).");
    else if (!US_STATES.test(addrState)) errors.push("Enter the address state as two letters.");
    else if (!/^\d{5}(-\d{4})?$/.test(zip)) errors.push("Enter a 5-digit ZIP code (or ZIP+4).");
  }
  const signer = t("authorized_signer_name");
  const signerTitle = t("authorized_signer_title");
  if (signer.length > 120 || signerTitle.length > 120) errors.push("Keep the signer's name and title under 120 characters.");
  if ((signer && !signerTitle) || (!signer && signerTitle)) errors.push("Enter both the authorized signer's name and title (printed on statements).");
  if (errors.length) return { ok: false, error: errors.join(" ") };
  return {
    ok: true,
    value: {
      legal_name: legal,
      dba: t("dba") || null,
      ein: ein!,
      entity_type: entity as EntityType,
      incorporation_state: state || null,
      registered_address: anyAddress ? { line1, line2: t("address_line2") || null, city, state: addrState, postal_code: zip } : null,
      authorized_signer_name: signer || null,
      authorized_signer_title: signerTitle || null,
      sales_tax_id: t("sales_tax_id") || null,
    },
  };
}

/** What still blocks "Submit for verification" (mirrors app.submit_org_verification). */
export function verificationBlockers(p: { legal_name: string | null; ein: string | null; entity_type: string | null } | null, kinds: readonly string[]): string[] {
  const out: string[] = [];
  if (!p?.legal_name) out.push("the legal name");
  if (!p?.ein) out.push("the EIN");
  if (!p?.entity_type) out.push("the entity type");
  if (!kinds.includes("w9")) out.push("a signed W-9");
  const letter = kinds.includes("determination_letter") || kinds.includes("group_exemption");
  const worshipLetter = p?.entity_type === "house_of_worship" && (kinds.includes("board_letter") || kinds.includes("attorney_letter"));
  if (!letter && !worshipLetter) {
    out.push(p?.entity_type === "house_of_worship" ? "an IRS determination letter, group exemption letter, or a board or attorney letter" : "an IRS determination letter or proof of a group exemption");
  }
  return out;
}

export const VERIFICATION_LABEL: Record<string, string> = {
  unverified: "Not submitted",
  submitted: "Waiting for Community Connect review",
  verified: "Verified non-profit",
  rejected: "Sent back — see the note",
};

// ── Step 0.3 · profile ────────────────────────────────────────────────────────
export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "gu", label: "ગુજરાતી (Gujarati)" },
  { value: "hi", label: "हिन्दी (Hindi)" },
  { value: "mr", label: "मराठी (Marathi)" },
  { value: "ta", label: "தமிழ் (Tamil)" },
  { value: "kn", label: "ಕನ್ನಡ (Kannada)" },
] as const;

export const SOCIAL_KEYS = [
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "whatsapp", label: "WhatsApp channel" },
  { key: "x", label: "X (Twitter)" },
] as const;

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

export type ProfileInput = {
  name: string;
  short_name: string | null;
  time_zone: string;
  currency: string;
  mission: string | null;
  about: string | null;
  website: string | null;
  social: Record<string, string>;
  public_email: string | null;
  public_phone: string | null;
  office_hours: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  languages: string[];
};

/** US numbers may be typed as 10 digits; others need +country. Returns E.164 or null. */
export function toE164(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, "");
  if (s.startsWith("+")) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function parseProfile(read: Read, readAll: (name: string) => string[], timeZones: readonly string[]): { ok: true; value: ProfileInput } | { ok: false; error: string } {
  const t = (n: string) => (read(n) ?? "").trim();
  const errors: string[] = [];
  const name = t("name");
  if (name.length < 3 || name.length > 120) errors.push("Enter the display name (3 to 120 characters).");
  const short = t("short_name");
  if (short.length > 20) errors.push("Keep the short name to 20 characters (it appears as \"{short name} points\").");
  const tz = t("time_zone");
  if (!timeZones.includes(tz)) errors.push("Choose the time zone.");
  const currency = t("currency").toUpperCase() || "USD";
  if (!/^[A-Z]{3}$/.test(currency)) errors.push("The currency is a three-letter code, e.g. USD.");
  const mission = t("mission");
  if (mission.length > 1000) errors.push("Keep the mission under 1,000 characters.");
  const about = t("about");
  if (about.length > 5000) errors.push("Keep the about text under 5,000 characters.");
  const website = t("website");
  if (website && !/^https?:\/\/[^\s]+$/i.test(website)) errors.push("The website must start with https://.");
  const social: Record<string, string> = {};
  for (const s of SOCIAL_KEYS) {
    const v = t(`social_${s.key}`);
    if (!v) continue;
    if (!/^https:\/\/[^\s]+$/i.test(v)) errors.push(`The ${s.label} link must start with https://.`);
    else social[s.key] = v;
  }
  const email = t("public_email").toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push("Enter a valid public email address.");
  const phoneRaw = t("public_phone");
  const phone = phoneRaw ? toE164(phoneRaw) : null;
  if (phoneRaw && !phone) errors.push("Enter the public phone with its area code, e.g. (713) 555-0100 or +1 713 555 0100.");
  const hours = t("office_hours");
  if (hours.length > 500) errors.push("Keep the office hours under 500 characters.");
  const address = t("address");
  if (address.length > 300) errors.push("Keep the address under 300 characters.");
  const latRaw = t("latitude");
  const lonRaw = t("longitude");
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (latRaw || lonRaw) {
    latitude = Number(latRaw);
    longitude = Number(lonRaw);
    if (!latRaw || !lonRaw || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      errors.push("Enter the map pin as a latitude (−90 to 90) and a longitude (−180 to 180), e.g. 29.7604 and −95.3698.");
      latitude = null;
      longitude = null;
    } else {
      latitude = Math.round(latitude * 1e6) / 1e6;
      longitude = Math.round(longitude * 1e6) / 1e6;
    }
  }
  const languages = [...new Set(readAll("languages").filter((l) => LANGUAGES.some((x) => x.value === l)))];
  if (languages.length === 0) errors.push("Choose at least one language.");
  if (errors.length) return { ok: false, error: errors.join(" ") };
  return {
    ok: true,
    value: {
      name,
      short_name: short || null,
      time_zone: tz,
      currency,
      mission: mission || null,
      about: about || null,
      website: website || null,
      social,
      public_email: email || null,
      public_phone: phone,
      office_hours: hours || null,
      address: address || null,
      latitude,
      longitude,
      languages,
    },
  };
}

/** OpenStreetMap embed (no key) around a pin, for the preview. */
export function osmEmbedUrl(lat: number, lon: number): string {
  const d = 0.006;
  const bbox = [lon - d, lat - d, lon + d, lat + d].map((n) => n.toFixed(6)).join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;
}

export function osmLinkUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=17/${lat.toFixed(6)}/${lon.toFixed(6)}`;
}

// ── Brand kit ─────────────────────────────────────────────────────────────────
export const BRAND_FILES = [
  { key: "logo_path", urlKey: "logo_url", label: "Horizontal logo", hint: "Used in the portal, emails and statements. PNG or SVG, transparent background." },
  { key: "mark_path", urlKey: "mark_url", label: "Square mark", hint: "The app icon, favicon and member card. At least 512 × 512." },
  { key: "logo_dark_path", urlKey: "logo_dark_url", label: "Logo for dark backgrounds", hint: "A light version of the logo." },
  { key: "email_header_path", urlKey: "email_header_url", label: "Email header", hint: "600 px wide banner at the top of every email." },
] as const;
export type BrandFileKey = (typeof BRAND_FILES)[number]["key"];

export function isBrandFileKey(v: unknown): v is BrandFileKey {
  return typeof v === "string" && BRAND_FILES.some((f) => f.key === v);
}

/** Public URL of a file in a public bucket: <supabase>/storage/v1/object/public/<bucket>/<path>. */
export function publicObjectUrl(supabaseUrl: string, bucket: string, path: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function parseHexColor(v: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two hex colors (1–21), or null when either is not a color. */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseHexColor(a);
  const cb = parseHexColor(b);
  if (!ca || !cb) return null;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export type ContrastVerdict = { ratio: number; level: "AAA" | "AA" | "AA large" | "fail"; ok: boolean; text: string };

/** Plain-English readability of text in `fg` on `bg` (AA needs 4.5:1 for body text). */
export function contrastVerdict(fg: string, bg: string, what: string): ContrastVerdict | null {
  const ratio = contrastRatio(fg, bg);
  if (ratio === null) return null;
  const level = ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large" : "fail";
  const ok = ratio >= 4.5;
  const text =
    level === "fail"
      ? `${what}: ${ratio}:1 — too low to read. Choose a darker or lighter color.`
      : level === "AA large"
        ? `${what}: ${ratio}:1 — readable only for large text (headings). Body text needs 4.5:1.`
        : `${what}: ${ratio}:1 — passes WCAG ${level}.`;
  return { ratio, level, ok, text };
}

/** White or ink text on a background, whichever reads better. */
export function textOn(bg: string): "#FFFFFF" | "#1D1A16" {
  const w = contrastRatio("#FFFFFF", bg) ?? 21;
  const k = contrastRatio("#1D1A16", bg) ?? 21;
  return w >= k ? "#FFFFFF" : "#1D1A16";
}

export function parseBrandColors(read: Read): { ok: true; value: { primary: string; accent: string } } | { ok: false; error: string } {
  const p = (read("primary") ?? "").trim();
  const a = (read("accent") ?? "").trim();
  const errors: string[] = [];
  if (!parseHexColor(p)) errors.push("Enter the primary color as a hex code like #1B2C5C.");
  if (!parseHexColor(a)) errors.push("Enter the accent color as a hex code like #C9731C.");
  if (errors.length) return { ok: false, error: errors.join(" ") };
  const norm = (v: string) => `#${v.replace(/^#/, "").toUpperCase()}`;
  return { ok: true, value: { primary: norm(p), accent: norm(a) } };
}

// ── Leaders ───────────────────────────────────────────────────────────────────
export const LEADER_BODIES = [
  { value: "executive_committee", label: "Executive Committee" },
  { value: "trustees", label: "Trustees" },
  { value: "pathshala", label: "Pathshala" },
  { value: "tech", label: "Technology" },
  { value: "other", label: "Other" },
] as const;

export const LEADER_TITLES = ["President", "Vice President", "Secretary", "Treasurer", "Joint Secretary", "EC member", "Trustee", "Chair"] as const;

export type LeaderInput = {
  full_name: string;
  title: string;
  body: (typeof LEADER_BODIES)[number]["value"];
  person_id: string | null;
  term_start: string | null;
  term_end: string | null;
  show_publicly: boolean;
  sort: number;
};

export function parseLeader(read: Read): { ok: true; value: LeaderInput } | { ok: false; error: string } {
  const t = (n: string) => (read(n) ?? "").trim();
  const errors: string[] = [];
  const name = t("full_name");
  if (name.length < 2 || name.length > 120) errors.push("Enter the leader's full name.");
  const title = t("title");
  if (title.length < 2 || title.length > 80) errors.push("Enter the title, e.g. President.");
  const body = t("body") || "executive_committee";
  if (!LEADER_BODIES.some((b) => b.value === body)) errors.push("Choose the group (Executive Committee, Trustees, …).");
  const person = t("person_id");
  if (person && !/^[0-9a-f-]{36}$/i.test(person)) errors.push("Choose the person again from the list.");
  const start = t("term_start");
  const end = t("term_end");
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (start && !date.test(start)) errors.push("The term start is not a date.");
  if (end && !date.test(end)) errors.push("The term end is not a date.");
  if (start && end && date.test(start) && date.test(end) && end < start) errors.push("The term ends before it starts.");
  const sort = Number(t("sort") || "0");
  if (!Number.isInteger(sort) || sort < 0 || sort > 999) errors.push("The order is a whole number from 0 to 999.");
  if (errors.length) return { ok: false, error: errors.join(" ") };
  return {
    ok: true,
    value: {
      full_name: name,
      title,
      body: body as LeaderInput["body"],
      person_id: person || null,
      term_start: start || null,
      term_end: end || null,
      show_publicly: read("show_publicly") === "on",
      sort,
    },
  };
}
