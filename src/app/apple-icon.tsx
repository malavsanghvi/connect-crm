import { ImageResponse } from "next/og";

import { weaverMarkSvg } from "@/components/brand/weaver-mark";

// The home-screen icon (iOS "Add to Home Screen"): the Weaver mark on white.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
        {weaverMarkSvg("ai", { width: 148, height: 148 })}
      </div>
    ),
    { ...size },
  );
}
