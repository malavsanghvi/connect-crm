// The look of the few pages Weaver writes by hand as plain HTML (the unsubscribe page, the payment-return page, the website's 404):
// the brand kit's canvas, ink and face, read from brand/tokens.json (through src/lib/brand-tokens.generated.ts) so they follow the
// kit. No web font is loaded for them (they carry no stylesheet and make no request); the face is named first and the system
// sans-serif answers where it is not installed.
import { brandColor } from "@/lib/brand-colors";
import { BRAND_SANS_STACK } from "@/lib/brand-tokens.generated";

/** The kit's sans stack, written so it can sit inside a double-quoted style attribute. */
export function brandFontStack(): string {
  return BRAND_SANS_STACK.replace(/"/g, "'");
}

/** Declarations for the body of a hand-written page: the kit's canvas, ink and face. */
export function brandPageStyle(): string {
  return `background:${brandColor("canvas")};color:${brandColor("ink")};font-family:${brandFontStack()}`;
}
