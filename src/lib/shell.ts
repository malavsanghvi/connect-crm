// Pure helpers for the portal shell (top bar, sidebar footer, tenant mark).
// No server-only imports: used by server components and tested directly.

import type { Json } from "@/lib/database.types";

/** "Priya Shah" → "PS"; "priya" → "P"; blank → "?". */
export function initials(name: string | null | undefined, max = 2): string {
  const parts = (name ?? "").trim().split(/[\s\-_.@]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = max <= 1 || parts.length === 1 ? [parts[0][0]] : [parts[0][0], parts[parts.length - 1][0]];
  return letters.join("").toUpperCase();
}

export type TenantBranding = {
  /** https URL of the tenant's mark (preferred) or logo, or null when none is configured. */
  logoUrl: string | null;
  /** Letters for the fallback tile when there is no logo, e.g. "JSH". */
  monogram: string;
  /** Short name for tight spaces, e.g. "JSH". */
  shortName: string;
};

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^https:\/\/[^\s]+$/i.test(v) ? v : null;
}

/** A brand-kit file path (<center_id>/…) in the public `branding` bucket, as a URL under the configured Supabase URL. */
function brandingFileUrl(value: unknown, storageBase: string | undefined): string | null {
  if (!storageBase || typeof value !== "string") return null;
  const path = value.trim();
  if (!/^[0-9a-f-]{36}\/[^\s]+$/i.test(path) || path.includes("..")) return null;
  const base = storageBase.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base}/storage/v1/object/public/branding/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * The tenant's branding from centers.branding (never hard-coded). An uploaded
 * brand kit wins (Setup › Profile & brand: branding.mark_path, then
 * branding.logo_path, served from the public `branding` bucket under
 * `storageBase`, the Supabase URL). Otherwise branding.mark_url (the logo
 * without words, as in the prototype top bar), then branding.logo_url; only
 * https URLs are used for those.
 */
export function tenantBranding(center: { name: string; short_name: string | null; slug: string; branding: Json }, storageBase?: string): TenantBranding {
  const b = (center.branding && typeof center.branding === "object" && !Array.isArray(center.branding) ? center.branding : {}) as Record<string, Json | undefined>;
  const logoUrl =
    brandingFileUrl(b.mark_path, storageBase) ?? brandingFileUrl(b.logo_path, storageBase) ?? httpsUrl(b.mark_url) ?? httpsUrl(b.logo_url);
  const shortName = (center.short_name ?? "").trim() || center.slug.toUpperCase();
  const monogram = /^[A-Za-z0-9]{1,4}$/.test(shortName) ? shortName.toUpperCase() : initials(center.name);
  return { logoUrl, monogram, shortName };
}

export type RoleLikeForShell = { name: string; scopeKind: string };

/**
 * The role line under the user's name and in the sidebar footer. Center-wide
 * roles come first; scoped roles (one event, class or zone) are named with
 * their scope.
 */
export function roleSummary(ctx: { roles: RoleLikeForShell[]; isPlatformAdmin: boolean }): string {
  const center = ctx.roles.filter((r) => r.scopeKind === "center" || r.scopeKind === "platform");
  const scoped = ctx.roles.filter((r) => r.scopeKind !== "center" && r.scopeKind !== "platform");
  const ordered = [...center, ...scoped];
  const first = ordered[0];
  if (!first) return ctx.isPlatformAdmin ? "Platform admin" : "No staff role";
  const label = center.length > 0 ? first.name : `${first.name} (${first.scopeKind})`;
  const more = ordered.length - 1;
  return more > 0 ? `${label} +${more} more` : label;
}

/**
 * The sidebar footer, as in the prototype: "{role} · {n} permissions. Menus,
 * data and buttons follow your role, and the server enforces the same rules."
 */
export function navFooter(ctx: { roles: RoleLikeForShell[]; isPlatformAdmin: boolean; permissions: readonly string[] }): string {
  const role = roleSummary(ctx);
  const n = ctx.permissions.length;
  const count = ctx.isPlatformAdmin ? "all permissions (platform admin)" : `${n} permission${n === 1 ? "" : "s"}`;
  return `${role} · ${count}. Menus, data and buttons follow your role, and the server enforces the same rules.`;
}
