import { WeaverMark } from "@/components/brand/weaver-mark";
import { PRODUCT_DESCRIPTOR, PRODUCT_NAME } from "@/lib/brand";

// The Weaver logo, as brand/components/Logo and brand/README.md ("Logo") describe it. One implementation for every surface that
// shows the Weaver lockup: the website's header and footer, and the sign-in, request-access and demo pages.

/**
 * The mark on its white tile, for a dark ground (`navy` or darker): the tile takes `radius-logo-tile` and the mark sits at about
 * 72% of it. The mark is never put bare on navy.
 */
export function LogoTile({ size = 44, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`flex flex-none items-center justify-center rounded-logo-tile bg-white ${className}`} style={{ width: size, height: size }}>
      <WeaverMark size={Math.round(size * 0.72)} />
    </span>
  );
}

/**
 * The lockup: the mark, "Weaver" in the wordmark style and the descriptor under it. Three settings:
 * `default` on canvas or white, `onAccent` on the saffron header (the descriptor turns ink: muted is too light there), and
 * `light` on navy (the mark on its white tile, the name in white, the descriptor in navy-200).
 */
export function Logo({ light = false, onAccent = false }: { light?: boolean; onAccent?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      {light ? <LogoTile size={44} /> : <WeaverMark className="h-11 w-11 flex-none" />}
      <span className="flex flex-col">
        <span className={`font-display text-[24px] font-semibold leading-none tracking-[-0.01em] ${light ? "text-white" : "text-navy"}`}>{PRODUCT_NAME}</span>
        <span className={`mt-1 text-[11.5px] font-semibold leading-none ${light ? "text-navy-200" : onAccent ? "text-ink" : "text-muted"}`}>{PRODUCT_DESCRIPTOR}</span>
      </span>
    </span>
  );
}
