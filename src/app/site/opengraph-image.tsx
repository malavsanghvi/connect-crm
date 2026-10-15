import { ImageResponse } from "next/og";

import { weaverMarkSvg } from "@/components/brand/weaver-mark";
import { GENEROSITY_LINE, PRODUCT_DESCRIPTOR, PRODUCT_NAME } from "@/lib/brand";
import { brandColor, brandShadow } from "@/lib/brand-colors";
import { OG_DISPLAY, OG_SANS, loadBrandOgFonts } from "@/lib/brand-og";
import { SITE_TAGLINE } from "@/lib/site";

// The picture shown when a link to the website is shared (WhatsApp, email, social media). It is the home page's hero, drawn from the
// brand kit (brand/README.md): the white hero card on the saffron band over canvas, the logo lockup, the promise word for word with
// "For free. Forever." in ember on the gold to saffron underline, and the generosity line. Colours come from brand/tokens.json and
// the faces are Bricolage Grotesque and Hanken Grotesk (src/lib/brand-og.ts), so it follows the kit.
export const alt = SITE_TAGLINE;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PROMISE = "Do more good. Weaver handles the operations.";
const PROMISE_HIGHLIGHT = "For free. Forever.";

export default async function OpenGraphImage() {
  const fonts = await loadBrandOgFonts();
  const navy = brandColor("navy");
  const muted = brandColor("muted");
  const markSize = 88; // the kit's 44px mark, drawn at twice the size
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: brandColor("canvas"), fontFamily: OG_SANS }}>
        {/* The saffron band behind the hero card covers the top 58%. */}
        <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "58%", background: brandColor("saffron") }} />
        <div
          style={{
            position: "absolute",
            left: 56,
            top: 56,
            width: 1088,
            height: 518,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 48,
            background: brandColor("white"),
            borderRadius: 32,
            boxShadow: brandShadow("shadow-hero"),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {weaverMarkSvg("og", { width: markSize, height: markSize })}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontFamily: OG_DISPLAY, fontSize: 48, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.01em", color: navy }}>{PRODUCT_NAME}</div>
              <div style={{ display: "flex", marginTop: 8, fontSize: 23, fontWeight: 600, lineHeight: 1, color: muted }}>{PRODUCT_DESCRIPTOR}</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", fontFamily: OG_DISPLAY, fontSize: 62, fontWeight: 700, lineHeight: 1.04, letterSpacing: "-0.03em", color: navy }}>
            <div style={{ display: "flex" }}>{PROMISE}</div>
            <div style={{ display: "flex", position: "relative", alignSelf: "flex-start", color: brandColor("brown") }}>
              {/* The kit's headline underline: gold to saffron, 26% of the line height. */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: 4,
                  width: "100%",
                  height: "0.26em",
                  backgroundImage: `linear-gradient(90deg, ${brandColor("gold")}, ${brandColor("saffron")})`,
                  opacity: 0.5,
                }}
              />
              <div style={{ display: "flex", position: "relative" }}>{PROMISE_HIGHLIGHT}</div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: navy }}>{GENEROSITY_LINE}</div>
            <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: muted }}>Faith Weaver · Community Weaver · Org Weaver</div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
