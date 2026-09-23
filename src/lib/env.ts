// Public runtime configuration. Only NEXT_PUBLIC_* values live here: the
// service-role key never ships in this app (docs/ARCHITECTURE.md).
//
// Each variable is read with a literal `process.env.NEXT_PUBLIC_…` expression
// so Next.js can inline it into client bundles.

export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  centerSlug: string;
};

export type EnvProblem = { name: string; problem: string };

export type EnvCheck = { ok: true; env: PublicEnv } | { ok: false; problems: EnvProblem[] };

export const DEFAULT_CENTER_SLUG = "jsh";

export function checkPublicEnv(raw: {
  url?: string;
  anonKey?: string;
  centerSlug?: string;
}): EnvCheck {
  const url = raw.url?.trim() ?? "";
  const anonKey = raw.anonKey?.trim() ?? "";
  const centerSlug = raw.centerSlug?.trim() || DEFAULT_CENTER_SLUG;
  const problems: EnvProblem[] = [];

  if (!url) {
    problems.push({ name: "NEXT_PUBLIC_SUPABASE_URL", problem: "is not set" });
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        problems.push({ name: "NEXT_PUBLIC_SUPABASE_URL", problem: "must start with http:// or https://" });
      }
    } catch {
      problems.push({ name: "NEXT_PUBLIC_SUPABASE_URL", problem: `is not a valid URL ("${url}")` });
    }
  }
  if (!anonKey) {
    problems.push({ name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", problem: "is not set" });
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(centerSlug)) {
    problems.push({
      name: "NEXT_PUBLIC_CENTER_SLUG",
      problem: `must be a center slug such as "jsh" (got "${centerSlug}")`,
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, env: { supabaseUrl: url, supabaseAnonKey: anonKey, centerSlug } };
}

export function readPublicEnv(): EnvCheck {
  return checkPublicEnv({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    centerSlug: process.env.NEXT_PUBLIC_CENTER_SLUG,
  });
}
