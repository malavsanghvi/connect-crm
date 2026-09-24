/** Platform is for platform admins only (accounts.is_platform_admin), not a center role. */
export function PlatformNoAccess() {
  return (
    <div className="cc-card px-6 py-10 text-center">
      <p className="font-display text-[22px] font-semibold text-ink">You don&apos;t have access to this area</p>
      <p className="mx-auto mt-2 max-w-lg text-[13px] text-muted">
        Platform is for the platform team: onboarding new centers and support across centers. It is not part of any center role.
      </p>
    </div>
  );
}
