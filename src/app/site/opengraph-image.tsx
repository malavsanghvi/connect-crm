import { ImageResponse } from "next/og";

import { weaverMarkSvg } from "@/components/brand/weaver-mark";
import { GENEROSITY_LINE } from "@/lib/brand";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

// The picture shown when a link to the website is shared (WhatsApp, email, social media).
export const alt = SITE_TAGLINE;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#F6F2EA", padding: 72 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {weaverMarkSvg("og", { width: 84, height: 84 })}
          <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: "#1B2C5C" }}>{SITE_NAME}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.04, color: "#1B2C5C" }}>AI Native Community Weaver Platform.</div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.04, color: "#C9731C" }}>Paid Forward Already.</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", fontSize: 38, fontWeight: 700, color: "#1B2C5C" }}>{GENEROSITY_LINE}</div>
          <div style={{ display: "flex", fontSize: 28, color: "#5E5A52" }}>Faith Weaver · Community Weaver · Org Weaver</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
