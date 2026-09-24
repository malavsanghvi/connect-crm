import type { TenantBranding } from "@/lib/shell";

/**
 * The tenant's mark from centers.branding (never a hard-coded logo). Without
 * a configured logo, a navy tile with the community's short name.
 */
export function TenantMark({ branding, name, size = 36 }: { branding: TenantBranding; name: string; size?: number }) {
  if (branding.logoUrl) {
    return (
      // A tenant-configured https URL on any host: next/image would need every host allow-listed.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={branding.logoUrl} alt={`${name} logo`} style={{ height: size, width: "auto" }} className="shrink-0" />
    );
  }
  return (
    <span
      role="img"
      aria-label={`${name} logo`}
      style={{ height: size, minWidth: size, fontSize: Math.round(size * (branding.monogram.length > 2 ? 0.3 : 0.38)) }}
      className="inline-flex shrink-0 items-center justify-center rounded-[10px] bg-navy px-1 font-extrabold tracking-wide text-white"
    >
      {branding.monogram}
    </span>
  );
}
