// Pure helpers for the Content module (approval queue, practices, timings,
// Gyan Path, library, photos, legal documents).

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Content items (0007 content_items.kind / status)
// ---------------------------------------------------------------------------
export const CONTENT_KIND_LABEL: Record<string, string> = {
  sutra: "Religious content",
  pachchakhan: "Religious content · pachchakhan",
  audio_lesson: "Audio lesson",
  video: "Video",
  guide_page: "Guide page",
  explainer: "Explainer",
  darshan_stream: "Live darshan stream",
  niva_source: "Niva source",
  faq: "FAQ",
  other: "Other",
};

export function contentKindLabel(kind: string): string {
  return CONTENT_KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
}

export function contentStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "in_review":
      return "Awaiting approval";
    case "approved":
      return "Approved";
    case "published":
      return "Published";
    case "retired":
      return "Retired";
    default:
      return status;
  }
}

export function contentStatusTone(status: string): "ok" | "warn" | "bad" {
  if (status === "published" || status === "approved") return "ok";
  if (status === "retired") return "bad";
  return "warn";
}

/** Lowercase, dash-separated web address from a title ("Iriyavahiyam sutra" → "iriyavahiyam-sutra"). */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ---------------------------------------------------------------------------
// Practices (My Jain Way catalog)
// ---------------------------------------------------------------------------
export const PRACTICE_CATEGORIES = [
  { key: "mantra_jaap", label: "Mantra and jaap" },
  { key: "tapasya_pachchakhan", label: "Tapasya and pachchakhan" },
  { key: "darshan_puja", label: "Darshan and puja" },
  { key: "samayik_pratikraman", label: "Samayik and pratikraman" },
  { key: "swadhyay_learning", label: "Swadhyay and learning" },
  { key: "seva_daan", label: "Seva and daan" },
] as const;

export function practiceCategoryLabel(key: string): string {
  return PRACTICE_CATEGORIES.find((c) => c.key === key)?.label ?? key.replace(/_/g, " ");
}

/** "06:45:00" → "6:45 AM"; null → null. */
export function formatClock(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const min = m[2];
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${suffix}`;
}

/** Practices with no clock time are relative to the sun (Navkarsi, Chauvihar) or "anytime". */
export function practiceDefaultTime(p: { key: string; default_time: string | null }): string {
  const clock = formatClock(p.default_time);
  if (clock) return clock;
  if (p.key === "navkarsi") return "Sunrise + 48 min";
  if (p.key === "chauvihar") return "Before sunset";
  return "Anytime";
}

// ---------------------------------------------------------------------------
// Points, streaks and Saathi (centers.rules.points.*)
// ---------------------------------------------------------------------------
export type PointsRules = {
  day_complete_bonus: number;
  anumodana_points: number;
  anumodana_daily_cap: number;
  support_points: number;
  behind_after_days: number;
  streak_rest_days_per_month: number;
};

/** Defaults the database functions use when a key is missing (0011, 0021). */
export const POINTS_DEFAULTS: PointsRules = {
  day_complete_bonus: 20,
  anumodana_points: 5,
  anumodana_daily_cap: 5,
  support_points: 3,
  behind_after_days: 3,
  streak_rest_days_per_month: 1,
};

export const POINTS_LIMITS: Record<keyof PointsRules, { min: number; max: number; label: string }> = {
  day_complete_bonus: { min: 0, max: 1000, label: "Day-complete bonus" },
  anumodana_points: { min: 0, max: 1000, label: "Anumodana points" },
  anumodana_daily_cap: { min: 0, max: 1000, label: "Anumodana daily limit" },
  support_points: { min: 0, max: 1000, label: "Saathi support points" },
  behind_after_days: { min: 1, max: 60, label: "“Behind” after" },
  streak_rest_days_per_month: { min: 0, max: 10, label: "Streak rest days" },
};

export function readPointsRules(rules: unknown): PointsRules {
  const p = isObj(rules) && isObj(rules.points) ? rules.points : {};
  const out = { ...POINTS_DEFAULTS };
  for (const k of Object.keys(POINTS_DEFAULTS) as (keyof PointsRules)[]) {
    const v = p[k];
    if (typeof v === "number" && Number.isInteger(v)) out[k] = v;
  }
  return out;
}

/** Validate typed values; returns the whole rules object with `points` updated (other keys untouched). */
export function mergePointsRules(
  rules: unknown,
  input: Record<string, string | null | undefined>,
): { ok: true; rules: Obj } | { ok: false; error: string } {
  const base: Obj = isObj(rules) ? { ...rules } : {};
  const points: Obj = isObj(base.points) ? { ...base.points } : {};
  for (const k of Object.keys(POINTS_LIMITS) as (keyof PointsRules)[]) {
    const raw = (input[k] ?? "").trim();
    const lim = POINTS_LIMITS[k];
    if (raw === "") return { ok: false, error: `${lim.label} is required.` };
    if (!/^\d+$/.test(raw)) return { ok: false, error: `${lim.label} must be a whole number.` };
    const n = Number(raw);
    if (n < lim.min || n > lim.max) return { ok: false, error: `${lim.label} must be between ${lim.min} and ${lim.max}.` };
    points[k] = n;
  }
  base.points = points;
  return { ok: true, rules: base };
}

// ---------------------------------------------------------------------------
// Daily timings (rule-based text in centers.rules.timings)
// ---------------------------------------------------------------------------
export type TimingRules = { derasar_hours: string; aarti: string; snatra_puja: string };

export function readTimingRules(rules: unknown): TimingRules {
  const t = isObj(rules) && isObj(rules.timings) ? rules.timings : {};
  const s = (k: string) => (typeof t[k] === "string" ? (t[k] as string) : "");
  return { derasar_hours: s("derasar_hours"), aarti: s("aarti"), snatra_puja: s("snatra_puja") };
}

export function mergeTimingRules(rules: unknown, input: Partial<TimingRules>): { ok: true; rules: Obj } | { ok: false; error: string } {
  const base: Obj = isObj(rules) ? { ...rules } : {};
  const t: Obj = isObj(base.timings) ? { ...base.timings } : {};
  for (const k of ["derasar_hours", "aarti", "snatra_puja"] as const) {
    const v = (input[k] ?? "").trim();
    if (v.length > 120) return { ok: false, error: "Each timing must be 120 characters or fewer." };
    if (v) t[k] = v;
    else delete t[k];
  }
  base.timings = t;
  return { ok: true, rules: base };
}

/** "HH:MM[:SS]" + minutes → "HH:MM" (same day, clamped to 23:59). */
export function addMinutesToClock(time: string, minutes: number): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  const total = Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]) + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Member Home line: "Sunrise 7:14 AM · Navkarsi 8:02 AM · Chauvihar by 7:21 PM". */
export function todayTimingLine(t: { sunrise: string | null; sunset: string | null; navkarsi: string | null; chauvihar: string | null } | null): string | null {
  if (!t || (!t.sunrise && !t.sunset)) return null;
  const parts: string[] = [];
  if (t.sunrise) parts.push(`Sunrise ${formatClock(t.sunrise)}`);
  const navkarsi = t.navkarsi ?? (t.sunrise ? addMinutesToClock(t.sunrise, 48) : null);
  if (navkarsi) parts.push(`Navkarsi ${formatClock(navkarsi)}`);
  const chauvihar = t.chauvihar ?? t.sunset;
  if (chauvihar) parts.push(`Chauvihar by ${formatClock(chauvihar)}`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Photos (storage_path → bucket + object key)
// ---------------------------------------------------------------------------
export const PHOTO_BUCKET = "photos";

/**
 * Where a photo lives. A full URL is used as is. Otherwise the path is an
 * object key in the "photos" bucket, optionally written as "photos/<key>".
 */
export function photoLocation(storagePath: string): { kind: "url"; url: string } | { kind: "storage"; bucket: string; key: string } | null {
  const p = storagePath.trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return { kind: "url", url: p };
  const key = p.replace(/^\/+/, "");
  if (key.startsWith(`${PHOTO_BUCKET}/`)) return { kind: "storage", bucket: PHOTO_BUCKET, key: key.slice(PHOTO_BUCKET.length + 1) };
  return { kind: "storage", bucket: PHOTO_BUCKET, key };
}

export const ALBUM_VISIBILITY_LABEL: Record<string, string> = { public: "Everyone", members: "Members", private: "Staff only" };

// ---------------------------------------------------------------------------
// Legal documents
// ---------------------------------------------------------------------------
export const LEGAL_KIND_LABEL: Record<string, string> = {
  privacy: "Privacy policy",
  terms: "Terms of use",
  volunteer_waiver: "Volunteer waiver",
  pathshala_waiver: "Pathshala waiver (parent signs)",
  photo_release: "Photo consent",
  children_consent: "Children's photo consent",
  disclaimer: "Notices and disclaimers",
  other: "Other document",
};

/** The member kinds a community can publish, in the order the portal lists them. */
export const MEMBER_LEGAL_KINDS = ["privacy", "terms", "disclaimer", "photo_release", "children_consent", "volunteer_waiver", "pathshala_waiver", "other"] as const;

/** How the member app's first-sign-in legal step asks for a document (legal_documents.member_step, 0422). */
export type MemberStep = "accept" | "consent" | "none";
export const MEMBER_STEP_LABEL: Record<MemberStep, string> = {
  accept: "Must accept to use the app",
  consent: "Asked yes or no (the answer is recorded)",
  none: "Not asked at sign-in",
};

export function isMemberStep(x: unknown): x is MemberStep {
  return x === "accept" || x === "consent" || x === "none";
}

/** The database's default for a kind (0422): privacy/terms/notices must be accepted; photo and children consent are a yes/no. */
export function defaultMemberStep(kind: string): MemberStep {
  if (kind === "privacy" || kind === "terms" || kind === "disclaimer") return "accept";
  if (kind === "photo_release" || kind === "children_consent") return "consent";
  return "none";
}

/** Plain-English note on what publishing a version does in the member app. */
export function publishEffect(step: MemberStep): string {
  if (step === "accept") return "Members are asked to accept it the next time they open the app, before they continue.";
  if (step === "consent") return "Members are asked yes or no the next time they open the app; their answer is recorded.";
  return "It is not asked at sign-in; signers are asked for the new version where it is required.";
}

/** "v3" → "v4", "3" → "4", "2026.1" → "2026.2"; unknown shapes get "-2". */
export function nextVersion(current: string | null | undefined): string {
  if (!current) return "v1";
  const m = /^(.*?)(\d+)$/.exec(current.trim());
  if (!m) return `${current.trim()}-2`;
  return `${m[1]}${Number(m[2]) + 1}`;
}

/** Compare document versions ("v10" after "v9"). */
export function compareVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// ---------------------------------------------------------------------------
// Gyan Path learner stats
// ---------------------------------------------------------------------------
/**
 * Per goal: learners = people with any completed step of the goal; completion
 * = share of those learners who completed every step of it.
 */
export function goalLearnerStats(
  stepsByGoal: Map<string, string[]>,
  progress: { person_id: string; step_id: string }[],
): Map<string, { learners: number; completionPct: number | null }> {
  const goalOfStep = new Map<string, string>();
  for (const [g, steps] of stepsByGoal) for (const s of steps) goalOfStep.set(s, g);
  const done = new Map<string, Map<string, Set<string>>>();
  for (const p of progress) {
    const g = goalOfStep.get(p.step_id);
    if (!g) continue;
    const byPerson = done.get(g) ?? new Map<string, Set<string>>();
    const set = byPerson.get(p.person_id) ?? new Set<string>();
    set.add(p.step_id);
    byPerson.set(p.person_id, set);
    done.set(g, byPerson);
  }
  const out = new Map<string, { learners: number; completionPct: number | null }>();
  for (const [g, steps] of stepsByGoal) {
    const byPerson = done.get(g) ?? new Map();
    const learners = byPerson.size;
    const complete = steps.length === 0 ? 0 : [...byPerson.values()].filter((s) => s.size >= steps.length).length;
    out.set(g, { learners, completionPct: learners ? Math.round((complete / learners) * 100) : null });
  }
  return out;
}

export type QuizQuestion = { question: string; options: string[]; answer: number };

/**
 * One multiple-choice question from the step form (gyan_steps.quiz jsonb:
 * {questions:[{question, options, answer}]}, answer = index of the right option,
 * the shape the member app reads). Options: one per line; answer: 1-based.
 */
export function quizFromFields(
  question: string | null,
  optionsText: string | null,
  answerText: string | null,
): { ok: true; quiz: { questions: QuizQuestion[] } | null } | { ok: false; error: string } {
  const q = (question ?? "").trim();
  const options = (optionsText ?? "")
    .split(/\r?\n/)
    .map((o) => o.trim())
    .filter(Boolean);
  if (!q && options.length === 0) return { ok: true, quiz: null };
  if (!q) return { ok: false, error: "write the quiz question" };
  if (options.length < 2) return { ok: false, error: "give at least two answers, one per line" };
  if (options.length > 6) return { ok: false, error: "use at most six answers" };
  const n = Number((answerText ?? "").trim());
  if (!Number.isInteger(n) || n < 1 || n > options.length) return { ok: false, error: `say which answer is right (1 to ${options.length})` };
  return { ok: true, quiz: { questions: [{ question: q, options, answer: n - 1 }] } };
}
